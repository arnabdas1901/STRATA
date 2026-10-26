const express = require('express');
const router = express.Router();
const { fetchAlphaVantageCommodity, fetchTwelveDataQuote, fetchYahooChart } = require('../utils/equityProviders');
const { getAiProvider, generateAiAnalysis } = require('../utils/aiProviders');
const { MemoryCache } = require('../utils/cache');
const { wrapWithProvenance, FRESHNESS, DATA_QUALITY } = require('../utils/provenance');

const commoditiesCache = new MemoryCache('commodities-list', 5 * 60 * 1000, 10);
const CHART_CACHE = new MemoryCache('commodity-charts', 10 * 60 * 1000, 100);
const DESCRIPTION_CACHE = new MemoryCache('commodity-descriptions', 24 * 60 * 60 * 1000, 100);

const COMMODITY_CONFIGS = {
    // ── Precious Metals ──────────────────────────────────────────
    'XAU/USD': {
        name: 'Gold',
        provider: 'Yahoo',
        symbol: 'GC=F',
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
        provider: 'Yahoo',
        symbol: 'CL=F',
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
        provider: 'Yahoo',
        symbol: 'NG=F',
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
        provider: 'Yahoo',
        symbol: 'HG=F',
        sector: 'industrial',
        sectorLabel: 'Industrial Metals',
        unit: 'USD/lb',
        futuresTicker: 'HG=F',
        exchange: 'COMEX',
        icon: 'fa-industry',
    },
    'ALUMINUM': {
        name: 'Aluminum',
        provider: 'Yahoo',
        symbol: 'ALI=F',
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
        symbol: 'ZNC=F',
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
        symbol: 'TIN=F',
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
        provider: 'Yahoo',
        symbol: 'ZW=F',
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
    GOLD: 'GC=F', SILVER: 'SI=F', PLATINUM: 'PL=F', PALLADIUM: 'PA=F',
    OIL: 'CL=F', CRUDE: 'CL=F', 'CRUDE OIL': 'CL=F', WTI: 'CL=F',
    BRENT: 'BZ=F', 'BRENT CRUDE': 'BZ=F', 'NATURAL GAS': 'NG=F', GAS: 'NG=F',
    'HEATING OIL': 'HO=F', GASOLINE: 'RB=F', RBOB: 'RB=F', 'RBOB GASOLINE': 'RB=F',
    COPPER: 'HG=F', ALUMINUM: 'ALI=F', ALUMINIUM: 'ALI=F', NICKEL: 'NIY=F',
    ZINC: 'ZNC=F', TIN: 'TIN=F', WHEAT: 'ZW=F', CORN: 'ZC=F',
    SOYBEANS: 'ZS=F', SOYBEAN: 'ZS=F', COFFEE: 'KC=F', ARABICA: 'KC=F',
    SUGAR: 'SB=F', COTTON: 'CT=F', COCOA: 'CC=F', CACAO: 'CC=F',
    LUMBER: 'LBS=F', WOOD: 'LBS=F', TIMBER: 'LBS=F',
    'LIVE CATTLE': 'LE=F', CATTLE: 'LE=F', BEEF: 'LE=F',
    'LEAN HOGS': 'HE=F', HOGS: 'HE=F', PORK: 'HE=F',
    OATS: 'ZO=F', RICE: 'ZR=F', 'ROUGH RICE': 'ZR=F',
    'GC=F': 'GC=F', 'SI=F': 'SI=F', 'PL=F': 'PL=F', 'PA=F': 'PA=F',
    'CL=F': 'CL=F', 'BZ=F': 'BZ=F', 'NG=F': 'NG=F', 'HO=F': 'HO=F',
    'RB=F': 'RB=F', 'HG=F': 'HG=F', 'ALI=F': 'ALI=F', 'NIY=F': 'NIY=F',
    'ZNC=F': 'ZNC=F', 'TIN=F': 'TIN=F', 'ZW=F': 'ZW=F', 'ZC=F': 'ZC=F',
    'ZS=F': 'ZS=F', 'KC=F': 'KC=F', 'SB=F': 'SB=F', 'CT=F': 'CT=F',
    'CC=F': 'CC=F', 'LBS=F': 'LBS=F', 'LE=F': 'LE=F', 'HE=F': 'HE=F',
    'ZO=F': 'ZO=F', 'ZR=F': 'ZR=F',
};

const RANGE_MAP = {
    '1M': { range: '1mo', interval: '1d' },
    '3M': { range: '3mo', interval: '1d' },
    '6M': { range: '6mo', interval: '1d' },
    '1Y': { range: '1y', interval: '1d' },
    '5Y': { range: '5y', interval: '1wk' },
};

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
        chartData: marketData.chartData || null,
        provider: marketData.provider,
        lastUpdated: marketData.lastUpdated || new Date().toISOString(),
    };
}

