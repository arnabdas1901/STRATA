require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

if (!process.execArgv.includes('--use-system-ca')) {
    console.warn(
        '⚠️  Outbound API calls may fail on Windows. Start with: npm start  (uses --use-system-ca)'
    );
}

const app = express();

const DEFAULT_ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
];
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            return callback(null, true);
        }
        const error = new Error('CORS origin not allowed');
        error.statusCode = 403;
        return callback(error);
    },
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function normalizeTicker(value) {
    const ticker = String(value || '').trim().toUpperCase();
    return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) ? ticker : null;
}

function normalizeCryptoQuery(value) {
    const query = String(value || '').trim();
    return /^[A-Za-z0-9 ._-]{1,64}$/.test(query) ? query : null;
}

function requireTicker(req, res) {
    const symbol = normalizeTicker(req.query.symbol ?? req.body?.ticker ?? req.body?.symbol);
    if (!symbol) {
        res.status(400).json({ error: 'Valid ticker symbol is required' });
        return null;
    }
    return symbol;
}

// ==========================================
// 1. FINNHUB ENDPOINTS (Profile & Quotes)
// ==========================================

// Company Profile Endpoint
app.get('/api/finnhub/profile', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;

    try {
        const response = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_API_KEY}`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("Finnhub Profile Error:", error);
        res.status(500).json({ error: "Failed to fetch company profile" });
    }
});

// Key Financial Metrics Endpoint
app.get('/api/finnhub/metrics', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;

    try {
        const response = await fetch(
            `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${process.env.FINNHUB_API_KEY}`
        );
        const data = await response.json();

        const needsFallback = !data?.metric ||
            data.metric.returnOnEquityTTM == null ||
            data.metric.totalDebtTotalEquityAnnual == null ||
            (data.metric.enterpriseValueTTM == null && data.metric.evToEbitda == null && data.metric.evEbitda == null);

        if (needsFallback && (process.env.FMP_API_KEY || process.env.FINANCIAL_MODELING_PREP_API_KEY || process.env.FINANCIALMODELINGPREP_API_KEY)) {
            try {
                const fallback = await fetchFmpMetrics(symbol);
                if (!fallback.error) {
                    data.fmpMetrics = fallback;
                }
            } catch (fallbackError) {
                console.warn('FMP metrics fallback failed:', fallbackError);
            }
        }

        res.json(data);
    } catch (error) {
        console.error("Finnhub Metrics Error:", error);
        res.status(500).json({ error: "Failed to fetch financial metrics" });
    }
});

// Real-Time Quote Endpoint
app.get('/api/finnhub/quote', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;

    try {
        const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_API_KEY}`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("Finnhub Quote Error:", error);
        res.status(500).json({ error: "Failed to fetch real-time quote" });
    }
});

// Cached index quote endpoint for S&P 500 and NASDAQ
const INDEX_QUOTE_CACHE = {
    lastFetched: 0,
    ttlMs: 60 * 1000,
    data: null,
};

const COMMODITY_PROXIES = [
    { id: 'gold', name: 'Gold', emoji: '🪙', symbol: 'GLD', description: 'SPDR Gold Shares' },
    { id: 'silver', name: 'Silver', emoji: '⚪', symbol: 'SLV', description: 'iShares Silver Trust' },
    { id: 'crude_oil', name: 'Crude Oil', emoji: '🛢️', symbol: 'USO', description: 'United States Oil Fund' },
    { id: 'natural_gas', name: 'Natural Gas', emoji: '🔥', symbol: 'UNG', description: 'United States Natural Gas Fund' },
    { id: 'copper', name: 'Copper', emoji: '🟠', symbol: 'CPER', description: 'United States Copper Index Fund' },
    { id: 'platinum', name: 'Platinum', emoji: '💠', symbol: 'PPLT', description: 'abrdn Physical Platinum Shares' },
    { id: 'wheat', name: 'Wheat', emoji: '🌾', symbol: 'WEAT', description: 'Teucrium Wheat Fund' },
    { id: 'corn', name: 'Corn', emoji: '🌽', symbol: 'CORN', description: 'Teucrium Corn Fund' },
];

const COMMODITY_QUOTE_CACHE = {
    lastFetched: 0,
    ttlMs: 4 * 60 * 60 * 1000,
    data: null,
};

