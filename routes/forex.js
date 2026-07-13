const express = require('express');
const router = express.Router();
const { fetchAlphaVantageForexDaily } = require('../utils/equityProviders');
const { getAiProvider, generateAiAnalysis } = require('../utils/aiProviders');
const { normalizeForexPair } = require('../utils/api');

// ── Caches ─────────────────────────────────────────────────────────────────────
const LATEST_RATES_CACHE = { data: null, lastFetched: 0, ttlMs: 5 * 60 * 1000 };
const SEARCH_CACHE = {};
const SEARCH_CACHE_TTL = 10 * 60 * 1000;
const FOREX_ANALYSIS_CACHE = {};
const FOREX_ANALYSIS_TTL = 30 * 60 * 1000; // 30 minutes

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

setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of forexRateLimitStore) {
        if (now - record.windowStart > RATE_LIMIT_WINDOW * 2) {
            forexRateLimitStore.delete(ip);
        }
    }
}, RATE_LIMIT_WINDOW).unref();

function parseForexPair(pair) {
    const normalized = normalizeForexPair(pair);
    if (!normalized) return null;
    const [fromSymbol, toSymbol] = normalized.split('/');
    return { fromSymbol, toSymbol, pair: normalized };
}

router.get('/latest', async (req, res) => {
    const now = Date.now();
    if (LATEST_RATES_CACHE.data && now - LATEST_RATES_CACHE.lastFetched < LATEST_RATES_CACHE.ttlMs) {
        return res.json(LATEST_RATES_CACHE.data);
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

        for (const curr of Object.keys(rates)) {
            const currentVal = Number(rates[curr]);
            const prevVal = Number(prevRates[curr]);
            if (Number.isFinite(currentVal) && Number.isFinite(prevVal) && prevVal !== 0) {
                const change = currentVal - prevVal;
                dailyChanges[curr] = {
                    rate: currentVal,
                    change,
                    changePercent: (change / prevVal) * 100
                };
            }
        }

        const payload = {
            base: 'USD',
            date: latestDate,
            provider: 'Frankfurter (ECB)',
            rates,
            changes: dailyChanges,
            lastRefreshed: new Date().toISOString()
        };

        LATEST_RATES_CACHE.data = payload;
        LATEST_RATES_CACHE.lastFetched = now;
        return res.json(payload);
    } catch (error) {
        console.error('Forex Latest Error:', error);
        if (LATEST_RATES_CACHE.data) {
            return res.json(LATEST_RATES_CACHE.data);
        }
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
    const now = Date.now();
    const cached = SEARCH_CACHE[cacheKey];
    if (cached && now - cached.lastFetched < SEARCH_CACHE_TTL) {
        return res.json(cached.data);
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
        console.warn(`Frankfurter failed for ${fromSymbol}/${toSymbol}: ${fbError.message}. Falling back to Alpha Vantage.`);

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

    SEARCH_CACHE[cacheKey] = { data: payload, lastFetched: now };
    return res.json(payload);
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
        const now = Date.now();
        const cached = FOREX_ANALYSIS_CACHE[cacheKey];
        if (cached && now - cached.timestamp < FOREX_ANALYSIS_TTL) {
            return res.json({ analysis: cached.analysis, cached: true });
        }

        const prompt = `You are a Chief FX Strategist. Write a professional, concise (3-4 sentences) macroeconomic analysis for the currency pair ${fromSymbol}/${toSymbol}. The current exchange rate is ${Number(price).toFixed(4)}.
Assess the general monetary policy divergence or economic drivers impacting this pair. Do not include conversational filler or disclaimers. Make it sound like a premium Bloomberg terminal insight.`;

        const aiResponse = await generateAiAnalysis(prompt);
        FOREX_ANALYSIS_CACHE[cacheKey] = {
            analysis: aiResponse.analysis,
            timestamp: now
        };
        return res.json({ analysis: aiResponse.analysis });
    } catch (aiError) {
        console.error('Forex AI Analysis Error:', aiError);
        return res.status(500).json({ error: 'Failed to generate AI macro profile.' });
    }
});

module.exports = router;
