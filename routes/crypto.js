const express = require('express');
const router = express.Router();
const { normalizeCryptoQuery } = require('../utils/api');
const { MemoryCache } = require('../utils/cache');
const { wrapWithProvenance, DATA_QUALITY, FRESHNESS } = require('../utils/provenance');
const { 
    fetchCoinGeckoTop, 
    findCoinGeckoIdBySymbol, 
    fetchCoinGeckoDetailsById,
    fetchCoinMarketCapDetailsBySymbol,
    fetchCoinGeckoHistoryById,
    searchCoinGecko,
    fetchCoinMarketCapSearch,
    fetchCoinMarketCapTop
} = require('../utils/cryptoProviders');

const COINMARKETCAP_API_KEY = process.env.COINMARKETCAP_API_KEY;

// Rate-saving memory caches to respect free-tier CoinGecko / CMC limits
const cryptoTopCache = new MemoryCache('crypto-top', 3 * 60 * 1000, 20);
const cryptoDetailsCache = new MemoryCache('crypto-details', 10 * 60 * 1000, 100);
const cryptoHistoryCache = new MemoryCache('crypto-history', 15 * 60 * 1000, 100);
const cryptoSearchCache = new MemoryCache('crypto-search', 60 * 60 * 1000, 100);

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

// Derive tokenomics and float health metrics from supply and market data
function deriveTokenomics(data) {
    if (!data || !data.market_data) return data;
    const md = data.market_data;
    const circulating = md.circulating_supply || 0;
    const total = md.total_supply || md.max_supply || circulating;
    const max = md.max_supply || total;
    const mcap = md.market_cap?.usd || 0;
    const fdv = md.fully_diluted_valuation?.usd || (max && md.current_price?.usd ? max * md.current_price.usd : mcap);
    const volume24h = md.total_volume?.usd || 0;

    const circulatingPct = total > 0 ? Number(((circulating / total) * 100).toFixed(1)) : 100;
    const fdvToMcapRatio = mcap > 0 ? Number((fdv / mcap).toFixed(2)) : 1.0;
    const volumeToMcapRatio = mcap > 0 ? Number((volume24h / mcap).toFixed(3)) : 0;
    
    let floatHealth = 'Healthy Float';
    if (fdvToMcapRatio > 2.5) floatHealth = 'High FDV Overhang (Dilution Risk)';
    else if (fdvToMcapRatio > 1.5) floatHealth = 'Moderate FDV Overhang';
    else if (circulatingPct > 90) floatHealth = 'Fully Circulating';

    data.tokenomics = {
        circulatingSupply: circulating,
        totalSupply: total,
        maxSupply: max,
        circulatingPercent: circulatingPct,
        fdvToMcapRatio,
        volumeToMcapRatio,
        floatHealth
    };
    return data;
}

router.get('/top', async (req, res) => {
    const { limit } = req.query;
    const limitNum = Math.max(1, Math.min(12, parseInt(limit) || 6));
    const cacheKey = `top_${limitNum}`;

    const cached = cryptoTopCache.getData(cacheKey);
    if (cached) {
        return res.json(wrapWithProvenance(cached, {
            provider: 'CoinGecko',
            freshness: FRESHNESS.CACHED,
            dataQuality: DATA_QUALITY.REALTIME,
            endpoint: 'crypto_top'
        }));
    }

    try {
        const geckoData = await fetchCoinGeckoTop(limitNum);
        const mapped = mapCoinGeckoTopItems(geckoData);
        cryptoTopCache.set(cacheKey, mapped);
        return res.json(wrapWithProvenance(mapped, {
            provider: 'CoinGecko',
            freshness: FRESHNESS.LIVE,
            dataQuality: DATA_QUALITY.REALTIME,
            endpoint: 'crypto_top'
        }));
    } catch (geckoError) {
        console.warn('CoinGecko top coins failed, falling back to CoinMarketCap.', geckoError.message);
    }

    try {
        const cmcData = await fetchCoinMarketCapTop(limitNum);
        const mapped = mapCoinMarketCapTopItems(cmcData);
        cryptoTopCache.set(cacheKey, mapped);
        return res.json(wrapWithProvenance(mapped, {
            provider: 'CoinMarketCap',
            freshness: FRESHNESS.LIVE,
            dataQuality: DATA_QUALITY.REALTIME,
            endpoint: 'crypto_top'
        }));
    } catch (cmcError) {
        console.error('Failed to fetch top cryptocurrencies from both providers:', cmcError);
        return res.status(500).json({ error: 'Failed to fetch top cryptocurrencies' });
    }
});