function parseMarketNumber(value) {
    if (value == null || value === '') return null;
    const parsed = Number(String(value).replace(/[%,$]/g, '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
}

async function fetchFinnhubQuote(symbol) {
    if (!process.env.FINNHUB_API_KEY) {
        return { error: 'Missing Finnhub API key' };
    }

    const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_API_KEY}`);
    const data = await response.json();
    if (data?.error || data?.message || typeof data?.c !== 'number') {
        return { error: data?.error || data?.message || 'Invalid Finnhub quote data' };
    }
    return { price: data.c, change: data.d, changePercent: data.dp, raw: data };
}

async function fetchFinnhubHistory(symbol, fromTimestamp, toTimestamp, resolution = 'D') {
    if (!process.env.FINNHUB_API_KEY) {
        return { error: 'Missing Finnhub API key' };
    }

    const response = await fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(resolution)}&from=${fromTimestamp}&to=${toTimestamp}&token=${process.env.FINNHUB_API_KEY}`);
    const data = await response.json();
    if (data?.s !== 'ok' || !Array.isArray(data?.t)) {
        return { error: data?.error || data?.s || 'Invalid Finnhub history response', raw: data };
    }

    return data;
}

async function fetchTwelveDataQuote(symbol) {
    if (!process.env.TWELVEDATA_API_KEY) {
        return { error: 'Missing TwelveData API key' };
    }

    const response = await fetch(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${process.env.TWELVEDATA_API_KEY}`);
    const data = await response.json();

    if (data?.status === 'error' || data?.code || data?.message || !data?.close) {
        return { error: data?.message || data?.status || 'Invalid TwelveData quote data', raw: data };
    }

    return {
        price: Number(data.close),
        change: Number(data.change || 0),
        changePercent: Number(data.percent_change || 0),
        raw: data,
    };
}

async function fetchFmpQuote(symbol) {
    const fmpKey = process.env.FMP_API_KEY || process.env.FINANCIAL_MODELING_PREP_API_KEY || process.env.FINANCIALMODELINGPREP_API_KEY;
    if (!fmpKey) {
        return { error: 'Missing FMP API key' };
    }

    const encodedSymbol = encodeURIComponent(symbol);
    const candidateUrls = [
        `https://financialmodelingprep.com/api/v3/quote/${encodedSymbol}?apikey=${encodeURIComponent(fmpKey)}`,
        `https://financialmodelingprep.com/api/v4/quote/${encodedSymbol}?apikey=${encodeURIComponent(fmpKey)}`,
    ];

    for (const url of candidateUrls) {
        try {
            const response = await fetch(url);
            const data = await response.json();

            if (Array.isArray(data) && data.length > 0) {
                const quote = data[0];
                if (quote && quote.price != null) {
                    const changePercent = parseMarketNumber(quote.changesPercentage ?? quote.changePercentage ?? 0);
                    return {
                        price: Number(quote.price),
                        change: Number(quote.change || 0),
                        changePercent: changePercent ?? 0,
                        raw: quote,
                    };
                }
            }

            if (data && data.symbol && data.price != null) {
                const changePercent = parseMarketNumber(data.changesPercentage ?? data.changePercentage ?? 0);
                return {
                    price: Number(data.price),
                    change: Number(data.change || 0),
                    changePercent: changePercent ?? 0,
                    raw: data,
                };
            }
        } catch (err) {
            console.warn('FMP quote attempt failed for', url, err.message);
        }
    }

    return { error: 'FMP index endpoint unavailable or plan unsupported' };
}

async function fetchYahooIndexQuote(symbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json',
        },
    });
    const data = await response.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta || {};
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const lastClose = [...closes].reverse().find((value) => Number.isFinite(value));
    const price = parseMarketNumber(meta.regularMarketPrice ?? lastClose);
    const previousClose = parseMarketNumber(meta.previousClose ?? meta.chartPreviousClose);

    if (!response.ok || price == null) {
        return { error: data?.chart?.error?.description || 'Yahoo index quote unavailable', raw: data };
    }

    const change = previousClose != null ? price - previousClose : 0;
    const changePercent = previousClose ? (change / previousClose) * 100 : 0;

    return {
        price,
        change,
        changePercent,
        raw: {
            symbol,
            provider: 'Yahoo Finance',
            exchangeName: meta.exchangeName,
            marketState: meta.marketState,
            regularMarketTime: meta.regularMarketTime,
            previousClose,
        },
    };
}

