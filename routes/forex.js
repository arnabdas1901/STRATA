const express = require('express');
const router = express.Router();
const { fetchAlphaVantageForexDaily } = require('../utils/equityProviders');
const { getAiProvider, generateAiAnalysis } = require('../utils/aiProviders');
const { normalizeForexPair } = require('../utils/api');
const { MemoryCache } = require('../utils/cache');
const { wrapWithProvenance, DATA_QUALITY, FRESHNESS } = require('../utils/provenance');

// ── Caches ─────────────────────────────────────────────────────────────────────
const latestRatesCache = new MemoryCache('forex-latest', 5 * 60 * 1000, 10);
const searchCache = new MemoryCache('forex-search', 10 * 60 * 1000, 100);
const analysisCache = new MemoryCache('forex-analysis', 30 * 60 * 1000, 100);

const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 10;
const forexRateLimitStore = new Map();

function checkForexRateLimit(ip) {
    const now = Date.now();
    const record = forexRateLimitStore.get(ip);
    if (!record || now - record.windowStart > RATE_LIMIT_WINDOW) {
        forexRateLimitStore.set(ip, { windowStart: now, count: 1 });
        return true;
    }
    record.count += 1;
    if (record.count > RATE_LIMIT_MAX) return false;
    return true;
}

const G8_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];

function computeG8CrossMatrix(usdRates) {
    const allRates = { USD: 1.0, ...usdRates };
    const matrix = {};
    for (const base of G8_CURRENCIES) {
        matrix[base] = {};
        for (const quote of G8_CURRENCIES) {
            if (base === quote) {
                matrix[base][quote] = 1.0;
            } else {
                const crossRate = (allRates[quote] && allRates[base]) ? (allRates[quote] / allRates[base]) : null;
                matrix[base][quote] = crossRate != null ? Number(crossRate.toFixed(4)) : null;
            }
        }
    }
    return matrix;
}

function computeG8StrengthRanking(dailyChanges) {
    const scores = [];
    for (const c of G8_CURRENCIES) {
        if (c === 'USD') continue;
        const change = dailyChanges[c]?.changePercent || 0;
        // In Frankfurter, rate is USD -> C. If rate increased, C weakened against USD (-change).
        scores.push({ currency: c, score: Number((-change).toFixed(2)) });
    }
    const avgUsdGain = scores.reduce((sum, s) => sum - s.score, 0) / (scores.length || 1);
    scores.push({ currency: 'USD', score: Number(avgUsdGain.toFixed(2)) });
    scores.sort((a, b) => b.score - a.score);
    return scores;
}

function computeForexVolAndZScore(series) {
    if (!Array.isArray(series) || series.length < 3) {
        return { volatility7dPct: null, zScore: null };
    }
    const n = series.length;
    // Log returns
    const logReturns = [];
    for (let i = 1; i < n; i++) {
        if (series[i] > 0 && series[i - 1] > 0) {
            logReturns.push(Math.log(series[i] / series[i - 1]));
        }
    }
    if (logReturns.length < 2) {
        return { volatility7dPct: null, zScore: null };
    }
    const meanReturn = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
    const varReturn = logReturns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / (logReturns.length - 1);
    const volatility7dPct = Number((Math.sqrt(varReturn) * Math.sqrt(252) * 100).toFixed(2));

    // Price Z-Score over the window
    const meanPrice = series.reduce((a, b) => a + b, 0) / n;
    const varPrice = series.reduce((a, b) => a + Math.pow(b - meanPrice, 2), 0) / (n - 1);
    const stdPrice = Math.sqrt(varPrice);
    const latestPrice = series[n - 1];
    const zScore = stdPrice > 0 ? Number(((latestPrice - meanPrice) / stdPrice).toFixed(2)) : 0;

    return { volatility7dPct, zScore };
}

function parseForexPair(pair) {
    const normalized = normalizeForexPair(pair);
    if (!normalized) return null;
    const [fromSymbol, toSymbol] = normalized.split('/');
    return { fromSymbol, toSymbol, pair: normalized };
}

