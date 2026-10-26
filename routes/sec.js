const express = require('express');
const router = express.Router();

const {
    fetchCompanyFacts,
    fetchCompanyFilings,
    extractFinancialTimeSeries,
    fetchRevenueBySegment,
    fetchCapitalAllocation,
    fetchEarningsQualityData
} = require('../utils/secProviders');

const { normalizeTicker } = require('../utils/api');
const { wrapWithProvenance, FRESHNESS, DATA_QUALITY } = require('../utils/provenance');
const { MemoryCache } = require('../utils/cache');

// Import AI provider for the diff summary
const { generateAiAnalysis } = require('../utils/aiProviders');

// Route-specific filing diff cache (other SEC caches are centralized in utils/secProviders.js)
const DIFF_CACHE = new MemoryCache('sec-filing-diff', 12 * 60 * 60 * 1000); // 12h

/**
 * Endpoint 1: /facts/:ticker
 * Returns full XBRL company facts for a ticker.
 */
router.get('/facts/:ticker', async (req, res) => {
    try {
        const ticker = normalizeTicker(req.params.ticker);
        if (!ticker) {
            return res.status(400).json({ error: 'Invalid or missing ticker' });
        }

        const facts = await fetchCompanyFacts(ticker);
        if (!facts || Object.keys(facts).length === 0) {
            return res.status(404).json({ error: `Facts not found for ticker: ${ticker}` });
        }

        res.json(wrapWithProvenance(
            { ticker, facts },
            {
                provider: 'sec',
                timestamp: new Date().toISOString(),
                dataQuality: DATA_QUALITY.OFFICIAL,
                freshness: FRESHNESS.CACHED,
                endpoint: '/sec/facts'
            }
        ));
    } catch (error) {
        console.error(`Error in /sec/facts/${req.params.ticker}:`, error);
        res.status(500).json({ error: 'Internal server error while fetching SEC facts' });
    }
});

/**
 * Endpoint 2: /filings/:ticker
 * Returns recent SEC filings (10-K, 10-Q, 8-K).
 */
router.get('/filings/:ticker', async (req, res) => {
    try {
        const ticker = normalizeTicker(req.params.ticker);
        if (!ticker) {
            return res.status(400).json({ error: 'Invalid or missing ticker' });
        }

        const filings = await fetchCompanyFilings(ticker);
        if (!filings || filings.length === 0) {
            return res.status(404).json({ error: `Filings not found for ticker: ${ticker}` });
        }

        res.json(wrapWithProvenance(
            { ticker, filings },
            {
                provider: 'sec',
                timestamp: new Date().toISOString(),
                dataQuality: DATA_QUALITY.OFFICIAL,
                freshness: FRESHNESS.CACHED,
                endpoint: '/sec/filings'
            }
        ));
    } catch (error) {
        console.error(`Error in /sec/filings/${req.params.ticker}:`, error);
        res.status(500).json({ error: 'Internal server error while fetching SEC filings' });
    }
});

/**
 * Endpoint 3: /segments/:ticker
 * Returns revenue/income by business segment.
 */
router.get('/segments/:ticker', async (req, res) => {
    try {
        const ticker = normalizeTicker(req.params.ticker);
        if (!ticker) {
            return res.status(400).json({ error: 'Invalid or missing ticker' });
        }

        const segments = await fetchRevenueBySegment(ticker);
        if (!segments) {
            return res.status(404).json({ error: `Segment data not found for ticker: ${ticker}` });
        }

        // Support both { segments: [...] } and direct array callers
        const segmentArray = Array.isArray(segments) ? segments : (segments.segments || []);

        res.json(wrapWithProvenance(
            { ticker, segments: segmentArray, raw: segments },
            {
                provider: 'sec',
                timestamp: new Date().toISOString(),
                dataQuality: DATA_QUALITY.OFFICIAL,
                freshness: FRESHNESS.CACHED,
                endpoint: '/sec/segments'
            }
        ));
    } catch (error) {
        console.error(`Error in /sec/segments/${req.params.ticker}:`, error);
        res.status(500).json({ error: 'Internal server error while fetching SEC segment data' });
    }
});

/**
 * Endpoint 4: /capital-allocation/:ticker
 * Returns CapEx, buybacks, dividends, acquisitions, debt data.
 */
router.get('/capital-allocation/:ticker', async (req, res) => {
    try {
        const ticker = normalizeTicker(req.params.ticker);
        if (!ticker) {
            return res.status(400).json({ error: 'Invalid or missing ticker' });
        }

        const allocation = await fetchCapitalAllocation(ticker);
        if (!allocation) {
            return res.status(404).json({ error: `Capital allocation data not found for ticker: ${ticker}` });
        }

        res.json(wrapWithProvenance(
            { ticker, allocation },
            {
                provider: 'sec',
                timestamp: new Date().toISOString(),
                dataQuality: DATA_QUALITY.OFFICIAL,
                freshness: FRESHNESS.CACHED,
                endpoint: '/sec/capital-allocation'
            }
        ));
    } catch (error) {
        console.error(`Error in /sec/capital-allocation/${req.params.ticker}:`, error);
        res.status(500).json({ error: 'Internal server error while fetching SEC capital allocation data' });
    }
});

