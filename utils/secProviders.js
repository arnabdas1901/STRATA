const fs = require('fs');
const path = require('path');

const SEC_BASE = 'https://data.sec.gov';
const EFTS_BASE = 'https://efts.sec.gov/LATEST';
const SEC_HEADERS = { 
    'User-Agent': 'STRATA/1.0 (strata-terminal@proton.me)', 
    'Accept': 'application/json' 
};

const { MemoryCache } = require('./cache');

// In-memory caches for SEC XBRL facts and company filings
const factsCache = new MemoryCache('sec-facts', 24 * 60 * 60 * 1000, 50);
const filingsCache = new MemoryCache('sec-filings', 6 * 60 * 60 * 1000, 100);
const segmentsCache = new MemoryCache('sec-segments', 24 * 60 * 60 * 1000, 100);
const capAllocCache = new MemoryCache('sec-capital-allocation', 12 * 60 * 60 * 1000, 100);
const qualityCache = new MemoryCache('sec-earnings-quality', 12 * 60 * 60 * 1000, 100);
const inFlightFacts = new Map();
const inFlightFilings = new Map();

// Race-condition-free atomic rate limiter (SEC allows 10 req/sec; 150ms delay)
let lastRequestTime = 0;
const rateLimitDelayMs = 150;

async function enforceRateLimit() {
    const now = Date.now();
    const nextAllowed = Math.max(now, lastRequestTime + rateLimitDelayMs);
    lastRequestTime = nextAllowed;
    const waitMs = nextAllowed - now;
    if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
    }
}

async function fetchWithRetry(url, options = {}, retries = 3) {
    for (let i = 0; i < retries; i++) {
        await enforceRateLimit();
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                if (response.status === 429) {
                    // Too many requests, wait longer
                    await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
                    continue;
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            if (i === retries - 1) {
                console.error(`SEC API error for ${url}:`, error.message);
                return null;
            }
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
        }
    }
    return null;
}

// Memory cache for ticker -> CIK mapping
let tickerCikCache = null;
let tickerCikCacheTime = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function getTickerToCikMap() {
    const now = Date.now();
    if (tickerCikCache && (now - tickerCikCacheTime) < CACHE_TTL) {
        return tickerCikCache;
    }

    try {
        const url = 'https://www.sec.gov/files/company_tickers.json';
        await enforceRateLimit();
        const response = await fetch(url, { headers: SEC_HEADERS });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const data = await response.json();
        tickerCikCache = {};
        
        // SEC returns { "0": { "cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc." }, ... }
        for (const key in data) {
            const entry = data[key];
            tickerCikCache[entry.ticker.toUpperCase()] = entry.cik_str;
        }
        
        tickerCikCacheTime = now;
        return tickerCikCache;
    } catch (error) {
        console.error('Failed to fetch SEC ticker list:', error.message);
        return tickerCikCache || {}; // Return old cache if exists, or empty
    }
}

async function lookupCikByTicker(ticker) {
    if (!ticker) return null;
    const tickerUpper = ticker.toUpperCase();
    
    const map = await getTickerToCikMap();
    const cik = map[tickerUpper];
    
    if (cik) {
        return String(cik).padStart(10, '0');
    }
    return null;
}

async function fetchCompanyFacts(ticker) {
    if (!ticker) return null;
    const tickerUpper = ticker.toUpperCase();

    // Check memory cache
    const cached = factsCache.getData(tickerUpper);
    if (cached) return cached;

    // Check in-flight requests deduplication
    if (inFlightFacts.has(tickerUpper)) {
        return await inFlightFacts.get(tickerUpper);
    }

    const fetchPromise = (async () => {
        try {
            const cik = await lookupCikByTicker(tickerUpper);
            if (!cik) return null;
            
            const url = `${SEC_BASE}/api/xbrl/companyfacts/CIK${cik}.json`;
            const data = await fetchWithRetry(url, { headers: SEC_HEADERS });
            if (data) {
                factsCache.set(tickerUpper, data);
            }
            return data;
        } catch (error) {
            console.error(`Error fetching company facts for ${tickerUpper}:`, error.message);
            return null;
        } finally {
            inFlightFacts.delete(tickerUpper);
        }
    })();

    inFlightFacts.set(tickerUpper, fetchPromise);
    return await fetchPromise;
}

