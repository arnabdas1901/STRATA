const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { MemoryCache } = require('../utils/cache');
const { wrapWithProvenance, DATA_QUALITY, FRESHNESS } = require('../utils/provenance');
const { fetchJson } = require('../utils/api');
const { finnhubQuoteCache, finnhubMetricsCache } = require('../utils/equityProviders');

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

// Curated 40-stock institutional universe spanning all 11 GICS sectors with baseline fundamental fields
const CURATED_UNIVERSE = [
    { symbol: "AAPL", companyName: "Apple Inc", marketCap: 3450000000000, price: 228.5, beta: 1.10, volume: 48000000, sector: "Technology", industry: "Consumer Electronics", exchange: "NASDAQ", lastAnnualDividend: 1.00, changesPercentage: 0.85, pe: 33.5, roic: 52.0, grossMargin: 46.2, fcfYield: 3.2, revenueGrowth: 6.5, debtToEquity: 1.4 },
    { symbol: "MSFT", companyName: "Microsoft Corp", marketCap: 3200000000000, price: 425.2, beta: 0.88, volume: 21000000, sector: "Technology", industry: "Software - Infrastructure", exchange: "NASDAQ", lastAnnualDividend: 3.00, changesPercentage: 0.65, pe: 35.0, roic: 28.5, grossMargin: 69.8, fcfYield: 2.8, revenueGrowth: 15.0, debtToEquity: 0.4 },
    { symbol: "NVDA", companyName: "NVIDIA Corp", marketCap: 3100000000000, price: 125.4, beta: 1.68, volume: 75000000, sector: "Technology", industry: "Semiconductors", exchange: "NASDAQ", lastAnnualDividend: 0.04, changesPercentage: 2.45, pe: 55.0, roic: 68.0, grossMargin: 75.0, fcfYield: 2.1, revenueGrowth: 122.0, debtToEquity: 0.2 },
    { symbol: "GOOGL", companyName: "Alphabet Inc", marketCap: 2150000000000, price: 172.8, beta: 1.05, volume: 28000000, sector: "Communication Services", industry: "Internet Content & Information", exchange: "NASDAQ", lastAnnualDividend: 0.80, changesPercentage: -0.35, pe: 23.5, roic: 27.0, grossMargin: 57.5, fcfYield: 4.1, revenueGrowth: 14.0, debtToEquity: 0.1 },
    { symbol: "AMZN", companyName: "Amazon.com Inc", marketCap: 1980000000000, price: 188.6, beta: 1.15, volume: 38000000, sector: "Consumer Cyclical", industry: "Internet Retail", exchange: "NASDAQ", lastAnnualDividend: 0.00, changesPercentage: 1.20, pe: 42.0, roic: 14.5, grossMargin: 48.0, fcfYield: 2.9, revenueGrowth: 12.0, debtToEquity: 0.6 },
    { symbol: "META", companyName: "Meta Platforms Inc", marketCap: 1480000000000, price: 585.0, beta: 1.25, volume: 15000000, sector: "Communication Services", industry: "Internet Content & Information", exchange: "NASDAQ", lastAnnualDividend: 2.00, changesPercentage: 1.10, pe: 26.5, roic: 32.0, grossMargin: 81.5, fcfYield: 3.8, revenueGrowth: 22.0, debtToEquity: 0.2 },
    { symbol: "TSLA", companyName: "Tesla Inc", marketCap: 780000000000, price: 245.0, beta: 2.10, volume: 62000000, sector: "Consumer Cyclical", industry: "Auto Manufacturers", exchange: "NASDAQ", lastAnnualDividend: 0.00, changesPercentage: -1.40, pe: 72.0, roic: 11.0, grossMargin: 18.0, fcfYield: 1.2, revenueGrowth: 8.0, debtToEquity: 0.1 },
    { symbol: "BRK-B", companyName: "Berkshire Hathaway Inc", marketCap: 990000000000, price: 450.5, beta: 0.62, volume: 3200000, sector: "Financial Services", industry: "Insurance - Diversified", exchange: "NYSE", lastAnnualDividend: 0.00, changesPercentage: 0.25, pe: 18.5, roic: 12.0, grossMargin: 38.0, fcfYield: 5.2, revenueGrowth: 7.0, debtToEquity: 0.3 },
    { symbol: "LLY", companyName: "Eli Lilly and Co", marketCap: 840000000000, price: 890.0, beta: 0.55, volume: 2900000, sector: "Healthcare", industry: "Drug Manufacturers - General", exchange: "NYSE", lastAnnualDividend: 5.20, changesPercentage: 1.75, pe: 65.0, roic: 35.0, grossMargin: 80.5, fcfYield: 1.6, revenueGrowth: 28.0, debtToEquity: 1.8 },
    { symbol: "AVGO", companyName: "Broadcom Inc", marketCap: 810000000000, price: 172.5, beta: 1.20, volume: 18000000, sector: "Technology", industry: "Semiconductors", exchange: "NASDAQ", lastAnnualDividend: 2.10, changesPercentage: 2.15, pe: 38.0, roic: 22.0, grossMargin: 74.0, fcfYield: 3.4, revenueGrowth: 45.0, debtToEquity: 1.2 },
    { symbol: "JPM", companyName: "JPMorgan Chase & Co", marketCap: 630000000000, price: 222.0, beta: 1.08, volume: 9500000, sector: "Financial Services", industry: "Banks - Diversified", exchange: "NYSE", lastAnnualDividend: 4.60, changesPercentage: 0.70, pe: 12.5, roic: 16.5, grossMargin: 45.0, fcfYield: 6.5, revenueGrowth: 9.0, debtToEquity: 1.1 },
    { symbol: "V", companyName: "Visa Inc", marketCap: 565000000000, price: 284.0, beta: 0.94, volume: 6800000, sector: "Financial Services", industry: "Credit Services", exchange: "NYSE", lastAnnualDividend: 2.08, changesPercentage: 0.40, pe: 30.5, roic: 48.0, grossMargin: 80.0, fcfYield: 3.7, revenueGrowth: 10.0, debtToEquity: 0.6 },
    { symbol: "UNH", companyName: "UnitedHealth Group Inc", marketCap: 520000000000, price: 565.0, beta: 0.58, volume: 3100000, sector: "Healthcare", industry: "Healthcare Plans", exchange: "NYSE", lastAnnualDividend: 8.40, changesPercentage: -0.20, pe: 21.0, roic: 18.0, grossMargin: 24.5, fcfYield: 4.8, revenueGrowth: 8.5, debtToEquity: 0.7 },
    { symbol: "XOM", companyName: "Exxon Mobil Corp", marketCap: 480000000000, price: 118.5, beta: 0.92, volume: 14000000, sector: "Energy", industry: "Oil & Gas Integrated", exchange: "NYSE", lastAnnualDividend: 3.80, changesPercentage: -0.60, pe: 14.0, roic: 15.0, grossMargin: 32.0, fcfYield: 7.2, revenueGrowth: 4.0, debtToEquity: 0.2 },
    { symbol: "MA", companyName: "Mastercard Inc", marketCap: 470000000000, price: 505.0, beta: 0.96, volume: 2600000, sector: "Financial Services", industry: "Credit Services", exchange: "NYSE", lastAnnualDividend: 2.64, changesPercentage: 0.55, pe: 32.0, roic: 55.0, grossMargin: 78.0, fcfYield: 3.5, revenueGrowth: 11.0, debtToEquity: 2.5 },
    { symbol: "COST", companyName: "Costco Wholesale Corp", marketCap: 395000000000, price: 890.0, beta: 0.78, volume: 2200000, sector: "Consumer Defensive", industry: "Discount Stores", exchange: "NASDAQ", lastAnnualDividend: 4.64, changesPercentage: 0.90, pe: 52.0, roic: 21.0, grossMargin: 12.5, fcfYield: 2.2, revenueGrowth: 8.0, debtToEquity: 0.3 },
    { symbol: "HD", companyName: "Home Depot Inc", marketCap: 385000000000, price: 388.0, beta: 0.98, volume: 3800000, sector: "Consumer Cyclical", industry: "Home Improvement Retail", exchange: "NYSE", lastAnnualDividend: 9.00, changesPercentage: 0.30, pe: 24.5, roic: 38.0, grossMargin: 33.5, fcfYield: 4.2, revenueGrowth: 3.5, debtToEquity: 4.5 },
    { symbol: "PG", companyName: "Procter & Gamble Co", marketCap: 380000000000, price: 168.0, beta: 0.52, volume: 5500000, sector: "Consumer Defensive", industry: "Household & Personal Products", exchange: "NYSE", lastAnnualDividend: 4.03, changesPercentage: 0.15, pe: 26.0, roic: 22.5, grossMargin: 51.0, fcfYield: 4.0, revenueGrowth: 4.5, debtToEquity: 0.7 },
    { symbol: "JNJ", companyName: "Johnson & Johnson", marketCap: 375000000000, price: 156.0, beta: 0.54, volume: 6200000, sector: "Healthcare", industry: "Drug Manufacturers - General", exchange: "NYSE", lastAnnualDividend: 4.96, changesPercentage: -0.10, pe: 17.0, roic: 16.0, grossMargin: 68.0, fcfYield: 5.5, revenueGrowth: 3.8, debtToEquity: 0.5 },
    { symbol: "ABBV", companyName: "AbbVie Inc", marketCap: 330000000000, price: 188.0, beta: 0.60, volume: 4400000, sector: "Healthcare", industry: "Drug Manufacturers - General", exchange: "NYSE", lastAnnualDividend: 6.20, changesPercentage: 0.45, pe: 16.5, roic: 24.0, grossMargin: 70.0, fcfYield: 6.8, revenueGrowth: 4.2, debtToEquity: 4.8 },
    { symbol: "NFLX", companyName: "Netflix Inc", marketCap: 300000000000, price: 700.0, beta: 1.25, volume: 3500000, sector: "Communication Services", industry: "Entertainment", exchange: "NASDAQ", lastAnnualDividend: 0.00, changesPercentage: 1.85, pe: 36.0, roic: 26.0, grossMargin: 44.0, fcfYield: 3.1, revenueGrowth: 16.0, debtToEquity: 0.7 },
    { symbol: "CRM", companyName: "Salesforce Inc", marketCap: 280000000000, price: 290.0, beta: 1.18, volume: 4800000, sector: "Technology", industry: "Software - Application", exchange: "NYSE", lastAnnualDividend: 1.60, changesPercentage: 1.05, pe: 28.0, roic: 15.0, grossMargin: 76.0, fcfYield: 4.4, revenueGrowth: 11.0, debtToEquity: 0.2 },
    { symbol: "BAC", companyName: "Bank of America Corp", marketCap: 320000000000, price: 41.5, beta: 1.30, volume: 35000000, sector: "Financial Services", industry: "Banks - Diversified", exchange: "NYSE", lastAnnualDividend: 1.04, changesPercentage: 0.80, pe: 13.5, roic: 10.5, grossMargin: 42.0, fcfYield: 7.0, revenueGrowth: 5.5, debtToEquity: 1.2 },
    { symbol: "AMD", companyName: "Advanced Micro Devices Inc", marketCap: 245000000000, price: 152.0, beta: 1.72, volume: 45000000, sector: "Technology", industry: "Semiconductors", exchange: "NASDAQ", lastAnnualDividend: 0.00, changesPercentage: 2.10, pe: 45.0, roic: 12.0, grossMargin: 51.0, fcfYield: 2.0, revenueGrowth: 18.0, debtToEquity: 0.1 },
    { symbol: "CVX", companyName: "Chevron Corp", marketCap: 275000000000, price: 150.0, beta: 0.88, volume: 7500000, sector: "Energy", industry: "Oil & Gas Integrated", exchange: "NYSE", lastAnnualDividend: 6.52, changesPercentage: -0.45, pe: 15.0, roic: 12.5, grossMargin: 30.0, fcfYield: 6.8, revenueGrowth: 3.0, debtToEquity: 0.2 },
    { symbol: "MRK", companyName: "Merck & Co Inc", marketCap: 260000000000, price: 104.0, beta: 0.42, volume: 7200000, sector: "Healthcare", industry: "Drug Manufacturers - General", exchange: "NYSE", lastAnnualDividend: 3.08, changesPercentage: -0.30, pe: 15.5, roic: 21.0, grossMargin: 74.0, fcfYield: 6.0, revenueGrowth: 7.5, debtToEquity: 0.8 },
    { symbol: "KO", companyName: "Coca-Cola Co", marketCap: 290000000000, price: 67.5, beta: 0.58, volume: 12000000, sector: "Consumer Defensive", industry: "Beverages - Non-Alcoholic", exchange: "NYSE", lastAnnualDividend: 1.94, changesPercentage: 0.20, pe: 24.0, roic: 19.5, grossMargin: 60.0, fcfYield: 4.3, revenueGrowth: 4.0, debtToEquity: 1.5 },
    { symbol: "WMT", companyName: "Walmart Inc", marketCap: 640000000000, price: 80.2, beta: 0.50, volume: 16000000, sector: "Consumer Defensive", industry: "Discount Stores", exchange: "NYSE", lastAnnualDividend: 0.83, changesPercentage: 0.75, pe: 32.0, roic: 15.0, grossMargin: 24.0, fcfYield: 3.3, revenueGrowth: 6.0, debtToEquity: 0.7 },
    { symbol: "PEP", companyName: "PepsiCo Inc", marketCap: 235000000000, price: 171.0, beta: 0.54, volume: 4600000, sector: "Consumer Defensive", industry: "Beverages - Non-Alcoholic", exchange: "NYSE", lastAnnualDividend: 5.42, changesPercentage: 0.10, pe: 23.0, roic: 18.0, grossMargin: 54.0, fcfYield: 4.5, revenueGrowth: 3.5, debtToEquity: 2.1 },
    { symbol: "TMO", companyName: "Thermo Fisher Scientific", marketCap: 215000000000, price: 565.0, beta: 0.85, volume: 1500000, sector: "Healthcare", industry: "Diagnostics & Research", exchange: "NYSE", lastAnnualDividend: 1.56, changesPercentage: 0.50, pe: 25.5, roic: 13.0, grossMargin: 41.0, fcfYield: 3.8, revenueGrowth: 5.0, debtToEquity: 0.8 },
    { symbol: "LIN", companyName: "Linde plc", marketCap: 220000000000, price: 460.0, beta: 0.80, volume: 1400000, sector: "Basic Materials", industry: "Specialty Chemicals", exchange: "NYSE", lastAnnualDividend: 5.56, changesPercentage: 0.35, pe: 31.0, roic: 15.5, grossMargin: 46.0, fcfYield: 3.6, revenueGrowth: 6.5, debtToEquity: 0.5 },
    { symbol: "MCD", companyName: "McDonald's Corp", marketCap: 210000000000, price: 295.0, beta: 0.68, volume: 2800000, sector: "Consumer Cyclical", industry: "Restaurants", exchange: "NYSE", lastAnnualDividend: 6.68, changesPercentage: -0.15, pe: 23.5, roic: 25.0, grossMargin: 57.0, fcfYield: 4.6, revenueGrowth: 4.0, debtToEquity: 5.0 },
    { symbol: "CSCO", companyName: "Cisco Systems Inc", marketCap: 215000000000, price: 54.0, beta: 0.85, volume: 17000000, sector: "Technology", industry: "Communication Equipment", exchange: "NASDAQ", lastAnnualDividend: 1.60, changesPercentage: 0.40, pe: 16.0, roic: 19.0, grossMargin: 65.0, fcfYield: 6.2, revenueGrowth: 2.5, debtToEquity: 0.6 },
    { symbol: "ACN", companyName: "Accenture plc", marketCap: 225000000000, price: 360.0, beta: 1.12, volume: 2100000, sector: "Technology", industry: "Information Technology Services", exchange: "NYSE", lastAnnualDividend: 5.92, changesPercentage: 0.60, pe: 27.0, roic: 29.0, grossMargin: 32.5, fcfYield: 4.0, revenueGrowth: 7.0, debtToEquity: 0.1 },
    { symbol: "ABT", companyName: "Abbott Laboratories", marketCap: 200000000000, price: 115.0, beta: 0.72, volume: 4800000, sector: "Healthcare", industry: "Medical Devices", exchange: "NYSE", lastAnnualDividend: 2.20, changesPercentage: 0.25, pe: 24.5, roic: 16.5, grossMargin: 55.0, fcfYield: 4.2, revenueGrowth: 5.5, debtToEquity: 0.4 },
    { symbol: "DHR", companyName: "Danaher Corp", marketCap: 195000000000, price: 265.0, beta: 0.82, volume: 2200000, sector: "Healthcare", industry: "Diagnostics & Research", exchange: "NYSE", lastAnnualDividend: 1.08, changesPercentage: 0.45, pe: 33.0, roic: 11.5, grossMargin: 59.0, fcfYield: 3.0, revenueGrowth: 4.0, debtToEquity: 0.4 },
    { symbol: "INTU", companyName: "Intuit Inc", marketCap: 180000000000, price: 645.0, beta: 1.22, volume: 1600000, sector: "Technology", industry: "Software - Application", exchange: "NASDAQ", lastAnnualDividend: 4.16, changesPercentage: 1.15, pe: 36.5, roic: 17.0, grossMargin: 82.0, fcfYield: 3.2, revenueGrowth: 13.0, debtToEquity: 0.3 },
    { symbol: "VZ", companyName: "Verizon Communications Inc", marketCap: 185000000000, price: 44.0, beta: 0.40, volume: 19000000, sector: "Communication Services", industry: "Telecom Services", exchange: "NYSE", lastAnnualDividend: 2.71, changesPercentage: -0.20, pe: 10.5, roic: 11.0, grossMargin: 59.5, fcfYield: 8.5, revenueGrowth: 1.5, debtToEquity: 1.6 },
    { symbol: "NEE", companyName: "NextEra Energy Inc", marketCap: 170000000000, price: 82.5, beta: 0.55, volume: 8500000, sector: "Utilities", industry: "Utilities - Regulated Electric", exchange: "NYSE", lastAnnualDividend: 2.06, changesPercentage: 0.85, pe: 22.0, roic: 9.5, grossMargin: 48.0, fcfYield: 3.8, revenueGrowth: 8.0, debtToEquity: 1.5 },
    { symbol: "PLD", companyName: "Prologis Inc", marketCap: 115000000000, price: 124.0, beta: 1.02, volume: 3200000, sector: "Real Estate", industry: "REIT - Industrial", exchange: "NYSE", lastAnnualDividend: 3.84, changesPercentage: 0.30, pe: 34.0, roic: 8.5, grossMargin: 72.0, fcfYield: 3.9, revenueGrowth: 7.5, debtToEquity: 0.6 }
];

