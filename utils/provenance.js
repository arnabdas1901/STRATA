/**
 * Data provenance metadata utilities for STRATA API responses.
 * Standardizes metadata so the frontend knows where data came from, its freshness, and quality.
 */

const FRESHNESS = {
    LIVE: 'live',
    REALTIME: 'live',
    CACHED: 'cached',
    DAILY: 'cached',
    STALE: 'stale',
    FALLBACK: 'fallback',
    ESTIMATED: 'estimated',
    SIMULATED: 'simulated'
};

const DATA_QUALITY = {
    OFFICIAL: 'official',
    EXACT: 'official',
    STATIC: 'official',
    PROVIDER: 'provider',
    REALTIME: 'provider',
    DELAYED: 'provider',
    PROXY: 'proxy',
    ESTIMATED: 'estimated',
    SYNTHETIC: 'synthetic',
    MOCK: 'synthetic'
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
    simulated: 'Simulated Data',
    local: 'STRATA Local'
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
 * Wraps data with provenance metadata. Resilient to object or positional options.
 * @param {Object} data - The primary data to return
 * @param {Object|string} opts - Provenance options or provider string
 * @returns {Object} Data wrapped with _meta provenance object
 */
function wrapWithProvenance(data, opts = {}, ...extraArgs) {
    let options = {};
    if (typeof opts === 'string') {
        options.provider = opts;
        if (extraArgs[0]) {
            options.dataQuality = extraArgs[0];
        }
        if (extraArgs[1]) {
            options.sources = extraArgs[1];
        }
    } else if (opts && typeof opts === 'object') {
        options = { ...opts };
    }

    const dataObj = (data && typeof data === 'object' && !Array.isArray(data)) ? data : { data };
    
    return {
        ...dataObj,
        _meta: {
            provider: options.provider || undefined,
            endpoint: options.endpoint || undefined,
            fallbackUsed: options.fallbackUsed || false,
            fallbackProvider: options.fallbackProvider || undefined,
            fetchedAt: options.timestamp || options.fetchedAt || new Date().toISOString(),
            cachedAt: options.cachedAt || undefined,
            ttl: options.ttl || undefined,
            latencyMs: options.latencyMs != null ? options.latencyMs : undefined,
            freshness: options.freshness || FRESHNESS.LIVE,
            dataQuality: options.dataQuality || options.quality || DATA_QUALITY.PROVIDER,
            note: options.note || undefined
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
