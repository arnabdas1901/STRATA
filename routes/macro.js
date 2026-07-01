const express = require('express');
const router = express.Router();
const { requireTicker } = require('../utils/api');
const { fetchYahooIndexQuote, fetchFmpQuote, fetchTwelveDataQuote, fetchFinnhubQuote } = require('../utils/equityProviders');
const { getAiProvider, generateAiAnalysis } = require('../utils/aiProviders');

const INDEX_QUOTE_CACHE = {
    lastFetched: 0,
    ttlMs: 60 * 1000,
    data: null,
};


function isRealIndexQuote(result, min, max) {
    const price = Number(result?.price);
    return Number.isFinite(price) && price >= min && price <= max;
}

async function fetchRealIndexQuote(config) {
    const attempts = [
        { source: 'Yahoo Finance', symbol: config.yahooSymbol, fetcher: () => fetchYahooIndexQuote(config.yahooSymbol) },
        { source: 'Financial Modeling Prep', symbol: config.fmpSymbol, fetcher: () => fetchFmpQuote(config.fmpSymbol) },
        ...config.twelveDataSymbols.map((symbol) => ({
            source: 'TwelveData',
            symbol,
            fetcher: () => fetchTwelveDataQuote(symbol),
        })),
        { source: 'Finnhub', symbol: config.finnhubSymbol, fetcher: () => fetchFinnhubQuote(config.finnhubSymbol) },
    ];

    const failures = [];
    for (const attempt of attempts) {
        try {
            const quote = await attempt.fetcher();
            if (quote?.error) {
                failures.push(`${attempt.source} ${attempt.symbol}: ${quote.error}`);
                continue;
            }
            if (!isRealIndexQuote(quote, config.min, config.max)) {
                failures.push(`${attempt.source} ${attempt.symbol}: rejected price ${quote?.price}`);
                continue;
            }
            return {
                ...quote,
                source: attempt.source,
                requestedSymbol: attempt.symbol,
            };
        } catch (error) {
            failures.push(`${attempt.source} ${attempt.symbol}: ${error.message}`);
        }
    }

    return { error: `No valid ${config.displayName} index quote found`, failures };
}

router.get('/indices', async (req, res) => {
    const now = Date.now();
    if (INDEX_QUOTE_CACHE.data && now - INDEX_QUOTE_CACHE.lastFetched < INDEX_QUOTE_CACHE.ttlMs) {
        return res.json(INDEX_QUOTE_CACHE.data);
    }

    try {
        const [sp500, nasdaq, dowjones] = await Promise.all([
            fetchRealIndexQuote({
                displayName: 'S&P 500',
                yahooSymbol: '^GSPC',
                fmpSymbol: '^GSPC',
                twelveDataSymbols: ['SPX', '^GSPC'],
                finnhubSymbol: '^GSPC',
                min: 1000,
                max: 20000,
            }),
            fetchRealIndexQuote({
                displayName: 'NASDAQ Composite',
                yahooSymbol: '^IXIC',
                fmpSymbol: '^IXIC',
                twelveDataSymbols: ['IXIC', '^IXIC'],
                finnhubSymbol: '^IXIC',
                min: 5000,
                max: 75000,
            }),
            fetchRealIndexQuote({
                displayName: 'Dow Jones',
                yahooSymbol: '^DJI',
                fmpSymbol: '^DJI',
                twelveDataSymbols: ['DJI', '^DJI'],
                finnhubSymbol: '^DJI',
                min: 10000,
                max: 100000,
            }),
        ]);

        if (!sp500 || sp500.error || !nasdaq || nasdaq.error || !dowjones || dowjones.error) {
            console.error('Index fetch failed', { sp500, nasdaq, dowjones });
            if (INDEX_QUOTE_CACHE.data) {
                return res.json(INDEX_QUOTE_CACHE.data);
            }
            return res.status(500).json({ error: 'Index quotes cannot be retrieved with current provider access' });
        }

        const payload = {
            sp500: {
                symbol: '^GSPC',
                displayName: 'S&P 500',
                price: sp500.price,
                change: sp500.change,
                changePercent: sp500.changePercent,
                source: sp500.source,
                requestedSymbol: sp500.requestedSymbol,
                marketState: sp500.raw?.marketState,
            },
            nasdaq: {
                symbol: '^IXIC',
                displayName: 'NASDAQ Composite',
                price: nasdaq.price,
                change: nasdaq.change,
                changePercent: nasdaq.changePercent,
                source: nasdaq.source,
                requestedSymbol: nasdaq.requestedSymbol,
                marketState: nasdaq.raw?.marketState,
            },
            dowjones: {
                symbol: '^DJI',
                displayName: 'Dow Jones',
                price: dowjones.price,
                change: dowjones.change,
                changePercent: dowjones.changePercent,
                source: dowjones.source,
                requestedSymbol: dowjones.requestedSymbol,
                marketState: dowjones.raw?.marketState,
            },
            fetchedAt: new Date().toISOString(),
        };

        INDEX_QUOTE_CACHE.data = payload;
        INDEX_QUOTE_CACHE.lastFetched = now;
        res.json(payload);
    } catch (error) {
        console.error('Indices Error:', error);
        if (INDEX_QUOTE_CACHE.data) {
            return res.json(INDEX_QUOTE_CACHE.data);
        }
        res.status(500).json({ error: 'Failed to fetch live index values' });
    }
});

const MACRO_ANALYSIS_CACHE = {};

router.get('/analysis', async (req, res) => {
    const { country, cpi, rate, gdp, unemployment } = req.query;
    if (!country) return res.status(400).json({ error: 'Country required' });

    const cacheKey = `${country}_${cpi}_${rate}`;
    if (MACRO_ANALYSIS_CACHE[cacheKey]) {
        return res.json({ analysis: MACRO_ANALYSIS_CACHE[cacheKey] });
    }

    try {
        const aiProvider = getAiProvider();
        if (!aiProvider) {
             return res.json({ analysis: 'AI Provider not configured. Add an API key to enable premium macroeconomic insights.' });
        }

        const prompt = `You are a Chief Economist at a top-tier investment bank. Write a professional, concise (3-4 sentences) macroeconomic monetary policy analysis for ${country}.
Current Data Context: 
- Headline CPI Inflation: ${cpi}% 
- Central Bank Interest Rate: ${rate}%
- GDP Growth: ${gdp || 'N/A'}%
- Unemployment: ${unemployment || 'N/A'}%

Assess their central bank's current stance (Hawkish, Dovish, or Neutral) and the general economic health based on this data. Do not include disclaimers or conversational filler. Make it sound like a premium Bloomberg terminal insight.`;

        const { analysis } = await generateAiAnalysis(prompt);
        MACRO_ANALYSIS_CACHE[cacheKey] = analysis;
        res.json({ analysis });
    } catch (error) {
        console.error('AI Macro Analysis Error:', error.message);
        res.status(500).json({ error: 'Failed to generate macro analysis.' });
    }
});

module.exports = router;
