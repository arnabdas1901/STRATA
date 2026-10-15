const cacheRegistry = [];

/**
 * A standard memory cache that stores multiple key-value pairs with TTL and eviction.
 * Supports flexible constructor signatures for backwards-compatibility.
 */
class MemoryCache {
    /**
     * @param {string|number|Object} name - Name of the cache (or ttlMs/options object)
     * @param {number} ttlMs - Time to live in milliseconds
     * @param {number} maxEntries - Maximum number of entries before eviction
     */
    constructor(name, ttlMs, maxEntries = 100) {
        if (typeof name === 'number') {
            this.name = 'cache';
            this.ttlMs = name < 86400 ? name * 1000 : name;
            this.maxEntries = typeof ttlMs === 'number' ? ttlMs : maxEntries;
        } else if (typeof name === 'object' && name !== null) {
            this.name = name.name || 'cache';
            this.ttlMs = name.ttlMs || (name.ttlSeconds ? name.ttlSeconds * 1000 : 60 * 60 * 1000);
            this.maxEntries = name.maxEntries || maxEntries;
        } else {
            this.name = typeof name === 'string' && name ? name : 'cache';
            this.ttlMs = typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : 60 * 60 * 1000;
            this.maxEntries = typeof maxEntries === 'number' && maxEntries > 0 ? maxEntries : 100;
        }

        // Safety fallback: default to 1 hour so entries never become immortal
        if (!this.ttlMs || this.ttlMs <= 0) {
            this.ttlMs = 60 * 60 * 1000;
        }

        this.store = new Map();
        
        // Stats
        this.hits = 0;
        this.misses = 0;
        this.evictions = 0;
        
        cacheRegistry.push(this);
    }
    
    /**
     * Retrieves an entry from the cache.
     * If data already has `_meta`, returns data directly to prevent double-wrapping.
     * @param {string} key - Cache key
     * @returns {Object|null} - Cached payload or null
     */
    get(key) {
        const entry = this.store.get(key);
        if (!entry) {
            this.misses++;
            return null;
        }
        
        const now = Date.now();
        const age = now - entry.cachedAt;
        
        // Check if expired
        if (age > this.ttlMs) {
            this.store.delete(key);
            this.misses++;
            return null;
        }
        
        this.hits++;

        // If the stored data is already an object containing `_meta`,
        // return data directly to avoid breaking response shapes on cache hits.
        if (entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data) && entry.data._meta) {
            return entry.data;
        }
        
        return {
            data: entry.data,
            meta: {
                cachedAt: entry.cachedAt,
                ttl: this.ttlMs,
                freshness: 'cached',
                provenance: entry.provenance
            }
        };
    }

    /**
     * Retrieves the raw unwrapped data directly from the cache without { data, meta } wrapping.
     * @param {string} key - Cache key
     * @returns {any|null}
     */
    getData(key) {
        const entry = this.store.get(key);
        if (!entry) {
            this.misses++;
            return null;
        }
        const now = Date.now();
        if (now - entry.cachedAt > this.ttlMs) {
            this.store.delete(key);
            this.misses++;
            return null;
        }
        this.hits++;
        return entry.data;
    }

    /**
     * Alias for getData.
     */
    getRaw(key) {
        return this.getData(key);
    }
    
    /**
     * Sets an entry in the cache.
     * @param {string} key - Cache key
     * @param {any} data - Data to cache
     * @param {Object} provenance - Provenance metadata
     */
    set(key, data, provenance = null) {
        // Enforce maxEntries before adding a new key
        if (this.store.size >= this.maxEntries && !this.store.has(key)) {
            // Trim oldest 20%
            const trimCount = Math.ceil(this.maxEntries * 0.2);
            let count = 0;
            for (const [k] of this.store) {
                if (count >= trimCount) break;
                this.store.delete(k);
                count++;
                this.evictions++;
            }
        }
        
        this.store.set(key, {
            data,
            provenance: typeof provenance === 'object' ? provenance : null,
            cachedAt: Date.now()
        });
    }
    
    /**
     * Checks if a valid (non-expired) entry exists for the given key.
     * @param {string} key - Cache key
     * @returns {boolean}
     */
    has(key) {
        const entry = this.store.get(key);
        if (!entry) return false;
        
        const now = Date.now();
        const age = now - entry.cachedAt;
        
        if (age > this.ttlMs) {
            this.store.delete(key);
            return false;
        }
        
        return true;
    }
    
    /**
     * Deletes an entry from the cache.
     * @param {string} key - Cache key
     * @returns {boolean} - True if an element existed and has been removed
     */
    delete(key) {
        return this.store.delete(key);
    }
    
    /**
     * Empties the cache.
     */
    clear() {
        this.store.clear();
    }
    
    /**
     * Returns stats for this cache.
     * @returns {Object}
     */
    stats() {
        return {
            name: this.name,
            entries: this.store.size,
            hits: this.hits,
            misses: this.misses,
            evictions: this.evictions
        };
    }
    
    /**
     * Returns the current number of entries in the cache.
     * @returns {number}
     */
    entries() {
        return this.store.size;
    }
}

