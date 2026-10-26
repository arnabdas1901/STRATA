const { parseMarketNumber } = require('./api');
const { MemoryCache } = require('./cache');

// ── Shared Single-Source Caches ──────────────────────────────────────────────
const yahooChartCache = new MemoryCache('yahoo-chart', 15 * 60 * 1000, 250);
const finnhubQuoteCache = new MemoryCache('equity-quote', 45 * 1000, 200);
const finnhubProfileCache = new MemoryCache('equity-profile', 24 * 60 * 60 * 1000, 200);
const finnhubMetricsCache = new MemoryCache('finnhub-metrics', 2 * 60 * 60 * 1000, 150);
const finnhubRecsCache = new MemoryCache('equity-recommendations', 6 * 60 * 60 * 1000, 150);
const finnhubPeersCache = new MemoryCache('equity-peers', 12 * 60 * 60 * 1000, 150);

// In-flight deduplication maps (concurrent requests for same key share 1 promise)
const inFlightYahooChart = new Map();
const inFlightQuote = new Map();
const inFlightProfile = new Map();
const inFlightMetrics = new Map();
const inFlightRecs = new Map();
const inFlightPeers = new Map();

const KNOWN_PEERS_FALLBACK = {
    'AAPL': ['MSFT', 'GOOGL', 'AMZN', 'META'],
    'MSFT': ['AAPL', 'GOOGL', 'AMZN', 'ORCL'],
    'GOOGL': ['MSFT', 'META', 'AMZN', 'AAPL'],
    'AMZN': ['MSFT', 'GOOGL', 'WMT', 'BABA'],
    'NVDA': ['AMD', 'INTC', 'QCOM', 'AVGO'],
    'TSLA': ['RIVN', 'LCID', 'F', 'GM'],
    'META': ['GOOGL', 'SNAP', 'PINS', 'MSFT'],
    'JPM': ['BAC', 'WFC', 'C', 'GS']
};

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
    const urls = [
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`,
        `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`
    ];

    let lastError = null;
    for (const url of urls) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);

            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'application/json',
                },
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                lastError = `Yahoo HTTP ${response.status}`;
                continue;
            }

            const data = await response.json();
            const result = data?.chart?.result?.[0];
            const meta = result?.meta || {};
            const closes = result?.indicators?.quote?.[0]?.close || [];
            const lastClose = [...closes].reverse().find((value) => Number.isFinite(value));
            const price = parseMarketNumber(meta.regularMarketPrice ?? lastClose);
            const previousClose = parseMarketNumber(meta.previousClose ?? meta.chartPreviousClose);

            if (price == null) {
                lastError = data?.chart?.error?.description || 'Yahoo index quote unavailable';
                continue;
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
        } catch (err) {
            lastError = err.message;
        }
    }

    return { error: lastError || 'Yahoo index quote unavailable' };
}

async function fetchYahooProfile(symbol) {
    const urls = [
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`,
        `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`
    ];

    for (const url of urls) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'application/json',
                },
            });
            clearTimeout(timeoutId);
            if (!response.ok) continue;

            const data = await response.json();
            const meta = data?.chart?.result?.[0]?.meta;
            if (meta && (meta.shortName || meta.longName || meta.symbol)) {
                const name = meta.longName || meta.shortName || symbol.toUpperCase();
                const exchange = meta.exchangeName || 'US Exchanges';
                const currency = meta.currency || 'USD';
                const industry = meta.instrumentType === 'ETF' ? 'Exchange Traded Fund' : (meta.instrumentType || 'Equities');

                return {
                    ticker: symbol.toUpperCase(),
                    name,
                    country: 'US',
                    currency,
                    exchange,
                    finnhubIndustry: industry,
                    logo: `https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/${symbol.toUpperCase()}.png`,
                    weburl: `https://finance.yahoo.com/quote/${symbol.toUpperCase()}`
                };
            }
        } catch (e) {
            // try next
        }
    }
    return null;
}

