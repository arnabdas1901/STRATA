const express = require('express');
const router = express.Router();
const { fetchAlphaVantageCommodity, fetchTwelveDataQuote, fetchYahooChart } = require('../utils/equityProviders');
const { getAiProvider, generateAiAnalysis } = require('../utils/aiProviders');

// Alpha Vantage Limit: 25 requests/day. We fetch 5 items.
// A 2-hour cache = 12 fetches/day * 5 items = 60 requests/day.
// Note: This exceeds the strict 25 req/day free limit if the server runs 24/7,
// but works fine for development/local sessions.
const AV_CACHE_TTL = 2 * 60 * 60 * 1000; 
const TD_CACHE_TTL = 5 * 60 * 1000; // Twelve Data limit: 800/day. We can cache for 5 mins.

const COMMODITIES_CACHE = {
    'XAU/USD': { data: null, lastFetched: 0 },
    'WTI': { data: null, lastFetched: 0 },
    'NATURAL_GAS': { data: null, lastFetched: 0 },
    'COPPER': { data: null, lastFetched: 0 },
    'ALUMINUM': { data: null, lastFetched: 0 },
    'WHEAT': { data: null, lastFetched: 0 }
};

const COMMODITY_CONFIGS = {
    'XAU/USD': { name: 'Gold', provider: 'TwelveData', symbol: 'XAU/USD', emoji: '🟡' },
    'WTI': { name: 'WTI Crude Oil', provider: 'AlphaVantage', symbol: 'WTI', interval: 'daily', emoji: '🛢️' },
    'NATURAL_GAS': { name: 'Natural Gas', provider: 'AlphaVantage', symbol: 'NATURAL_GAS', interval: 'daily', emoji: '🔥' },
    'COPPER': { name: 'Copper', provider: 'AlphaVantage', symbol: 'COPPER', interval: 'monthly', emoji: '🟠' },
    'ALUMINUM': { name: 'Aluminum', provider: 'AlphaVantage', symbol: 'ALUMINUM', interval: 'monthly', emoji: '⚙️' },
    'WHEAT': { name: 'Wheat', provider: 'AlphaVantage', symbol: 'WHEAT', interval: 'monthly', emoji: '🌾' }
};

const DESCRIPTION_CACHE = {};

// Helper to wait to avoid AV 1 req/sec limit burst
const delay = ms => new Promise(res => setTimeout(res, ms));

router.get('/', async (req, res) => {
    const now = Date.now();
    const results = [];
    
    // We will fetch sequentially to absolutely guarantee no burst limits are exceeded (AV is 1 req/sec)
    for (const [key, config] of Object.entries(COMMODITY_CONFIGS)) {
        const cacheEntry = COMMODITIES_CACHE[key];
        const ttl = config.provider === 'AlphaVantage' ? AV_CACHE_TTL : TD_CACHE_TTL;
        
        if (cacheEntry.data && (now - cacheEntry.lastFetched < ttl)) {
            results.push(cacheEntry.data);
            continue;
        }

        try {
            let data;
            if (config.provider === 'AlphaVantage') {
                await delay(1200); // Wait 1.2s to prevent 1req/sec AV limit
                const response = await fetchAlphaVantageCommodity(config.symbol, config.interval);
                if (response.error) throw new Error(response.error);
                
                data = {
                    id: key,
                    name: config.name,
                    symbol: config.symbol,
                    emoji: config.emoji,
                    price: response.price,
                    change: response.change,
                    changePercent: response.changePercent,
                    provider: 'AlphaVantage',
                    lastUpdated: response.lastUpdated
                };
            } else if (config.provider === 'TwelveData') {
                const response = await fetchTwelveDataQuote(config.symbol);
                if (response.error) throw new Error(response.error);
                
                data = {
                    id: key,
                    name: config.name,
                    symbol: config.symbol,
                    emoji: config.emoji,
                    price: response.price,
                    change: response.change,
                    changePercent: response.changePercent,
                    provider: 'TwelveData',
                    lastUpdated: new Date().toISOString()
                };
            }

            COMMODITIES_CACHE[key] = { data, lastFetched: Date.now() };
            results.push(data);
        } catch (error) {
            console.error(`Error fetching commodity ${key}:`, error.message);
            // Fallback to cached data if possible, even if expired
            if (cacheEntry.data) {
                results.push({ ...cacheEntry.data, stale: true });
            } else {
                results.push({
                    id: key,
                    name: config.name,
                    symbol: config.symbol,
                    emoji: config.emoji,
                    error: 'Data currently unavailable (API Rate limit or timeout)'
                });
            }
        }
    }

    res.json({ commodities: results });
});

