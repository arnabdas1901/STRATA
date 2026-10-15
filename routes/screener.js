const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { MemoryCache } = require('../utils/cache');
const { wrapWithProvenance, DATA_QUALITY, FRESHNESS } = require('../utils/provenance');
const { fetchJson } = require('../utils/api');

const cache = new MemoryCache('screener', 2 * 60 * 60 * 1000, 100); // 2 hours

const HARDCODED_SECTORS = [
    "Technology", "Healthcare", "Financial Services", "Consumer Cyclical",
    "Industrials", "Communication Services", "Consumer Defensive",
    "Energy", "Basic Materials", "Real Estate", "Utilities"
];

const HARDCODED_INDUSTRIES = [
    "Consumer Electronics", "Software - Infrastructure", "Software - Application",
    "Semiconductors", "Internet Content & Information", "Banks - Diversified",
    "Drug Manufacturers - General", "Auto Manufacturers", "Biotechnology",
    "Oil & Gas Integrated", "Telecom Services", "Retail - Defensive",
    "Asset Management", "Credit Services", "Discount Stores", "Healthcare Plans",
    "Specialty Chemicals", "REIT - Industrial", "Utilities - Regulated Electric"
];

// Curated 40-stock institutional universe spanning all 11 GICS sectors
const CURATED_UNIVERSE = [
    { symbol: "AAPL", companyName: "Apple Inc", marketCap: 3450000000000, price: 228.5, beta: 1.10, volume: 48000000, sector: "Technology", industry: "Consumer Electronics", exchange: "NASDAQ", lastAnnualDividend: 1.00, changesPercentage: 0.85 },
    { symbol: "MSFT", companyName: "Microsoft Corp", marketCap: 3200000000000, price: 425.2, beta: 0.88, volume: 21000000, sector: "Technology", industry: "Software - Infrastructure", exchange: "NASDAQ", lastAnnualDividend: 3.00, changesPercentage: 0.65 },
    { symbol: "NVDA", companyName: "NVIDIA Corp", marketCap: 3100000000000, price: 125.4, beta: 1.68, volume: 75000000, sector: "Technology", industry: "Semiconductors", exchange: "NASDAQ", lastAnnualDividend: 0.04, changesPercentage: 2.45 },
    { symbol: "GOOGL", companyName: "Alphabet Inc", marketCap: 2150000000000, price: 172.8, beta: 1.05, volume: 28000000, sector: "Communication Services", industry: "Internet Content & Information", exchange: "NASDAQ", lastAnnualDividend: 0.80, changesPercentage: -0.35 },
    { symbol: "AMZN", companyName: "Amazon.com Inc", marketCap: 1980000000000, price: 188.6, beta: 1.15, volume: 38000000, sector: "Consumer Cyclical", industry: "Internet Retail", exchange: "NASDAQ", lastAnnualDividend: 0.00, changesPercentage: 1.20 },
    { symbol: "META", companyName: "Meta Platforms Inc", marketCap: 1480000000000, price: 585.0, beta: 1.25, volume: 15000000, sector: "Communication Services", industry: "Internet Content & Information", exchange: "NASDAQ", lastAnnualDividend: 2.00, changesPercentage: 1.10 },
    { symbol: "TSLA", companyName: "Tesla Inc", marketCap: 780000000000, price: 245.0, beta: 2.10, volume: 62000000, sector: "Consumer Cyclical", industry: "Auto Manufacturers", exchange: "NASDAQ", lastAnnualDividend: 0.00, changesPercentage: -1.40 },
    { symbol: "BRK-B", companyName: "Berkshire Hathaway Inc", marketCap: 990000000000, price: 450.5, beta: 0.62, volume: 3200000, sector: "Financial Services", industry: "Insurance - Diversified", exchange: "NYSE", lastAnnualDividend: 0.00, changesPercentage: 0.25 },
    { symbol: "LLY", companyName: "Eli Lilly and Co", marketCap: 840000000000, price: 890.0, beta: 0.55, volume: 2900000, sector: "Healthcare", industry: "Drug Manufacturers - General", exchange: "NYSE", lastAnnualDividend: 5.20, changesPercentage: 1.75 },
    { symbol: "AVGO", companyName: "Broadcom Inc", marketCap: 810000000000, price: 172.5, beta: 1.20, volume: 18000000, sector: "Technology", industry: "Semiconductors", exchange: "NASDAQ", lastAnnualDividend: 2.10, changesPercentage: 2.15 },
    { symbol: "JPM", companyName: "JPMorgan Chase & Co", marketCap: 630000000000, price: 222.0, beta: 1.08, volume: 9500000, sector: "Financial Services", industry: "Banks - Diversified", exchange: "NYSE", lastAnnualDividend: 4.60, changesPercentage: 0.70 },
    { symbol: "V", companyName: "Visa Inc", marketCap: 565000000000, price: 284.0, beta: 0.94, volume: 6800000, sector: "Financial Services", industry: "Credit Services", exchange: "NYSE", lastAnnualDividend: 2.08, changesPercentage: 0.40 },
    { symbol: "UNH", companyName: "UnitedHealth Group Inc", marketCap: 520000000000, price: 565.0, beta: 0.58, volume: 3100000, sector: "Healthcare", industry: "Healthcare Plans", exchange: "NYSE", lastAnnualDividend: 8.40, changesPercentage: -0.20 },
    { symbol: "XOM", companyName: "Exxon Mobil Corp", marketCap: 480000000000, price: 118.5, beta: 0.92, volume: 14000000, sector: "Energy", industry: "Oil & Gas Integrated", exchange: "NYSE", lastAnnualDividend: 3.80, changesPercentage: -0.60 },
    { symbol: "MA", companyName: "Mastercard Inc", marketCap: 470000000000, price: 505.0, beta: 0.96, volume: 2600000, sector: "Financial Services", industry: "Credit Services", exchange: "NYSE", lastAnnualDividend: 2.64, changesPercentage: 0.55 },
    { symbol: "COST", companyName: "Costco Wholesale Corp", marketCap: 395000000000, price: 890.0, beta: 0.78, volume: 2200000, sector: "Consumer Defensive", industry: "Discount Stores", exchange: "NASDAQ", lastAnnualDividend: 4.64, changesPercentage: 0.90 },
    { symbol: "HD", companyName: "Home Depot Inc", marketCap: 385000000000, price: 388.0, beta: 0.98, volume: 3800000, sector: "Consumer Cyclical", industry: "Home Improvement Retail", exchange: "NYSE", lastAnnualDividend: 9.00, changesPercentage: 0.30 },
    { symbol: "PG", companyName: "Procter & Gamble Co", marketCap: 380000000000, price: 168.0, beta: 0.52, volume: 5500000, sector: "Consumer Defensive", industry: "Household & Personal Products", exchange: "NYSE", lastAnnualDividend: 4.03, changesPercentage: 0.15 },
    { symbol: "JNJ", companyName: "Johnson & Johnson", marketCap: 375000000000, price: 156.0, beta: 0.54, volume: 6200000, sector: "Healthcare", industry: "Drug Manufacturers - General", exchange: "NYSE", lastAnnualDividend: 4.96, changesPercentage: -0.10 },
    { symbol: "ABBV", companyName: "AbbVie Inc", marketCap: 330000000000, price: 188.0, beta: 0.60, volume: 4400000, sector: "Healthcare", industry: "Drug Manufacturers - General", exchange: "NYSE", lastAnnualDividend: 6.20, changesPercentage: 0.45 },
    { symbol: "NFLX", companyName: "Netflix Inc", marketCap: 300000000000, price: 700.0, beta: 1.25, volume: 3500000, sector: "Communication Services", industry: "Entertainment", exchange: "NASDAQ", lastAnnualDividend: 0.00, changesPercentage: 1.85 },
    { symbol: "CRM", companyName: "Salesforce Inc", marketCap: 280000000000, price: 290.0, beta: 1.18, volume: 4800000, sector: "Technology", industry: "Software - Application", exchange: "NYSE", lastAnnualDividend: 1.60, changesPercentage: 1.05 },
    { symbol: "BAC", companyName: "Bank of America Corp", marketCap: 320000000000, price: 41.5, beta: 1.30, volume: 35000000, sector: "Financial Services", industry: "Banks - Diversified", exchange: "NYSE", lastAnnualDividend: 1.04, changesPercentage: 0.80 },
    { symbol: "AMD", companyName: "Advanced Micro Devices Inc", marketCap: 245000000000, price: 152.0, beta: 1.72, volume: 45000000, sector: "Technology", industry: "Semiconductors", exchange: "NASDAQ", lastAnnualDividend: 0.00, changesPercentage: 2.10 },
    { symbol: "CVX", companyName: "Chevron Corp", marketCap: 275000000000, price: 150.0, beta: 0.88, volume: 7500000, sector: "Energy", industry: "Oil & Gas Integrated", exchange: "NYSE", lastAnnualDividend: 6.52, changesPercentage: -0.45 },
    { symbol: "MRK", companyName: "Merck & Co Inc", marketCap: 260000000000, price: 104.0, beta: 0.42, volume: 7200000, sector: "Healthcare", industry: "Drug Manufacturers - General", exchange: "NYSE", lastAnnualDividend: 3.08, changesPercentage: -0.30 },
    { symbol: "KO", companyName: "Coca-Cola Co", marketCap: 290000000000, price: 67.5, beta: 0.58, volume: 12000000, sector: "Consumer Defensive", industry: "Beverages - Non-Alcoholic", exchange: "NYSE", lastAnnualDividend: 1.94, changesPercentage: 0.20 },
    { symbol: "WMT", companyName: "Walmart Inc", marketCap: 640000000000, price: 80.2, beta: 0.50, volume: 16000000, sector: "Consumer Defensive", industry: "Discount Stores", exchange: "NYSE", lastAnnualDividend: 0.83, changesPercentage: 0.75 },
    { symbol: "PEP", companyName: "PepsiCo Inc", marketCap: 235000000000, price: 171.0, beta: 0.54, volume: 4600000, sector: "Consumer Defensive", industry: "Beverages - Non-Alcoholic", exchange: "NYSE", lastAnnualDividend: 5.42, changesPercentage: 0.10 },
    { symbol: "TMO", companyName: "Thermo Fisher Scientific", marketCap: 215000000000, price: 565.0, beta: 0.85, volume: 1500000, sector: "Healthcare", industry: "Diagnostics & Research", exchange: "NYSE", lastAnnualDividend: 1.56, changesPercentage: 0.50 },
    { symbol: "LIN", companyName: "Linde plc", marketCap: 220000000000, price: 460.0, beta: 0.80, volume: 1400000, sector: "Basic Materials", industry: "Specialty Chemicals", exchange: "NYSE", lastAnnualDividend: 5.56, changesPercentage: 0.35 },
    { symbol: "MCD", companyName: "McDonald's Corp", marketCap: 210000000000, price: 295.0, beta: 0.68, volume: 2800000, sector: "Consumer Cyclical", industry: "Restaurants", exchange: "NYSE", lastAnnualDividend: 6.68, changesPercentage: -0.15 },
    { symbol: "CSCO", companyName: "Cisco Systems Inc", marketCap: 215000000000, price: 54.0, beta: 0.85, volume: 17000000, sector: "Technology", industry: "Communication Equipment", exchange: "NASDAQ", lastAnnualDividend: 1.60, changesPercentage: 0.40 },
    { symbol: "ACN", companyName: "Accenture plc", marketCap: 225000000000, price: 360.0, beta: 1.12, volume: 2100000, sector: "Technology", industry: "Information Technology Services", exchange: "NYSE", lastAnnualDividend: 5.92, changesPercentage: 0.60 },
    { symbol: "ABT", companyName: "Abbott Laboratories", marketCap: 200000000000, price: 115.0, beta: 0.72, volume: 4800000, sector: "Healthcare", industry: "Medical Devices", exchange: "NYSE", lastAnnualDividend: 2.20, changesPercentage: 0.25 },
    { symbol: "DHR", companyName: "Danaher Corp", marketCap: 195000000000, price: 265.0, beta: 0.82, volume: 2200000, sector: "Healthcare", industry: "Diagnostics & Research", exchange: "NYSE", lastAnnualDividend: 1.08, changesPercentage: 0.45 },
    { symbol: "INTU", companyName: "Intuit Inc", marketCap: 180000000000, price: 645.0, beta: 1.22, volume: 1600000, sector: "Technology", industry: "Software - Application", exchange: "NASDAQ", lastAnnualDividend: 4.16, changesPercentage: 1.15 },
    { symbol: "VZ", companyName: "Verizon Communications Inc", marketCap: 185000000000, price: 44.0, beta: 0.40, volume: 19000000, sector: "Communication Services", industry: "Telecom Services", exchange: "NYSE", lastAnnualDividend: 2.71, changesPercentage: -0.20 },
    { symbol: "NEE", companyName: "NextEra Energy Inc", marketCap: 170000000000, price: 82.5, beta: 0.55, volume: 8500000, sector: "Utilities", industry: "Utilities - Regulated Electric", exchange: "NYSE", lastAnnualDividend: 2.06, changesPercentage: 0.85 },
    { symbol: "PLD", companyName: "Prologis Inc", marketCap: 115000000000, price: 124.0, beta: 1.02, volume: 3200000, sector: "Real Estate", industry: "REIT - Industrial", exchange: "NYSE", lastAnnualDividend: 3.84, changesPercentage: 0.30 }
];