async function fetchCompanyFilings(ticker) {
    if (!ticker) return [];
    const tickerUpper = ticker.toUpperCase();

    // Check memory cache
    const cached = filingsCache.getData(tickerUpper);
    if (cached) return cached;

    // Check in-flight requests deduplication
    if (inFlightFilings.has(tickerUpper)) {
        return await inFlightFilings.get(tickerUpper);
    }

    const fetchPromise = (async () => {
        try {
            const cik = await lookupCikByTicker(tickerUpper);
            if (!cik) return [];
            
            const url = `${SEC_BASE}/submissions/CIK${cik}.json`;
            const data = await fetchWithRetry(url, { headers: SEC_HEADERS });
            
            if (!data || !data.filings || !data.filings.recent) return [];
            
            const recent = data.filings.recent;
            const result = [];
            
            for (let i = 0; i < recent.accessionNumber.length; i++) {
                const form = recent.form[i];
                if (['10-K', '10-Q', '8-K'].includes(form)) {
                    result.push({
                        accessionNumber: recent.accessionNumber[i],
                        filingDate: recent.filingDate[i],
                        reportDate: recent.reportDate[i],
                        form: form,
                        primaryDocument: recent.primaryDocument[i],
                        description: recent.primaryDocDescription[i] || ''
                    });
                }
            }
            
            filingsCache.set(tickerUpper, result);
            return result;
        } catch (error) {
            console.error(`Error fetching company filings for ${tickerUpper}:`, error.message);
            return [];
        } finally {
            inFlightFilings.delete(tickerUpper);
        }
    })();

    inFlightFilings.set(tickerUpper, fetchPromise);
    return await fetchPromise;
}

function extractFinancialTimeSeries(facts, concept, unit = 'USD') {
    if (!facts || !facts.facts) return [];
    
    // Support US GAAP, IFRS, etc.
    let taxonomy = 'us-gaap';
    if (!facts.facts['us-gaap'] && facts.facts['ifrs-full']) {
        taxonomy = 'ifrs-full';
    }
    
    if (!facts.facts[taxonomy] || !facts.facts[taxonomy][concept]) return [];
    
    const conceptData = facts.facts[taxonomy][concept];
    if (!conceptData.units || !conceptData.units[unit]) {
        // Fallback to first available unit if requested unit not found
        const availableUnits = Object.keys(conceptData.units || {});
        if (availableUnits.length > 0) {
            unit = availableUnits[0];
        } else {
            return [];
        }
    }
    
    const timeSeries = conceptData.units[unit];
    
    return timeSeries
        .map(entry => ({
            period: entry.frame || entry.fy + (entry.fp ? `-${entry.fp}` : ''),
            value: entry.val,
            filed: entry.filed,
            form: entry.form,
            fy: entry.fy,
            fp: entry.fp,
            start: entry.start,
            end: entry.end
        }))
        // Filter out point-in-time items without 'frame' or clear period (some might need start/end logic)
        // Keep it simple: use frame if available, else fallback
        .filter(entry => entry.form === '10-K' || entry.form === '10-Q')
        .sort((a, b) => new Date(a.end || a.filed).getTime() - new Date(b.end || b.filed).getTime());
}

