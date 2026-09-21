(function() {
    const PAGES = [
        { title: 'Equity Analysis', url: 'index.html', icon: 'fa-magnifying-glass-chart', type: 'page' },
        { title: 'Research Terminal', url: 'research.html', icon: 'fa-microscope', type: 'page' },
        { title: 'AI Analyst', url: 'ai.html', icon: 'fa-brain', type: 'page' },
        { title: 'Crypto Analysis', url: 'crypto.html', icon: 'fa-coins', type: 'page' },
        { title: 'Commodities', url: 'commodities.html', icon: 'fa-wheat-awn', type: 'page' },
        { title: 'Global Inflation', url: 'macro.html', icon: 'fa-earth-americas', type: 'page' },
        { title: 'Fixed Income', url: 'yields.html', icon: 'fa-landmark', type: 'page' },
        { title: 'Currencies', url: 'forex.html', icon: 'fa-money-bill-transfer', type: 'page' },
        { title: 'Stress Tester', url: 'stress.html', icon: 'fa-shield-halved', type: 'page' },
        { title: 'Mock Portfolio', url: 'portfolio.html', icon: 'fa-pie-chart', type: 'page' },
        { title: 'Financial Calculators', url: 'calculators.html', icon: 'fa-calculator', type: 'page' },
        { title: 'Screener', url: 'screener.html', icon: 'fa-filter', type: 'page' },
        { title: 'Correlations', url: 'correlation.html', icon: 'fa-diagram-project', type: 'page' },
        { title: 'Risk Lab', url: 'risk-lab.html', icon: 'fa-flask', type: 'page' },
        { title: 'Market Regime', url: 'regime.html', icon: 'fa-gauge-high', type: 'page' },
        { title: 'ETF Analyzer', url: 'etf.html', icon: 'fa-layer-group', type: 'page' },
        { title: 'Data Center', url: 'data-center.html', icon: 'fa-server', type: 'page' }
    ];

    let initialized = false;
    let overlay, input, resultsContainer;
    let currentResults = [];
    let selectedIndex = -1;

    function injectHTMLandCSS() {
        const style = document.createElement('style');
        style.textContent = `
            #strata-search-overlay {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(4px);
                z-index: 9999;
                display: flex;
                justify-content: center;
                align-items: flex-start;
                padding-top: 10vh;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.2s ease;
                font-family: 'Inter', sans-serif;
            }
            #strata-search-overlay.active {
                opacity: 1;
                pointer-events: all;
            }
            .strata-search-modal {
                width: 100%;
                max-width: 600px;
                background: #0f1629;
                border: 1px solid #1e293b;
                border-radius: 12px;
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.2);
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }
            .strata-search-modal input {
                width: 100%;
                background: transparent;
                border: none;
                padding: 20px;
                font-size: 18px;
                color: #f8fafc;
                outline: none;
                font-family: 'Inter', sans-serif;
                border-bottom: 1px solid #1e293b;
            }
            .strata-search-modal input::placeholder {
                color: #64748b;
            }
            .strata-search-results {
                max-height: 400px;
                overflow-y: auto;
                padding: 10px 0;
            }
            .strata-search-result-item {
                padding: 12px 20px;
                display: flex;
                align-items: center;
                gap: 12px;
                cursor: pointer;
                color: #cbd5e1;
            }
            .strata-search-result-item:hover, .strata-search-result-item.selected {
                background: #1e293b;
                color: #fff;
            }
            .strata-search-result-item i {
                width: 20px;
                text-align: center;
                color: #3b82f6;
            }
            .strata-search-category {
                font-size: 11px;
                text-transform: uppercase;
                color: #64748b;
                padding: 8px 20px 4px;
                font-weight: 600;
                letter-spacing: 0.05em;
            }
            .strata-search-footer {
                padding: 12px 20px;
                background: rgba(0,0,0,0.2);
                border-top: 1px solid #1e293b;
                font-size: 12px;
                color: #64748b;
                display: flex;
                justify-content: center;
                gap: 16px;
            }
            .strata-search-results::-webkit-scrollbar { width: 8px; }
            .strata-search-results::-webkit-scrollbar-track { background: #0f1629; }
            .strata-search-results::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        `;
        document.head.appendChild(style);

        const html = `
            <div id="strata-search-overlay">
                <div class="strata-search-modal">
                    <input type="text" id="strata-search-input" placeholder="Search stocks, crypto, FX, pages..." autocomplete="off" spellcheck="false" />
                    <div class="strata-search-results" id="strata-search-results"></div>
                    <div class="strata-search-footer">
                        <span><kbd>ESC</kbd> to close</span>
                        <span><kbd>↑↓</kbd> to navigate</span>
                        <span><kbd>↵</kbd> to select</span>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);

        overlay = document.getElementById('strata-search-overlay');
        input = document.getElementById('strata-search-input');
        resultsContainer = document.getElementById('strata-search-results');
    }

    function toggleSearch(show) {
        if (show) {
            overlay.classList.add('active');
            input.value = '';
            performSearch('');
            setTimeout(() => input.focus(), 50);
        } else {
            overlay.classList.remove('active');
            input.blur();
        }
    }

    function renderResults(results) {
        currentResults = results;
        selectedIndex = results.length > 0 ? 0 : -1;
        resultsContainer.innerHTML = '';

        if (results.length === 0) {
            resultsContainer.innerHTML = '<div class="strata-search-result-item" style="color: #64748b; justify-content: center;">No results found</div>';
            return;
        }

        let currentCategory = '';
        results.forEach((res, index) => {
            if (res.category !== currentCategory) {
                currentCategory = res.category;
                const catEl = document.createElement('div');
                catEl.className = 'strata-search-category';
                catEl.textContent = currentCategory;
                resultsContainer.appendChild(catEl);
            }

            const item = document.createElement('div');
            item.className = `strata-search-result-item ${index === selectedIndex ? 'selected' : ''}`;
            item.dataset.index = index;
            item.innerHTML = `<i class="fa-solid ${res.icon}"></i> <span>${res.title}</span>`;
            
            item.addEventListener('mouseenter', () => {
                updateSelection(index);
            });
            
            item.addEventListener('click', () => {
                executeResult(res);
            });

            resultsContainer.appendChild(item);
        });
    }

    function updateSelection(index) {
        const items = resultsContainer.querySelectorAll('.strata-search-result-item');
        if (selectedIndex >= 0 && items[selectedIndex]) {
            items[selectedIndex].classList.remove('selected');
        }
        selectedIndex = index;
        if (selectedIndex >= 0 && items[selectedIndex]) {
            items[selectedIndex].classList.add('selected');
            items[selectedIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    function executeResult(res) {
        toggleSearch(false);
        if (res.url) {
            window.location.href = res.url;
        }
    }

    function performSearch(query) {
        query = query.toLowerCase().trim();
        let results = [];

        // 1. Pages (Fuzzy match)
        const matchedPages = PAGES.filter(p => p.title.toLowerCase().includes(query));
        matchedPages.forEach(p => results.push({ ...p, category: 'Pages' }));

        // 2. Recent (if workspace exists)
        if (window.StrataWorkspace && window.StrataWorkspace.recent) {
            const recents = window.StrataWorkspace.recent.getAll();
            const matchedRecents = recents.filter(r => r.ticker.toLowerCase().includes(query));
            matchedRecents.slice(0, 5).forEach(r => {
                const isCrypto = r.assetType === 'crypto';
                results.push({
                    title: `${r.ticker} (${r.assetType})`,
                    url: `${isCrypto ? 'crypto.html' : 'research.html'}?t=${r.ticker}`,
                    icon: 'fa-clock',
                    category: 'Recent'
                });
            });
        }

        // 3. Equities / Quick Actions (if query matches basic ticker pattern)
        if (query && query.length <= 5 && /^[a-z]+$/.test(query)) {
            const ticker = query.toUpperCase();
            results.push({
                title: `Open ${ticker} in Research Terminal`,
                url: `research.html?t=${ticker}`,
                icon: 'fa-chart-line',
                category: 'Equities'
            });
        }

        // 4. Custom Quick actions based on keywords
        if (query.includes('value') || query.includes('screen')) {
            results.push({ title: 'Screen for value stocks', url: 'screener.html', icon: 'fa-filter', category: 'Quick Actions' });
        }
        if (query.includes('corr')) {
            results.push({ title: 'Check correlations', url: 'correlation.html', icon: 'fa-diagram-project', category: 'Quick Actions' });
        }

        renderResults(results);
    }

    // Debounce helper
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function bindEvents() {
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                toggleSearch(!overlay.classList.contains('active'));
            }

            if (!overlay.classList.contains('active')) return;

            if (e.key === 'Escape') {
                toggleSearch(false);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (selectedIndex < currentResults.length - 1) {
                    updateSelection(selectedIndex + 1);
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (selectedIndex > 0) {
                    updateSelection(selectedIndex - 1);
                }
            } else if (e.key === 'Enter' && selectedIndex >= 0) {
                e.preventDefault();
                executeResult(currentResults[selectedIndex]);
            }
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                toggleSearch(false);
            }
        });

        const debouncedSearch = debounce((e) => performSearch(e.target.value), 200);
        input.addEventListener('input', debouncedSearch);
    }

    window.StrataSearch = {
        init: () => {
            if (initialized) return;
            injectHTMLandCSS();
            bindEvents();
            initialized = true;
            console.log('StrataSearch initialized (Ctrl+K)');
        },
        open: () => toggleSearch(true),
        close: () => toggleSearch(false)
    };
})();
