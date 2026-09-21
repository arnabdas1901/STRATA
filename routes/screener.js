const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { MemoryCache } = require('../utils/cache');
const { wrapWithProvenance, DATA_QUALITY } = require('../utils/provenance');
const { fetchJson } = require('../utils/api');

const cache = new MemoryCache({ ttlSeconds: 7200 }); // 2 hours

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
    "Asset Management", "Credit Services"
];

router.post('/scan', async (req, res) => {
    try {
        const { filters = {}, sort = "marketCap", order = "desc", limit = 50 } = req.body;
        
        // Create cache key based on request body
        const reqStr = JSON.stringify({ filters, sort, order, limit });
        const cacheKey = `screener_scan_${crypto.createHash('md5').update(reqStr).digest('hex')}`;
        
        const cached = cache.get(cacheKey);
        if (cached) {
            return res.json(wrapWithProvenance(cached, {
                provider: 'FMP',
                quality: DATA_QUALITY.DELAYED,
                latencyMs: 0,
                endpoint: 'screener_cache'
            }));
        }

        const apiKey = process.env.FMP_API_KEY;
        const start = Date.now();
        
        if (!apiKey) {
            // Fallback list
            const fallbackData = {
                results: [
                    { symbol: "AAPL", companyName: "Apple Inc", marketCap: 3400000000000, price: 224.3, beta: 1.24, volume: 52000000, sector: "Technology", industry: "Consumer Electronics", exchange: "NASDAQ", lastAnnualDividend: 1.0, changesPercentage: 1.42 },
                    { symbol: "MSFT", companyName: "Microsoft Corp", marketCap: 3100000000000, price: 415.5, beta: 0.9, volume: 22000000, sector: "Technology", industry: "Software - Infrastructure", exchange: "NASDAQ", lastAnnualDividend: 3.0, changesPercentage: 0.8 },
                    { symbol: "GOOGL", companyName: "Alphabet Inc", marketCap: 2100000000000, price: 175.2, beta: 1.05, volume: 32000000, sector: "Communication Services", industry: "Internet Content & Information", exchange: "NASDAQ", lastAnnualDividend: 0.0, changesPercentage: -0.5 },
                    { symbol: "AMZN", companyName: "Amazon.com Inc", marketCap: 1900000000000, price: 185.0, beta: 1.15, volume: 45000000, sector: "Consumer Cyclical", industry: "Internet Retail", exchange: "NASDAQ", lastAnnualDividend: 0.0, changesPercentage: 2.1 }
                ],
                totalResults: 4
            };
            
            // Apply some rudimentary filtering on fallback
            let filteredResults = fallbackData.results;
            if (filters.sector) filteredResults = filteredResults.filter(r => r.sector === filters.sector);
            if (filters.marketCapMoreThan) filteredResults = filteredResults.filter(r => r.marketCap > filters.marketCapMoreThan);
            if (filters.marketCapLowerThan) filteredResults = filteredResults.filter(r => r.marketCap < filters.marketCapLowerThan);
            
            // Sort
            filteredResults.sort((a, b) => {
                const valA = a[sort] || 0;
                const valB = b[sort] || 0;
                return order === 'desc' ? valB - valA : valA - valB;
            });
            
            filteredResults = filteredResults.slice(0, limit);
            const responseData = { results: filteredResults, totalResults: filteredResults.length };
            
            cache.set(cacheKey, responseData);
            return res.json(wrapWithProvenance(responseData, {
                provider: 'Fallback',
                quality: DATA_QUALITY.MOCK,
                latencyMs: Date.now() - start,
                endpoint: 'screener_fallback'
            }));
        }

        // Build FMP URL
        const queryParams = new URLSearchParams();
        queryParams.append('apikey', apiKey);
        if (limit) queryParams.append('limit', limit);
        
        // Map filters
        if (filters.marketCapMoreThan !== null && filters.marketCapMoreThan !== undefined) queryParams.append('marketCapMoreThan', filters.marketCapMoreThan);
        if (filters.marketCapLowerThan !== null && filters.marketCapLowerThan !== undefined) queryParams.append('marketCapLowerThan', filters.marketCapLowerThan);
        if (filters.priceMoreThan !== null && filters.priceMoreThan !== undefined) queryParams.append('priceMoreThan', filters.priceMoreThan);
        if (filters.betaMoreThan !== null && filters.betaMoreThan !== undefined) queryParams.append('betaMoreThan', filters.betaMoreThan);
        if (filters.betaLowerThan !== null && filters.betaLowerThan !== undefined) queryParams.append('betaLowerThan', filters.betaLowerThan);
        if (filters.volumeMoreThan !== null && filters.volumeMoreThan !== undefined) queryParams.append('volumeMoreThan', filters.volumeMoreThan);
        if (filters.dividendMoreThan !== null && filters.dividendMoreThan !== undefined) queryParams.append('dividendMoreThan', filters.dividendMoreThan);
        if (filters.sector) queryParams.append('sector', filters.sector);
        if (filters.industry) queryParams.append('industry', filters.industry);
        if (filters.exchange) queryParams.append('exchange', filters.exchange);
        if (filters.country) queryParams.append('country', filters.country);

        const url = `https://financialmodelingprep.com/api/v3/stock-screener?${queryParams.toString()}`;
        const data = await fetchJson(url);
        
        if (!Array.isArray(data) || data.length === 0) {
            // FMP returned error or empty — use fallback
            console.warn('Screener: FMP returned non-array or empty, using fallback. Response:', JSON.stringify(data).slice(0, 200));
            const fallbackResults = [
                { symbol: "AAPL", companyName: "Apple Inc", marketCap: 3400000000000, price: 224.3, beta: 1.24, volume: 52000000, sector: "Technology", industry: "Consumer Electronics", exchange: "NASDAQ", lastAnnualDividend: 1.0, changesPercentage: 1.42 },
                { symbol: "MSFT", companyName: "Microsoft Corp", marketCap: 3100000000000, price: 415.5, beta: 0.9, volume: 22000000, sector: "Technology", industry: "Software - Infrastructure", exchange: "NASDAQ", lastAnnualDividend: 3.0, changesPercentage: 0.8 },
                { symbol: "GOOGL", companyName: "Alphabet Inc", marketCap: 2100000000000, price: 175.2, beta: 1.05, volume: 32000000, sector: "Communication Services", industry: "Internet Content & Information", exchange: "NASDAQ", lastAnnualDividend: 0.0, changesPercentage: -0.5 },
                { symbol: "AMZN", companyName: "Amazon.com Inc", marketCap: 1900000000000, price: 185.0, beta: 1.15, volume: 45000000, sector: "Consumer Cyclical", industry: "Internet Retail", exchange: "NASDAQ", lastAnnualDividend: 0.0, changesPercentage: 2.1 },
                { symbol: "NVDA", companyName: "NVIDIA Corp", marketCap: 2800000000000, price: 120.0, beta: 1.7, volume: 80000000, sector: "Technology", industry: "Semiconductors", exchange: "NASDAQ", lastAnnualDividend: 0.04, changesPercentage: 3.5 },
                { symbol: "TSLA", companyName: "Tesla Inc", marketCap: 800000000000, price: 250.0, beta: 2.0, volume: 65000000, sector: "Consumer Cyclical", industry: "Auto Manufacturers", exchange: "NASDAQ", lastAnnualDividend: 0.0, changesPercentage: -1.2 },
                { symbol: "META", companyName: "Meta Platforms Inc", marketCap: 1400000000000, price: 510.0, beta: 1.3, volume: 18000000, sector: "Communication Services", industry: "Internet Content & Information", exchange: "NASDAQ", lastAnnualDividend: 2.0, changesPercentage: 0.6 },
                { symbol: "BRK-B", companyName: "Berkshire Hathaway", marketCap: 900000000000, price: 420.0, beta: 0.6, volume: 3000000, sector: "Financial Services", industry: "Insurance - Diversified", exchange: "NYSE", lastAnnualDividend: 0.0, changesPercentage: 0.3 },
                { symbol: "JPM", companyName: "JPMorgan Chase & Co", marketCap: 600000000000, price: 210.0, beta: 1.1, volume: 10000000, sector: "Financial Services", industry: "Banks - Diversified", exchange: "NYSE", lastAnnualDividend: 4.6, changesPercentage: 0.9 },
                { symbol: "V", companyName: "Visa Inc", marketCap: 550000000000, price: 280.0, beta: 0.95, volume: 7000000, sector: "Financial Services", industry: "Credit Services", exchange: "NYSE", lastAnnualDividend: 2.1, changesPercentage: 0.4 },
            ];
            let filtered = fallbackResults;
            if (filters.sector) filtered = filtered.filter(r => r.sector === filters.sector);
            if (filters.marketCapMoreThan) filtered = filtered.filter(r => r.marketCap > filters.marketCapMoreThan);
            if (filters.marketCapLowerThan) filtered = filtered.filter(r => r.marketCap < filters.marketCapLowerThan);
            filtered.sort((a, b) => order === 'desc' ? (b[sort] || 0) - (a[sort] || 0) : (a[sort] || 0) - (b[sort] || 0));
            filtered = filtered.slice(0, limit);
            const responseData = { results: filtered, totalResults: filtered.length };
            cache.set(cacheKey, responseData);
            return res.json(wrapWithProvenance(responseData, { provider: 'fallback', dataQuality: DATA_QUALITY.SYNTHETIC, note: 'FMP screener unavailable, using curated fallback list' }));
        }

        let results = data.map(item => ({
            symbol: item.symbol,
            companyName: item.companyName,
            marketCap: item.marketCap,
            price: item.price,
            beta: item.beta,
            volume: item.volume,
            sector: item.sector,
            industry: item.industry,
            exchange: item.exchange,
            lastAnnualDividend: item.lastAnnualDividend,
            changesPercentage: item.isActivelyTrading ? (item.changesPercentage || 0) : 0
        }));
        
        // Sort since FMP stock-screener might not sort exactly as requested if sort param isn't supported in query
        results.sort((a, b) => {
            const valA = a[sort] || 0;
            const valB = b[sort] || 0;
            return order === 'desc' ? valB - valA : valA - valB;
        });

        // Limit
        results = results.slice(0, limit);

        const responseData = {
            results,
            totalResults: data.length // approximate if limit was applied at API level
        };

        cache.set(cacheKey, responseData);

        res.json(wrapWithProvenance(responseData, {
            provider: 'FMP',
            quality: DATA_QUALITY.REALTIME,
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
        latencyMs: 0,
        endpoint: 'screener_sectors'
    }));
});

router.get('/industries', (req, res) => {
    res.json(wrapWithProvenance({ industries: HARDCODED_INDUSTRIES }, {
        provider: 'Local',
        quality: DATA_QUALITY.STATIC,
        latencyMs: 0,
        endpoint: 'screener_industries'
    }));
});

module.exports = router;
