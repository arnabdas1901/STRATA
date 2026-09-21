/**
 * Data provenance metadata utilities for STRATA API responses.
 * Standardizes metadata so the frontend knows where data came from, its freshness, and quality.
 */

const FRESHNESS = {
    LIVE: 'live',
    CACHED: 'cached',
    STALE: 'stale',
    FALLBACK: 'fallback',
    ESTIMATED: 'estimated',
    SIMULATED: 'simulated'
};

const DATA_QUALITY = {
    OFFICIAL: 'official',
    PROVIDER: 'provider',
    PROXY: 'proxy',
    ESTIMATED: 'estimated',
    SYNTHETIC: 'synthetic'
};

const PROVIDER_NAMES = {
    finnhub: 'Finnhub',
    twelvedata: 'Twelve Data',
    fmp: 'Financial Modeling Prep',
    yahoo: 'Yahoo Finance',
    alphavantage: 'Alpha Vantage',
    fred: 'FRED (Federal Reserve)',
    sec: 'SEC EDGAR',
    coingecko: 'CoinGecko',
    coinmarketcap: 'CoinMarketCap',
    polygon: 'Polygon.io',
    frankfurter: 'Frankfurter (ECB)',
    groq: 'Groq AI',
    gemini: 'Google Gemini',
    computed: 'STRATA Analytics',
    simulated: 'Simulated Data'
};

/**
 * Computes freshness status based on cache time and TTL.
 * @param {string|number|Date} cachedAt - When the data was cached
 * @param {number} ttlMs - Time-to-live in milliseconds
 * @returns {string} One of the FRESHNESS enum values
 */
function computeFreshness(cachedAt, ttlMs) {
    if (!cachedAt) return FRESHNESS.LIVE;
    
    const cacheTime = new Date(cachedAt).getTime();
    const now = Date.now();
    
    if (now - cacheTime <= ttlMs) {
        return FRESHNESS.CACHED;
    }
    return FRESHNESS.STALE;
}

/**
 * Wraps data with provenance metadata.
 * @param {Object} data - The primary data to return
 * @param {Object} opts - Provenance options
 * @returns {Object} Data wrapped with _meta provenance object
 */
function wrapWithProvenance(data, opts = {}) {
    const dataObj = (data && typeof data === 'object' && !Array.isArray(data)) ? data : { data };
    
    return {
        ...dataObj,
        _meta: {
            provider: opts.provider || undefined,
            fallbackUsed: opts.fallbackUsed || false,
            fallbackProvider: opts.fallbackProvider || undefined,
            fetchedAt: new Date().toISOString(),
            cachedAt: opts.cachedAt || undefined,
            ttl: opts.ttl || undefined,
            freshness: opts.freshness || FRESHNESS.LIVE,
            dataQuality: opts.dataQuality || DATA_QUALITY.PROVIDER,
            note: opts.note || undefined
        }
    };
}

module.exports = {
    FRESHNESS,
    DATA_QUALITY,
    PROVIDER_NAMES,
    computeFreshness,
    wrapWithProvenance
};