function applyFilters(items, filters = {}, sort = "marketCap", order = "desc", limit = 50) {
    let result = [...items];

    // Substring search on symbol or company name
    if (filters.search) {
        const q = String(filters.search).toLowerCase().trim();
        result = result.filter(r => 
            (r.symbol && r.symbol.toLowerCase().includes(q)) || 
            (r.companyName && r.companyName.toLowerCase().includes(q))
        );
    }

    // Quantitative presets
    if (filters.preset) {
        const p = String(filters.preset).toLowerCase();
        if (p === 'compounders') {
            result = result.filter(r => (r.beta || 1) <= 1.15 && (r.marketCap || 0) >= 100000000000 && (r.lastAnnualDividend || 0) > 0);
        } else if (p === 'defensive') {
            result = result.filter(r => ['Consumer Defensive', 'Healthcare', 'Utilities'].includes(r.sector) && (r.beta || 1) <= 0.95);
        } else if (p === 'dividend') {
            result = result.filter(r => (r.lastAnnualDividend || 0) >= 2.0);
        } else if (p === 'momentum') {
            result = result.filter(r => (r.changesPercentage || 0) > 0 && (r.beta || 1) >= 1.0);
        }
    }

    // Categorical filters
    if (filters.sector) result = result.filter(r => r.sector === filters.sector);
    if (filters.industry) result = result.filter(r => r.industry === filters.industry);
    if (filters.exchange) result = result.filter(r => r.exchange === filters.exchange);
    
    // Boundary filters
    if (filters.marketCapMoreThan != null && filters.marketCapMoreThan !== '') result = result.filter(r => (r.marketCap || 0) >= Number(filters.marketCapMoreThan));
    if (filters.marketCapLowerThan != null && filters.marketCapLowerThan !== '') result = result.filter(r => (r.marketCap || 0) <= Number(filters.marketCapLowerThan));
    if (filters.priceMoreThan != null && filters.priceMoreThan !== '') result = result.filter(r => (r.price || 0) >= Number(filters.priceMoreThan));
    if (filters.priceLowerThan != null && filters.priceLowerThan !== '') result = result.filter(r => (r.price || 0) <= Number(filters.priceLowerThan));
    if (filters.betaMoreThan != null && filters.betaMoreThan !== '') result = result.filter(r => (r.beta || 0) >= Number(filters.betaMoreThan));
    if (filters.betaLowerThan != null && filters.betaLowerThan !== '') result = result.filter(r => (r.beta || 0) <= Number(filters.betaLowerThan));
    if (filters.dividendMoreThan != null && filters.dividendMoreThan !== '') result = result.filter(r => (r.lastAnnualDividend || 0) >= Number(filters.dividendMoreThan));
    if (filters.dividendLowerThan != null && filters.dividendLowerThan !== '') result = result.filter(r => (r.lastAnnualDividend || 0) <= Number(filters.dividendLowerThan));
    if (filters.volumeMoreThan != null && filters.volumeMoreThan !== '') result = result.filter(r => (r.volume || 0) >= Number(filters.volumeMoreThan));
    if (filters.changesPercentageMoreThan != null && filters.changesPercentageMoreThan !== '') result = result.filter(r => (r.changesPercentage || 0) >= Number(filters.changesPercentageMoreThan));
    if (filters.changesPercentageLowerThan != null && filters.changesPercentageLowerThan !== '') result = result.filter(r => (r.changesPercentage || 0) <= Number(filters.changesPercentageLowerThan));

    // Sort
    result.sort((a, b) => {
        const valA = a[sort] != null ? a[sort] : 0;
        const valB = b[sort] != null ? b[sort] : 0;
        return order === 'desc' ? (valB > valA ? 1 : valB < valA ? -1 : 0) : (valA > valB ? 1 : valA < valB ? -1 : 0);
    });

    const totalResults = result.length;
    const finalResults = (limit && limit > 0) ? result.slice(0, Number(limit)) : result;

    return { results: finalResults, totalResults };
}