async function fetchYahooQuote(symbol) {
    const urls = [
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`,
        `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`
    ];

    for (const url of urls) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'application/json',
                },
            });
            clearTimeout(timeoutId);
            if (!response.ok) continue;

            const data = await response.json();
            const result = data?.chart?.result?.[0];
            const meta = result?.meta || {};
            const closes = result?.indicators?.quote?.[0]?.close || [];
            const lastClose = [...closes].reverse().find((value) => Number.isFinite(value));
            const price = parseMarketNumber(meta.regularMarketPrice ?? lastClose);
            const previousClose = parseMarketNumber(meta.previousClose ?? meta.chartPreviousClose);

            if (price != null) {
                const change = previousClose != null ? price - previousClose : 0;
                const changePercent = previousClose ? (change / previousClose) * 100 : 0;
                return {
                    c: price,
                    d: change,
                    dp: changePercent,
                    h: meta.regularMarketDayHigh ?? price,
                    l: meta.regularMarketDayLow ?? price,
                    o: meta.regularMarketOpen ?? price,
                    pc: previousClose ?? price,
                    t: meta.regularMarketTime ?? Math.floor(Date.now() / 1000)
                };
            }
        } catch (e) {
            // try next
        }
    }
    return null;
}

async function fetchYahooTimeSeries(symbol, timeframe) {
    const rangeMap = {
        '1M': { range: '1mo', interval: '1d' },
        '1Y': { range: '1y', interval: '1d' },
        '5Y': { range: '5y', interval: '1wk' },
        'MAX': { range: '10y', interval: '1mo' }
    };
    const { range, interval } = rangeMap[timeframe] || { range: '1y', interval: '1d' };
    const urls = [
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`,
        `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`
    ];

    for (const url of urls) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'application/json',
                }
            });
            clearTimeout(timeoutId);
            if (!response.ok) continue;

            const data = await response.json();
            const result = data?.chart?.result?.[0];
            const timestamps = result?.timestamp || [];
            const quotes = result?.indicators?.quote?.[0] || {};
            if (!timestamps.length || !quotes.close) continue;

            const values = [];
            for (let i = timestamps.length - 1; i >= 0; i--) {
                const c = quotes.close[i];
                if (c == null) continue;
                const d = new Date(timestamps[i] * 1000);
                const yyyy = d.getUTCFullYear();
                const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
                const dd = String(d.getUTCDate()).padStart(2, '0');
                values.push({
                    datetime: `${yyyy}-${mm}-${dd}`,
                    open: quotes.open?.[i] != null ? Number(quotes.open[i].toFixed(2)) : Number(c.toFixed(2)),
                    high: quotes.high?.[i] != null ? Number(quotes.high[i].toFixed(2)) : Number(c.toFixed(2)),
                    low: quotes.low?.[i] != null ? Number(quotes.low[i].toFixed(2)) : Number(c.toFixed(2)),
                    close: Number(c.toFixed(2)),
                    volume: quotes.volume?.[i] ?? 0
                });
            }

            if (values.length > 0) {
                return { values };
            }
        } catch (e) {
            // try next
        }
    }
    return null;
}

