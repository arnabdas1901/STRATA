const { parseMarketNumber } = require('./api');

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
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json',
        },
    });
    const data = await response.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta || {};
    
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    
    // Filter out nulls
    const chartData = [];
    for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] != null) {
            chartData.push({
                time: timestamps[i],
                close: closes[i]
            });
        }
    }

    const lastClose = [...closes].reverse().find((value) => Number.isFinite(value));
    const price = parseMarketNumber(meta.regularMarketPrice ?? lastClose);
    const previousClose = parseMarketNumber(meta.previousClose ?? meta.chartPreviousClose);

    if (!response.ok || price == null) {
        return { error: data?.chart?.error?.description || 'Yahoo chart unavailable', raw: data };
    }

    const change = previousClose != null ? price - previousClose : 0;
    const changePercent = previousClose ? (change / previousClose) * 100 : 0;

    return {
        price,
        change,
        changePercent,
        chartData,
        raw: {
            symbol,
            provider: 'Yahoo Finance',
            exchangeName: meta.exchangeName,
            shortName: meta.shortName || meta.symbol
        },
    };
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

module.exports = {
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
    fetchAlphaVantageCommodity,
    fetchAlphaVantageForexDaily
};