/**
 * A singleton cache that stores only one value (useful for market-wide data).
 */
class SingletonCache {
    /**
     * @param {string} name - Name of the cache
     * @param {number} ttlMs - Time to live in milliseconds
     */
    constructor(name, ttlMs = 60 * 60 * 1000) {
        this.name = typeof name === 'string' && name ? name : 'singleton-cache';
        this.ttlMs = typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : 60 * 60 * 1000;
        this.entry = null;
        
        // Stats
        this.hits = 0;
        this.misses = 0;
        this.evictions = 0;
        
        cacheRegistry.push(this);
    }
    
    /**
     * Retrieves the single cached entry.
     * @returns {Object|null}
     */
    get() {
        if (!this.entry) {
            this.misses++;
            return null;
        }
        
        const now = Date.now();
        const age = now - this.entry.cachedAt;
        
        if (age > this.ttlMs) {
            this.entry = null;
            this.misses++;
            return null;
        }
        
        this.hits++;

        if (this.entry.data && typeof this.entry.data === 'object' && !Array.isArray(this.entry.data) && this.entry.data._meta) {
            return this.entry.data;
        }
        
        return {
            data: this.entry.data,
            meta: {
                cachedAt: this.entry.cachedAt,
                ttl: this.ttlMs,
                freshness: 'cached',
                provenance: this.entry.provenance
            }
        };
    }

    getData() {
        if (!this.entry) {
            this.misses++;
            return null;
        }
        const now = Date.now();
        if (now - this.entry.cachedAt > this.ttlMs) {
            this.entry = null;
            this.misses++;
            return null;
        }
        this.hits++;
        return this.entry.data;
    }
    
    /**
     * Sets the single cache entry.
     * @param {any} data - Data to cache
     * @param {Object} provenance - Provenance metadata
     */
    set(data, provenance = null) {
        this.entry = {
            data,
            provenance: typeof provenance === 'object' ? provenance : null,
            cachedAt: Date.now()
        };
    }
    
    /**
     * Checks if a valid (non-expired) entry exists.
     * @returns {boolean}
     */
    has() {
        if (!this.entry) return false;
        
        const now = Date.now();
        const age = now - this.entry.cachedAt;
        
        if (age > this.ttlMs) {
            this.entry = null;
            return false;
        }
        
        return true;
    }
    
    /**
     * Deletes the cache entry.
     * @returns {boolean}
     */
    delete() {
        if (this.entry) {
            this.entry = null;
            return true;
        }
        return false;
    }
    
    /**
     * Empties the cache.
     */
    clear() {
        this.entry = null;
    }
    
    /**
     * Returns stats for this cache.
     * @returns {Object}
     */
    stats() {
        return {
            name: this.name,
            entries: this.entry ? 1 : 0,
            hits: this.hits,
            misses: this.misses,
            evictions: this.evictions
        };
    }
    
    /**
     * Returns the current number of entries.
     * @returns {number}
     */
    entries() {
        return this.entry ? 1 : 0;
    }
}

/**
 * Returns stats from all registered caches.
 * @returns {Array<Object>}
 */
function getAllCacheStats() {
    return cacheRegistry.map(cache => cache.stats());
}

module.exports = {
    MemoryCache,
    SingletonCache,
    getAllCacheStats
};
