const express = require('express');
const router = express.Router();
const { fetchAlphaVantageCommodity, fetchTwelveDataQuote, fetchYahooChart } = require('../utils/equityProviders');
const { getAiProvider, generateAiAnalysis } = require('../utils/aiProviders');

const AV_CACHE_TTL = 2 * 60 * 60 * 1000;
const TD_CACHE_TTL = 5 * 60 * 1000;
const CHART_CACHE_TTL = 10 * 60 * 1000;

const COMMODITIES_CACHE = {
    'XAU/USD': { data: null, lastFetched: 0 },
    'SILVER': { data: null, lastFetched: 0 },
    'PLATINUM': { data: null, lastFetched: 0 },
    'PALLADIUM': { data: null, lastFetched: 0 },
    'WTI': { data: null, lastFetched: 0 },
    'BRENT': { data: null, lastFetched: 0 },
    'NATURAL_GAS': { data: null, lastFetched: 0 },
    'HEATING_OIL': { data: null, lastFetched: 0 },
    'GASOLINE': { data: null, lastFetched: 0 },
    'COPPER': { data: null, lastFetched: 0 },
    'ALUMINUM': { data: null, lastFetched: 0 },
    'NICKEL': { data: null, lastFetched: 0 },
    'ZINC': { data: null, lastFetched: 0 },
    'TIN': { data: null, lastFetched: 0 },
    'WHEAT': { data: null, lastFetched: 0 },
    'CORN': { data: null, lastFetched: 0 },
    'SOYBEANS': { data: null, lastFetched: 0 },
    'COFFEE': { data: null, lastFetched: 0 },
    'SUGAR': { data: null, lastFetched: 0 },
    'COTTON': { data: null, lastFetched: 0 },
    'COCOA': { data: null, lastFetched: 0 },
    'LUMBER': { data: null, lastFetched: 0 },
    'LIVE_CATTLE': { data: null, lastFetched: 0 },
    'LEAN_HOGS': { data: null, lastFetched: 0 },
    'OATS': { data: null, lastFetched: 0 },
    'RICE': { data: null, lastFetched: 0 },
};

const CHART_CACHE = {};