async function fetchYahooChart(symbol, range = '1y', interval = '1d') {
    if (!symbol) return { error: 'Symbol is required' };
    const sym = symbol.toUpperCase().trim();
    const cacheKey = `${sym}_${range}_${interval}`;

    const cached = yahooChartCache.getData(cacheKey);
    if (cached) return cached;

    if (inFlightYahooChart.has(cacheKey)) {
        return await inFlightYahooChart.get(cacheKey);
    }

    const fetchPromise = (async () => {
        const urls = [
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}`,
            `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}`
        ];

        let lastError = null;
        for (const url of urls) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 6000);

                const response = await fetch(url, {
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'Accept': 'application/json',
                    },
                });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    lastError = `Yahoo HTTP ${response.status}`;
                    continue;
                }

                const data = await response.json();
                const result = data?.chart?.result?.[0];
                if (!result) {
                    lastError = data?.chart?.error?.description || 'Yahoo chart result missing';
                    continue;
                }

                const meta = result?.meta || {};
                const timestamps = result?.timestamp || [];
                const closes = result?.indicators?.quote?.[0]?.close || [];

                const chartData = [];
                for (let i = 0; i < timestamps.length; i++) {
                    if (closes[i] != null && Number.isFinite(closes[i])) {
                        chartData.push({
                            time: timestamps[i],
                            close: Number(closes[i].toFixed(4))
                        });
                    }
                }

                const lastClose = [...closes].reverse().find((value) => Number.isFinite(value));
                const price = parseMarketNumber(meta.regularMarketPrice ?? lastClose);
                const previousClose = parseMarketNumber(meta.previousClose ?? meta.chartPreviousClose);

                if (price == null) {
                    lastError = 'Yahoo chart price unavailable';
                    continue;
                }

                const change = previousClose != null ? price - previousClose : 0;
                const changePercent = previousClose ? (change / previousClose) * 100 : 0;

                const payload = {
                    price,
                    change,
                    changePercent,
                    chartData,
                    raw: {
                        symbol: sym,
                        provider: 'Yahoo Finance',
                        exchangeName: meta.exchangeName,
                        shortName: meta.shortName || meta.symbol
                    },
                };

                yahooChartCache.set(cacheKey, payload);
                return payload;
            } catch (err) {
                lastError = err.message;
            }
        }

        return { error: lastError || 'Yahoo chart unavailable' };
    })();

    inFlightYahooChart.set(cacheKey, fetchPromise);
    try {
        return await fetchPromise;
    } finally {
        inFlightYahooChart.delete(cacheKey);
    }
}


async function fetchFmpMetrics(symbol) {
    const fmpKey = process.env.FMP_API_KEY || process.env.FINANCIAL_MODELING_PREP_API_KEY || process.env.FINANCIALMODELINGPREP_API_KEY;
    if (!fmpKey) {
        return { error: 'Missing FMP API key' };
    }

    const candidateUrls = [
        `https://financialmodelingprep.com/api/v3/ratios-ttm/${encodeURIComponent(symbol)}?limit=1&apikey=${encodeURIComponent(fmpKey)}`,
        `https://financialmodelingprep.com/api/v4/ratios-ttm/${encodeURIComponent(symbol)}?limit=1&apikey=${encodeURIComponent(fmpKey)}`,
        `https://financialmodelingprep.com/api/v3/key-metrics-ttm/${encodeURIComponent(symbol)}?limit=1&apikey=${encodeURIComponent(fmpKey)}`,
        `https://financialmodelingprep.com/api/v4/key-metrics-ttm/${encodeURIComponent(symbol)}?limit=1&apikey=${encodeURIComponent(fmpKey)}`
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

async function fetchAlphaVantageCommodity(functionName, interval = 'daily') {
    if (!process.env.ALPHAVANTAGE_API_KEY) {
        return { error: 'Missing Alpha Vantage API key' };
    }

    const response = await fetch(`https://www.alphavantage.co/query?function=${functionName}&interval=${interval}&apikey=${process.env.ALPHAVANTAGE_API_KEY}`);
    const data = await response.json();

    if (data['Information'] || data['Note']) {
        return { error: data['Information'] || data['Note'], raw: data };
    }

    if (!data.data || !Array.isArray(data.data) || data.data.length < 2) {
        return { error: `Invalid Alpha Vantage response for ${functionName}`, raw: data };
    }

    const currentPrice = Number(data.data[0].value);
    const previousPrice = Number(data.data[1].value);
    const change = currentPrice - previousPrice;
    const changePercent = (change / previousPrice) * 100;

    return {
        price: currentPrice,
        change: change,
        changePercent: changePercent,
        lastUpdated: data.data[0].date,
        raw: data.data.slice(0, 30) // Keep the last 30 periods for sparkline
    };
}

async function fetchAlphaVantageForexDaily(fromSymbol, toSymbol) {
    if (!process.env.ALPHAVANTAGE_API_KEY) {
        return { error: 'Missing Alpha Vantage API key' };
    }

    try {
        const url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${fromSymbol}&to_symbol=${toSymbol}&apikey=${process.env.ALPHAVANTAGE_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data['Information'] || data['Note']) {
            return { error: data['Information'] || data['Note'], raw: data };
        }

        const timeSeries = data['Time Series FX (Daily)'];
        if (!timeSeries) {
            return { error: 'Invalid or missing Time Series data', raw: data };
        }

        const dates = Object.keys(timeSeries).sort((a, b) => new Date(a) - new Date(b));
        if (dates.length < 2) {
            return { error: 'Not enough data points', raw: data };
        }

        const latestDate = dates[dates.length - 1];
        const previousDate = dates[dates.length - 2];
        const currentPrice = Number(timeSeries[latestDate]['4. close']);
        const previousPrice = Number(timeSeries[previousDate]['4. close']);
        const change = currentPrice - previousPrice;
        const changePercent = (change / previousPrice) * 100;

        const chartData = dates.map(date => ({
            time: new Date(date).getTime() / 1000,
            close: Number(timeSeries[date]['4. close'])
        }));

        return {
            price: currentPrice,
            change: change,
            changePercent: changePercent,
            chartData: chartData.slice(-252) // approx 1 year of trading days
        };
    } catch (err) {
        return { error: err.message };
    }
}

async function resolveCachedQuote(symbol) {
    if (!symbol) return { c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0, t: Math.floor(Date.now() / 1000) };
    const sym = symbol.toUpperCase().trim();

    const cached = finnhubQuoteCache.getData(sym);
    if (cached) return cached;

    if (inFlightQuote.has(sym)) {
        return await inFlightQuote.get(sym);
    }

    const fetchPromise = (async () => {
        // 1. Try Finnhub Quote
        if (process.env.FINNHUB_API_KEY) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${process.env.FINNHUB_API_KEY}`, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (res.ok) {
                    const data = await res.json();
                    if (typeof data?.c === 'number' && data.c > 0) {
                        const quote = {
                            c: data.c,
                            d: data.d ?? 0,
                            dp: data.dp ?? 0,
                            h: data.h ?? data.c,
                            l: data.l ?? data.c,
                            o: data.o ?? data.c,
                            pc: data.pc ?? data.c,
                            t: data.t ?? Math.floor(Date.now() / 1000)
                        };
                        finnhubQuoteCache.set(sym, quote);
                        return quote;
                    }
                }
            } catch (err) {}
        }

        // 2. Fallback to Yahoo Quote
        try {
            const yq = await fetchYahooQuote(sym);
            if (yq && typeof yq.c === 'number' && yq.c > 0) {
                finnhubQuoteCache.set(sym, yq);
                return yq;
            }
        } catch (err) {}

        // 3. Fallback to TwelveData Quote
        try {
            const td = await fetchTwelveDataQuote(sym);
            if (td && !td.error && typeof td.price === 'number' && td.price > 0) {
                const quote = {
                    c: td.price,
                    d: td.change ?? 0,
                    dp: td.changePercent ?? 0,
                    h: Number(td.raw?.high ?? td.price),
                    l: Number(td.raw?.low ?? td.price),
                    o: Number(td.raw?.open ?? td.price),
                    pc: Number(td.raw?.previous_close ?? td.price),
                    t: Math.floor(Date.now() / 1000)
                };
                finnhubQuoteCache.set(sym, quote);
                return quote;
            }
        } catch (err) {}

        const fallback = { c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0, t: Math.floor(Date.now() / 1000) };
        finnhubQuoteCache.set(sym, fallback);
        return fallback;
    })();

    inFlightQuote.set(sym, fetchPromise);
    try {
        return await fetchPromise;
    } finally {
        inFlightQuote.delete(sym);
    }
}

async function resolveCachedProfile(symbol) {
    if (!symbol) return null;
    const sym = symbol.toUpperCase().trim();

    const cached = finnhubProfileCache.getData(sym);
    if (cached) return cached;

    if (inFlightProfile.has(sym)) {
        return await inFlightProfile.get(sym);
    }

    const fetchPromise = (async () => {
        // 1. Try Finnhub Profile2
        if (process.env.FINNHUB_API_KEY) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                const res = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${process.env.FINNHUB_API_KEY}`, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.name) {
                        finnhubProfileCache.set(sym, data);
                        return data;
                    }
                }
            } catch (err) {}
        }

        // 2. Fallback to Yahoo Profile
        try {
            const yp = await fetchYahooProfile(sym);
            if (yp && yp.name) {
                finnhubProfileCache.set(sym, yp);
                return yp;
            }
        } catch (err) {}

        // 3. Fallback default clean profile
        const defaultProfile = {
            ticker: sym,
            name: `${sym} Asset`,
            country: 'US',
            currency: 'USD',
            exchange: 'US Exchanges',
            finnhubIndustry: 'Equities',
            logo: `https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/${sym}.png`,
            weburl: `https://finance.yahoo.com/quote/${sym}`
        };
        finnhubProfileCache.set(sym, defaultProfile);
        return defaultProfile;
    })();

    inFlightProfile.set(sym, fetchPromise);
    try {
        return await fetchPromise;
    } finally {
        inFlightProfile.delete(sym);
    }
}