router.get('/latest', async (req, res) => {
    const cached = latestRatesCache.getData('latest');
    if (cached) {
        return res.json(wrapWithProvenance(cached, {
            provider: 'Frankfurter (ECB)',
            freshness: FRESHNESS.CACHED,
            dataQuality: DATA_QUALITY.OFFICIAL,
            endpoint: 'forex_latest'
        }));
    }

    try {
        const today = new Date();
        const start = new Date();
        start.setDate(today.getDate() - 8);
        const startStr = start.toISOString().split('T')[0];

        const response = await fetch(`https://api.frankfurter.app/${startStr}..?from=USD`);
        if (!response.ok) throw new Error('Frankfurter API error');

        const data = await response.json();
        if (!data || !data.rates || typeof data.rates !== 'object') {
            throw new Error('Invalid Frankfurter latest response');
        }

        const dates = Object.keys(data.rates).sort((a, b) => new Date(a) - new Date(b));
        if (dates.length < 2) throw new Error('Insufficient historical data for changes');

        const latestDate = dates[dates.length - 1];
        const prevDate = dates[dates.length - 2];

        const rates = data.rates[latestDate] || {};
        const prevRates = data.rates[prevDate] || {};
        const dailyChanges = {};
        const sparklineData = {};

        for (const curr of Object.keys(rates)) {
            const currentVal = Number(rates[curr]);
            const prevVal = Number(prevRates[curr]);
            
            const series = dates
                .map(d => Number(data.rates[d]?.[curr]))
                .filter(v => Number.isFinite(v));
            sparklineData[curr] = series;

            const { volatility7dPct, zScore } = computeForexVolAndZScore(series);

            if (Number.isFinite(currentVal) && Number.isFinite(prevVal) && prevVal !== 0) {
                const change = currentVal - prevVal;
                dailyChanges[curr] = {
                    rate: currentVal,
                    change,
                    changePercent: (change / prevVal) * 100,
                    volatility7dPct,
                    zScore
                };
            }
        }

        // Derive G8 Cross Matrix and Relative Currency Strength
        const crossMatrix = computeG8CrossMatrix(rates);
        const strengthRanking = computeG8StrengthRanking(dailyChanges);

        const payload = {
            base: 'USD',
            date: latestDate,
            provider: 'Frankfurter (ECB)',
            rates,
            changes: dailyChanges,
            sparklines: sparklineData,
            crossMatrix,
            strengthRanking,
            g8Currencies: G8_CURRENCIES,
            lastRefreshed: new Date().toISOString()
        };

        latestRatesCache.set('latest', payload);
        return res.json(wrapWithProvenance(payload, {
            provider: 'Frankfurter (ECB)',
            freshness: FRESHNESS.LIVE,
            dataQuality: DATA_QUALITY.OFFICIAL,
            endpoint: 'forex_latest'
        }));
    } catch (error) {
        console.error('Forex Latest Error:', error);
        return res.status(500).json({ error: 'Failed to fetch latest exchange rates' });
    }
});