async function fetchFmpMetrics(symbol) {
    const fmpKey = process.env.FMP_API_KEY || process.env.FINANCIAL_MODELING_PREP_API_KEY || process.env.FINANCIALMODELINGPREP_API_KEY;
    if (!fmpKey) {
        return { error: 'Missing FMP API key' };
    }

    const encodedSymbol = encodeURIComponent(symbol);
    const candidateUrls = [
        `https://financialmodelingprep.com/api/v3/ratios-ttm/${encodedSymbol}?limit=1&apikey=${encodeURIComponent(fmpKey)}`,
        `https://financialmodelingprep.com/api/v4/ratios-ttm/${encodedSymbol}?limit=1&apikey=${encodeURIComponent(fmpKey)}`,
        `https://financialmodelingprep.com/api/v3/key-metrics-ttm/${encodedSymbol}?limit=1&apikey=${encodeURIComponent(fmpKey)}`,
        `https://financialmodelingprep.com/api/v4/key-metrics-ttm/${encodedSymbol}?limit=1&apikey=${encodeURIComponent(fmpKey)}`
    ];

    for (const url of candidateUrls) {
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
                return data[0];
            }
            if (data && data.symbol) {
                return data;
            }
        } catch (err) {
            console.warn('FMP metrics attempt failed for', url, err.message);
        }
    }

    return { error: 'FMP metrics endpoint unavailable or plan unsupported' };
}

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
const COINMARKETCAP_API_KEY = process.env.COINMARKETCAP_API_KEY;

async function trySymbols(symbols, fetcher) {
    for (const symbol of symbols) {
        const result = await fetcher(symbol);
        if (!result.error && typeof result.price === 'number' && !isNaN(result.price)) {
            return result;
        }
    }
    return null;
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.text();
    try {
        return { response, data: JSON.parse(data) };
    } catch (error) {
        return { response, data: null };
    }
}

function coinGeckoHeaders() {
    const headers = {};
    if (COINGECKO_API_KEY) {
        headers['x_cg_pro_api_key'] = COINGECKO_API_KEY;
    }
    return headers;
}

function coinMarketCapHeaders() {
    return {
        'X-CMC_PRO_API_KEY': COINMARKETCAP_API_KEY,
    };
}

async function fetchCoinGeckoTop(limit = 6) {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`;
    const { response, data } = await fetchJson(url, { headers: coinGeckoHeaders() });
    if (!response.ok || !Array.isArray(data)) {
        throw new Error('CoinGecko top coins unavailable');
    }
    return data;
}

async function fetchCoinGeckoDetailsById(id) {
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
    const { response, data } = await fetchJson(url, { headers: coinGeckoHeaders() });
    if (!response.ok || !data || data.error) {
        throw new Error('CoinGecko details unavailable');
    }
    return data;
}

async function fetchCoinGeckoHistoryById(id, days = 365) {
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
    const { response, data } = await fetchJson(url, { headers: coinGeckoHeaders() });
    if (!response.ok || !data || !Array.isArray(data.prices)) {
        throw new Error('CoinGecko history unavailable');
    }
    return data;
}

async function searchCoinGecko(query) {
    const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`;
    const { response, data } = await fetchJson(url, { headers: coinGeckoHeaders() });
    if (!response.ok || !data || !Array.isArray(data.coins)) {
        throw new Error('CoinGecko search unavailable');
    }
    return data.coins;
}

async function findCoinGeckoIdBySymbol(symbol) {
    const coins = await searchCoinGecko(symbol);
    const normalized = symbol.trim().toLowerCase();
    return (
        coins.find((coin) => coin.symbol?.toLowerCase() === normalized)?.id ||
        coins.find((coin) => coin.id?.toLowerCase() === normalized)?.id ||
        coins[0]?.id ||
        null
    );
}