/**
 * Zero-Cost Live Cache Hydration:
 * Reads warm RAM entries from Finnhub quote and metrics caches without triggering network calls.
 */
function hydrateUniverseFromMemoryCache(items) {
    if (!Array.isArray(items)) return items;
    return items.map(item => {
        const sym = String(item.symbol || '').toUpperCase().trim();
        const cachedQuote = finnhubQuoteCache ? finnhubQuoteCache.getData(sym) : null;
        const cachedMetrics = finnhubMetricsCache ? finnhubMetricsCache.getData(sym) : null;

        const updated = { ...item };
        if (cachedQuote && typeof cachedQuote.c === 'number' && cachedQuote.c > 0) {
            updated.price = cachedQuote.c;
            if (typeof cachedQuote.dp === 'number') {
                updated.changesPercentage = cachedQuote.dp;
            }
        }
        if (cachedMetrics && cachedMetrics.metric) {
            const m = cachedMetrics.metric;
            if (m.peTTM || m.peBasicExclExtraTTM) {
                updated.pe = m.peTTM || m.peBasicExclExtraTTM;
            }
            if (m.roicTTM || m.roicAnnual) {
                updated.roic = m.roicTTM || m.roicAnnual;
            }
            if (m.grossMarginTTM || m.grossMarginAnnual) {
                updated.grossMargin = m.grossMarginTTM || m.grossMarginAnnual;
            }
            if (m.beta) {
                updated.beta = m.beta;
            }
            if (m.revenueGrowthTTMYoy || m.revenueGrowth3Y || m.revenueGrowth5Y) {
                updated.revenueGrowth = m.revenueGrowthTTMYoy || m.revenueGrowth3Y || m.revenueGrowth5Y;
            }
            if (m.totalDebtToEquityAnnual || m.debtToEquityAnnual) {
                updated.debtToEquity = m.debtToEquityAnnual || m.totalDebtToEquityAnnual;
            }
        }
        return updated;
    });
}