router.get('/description', async (req, res) => {
    const { symbol, name } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Symbol required' });

    // Cache permanently to never fry Groq API limits
    if (DESCRIPTION_CACHE[symbol]) {
        return res.json({ description: DESCRIPTION_CACHE[symbol] });
    }

    try {
        const aiProvider = getAiProvider();
        const prompt = `Write a professional, 2-3 sentence market profile and description for the commodity "${name || symbol}" (Symbol: ${symbol}). Describe what it is used for globally and what macroeconomic factors typically drive its price. Do not include any current live prices or timestamps. Make it sound like a Bloomberg terminal summary.`;
        
        let description = '';
        if (aiProvider) {
            const { analysis } = await generateAiAnalysis(prompt);
            description = analysis;
        } else {
            // Fallback
            description = `${name || symbol} is a globally traded macroeconomic asset. Its price is influenced by supply chains, geopolitical events, and global inflation trends.`;
        }

        DESCRIPTION_CACHE[symbol] = description;
        res.json({ description });
    } catch (error) {
        console.error(`AI Description error for ${symbol}:`, error.message);
        res.status(500).json({ error: 'Failed to generate description' });
    }
});

router.get('/search', async (req, res) => {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'Search query required' });

    try {
        const aiProvider = getAiProvider();
        let ticker = '';
        let resolvedName = query;

        // Step 1: Resolve Ticker via AI
        if (aiProvider) {
            const prompt = `You are a financial data assistant. The user is searching for a commodity: '${query}'. Identify the primary Yahoo Finance ticker symbol for this commodity (e.g., GC=F for Gold, CL=F for Crude Oil, ZC=F for Corn, KC=F for Coffee, SB=F for Sugar). Reply ONLY with the exact ticker symbol, nothing else. If it's not a commodity, try your best to find a related commodity futures ticker.`;
            const { analysis } = await generateAiAnalysis(prompt);
            ticker = analysis.trim();
            // Clean up any extra characters the AI might add
            ticker = ticker.replace(/["'.]/g, '').replace(/\s+/g, '').trim();
            
            // Hardcode some safety just in case
            if (ticker.toUpperCase() === 'GOLD') ticker = 'GC=F';
            if (ticker.toUpperCase() === 'SILVER') ticker = 'SI=F';
        } else {
            // Fallback simplistic mapping if no AI
            ticker = query.toUpperCase() + '=F';
        }

        // Step 2: Fetch Data from Yahoo
        const chartDataResponse = await fetchYahooChart(ticker, '1y', '1d');
        if (chartDataResponse.error) {
             return res.status(404).json({ error: `Could not fetch data for resolved ticker: ${ticker}. ${chartDataResponse.error}` });
        }

        resolvedName = chartDataResponse.raw.shortName || query;

        // Step 3: Generate Description
        let description = '';
        if (aiProvider) {
            const descPrompt = `Write a professional, 3-4 sentence macroeconomic profile and description for the commodity "${resolvedName}" (Symbol: ${ticker}). Describe what it is used for globally, its key producers/regions, and what macroeconomic factors typically drive its price. Do not include any current live prices or timestamps. Make it sound like a premium Bloomberg terminal summary.`;
            const { analysis } = await generateAiAnalysis(descPrompt);
            description = analysis;
        } else {
            description = `${resolvedName} is a globally traded macroeconomic asset. Its price is influenced by supply chains, geopolitical events, and global inflation trends.`;
        }

        res.json({
            name: resolvedName,
            symbol: ticker,
            price: chartDataResponse.price,
            change: chartDataResponse.change,
            changePercent: chartDataResponse.changePercent,
            chartData: chartDataResponse.chartData,
            description: description
        });

    } catch (error) {
        console.error(`Error in commodity search for ${req.query.query}:`, error.message);
        res.status(500).json({ error: 'Failed to perform commodity search' });
    }
});

module.exports = router;