router.get('/details', async (req, res) => {
    const { id, symbol } = req.query;
    const queryValue = normalizeCryptoQuery(id || symbol);
    if (!queryValue) return res.status(400).json({ error: 'Valid cryptocurrency ID or symbol is required' });

    const cacheKey = `details_${queryValue.toLowerCase()}`;
    const cached = cryptoDetailsCache.getData(cacheKey);
    if (cached) {
        return res.json(wrapWithProvenance(cached, {
            provider: 'CoinGecko',
            freshness: FRESHNESS.CACHED,
            dataQuality: DATA_QUALITY.REALTIME,
            endpoint: 'crypto_details'
        }));
    }

    try {
        try {
            const cryptoId = id || (await findCoinGeckoIdBySymbol(queryValue));
            if (cryptoId) {
                const data = await fetchCoinGeckoDetailsById(cryptoId);
                const enriched = deriveTokenomics(data);
                cryptoDetailsCache.set(cacheKey, enriched);
                return res.json(wrapWithProvenance(enriched, {
                    provider: 'CoinGecko',
                    freshness: FRESHNESS.LIVE,
                    dataQuality: DATA_QUALITY.REALTIME,
                    endpoint: 'crypto_details'
                }));
            }
        } catch (geckoError) {
            console.warn('CoinGecko details lookup failed, trying CoinMarketCap fallback.', geckoError.message);
        }

        if (COINMARKETCAP_API_KEY) {
            const symbolValue = (queryValue || '').toString().trim().toUpperCase();
            const cmcData = await fetchCoinMarketCapDetailsBySymbol(symbolValue);
            const enriched = deriveTokenomics(cmcData);
            cryptoDetailsCache.set(cacheKey, enriched);
            return res.json(wrapWithProvenance(enriched, {
                provider: 'CoinMarketCap',
                freshness: FRESHNESS.LIVE,
                dataQuality: DATA_QUALITY.REALTIME,
                endpoint: 'crypto_details'
            }));
        }

        return res.status(404).json({ error: 'Cryptocurrency details not found.' });
    } catch (error) {
        console.error('Cryptocurrency details error:', error);
        res.status(500).json({ error: 'Failed to fetch cryptocurrency details' });
    }
});

router.get('/history', async (req, res) => {
    const { id, symbol, days } = req.query;
    const queryValue = normalizeCryptoQuery(id || symbol);
    if (!queryValue) return res.status(400).json({ error: 'Valid cryptocurrency ID or symbol is required' });

    const daysNum = Math.max(7, Math.min(365, parseInt(days) || 365));
    const cacheKey = `history_${queryValue.toLowerCase()}_${daysNum}`;

    const cached = cryptoHistoryCache.getData(cacheKey);
    if (cached) {
        return res.json(wrapWithProvenance(cached, {
            provider: 'CoinGecko',
            freshness: FRESHNESS.CACHED,
            dataQuality: DATA_QUALITY.REALTIME,
            endpoint: 'crypto_history'
        }));
    }

    try {
        const geckoId = id || await findCoinGeckoIdBySymbol(queryValue);
        if (!geckoId) {
            return res.status(404).json({ error: 'Cryptocurrency history not found' });
        }
        const data = await fetchCoinGeckoHistoryById(geckoId, daysNum);
        cryptoHistoryCache.set(cacheKey, data);
        return res.json(wrapWithProvenance(data, {
            provider: 'CoinGecko',
            freshness: FRESHNESS.LIVE,
            dataQuality: DATA_QUALITY.REALTIME,
            endpoint: 'crypto_history'
        }));
    } catch (error) {
        console.error('CoinGecko History Error:', error);

        if (process.env.TWELVEDATA_API_KEY) {
            try {
                const tdSymbol = (symbol || id || queryValue).toUpperCase();
                const tdResponse = await fetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol)}/USD&interval=1day&outputsize=${daysNum}&apikey=${process.env.TWELVEDATA_API_KEY}`);
                const tdData = await tdResponse.json();
                
                if (tdData.status === 'ok' && Array.isArray(tdData.values)) {
                    const prices = tdData.values.map(v => [new Date(v.datetime).getTime(), parseFloat(v.close)]).reverse();
                    const total_volumes = tdData.values.map(v => [new Date(v.datetime).getTime(), parseFloat(v.volume || 0)]).reverse();
                    const result = { prices, total_volumes };
                    cryptoHistoryCache.set(cacheKey, result);
                    return res.json(wrapWithProvenance(result, {
                        provider: 'TwelveData',
                        freshness: FRESHNESS.LIVE,
                        dataQuality: DATA_QUALITY.PROVIDER,
                        endpoint: 'crypto_history'
                    }));
                }
            } catch (tdError) {
                console.error('TwelveData Crypto History Fallback Error:', tdError);
            }
        }

        res.status(500).json({ error: 'Failed to fetch cryptocurrency history' });
    }
});

router.get('/search', async (req, res) => {
    const query = normalizeCryptoQuery(req.query.query);
    if (!query) return res.status(400).json({ error: 'Valid search query is required' });

    const cacheKey = `search_${query.toLowerCase()}`;
    const cached = cryptoSearchCache.getData(cacheKey);
    if (cached) return res.json(cached);

    try {
        const coins = await searchCoinGecko(query);
        const result = { coins };
        cryptoSearchCache.set(cacheKey, result);
        return res.json(result);
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
            const result = { coins };
            cryptoSearchCache.set(cacheKey, result);
            return res.json(result);
        } catch (cmcError) {
            console.error('CoinMarketCap search failed:', cmcError);
        }
    }

    res.status(500).json({ error: 'Failed to search cryptocurrencies' });
});

module.exports = router;
