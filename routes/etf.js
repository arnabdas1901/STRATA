const express = require('express');
const router = express.Router();
const { normalizeTicker, fetchJson } = require('../utils/api');
const { MemoryCache } = require('../utils/cache');
const { wrapWithProvenance, DATA_QUALITY } = require('../utils/provenance');
const { fetchYahooChart, fetchYahooIndexQuote } = require('../utils/equityProviders');

const cache = new MemoryCache(43200); // 12 hours cache in seconds

router.get('/profile/:ticker', async (req, res) => {
    try {
        const rawTicker = req.params.ticker;
        if (!rawTicker) {
            return res.status(400).json({ error: 'Ticker is required' });
        }
        
        const ticker = normalizeTicker(rawTicker);
        const cacheKey = `etf_profile_${ticker}`;
        
        const cached = cache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const FMP_KEY = process.env.FMP_API_KEY;
        let profileData = null;
        let sources = [];
        
        try {
            if (!FMP_KEY) throw new Error('FMP key not available');
            
            const [holdingsReq, quoteReq, sectorReq] = await Promise.all([
                fetchJson(`https://financialmodelingprep.com/api/v3/etf-holder/${ticker}?apikey=${FMP_KEY}`),
                fetchJson(`https://financialmodelingprep.com/api/v3/quote/${ticker}?apikey=${FMP_KEY}`),
                fetchJson(`https://financialmodelingprep.com/api/v3/etf-sector-weightings/${ticker}?apikey=${FMP_KEY}`)
            ]);

            const quote = quoteReq?.[0] || {};
            
            profileData = {
                ticker,
                name: quote.name || ticker,
                price: quote.price || 0,
                change: quote.change || 0,
                changePercent: quote.changesPercentage || 0,
                holdings: Array.isArray(holdingsReq) ? holdingsReq.map(h => ({
                    asset: h.asset,
                    name: h.name,
                    weight: h.weightPercentage || 0
                })) : [],
                sectorWeights: Array.isArray(sectorReq) ? sectorReq.map(s => ({
                    sector: s.sector,
                    weight: parseFloat(s.weightPercentage || 0)
                })) : [],
                totalHoldings: Array.isArray(holdingsReq) ? holdingsReq.length : 0
            };
            sources.push({ provider: 'Financial Modeling Prep', type: 'etf-data' });
        } catch (error) {
            console.warn(`FMP API fallback for ETF ${ticker}:`, error.message);
            // Fallback to Yahoo
            const quote = await fetchYahooIndexQuote(ticker).catch(() => null);
            if (!quote) {
                return res.status(404).json({ error: 'ETF not found or data unavailable' });
            }
            profileData = {
                ticker,
                name: quote.shortName || ticker,
                price: quote.regularMarketPrice || 0,
                change: quote.regularMarketChange || 0,
                changePercent: quote.regularMarketChangePercent || 0,
                holdings: [],
                sectorWeights: [],
                totalHoldings: 0
            };
            sources.push({ provider: 'Yahoo Finance', type: 'market-data' });
        }
        
        const responseData = wrapWithProvenance(
            profileData,
            'etf-profile',
            DATA_QUALITY.DELAYED,
            sources
        );
        
        cache.set(cacheKey, responseData);
        res.json(responseData);
        
    } catch (error) {
        console.error('ETF Profile Error:', error);
        res.status(500).json({ error: 'Failed to fetch ETF profile' });
    }
});

router.get('/overlap', async (req, res) => {
    try {
        const { a, b } = req.query;
        if (!a || !b) {
            return res.status(400).json({ error: 'Parameters a and b (ETF tickers) are required' });
        }
        
        const etfA = normalizeTicker(a);
        const etfB = normalizeTicker(b);
        const cacheKey = `etf_overlap_${etfA}_${etfB}`;
        
        const cached = cache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const FMP_KEY = process.env.FMP_API_KEY;
        if (!FMP_KEY) {
            return res.status(503).json({ error: 'FMP API key is required for ETF overlap analysis' });
        }
        
        const [holdingsA, holdingsB] = await Promise.all([
            fetchJson(`https://financialmodelingprep.com/api/v3/etf-holder/${etfA}?apikey=${FMP_KEY}`).catch(() => []),
            fetchJson(`https://financialmodelingprep.com/api/v3/etf-holder/${etfB}?apikey=${FMP_KEY}`).catch(() => [])
        ]);
        
        const mapA = new Map((Array.isArray(holdingsA) ? holdingsA : []).map(h => [h.asset, h.weightPercentage || 0]));
        const mapB = new Map((Array.isArray(holdingsB) ? holdingsB : []).map(h => [h.asset, h.weightPercentage || 0]));
        
        const commonHoldings = [];
        let overlapByWeight = 0;
        let uniqueToA = 0;
        let uniqueToB = 0;
        
        for (const [asset, weightA] of mapA.entries()) {
            if (mapB.has(asset)) {
                const weightB = mapB.get(asset);
                commonHoldings.push({ asset, weightA, weightB });
                overlapByWeight += Math.min(weightA, weightB);
            } else {
                uniqueToA++;
            }
        }
        
        for (const asset of mapB.keys()) {
            if (!mapA.has(asset)) {
                uniqueToB++;
            }
        }
        
        const totalDistinct = commonHoldings.length + uniqueToA + uniqueToB;
        const overlapPercent = totalDistinct > 0 ? (commonHoldings.length / totalDistinct) * 100 : 0;
        
        commonHoldings.sort((x, y) => (y.weightA + y.weightB) - (x.weightA + x.weightB));
        
        const overlapData = {
            etfA,
            etfB,
            overlapCount: commonHoldings.length,
            overlapPercent: parseFloat(overlapPercent.toFixed(2)),
            overlapByWeight: parseFloat(overlapByWeight.toFixed(2)),
            commonHoldings: commonHoldings.slice(0, 50), // Limit payload size
            uniqueToA,
            uniqueToB
        };
        
        const responseData = wrapWithProvenance(
            overlapData,
            'etf-overlap',
            DATA_QUALITY.DELAYED,
            [{ provider: 'Financial Modeling Prep', type: 'etf-holdings' }]
        );
        
        cache.set(cacheKey, responseData);
        // Bidirectional caching
        cache.set(`etf_overlap_${etfB}_${etfA}`, wrapWithProvenance(
            {
                ...overlapData,
                etfA: etfB,
                etfB: etfA,
                uniqueToA: uniqueToB,
                uniqueToB: uniqueToA,
                commonHoldings: commonHoldings.map(h => ({ asset: h.asset, weightA: h.weightB, weightB: h.weightA }))
            },
            'etf-overlap',
            DATA_QUALITY.DELAYED,
            [{ provider: 'Financial Modeling Prep', type: 'etf-holdings' }]
        ));
        
        res.json(responseData);
        
    } catch (error) {
        console.error('ETF Overlap Error:', error);
        res.status(500).json({ error: 'Failed to calculate ETF overlap' });
    }
});

module.exports = router;
