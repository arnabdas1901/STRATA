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

module.exports = {
    fetchFinnhubQuote,
    fetchFinnhubHistory,
    fetchTwelveDataQuote,
    fetchFmpQuote,
    fetchYahooIndexQuote,
    fetchYahooChart,
    fetchFmpMetrics,
    fetchAlphaVantageCommodity
};
