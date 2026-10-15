function init() {
    setupMobileMenu();
    enhancePageShell();
    animateMetricValues();
    setupPageReveal();
    setupCommandPalette();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

function setupMobileMenu() {
    const toggleBtn = document.getElementById('mobile-menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    if (!toggleBtn || !sidebar) return;

    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = sidebar.classList.toggle('mobile-open');
        document.body.classList.toggle('mobile-nav-open', isOpen);
        toggleBtn.setAttribute('aria-expanded', String(isOpen));
    });

    document.addEventListener('click', (event) => {
        if (!sidebar.classList.contains('mobile-open')) return;
        const clickedInsideSidebar = sidebar.contains(event.target);
        const clickedToggle = toggleBtn.contains(event.target);
        if (!clickedInsideSidebar && !clickedToggle) {
            sidebar.classList.remove('mobile-open');
            document.body.classList.remove('mobile-nav-open');
            toggleBtn.setAttribute('aria-expanded', 'false');
        }
    });
}

function enhancePageShell() {
    const heroCards = document.querySelectorAll('.ticker-hero-card, .chart-container-card, .metric-card, .news-widget');
    heroCards.forEach((card, index) => {
        card.style.animationDelay = `${index * 70}ms`;
        card.classList.add('premium-card-enter');
    });
}

function animateMetricValues() {
    const metricValues = document.querySelectorAll('.metric-value, .index-price, .price-value, .kpi-value');
    metricValues.forEach((el) => {
        if (!el.textContent.trim() || el.textContent.includes('--')) return;
        el.classList.add('metric-value-animated');
    });
}

function setupPageReveal() {
    const content = document.querySelector('.main-content');
    if (!content) return;
    content.classList.add('page-revealed');
}