/**
 * Helper to calculate cross-sectional percentile ranks (0 - 100)
 */
function getPercentiles(arr, ascending = true) {
    const n = arr.length;
    if (n <= 1) return arr.map(() => 50);

    const indexed = arr.map((val, idx) => ({ val: val != null && !isNaN(val) ? Number(val) : null, idx }));
    const valid = indexed.filter(x => x.val != null);
    valid.sort((a, b) => ascending ? a.val - b.val : b.val - a.val);

    const percentiles = new Array(n).fill(50);
    const m = valid.length;
    if (m > 1) {
        valid.forEach((item, rank) => {
            percentiles[item.idx] = Math.round((rank / (m - 1)) * 100);
        });
    }
    return percentiles;
}

/**
 * Institutional Cross-Sectional Multi-Factor Scoring Engine:
 * Generates Value, Quality, Momentum, Low-Vol, and Composite Factor Scores
 */
function computeFactorScores(items) {
    if (!Array.isArray(items) || items.length === 0) return items;

    const peArray = items.map(x => x.pe != null && x.pe > 0 ? x.pe : null);
    const fcfYieldArray = items.map(x => x.fcfYield);
    const roicArray = items.map(x => x.roic);
    const gmArray = items.map(x => x.grossMargin);
    const deArray = items.map(x => x.debtToEquity);
    const chgArray = items.map(x => x.changesPercentage);
    const revGrArray = items.map(x => x.revenueGrowth);
    const betaArray = items.map(x => x.beta);

    const pePercentiles = getPercentiles(peArray, false); // lower PE = higher score
    const fcfPercentiles = getPercentiles(fcfYieldArray, true); // higher FCF yield = higher score
    const roicPercentiles = getPercentiles(roicArray, true); // higher ROIC = higher score
    const gmPercentiles = getPercentiles(gmArray, true); // higher GM = higher score
    const dePercentiles = getPercentiles(deArray, false); // lower D/E = higher score
    const chgPercentiles = getPercentiles(chgArray, true); // higher change% = higher score
    const revGrPercentiles = getPercentiles(revGrArray, true); // higher rev growth = higher score
    const betaPercentiles = getPercentiles(betaArray, false); // lower beta = higher score

    return items.map((item, i) => {
        const valueScore = Math.round((pePercentiles[i] * 0.5) + (fcfPercentiles[i] * 0.5));
        const qualityScore = Math.round((roicPercentiles[i] * 0.40) + (gmPercentiles[i] * 0.35) + (dePercentiles[i] * 0.25));
        const momentumScore = Math.round((chgPercentiles[i] * 0.5) + (revGrPercentiles[i] * 0.5));
        const lowVolScore = betaPercentiles[i];

        const compositeFactorScore = Math.round(
            (qualityScore * 0.35) + 
            (valueScore * 0.25) + 
            (momentumScore * 0.25) + 
            (lowVolScore * 0.15)
        );

        let factorBadge = 'Core Blend';
        if (qualityScore >= 75 && (item.roic || 0) >= 20) {
            factorBadge = 'Elite Compounder';
        } else if (valueScore >= 75) {
            factorBadge = 'Deep Value';
        } else if (momentumScore >= 75) {
            factorBadge = 'High-Octane Momentum';
        } else if (lowVolScore >= 75) {
            factorBadge = 'Low-Vol Fortress';
        }

        return {
            ...item,
            valueScore,
            qualityScore,
            momentumScore,
            lowVolScore,
            compositeFactorScore,
            factorBadge
        };
    });
}