async function fetchCoinMarketCapTop(limit = 6) {
    if (!COINMARKETCAP_API_KEY) throw new Error('Missing CoinMarketCap API key');
    const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?start=1&limit=${limit}&convert=USD`;
    const { response, data } = await fetchJson(url, { headers: coinMarketCapHeaders() });
    if (!response.ok || !data || !Array.isArray(data.data)) {
        throw new Error('CoinMarketCap top coins unavailable');
    }
    return data.data;
}

async function fetchCoinMarketCapDetailsBySymbol(symbol) {
    if (!COINMARKETCAP_API_KEY) throw new Error('Missing CoinMarketCap API key');
    const quoteUrl = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(symbol)}&convert=USD`;
    const infoUrl = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/info?symbol=${encodeURIComponent(symbol)}`;

    const [{ response: quoteRes, data: quoteData }, { response: infoRes, data: infoData }] = await Promise.all([
        fetchJson(quoteUrl, { headers: coinMarketCapHeaders() }),
        fetchJson(infoUrl, { headers: coinMarketCapHeaders() }),
    ]);

    if (!quoteRes.ok || !quoteData || quoteData.status?.error_code) {
        throw new Error('CoinMarketCap quote unavailable');
    }

    const quote = quoteData.data?.[symbol];
    if (!quote) {
        throw new Error('CoinMarketCap symbol not found');
    }

    const info = infoData?.data?.[symbol] || {};
    return {
        name: info.name || quote.name || symbol,
        symbol: quote.symbol || symbol,
        market_cap_rank: quote.cmc_rank || null,
        image: info.logo || null,
        market_data: {
            current_price: { usd: quote.quote?.USD?.price ?? null },
            price_change_percentage_24h: quote.quote?.USD?.percent_change_24h ?? null,
            high_24h: { usd: quote.quote?.USD?.high_24h ?? null },
            low_24h: { usd: quote.quote?.USD?.low_24h ?? null },
            market_cap: { usd: quote.quote?.USD?.market_cap ?? null },
            total_volume: { usd: quote.quote?.USD?.volume_24h ?? null },
            circulating_supply: quote.circulating_supply ?? null,
            total_supply: quote.total_supply ?? null,
            ath: { usd: null },
            ath_date: { usd: null },
            atl: { usd: null },
            atl_date: { usd: null },
        },
    };
}

async function fetchCoinMarketCapSearch(query) {
    if (!COINMARKETCAP_API_KEY) throw new Error('Missing CoinMarketCap API key');
    const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/map?symbol=${encodeURIComponent(query)}`;
    const { response, data } = await fetchJson(url, { headers: coinMarketCapHeaders() });
    if (!response.ok || !data || !Array.isArray(data.data)) {
        throw new Error('CoinMarketCap search unavailable');
    }
    return data.data;
}

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