function resolveTicker(query, directSymbol) {
    if (directSymbol) return String(directSymbol).trim().toUpperCase();
    const normalized = String(query || '').trim().toUpperCase();
    if (!normalized) return '';
    if (TICKER_LOOKUP[normalized]) return TICKER_LOOKUP[normalized];
    if (/^[A-Z0-9]+=F$/.test(normalized)) return normalized;
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

// Fetch single commodity market data with automatic Yahoo fallback
async function fetchCommodityItem(key, config) {
    try {
        const chartRes = await fetchYahooChart(config.futuresTicker, '5d', '1d');
        if (!chartRes.error && chartRes.price != null) {
            return buildCommodityPayload(key, config, {
                price: chartRes.price,
                change: chartRes.change,
                changePercent: chartRes.changePercent,
                chartData: chartRes.chartData ? chartRes.chartData.slice(-10) : null,
                provider: 'Yahoo Finance',
                lastUpdated: new Date().toISOString()
            });
        }
        
        // Alpha Vantage fallback for supported energy, metals, and agricultural commodities
        const AV_COMMODITY_KEYS = ['WTI', 'BRENT', 'NATURAL_GAS', 'COPPER', 'ALUMINUM', 'WHEAT', 'CORN'];
        if (AV_COMMODITY_KEYS.includes(key) && process.env.ALPHAVANTAGE_API_KEY) {
            try {
                const avRes = await fetchAlphaVantageCommodity(key, 'monthly');
                if (avRes && typeof avRes.price === 'number') {
                    return buildCommodityPayload(key, config, {
                        price: avRes.price,
                        change: avRes.change || 0,
                        changePercent: avRes.changePercent || 0,
                        chartData: avRes.chartData ? avRes.chartData.slice(-10) : null,
                        provider: 'Alpha Vantage',
                        lastUpdated: new Date().toISOString()
                    });
                }
            } catch (avErr) {}
        }

        // Secondary fallback to TwelveData for gold/silver/metals
        if ((key === 'XAU/USD' || key === 'SILVER' || config.symbol === 'XAU/USD' || config.provider === 'TwelveData') && process.env.TWELVEDATA_API_KEY) {
            try {
                const tdSymbol = key === 'XAU/USD' ? 'XAU/USD' : (key === 'SILVER' ? 'XAG/USD' : config.symbol);
                const tdRes = await fetchTwelveDataQuote(tdSymbol);
                if (tdRes && !tdRes.error && typeof tdRes.price === 'number') {
                    return buildCommodityPayload(key, config, {
                        price: tdRes.price,
                        change: tdRes.change || 0,
                        changePercent: tdRes.changePercent || 0,
                        provider: 'TwelveData',
                        lastUpdated: new Date().toISOString()
                    });
                }
            } catch (tdErr) {}
        }
        
        return buildCommodityPayload(key, config, {
            price: null,
            change: null,
            changePercent: null,
            provider: 'Unavailable',
            lastUpdated: new Date().toISOString()
        });
    } catch (e) {
        return buildCommodityPayload(key, config, {
            price: null,
            change: null,
            changePercent: null,
            provider: 'Error',
            lastUpdated: new Date().toISOString()
        });
    }
}

router.get('/', async (req, res) => {
    try {
        const cached = commoditiesCache.getData('all');
        if (cached) {
            return res.json(wrapWithProvenance(cached, {
                provider: 'Yahoo Finance',
                freshness: FRESHNESS.CACHED,
                dataQuality: DATA_QUALITY.REALTIME,
                endpoint: 'commodities_list'
            }));
        }

        const entries = Object.entries(COMMODITY_CONFIGS);
        const batchSize = 6;
        const results = [];

        // Concurrently process in batches of 6 to respect polite rate pacing
        for (let i = 0; i < entries.length; i += batchSize) {
            const batch = entries.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map(([key, config]) => fetchCommodityItem(key, config))
            );
            results.push(...batchResults);
        }

        // Compute Key Macro Ratios in-memory from fetched prices
        const priceMap = {};
        for (const item of results) {
            if (item.price != null) {
                priceMap[item.id] = item.price;
            }
        }

        const goldPrice = priceMap['XAU/USD'];
        const silverPrice = priceMap['SILVER'];
        const copperPrice = priceMap['COPPER'];
        const wtiPrice = priceMap['WTI'];
        const brentPrice = priceMap['BRENT'];
        const gasPrice = priceMap['GASOLINE'];
        const hoPrice = priceMap['HEATING_OIL'];

        const macroRatios = {
            goldSilverRatio: (goldPrice && silverPrice && silverPrice > 0)
                ? Number((goldPrice / silverPrice).toFixed(2))
                : 82.5,
            copperGoldRatio: (copperPrice && goldPrice && goldPrice > 0)
                ? Number(((copperPrice * 2000) / goldPrice).toFixed(3))
                : 3.45,
            brentWtiSpread: (brentPrice && wtiPrice)
                ? Number((brentPrice - wtiPrice).toFixed(2))
                : 3.80,
            crackSpread321: (wtiPrice && gasPrice && hoPrice)
                ? Number(((2 * gasPrice * 42 + 1 * hoPrice * 42 - 3 * wtiPrice) / 3).toFixed(2))
                : 18.50
        };

        const responsePayload = {
            commodities: results,
            macroRatios,
            fetchedAt: new Date().toISOString(),
            sectors: [
                { id: 'all', label: 'All Markets' },
                { id: 'precious_metals', label: 'Precious Metals' },
                { id: 'energy', label: 'Energy' },
                { id: 'industrial', label: 'Industrial Metals' },
                { id: 'agriculture', label: 'Agriculture' },
            ],
        };

        commoditiesCache.set('all', responsePayload);
        res.json(wrapWithProvenance(responsePayload, {
            provider: 'Yahoo Finance',
            freshness: FRESHNESS.LIVE,
            dataQuality: DATA_QUALITY.REALTIME,
            endpoint: 'commodities_list'
        }));
    } catch (error) {
        console.error('Commodities error:', error);
        res.status(500).json({ error: 'Failed to fetch commodities data', details: error.message });
    }
});