const COMMODITY_CONFIGS = {
    // ── Precious Metals ──────────────────────────────────────────
    'XAU/USD': {
        name: 'Gold',
        provider: 'TwelveData',
        symbol: 'XAU/USD',
        sector: 'precious_metals',
        sectorLabel: 'Precious Metals',
        unit: 'USD/oz',
        futuresTicker: 'GC=F',
        exchange: 'COMEX',
        icon: 'fa-gem',
    },
    'SILVER': {
        name: 'Silver',
        provider: 'Yahoo',
        symbol: 'SI=F',
        sector: 'precious_metals',
        sectorLabel: 'Precious Metals',
        unit: 'USD/oz',
        futuresTicker: 'SI=F',
        exchange: 'COMEX',
        icon: 'fa-coins',
    },
    'PLATINUM': {
        name: 'Platinum',
        provider: 'Yahoo',
        symbol: 'PL=F',
        sector: 'precious_metals',
        sectorLabel: 'Precious Metals',
        unit: 'USD/oz',
        futuresTicker: 'PL=F',
        exchange: 'NYMEX',
        icon: 'fa-ring',
    },
    'PALLADIUM': {
        name: 'Palladium',
        provider: 'Yahoo',
        symbol: 'PA=F',
        sector: 'precious_metals',
        sectorLabel: 'Precious Metals',
        unit: 'USD/oz',
        futuresTicker: 'PA=F',
        exchange: 'NYMEX',
        icon: 'fa-diamond',
    },

    // ── Energy ───────────────────────────────────────────────────
    'WTI': {
        name: 'WTI Crude Oil',
        provider: 'AlphaVantage',
        symbol: 'WTI',
        interval: 'daily',
        sector: 'energy',
        sectorLabel: 'Energy',
        unit: 'USD/bbl',
        futuresTicker: 'CL=F',
        exchange: 'NYMEX',
        icon: 'fa-oil-can',
    },
    'BRENT': {
        name: 'Brent Crude Oil',
        provider: 'Yahoo',
        symbol: 'BZ=F',
        sector: 'energy',
        sectorLabel: 'Energy',
        unit: 'USD/bbl',
        futuresTicker: 'BZ=F',
        exchange: 'ICE',
        icon: 'fa-oil-well',
    },
    'NATURAL_GAS': {
        name: 'Natural Gas',
        provider: 'AlphaVantage',
        symbol: 'NATURAL_GAS',
        interval: 'daily',
        sector: 'energy',
        sectorLabel: 'Energy',
        unit: 'USD/MMBtu',
        futuresTicker: 'NG=F',
        exchange: 'NYMEX',
        icon: 'fa-fire-flame-simple',
    },
    'HEATING_OIL': {
        name: 'Heating Oil',
        provider: 'Yahoo',
        symbol: 'HO=F',
        sector: 'energy',
        sectorLabel: 'Energy',
        unit: 'USD/gal',
        futuresTicker: 'HO=F',
        exchange: 'NYMEX',
        icon: 'fa-temperature-high',
    },
    'GASOLINE': {
        name: 'RBOB Gasoline',
        provider: 'Yahoo',
        symbol: 'RB=F',
        sector: 'energy',
        sectorLabel: 'Energy',
        unit: 'USD/gal',
        futuresTicker: 'RB=F',
        exchange: 'NYMEX',
        icon: 'fa-gas-pump',
    },

    // ── Industrial Metals ────────────────────────────────────────
    'COPPER': {
        name: 'Copper',
        provider: 'AlphaVantage',
        symbol: 'COPPER',
        interval: 'monthly',
        sector: 'industrial',
        sectorLabel: 'Industrial Metals',
        unit: 'USD/lb',
        futuresTicker: 'HG=F',
        exchange: 'COMEX',
        icon: 'fa-industry',
    },
    'ALUMINUM': {
        name: 'Aluminum',
        provider: 'AlphaVantage',
        symbol: 'ALUMINUM',
        interval: 'monthly',
        sector: 'industrial',
        sectorLabel: 'Industrial Metals',
        unit: 'USD/mt',
        futuresTicker: 'ALI=F',
        exchange: 'LME',
        icon: 'fa-cubes',
    },
    'NICKEL': {
        name: 'Nickel',
        provider: 'Yahoo',
        symbol: 'NIY=F',
        sector: 'industrial',
        sectorLabel: 'Industrial Metals',
        unit: 'USD/lb',
        futuresTicker: 'NIY=F',
        exchange: 'LME',
        icon: 'fa-magnet',
    },
    'ZINC': {
        name: 'Zinc',
        provider: 'Yahoo',
        symbol: 'ZINC',
        sector: 'industrial',
        sectorLabel: 'Industrial Metals',
        unit: 'USD/mt',
        futuresTicker: 'ZNC=F',
        exchange: 'LME',
        icon: 'fa-cubes-stacked',
    },
    'TIN': {
        name: 'Tin',
        provider: 'Yahoo',
        symbol: 'TIN',
        sector: 'industrial',
        sectorLabel: 'Industrial Metals',
        unit: 'USD/mt',
        futuresTicker: 'TIN=F',
        exchange: 'LME',
        icon: 'fa-cube',
    },

    // ── Agriculture ──────────────────────────────────────────────
    'WHEAT': {
        name: 'Wheat',
        provider: 'AlphaVantage',
        symbol: 'WHEAT',
        interval: 'monthly',
        sector: 'agriculture',
        sectorLabel: 'Agriculture',
        unit: 'USD/bushel',
        futuresTicker: 'ZW=F',
        exchange: 'CBOT',
        icon: 'fa-wheat-awn',
    },
    'CORN': {
        name: 'Corn',
        provider: 'Yahoo',
        symbol: 'ZC=F',
        sector: 'agriculture',
        sectorLabel: 'Agriculture',
        unit: 'USc/bushel',
        futuresTicker: 'ZC=F',
        exchange: 'CBOT',
        icon: 'fa-seedling',
    },
    'SOYBEANS': {
        name: 'Soybeans',
        provider: 'Yahoo',
        symbol: 'ZS=F',
        sector: 'agriculture',
        sectorLabel: 'Agriculture',
        unit: 'USc/bushel',
        futuresTicker: 'ZS=F',
        exchange: 'CBOT',
        icon: 'fa-leaf',
    },
    'COFFEE': {
        name: 'Coffee (Arabica)',
        provider: 'Yahoo',
        symbol: 'KC=F',
        sector: 'agriculture',
        sectorLabel: 'Agriculture',
        unit: 'USc/lb',
        futuresTicker: 'KC=F',
        exchange: 'ICE',
        icon: 'fa-mug-hot',
    },
    'SUGAR': {
        name: 'Sugar #11',
        provider: 'Yahoo',
        symbol: 'SB=F',
        sector: 'agriculture',
        sectorLabel: 'Agriculture',
        unit: 'USc/lb',
        futuresTicker: 'SB=F',
        exchange: 'ICE',
        icon: 'fa-candy-cane',
    },
    'COTTON': {
        name: 'Cotton #2',
        provider: 'Yahoo',
        symbol: 'CT=F',
        sector: 'agriculture',
        sectorLabel: 'Agriculture',
        unit: 'USc/lb',
        futuresTicker: 'CT=F',
        exchange: 'ICE',
        icon: 'fa-cloud',
    },
    'COCOA': {
        name: 'Cocoa',
        provider: 'Yahoo',
        symbol: 'CC=F',
        sector: 'agriculture',
        sectorLabel: 'Agriculture',
        unit: 'USD/mt',
        futuresTicker: 'CC=F',
        exchange: 'ICE',
        icon: 'fa-cookie',
    },
    'LUMBER': {
        name: 'Lumber',
        provider: 'Yahoo',
        symbol: 'LBS=F',
        sector: 'agriculture',
        sectorLabel: 'Agriculture',
        unit: 'USD/1000 bd ft',
        futuresTicker: 'LBS=F',
        exchange: 'CME',
        icon: 'fa-tree',
    },
    'LIVE_CATTLE': {
        name: 'Live Cattle',
        provider: 'Yahoo',
        symbol: 'LE=F',
        sector: 'agriculture',
        sectorLabel: 'Agriculture',
        unit: 'USc/lb',
        futuresTicker: 'LE=F',
        exchange: 'CME',
        icon: 'fa-cow',
    },
    'LEAN_HOGS': {
        name: 'Lean Hogs',
        provider: 'Yahoo',
        symbol: 'HE=F',
        sector: 'agriculture',
        sectorLabel: 'Agriculture',
        unit: 'USc/lb',
        futuresTicker: 'HE=F',
        exchange: 'CME',
        icon: 'fa-piggy-bank',
    },
    'OATS': {
        name: 'Oats',
        provider: 'Yahoo',
        symbol: 'ZO=F',
        sector: 'agriculture',
        sectorLabel: 'Agriculture',
        unit: 'USc/bushel',
        futuresTicker: 'ZO=F',
        exchange: 'CBOT',
        icon: 'fa-bowl-rice',
    },
    'RICE': {
        name: 'Rough Rice',
        provider: 'Yahoo',
        symbol: 'ZR=F',
        sector: 'agriculture',
        sectorLabel: 'Agriculture',
        unit: 'USD/cwt',
        futuresTicker: 'ZR=F',
        exchange: 'CBOT',
        icon: 'fa-plate-wheat',
    },
};

