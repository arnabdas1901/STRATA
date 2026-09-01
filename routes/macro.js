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


const DEFAULT_FALLBACK_INDEXES = {
    sp500: {
        symbol: '^GSPC',
        displayName: 'S&P 500',
        price: 7686.14,
        change: -25.62,
        changePercent: -0.33,
        source: 'Estimated (Offline Cache)',
        requestedSymbol: '^GSPC',
        marketState: 'REGULAR',
    },
    nasdaq: {
        symbol: '^IXIC',
        displayName: 'NASDAQ Composite',
        price: 26370.89,
        change: -31.53,
        changePercent: -0.12,
        source: 'Estimated (Offline Cache)',
        requestedSymbol: '^IXIC',
        marketState: 'REGULAR',
    },
    dowjones: {
        symbol: '^DJI',
        displayName: 'Dow Jones',
        price: 53185.90,
        change: -374.10,
        changePercent: -0.70,
        source: 'Estimated (Offline Cache)',
        requestedSymbol: '^DJI',
        marketState: 'REGULAR',
    },
};

function isRealIndexQuote(result, min, max) {
    const price = Number(result?.price);
    return Number.isFinite(price) && price >= min && price <= max;
}

async function fetchRealIndexQuote(config) {
    const attempts = [
        // 1. Direct Index Quote from Yahoo Finance
        { source: 'Yahoo Finance', symbol: config.yahooSymbol, fetcher: () => fetchYahooIndexQuote(config.yahooSymbol), isEtf: false },
        // 2. Direct Index Quote from FMP
        { source: 'Financial Modeling Prep', symbol: config.fmpSymbol, fetcher: () => fetchFmpQuote(config.fmpSymbol), isEtf: false },
        // 3. Direct Index from TwelveData
        ...config.twelveDataSymbols.map((symbol) => ({
            source: 'TwelveData',
            symbol,
            fetcher: () => fetchTwelveDataQuote(symbol),
            isEtf: false,
        })),
        // 4. ETF Proxy via Finnhub
        ...(config.etfSymbol ? [{
            source: 'Finnhub',
            symbol: config.etfSymbol,
            fetcher: () => fetchFinnhubQuote(config.etfSymbol),
            isEtf: true,
        }] : []),
        // 5. ETF Proxy via TwelveData
        ...(config.etfSymbol ? [{
            source: 'TwelveData',
            symbol: config.etfSymbol,
            fetcher: () => fetchTwelveDataQuote(config.etfSymbol),
            isEtf: true,
        }] : []),
        // 6. ETF Proxy via Yahoo
        ...(config.etfSymbol ? [{
            source: 'Yahoo Finance',
            symbol: config.etfSymbol,
            fetcher: () => fetchYahooIndexQuote(config.etfSymbol),
            isEtf: true,
        }] : []),
    ];

    const failures = [];
    for (const attempt of attempts) {
        try {
            const quote = await attempt.fetcher();
            if (quote?.error) {
                failures.push(`${attempt.source} ${attempt.symbol}: ${quote.error}`);
                continue;
            }

            if (attempt.isEtf) {
                // Scale ETF price to approximate index level while keeping exact ETF change%
                const multiplier = config.etfMultiplier || 1;
                const rawPrice = Number(quote.price);
                const changePct = Number(quote.changePercent || 0);
                if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
                    failures.push(`${attempt.source} ${attempt.symbol}: invalid ETF price ${rawPrice}`);
                    continue;
                }
                const scaledPrice = rawPrice * multiplier;
                const scaledChange = Number(quote.change || 0) * multiplier;
                return {
                    price: scaledPrice,
                    change: scaledChange,
                    changePercent: changePct,
                    source: `${attempt.source} (${attempt.symbol} proxy)`,
                    requestedSymbol: attempt.symbol,
                    raw: quote.raw,
                };
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
        const [sp500Res, nasdaqRes, dowjonesRes] = await Promise.allSettled([
            fetchRealIndexQuote({
                displayName: 'S&P 500',
                yahooSymbol: '^GSPC',
                fmpSymbol: '^GSPC',
                twelveDataSymbols: ['SPX', '^GSPC'],
                etfSymbol: 'SPY',
                etfMultiplier: 10.02,
                min: 1000,
                max: 20000,
            }),
            fetchRealIndexQuote({
                displayName: 'NASDAQ Composite',
                yahooSymbol: '^IXIC',
                fmpSymbol: '^IXIC',
                twelveDataSymbols: ['IXIC', '^IXIC'],
                etfSymbol: 'QQQ',
                etfMultiplier: 36.8,
                min: 5000,
                max: 75000,
            }),
            fetchRealIndexQuote({
                displayName: 'Dow Jones',
                yahooSymbol: '^DJI',
                fmpSymbol: '^DJI',
                twelveDataSymbols: ['DJI', '^DJI'],
                etfSymbol: 'DIA',
                etfMultiplier: 100,
                min: 10000,
                max: 100000,
            }),
        ]);

        const sp500 = sp500Res.status === 'fulfilled' && !sp500Res.value?.error ? sp500Res.value : (INDEX_QUOTE_CACHE.data?.sp500 || DEFAULT_FALLBACK_INDEXES.sp500);
        const nasdaq = nasdaqRes.status === 'fulfilled' && !nasdaqRes.value?.error ? nasdaqRes.value : (INDEX_QUOTE_CACHE.data?.nasdaq || DEFAULT_FALLBACK_INDEXES.nasdaq);
        const dowjones = dowjonesRes.status === 'fulfilled' && !dowjonesRes.value?.error ? dowjonesRes.value : (INDEX_QUOTE_CACHE.data?.dowjones || DEFAULT_FALLBACK_INDEXES.dowjones);

        const payload = {
            sp500: {
                symbol: '^GSPC',
                displayName: 'S&P 500',
                price: Number(sp500.price),
                change: Number(sp500.change || 0),
                changePercent: Number(sp500.changePercent || 0),
                source: sp500.source || 'S&P 500',
                requestedSymbol: sp500.requestedSymbol || '^GSPC',
                marketState: sp500.raw?.marketState || sp500.marketState || 'REGULAR',
            },
            nasdaq: {
                symbol: '^IXIC',
                displayName: 'NASDAQ Composite',
                price: Number(nasdaq.price),
                change: Number(nasdaq.change || 0),
                changePercent: Number(nasdaq.changePercent || 0),
                source: nasdaq.source || 'NASDAQ',
                requestedSymbol: nasdaq.requestedSymbol || '^IXIC',
                marketState: nasdaq.raw?.marketState || nasdaq.marketState || 'REGULAR',
            },
            dowjones: {
                symbol: '^DJI',
                displayName: 'Dow Jones',
                price: Number(dowjones.price),
                change: Number(dowjones.change || 0),
                changePercent: Number(dowjones.changePercent || 0),
                source: dowjones.source || 'Dow Jones',
                requestedSymbol: dowjones.requestedSymbol || '^DJI',
                marketState: dowjones.raw?.marketState || dowjones.marketState || 'REGULAR',
            },
            fetchedAt: new Date().toISOString(),
        };

        INDEX_QUOTE_CACHE.data = payload;
        INDEX_QUOTE_CACHE.lastFetched = now;
        return res.json(payload);
    } catch (error) {
        console.error('Indices Error:', error);
        if (INDEX_QUOTE_CACHE.data) {
            return res.json(INDEX_QUOTE_CACHE.data);
        }
        return res.json({
            ...DEFAULT_FALLBACK_INDEXES,
            fetchedAt: new Date().toISOString(),
            _isFallback: true,
        });
    }
});

const MACRO_ANALYSIS_CACHE = {};
const MACRO_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

router.get('/analysis', async (req, res) => {
    const { country, cpi, rate, gdp, unemployment } = req.query;
    if (!country) return res.status(400).json({ error: 'Country required' });

    const cacheKey = `${country}_${cpi}_${rate}`;
    const cached = MACRO_ANALYSIS_CACHE[cacheKey];
    if (cached && Date.now() - cached.timestamp < MACRO_CACHE_TTL) {
        return res.json({ analysis: cached.analysis });
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
        MACRO_ANALYSIS_CACHE[cacheKey] = { analysis, timestamp: Date.now() };
        res.json({ analysis });
    } catch (error) {
        console.error('AI Macro Analysis Error:', error.message);
        res.status(500).json({ error: 'Failed to generate macro analysis.' });
    }
});

module.exports = router;
