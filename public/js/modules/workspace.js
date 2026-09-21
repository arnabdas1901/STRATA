(function() {
    // Helper for LocalStorage with JSON parsing/stringifying
    const storage = {
        get: (key, fallback = null) => {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : fallback;
            } catch (e) {
                console.error(`Error reading ${key} from localStorage`, e);
                return fallback;
            }
        },
        set: (key, value) => {
            try {
                localStorage.setItem(key, JSON.stringify(value));
            } catch (e) {
                console.error(`Error writing ${key} to localStorage`, e);
            }
        },
        remove: (key) => localStorage.removeItem(key)
    };

    // IndexedDB wrapper for async operations (Reports)
    const DB_NAME = 'strata_workspace';
    const STORE_REPORTS = 'reports';
    const DB_VERSION = 1;

    let dbPromise = null;

    function getDB() {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE_REPORTS)) {
                        db.createObjectStore(STORE_REPORTS, { keyPath: 'ticker' });
                    }
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }
        return dbPromise;
    }

    async function dbPut(storeName, data) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(data);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function dbGet(storeName, key) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function dbGetAll(storeName) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function dbDelete(storeName, key) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    window.StrataWorkspace = {
        watchlist: {
            add: (ticker) => {
                const list = storage.get('strata_watchlist', []);
                if (!list.includes(ticker)) {
                    list.push(ticker);
                    storage.set('strata_watchlist', list);
                }
            },
            remove: (ticker) => {
                const list = storage.get('strata_watchlist', []);
                storage.set('strata_watchlist', list.filter(t => t !== ticker));
            },
            getAll: () => storage.get('strata_watchlist', []),
            has: (ticker) => storage.get('strata_watchlist', []).includes(ticker)
        },

        recent: {
            add: (ticker, assetType = 'equity') => {
                let list = storage.get('strata_recent', []);
                list = list.filter(item => item.ticker !== ticker); // Remove existing to push to top
                list.unshift({ ticker, assetType, viewedAt: new Date().toISOString() });
                if (list.length > 20) list = list.slice(0, 20);
                storage.set('strata_recent', list);
            },
            getAll: () => storage.get('strata_recent', [])
        },

        screens: {
            save: (name, filters) => {
                const screens = storage.get('strata_saved_screens', {});
                screens[name] = filters;
                storage.set('strata_saved_screens', screens);
            },
            load: (name) => {
                const screens = storage.get('strata_saved_screens', {});
                return screens[name] || null;
            },
            list: () => Object.keys(storage.get('strata_saved_screens', {})),
            delete: (name) => {
                const screens = storage.get('strata_saved_screens', {});
                delete screens[name];
                storage.set('strata_saved_screens', screens);
            }
        },

        notes: {
            save: (ticker, noteText) => {
                const notes = storage.get('strata_notes', {});
                notes[ticker] = { note: noteText, updatedAt: new Date().toISOString() };
                storage.set('strata_notes', notes);
            },
            get: (ticker) => {
                const notes = storage.get('strata_notes', {});
                return notes[ticker] ? notes[ticker].note : '';
            },
            list: () => {
                const notes = storage.get('strata_notes', {});
                return Object.keys(notes).map(ticker => ({
                    ticker,
                    ...notes[ticker]
                }));
            },
            delete: (ticker) => {
                const notes = storage.get('strata_notes', {});
                delete notes[ticker];
                storage.set('strata_notes', notes);
            }
        },

        reports: {
            save: async (ticker, reportData) => {
                await dbPut(STORE_REPORTS, {
                    ticker,
                    data: reportData,
                    generatedAt: new Date().toISOString()
                });
            },
            get: async (ticker) => {
                return await dbGet(STORE_REPORTS, ticker);
            },
            list: async () => {
                const all = await dbGetAll(STORE_REPORTS);
                return all.map(r => ({ ticker: r.ticker, generatedAt: r.generatedAt }));
            },
            delete: async (ticker) => {
                await dbDelete(STORE_REPORTS, ticker);
            }
        },

        prefs: {
            set: (key, value) => {
                const prefs = storage.get('strata_prefs', {});
                prefs[key] = value;
                storage.set('strata_prefs', prefs);
            },
            get: (key, defaultValue) => {
                const prefs = storage.get('strata_prefs', {});
                return prefs[key] !== undefined ? prefs[key] : defaultValue;
            }
        },

        exportAll: async () => {
            const data = {
                watchlist: storage.get('strata_watchlist', []),
                recent: storage.get('strata_recent', []),
                screens: storage.get('strata_saved_screens', {}),
                notes: storage.get('strata_notes', {}),
                prefs: storage.get('strata_prefs', {}),
                reports: await dbGetAll(STORE_REPORTS)
            };
            
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const dateStr = new Date().toISOString().split('T')[0];
            a.href = url;
            a.download = `strata-workspace-${dateStr}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },

        importAll: (file) => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        const data = JSON.parse(e.target.result);
                        if (data.watchlist) storage.set('strata_watchlist', data.watchlist);
                        if (data.recent) storage.set('strata_recent', data.recent);
                        if (data.screens) storage.set('strata_saved_screens', data.screens);
                        if (data.notes) storage.set('strata_notes', data.notes);
                        if (data.prefs) storage.set('strata_prefs', data.prefs);
                        
                        if (data.reports && Array.isArray(data.reports)) {
                            for (const report of data.reports) {
                                await dbPut(STORE_REPORTS, report);
                            }
                        }
                        resolve(true);
                    } catch (err) {
                        console.error('Failed to import workspace:', err);
                        reject(err);
                    }
                };
                reader.readAsText(file);
            });
        }
    };
})();