const TICKER_LOOKUP = {
    // Precious Metals
    GOLD: 'GC=F',
    SILVER: 'SI=F',
    PLATINUM: 'PL=F',
    PALLADIUM: 'PA=F',
    // Energy
    OIL: 'CL=F',
    CRUDE: 'CL=F',
    'CRUDE OIL': 'CL=F',
    WTI: 'CL=F',
    BRENT: 'BZ=F',
    'BRENT CRUDE': 'BZ=F',
    'NATURAL GAS': 'NG=F',
    GAS: 'NG=F',
    'HEATING OIL': 'HO=F',
    GASOLINE: 'RB=F',
    RBOB: 'RB=F',
    'RBOB GASOLINE': 'RB=F',
    // Industrial Metals
    COPPER: 'HG=F',
    ALUMINUM: 'ALI=F',
    ALUMINIUM: 'ALI=F',
    NICKEL: 'NIY=F',
    ZINC: 'ZNC=F',
    TIN: 'TIN=F',
    // Agriculture
    WHEAT: 'ZW=F',
    CORN: 'ZC=F',
    SOYBEANS: 'ZS=F',
    SOYBEAN: 'ZS=F',
    COFFEE: 'KC=F',
    ARABICA: 'KC=F',
    SUGAR: 'SB=F',
    COTTON: 'CT=F',
    COCOA: 'CC=F',
    CACAO: 'CC=F',
    LUMBER: 'LBS=F',
    WOOD: 'LBS=F',
    TIMBER: 'LBS=F',
    'LIVE CATTLE': 'LE=F',
    CATTLE: 'LE=F',
    BEEF: 'LE=F',
    'LEAN HOGS': 'HE=F',
    HOGS: 'HE=F',
    PORK: 'HE=F',
    OATS: 'ZO=F',
    RICE: 'ZR=F',
    'ROUGH RICE': 'ZR=F',
    // Direct futures tickers
    'GC=F': 'GC=F',
    'SI=F': 'SI=F',
    'PL=F': 'PL=F',
    'PA=F': 'PA=F',
    'CL=F': 'CL=F',
    'BZ=F': 'BZ=F',
    'NG=F': 'NG=F',
    'HO=F': 'HO=F',
    'RB=F': 'RB=F',
    'HG=F': 'HG=F',
    'ALI=F': 'ALI=F',
    'NIY=F': 'NIY=F',
    'ZNC=F': 'ZNC=F',
    'TIN=F': 'TIN=F',
    'ZW=F': 'ZW=F',
    'ZC=F': 'ZC=F',
    'ZS=F': 'ZS=F',
    'KC=F': 'KC=F',
    'SB=F': 'SB=F',
    'CT=F': 'CT=F',
    'CC=F': 'CC=F',
    'LBS=F': 'LBS=F',
    'LE=F': 'LE=F',
    'HE=F': 'HE=F',
    'ZO=F': 'ZO=F',
    'ZR=F': 'ZR=F',
};