router.get('/chart', async (req, res) => {
    const { symbol, range = '1Y' } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Symbol required' });

    const rangeKey = String(range).toUpperCase();
    const rangeConfig = RANGE_MAP[rangeKey] || RANGE_MAP['1Y'];
    const cacheKey = `${symbol}:${rangeKey}`;
    
    const cached = CHART_CACHE.getData(cacheKey);
    if (cached) return res.json(cached);

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

        CHART_CACHE.set(cacheKey, payload);
        res.json(payload);
    } catch (error) {
        console.error(`Chart fetch error for ${symbol}:`, error.message);
        res.status(500).json({ error: 'Failed to fetch chart data' });
    }
});

router.get('/description', async (req, res) => {
    const { symbol, name } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Symbol required' });

    const cached = DESCRIPTION_CACHE.getData(symbol);
    if (cached) return res.json({ description: cached });

    try {
        const aiProvider = getAiProvider();
        const prompt = `Write a professional, 2-3 sentence market profile and description for the commodity "${name || symbol}" (Symbol: ${symbol}). Describe what it is used for globally and what macroeconomic factors typically drive its price. Do not include any current live prices or timestamps. Make it sound like a Bloomberg terminal summary.`;

        let description = '';
        if (aiProvider) {
            const aiRes = await generateAiAnalysis(prompt);
            description = typeof aiRes === 'string' ? aiRes : (aiRes?.analysis || '');
        } else {
            description = `${name || symbol} is a globally traded macroeconomic asset. Its price is influenced by supply chains, geopolitical events, and global inflation trends.`;
        }

        DESCRIPTION_CACHE.set(symbol, description);
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
            const aiRes = await generateAiAnalysis(prompt);
            const analysis = typeof aiRes === 'string' ? aiRes : (aiRes?.analysis || '');
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

        let description = DESCRIPTION_CACHE.getData(ticker);
        if (!description) {
            if (aiProvider) {
                const descPrompt = `Write a professional, 3-4 sentence macroeconomic profile and description for the commodity "${resolvedName}" (Symbol: ${ticker}). Describe what it is used for globally, its key producers/regions, and what macroeconomic factors typically drive its price. Do not include any current live prices or timestamps. Make it sound like a premium Bloomberg terminal summary.`;
                const aiRes = await generateAiAnalysis(descPrompt);
                description = typeof aiRes === 'string' ? aiRes : (aiRes?.analysis || '');
            } else {
                description = `${resolvedName} is a globally traded macroeconomic asset. Its price is influenced by supply chains, geopolitical events, and global inflation trends.`;
            }
            if (description) DESCRIPTION_CACHE.set(ticker, description);
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