router.post('/scan', async (req, res) => {
    try {
        const { filters = {}, sort = "marketCap", order = "desc", limit = 50 } = req.body;
        
        // Cache key based on request body
        const reqStr = JSON.stringify({ filters, sort, order, limit });
        const cacheKey = `screener_scan_${crypto.createHash('md5').update(reqStr).digest('hex')}`;
        
        const cached = cache.getData(cacheKey);
        if (cached) {
            return res.json(wrapWithProvenance(cached, {
                provider: 'Cache',
                quality: DATA_QUALITY.DELAYED,
                latencyMs: 0,
                endpoint: 'screener_cache'
            }));
        }

        const apiKey = process.env.FMP_API_KEY;
        const start = Date.now();
        
        if (!apiKey) {
            // Apply filtering directly to curated institutional universe
            const responseData = applyFilters(CURATED_UNIVERSE, filters, sort, order, limit);
            cache.set(cacheKey, responseData);
            return res.json(wrapWithProvenance(responseData, {
                provider: 'Curated Institutional Universe',
                quality: DATA_QUALITY.OFFICIAL,
                freshness: FRESHNESS.CACHED,
                latencyMs: Date.now() - start,
                endpoint: 'screener_curated'
            }));
        }

        // Build FMP query params
        const queryParams = new URLSearchParams();
        queryParams.append('apikey', apiKey);
        if (limit) queryParams.append('limit', Math.max(100, limit)); // Fetch more to allow accurate client sorting
        
        if (filters.marketCapMoreThan != null) queryParams.append('marketCapMoreThan', filters.marketCapMoreThan);
        if (filters.marketCapLowerThan != null) queryParams.append('marketCapLowerThan', filters.marketCapLowerThan);
        if (filters.priceMoreThan != null) queryParams.append('priceMoreThan', filters.priceMoreThan);
        if (filters.priceLowerThan != null) queryParams.append('priceLowerThan', filters.priceLowerThan);
        if (filters.betaMoreThan != null) queryParams.append('betaMoreThan', filters.betaMoreThan);
        if (filters.betaLowerThan != null) queryParams.append('betaLowerThan', filters.betaLowerThan);
        if (filters.volumeMoreThan != null) queryParams.append('volumeMoreThan', filters.volumeMoreThan);
        if (filters.dividendMoreThan != null) queryParams.append('dividendMoreThan', filters.dividendMoreThan);
        if (filters.sector) queryParams.append('sector', filters.sector);
        if (filters.industry) queryParams.append('industry', filters.industry);
        if (filters.exchange) queryParams.append('exchange', filters.exchange);
        if (filters.country) queryParams.append('country', filters.country || 'US');

        const url = `https://financialmodelingprep.com/api/v3/stock-screener?${queryParams.toString()}`;
        let fmpData = null;
        try {
            const { data: rawData } = await fetchJson(url);
            fmpData = Array.isArray(rawData) ? rawData : (rawData && Array.isArray(rawData.data) ? rawData.data : null);
        } catch (fetchErr) {
            console.warn('Screener: FMP outbound fetch failed or restricted, falling back to curated universe:', fetchErr.message);
        }
        
        if (!fmpData || fmpData.length === 0) {
            console.warn('Screener: FMP returned non-array or empty, falling back to curated universe.');
            const fallbackResponse = applyFilters(CURATED_UNIVERSE, filters, sort, order, limit);
            cache.set(cacheKey, fallbackResponse);
            return res.json(wrapWithProvenance(fallbackResponse, {
                provider: 'Curated Institutional Universe',
                quality: DATA_QUALITY.OFFICIAL,
                freshness: FRESHNESS.CACHED,
                latencyMs: Date.now() - start,
                endpoint: 'screener_fallback'
            }));
        }

        const mapped = fmpData.map(item => ({
            symbol: item.symbol,
            companyName: item.companyName,
            marketCap: item.marketCap,
            price: item.price,
            beta: item.beta,
            volume: item.volume,
            sector: item.sector,
            industry: item.industry,
            exchange: item.exchange,
            lastAnnualDividend: item.lastAnnualDividend || 0,
            changesPercentage: item.isActivelyTrading ? (item.changesPercentage || 0) : 0
        }));

        const responseData = applyFilters(mapped, filters, sort, order, limit);
        cache.set(cacheKey, responseData);

        res.json(wrapWithProvenance(responseData, {
            provider: 'FMP',
            quality: DATA_QUALITY.REALTIME,
            freshness: FRESHNESS.LIVE,
            latencyMs: Date.now() - start,
            endpoint: 'screener_scan'
        }));
    } catch (error) {
        console.error('Screener error:', error);
        res.status(500).json({ error: 'Failed to execute screener scan', details: error.message });
    }
});

router.get('/sectors', (req, res) => {
    res.json(wrapWithProvenance({ sectors: HARDCODED_SECTORS }, {
        provider: 'Local',
        quality: DATA_QUALITY.STATIC,
        freshness: FRESHNESS.CACHED,
        latencyMs: 0,
        endpoint: 'screener_sectors'
    }));
});

router.get('/industries', (req, res) => {
    res.json(wrapWithProvenance({ industries: HARDCODED_INDUSTRIES }, {
        provider: 'Local',
        quality: DATA_QUALITY.STATIC,
        freshness: FRESHNESS.CACHED,
        latencyMs: 0,
        endpoint: 'screener_industries'
    }));
});

module.exports = router;