async function resolveCachedMetrics(symbol) {
    if (!symbol) return { metric: {}, series: {} };
    const sym = symbol.toUpperCase().trim();

    const cached = finnhubMetricsCache.getData(sym);
    if (cached) return cached;

    if (inFlightMetrics.has(sym)) {
        return await inFlightMetrics.get(sym);
    }

    const fetchPromise = (async () => {
        let data = null;
        if (process.env.FINNHUB_API_KEY) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                const res = await fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(sym)}&metric=all&token=${process.env.FINNHUB_API_KEY}`, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (res.ok) {
                    data = await res.json();
                }
            } catch (err) {
                console.warn(`Finnhub metrics fetch warning for ${sym}:`, err.message);
            }
        }

        if (!data || !data.metric) {
            data = { metric: {}, series: {} };
        }
        if (!data.series) data.series = {};

        const m = data.metric;
        if (m.debtToEquityAnnual == null) {
            m.debtToEquityAnnual = m['totalDebt/totalEquityAnnual'] ?? m['totalDebt/totalEquityQuarterly'] ?? m.totalDebtToEquity ?? null;
        }
        if (m.totalDebtToEquity == null) {
            m.totalDebtToEquity = m.debtToEquityAnnual;
        }

        // Check if key institutional ratios are missing and fall back to FMP if available
        const needsFmp = (m.roeTTM == null && m.returnOnEquityTTM == null) ||
                         m.debtToEquityAnnual == null ||
                         (m.evEbitdaTTM == null && m['ev/ebitdaTTM'] == null && m.currentEv == null);

        if (needsFmp) {
            try {
                const fmp = await fetchFmpMetrics(sym);
                if (fmp && typeof fmp === 'object') {
                    if (m.roeTTM == null) m.roeTTM = fmp.returnOnEquityTTM ?? fmp.roeTTM ?? null;
                    if (m.debtToEquityAnnual == null) m.debtToEquityAnnual = fmp.debtToEquityTTM ?? fmp.debtEquityRatioTTM ?? null;
                    if (m.evEbitdaTTM == null) m.evEbitdaTTM = fmp.enterpriseValueOverEBITDATTM ?? fmp.evToEbitdaTTM ?? null;
                    if (m.peTTM == null) m.peTTM = fmp.peRatioTTM ?? fmp.priceEarningsRatioTTM ?? null;
                    if (m.currentRatioAnnual == null) m.currentRatioAnnual = fmp.currentRatioTTM ?? null;
                    if (m.grossMarginTTM == null && fmp.grossProfitMarginTTM != null) m.grossMarginTTM = fmp.grossProfitMarginTTM * 100;
                    if (m.operatingMarginTTM == null && fmp.operatingProfitMarginTTM != null) m.operatingMarginTTM = fmp.operatingProfitMarginTTM * 100;
                    if (m.netProfitMarginTTM == null && fmp.netProfitMarginTTM != null) m.netProfitMarginTTM = fmp.netProfitMarginTTM * 100;
                }
            } catch (fmpErr) {}
        }

        finnhubMetricsCache.set(sym, data);
        return data;
    })();

    inFlightMetrics.set(sym, fetchPromise);
    try {
        return await fetchPromise;
    } finally {
        inFlightMetrics.delete(sym);
    }
}

async function resolveCachedRecommendations(symbol) {
    if (!symbol) return [];
    const sym = symbol.toUpperCase().trim();

    const cached = finnhubRecsCache.getData(sym);
    if (cached) return cached;

    if (inFlightRecs.has(sym)) {
        return await inFlightRecs.get(sym);
    }

    const fetchPromise = (async () => {
        if (process.env.FINNHUB_API_KEY) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                const res = await fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(sym)}&token=${process.env.FINNHUB_API_KEY}`, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data)) {
                        finnhubRecsCache.set(sym, data);
                        return data;
                    }
                }
            } catch (err) {}
        }
        finnhubRecsCache.set(sym, []);
        return [];
    })();

    inFlightRecs.set(sym, fetchPromise);
    try {
        return await fetchPromise;
    } finally {
        inFlightRecs.delete(sym);
    }
}