/**
 * Endpoint 5: /earnings-quality/:ticker
 * Returns earnings quality metrics.
 */
router.get('/earnings-quality/:ticker', async (req, res) => {
    try {
        const ticker = normalizeTicker(req.params.ticker);
        if (!ticker) {
            return res.status(400).json({ error: 'Invalid or missing ticker' });
        }

        const quality = await fetchEarningsQualityData(ticker);
        if (!quality) {
            return res.status(404).json({ error: `Earnings quality data not found for ticker: ${ticker}` });
        }

        res.json(wrapWithProvenance(
            { ticker, quality },
            {
                provider: 'sec',
                timestamp: new Date().toISOString(),
                dataQuality: DATA_QUALITY.OFFICIAL,
                freshness: FRESHNESS.CACHED,
                endpoint: '/sec/earnings-quality'
            }
        ));
    } catch (error) {
        console.error(`Error in /sec/earnings-quality/${req.params.ticker}:`, error);
        res.status(500).json({ error: 'Internal server error while fetching SEC earnings quality data' });
    }
});

/**
 * Helper function to extract a specific financial metric for a specific period
 */
function getMetricValue(timeSeries, periodDate) {
    if (!timeSeries || !Array.isArray(timeSeries) || !periodDate) return null;
    
    // 1. Direct match on end date or period
    let point = timeSeries.find(p => p.end === periodDate || p.period === periodDate);
    
    // 2. Starts with match on date string (e.g. 2024-09 vs 2024-09-30)
    if (!point) {
        point = timeSeries.find(p => p.end && (p.end.startsWith(periodDate) || periodDate.startsWith(p.end)));
    }
    
    // 3. Closest prior end date if within 45 days of reportDate/periodDate
    if (!point) {
        const targetTime = new Date(periodDate).getTime();
        if (!isNaN(targetTime)) {
            const candidates = timeSeries.filter(p => {
                const pTime = new Date(p.end || p.filed).getTime();
                return pTime <= targetTime && (targetTime - pTime) <= 45 * 24 * 3600 * 1000;
            });
            if (candidates.length > 0) {
                candidates.sort((a, b) => new Date(b.end || b.filed).getTime() - new Date(a.end || a.filed).getTime());
                point = candidates[0];
            }
        }
    }
    
    if (!point) return null;
    return point.value !== undefined ? point.value : (point.val !== undefined ? point.val : null);
}

/**
 * Helper function to compute changes between two values
 */
function computeChange(currentVal, previousVal) {
    if (currentVal === null || previousVal === null || currentVal === undefined || previousVal === undefined) return null;
    
    const change = currentVal - previousVal;
    let changePercent = null;
    if (previousVal !== 0) {
        changePercent = (change / Math.abs(previousVal)) * 100;
    }
    
    return {
        current: currentVal,
        previous: previousVal,
        change: change,
        changePercent: changePercent != null ? parseFloat(changePercent.toFixed(2)) : null,
        direction: change > 0 ? "up" : (change < 0 ? "down" : "flat")
    };
}

/**
 * Endpoint 6: /filing-diff/:ticker
 * SEC Filing Diff: Compares key financial metrics between the last 2 filings of a given type.
 */
