const express = require('express');
const router = express.Router();
const { fetchYahooChart, fetchTwelveDataQuote } = require('../utils/equityProviders');
const { getAiProvider, generateAiAnalysis } = require('../utils/aiProviders');

// ── Cache Configuration ────────────────────────────────────────────────────────
const YIELD_CACHE = {
    data: null,
    lastFetched: 0,
    ttlMs: 12 * 60 * 60 * 1000,
};

const SPREAD_HISTORY_CACHE = {
    data: null,
    lastFetched: 0,
    ttlMs: 24 * 60 * 60 * 1000,
};

const YIELD_ANALYSIS_CACHE = {};
const ANALYSIS_CACHE_TTL = 60 * 60 * 1000;

// ── Maturity Configurations ────────────────────────────────────────────────────
const MATURITIES = [
    { key: '3M', label: '3-Month', avMaturity: '3month', yahooTicker: '^IRX', tdSymbol: null, years: 0.25 },
    { key: '2Y', label: '2-Year', avMaturity: '2year', yahooTicker: null, tdSymbol: 'US2Y', years: 2 },
    { key: '5Y', label: '5-Year', avMaturity: '5year', yahooTicker: '^FVX', tdSymbol: null, years: 5 },
    { key: '10Y', label: '10-Year', avMaturity: '10year', yahooTicker: '^TNX', tdSymbol: null, years: 10 },
    { key: '30Y', label: '30-Year', avMaturity: '30year', yahooTicker: '^TYX', tdSymbol: null, years: 30 },
];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Helper: Fetch Treasury Yield from AlphaVantage (FRED) ──────────────────────
async function fetchAVTreasuryYield(maturity) {
    const apiKey = process.env.ALPHAVANTAGE_API_KEY;
    if (!apiKey) return { error: 'Missing Alpha Vantage API key' };

    try {
        const url = `https://www.alphavantage.co/query?function=TREASURY_YIELD&interval=daily&maturity=${maturity}&apikey=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data['Information'] || data['Note']) {
            return { error: data['Information'] || data['Note'] };
        }
        if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
            return { error: `No data for maturity ${maturity}` };
        }

        const latest = data.data.find(d => d.value && d.value !== '.');
        if (!latest) return { error: `No valid yield for ${maturity}` };

        // Previous trading day for daily change
        const latestIdx = data.data.indexOf(latest);
        const previousDay = data.data.slice(latestIdx + 1).find(d => d.value && d.value !== '.');
        const change = previousDay ? parseFloat(latest.value) - parseFloat(previousDay.value) : null;

        // 1 year ago for historical comparison
        let yieldOneYearAgo = null;
        let dateOneYearAgo = null;
        const latestDate = new Date(latest.date);
        for (const d of data.data) {
            if (!d.value || d.value === '.') continue;
            const daysDiff = (latestDate - new Date(d.date)) / (1000 * 60 * 60 * 24);
            if (daysDiff >= 350 && daysDiff <= 380) {
                yieldOneYearAgo = parseFloat(d.value);
                dateOneYearAgo = d.date;
                break;
            }
        }

        return {
            yield: parseFloat(latest.value),
            change,
            date: latest.date,
            yieldOneYearAgo,
            dateOneYearAgo,
            provider: 'AlphaVantage (FRED)',
        };
    } catch (err) {
        return { error: err.message };
    }
}

// ── Helper: Fetch AV Treasury Yield Time Series (for spread history) ───────────
async function fetchAVTreasuryTimeSeries(maturity) {
    const apiKey = process.env.ALPHAVANTAGE_API_KEY;
    if (!apiKey) return { error: 'Missing API key' };

    try {
        const url = `https://www.alphavantage.co/query?function=TREASURY_YIELD&interval=daily&maturity=${maturity}&apikey=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data['Information'] || data['Note']) return { error: data['Information'] || data['Note'] };
        if (!data.data || !Array.isArray(data.data)) return { error: 'Invalid response' };

        const series = data.data
            .filter(d => d.value && d.value !== '.')
            .slice(0, 400)
            .map(d => ({ date: d.date, value: parseFloat(d.value) }));

        return { series };
    } catch (err) {
        return { error: err.message };
    }
}