// ── Global Institutional Command Palette (Ctrl+K) ───────────────────────────
function setupCommandPalette() {
    if (document.getElementById('strata-command-palette')) return;

    const overlay = document.createElement('div');
    overlay.id = 'strata-command-palette';
    overlay.className = 'strata-palette-overlay';
    overlay.innerHTML = `
        <div class="strata-palette-modal" role="dialog" aria-modal="true" aria-label="STRATA Command Palette">
            <div class="strata-palette-header">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" class="strata-palette-input" placeholder="Type a navigation command or ticker (e.g. AAPL, NVDA)..." autocomplete="off" spellcheck="false" />
                <span class="strata-palette-kbd">ESC</span>
            </div>
            <div class="strata-palette-list" role="listbox"></div>
            <div class="strata-palette-footer">
                <span><kbd class="strata-palette-kbd">↑</kbd><kbd class="strata-palette-kbd">↓</kbd> Navigate</span>
                <span><kbd class="strata-palette-kbd">↵</kbd> Select</span>
                <span><kbd class="strata-palette-kbd">ESC</kbd> Close</span>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('.strata-palette-input');
    const list = overlay.querySelector('.strata-palette-list');

    const defaultCommands = [
        { title: 'Dashboard — Equity Terminal', url: 'index.html', icon: 'fa-gauge-high', category: 'Navigation' },
        { title: 'Equity Screener & Quantitative Scanner', url: 'screener.html', icon: 'fa-filter', category: 'Equities' },
        { title: 'SEC EDGAR Filings & XBRL Explorer', url: 'sec.html', icon: 'fa-file-shield', category: 'Fundamental' },
        { title: 'Institutional Research Report Generator', url: 'report.html', icon: 'fa-file-invoice-dollar', category: 'Research' },
        { title: 'Macro Commodities & Energy Terminal', url: 'commodities.html', icon: 'fa-oil-can', category: 'Macro' },
        { title: 'Treasury Yield Curve & Recession Probit', url: 'yields.html', icon: 'fa-chart-area', category: 'Fixed Income' },
        { title: 'FX & Global G8 Cross-Currency Matrix', url: 'forex.html', icon: 'fa-money-bill-transfer', category: 'Currencies' },
        { title: 'Crypto Terminal & Float Health', url: 'crypto.html', icon: 'fa-coins', category: 'Digital Assets' },
        { title: 'Portfolio Stress Testing & Scenario Engine', url: 'stress.html', icon: 'fa-shield-halved', category: 'Risk' },
        { title: 'Quant Cross-Asset Correlation Matrix', url: 'correlation.html', icon: 'fa-cubes', category: 'Quantitative' },
        { title: 'Financial & DCF Calculators', url: 'calculators.html', icon: 'fa-calculator', category: 'Tools' }
    ];

    let selectedIndex = 0;
    let currentItems = [];

    function renderItems(items) {
        currentItems = items;
        selectedIndex = Math.min(selectedIndex, Math.max(0, items.length - 1));
        list.innerHTML = '';
        if (items.length === 0) {
            list.innerHTML = `<div style="padding: 24px; text-align: center; color: #64748b; font-size: 0.9rem;">No matching commands or actions found.</div>`;
            return;
        }

        items.forEach((item, idx) => {
            const div = document.createElement('a');
            div.href = item.url;
            div.className = `strata-palette-item ${idx === selectedIndex ? 'selected' : ''}`;
            div.innerHTML = `
                <div class="item-left">
                    <span class="item-icon"><i class="fa-solid ${item.icon}"></i></span>
                    <span class="item-title">${item.title}</span>
                </div>
                <span class="item-badge">${item.category}</span>
            `;
            div.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.href = item.url;
            });
            list.appendChild(div);
        });
    }

    function filterCommands(query) {
        const q = query.trim().toUpperCase();
        if (!q) {
            renderItems(defaultCommands);
            return;
        }

        const items = [];
        // If it looks like a ticker symbol (1-6 alphanumeric characters)
        if (/^[A-Z0-9.\-]{1,6}$/.test(q)) {
            items.push({
                title: `Analyze <strong>${q}</strong> in Equity Terminal`,
                url: `index.html?symbol=${q}`,
                icon: 'fa-chart-line',
                category: 'Ticker Jump'
            });
            items.push({
                title: `View <strong>${q}</strong> Deep Dive Fundamentals`,
                url: `equity-details.html?symbol=${q}`,
                icon: 'fa-table-cells-large',
                category: 'Ticker Jump'
            });
            items.push({
                title: `Run AI Quant Scan for <strong>${q}</strong>`,
                url: `ai.html?symbol=${q}`,
                icon: 'fa-brain',
                category: 'AI Analysis'
            });
            items.push({
                title: `Inspect SEC Filings for <strong>${q}</strong>`,
                url: `sec.html?symbol=${q}`,
                icon: 'fa-file-shield',
                category: 'SEC Filings'
            });
            items.push({
                title: `Generate Research Report for <strong>${q}</strong>`,
                url: `report.html?symbol=${q}`,
                icon: 'fa-file-invoice-dollar',
                category: 'Report'
            });
        }

        const matches = defaultCommands.filter(c => 
            c.title.toUpperCase().includes(q) || c.category.toUpperCase().includes(q)
        );
        items.push(...matches);
        renderItems(items);
    }

    function openPalette() {
        overlay.classList.add('open');
        input.value = '';
        selectedIndex = 0;
        renderItems(defaultCommands);
        setTimeout(() => input.focus(), 50);
    }

    function closePalette() {
        overlay.classList.remove('open');
    }

    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            if (overlay.classList.contains('open')) {
                closePalette();
            } else {
                openPalette();
            }
        } else if (e.key === 'Escape' && overlay.classList.contains('open')) {
            e.preventDefault();
            closePalette();
        }
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closePalette();
    });

    input.addEventListener('input', (e) => {
        selectedIndex = 0;
        filterCommands(e.target.value);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (currentItems.length > 0) {
                selectedIndex = (selectedIndex + 1) % currentItems.length;
                renderItems(currentItems);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (currentItems.length > 0) {
                selectedIndex = (selectedIndex - 1 + currentItems.length) % currentItems.length;
                renderItems(currentItems);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (currentItems[selectedIndex]) {
                window.location.href = currentItems[selectedIndex].url;
            }
        }
    });
}

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then((reg) => {
                console.log('STRATA Service Worker registered successfully, scope:', reg.scope);
            })
            .catch((err) => {
                console.error('STRATA Service Worker registration failed:', err);
            });
    });
}