const DESCRIPTION_CACHE = {};
const RANGE_MAP = {
    '1M': { range: '1mo', interval: '1d' },
    '3M': { range: '3mo', interval: '1d' },
    '6M': { range: '6mo', interval: '1d' },
    '1Y': { range: '1y', interval: '1d' },
    '5Y': { range: '5y', interval: '1wk' },
};

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

function buildCommodityPayload(key, config, marketData) {
    return {
        id: key,
        name: config.name,
        symbol: config.symbol,
        sector: config.sector,
        sectorLabel: config.sectorLabel,
        unit: config.unit,
        futuresTicker: config.futuresTicker,
        exchange: config.exchange,
        icon: config.icon,
        price: marketData.price,
        change: marketData.change,
        changePercent: marketData.changePercent,
        provider: marketData.provider,
        lastUpdated: marketData.lastUpdated,
    };
}

function resolveTicker(query, directSymbol) {
    if (directSymbol) {
        return String(directSymbol).trim().toUpperCase();
    }

    const normalized = String(query || '').trim().toUpperCase();
    if (!normalized) return '';

    if (TICKER_LOOKUP[normalized]) {
        return TICKER_LOOKUP[normalized];
    }

    if (/^[A-Z0-9]+=F$/.test(normalized)) {
        return normalized;
    }

    for (const [key, config] of Object.entries(COMMODITY_CONFIGS)) {
        if (config.name.toUpperCase() === normalized || key === normalized || config.symbol === normalized) {
            return config.futuresTicker;
        }
    }

    return '';
}

function findConfigByTicker(ticker) {
    return Object.values(COMMODITY_CONFIGS).find((config) => config.futuresTicker === ticker) || null;
}

router.get('/', async (req, res) => {
    const now = Date.now();
    const results = [];

    for (const [key, config] of Object.entries(COMMODITY_CONFIGS)) {
        const cacheEntry = COMMODITIES_CACHE[key];
        const ttl = config.provider === 'AlphaVantage' ? AV_CACHE_TTL : TD_CACHE_TTL;

        if (cacheEntry.data && now - cacheEntry.lastFetched < ttl) {
            results.push(cacheEntry.data);
            continue;
        }

        try {
            let data;
            if (config.provider === 'AlphaVantage') {
                await delay(1200);
                const response = await fetchAlphaVantageCommodity(config.symbol, config.interval);
                if (response.error) throw new Error(response.error);

                data = buildCommodityPayload(key, config, {
                    price: response.price,
                    change: response.change,
                    changePercent: response.changePercent,
                    provider: 'AlphaVantage',
                    lastUpdated: response.lastUpdated,
                });
            } else if (config.provider === 'TwelveData') {
                const response = await fetchTwelveDataQuote(config.symbol);
                if (response.error) throw new Error(response.error);

                data = buildCommodityPayload(key, config, {
                    price: response.price,
                    change: response.change,
                    changePercent: response.changePercent,
                    provider: 'TwelveData',
                    lastUpdated: new Date().toISOString(),
                });
            } else if (config.provider === 'Yahoo') {
                const response = await fetchYahooChart(config.futuresTicker, '5d', '1d');
                if (response.error) throw new Error(response.error);

                data = buildCommodityPayload(key, config, {
                    price: response.price,
                    change: response.change,
                    changePercent: response.changePercent,
                    provider: 'Yahoo Finance',
                    lastUpdated: new Date().toISOString(),
                });
            }

            COMMODITIES_CACHE[key] = { data, lastFetched: Date.now() };
            results.push(data);
        } catch (error) {
            console.error(`Error fetching commodity ${key}:`, error.message);
            if (cacheEntry.data) {
                results.push({ ...cacheEntry.data, stale: true });
            } else {
                results.push({
                    id: key,
                    name: config.name,
                    symbol: config.symbol,
                    sector: config.sector,
                    sectorLabel: config.sectorLabel,
                    unit: config.unit,
                    futuresTicker: config.futuresTicker,
                    exchange: config.exchange,
                    icon: config.icon,
                    error: 'Data currently unavailable',
                });
            }
        }
    }

    res.json({
        commodities: results,
        fetchedAt: new Date().toISOString(),
        sectors: [
            { id: 'all', label: 'All Markets' },
            { id: 'precious_metals', label: 'Precious Metals' },
            { id: 'energy', label: 'Energy' },
            { id: 'industrial', label: 'Industrial Metals' },
            { id: 'agriculture', label: 'Agriculture' },
        ],
    });
});

