const fs = require('fs');
const path = require('path');

const SEC_BASE = 'https://data.sec.gov';
const EFTS_BASE = 'https://efts.sec.gov/LATEST';
const SEC_HEADERS = { 
    'User-Agent': 'STRATA/1.0 (strata-terminal@proton.me)', 
    'Accept': 'application/json' 
};

// Simple rate limiter
let lastRequestTime = 0;
const rateLimitDelayMs = 150; // SEC allows 10 requests/second, so ~100ms. We use 150ms to be safe.

async function enforceRateLimit() {
    const now = Date.now();
    const timeSinceLast = now - lastRequestTime;
    if (timeSinceLast < rateLimitDelayMs) {
        await new Promise(resolve => setTimeout(resolve, rateLimitDelayMs - timeSinceLast));
    }
    lastRequestTime = Date.now();
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
    try {
        const cik = await lookupCikByTicker(ticker);
        if (!cik) return null;
        
        const url = `${SEC_BASE}/api/xbrl/companyfacts/CIK${cik}.json`;
        return await fetchWithRetry(url, { headers: SEC_HEADERS });
    } catch (error) {
        console.error(`Error fetching company facts for ${ticker}:`, error.message);
        return null;
    }
}

async function fetchCompanyFilings(ticker) {
    try {
        const cik = await lookupCikByTicker(ticker);
        if (!cik) return null;
        
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
        
        return result;
    } catch (error) {
        console.error(`Error fetching company filings for ${ticker}:`, error.message);
        return [];
    }
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
    try {
        const facts = await fetchCompanyFacts(ticker);
        if (!facts || !facts.facts || !facts.facts['us-gaap']) return { segments: [] };
        
        // Revenue can be under different concepts
        const conceptsToCheck = [
            'RevenueFromContractWithCustomerExcludingAssessedTax',
            'Revenues',
            'SalesRevenueNet',
            'RevenuesNetOfInterestExpense'
        ];
        
        let concept = null;
        for (const c of conceptsToCheck) {
            if (facts.facts['us-gaap'][c]) {
                concept = c;
                break;
            }
        }
        
        if (!concept) return { segments: [] };
        
        const conceptData = facts.facts['us-gaap'][concept];
        const unit = Object.keys(conceptData.units)[0]; // usually USD
        const records = conceptData.units[unit];
        
        // Filter for annual (10-K) data with segment dimensions
        const segmentRecords = records.filter(r => 
            r.form === '10-K' && 
            r.segment && 
            (r.segment.axis === 'us-gaap:StatementBusinessSegmentsAxis' || r.segment.axis === 'us-gaap:ProductOrServiceAxis')
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
                period: record.fy, // Fiscal Year
                value: record.val
            });
        }
        
        const segments = Object.keys(segmentMap).map(name => {
            // Sort by period, remove duplicates taking latest filed
            const sorted = segmentMap[name].sort((a, b) => a.period - b.period);
            const unique = [];
            let lastPeriod = null;
            for (const item of sorted) {
                if (item.period !== lastPeriod) {
                    unique.push(item);
                    lastPeriod = item.period;
                } else {
                    unique[unique.length - 1] = item; // overwrite with later record
                }
            }
            return {
                name,
                values: unique
            };
        });
        
        return { segments };
        
    } catch (error) {
        console.error(`Error fetching revenue by segment for ${ticker}:`, error.message);
        return { segments: [] };
    }
}

function getLatestAnnualValues(facts, conceptList, fallbackVal = 0) {
    if (!facts || !facts.facts || !facts.facts['us-gaap']) return [];
    
    let concept = null;
    for (const c of conceptList) {
        if (facts.facts['us-gaap'][c]) {
            concept = c;
            break;
        }
    }
    
    if (!concept) return [];
    
    const conceptData = facts.facts['us-gaap'][concept];
    const unit = Object.keys(conceptData.units)[0];
    const records = conceptData.units[unit];
    
    // Filter to 10-K (Annual), no segments (consolidated)
    const annualRecords = records.filter(r => r.form === '10-K' && !r.segment);
    
    // Map by fiscal year
    const byFy = {};
    for (const r of annualRecords) {
        if (r.fy) {
            // If multiple records for same FY (e.g., restatements), keep the latest filed
            if (!byFy[r.fy] || new Date(r.filed) > new Date(byFy[r.fy].filed)) {
                byFy[r.fy] = r;
            }
        }
    }
    
    return Object.values(byFy).sort((a, b) => a.fy - b.fy);
}

async function fetchCapitalAllocation(ticker) {
    try {
        const facts = await fetchCompanyFacts(ticker);
        if (!facts) return [];
        
        const capex = getLatestAnnualValues(facts, ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets']);
        const buybacks = getLatestAnnualValues(facts, ['PaymentsForRepurchaseOfCommonStock', 'PaymentsForRepurchaseOfEquity']);
        const dividends = getLatestAnnualValues(facts, ['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock', 'Dividends', 'DividendsPaid']);
        const acquisitions = getLatestAnnualValues(facts, ['PaymentsToAcquireBusinessesNetOfCashAcquired', 'PaymentsToAcquireBusinessesGross']);
        const debtRepayment = getLatestAnnualValues(facts, ['RepaymentsOfLongTermDebt', 'RepaymentsOfDebt']);
        const debtIssuance = getLatestAnnualValues(facts, ['ProceedsFromIssuanceOfLongTermDebt', 'ProceedsFromIssuanceOfDebt']);
        const ocf = getLatestAnnualValues(facts, ['NetCashProvidedByOperatingActivities', 'NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations']);
        
        // Determine common fiscal years (last 5 available in OCF)
        const years = ocf.map(r => r.fy).slice(-5);
        
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
        
        return result;
        
    } catch (error) {
        console.error(`Error fetching capital allocation for ${ticker}:`, error.message);
        return [];
    }
}

async function fetchEarningsQualityData(ticker) {
    try {
        const facts = await fetchCompanyFacts(ticker);
        if (!facts) return [];
        
        const netIncome = getLatestAnnualValues(facts, ['NetIncomeLoss']);
        const ocf = getLatestAnnualValues(facts, ['NetCashProvidedByOperatingActivities', 'NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations']);
        const totalAssets = getLatestAnnualValues(facts, ['Assets']);
        const ar = getLatestAnnualValues(facts, ['AccountsReceivableNetCurrent']);
        const inventory = getLatestAnnualValues(facts, ['InventoryNet']);
        const revenue = getLatestAnnualValues(facts, ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet']);
        const sbc = getLatestAnnualValues(facts, ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense']);
        const sharesOut = getLatestAnnualValues(facts, ['WeightedAverageNumberOfDilutedSharesOutstanding', 'CommonStockSharesOutstanding']);
        
        const years = netIncome.map(r => r.fy).slice(-5);
        
        const result = [];
        for (const fy of years) {
            const getVal = (arr) => {
                const item = arr.find(x => x.fy === fy);
                return item ? item.val : 0;
            };
            
            result.push({
                year: fy,
                netIncome: getVal(netIncome),
                operatingCashFlow: getVal(ocf),
                totalAssets: getVal(totalAssets),
                accountsReceivable: getVal(ar),
                inventory: getVal(inventory),
                revenue: getVal(revenue),
                stockBasedCompensation: getVal(sbc),
                sharesOutstanding: getVal(sharesOut)
            });
        }
        
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
    lookupCikByTicker,
    fetchCompanyFacts,
    fetchCompanyFilings,
    extractFinancialTimeSeries,
    fetchRevenueBySegment,
    fetchCapitalAllocation,
    fetchEarningsQualityData
};