router.get('/filing-diff/:ticker', async (req, res) => {
    try {
        const ticker = normalizeTicker(req.params.ticker);
        if (!ticker) {
            return res.status(400).json({ error: 'Invalid or missing ticker' });
        }

        const type = req.query.type || '10-Q';
        const cacheKey = `${ticker}-${type}`;
        
        let diffData = DIFF_CACHE.getValue(cacheKey);
        let freshness = FRESHNESS.CACHED;
        
        if (!diffData) {
            // 1. Fetch filings to identify the last two periods (cached in utils/secProviders.js)
            const filings = await fetchCompanyFilings(ticker);
            
            if (!filings || !Array.isArray(filings)) {
                return res.status(404).json({ error: `Could not retrieve filings for ${ticker}` });
            }
            
            // Filter filings by requested type (10-Q or 10-K)
            const targetFilings = filings.filter(f => f.form === type);
            if (targetFilings.length < 2) {
                return res.status(404).json({ error: `Not enough ${type} filings found for ${ticker} to generate a diff.` });
            }
            
            const currentFilingInfo = targetFilings[0];
            const previousFilingInfo = targetFilings[1];
            
            // 2. Fetch XBRL company facts (cached in utils/secProviders.js)
            const facts = await fetchCompanyFacts(ticker);
            
            if (!facts || Object.keys(facts).length === 0) {
                return res.status(404).json({ error: `Facts not found for ${ticker}` });
            }

            // Expanded GAAP concept lists to support varying taxonomy standards
            const conceptsMap = {
                revenue: [
                    'RevenueFromContractWithCustomerExcludingAssessedTax',
                    'Revenues',
                    'SalesRevenueNet',
                    'SalesRevenueGoodsNet',
                    'RevenuesNetOfInterestExpense',
                    'InterestAndDividendIncomeOperating'
                ],
                netIncome: [
                    'NetIncomeLoss',
                    'ProfitLoss',
                    'NetIncomeLossAvailableToCommonStockholdersBasic'
                ],
                operatingCashFlow: [
                    'NetCashProvidedByOperatingActivities',
                    'NetCashProvidedByUsedInOperatingActivities',
                    'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'
                ],
                capex: [
                    'PaymentsToAcquirePropertyPlantAndEquipment',
                    'PaymentsToAcquireProductiveAssets',
                    'CapitalExpendituresIncurredButNotYetPaid'
                ],
                assets: ['Assets'],
                liabilities: ['Liabilities'],
                equity: [
                    'StockholdersEquity',
                    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'
                ],
                cash: [
                    'CashAndCashEquivalentsAtCarryingValue',
                    'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'
                ],
                debt: [
                    'LongTermDebt',
                    'LongTermDebtNoncurrent',
                    'DebtInstrumentCarryingAmount'
                ],
                eps: [
                    'EarningsPerShareDiluted',
                    'EarningsPerShareBasic'
                ]
            };

            const extractedMetrics = {};
            for (const [key, conceptList] of Object.entries(conceptsMap)) {
                let series = [];
                for (const concept of conceptList) {
                    const result = extractFinancialTimeSeries(facts, concept);
                    if (result && result.length > 0) {
                        series = result;
                        break;
                    }
                }
                extractedMetrics[key] = series;
            }

            // 3. Compare key financial metrics
            const currentPeriod = currentFilingInfo.reportDate || currentFilingInfo.period || currentFilingInfo.filedDate || currentFilingInfo.filingDate;
            const previousPeriod = previousFilingInfo.reportDate || previousFilingInfo.period || previousFilingInfo.filedDate || previousFilingInfo.filingDate;

            const changes = {};
            for (const key of Object.keys(conceptsMap)) {
                const currentVal = getMetricValue(extractedMetrics[key], currentPeriod);
                const previousVal = getMetricValue(extractedMetrics[key], previousPeriod);
                
                const metricChange = computeChange(currentVal, previousVal);
                if (metricChange) {
                    changes[key] = metricChange;
                }
            }

            // 4. Generate AI summary
            let aiSummary = null;
            if (Object.keys(changes).length > 0) {
                try {
                    const prompt = `You are an institutional financial analyst. Analyze the following changes between the latest two ${type} SEC filings for ${ticker}. 
Data shows current value, previous value, change, percentage change, and direction for key financial metrics:
${JSON.stringify(changes, null, 2)}
Provide a concise, 2-3 sentence institutional verdict on the trajectory, highlighting revenue/cash flow trends and any margin or debt risks.`;
                    
                    const aiRes = await generateAiAnalysis(prompt);
                    aiSummary = typeof aiRes === 'string' ? aiRes : (aiRes?.analysis || 'Filing comparison analysis completed.');
                } catch (aiError) {
                    console.error('AI Summary failed for filing diff:', aiError.message || aiError);
                    aiSummary = "AI summary generation failed or is unavailable.";
                }
            }

            diffData = {
                ticker,
                filingType: type,
                current: { 
                    period: currentPeriod, 
                    form: currentFilingInfo.form, 
                    filedDate: currentFilingInfo.filedDate || currentFilingInfo.filingDate 
                },
                previous: { 
                    period: previousPeriod, 
                    form: previousFilingInfo.form, 
                    filedDate: previousFilingInfo.filedDate || previousFilingInfo.filingDate 
                },
                changes,
                aiSummary
            };

            DIFF_CACHE.set(cacheKey, diffData);
            freshness = FRESHNESS.REALTIME;
        }

        res.json(wrapWithProvenance(
            diffData,
            {
                provider: 'sec',
                timestamp: new Date().toISOString(),
                dataQuality: DATA_QUALITY.OFFICIAL,
                freshness,
                endpoint: '/sec/filing-diff'
            }
        ));
    } catch (error) {
        console.error(`Error in /sec/filing-diff/${req.params.ticker}:`, error);
        res.status(500).json({ error: 'Internal server error while computing SEC filing diff' });
    }
});

module.exports = router;