async function fetchRevenueBySegment(ticker) {
    if (!ticker) return { segments: [] };
    const tickerUpper = ticker.toUpperCase().trim();
    const cached = segmentsCache.getData(tickerUpper);
    if (cached) return cached;

    try {
        const facts = await fetchCompanyFacts(tickerUpper);
        if (!facts || !facts.facts) return { segments: [] };
        
        let taxonomy = 'us-gaap';
        if (!facts.facts['us-gaap'] && facts.facts['ifrs-full']) {
            taxonomy = 'ifrs-full';
        }
        if (!facts.facts[taxonomy]) return { segments: [] };
        
        // Revenue can be under different concepts
        const conceptsToCheck = [
            'RevenueFromContractWithCustomerExcludingAssessedTax',
            'Revenues',
            'SalesRevenueNet',
            'SalesRevenueGoodsNet',
            'RevenuesNetOfInterestExpense',
            'InterestAndDividendIncomeOperating'
        ];
        
        let concept = null;
        for (const c of conceptsToCheck) {
            if (facts.facts[taxonomy][c]) {
                concept = c;
                break;
            }
        }
        
        if (!concept && taxonomy === 'us-gaap' && facts.facts['ifrs-full']) {
            for (const c of conceptsToCheck) {
                if (facts.facts['ifrs-full'][c]) {
                    taxonomy = 'ifrs-full';
                    concept = c;
                    break;
                }
            }
        }

        if (!concept) return { segments: [] };
        
        const conceptData = facts.facts[taxonomy][concept];
        if (!conceptData.units) return { segments: [] };
        const unit = Object.keys(conceptData.units)[0]; // usually USD
        if (!unit || !conceptData.units[unit]) return { segments: [] };
        const records = conceptData.units[unit];
        
        const validAxes = [
            'us-gaap:StatementBusinessSegmentsAxis',
            'us-gaap:ProductOrServiceAxis',
            'srt:ProductOrServiceAxis',
            'srt:StatementGeographicalAxis',
            'us-gaap:StatementGeographicalAxis'
        ];

        // Filter for annual (10-K) data with segment dimensions
        const segmentRecords = records.filter(r => 
            (r.form === '10-K' || r.form === '20-F' || r.form === '40-F') && 
            r.segment && 
            validAxes.includes(r.segment.axis)
        );
        
        const segmentMap = {};
        
        for (const record of segmentRecords) {
            // Member looks like 'us-gaap:CloudServicesMember' or 'aapl:IPhoneMember'
            const memberRaw = record.segment.member || '';
            const memberParts = memberRaw.split(':');
            const segmentNameRaw = memberParts.length > 1 ? memberParts[1] : memberRaw;
            const segmentName = segmentNameRaw.replace(/Member$/, '').replace(/([A-Z])/g, ' $1').trim();
            
            if (!segmentMap[segmentName]) {
                segmentMap[segmentName] = [];
            }
            
            segmentMap[segmentName].push({
                period: record.fy || (record.end ? parseInt(record.end.slice(0, 4), 10) : null),
                value: record.val
            });
        }
        
        const segments = Object.keys(segmentMap).map(name => {
            const sorted = segmentMap[name]
                .filter(item => item.period)
                .sort((a, b) => a.period - b.period);
            const unique = [];
            let lastPeriod = null;
            for (const item of sorted) {
                if (item.period !== lastPeriod) {
                    unique.push(item);
                    lastPeriod = item.period;
                } else {
                    unique[unique.length - 1] = item;
                }
            }
            return {
                name,
                values: unique
            };
        }).filter(seg => seg.values.length > 0);
        
        const payload = { segments };
        segmentsCache.set(tickerUpper, payload);
        return payload;
        
    } catch (error) {
        console.error(`Error fetching revenue by segment for ${ticker}:`, error.message);
        return { segments: [] };
    }
}

function getLatestAnnualValues(facts, conceptList, fallbackVal = 0) {
    if (!facts || !facts.facts) return [];
    
    let taxonomy = 'us-gaap';
    if (!facts.facts['us-gaap'] && facts.facts['ifrs-full']) {
        taxonomy = 'ifrs-full';
    }
    if (!facts.facts[taxonomy]) return [];
    
    let concept = null;
    for (const c of conceptList) {
        if (facts.facts[taxonomy][c]) {
            concept = c;
            break;
        }
    }

    if (!concept && taxonomy === 'us-gaap' && facts.facts['ifrs-full']) {
        for (const c of conceptList) {
            if (facts.facts['ifrs-full'][c]) {
                taxonomy = 'ifrs-full';
                concept = c;
                break;
            }
        }
    }
    
    if (!concept) return [];
    
    const conceptData = facts.facts[taxonomy][concept];
    if (!conceptData.units) return [];
    const unit = Object.keys(conceptData.units)[0];
    if (!unit || !conceptData.units[unit]) return [];
    const records = conceptData.units[unit];
    
    // Filter to 10-K (Annual), no segments (consolidated)
    const annualRecords = records.filter(r => 
        (r.form === '10-K' || r.form === '20-F' || r.form === '40-F') && !r.segment
    );
    
    // Map by fiscal year
    const byFy = {};
    for (const r of annualRecords) {
        const fy = r.fy || (r.end ? parseInt(r.end.slice(0, 4), 10) : null);
        if (fy) {
            if (!byFy[fy] || new Date(r.filed || 0) > new Date(byFy[fy].filed || 0)) {
                byFy[fy] = { ...r, fy, val: r.val !== undefined ? r.val : fallbackVal };
            }
        }
    }
    
    return Object.values(byFy).sort((a, b) => a.fy - b.fy);
}