app.get('/api/indices', async (req, res) => {
    const now = Date.now();
    if (INDEX_QUOTE_CACHE.data && now - INDEX_QUOTE_CACHE.lastFetched < INDEX_QUOTE_CACHE.ttlMs) {
        return res.json(INDEX_QUOTE_CACHE.data);
    }

    try {
        const [sp500, nasdaq] = await Promise.all([
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
        ]);

        if (!sp500 || sp500.error || !nasdaq || nasdaq.error) {
            console.error('Index fetch failed', { sp500, nasdaq });
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

app.get('/api/commodities', async (req, res) => {
    const now = Date.now();
    if (COMMODITY_QUOTE_CACHE.data && now - COMMODITY_QUOTE_CACHE.lastFetched < COMMODITY_QUOTE_CACHE.ttlMs) {
        return res.json(COMMODITY_QUOTE_CACHE.data);
    }

    try {
        const commodityQuotes = await Promise.all(COMMODITY_PROXIES.map(async (item) => {
            let quote = null;
            if (process.env.TWELVEDATA_API_KEY) {
                quote = await fetchTwelveDataQuote(item.symbol);
            }
            if (!quote || quote.error) {
                quote = await fetchFinnhubQuote(item.symbol);
            }

            return {
                id: item.id,
                name: item.name,
                emoji: item.emoji,
                symbol: item.symbol,
                description: item.description,
                price: quote?.price ?? null,
                change: quote?.change ?? null,
                changePercent: quote?.changePercent ?? null,
                source: quote?.error ? 'Unavailable' : 'TwelveData',
            };
        }));

        const payload = {
            commodities: commodityQuotes,
            fetchedAt: new Date().toISOString(),
        };

        COMMODITY_QUOTE_CACHE.data = payload;
        COMMODITY_QUOTE_CACHE.lastFetched = now;
        res.json(payload);
    } catch (error) {
        console.error('Commodities Error:', error);
        if (COMMODITY_QUOTE_CACHE.data) {
            return res.json(COMMODITY_QUOTE_CACHE.data);
        }
        res.status(500).json({ error: 'Failed to fetch commodity quotes' });
    }
});

app.get('/api/commodities/history', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;
    if (!process.env.TWELVEDATA_API_KEY) return res.status(500).json({ error: 'Missing TwelveData API key' });

    try {
        const response = await fetch(
            `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=14&apikey=${process.env.TWELVEDATA_API_KEY}`
        );
        const data = await response.json();
        if (data?.status === 'error') {
            return res.status(500).json({ error: data.message || 'Invalid TwelveData history response', raw: data });
        }
        res.json(data);
    } catch (error) {
        console.error('Commodity history error:', error);
        res.status(500).json({ error: 'Failed to fetch commodity history' });
    }
});

app.get('/api/finnhub/indices', async (req, res) => {
    return res.redirect(302, '/api/indices');
});

// ==========================================
// 2. TWELVEDATA ENDPOINTS (Charts & Financials)
// ==========================================

// Historical Time-Series (Charts)
app.get('/api/twelvedata/time_series', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;
    const timeframe = String(req.query.timeframe || '1Y').toUpperCase();

    const timeframeConfig = {
        '1M': { interval: '1day', outputsize: 30 },
        '1Y': { interval: '1day', outputsize: 252 },
        '5Y': { interval: '1week', outputsize: 260 },
        'MAX': { interval: '1month', outputsize: 120 }
    };

    const config = timeframeConfig[timeframe];
    if (!config) {
        return res.status(400).json({ error: 'Valid timeframe is required' });
    }

    try {
        const response = await fetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${config.interval}&outputsize=${config.outputsize}&apikey=${process.env.TWELVEDATA_API_KEY}`);
        const data = await response.json();

        if (data?.status === 'error' || !Array.isArray(data?.values)) {
            console.warn('TwelveData time series fallback triggered:', data);
            const fallback = await tryFinnhubFallback(symbol, timeframe);
            if (fallback) return res.json(fallback);
            return res.status(500).json({ error: 'No time series values returned', raw: data });
        }

        if (timeframe === '1Y' && Array.isArray(data.values) && data.values.length < 180) {
            console.warn(`TwelveData 1Y values too short (${data.values.length}), using Finnhub fallback`);
            const fallback = await tryFinnhubFallback(symbol, timeframe);
            if (fallback) return res.json(fallback);
        }

        res.json(data);
    } catch (error) {
        console.error("TwelveData Time Series Error:", error);
        const fallback = await tryFinnhubFallback(symbol, timeframe);
        if (fallback) return res.json(fallback);
        res.status(500).json({ error: "Failed to fetch historical data" });
    }
});

async function tryFinnhubFallback(symbol, timeframe) {
    if (!process.env.FINNHUB_API_KEY) {
        return null;
    }

    const now = Math.floor(Date.now() / 1000);
    let resolution = 'D';
    let days = 365;

    if (timeframe === '1M') {
        resolution = 'D';
        days = 30;
    } else if (timeframe === '1Y') {
        resolution = 'D';
        days = 365;
    } else if (timeframe === '5Y') {
        resolution = 'W';
        days = 365 * 5;
    } else if (timeframe === 'MAX') {
        resolution = 'M';
        days = 365 * 10;
    }

    const from = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
    const fh = await fetchFinnhubHistory(symbol, from, now, resolution);
    if (fh?.error || !Array.isArray(fh?.t) || fh.t.length === 0) {
        console.warn('Finnhub fallback did not return usable data:', fh);
        return null;
    }

    const values = fh.t.map((timestamp, index) => ({
        datetime: new Date(timestamp * 1000).toISOString().slice(0, 10),
        open: fh.o[index],
        high: fh.h[index],
        low: fh.l[index],
        close: fh.c[index],
        volume: fh.v[index]
    }));

    return { values };
}

// ==========================================
// 3. AI ADVISOR (Groq free tier preferred, Gemini optional)
// ==========================================

const AI_FRAME_INSTRUCTIONS = {
    dupont:
        'Perform a 3-stage DuPont ROE decomposition (net profit margin × asset turnover × equity multiplier). Explain drivers using the metrics provided.',
    redflags:
        'Run an automated financial red flags scan: valuation stretch, leverage, liquidity, growth quality, and macro/sector risks.',
    dcf:
        'Explain a discounted cash flow (DCF) framework for this company: key assumptions, FCFF vs FCFE, WACC inputs, and terminal value—educational only, no fabricated precise intrinsic price.',
    benchmarking:
        'Provide qualitative peer-group / sector benchmarking: how valuation and profitability likely compare to sector norms.',
};

function pickMetricsForAi(metric) {
    if (!metric) return {};
    return {
        peTTM: metric.peTTM,
        pbAnnual: metric.pbAnnual,
        psTTM: metric.psTTM,
        roeTTM: metric.roeTTM,
        roaTTM: metric.roaTTM,
        netProfitMarginTTM: metric.netProfitMarginTTM,
        currentRatioAnnual: metric.currentRatioAnnual,
        debtToEquityAnnual: metric.debtToEquityAnnual,
        revenueGrowth5Y: metric.revenueGrowth5Y,
        epsGrowth5Y: metric.epsGrowth5Y,
        dividendYieldIndicatedAnnual: metric.dividendYieldIndicatedAnnual,
    };
}

function buildAiPrompt(symbol, frameKey, profile, quote, metricsPayload) {
    const context = {
        symbol,
        company: profile.name,
        industry: profile.finnhubIndustry,
        exchange: profile.exchange,
        marketCap: profile.marketCapitalization,
        price: quote.c,
        change: quote.d,
        changePercent: quote.dp,
        week52High: quote.h,
        week52Low: quote.l,
        metrics: pickMetricsForAi(metricsPayload?.metric),
    };

    return `You are EQUITRACK, an educational equity research assistant.

RULES:
- Not financial advice; include a one-sentence disclaimer at the end.
- Use short headings and bullet points; stay under 450 words.
- Use only the JSON data below; if missing, write "data unavailable".
- Do not invent exact price targets or fabricated financial statement line items.

TASK: ${AI_FRAME_INSTRUCTIONS[frameKey]}

DATA:
${JSON.stringify(context, null, 2)}

Write the analysis for ${symbol}.`;
}

function getAiProvider() {
    if (process.env.GROQ_API_KEY) return 'groq';
    if (process.env.GEMINI_API_KEY) return 'gemini';
    return null;
}

async function generateWithGroq(prompt) {
    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.6,
            max_tokens: 1024,
        }),
    });

    const data = await response.json();
    if (!response.ok) {
        const message = data?.error?.message || 'Groq API request failed';
        console.error('Groq API Error:', data);
        const err = new Error(message);
        err.statusCode = 502;
        throw err;
    }

    const text = data?.choices?.[0]?.message?.content || '';
    if (!text.trim()) {
        const err = new Error('Empty response from AI model.');
        err.statusCode = 502;
        throw err;
    }
    return text.trim();
}

async function generateWithGemini(prompt) {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const geminiUrl =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.6,
                maxOutputTokens: 1024,
            },
        }),
    });

    const data = await response.json();
    if (!response.ok) {
        let message = data?.error?.message || 'Gemini API request failed';
        if (message.includes('limit: 0')) {
            message =
                'Gemini free tier is not active on your Google project. Use Groq instead: add GROQ_API_KEY from console.groq.com (free, no card).';
        }
        console.error('Gemini API Error:', data);
        const err = new Error(message);
        err.statusCode = 502;
        throw err;
    }

    const text =
        data?.candidates?.[0]?.content?.parts
            ?.map((part) => part.text)
            .filter(Boolean)
            .join('') || '';

    if (!text.trim()) {
        const err = new Error('Empty response from AI model.');
        err.statusCode = 502;
        throw err;
    }
    return text.trim();
}

async function generateAiAnalysis(prompt) {
    const provider = getAiProvider();
    if (provider === 'groq') return { analysis: await generateWithGroq(prompt), provider: 'groq' };
    if (provider === 'gemini') return { analysis: await generateWithGemini(prompt), provider: 'gemini' };
    const err = new Error(
        'No AI API key configured. Add GROQ_API_KEY (free at console.groq.com, no credit card) or GEMINI_API_KEY to .env'
    );
    err.statusCode = 503;
    throw err;
}

app.post('/api/ai/analyze', async (req, res) => {
    const { frame } = req.body || {};
    const symbol = requireTicker(req, res);
    if (!symbol) return;
    const frameKey = AI_FRAME_INSTRUCTIONS[frame] ? frame : 'dupont';

    if (!getAiProvider()) {
        return res.status(503).json({
            error: 'No AI API key configured. Add GROQ_API_KEY (free at console.groq.com) to .env',
        });
    }

    try {
        const finnhubToken = process.env.FINNHUB_API_KEY;
        const [profileRes, quoteRes, metricsRes] = await Promise.all([
            fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${finnhubToken}`),
            fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhubToken}`),
            fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${finnhubToken}`),
        ]);

        const profile = await profileRes.json();
        const quote = await quoteRes.json();
        const metricsPayload = await metricsRes.json();

        if (!profile?.name || typeof quote?.c !== 'number') {
            return res.status(404).json({ error: 'Ticker not found or market data unavailable.' });
        }

        const prompt = buildAiPrompt(symbol, frameKey, profile, quote, metricsPayload);
        const { analysis, provider } = await generateAiAnalysis(prompt);

        res.json({
            analysis,
            symbol,
            frame: frameKey,
            provider,
            model: provider === 'groq'
                ? (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile')
                : (process.env.GEMINI_MODEL || 'gemini-2.5-flash'),
        });
    } catch (error) {
        console.error('AI Analyze Error:', error);
        const status = error.statusCode || 500;
        const message =
            status === 500 ? 'Failed to generate AI analysis.' : error.message;
        res.status(status).json({ error: message });
    }
});

