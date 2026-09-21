const express = require('express');
const router = express.Router();

const {
    lookupCikByTicker,
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

// Initialize caches
const FACTS_CACHE = new MemoryCache('sec-facts', 24 * 60 * 60 * 1000); // 24h
const FILINGS_CACHE = new MemoryCache('sec-filings', 6 * 60 * 60 * 1000); // 6h
const SEGMENTS_CACHE = new MemoryCache('sec-segments', 24 * 60 * 60 * 1000); // 24h
const CAPALLOC_CACHE = new MemoryCache('sec-capital-allocation', 12 * 60 * 60 * 1000); // 12h
const QUALITY_CACHE = new MemoryCache('sec-earnings-quality', 12 * 60 * 60 * 1000); // 12h
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

        let facts = FACTS_CACHE.get(ticker);
        let freshness = FRESHNESS.CACHED;
        
        if (!facts) {
            facts = await fetchCompanyFacts(ticker);
            if (!facts || Object.keys(facts).length === 0) {
                return res.status(404).json({ error: `Facts not found for ticker: ${ticker}` });
            }
            FACTS_CACHE.set(ticker, facts);
            freshness = FRESHNESS.REALTIME;
        }

        res.json(wrapWithProvenance(
            { ticker, facts },
            {
                provider: 'sec',
                timestamp: new Date().toISOString(),
                dataQuality: DATA_QUALITY.OFFICIAL,
                freshness,
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

        let filings = FILINGS_CACHE.get(ticker);
        let freshness = FRESHNESS.CACHED;
        
        if (!filings) {
            filings = await fetchCompanyFilings(ticker);
            if (!filings || filings.length === 0) {
                return res.status(404).json({ error: `Filings not found for ticker: ${ticker}` });
            }
            FILINGS_CACHE.set(ticker, filings);
            freshness = FRESHNESS.REALTIME;
        }

        res.json(wrapWithProvenance(
            { ticker, filings },
            {
                provider: 'sec',
                timestamp: new Date().toISOString(),
                dataQuality: DATA_QUALITY.OFFICIAL,
                freshness,
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

        let segments = SEGMENTS_CACHE.get(ticker);
        let freshness = FRESHNESS.CACHED;
        
        if (!segments) {
            segments = await fetchRevenueBySegment(ticker);
            if (!segments) {
                return res.status(404).json({ error: `Segment data not found for ticker: ${ticker}` });
            }
            SEGMENTS_CACHE.set(ticker, segments);
            freshness = FRESHNESS.REALTIME;
        }

        res.json(wrapWithProvenance(
            { ticker, segments },
            {
                provider: 'sec',
                timestamp: new Date().toISOString(),
                dataQuality: DATA_QUALITY.OFFICIAL,
                freshness,
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

        let allocation = CAPALLOC_CACHE.get(ticker);
        let freshness = FRESHNESS.CACHED;
        
        if (!allocation) {
            allocation = await fetchCapitalAllocation(ticker);
            if (!allocation) {
                return res.status(404).json({ error: `Capital allocation data not found for ticker: ${ticker}` });
            }
            CAPALLOC_CACHE.set(ticker, allocation);
            freshness = FRESHNESS.REALTIME;
        }

        res.json(wrapWithProvenance(
            { ticker, allocation },
            {
                provider: 'sec',
                timestamp: new Date().toISOString(),
                dataQuality: DATA_QUALITY.OFFICIAL,
                freshness,
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

        let quality = QUALITY_CACHE.get(ticker);
        let freshness = FRESHNESS.CACHED;
        
        if (!quality) {
            quality = await fetchEarningsQualityData(ticker);
            if (!quality) {
                return res.status(404).json({ error: `Earnings quality data not found for ticker: ${ticker}` });
            }
            QUALITY_CACHE.set(ticker, quality);
            freshness = FRESHNESS.REALTIME;
        }

        res.json(wrapWithProvenance(
            { ticker, quality },
            {
                provider: 'sec',
                timestamp: new Date().toISOString(),
                dataQuality: DATA_QUALITY.OFFICIAL,
                freshness,
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
    if (!timeSeries || !Array.isArray(timeSeries)) return null;
    // Attempt to find the matching period. Assumes timeSeries elements have end/period dates.
    const point = timeSeries.find(p => (p.end === periodDate) || (p.val !== undefined && p.end && p.end.startsWith(periodDate)));
    return point ? point.val : null;
}

/**
 * Helper function to compute changes between two values
 */
function computeChange(currentVal, previousVal) {
    if (currentVal === null || previousVal === null) return null;
    
    const change = currentVal - previousVal;
    let changePercent = null;
    if (previousVal !== 0) {
        changePercent = (change / Math.abs(previousVal)) * 100;
    }
    
    return {
        current: currentVal,
        previous: previousVal,
        change: change,
        changePercent: changePercent ? parseFloat(changePercent.toFixed(2)) : null,
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
        
        let diffData = DIFF_CACHE.get(cacheKey);
        let freshness = FRESHNESS.CACHED;
        
        if (!diffData) {
            // 1. Fetch filings to identify the last two periods
            let filings = FILINGS_CACHE.get(ticker);
            if (!filings) {
                filings = await fetchCompanyFilings(ticker);
            }
            
            if (!filings || !Array.isArray(filings)) {
                return res.status(404).json({ error: `Could not retrieve filings for ${ticker}` });
            }
            
            // Filter filings by requested type (10-Q or 10-K)
            const targetFilings = filings.filter(f => f.form === type);
            if (targetFilings.length < 2) {
                return res.status(404).json({ error: `Not enough ${type} filings found for ${ticker} to generate a diff.` });
            }
            
            // Assume filings are sorted newest first. Get the latest two.
            const currentFilingInfo = targetFilings[0];
            const previousFilingInfo = targetFilings[1];
            
            // 2. Fetch XBRL company facts
            let facts = FACTS_CACHE.get(ticker);
            if (!facts) {
                facts = await fetchCompanyFacts(ticker);
            }
            
            if (!facts || Object.keys(facts).length === 0) {
                return res.status(404).json({ error: `Facts not found for ${ticker}` });
            }

            // Extract time series for key metrics
            // (Assumes extractFinancialTimeSeries returns standard time series arrays)
            const metricsToExtract = [
                { key: 'revenue', name: 'Revenues' }, // Might need multiple mapping in real scenario
                { key: 'netIncome', name: 'NetIncomeLoss' },
                { key: 'assets', name: 'Assets' },
                { key: 'liabilities', name: 'Liabilities' },
                { key: 'cash', name: 'CashAndCashEquivalentsAtCarryingValue' },
                { key: 'debt', name: 'LongTermDebt' },
                { key: 'operatingCashFlow', name: 'NetCashProvidedByUsedInOperatingActivities' },
                { key: 'eps', name: 'EarningsPerShareBasic' }
            ];

            const extractedMetrics = {};
            metricsToExtract.forEach(m => {
                extractedMetrics[m.key] = extractFinancialTimeSeries(facts, m.name);
            });

            // 3. Compare key financial metrics
            const currentPeriod = currentFilingInfo.reportDate || currentFilingInfo.period || currentFilingInfo.filedDate; // Fallbacks based on data shape
            const previousPeriod = previousFilingInfo.reportDate || previousFilingInfo.period || previousFilingInfo.filedDate;

            const changes = {};
            metricsToExtract.forEach(m => {
                const currentVal = getMetricValue(extractedMetrics[m.key], currentPeriod);
                const previousVal = getMetricValue(extractedMetrics[m.key], previousPeriod);
                
                const metricChange = computeChange(currentVal, previousVal);
                if (metricChange) {
                    changes[m.key] = metricChange;
                }
            });

            // 4. Generate AI summary
            let aiSummary = null;
            if (Object.keys(changes).length > 0) {
                try {
                    const prompt = `You are a financial analyst. Analyze the following changes between the latest two ${type} SEC filings for ${ticker}. 
The data shows current value, previous value, change, percentage change, and direction for key metrics.
Data: ${JSON.stringify(changes, null, 2)}
Provide a brief 2-3 sentence summary of the overall financial trajectory, highlighting the most significant changes and key takeaways.`;
                    
                    aiSummary = await generateAiAnalysis(prompt);
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