async function resolveCachedPeers(symbol) {
    if (!symbol) return [];
    const sym = symbol.toUpperCase().trim();

    const cached = finnhubPeersCache.getData(sym);
    if (cached) return cached;

    if (inFlightPeers.has(sym)) {
        return await inFlightPeers.get(sym);
    }

    const fetchPromise = (async () => {
        if (process.env.FINNHUB_API_KEY) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                const res = await fetch(`https://finnhub.io/api/v1/stock/peers?symbol=${encodeURIComponent(sym)}&token=${process.env.FINNHUB_API_KEY}`, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (res.ok) {
                    const peers = await res.json();
                    if (Array.isArray(peers) && peers.length > 1) {
                        const filtered = peers.filter(p => p && p.toUpperCase() !== sym).slice(0, 6);
                        if (filtered.length > 0) {
                            finnhubPeersCache.set(sym, filtered);
                            return filtered;
                        }
                    }
                }
            } catch (err) {}
        }

        const fallback = KNOWN_PEERS_FALLBACK[sym] || ['MSFT', 'GOOGL', 'AMZN', 'META'];
        finnhubPeersCache.set(sym, fallback);
        return fallback;
    })();

    inFlightPeers.set(sym, fetchPromise);
    try {
        return await fetchPromise;
    } finally {
        inFlightPeers.delete(sym);
    }
}

async function fetchCachedFinnhubMetrics(symbol) {
    return await resolveCachedMetrics(symbol);
}

module.exports = {
    // Shared Caches
    yahooChartCache,
    finnhubQuoteCache,
    finnhubProfileCache,
    finnhubMetricsCache,
    finnhubRecsCache,
    finnhubPeersCache,

    // Core Provider Functions
    fetchFinnhubQuote,
    fetchFinnhubHistory,
    fetchTwelveDataQuote,
    fetchFmpQuote,
    fetchYahooIndexQuote,
    fetchYahooProfile,
    fetchYahooQuote,
    fetchYahooTimeSeries,
    fetchYahooChart,
    fetchFmpMetrics,
    fetchCachedFinnhubMetrics,
    fetchAlphaVantageCommodity,
    fetchAlphaVantageForexDaily,

    // Unified Cached Resolvers
    resolveCachedQuote,
    resolveCachedProfile,
    resolveCachedMetrics,
    resolveCachedRecommendations,
    resolveCachedPeers
};
