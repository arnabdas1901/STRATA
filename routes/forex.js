const express = require('express');
const router = express.Router();
const { fetchAlphaVantageForexDaily } = require('../utils/equityProviders');
const { getAiProvider, generateAiAnalysis } = require('../utils/aiProviders');

// ── Caches ─────────────────────────────────────────────────────────────────────
const LATEST_RATES_CACHE = { data: null, lastFetched: 0, ttlMs: 5 * 60 * 1000 };
const SEARCH_CACHE = {};
const SEARCH_CACHE_TTL = 10 * 60 * 1000;
const FOREX_ANALYSIS_CACHE = {};
const FOREX_ANALYSIS_TTL = 30 * 60 * 1000; // 30 minutes

router.get('/latest', async (req, res) => {
    const now = Date.now();
    if (LATEST_RATES_CACHE.data && now - LATEST_RATES_CACHE.lastFetched < LATEST_RATES_CACHE.ttlMs) {
        return res.json(LATEST_RATES_CACHE.data);
    }

    try {
        // Query last 5 days to safely get today's and yesterday's business rates
        const today = new Date();
        const start = new Date();
        start.setDate(today.getDate() - 5);
        const startStr = start.toISOString().split('T')[0];

        const response = await fetch(`https://api.frankfurter.app/${startStr}..?from=USD`);
        if (!response.ok) throw new Error('Frankfurter API error');
        const data = await response.json();

        const dates = Object.keys(data.rates).sort((a, b) => new Date(a) - new Date(b));
        if (dates.length < 2) throw new Error('Insufficient historical data for changes');

        const latestDate = dates[dates.length - 1];
        const prevDate = dates[dates.length - 2];

        const rates = data.rates[latestDate];
        const prevRates = data.rates[prevDate];

        const dailyChanges = {};
        for (const curr of Object.keys(rates)) {
            const currentVal = rates[curr];
            const prevVal = prevRates[curr];
            if (currentVal && prevVal) {
                const change = currentVal - prevVal;
                const pct = (change / prevVal) * 100;
                dailyChanges[curr] = {
                    rate: currentVal,
                    change: change,
                    changePercent: pct
                };
            }
        }

        const payload = {
            base: 'USD',
            date: latestDate,
            rates: rates,
            changes: dailyChanges
        };

        LATEST_RATES_CACHE.data = payload;
        LATEST_RATES_CACHE.lastFetched = now;
        res.json(payload);
    } catch (error) {
        console.error('Forex Latest Error:', error);
        if (LATEST_RATES_CACHE.data) {
            return res.json(LATEST_RATES_CACHE.data);
        }
        res.status(500).json({ error: 'Failed to fetch latest exchange rates' });
    }
});