// Financial Statements (Balance Sheet / Cash Flow)
app.get('/api/twelvedata/statements', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;
    const type = String(req.query.type || '').trim();
    const allowedStatementTypes = new Set(['balance_sheet', 'cash_flow']);
    if (!allowedStatementTypes.has(type)) {
        return res.status(400).json({ error: 'Valid statement type is required' });
    }

    try {
        const response = await fetch(`https://api.twelvedata.com/${type}?symbol=${encodeURIComponent(symbol)}&apikey=${process.env.TWELVEDATA_API_KEY}`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error(`TwelveData ${type} Error:`, error);
        res.status(500).json({ error: `Failed to fetch ${type}` });
    }
});

// ==========================================
// CRYPTOCURRENCY ENDPOINTS (CoinGecko & CoinMarketCap)
// ==========================================

function normalizeCryptoResult(item) {
    return {
        id: item.id || item.symbol?.toLowerCase() || item.slug || item.symbol,
        symbol: item.symbol ? item.symbol.toUpperCase() : (item.id || '').toUpperCase(),
        name: item.name,
        image: item.image || item.logo || item.image?.thumb || item.image?.small || item.image?.large || null,
        market_cap_rank: item.market_cap_rank || item.cmc_rank || null,
        current_price: item.current_price ?? item.quote?.USD?.price ?? null,
        price_change_percentage_24h: item.price_change_percentage_24h ?? item.quote?.USD?.percent_change_24h ?? null,
        market_cap: item.market_cap ?? item.quote?.USD?.market_cap ?? null,
        total_volume: item.total_volume ?? item.quote?.USD?.volume_24h ?? null,
    };
}