router.get('/search', async (req, res) => {
    const { pair } = req.query;
    const days = Math.min(365, Math.max(7, parseInt(req.query.days, 10) || 365));
    const parsed = parseForexPair(pair);
    if (!parsed) {
        return res.status(400).json({ error: 'Invalid pair format. Use XXX/YYY or XXXYYY.' });
    }

    const { fromSymbol, toSymbol, pair: normalizedPair } = parsed;
    const cacheKey = `${fromSymbol}_${toSymbol}_${days}`;
    
    const cached = searchCache.getData(cacheKey);
    if (cached) {
        return res.json(wrapWithProvenance(cached, {
            provider: 'Frankfurter (ECB)',
            freshness: FRESHNESS.CACHED,
            dataQuality: DATA_QUALITY.OFFICIAL,
            endpoint: 'forex_search'
        }));
    }

    let payload = null;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    try {
        const response = await fetch(`https://api.frankfurter.app/${startDateStr}..?from=${fromSymbol}&to=${toSymbol}`);
        if (!response.ok) throw new Error('Frankfurter historical API error');
        const data = await response.json();

        if (!data || !data.rates || !Array.isArray(Object.keys(data.rates))) {
            throw new Error('Invalid Frankfurter historical response');
        }

        const dates = Object.keys(data.rates).sort((a, b) => new Date(a) - new Date(b));
        if (dates.length < 2) throw new Error('Insufficient Frankfurter data');

        const latestDate = dates[dates.length - 1];
        const previousDate = dates[dates.length - 2];
        const currentPrice = Number(data.rates[latestDate]?.[toSymbol]);
        const previousPrice = Number(data.rates[previousDate]?.[toSymbol]);

        if (!Number.isFinite(currentPrice) || !Number.isFinite(previousPrice) || previousPrice === 0) {
            throw new Error('Frankfurter historical quote unavailable for requested pair');
        }

        const change = currentPrice - previousPrice;
        const changePercent = (change / previousPrice) * 100;
        const chartData = dates.map((date) => ({
            time: new Date(date).getTime() / 1000,
            close: Number(data.rates[date]?.[toSymbol])
        })).filter((point) => Number.isFinite(point.close));

        payload = {
            price: currentPrice,
            change,
            changePercent,
            chartData,
            provider: 'Frankfurter (ECB)',
            pair: normalizedPair,
            fromSymbol,
            toSymbol,
            lastUpdated: latestDate
        };
    } catch (fbError) {
        console.warn(`Frankfurter failed for ${fromSymbol}/${toSymbol}: ${fbError.message}. Trying Polygon.io.`);

        // 1. Fallback: Polygon.io
        if (process.env.POLYGON_API_KEY && !payload) {
            try {
                const endDateStr = new Date().toISOString().split('T')[0];
                const ticker = `C:${fromSymbol}${toSymbol}`;
                const polyUrl = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${startDateStr}/${endDateStr}?adjusted=true&sort=asc&apiKey=${process.env.POLYGON_API_KEY}`;
                
                const polyRes = await fetch(polyUrl);
                const polyData = await polyRes.json();

                if ((polyData.status === 'OK' || polyData.status === 'DELAYED') && polyData.results && polyData.results.length > 1) {
                    const results = polyData.results;
                    const latest = results[results.length - 1];
                    const prev = results[results.length - 2];
                    const currentPrice = latest.c;
                    const previousPrice = prev.c;
                    const change = currentPrice - previousPrice;
                    const changePercent = (change / previousPrice) * 100;

                    const chartData = results.map(r => ({
                        time: r.t / 1000,
                        close: r.c
                    }));

                    payload = {
                        price: currentPrice,
                        change,
                        changePercent,
                        chartData,
                        provider: 'Polygon.io',
                        pair: normalizedPair,
                        fromSymbol,
                        toSymbol,
                        lastUpdated: endDateStr
                    };
                }
            } catch (polyErr) {
                console.warn(`Polygon.io fallback failed for ${normalizedPair}:`, polyErr.message);
            }
        }

        // 2. Fallback: Alpha Vantage
        if (!payload) {
            try {
                const avData = await fetchAlphaVantageForexDaily(fromSymbol, toSymbol);
                if (avData && !avData.error) {
                    payload = {
                        ...avData,
                        provider: 'Alpha Vantage',
                        pair: normalizedPair,
                        fromSymbol,
                        toSymbol
                    };
                    if (payload.chartData && days < 365) {
                        const cutoffTime = (Date.now() - days * 24 * 60 * 60 * 1000) / 1000;
                        payload.chartData = payload.chartData.filter((d) => d.time >= cutoffTime);
                    }
                } else {
                    throw new Error(avData?.error || 'Alpha Vantage returned no valid data');
                }
            } catch (avError) {
                console.error('Alpha Vantage Fallback Exception:', avError.message || avError);
                return res.status(500).json({ error: `Failed to fetch data for ${normalizedPair}. This pair may not be supported by available providers.` });
            }
        }
    }

    searchCache.set(cacheKey, payload);
    return res.json(wrapWithProvenance(payload, {
        provider: payload.provider || 'Frankfurter',
        freshness: FRESHNESS.LIVE,
        dataQuality: DATA_QUALITY.OFFICIAL,
        endpoint: 'forex_search'
    }));
});

// On-demand AI macro analysis endpoint (with caching)
router.post('/analyze', async (req, res) => {
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    if (!checkForexRateLimit(clientIp)) {
        return res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' });
    }

    try {
        const aiProvider = getAiProvider();
        if (!aiProvider) {
            return res.status(503).json({ error: 'AI Profile not available (No provider).' });
        }

        const { fromSymbol, toSymbol, price } = req.body;
        if (!fromSymbol || !toSymbol || !price) {
            return res.status(400).json({ error: 'Missing pair data' });
        }

        const cacheKey = `${fromSymbol}_${toSymbol}`;
        const cached = analysisCache.getData(cacheKey);
        if (cached) {
            return res.json({ analysis: cached, cached: true });
        }

        const prompt = `You are a Chief FX Strategist. Write a professional, concise (3-4 sentences) macroeconomic analysis for the currency pair ${fromSymbol}/${toSymbol}. The current exchange rate is ${Number(price).toFixed(4)}.
Assess the general monetary policy divergence or economic drivers impacting this pair. Do not include conversational filler or disclaimers. Make it sound like a premium Bloomberg terminal insight.`;

        const aiResponse = await generateAiAnalysis(prompt);
        const analysis = typeof aiResponse === 'string' ? aiResponse : (aiResponse.analysis || '');
        analysisCache.set(cacheKey, analysis);
        return res.json({ analysis });
    } catch (aiError) {
        console.error('Forex AI Analysis Error:', aiError);
        return res.status(500).json({ error: 'Failed to generate AI macro profile.' });
    }
});

module.exports = router;