async function fetchCapitalAllocation(ticker) {
    if (!ticker) return [];
    const tickerUpper = ticker.toUpperCase().trim();
    const cached = capAllocCache.getData(tickerUpper);
    if (cached) return cached;

    try {
        const facts = await fetchCompanyFacts(tickerUpper);
        if (!facts) return [];
        
        const capex = getLatestAnnualValues(facts, [
            'PaymentsToAcquirePropertyPlantAndEquipment',
            'PaymentsToAcquireProductiveAssets',
            'CapitalExpendituresIncurredButNotYetPaid'
        ]);
        const buybacks = getLatestAnnualValues(facts, [
            'PaymentsForRepurchaseOfCommonStock',
            'PaymentsForRepurchaseOfEquity',
            'PaymentsForRepurchaseOfCommonStockAndTreasuryStock'
        ]);
        const dividends = getLatestAnnualValues(facts, [
            'PaymentsOfDividends',
            'PaymentsOfDividendsCommonStock',
            'Dividends',
            'DividendsPaid',
            'PaymentsOfDividendsMinorityInterest'
        ]);
        const acquisitions = getLatestAnnualValues(facts, [
            'PaymentsToAcquireBusinessesNetOfCashAcquired',
            'PaymentsToAcquireBusinessesGross',
            'PaymentsToAcquireInterestInJointVenture'
        ]);
        const debtRepayment = getLatestAnnualValues(facts, [
            'RepaymentsOfLongTermDebt',
            'RepaymentsOfDebt',
            'RepaymentsOfLinesOfCredit'
        ]);
        const debtIssuance = getLatestAnnualValues(facts, [
            'ProceedsFromIssuanceOfLongTermDebt',
            'ProceedsFromIssuanceOfDebt',
            'ProceedsFromLinesOfCredit'
        ]);
        const ocf = getLatestAnnualValues(facts, [
            'NetCashProvidedByUsedInOperatingActivities',
            'NetCashProvidedByOperatingActivities',
            'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'
        ]);
        
        // Determine common fiscal years across available series
        const allYearsSet = new Set([
            ...ocf.map(r => r.fy),
            ...capex.map(r => r.fy),
            ...buybacks.map(r => r.fy)
        ]);
        const years = Array.from(allYearsSet).sort((a, b) => a - b).slice(-5);
        
        const result = [];
        for (const fy of years) {
            const getVal = (arr) => {
                const item = arr.find(x => x.fy === fy);
                return item ? item.val : 0;
            };
            
            const ocfVal = getVal(ocf);
            const capexVal = getVal(capex);
            
            result.push({
                year: fy,
                fy: fy,
                operatingCashFlow: ocfVal,
                capex: capexVal,
                freeCashFlow: ocfVal - capexVal,
                buybacks: getVal(buybacks),
                dividends: getVal(dividends),
                acquisitions: getVal(acquisitions),
                debtRepayment: getVal(debtRepayment),
                debtIssuance: getVal(debtIssuance)
            });
        }
        
        capAllocCache.set(tickerUpper, result);
        return result;
        
    } catch (error) {
        console.error(`Error fetching capital allocation for ${ticker}:`, error.message);
        return [];
    }
}

