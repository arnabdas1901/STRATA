const express = require('express');
const router = express.Router();
const { getAllCacheStats } = require('../utils/cache.js');

let healthCache = null;
let healthCacheTime = 0;
const HEALTH_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

const lastSuccess = new Map();

router.get('/providers', async (req, res) => {
    try {
        const now = Date.now();
        if (healthCache && (now - healthCacheTime < HEALTH_CACHE_TTL)) {
            return res.json(healthCache);
        }

        const fetchWithTimeout = async (url, options = {}, timeoutMs = 5000) => {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const start = performance.now();
                const response = await fetch(url, { ...options, signal: controller.signal });
                const latency = Math.round(performance.now() - start);
                return { response, latency };
            } finally {
                clearTimeout(id);
            }
        };

        const checkProvider = async (name, configured, checkFn) => {
            if (!configured && name !== 'CoinGecko' && name !== 'SEC EDGAR' && name !== 'Frankfurter') {
                return {
                    name,
                    status: 'unconfigured',
                    latency: null,
                    lastSuccess: lastSuccess.get(name) || null,
                    configured: false
                };
            }

            try {
                const { latency, ok } = await checkFn();
                const status = ok ? 'ok' : 'error';
                if (ok) {
                    lastSuccess.set(name, new Date().toISOString());
                }
                
                return {
                    name,
                    status,
                    latency,
                    lastSuccess: lastSuccess.get(name) || null,
                    configured: true
                };
            } catch (err) {
                return {
                    name,
                    status: 'error',
                    latency: null,
                    lastSuccess: lastSuccess.get(name) || null,
                    configured: true
                };
            }
        };

        const checks = [
            checkProvider('Finnhub', !!process.env.FINNHUB_API_KEY, async () => {
                const res = await fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${process.env.FINNHUB_API_KEY}`);
                const data = await res.response.json();
                return { latency: res.latency, ok: res.response.ok && data.c !== undefined };
            }),
            checkProvider('Twelve Data', !!process.env.TWELVEDATA_API_KEY, async () => {
                const res = await fetchWithTimeout(`https://api.twelvedata.com/quote?symbol=AAPL&apikey=${process.env.TWELVEDATA_API_KEY}`);
                const data = await res.response.json();
                return { latency: res.latency, ok: res.response.ok && !!data.symbol };
            }),
            checkProvider('FMP', !!process.env.FMP_API_KEY, async () => {
                const res = await fetchWithTimeout(`https://financialmodelingprep.com/api/v3/quote/AAPL?apikey=${process.env.FMP_API_KEY}`);
                const data = await res.response.json();
                return { latency: res.latency, ok: res.response.ok && Array.isArray(data) };
            }),
            checkProvider('Alpha Vantage', !!process.env.ALPHAVANTAGE_API_KEY, async () => {
                const res = await fetchWithTimeout(`https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=AAPL&interval=1min&apikey=${process.env.ALPHAVANTAGE_API_KEY}`);
                const data = await res.response.json();
                return { latency: res.latency, ok: res.response.ok && !data['Error Message'] };
            }),
            checkProvider('CoinGecko', true, async () => {
                let url = 'https://api.coingecko.com/api/v3/ping';
                const options = {};
                // If API key is available, we could use it, but ping is mostly unauthenticated.
                if (process.env.COINGECKO_API_KEY) {
                    options.headers = { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY };
                }
                const res = await fetchWithTimeout(url, options);
                const data = await res.response.json();
                return { latency: res.latency, ok: res.response.ok && !!data.gecko_says };
            }),
            checkProvider('CoinMarketCap', !!process.env.COINMARKETCAP_API_KEY, async () => {
                const res = await fetchWithTimeout('https://pro-api.coinmarketcap.com/v1/cryptocurrency/map?limit=1', {
                    headers: { 'X-CMC_PRO_API_KEY': process.env.COINMARKETCAP_API_KEY }
                });
                const data = await res.response.json();
                return { latency: res.latency, ok: res.response.ok && !!data.data };
            }),
            checkProvider('FRED', !!process.env.FRED_API_KEY, async () => {
                const res = await fetchWithTimeout(`https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=${process.env.FRED_API_KEY}&file_type=json&limit=1&sort_order=desc`);
                const data = await res.response.json();
                return { latency: res.latency, ok: res.response.ok && Array.isArray(data.observations) };
            }),
            checkProvider('Groq', !!process.env.GROQ_API_KEY, async () => {
                const res = await fetchWithTimeout('https://api.groq.com/openai/v1/models', {
                    headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` }
                });
                const data = await res.response.json();
                return { latency: res.latency, ok: res.response.ok && Array.isArray(data.data) };
            }),
            checkProvider('Gemini', !!process.env.GEMINI_API_KEY, async () => {
                const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
                const data = await res.response.json();
                return { latency: res.latency, ok: res.response.ok && Array.isArray(data.models) };
            }),
            checkProvider('Polygon', !!process.env.POLYGON_API_KEY, async () => {
                const res = await fetchWithTimeout(`https://api.polygon.io/v2/aggs/ticker/AAPL/prev?adjusted=true&apiKey=${process.env.POLYGON_API_KEY}`);
                const data = await res.response.json();
                return { latency: res.latency, ok: res.response.ok && !!data.results };
            }),
            checkProvider('SEC EDGAR', true, async () => {
                const res = await fetchWithTimeout('https://data.sec.gov/submissions/CIK0000320193.json', {
                    headers: { 'User-Agent': 'STRATA/1.0 (strata-terminal@proton.me)' }
                });
                const data = await res.response.json();
                return { latency: res.latency, ok: res.response.ok && !!data.cik };
            }),
            checkProvider('Frankfurter', true, async () => {
                const res = await fetchWithTimeout('https://api.frankfurter.app/latest');
                const data = await res.response.json();
                return { latency: res.latency, ok: res.response.ok && !!data.rates };
            })
        ];

        const results = await Promise.allSettled(checks);
        
        const providers = results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);
        
        const configuredProviders = providers.filter(p => p.configured);
        const okCount = configuredProviders.filter(p => p.status === 'ok').length;
        const totalCount = configuredProviders.length;
        
        let overall = 'impaired';
        if (totalCount > 0) {
            const okRatio = okCount / totalCount;
            if (okRatio > 0.8) overall = 'operational';
            else if (okRatio > 0.5) overall = 'degraded';
        } else {
            overall = 'operational'; // default if nothing is configured
        }

        const responseData = {
            providers,
            overall,
            checkedAt: new Date().toISOString()
        };

        healthCache = responseData;
        healthCacheTime = now;

        res.json(responseData);
    } catch (error) {
        console.error('Error in health check:', error);
        res.status(500).json({ error: 'Internal server error checking providers health' });
    }
});

router.get('/cache-stats', (req, res) => {
    try {
        res.json({ caches: getAllCacheStats() });
    } catch (error) {
        console.error('Error fetching cache stats:', error);
        res.status(500).json({ error: 'Internal server error fetching cache stats' });
    }
});

module.exports = router;