// ── Helper: Fetch Fed Funds Rate from AlphaVantage ─────────────────────────────
async function fetchFedFundsRate() {
    const apiKey = process.env.ALPHAVANTAGE_API_KEY;
    if (!apiKey) return { error: 'Missing API key' };

    try {
        const url = `https://www.alphavantage.co/query?function=FEDERAL_FUNDS_RATE&interval=daily&apikey=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data['Information'] || data['Note']) return { error: data['Information'] || data['Note'] };
        if (!data.data || !Array.isArray(data.data) || data.data.length === 0) return { error: 'No data' };

        const latest = data.data.find(d => d.value && d.value !== '.');
        if (!latest) return { error: 'No valid Fed Funds Rate data' };

        return { rate: parseFloat(latest.value), date: latest.date };
    } catch (err) {
        return { error: err.message };
    }
}

// ── Helper: Normalize Yahoo yield index value ──────────────────────────────────
function normalizeYahooYield(price) {
    if (price == null || isNaN(price)) return null;
    const val = Number(price);
    return val > 20 ? val / 10 : val;
}

// ── Helper: Fetch yield from Yahoo Finance ─────────────────────────────────────
async function fetchYahooYield(ticker) {
    if (!ticker) return { error: 'No Yahoo ticker configured' };
    try {
        const result = await fetchYahooChart(ticker, '5d', '1d');
        if (result.error) return { error: result.error };
        const yieldVal = normalizeYahooYield(result.price);
        if (yieldVal == null) return { error: 'Invalid Yahoo yield value' };

        // Normalize change same way as price
        let yieldChange = null;
        if (result.change != null) {
            yieldChange = result.price > 20 ? result.change / 10 : result.change;
        }

        return {
            yield: yieldVal,
            change: yieldChange,
            date: new Date().toISOString().split('T')[0],
            provider: 'Yahoo Finance',
        };
    } catch (err) {
        return { error: err.message };
    }
}

// ── Helper: Fetch yield from TwelveData ────────────────────────────────────────
async function fetchTDYield(symbol) {
    if (!symbol) return { error: 'No TwelveData symbol configured' };
    try {
        const result = await fetchTwelveDataQuote(symbol);
        if (result.error) return { error: result.error };
        const yieldVal = Number(result.price);
        if (isNaN(yieldVal)) return { error: 'Invalid TwelveData yield value' };
        return {
            yield: yieldVal,
            change: Number(result.change) || null,
            date: new Date().toISOString().split('T')[0],
            provider: 'TwelveData',
        };
    } catch (err) {
        return { error: err.message };
    }
}

// ── Core: Fetch single maturity with provider fallback chain ───────────────────
async function fetchYieldWithFallback(matConfig) {
    const failures = [];

    if (matConfig.yahooTicker) {
        const yahoo = await fetchYahooYield(matConfig.yahooTicker);
        if (!yahoo.error) return yahoo;
        failures.push(`Yahoo(${matConfig.yahooTicker}): ${yahoo.error}`);

        await delay(300);
        const av = await fetchAVTreasuryYield(matConfig.avMaturity);
        if (!av.error) return av;
        failures.push(`AV(${matConfig.avMaturity}): ${av.error}`);
    } else {
        const av = await fetchAVTreasuryYield(matConfig.avMaturity);
        if (!av.error) return av;
        failures.push(`AV(${matConfig.avMaturity}): ${av.error}`);

        if (matConfig.tdSymbol) {
            const td = await fetchTDYield(matConfig.tdSymbol);
            if (!td.error) return td;
            failures.push(`TD(${matConfig.tdSymbol}): ${td.error}`);
        }
    }

    console.warn(`All yield providers failed for ${matConfig.key}:`, failures);
    return { error: `All providers failed for ${matConfig.label}`, failures };
}

// ── Recession Risk Assessment ──────────────────────────────────────────────────
function assessRecessionRisk(spread10Y2Y, spread10Y3M) {
    if (spread10Y2Y < 0 && spread10Y3M < 0) {
        return { level: 'High', color: '#ef4444', icon: 'fa-triangle-exclamation', description: 'Both key spreads are inverted — historically a strong recession signal.' };
    }
    if (spread10Y2Y < 0 || spread10Y3M < 0) {
        return { level: 'Elevated', color: '#f59e0b', icon: 'fa-circle-exclamation', description: 'One key spread is inverted — monitor for sustained inversion.' };
    }
    if (spread10Y2Y < 0.5 || spread10Y3M < 0.5) {
        return { level: 'Moderate', color: '#f59e0b', icon: 'fa-gauge-high', description: 'Spreads are narrowing — curve is flattening, suggesting tightening conditions.' };
    }
    return { level: 'Low', color: '#10b981', icon: 'fa-shield-check', description: 'Yield curve is normally shaped — consistent with economic expansion.' };
}

// ── Route: GET / (/api/yields) ─────────────────────────────────────────────────
router.get('/', async (req, res) => {
    const now = Date.now();

    if (YIELD_CACHE.data && now - YIELD_CACHE.lastFetched < YIELD_CACHE.ttlMs) {
        return res.json(YIELD_CACHE.data);
    }

    try {
        // Fetch all maturities + Fed Funds Rate in parallel
        const [results, fedFunds] = await Promise.all([
            Promise.all(MATURITIES.map(mat => fetchYieldWithFallback(mat))),
            fetchFedFundsRate(),
        ]);

        const yields = {};
        const errors = [];
        MATURITIES.forEach((mat, i) => {
            if (results[i].error) {
                errors.push({ maturity: mat.key, error: results[i].error });
                yields[mat.key] = null;
            } else {
                yields[mat.key] = {
                    maturity: mat.key,
                    label: mat.label,
                    yield: results[i].yield,
                    change: results[i].change ?? null,
                    date: results[i].date,
                    yieldOneYearAgo: results[i].yieldOneYearAgo || null,
                    dateOneYearAgo: results[i].dateOneYearAgo || null,
                    provider: results[i].provider,
                };
            }
        });

        const y10 = yields['10Y']?.yield;
        const y2 = yields['2Y']?.yield;
        const y3m = yields['3M']?.yield;

        const spread10Y2Y = (y10 != null && y2 != null) ? parseFloat((y10 - y2).toFixed(3)) : null;
        const spread10Y3M = (y10 != null && y3m != null) ? parseFloat((y10 - y3m).toFixed(3)) : null;

        const recessionRisk = (spread10Y2Y != null && spread10Y3M != null)
            ? assessRecessionRisk(spread10Y2Y, spread10Y3M)
            : { level: 'Unknown', color: '#64748b', icon: 'fa-question', description: 'Insufficient data to assess recession risk.' };

        const payload = {
            yields,
            spreads: { '10Y2Y': spread10Y2Y, '10Y3M': spread10Y3M },
            recessionRisk,
            fedFundsRate: fedFunds.error ? null : fedFunds,
            errors: errors.length > 0 ? errors : undefined,
            fetchedAt: new Date().toISOString(),
        };

        YIELD_CACHE.data = payload;
        YIELD_CACHE.lastFetched = now;
        res.json(payload);
    } catch (error) {
        console.error('Yields route error:', error);
        if (YIELD_CACHE.data) return res.json(YIELD_CACHE.data);
        res.status(500).json({ error: 'Failed to fetch Treasury yields' });
    }
});

// ── Route: GET /spread-history ─────────────────────────────────────────────────
router.get('/spread-history', async (req, res) => {
    const now = Date.now();

    if (SPREAD_HISTORY_CACHE.data && now - SPREAD_HISTORY_CACHE.lastFetched < SPREAD_HISTORY_CACHE.ttlMs) {
        return res.json(SPREAD_HISTORY_CACHE.data);
    }

    try {
        await delay(500);
        const [data10Y, data2Y] = await Promise.all([
            fetchAVTreasuryTimeSeries('10year'),
            (async () => { await delay(1200); return fetchAVTreasuryTimeSeries('2year'); })(),
        ]);

        if (data10Y.error || data2Y.error) {
            return res.json({ error: 'Failed to fetch historical yield data', data: [] });
        }

        const map2Y = {};
        for (const d of data2Y.series) {
            map2Y[d.date] = d.value;
        }

        const spreadData = [];
        for (const d of data10Y.series) {
            if (map2Y[d.date] != null) {
                spreadData.push({
                    date: d.date,
                    spread: parseFloat((d.value - map2Y[d.date]).toFixed(3)),
                });
            }
        }

        const result = { data: spreadData.slice(0, 365) };
        SPREAD_HISTORY_CACHE.data = result;
        SPREAD_HISTORY_CACHE.lastFetched = now;
        res.json(result);
    } catch (error) {
        console.error('Spread history error:', error);
        if (SPREAD_HISTORY_CACHE.data) return res.json(SPREAD_HISTORY_CACHE.data);
        res.status(500).json({ error: 'Failed to compute spread history', data: [] });
    }
});

// ── Route: GET /analysis (/api/yields/analysis) ────────────────────────────────
router.get('/analysis', async (req, res) => {
    const { spread10y2y, spread10y3m, risk, y3m, y2y, y10y, y30y, fedrate } = req.query;

    const cacheKey = `${spread10y2y}_${spread10y3m}_${risk}`;
    const cached = YIELD_ANALYSIS_CACHE[cacheKey];
    if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL) {
        return res.json({ analysis: cached.analysis });
    }

    try {
        const aiProvider = getAiProvider();
        if (!aiProvider) {
            return res.json({ analysis: 'AI Provider not configured. Add an API key to enable yield curve insights.' });
        }

        const prompt = `You are a Senior Fixed Income Strategist at a top-tier investment bank. Write a professional, concise (3-4 sentences) analysis of the current US Treasury yield curve.

Current Data:
- 3-Month T-Bill Yield: ${y3m || 'N/A'}%
- 2-Year Note Yield: ${y2y || 'N/A'}%
- 10-Year Note Yield: ${y10y || 'N/A'}%
- 30-Year Bond Yield: ${y30y || 'N/A'}%
- 10Y-2Y Spread: ${spread10y2y || 'N/A'}%
- 10Y-3M Spread: ${spread10y3m || 'N/A'}%
- Federal Funds Rate: ${fedrate || 'N/A'}%
- Recession Risk Assessment: ${risk || 'N/A'}

Assess the curve shape (normal, flat, or inverted), what it implies for Fed policy direction (rate cuts/holds/hikes), and the outlook for economic growth. Sound like a premium Bloomberg terminal insight. No disclaimers.`;

        const { analysis } = await generateAiAnalysis(prompt);
        YIELD_ANALYSIS_CACHE[cacheKey] = { analysis, timestamp: Date.now() };
        res.json({ analysis });
    } catch (error) {
        console.error('Yield AI analysis error:', error.message);
        res.status(500).json({ error: 'Failed to generate yield curve analysis.' });
    }
});

module.exports = router;