async function fetchEarningsQualityData(ticker) {
    if (!ticker) return [];
    const tickerUpper = ticker.toUpperCase().trim();
    const cached = qualityCache.getData(tickerUpper);
    if (cached) return cached;

    try {
        const facts = await fetchCompanyFacts(tickerUpper);
        if (!facts) return [];
        
        const netIncome = getLatestAnnualValues(facts, [
            'NetIncomeLoss',
            'ProfitLoss',
            'NetIncomeLossAvailableToCommonStockholdersBasic'
        ]);
        const ocf = getLatestAnnualValues(facts, [
            'NetCashProvidedByUsedInOperatingActivities',
            'NetCashProvidedByOperatingActivities',
            'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'
        ]);
        const capex = getLatestAnnualValues(facts, [
            'PaymentsToAcquirePropertyPlantAndEquipment',
            'PaymentsToAcquireProductiveAssets',
            'CapitalExpendituresIncurredButNotYetPaid'
        ]);
        const totalAssets = getLatestAnnualValues(facts, [
            'Assets'
        ]);
        const stockholdersEquity = getLatestAnnualValues(facts, [
            'StockholdersEquity',
            'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'
        ]);
        const ar = getLatestAnnualValues(facts, [
            'AccountsReceivableNetCurrent',
            'ReceivablesNetCurrent',
            'AccountsNotesAndLoansReceivableNetCurrent'
        ]);
        const inventory = getLatestAnnualValues(facts, [
            'InventoryNet',
            'InventoryFinishedGoodsNetOfReserves'
        ]);
        const revenue = getLatestAnnualValues(facts, [
            'RevenueFromContractWithCustomerExcludingAssessedTax',
            'Revenues',
            'SalesRevenueNet',
            'SalesRevenueGoodsNet',
            'RevenuesNetOfInterestExpense',
            'InterestAndDividendIncomeOperating'
        ]);
        const sbc = getLatestAnnualValues(facts, [
            'ShareBasedCompensation',
            'AllocatedShareBasedCompensationExpense'
        ]);
        const sharesOut = getLatestAnnualValues(facts, [
            'WeightedAverageNumberOfDilutedSharesOutstanding',
            'CommonStockSharesOutstanding',
            'EntityCommonStockSharesOutstanding'
        ]);
        const retainedEarnings = getLatestAnnualValues(facts, [
            'RetainedEarningsAccumulatedDeficit'
        ]);
        const currentAssets = getLatestAnnualValues(facts, [
            'AssetsCurrent'
        ]);
        const currentLiabilities = getLatestAnnualValues(facts, [
            'LiabilitiesCurrent'
        ]);
        const totalLiabilities = getLatestAnnualValues(facts, [
            'Liabilities'
        ]);
        const operatingIncome = getLatestAnnualValues(facts, [
            'OperatingIncomeLoss'
        ]);
        const cashAndEquivalents = getLatestAnnualValues(facts, [
            'CashAndCashEquivalentsAtCarryingValue',
            'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'
        ]);
        const longTermDebt = getLatestAnnualValues(facts, [
            'LongTermDebtNoncurrent',
            'LongTermDebt'
        ]);
        const grossProfit = getLatestAnnualValues(facts, [
            'GrossProfit'
        ]);
        const costOfRevenue = getLatestAnnualValues(facts, [
            'CostOfGoodsAndServicesSold',
            'CostOfRevenue'
        ]);
        const ppe = getLatestAnnualValues(facts, [
            'PropertyPlantAndEquipmentNet'
        ]);
        const depreciation = getLatestAnnualValues(facts, [
            'DepreciationDepletionAndAmortization',
            'Depreciation',
            'DepreciationAndAmortization'
        ]);
        const sga = getLatestAnnualValues(facts, [
            'SellingGeneralAndAdministrativeExpense'
        ]);
        
        // Determine available years from union of major series (last 5 years)
        const allYears = Array.from(new Set([
            ...netIncome.map(r => r.fy),
            ...revenue.map(r => r.fy),
            ...ocf.map(r => r.fy),
            ...totalAssets.map(r => r.fy)
        ])).filter(Boolean).sort((a, b) => a - b).slice(-5);
        
        const result = [];
        for (const fy of allYears) {
            const getVal = (arr) => {
                const item = arr.find(x => x.fy === fy);
                return item ? item.val : 0;
            };
            
            const ocfVal = getVal(ocf);
            const capexVal = getVal(capex);
            const revVal = getVal(revenue);
            let gpVal = getVal(grossProfit);
            if (!gpVal && revVal > 0) {
                const cogsVal = getVal(costOfRevenue);
                if (cogsVal > 0) gpVal = revVal - cogsVal;
            }

            result.push({
                year: fy,
                fy: fy,
                netIncome: getVal(netIncome),
                operatingCashFlow: ocfVal,
                capex: capexVal,
                freeCashFlow: ocfVal - capexVal,
                totalAssets: getVal(totalAssets),
                stockholdersEquity: getVal(stockholdersEquity),
                accountsReceivable: getVal(ar),
                inventory: getVal(inventory),
                revenue: revVal,
                stockBasedCompensation: getVal(sbc),
                sharesOutstanding: getVal(sharesOut),
                retainedEarnings: getVal(retainedEarnings),
                currentAssets: getVal(currentAssets),
                currentLiabilities: getVal(currentLiabilities),
                totalLiabilities: getVal(totalLiabilities),
                operatingIncome: getVal(operatingIncome),
                cashAndEquivalents: getVal(cashAndEquivalents),
                longTermDebt: getVal(longTermDebt),
                grossProfit: gpVal || 0,
                ppe: getVal(ppe) || 0,
                depreciation: getVal(depreciation) || 0,
                sga: getVal(sga) || 0
            });
        }
        
        qualityCache.set(tickerUpper, result);
        return result;
    } catch (error) {
        console.error(`Error fetching earnings quality data for ${ticker}:`, error.message);
        return [];
    }
}


module.exports = {
    SEC_BASE,
    EFTS_BASE,
    SEC_HEADERS,
    factsCache,
    filingsCache,
    segmentsCache,
    capAllocCache,
    qualityCache,
    lookupCikByTicker,
    fetchCompanyFacts,
    fetchCompanyFilings,
    extractFinancialTimeSeries,
    fetchRevenueBySegment,
    fetchCapitalAllocation,
    fetchEarningsQualityData
};