router.get('/search', async (req, res) => {
    const { pair } = req.query; // format expected: "EUR/USD" or "EURUSD"
    const days = parseInt(req.query.days) || 365;
    if (!pair) return res.status(400).json({ error: 'Pair required' });

    let fromSymbol, toSymbol;
    if (pair.includes('/')) {
        [fromSymbol, toSymbol] = pair.toUpperCase().split('/');
    } else if (pair.length === 6) {
        fromSymbol = pair.substring(0, 3).toUpperCase();
        toSymbol = pair.substring(3, 6).toUpperCase();
    } else {
        return res.status(400).json({ error: 'Invalid pair format. Use XXX/YYY.' });
    }

    // Check cache including days parameter
    const cacheKey = `${fromSymbol}_${toSymbol}_${days}`;
    const now = Date.now();
    const cached = SEARCH_CACHE[cacheKey];
    if (cached && now - cached.lastFetched < SEARCH_CACHE_TTL) {
        return res.json(cached.data);
    }

    let payload = null;

    // Try Frankfurter First (Free, no API key needed)
    try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString().split('T')[0];

        const response = await fetch(`https://api.frankfurter.app/${startDateStr}..?from=${fromSymbol}&to=${toSymbol}`);
        if (!response.ok) throw new Error('Frankfurter historical API error');
        const data = await response.json();

        const dates = Object.keys(data.rates).sort((a, b) => new Date(a) - new Date(b));
        if (dates.length < 2) throw new Error('Insufficient Frankfurter data');

        const latestDate = dates[dates.length - 1];
        const previousDate = dates[dates.length - 2];
        const currentPrice = data.rates[latestDate][toSymbol];
        const previousPrice = data.rates[previousDate][toSymbol];
        const change = currentPrice - previousPrice;
        const changePercent = (change / previousPrice) * 100;

        const chartData = dates.map(date => ({
            time: new Date(date).getTime() / 1000,
            close: data.rates[date][toSymbol]
        }));

        payload = {
            price: currentPrice,
            change: change,
            changePercent: changePercent,
            chartData: chartData,
            provider: 'Frankfurter (ECB)'
        };
    } catch (fbError) {
        console.warn(`Frankfurter failed for ${fromSymbol}/${toSymbol}: ${fbError.message}. Falling back to Alpha Vantage.`);

        // Try Alpha Vantage Fallback — wrapped in try/catch to prevent unhandled crashes
        try {
            const avData = await fetchAlphaVantageForexDaily(fromSymbol, toSymbol);
            if (!avData.error) {
                payload = avData;
                payload.provider = 'Alpha Vantage';
                // If days requested is less than 365, slice the chartData accordingly
                if (payload.chartData && days < 365) {
                    const cutoffTime = (Date.now() - (days * 24 * 60 * 60 * 1000)) / 1000;
                    payload.chartData = payload.chartData.filter(d => d.time >= cutoffTime);
                }
            } else {
                console.error('Alpha Vantage Fallback Error:', avData.error);
            }
        } catch (avError) {
            console.error('Alpha Vantage Fallback Exception:', avError.message);
        }

        if (!payload) {
            return res.status(500).json({ error: `Failed to fetch data for ${fromSymbol}/${toSymbol}. This pair may not be supported by available providers.` });
        }
    }

    payload.fromSymbol = fromSymbol;
    payload.toSymbol = toSymbol;
    payload.description = null;

    // Cache successful results
    SEARCH_CACHE[cacheKey] = { data: payload, lastFetched: now };

    res.json(payload);
});

// On-demand AI macro analysis endpoint (with caching)
router.post('/analyze', async (req, res) => {
    try {
        const aiProvider = getAiProvider();
        if (!aiProvider) {
            return res.json({ analysis: 'AI Profile not available (No provider).' });
        }

        const { fromSymbol, toSymbol, price } = req.body;
        if (!fromSymbol || !toSymbol || !price) {
            return res.status(400).json({ error: 'Missing pair data' });
        }

        const cacheKey = `${fromSymbol}_${toSymbol}`;
        const now = Date.now();
        const cached = FOREX_ANALYSIS_CACHE[cacheKey];
        if (cached && now - cached.timestamp < FOREX_ANALYSIS_TTL) {
            return res.json({ analysis: cached.analysis });
        }

        const prompt = `You are a Chief FX Strategist. Write a professional, concise (3-4 sentences) macroeconomic analysis for the currency pair ${fromSymbol}/${toSymbol}. The current exchange rate is ${Number(price).toFixed(4)}.
Assess the general monetary policy divergence or economic drivers impacting this pair. Do not include conversational filler or disclaimers. Make it sound like a premium Bloomberg terminal insight.`;

        const aiResponse = await generateAiAnalysis(prompt);
        
        FOREX_ANALYSIS_CACHE[cacheKey] = {
            analysis: aiResponse.analysis,
            timestamp: now
        };

        res.json({ analysis: aiResponse.analysis });

    } catch (aiError) {
        console.error('Forex AI Analysis Error:', aiError);
        res.status(500).json({ error: 'Failed to generate AI macro profile.' });
    }
});

module.exports = router;
