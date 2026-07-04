const { fetchJson } = require('./api');

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
const COINMARKETCAP_API_KEY = process.env.COINMARKETCAP_API_KEY;

function coinGeckoHeaders() {
    const headers = {};
    if (COINGECKO_API_KEY) {
        headers['x-cg-pro-api-key'] = COINGECKO_API_KEY;
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
            price_change_percentage_7d: quote.quote?.USD?.percent_change_7d ?? null,
            price_change_percentage_30d: quote.quote?.USD?.percent_change_30d ?? null,
            high_24h: { usd: quote.quote?.USD?.high_24h ?? null },
            low_24h: { usd: quote.quote?.USD?.low_24h ?? null },
            market_cap: { usd: quote.quote?.USD?.market_cap ?? null },
            total_volume: { usd: quote.quote?.USD?.volume_24h ?? null },
            circulating_supply: quote.circulating_supply ?? null,
            total_supply: quote.total_supply ?? null,
            max_supply: quote.max_supply ?? null,
            fully_diluted_valuation: { usd: quote.quote?.USD?.fully_diluted_market_cap ?? null },
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

module.exports = {
    fetchCoinGeckoTop,
    fetchCoinGeckoDetailsById,
    fetchCoinGeckoHistoryById,
    searchCoinGecko,
    findCoinGeckoIdBySymbol,
    fetchCoinMarketCapTop,
    fetchCoinMarketCapDetailsBySymbol,
    fetchCoinMarketCapSearch
};