router.get('/chart', async (req, res) => {
    const { symbol, range = '1Y' } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Symbol required' });

    const rangeKey = String(range).toUpperCase();
    const rangeConfig = RANGE_MAP[rangeKey] || RANGE_MAP['1Y'];
    const cacheKey = `${symbol}:${rangeKey}`;
    const cached = CHART_CACHE[cacheKey];

    if (cached && Date.now() - cached.lastFetched < CHART_CACHE_TTL) {
        return res.json(cached.data);
    }

    try {
        const chartDataResponse = await fetchYahooChart(symbol, rangeConfig.range, rangeConfig.interval);
        if (chartDataResponse.error) {
            return res.status(404).json({ error: chartDataResponse.error });
        }

        const payload = {
            symbol,
            range: rangeKey,
            price: chartDataResponse.price,
            change: chartDataResponse.change,
            changePercent: chartDataResponse.changePercent,
            chartData: chartDataResponse.chartData,
            currency: chartDataResponse.raw?.currency || 'USD',
            exchange: chartDataResponse.raw?.exchangeName || null,
            shortName: chartDataResponse.raw?.shortName || symbol,
        };

        CHART_CACHE[cacheKey] = { data: payload, lastFetched: Date.now() };
        res.json(payload);
    } catch (error) {
        console.error(`Chart fetch error for ${symbol}:`, error.message);
        res.status(500).json({ error: 'Failed to fetch chart data' });
    }
});

router.get('/description', async (req, res) => {
    const { symbol, name } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Symbol required' });

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
    const { query, symbol: directSymbol } = req.query;
    if (!query && !directSymbol) {
        return res.status(400).json({ error: 'Search query or symbol required' });
    }

    try {
        const aiProvider = getAiProvider();
        let ticker = resolveTicker(query, directSymbol);
        let resolvedName = query || directSymbol;
        const knownConfig = findConfigByTicker(ticker);

        if (!ticker && aiProvider) {
            const prompt = `You are a financial data assistant. The user is searching for a commodity: '${query}'. Identify the primary Yahoo Finance ticker symbol for this commodity (e.g., GC=F for Gold, CL=F for Crude Oil, ZC=F for Corn, KC=F for Coffee, SB=F for Sugar). Reply ONLY with the exact ticker symbol, nothing else. If it's not a commodity, try your best to find a related commodity futures ticker.`;
            const { analysis } = await generateAiAnalysis(prompt);
            ticker = analysis.trim().replace(/["'.]/g, '').replace(/\s+/g, '').trim();
            if (TICKER_LOOKUP[ticker.toUpperCase()]) {
                ticker = TICKER_LOOKUP[ticker.toUpperCase()];
            }
        } else if (!ticker) {
            ticker = `${String(query).trim().toUpperCase()}=F`;
        }

        const chartDataResponse = await fetchYahooChart(ticker, '1y', '1d');
        if (chartDataResponse.error) {
            return res.status(404).json({ error: `Could not fetch data for ${ticker}. ${chartDataResponse.error}` });
        }

        resolvedName = chartDataResponse.raw?.shortName || knownConfig?.name || resolvedName;
        const configMatch = knownConfig || findConfigByTicker(ticker);

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
            sector: configMatch?.sector || 'other',
            sectorLabel: configMatch?.sectorLabel || 'Commodities',
            unit: configMatch?.unit || 'USD',
            exchange: configMatch?.exchange || chartDataResponse.raw?.exchangeName || 'Global',
            futuresTicker: ticker,
            icon: configMatch?.icon || 'fa-chart-line',
            price: chartDataResponse.price,
            change: chartDataResponse.change,
            changePercent: chartDataResponse.changePercent,
            chartData: chartDataResponse.chartData,
            description,
            provider: 'Yahoo Finance',
        });
    } catch (error) {
        console.error(`Error in commodity search for ${req.query.query}:`, error.message);
        res.status(500).json({ error: 'Failed to perform commodity search' });
    }
});

module.exports = router;