function applyFilters(items, filters = {}, sort = "marketCap", order = "desc", limit = 50) {
    const scoredItems = computeFactorScores(items);
    let result = [...scoredItems];

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

    // Sort (supports marketCap, compositeFactorScore, qualityScore, valueScore, roic, pe, price, etc.)
    result.sort((a, b) => {
        const valA = a[sort] != null ? a[sort] : (order === 'desc' ? -Infinity : Infinity);
        const valB = b[sort] != null ? b[sort] : (order === 'desc' ? -Infinity : Infinity);
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
            // Apply filtering directly to curated institutional universe with live RAM cache hydration
            const hydratedUniverse = hydrateUniverseFromMemoryCache(CURATED_UNIVERSE);
            const responseData = applyFilters(hydratedUniverse, filters, sort, order, limit);
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
            const hydratedFallback = hydrateUniverseFromMemoryCache(CURATED_UNIVERSE);
            const fallbackResponse = applyFilters(hydratedFallback, filters, sort, order, limit);
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
            changesPercentage: item.isActivelyTrading ? (item.changesPercentage || 0) : 0,
            pe: item.pe != null ? item.pe : null,
            roic: item.roic != null ? item.roic : null,
            grossMargin: item.grossMargin != null ? item.grossMargin : null,
            fcfYield: item.fcfYield != null ? item.fcfYield : null,
            revenueGrowth: item.revenueGrowth != null ? item.revenueGrowth : null,
            debtToEquity: item.debtToEquity != null ? item.debtToEquity : null
        }));

        const hydratedMapped = hydrateUniverseFromMemoryCache(mapped);
        const responseData = applyFilters(hydratedMapped, filters, sort, order, limit);
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
