const express = require('express');
const router = express.Router();
const { normalizeCryptoQuery } = require('../utils/api');
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

router.get('/top', async (req, res) => {
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

router.get('/details', async (req, res) => {
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

router.get('/history', async (req, res) => {
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

        if (process.env.TWELVEDATA_API_KEY) {
            try {
                const tdSymbol = (symbol || id || queryValue).toUpperCase();
                const tdResponse = await fetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol)}/USD&interval=1day&outputsize=${daysNum}&apikey=${process.env.TWELVEDATA_API_KEY}`);
                const tdData = await tdResponse.json();
                
                if (tdData.status === 'ok' && Array.isArray(tdData.values)) {
                    const prices = tdData.values.map(v => [new Date(v.datetime).getTime(), parseFloat(v.close)]).reverse();
                    const total_volumes = tdData.values.map(v => [new Date(v.datetime).getTime(), parseFloat(v.volume || 0)]).reverse();
                    return res.json({ prices, total_volumes });
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

module.exports = router;