function mapCoinGeckoTopItems(items) {
    return items.map((item) => ({
        id: item.id,
        symbol: item.symbol?.toUpperCase(),
        name: item.name,
        image: item.image,
        market_cap_rank: item.market_cap_rank,
        current_price: item.current_price,
        price_change_percentage_24h: item.price_change_percentage_24h,
    }));
}

function mapCoinMarketCapTopItems(items) {
    return items.map((coin) => ({
        id: coin.symbol,
        symbol: coin.symbol,
        name: coin.name,
        image: coin.logo || null,
        market_cap_rank: coin.cmc_rank,
        current_price: coin.quote?.USD?.price ?? null,
        price_change_percentage_24h: coin.quote?.USD?.percent_change_24h ?? null,
    }));
}

app.get('/api/crypto/top', async (req, res) => {
    const { limit } = req.query;
    const limitNum = Math.max(1, Math.min(12, parseInt(limit) || 6));

    try {
        const geckoData = await fetchCoinGeckoTop(limitNum);
        return res.json(mapCoinGeckoTopItems(geckoData));
    } catch (geckoError) {
        console.warn('CoinGecko top coins failed, falling back to CoinMarketCap.', geckoError.message);
    }

    try {
        const cmcData = await fetchCoinMarketCapTop(limitNum);
        return res.json(mapCoinMarketCapTopItems(cmcData));
    } catch (cmcError) {
        console.error('Failed to fetch top cryptocurrencies from both providers:', cmcError);
        return res.status(500).json({ error: 'Failed to fetch top cryptocurrencies' });
    }
});

async function resolveCryptoIdOrSymbol(idOrSymbol) {
    if (!idOrSymbol) return null;
    const normalized = normalizeCryptoQuery(idOrSymbol);
    if (!normalized) return null;
    try {
        const geckoId = await findCoinGeckoIdBySymbol(normalized);
        if (geckoId) return { provider: 'gecko', value: geckoId };
    } catch (error) {
        console.warn('CoinGecko symbol lookup failed:', error.message);
    }
    return { provider: 'symbol', value: normalized.toUpperCase() };
}

app.get('/api/crypto/details', async (req, res) => {
    const { id, symbol } = req.query;
    const queryValue = normalizeCryptoQuery(id || symbol);
    if (!queryValue) return res.status(400).json({ error: 'Valid cryptocurrency ID or symbol is required' });

    try {
        try {
            const cryptoId = id || (await findCoinGeckoIdBySymbol(queryValue));
            if (cryptoId) {
                const data = await fetchCoinGeckoDetailsById(cryptoId);
                return res.json(data);
            }
        } catch (geckoError) {
            console.warn('CoinGecko details lookup failed, trying CoinMarketCap fallback.', geckoError.message);
        }

        if (COINMARKETCAP_API_KEY) {
            const symbolValue = (queryValue || '').toString().trim().toUpperCase();
            const cmcData = await fetchCoinMarketCapDetailsBySymbol(symbolValue);
            return res.json(cmcData);
        }

        return res.status(404).json({ error: 'Cryptocurrency details not found.' });
    } catch (error) {
        console.error('Cryptocurrency details error:', error);
        res.status(500).json({ error: 'Failed to fetch cryptocurrency details' });
    }
});

app.get('/api/crypto/history', async (req, res) => {
    const { id, symbol, days } = req.query;
    const queryValue = normalizeCryptoQuery(id || symbol);
    if (!queryValue) return res.status(400).json({ error: 'Valid cryptocurrency ID or symbol is required' });

    const daysNum = Math.max(7, Math.min(365, parseInt(days) || 365));

    try {
        const geckoId = id || await findCoinGeckoIdBySymbol(queryValue);
        if (!geckoId) {
            return res.status(404).json({ error: 'Cryptocurrency history not found' });
        }
        const data = await fetchCoinGeckoHistoryById(geckoId, daysNum);
        return res.json(data);
    } catch (error) {
        console.error('CoinGecko History Error:', error);
        res.status(500).json({ error: 'Failed to fetch cryptocurrency history' });
    }
});

app.get('/api/crypto/search', async (req, res) => {
    const query = normalizeCryptoQuery(req.query.query);
    if (!query) return res.status(400).json({ error: 'Valid search query is required' });

    try {
        const coins = await searchCoinGecko(query);
        return res.json({ coins });
    } catch (geckoError) {
        console.warn('CoinGecko search failed, trying CoinMarketCap fallback.', geckoError.message);
    }

    if (COINMARKETCAP_API_KEY) {
        try {
            const results = await fetchCoinMarketCapSearch(query);
            const coins = results.map((item) => ({
                id: item.symbol,
                name: item.name,
                symbol: item.symbol,
                market_cap_rank: item.rank,
                thumb: item.logo || null,
                large: item.logo || null,
            }));
            return res.json({ coins });
        } catch (cmcError) {
            console.error('CoinMarketCap search failed:', cmcError);
        }
    }

    res.status(500).json({ error: 'Failed to search cryptocurrencies' });
});

app.use((error, req, res, next) => {
    if (error?.message === 'CORS origin not allowed') {
        return res.status(error.statusCode || 403).json({ error: error.message });
    }
    return next(error);
});

// Start the server on port 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    const aiProvider = getAiProvider();
    console.log(`==================================================`);
    console.log(`🚀 EQUITRACK Secure Backend Engine Active!`);
    console.log(`🔗 Open the app: http://localhost:${PORT}`);
    if (aiProvider === 'groq') {
        console.log(`🤖 AI Advisor: Groq (${process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'})`);
    } else if (aiProvider === 'gemini') {
        console.log(`🤖 AI Advisor: Gemini (${process.env.GEMINI_MODEL || 'gemini-2.5-flash'})`);
    } else {
        console.log(`⚠️  AI Advisor: no API key (add GROQ_API_KEY to .env)`);
    }
    console.log(`==================================================`);
});
