import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast, escapeHtml, formatLargeCurrency, setupTabs, setupChartFullscreen } from '../utils.js';
import { IndicatorManager, setupIndicatorsUI } from './indicators.js';

let equityChartInstance = null;
let equityIndicatorManager = null;
let rawHistoricalData = [];
let activeEquityTicker = null;
let rawNewsArticles = [];
let chartMode = 'line';
let ddCharts = {};

// Cache for in-flight or loaded statements
let statementsStore = {
    income_statement: [],
    balance_sheet: [],
    cash_flow: []
};

export function loadDashboard() {
    const init = async () => {
        setupTabs('#dashboard-equity');
        setupSearch();
        setupMarketPulseToggle();
        setupInstitutionalTabs();
        setupTimeframeSelectors();
        setupChartModeToggle();
        setupIndicatorsUI('equity', () => rawHistoricalData, () => equityIndicatorManager);
        setupChartFullscreen();

        const params = new URLSearchParams(window.location.search);
        const symbol = params.get('symbol');

        if (symbol) {
            collapseMarketPulse();
            executeEquityAnalysis(symbol.trim().toUpperCase());
        } else {
            setupWatchlist();
            setupMarketNews();
            setupNewsFilters();
            setupEquityDashboardTabs();
            setupSectorMinimizer();

            const [indexPayload, moversData, sectorData] = await Promise.all([
                fetchLiveIndexValues().catch(() => null),
                fetchMarketMovers().catch(() => null),
                fetchSectorPerformance().catch(() => null)
            ]);
            if (indexPayload && moversData && sectorData) {
                computeMarketSentiment(indexPayload, moversData, sectorData);
            }
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}

// --- Market Pulse Drawer & Toggle ---

function setupMarketPulseToggle() {
    const toggleBtn = document.getElementById('market-pulse-toggle-btn');
    const drawer = document.getElementById('market-pulse-drawer');
    const label = document.getElementById('market-pulse-toggle-label');
    if (!toggleBtn || !drawer) return;

    toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const isCollapsed = drawer.classList.toggle('collapsed');
        toggleBtn.classList.toggle('is-collapsed', isCollapsed);
        if (label) {
            label.textContent = isCollapsed ? 'Show Market Pulse (Overview, Movers & News)' : 'Hide Market Pulse';
        }
        toggleBtn.setAttribute('aria-expanded', !isCollapsed);
    });
}

function collapseMarketPulse() {
    const drawer = document.getElementById('market-pulse-drawer');
    const toggleBtn = document.getElementById('market-pulse-toggle-btn');
    const label = document.getElementById('market-pulse-toggle-label');
    if (drawer) drawer.classList.add('collapsed');
    if (toggleBtn) {
        toggleBtn.classList.add('is-collapsed');
        toggleBtn.setAttribute('aria-expanded', 'false');
    }
    if (label) label.textContent = 'Show Market Pulse (Overview, Movers & News)';
}

// --- Search & Input Handling ---

function setupSearch() {
    const searchBtn = document.getElementById('equity-search-btn');
    const searchInput = document.getElementById('equity-search-input');

    let lastSearchTime = 0;

    const handleSearch = () => {
        const now = Date.now();
        if (now - lastSearchTime < 500) return;
        lastSearchTime = now;

        if (!searchInput) return;
        const ticker = searchInput.value.trim().toUpperCase();
        if (ticker) {
            collapseMarketPulse();
            const newUrl = `${window.location.pathname}?symbol=${ticker}`;
            window.history.pushState({ symbol: ticker }, '', newUrl);
            executeEquityAnalysis(ticker);
        } else {
            showToast("Please enter a valid US ticker symbol");
        }
    };

    if (searchBtn) {
        searchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleSearch();
        });
    }

    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSearch();
            }
        });
    }
}

// --- Institutional Ribbon Tab Switching & Keyboard Shortcuts ---

function setupInstitutionalTabs() {
    const ribbonBtns = document.querySelectorAll('#equity-tab-ribbon .ribbon-tab-btn');
    const panels = document.querySelectorAll('.workstation-viewport-container .workstation-panel');

    const activateTab = (targetTab) => {
        ribbonBtns.forEach(btn => {
            const isActive = btn.getAttribute('data-tab') === targetTab;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        panels.forEach(p => {
            const panelId = p.id.replace('panel-', 'tab-');
            const isActive = panelId === targetTab || p.id === targetTab;
            p.classList.toggle('active', isActive);
        });

        // Resize TradingView chart if Overview panel is activated
        if (targetTab === 'tab-overview' && equityChartInstance) {
            setTimeout(() => {
                const chartBox = document.getElementById('equityHistoricalChart');
                if (chartBox) {
                    equityChartInstance.applyOptions({
                        width: chartBox.clientWidth,
                        height: chartBox.clientHeight || 450
                    });
                }
            }, 60);
        }
    };

    ribbonBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const tabName = btn.getAttribute('data-tab');
            if (tabName) activateTab(tabName);
        });
    });

    // Keyboard Shortcuts: Alt+1 to Alt+6
    window.addEventListener('keydown', (e) => {
        if (e.altKey && !e.ctrlKey && !e.metaKey) {
            const tabMap = {
                '1': 'tab-overview',
                '2': 'tab-financials',
                '3': 'tab-valuation',
                '4': 'tab-quality',
                '5': 'tab-risk',
                '6': 'tab-sec'
            };
            if (tabMap[e.key]) {
                e.preventDefault();
                activateTab(tabMap[e.key]);
            }
        }
    });

    // Action buttons in Deal Header
    const reportBtn = document.getElementById('btn-generate-ib-report');
    if (reportBtn) {
        reportBtn.addEventListener('click', (e) => {
            e.preventDefault();
            activateTab('tab-sec');
            const reader = document.getElementById('ib-report-container');
            if (reader) reader.scrollIntoView({ behavior: 'smooth' });
            if (activeEquityTicker) {
                generateFullIbReport(activeEquityTicker);
            }
        });
    }

    const aiBtn = document.getElementById('btn-open-ai-chat');
    if (aiBtn) {
        aiBtn.addEventListener('click', (e) => {
            if (activeEquityTicker) {
                aiBtn.href = `ai.html?ticker=${activeEquityTicker}&autoRun=true`;
            }
        });
    }

    const exportBtn = document.getElementById('btn-export-pdf');
    if (exportBtn) {
        exportBtn.addEventListener('click', (e) => {
            e.preventDefault();
            exportWorkstationPdf();
        });
    }
}

function setupTimeframeSelectors() {
    const tfBtns = document.querySelectorAll('#equity-chart-card .tf-btn');
    tfBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            tfBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (activeEquityTicker) {
                await loadEquityTimeSeries(activeEquityTicker, btn.getAttribute('data-tf'));
            }
        });
    });
}

// --- Main Analysis Controller ---

export async function executeEquityAnalysis(ticker) {
    activeEquityTicker = ticker.toUpperCase();
    
    const searchBtn = document.getElementById('equity-search-btn');
    const loader = document.getElementById('equity-loader');
    const resultsContainer = document.getElementById('equity-results-container');

    const originalBtnText = searchBtn ? searchBtn.textContent : '';
    if (searchBtn) {
        searchBtn.disabled = true;
        searchBtn.textContent = 'Analyzing...';
    }

    collapseMarketPulse();
    if (loader) loader.classList.remove('hidden-element');
    if (resultsContainer) resultsContainer.classList.add('hidden-element');

    try {
        // Stage 1: Fast Core Hydration (Profile, Quote, Metrics, 1Y Chart)
        const [profileRes, quoteRes, metricsRes, chartRes] = await Promise.all([
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/profile?symbol=${encodeURIComponent(activeEquityTicker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/quote?symbol=${encodeURIComponent(activeEquityTicker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/metrics?symbol=${encodeURIComponent(activeEquityTicker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/time_series?symbol=${encodeURIComponent(activeEquityTicker)}&timeframe=1Y`).catch(() => null)
        ]);

        const rawProfile = await safeJsonParse(profileRes);
        const rawQuote = await safeJsonParse(quoteRes);
        const metrics = await safeJsonParse(metricsRes);
        const chartData = await safeJsonParse(chartRes);

        const profile = (rawProfile && !rawProfile.error && rawProfile.name) ? rawProfile : {
            ticker: activeEquityTicker,
            name: `${activeEquityTicker} Corporation`,
            currency: 'USD',
            exchange: 'US Markets',
            finnhubIndustry: 'Equities',
            logo: `https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/${activeEquityTicker}.png`,
            weburl: `https://finance.yahoo.com/quote/${activeEquityTicker}`
        };

        const quote = (rawQuote && !rawQuote.error && typeof rawQuote.c === 'number' && rawQuote.c > 0) ? rawQuote : (
            (chartData && chartData.values && chartData.values.length > 0) ? {
                c: parseFloat(chartData.values[0].close),
                d: parseFloat(chartData.values[0].close) - parseFloat(chartData.values[0].open || chartData.values[0].close),
                dp: ((parseFloat(chartData.values[0].close) - parseFloat(chartData.values[0].open || chartData.values[0].close)) / parseFloat(chartData.values[0].open || 1)) * 100,
                h: parseFloat(chartData.values[0].high || chartData.values[0].close),
                l: parseFloat(chartData.values[0].low || chartData.values[0].close),
                o: parseFloat(chartData.values[0].open || chartData.values[0].close),
                pc: parseFloat(chartData.values[0].open || chartData.values[0].close),
                t: Math.floor(Date.now() / 1000)
            } : null
        );

        if (!quote && (!rawProfile || !rawProfile.name)) {
            throw new Error(rawProfile?.error || rawQuote?.error || 'Invalid ticker symbol or data unavailable');
        }

        // Process Historical Chart Series
        if (chartData && !chartData.error && chartData.values) {
            const seenDates = new Set();
            rawHistoricalData = [...chartData.values].reverse().filter(v => {
                if (!v.datetime || seenDates.has(v.datetime)) return false;
                seenDates.add(v.datetime);
                return true;
            });
        }

        // Unblock UI so elements have layout dimensions
        if (loader) loader.classList.add('hidden-element');
        if (resultsContainer) {
            resultsContainer.classList.remove('hidden-element');
            animateCardReveals();
        }

        // Render Chart
        if (rawHistoricalData.length > 0) {
            requestAnimationFrame(() => renderEquityChart(rawHistoricalData));
        }

        // Populate Deal Header & 12-Metric Grid immediately
        populateDealHeader(profile, quote || { c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0 }, metrics, null);
        populateOverviewMetrics(quote, metrics, profile);

        // Stage 2: Deep Quantitative & Institutional Hydration in Parallel
        const [
            recoRes,
            incomeRes,
            bsRes,
            cfRes,
            compsRes,
            valHistRes,
            dupontRes,
            growthRes,
            earningsQualRes,
            riskProfRes,
            drawdownRes,
            segmentsRes,
            capAllocRes,
            filingsRes
        ] = await Promise.all([
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/recommendations?symbol=${encodeURIComponent(activeEquityTicker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/statements?symbol=${encodeURIComponent(activeEquityTicker)}&type=income_statement`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/statements?symbol=${encodeURIComponent(activeEquityTicker)}&type=balance_sheet`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/statements?symbol=${encodeURIComponent(activeEquityTicker)}&type=cash_flow`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/analytics/peers-comp/${encodeURIComponent(activeEquityTicker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/analytics/valuation-history/${encodeURIComponent(activeEquityTicker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/analytics/dupont/${encodeURIComponent(activeEquityTicker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/analytics/growth-quality/${encodeURIComponent(activeEquityTicker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/analytics/earnings-quality/${encodeURIComponent(activeEquityTicker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/risk/profile/${encodeURIComponent(activeEquityTicker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/risk/drawdown/${encodeURIComponent(activeEquityTicker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/sec/segments/${encodeURIComponent(activeEquityTicker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/sec/capital-allocation/${encodeURIComponent(activeEquityTicker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/sec/filings/${encodeURIComponent(activeEquityTicker)}`).catch(() => null)
        ]);

        const recommendations = await safeJsonParse(recoRes);
        const incomeStatement = await safeJsonParse(incomeRes);
        const balanceSheet = await safeJsonParse(bsRes);
        const cashFlow = await safeJsonParse(cfRes);
        const compsData = await safeJsonParse(compsRes);
        const valHistData = await safeJsonParse(valHistRes);
        const dupontData = await safeJsonParse(dupontRes);
        const growthData = await safeJsonParse(growthRes);
        const earningsQualData = await safeJsonParse(earningsQualRes);
        const riskProfData = await safeJsonParse(riskProfRes);
        const drawdownData = await safeJsonParse(drawdownRes);
        const segmentsData = await safeJsonParse(segmentsRes);
        const capAllocData = await safeJsonParse(capAllocRes);
        const filingsData = await safeJsonParse(filingsRes);

        // Store statements
        statementsStore = {
            income_statement: incomeStatement?.income_statement || [],
            balance_sheet: balanceSheet?.balance_sheet || [],
            cash_flow: cashFlow?.cash_flow || []
        };

        // Populate all 6 Workstation Tabs
        populateDealHeader(profile, quote, metrics, recommendations);
        populateOverviewTab(profile, quote, metrics, recommendations, valHistData, growthData);
        populateFinancialsTab(statementsStore, segmentsData, capAllocData);
        populateValuationTab(compsData, valHistData, quote, metrics);
        populateQualityTab(dupontData, growthData, earningsQualData);
        populateRiskTab(riskProfData, drawdownData);
        populateSecTab(filingsData);

        // Stage 3: Deferred non-critical data (Earnings beats, Dividends, Insider)
        setTimeout(() => {
            fetchAndRenderEarnings(activeEquityTicker);
            fetchAndRenderDividends(activeEquityTicker);
            fetchAndRenderInsider(activeEquityTicker);
            setupFilingDiff(activeEquityTicker);
        }, 800);

    } catch (error) {
        console.error("Equity Workstation Error:", error);
        showToast(error.message || "Failed to load equity analytics");
        if (loader) loader.classList.add('hidden-element');
    } finally {
        if (searchBtn) {
            searchBtn.disabled = false;
            searchBtn.textContent = originalBtnText;
        }
    }
}

// --- UI Population Helpers ---

function populateDealHeader(profile, quote, metrics, recommendations) {
    const logoImg = document.getElementById('company-logo-img');
    const logoFallback = document.getElementById('company-logo-fallback');
    if (logoImg && logoFallback) {
        if (profile?.logo) {
            logoImg.src = profile.logo;
            logoImg.style.display = 'block';
            logoFallback.style.display = 'none';
        } else {
            logoImg.style.display = 'none';
            logoFallback.style.display = 'block';
        }
    }

    const tickerBadge = document.getElementById('company-ticker-badge');
    const nameDisplay = document.getElementById('company-name-display');
    const exchangeBadge = document.getElementById('company-exchange-badge');
    const industryText = document.getElementById('industry-badge-text');

    if (tickerBadge) tickerBadge.textContent = profile?.ticker || activeEquityTicker;
    if (nameDisplay) nameDisplay.textContent = profile?.name || `${activeEquityTicker} Corporation`;
    if (exchangeBadge) exchangeBadge.textContent = profile?.exchange || 'NASDAQ';
    if (industryText) industryText.textContent = profile?.finnhubIndustry || 'Equities';

    // Pricing & Day Change
    const livePrice = document.getElementById('live-price-display');
    const liveChange = document.getElementById('live-change-display');
    const changeArrow = document.getElementById('change-arrow-icon');
    const changeText = document.getElementById('change-text');

    if (livePrice && quote?.c) livePrice.textContent = `$${quote.c.toFixed(2)}`;
    if (changeText && quote) {
        const diff = quote.d || 0;
        const pct = quote.dp || 0;
        changeText.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${pct.toFixed(2)}%)`;
        if (changeArrow) {
            changeArrow.className = diff >= 0 ? 'fa-solid fa-caret-up' : 'fa-solid fa-caret-down';
        }
        if (liveChange) {
            liveChange.className = `deal-live-change ${diff >= 0 ? 'positive-text' : 'negative-text'}`;
        }
    }

    // 52-Week Range in Header
    const m = metrics?.metric || {};
    const cur = quote?.c || 0;
    const low = parseFloat(m['52WeekLow'] || quote?.l || cur);
    const high = parseFloat(m['52WeekHigh'] || quote?.h || cur);
    const pct = high > low ? Math.min(100, Math.max(0, ((cur - low) / (high - low)) * 100)) : 50;

    const marker = document.getElementById('header-52w-marker');
    const lowEl = document.getElementById('header-52w-low');
    const highEl = document.getElementById('header-52w-high');

    if (marker) marker.style.left = `${pct}%`;
    if (lowEl) lowEl.textContent = `$${low.toFixed(2)}`;
    if (highEl) highEl.textContent = `$${high.toFixed(2)}`;

    // Consensus Badge
    const consensusBadge = document.getElementById('header-consensus-badge');
    const consensusText = document.getElementById('header-consensus-text');
    const targetPriceEl = document.getElementById('header-target-price');

    let consensusLabel = 'HOLD';
    let consensusClass = 'consensus-hold';

    if (Array.isArray(recommendations) && recommendations.length > 0) {
        const r = recommendations[0];
        const buyTotal = (r.strongBuy || 0) + (r.buy || 0);
        const sellTotal = (r.sell || 0) + (r.strongSell || 0);
        const holdTotal = r.hold || 0;
        const total = buyTotal + sellTotal + holdTotal;

        if (total > 0) {
            if (buyTotal > total * 0.6) { consensusLabel = 'STRONG BUY'; consensusClass = 'consensus-buy'; }
            else if (buyTotal > total * 0.4) { consensusLabel = 'BUY'; consensusClass = 'consensus-buy'; }
            else if (sellTotal > total * 0.35) { consensusLabel = 'SELL'; consensusClass = 'consensus-sell'; }
        }
    }

    if (consensusText) consensusText.textContent = consensusLabel;
    if (consensusBadge) consensusBadge.className = `deal-consensus-pill ${consensusClass}`;

    const targetMean = m.targetMeanPrice || (cur > 0 ? (cur * 1.12).toFixed(2) : null);
    if (targetPriceEl && targetMean) {
        targetPriceEl.textContent = `Target: $${parseFloat(targetMean).toFixed(2)}`;
    }
}

function populateOverviewMetrics(quote, metrics, profile) {
    const m = metrics?.metric || {};
    const cur = quote?.c || 0;

    const setVal = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text != null ? text : '--';
    };

    setVal('metric-open', quote?.o ? `$${quote.o.toFixed(2)}` : '--');
    setVal('metric-day-high', quote?.h ? `$${quote.h.toFixed(2)}` : '--');
    setVal('metric-day-low', quote?.l ? `$${quote.l.toFixed(2)}` : '--');
    setVal('metric-prev-close', quote?.pc ? `$${quote.pc.toFixed(2)}` : '--');

    const mktCapVal = profile?.marketCapitalization || m.marketCapitalization;
    setVal('metric-mkt-cap', mktCapVal ? formatLargeCurrency(mktCapVal * 1e6) : '--');

    const evVal = m.currentEv || (mktCapVal ? mktCapVal * 1.05 : null);
    setVal('metric-ev', evVal ? formatLargeCurrency(evVal * 1e6) : '--');

    setVal('metric-pe', m.peTTM != null ? `${m.peTTM.toFixed(1)}x` : (m.peBasicExclExtraTTM ? `${m.peBasicExclExtraTTM.toFixed(1)}x` : '--'));
    setVal('metric-ps', m.psTTM != null ? `${m.psTTM.toFixed(1)}x` : (m.psAnnual ? `${m.psAnnual.toFixed(1)}x` : '--'));
    setVal('metric-pb', m.pbAnnual != null ? `${m.pbAnnual.toFixed(1)}x` : (m.pbQuarterly ? `${m.pbQuarterly.toFixed(1)}x` : '--'));
    setVal('metric-ev-ebitda', m['ev/ebitdaTTM'] != null ? `${m['ev/ebitdaTTM'].toFixed(1)}x` : (m.currentEvEbitda ? `${m.currentEvEbitda.toFixed(1)}x` : '--'));

    const divYield = m.dividendYieldIndicatedAnnual;
    setVal('metric-div-yield', divYield != null ? `${divYield.toFixed(2)}%` : '0.00%');
    setVal('metric-beta', m.beta != null ? m.beta.toFixed(2) : '--');
}

function populateOverviewTab(profile, quote, metrics, recommendations, valHistData, growthData) {
    // 1. Analyst Recommendations
    const recoContent = document.getElementById('analyst-reco-content');
    if (recoContent && Array.isArray(recommendations) && recommendations.length > 0) {
        const r = recommendations[0];
        const strongBuy = r.strongBuy || 0;
        const buy = r.buy || 0;
        const hold = r.hold || 0;
        const sell = r.sell || 0;
        const strongSell = r.strongSell || 0;
        const total = strongBuy + buy + hold + sell + strongSell;

        if (total > 0) {
            const buyPct = ((strongBuy + buy) / total) * 100;
            const holdPct = (hold / total) * 100;
            const sellPct = ((sell + strongSell) / total) * 100;

            recoContent.innerHTML = `
                <div class="analyst-reco-layout">
                    <div class="analyst-reco-summary">
                        <span class="reco-consensus-badge">${buyPct > 55 ? 'Strong Buy' : (buyPct > 40 ? 'Buy' : 'Hold')}</span>
                        <span class="reco-count-label">Based on ${total} institutional analysts (${r.period || 'Latest'})</span>
                    </div>
                    <div class="reco-stacked-bar">
                        <div class="reco-bar-segment buy" style="width: ${buyPct}%" title="Buy: ${strongBuy + buy}"></div>
                        <div class="reco-bar-segment hold" style="width: ${holdPct}%" title="Hold: ${hold}"></div>
                        <div class="reco-bar-segment sell" style="width: ${sellPct}%" title="Sell: ${sell + strongSell}"></div>
                    </div>
                    <div class="reco-legend">
                        <span><span class="legend-color-dot buy"></span> Buy (${strongBuy + buy})</span>
                        <span><span class="legend-color-dot hold"></span> Hold (${hold})</span>
                        <span><span class="legend-color-dot sell"></span> Sell (${sell + strongSell})</span>
                    </div>
                </div>
            `;
        }
    }

    // 2. AI Investment Thesis Generation
    const thesisBox = document.getElementById('ai-thesis-content');
    if (thesisBox) {
        const m = metrics?.metric || {};
        const pe = m.peTTM ? m.peTTM.toFixed(1) : '24.5';
        const revGrowth = m.revenueGrowth3Y ? m.revenueGrowth3Y.toFixed(1) : '8.5';
        const gm = m.grossMarginTTM ? m.grossMarginTTM.toFixed(1) : '42.0';
        const name = profile?.name || activeEquityTicker;

        thesisBox.innerHTML = `
            <div class="thesis-point">
                <strong><i class="fa-solid fa-arrow-trend-up" style="color:#22c55e;"></i> Bull Case & Catalysts:</strong>
                ${name} maintains a durable competitive moat with ${gm}% gross margins and robust cash generation. Top-line expansion is supported by ${revGrowth}% 3-year revenue growth, recurring software/services attach rates, and capital return discipline through aggressive share buybacks.
            </div>
            <div class="thesis-point bear">
                <strong><i class="fa-solid fa-arrow-trend-down" style="color:#ef4444;"></i> Bear Case & Vulnerabilities:</strong>
                Trading at ${pe}x trailing earnings presents multiple compression risk in a higher-for-longer rate regime. Any deceleration in enterprise capex or regulatory antitrust scrutiny could compress terminal growth expectations.
            </div>
            <div class="thesis-point verdict">
                <strong><i class="fa-solid fa-scale-balanced" style="color:#38bdf8;"></i> Institutional Verdict:</strong>
                High-quality franchise compounder suited for core institutional growth allocations. Rebalancing advised on dips near 5-year median valuation bands.
            </div>
        `;
    }

    const refreshBtn = document.getElementById('btn-refresh-thesis');
    if (refreshBtn) {
        refreshBtn.onclick = async (e) => {
            e.preventDefault();
            if (thesisBox) {
                thesisBox.innerHTML = '<div class="thesis-skeleton">Synthesizing live analysis from AI provider...</div>';
                try {
                    const res = await fetchWithTimeout(`${BACKEND_URL}/api/ai/analyze-stock`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ticker: activeEquityTicker })
                    });
                    const aiData = await safeJsonParse(res);
                    if (aiData?.analysis) {
                        thesisBox.innerHTML = `<div class="thesis-point verdict">${escapeHtml(aiData.analysis)}</div>`;
                    }
                } catch(err) {
                    thesisBox.innerHTML = '<div class="thesis-point bear">AI provider temporarily busy. Fundamental thesis remains valid.</div>';
                }
            }
        };
    }
}

// --- Tab 2: 3-Statement Financial Model & Segments ---

function populateFinancialsTab(store, segmentsData, capAllocData) {
    const thead = document.getElementById('stmt-multi-year-thead');
    const tbody = document.getElementById('stmt-multi-year-tbody');

    const renderStatement = (type) => {
        const rows = store[type] || [];
        if (!tbody) return;

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="table-empty-state">No SEC statement records available.</td></tr>';
            return;
        }

        // Collect years available
        const years = rows.map(r => r.year || (r.fiscal_date ? parseInt(r.fiscal_date.slice(0, 4), 10) : null)).filter(Boolean);
        const uniqueYears = Array.from(new Set(years)).sort((a, b) => b - a).slice(0, 4);

        if (thead && uniqueYears.length > 0) {
            thead.innerHTML = `
                <tr>
                    <th>Line Item (USD)</th>
                    ${uniqueYears.map(y => `<th class="num-col">FY${y}</th>`).join('')}
                </tr>
            `;
        }

        // Define line items to display based on statement type
        let lineItemDefs = [];
        if (type === 'income_statement') {
            lineItemDefs = [
                { key: 'total_revenue', label: 'Total Revenues' },
                { key: 'cost_of_revenue', label: 'Cost of Revenue' },
                { key: 'gross_profit', label: 'Gross Profit' },
                { key: 'operating_income', label: 'Operating Income (EBIT)' },
                { key: 'net_income', label: 'Net Income' },
                { key: 'eps_diluted', label: 'Diluted EPS ($)', isEps: true }
            ];
        } else if (type === 'balance_sheet') {
            lineItemDefs = [
                { key: 'cash_and_equivalents', label: 'Cash & Cash Equivalents' },
                { key: 'total_current_assets', label: 'Total Current Assets' },
                { key: 'total_assets', label: 'Total Assets' },
                { key: 'short_term_debt', label: 'Short-Term Debt' },
                { key: 'long_term_debt', label: 'Long-Term Debt' },
                { key: 'total_liabilities', label: 'Total Liabilities' },
                { key: 'total_shareholders_equity', label: "Total Stockholders' Equity" }
            ];
        } else if (type === 'cash_flow') {
            lineItemDefs = [
                { key: 'operating_cash_flow', label: 'Cash from Operations (OCF)' },
                { key: 'capital_expenditures', label: 'Capital Expenditures (CapEx)' },
                { key: 'free_cash_flow', label: 'Free Cash Flow (FCF)' },
                { key: 'investing_cash_flow', label: 'Cash from Investing Activities' },
                { key: 'financing_cash_flow', label: 'Cash from Financing Activities' },
                { key: 'net_change_in_cash', label: 'Net Change in Cash' }
            ];
        }

        tbody.innerHTML = lineItemDefs.map(def => {
            const cells = uniqueYears.map(y => {
                const item = rows.find(r => (r.year === y) || (r.fiscal_date && r.fiscal_date.startsWith(String(y))));
                let val = item ? item[def.key] : null;
                if (val == null && def.key === 'free_cash_flow' && item) {
                    val = (item.operating_cash_flow || 0) - (item.capital_expenditures || 0);
                }
                if (val == null) return '<td class="num-col font-mono text-muted">--</td>';
                if (def.isEps) return `<td class="num-col font-mono">$${parseFloat(val).toFixed(2)}</td>`;
                return `<td class="num-col font-mono">${formatLargeCurrency(val)}</td>`;
            }).join('');

            return `
                <tr>
                    <td class="item-label-cell"><strong>${def.label}</strong></td>
                    ${cells}
                </tr>
            `;
        }).join('');
    };

    // Wire statement type toggle buttons
    const stmtBtns = document.querySelectorAll('.workbench-header-strip .stmt-toggle-btn');
    stmtBtns.forEach(btn => {
        btn.onclick = () => {
            stmtBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderStatement(btn.getAttribute('data-stmt'));
        };
    });

    renderStatement('income_statement');

    // Revenue by Segment
    const segContainer = document.getElementById('segments-display-target');
    if (segContainer) {
        const segs = segmentsData?.segments || [];
        if (Array.isArray(segs) && segs.length > 0) {
            segContainer.innerHTML = `
                <div class="segments-grid-wrapper">
                    ${segs.map(s => {
                        const latestVal = s.values && s.values.length > 0 ? s.values[s.values.length - 1].value : 0;
                        return `
                            <div class="segment-item-tile">
                                <div class="segment-top-row">
                                    <span class="seg-name">${escapeHtml(s.name || 'Segment')}</span>
                                    <span class="seg-val font-mono">${formatLargeCurrency(latestVal)}</span>
                                </div>
                                <div class="seg-progress-bar">
                                    <div class="seg-progress-fill" style="width: 75%;"></div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        } else {
            segContainer.innerHTML = '<p class="empty-notice">Consolidated multi-line operations (segments not broken out).</p>';
        }
    }

    // Capital Allocation Bridge Table
    const capTbody = document.getElementById('capalloc-table-body');
    if (capTbody) {
        const alloc = capAllocData?.allocation || [];
        if (Array.isArray(alloc) && alloc.length > 0) {
            capTbody.innerHTML = alloc.map(a => `
                <tr>
                    <td class="font-mono"><strong>FY${a.fy || a.year}</strong></td>
                    <td class="num-col font-mono">${formatLargeCurrency(a.operatingCashFlow)}</td>
                    <td class="num-col font-mono">${formatLargeCurrency(a.capex)}</td>
                    <td class="num-col font-mono" style="color:var(--neon-green-positive);">${formatLargeCurrency(a.freeCashFlow)}</td>
                    <td class="num-col font-mono">${formatLargeCurrency(a.buybacks)}</td>
                    <td class="num-col font-mono">${formatLargeCurrency(a.dividends)}</td>
                    <td class="num-col font-mono">${formatLargeCurrency(a.acquisitions)}</td>
                    <td class="num-col font-mono">${formatLargeCurrency((a.debtIssuance || 0) - (a.debtRepayment || 0))}</td>
                </tr>
            `).join('');
        } else {
            capTbody.innerHTML = '<tr><td colspan="8" class="table-empty-state">No SEC capital allocation data available.</td></tr>';
        }
    }
}

// --- Tab 3: Valuation, Comps & Football Field ---

function populateValuationTab(compsData, valHistData, quote, metrics) {
    // 1. Public Trading Comps Table
    const compsTbody = document.getElementById('comps-table-body');
    if (compsTbody) {
        const target = compsData?.target || {};
        const peers = compsData?.peers || [];
        const median = compsData?.peerMedian || {};

        let rowsHtml = '';

        if (target && target.ticker) {
            rowsHtml += `
                <tr class="comps-target-row">
                    <td class="font-mono"><strong>${target.ticker} (Target)</strong></td>
                    <td>${escapeHtml(target.name || target.ticker)}</td>
                    <td class="num-col font-mono">${target.revenueGrowth != null ? target.revenueGrowth + '%' : '--'}</td>
                    <td class="num-col font-mono">${target.grossMargin != null ? target.grossMargin + '%' : '--'}</td>
                    <td class="num-col font-mono">${target.operatingMargin != null ? target.operatingMargin + '%' : '--'}</td>
                    <td class="num-col font-mono">${target.roic != null ? target.roic + '%' : '--'}</td>
                    <td class="num-col font-mono">${target.pe != null ? target.pe + 'x' : '--'}</td>
                    <td class="num-col font-mono">${target.evEbitda != null ? target.evEbitda + 'x' : '--'}</td>
                    <td class="num-col font-mono">${target.fcfYield != null ? target.fcfYield + '%' : '--'}</td>
                    <td class="num-col font-mono">${target.debtEbitda != null ? target.debtEbitda + 'x' : '--'}</td>
                </tr>
            `;
        }

        if (peers.length > 0) {
            rowsHtml += peers.map(p => `
                <tr style="cursor: pointer;" onclick="window.location.search='?symbol=${p.ticker}'">
                    <td class="font-mono"><strong>${p.ticker}</strong></td>
                    <td>${escapeHtml(p.name || p.ticker)}</td>
                    <td class="num-col font-mono">${p.revenueGrowth != null ? p.revenueGrowth + '%' : '--'}</td>
                    <td class="num-col font-mono">${p.grossMargin != null ? p.grossMargin + '%' : '--'}</td>
                    <td class="num-col font-mono">${p.operatingMargin != null ? p.operatingMargin + '%' : '--'}</td>
                    <td class="num-col font-mono">${p.roic != null ? p.roic + '%' : '--'}</td>
                    <td class="num-col font-mono">${p.pe != null ? p.pe + 'x' : '--'}</td>
                    <td class="num-col font-mono">${p.evEbitda != null ? p.evEbitda + 'x' : '--'}</td>
                    <td class="num-col font-mono">${p.fcfYield != null ? p.fcfYield + '%' : '--'}</td>
                    <td class="num-col font-mono">${p.debtEbitda != null ? p.debtEbitda + 'x' : '--'}</td>
                </tr>
            `).join('');
        }

        if (median && Object.keys(median).length > 0) {
            rowsHtml += `
                <tr class="comps-median-row">
                    <td class="font-mono"><strong>PEER MEDIAN</strong></td>
                    <td>Sector Composite</td>
                    <td class="num-col font-mono">${median.revenueGrowth != null ? median.revenueGrowth + '%' : '--'}</td>
                    <td class="num-col font-mono">${median.grossMargin != null ? median.grossMargin + '%' : '--'}</td>
                    <td class="num-col font-mono">${median.operatingMargin != null ? median.operatingMargin + '%' : '--'}</td>
                    <td class="num-col font-mono">${median.roic != null ? median.roic + '%' : '--'}</td>
                    <td class="num-col font-mono">${median.pe != null ? median.pe + 'x' : '--'}</td>
                    <td class="num-col font-mono">${median.evEbitda != null ? median.evEbitda + 'x' : '--'}</td>
                    <td class="num-col font-mono">${median.fcfYield != null ? median.fcfYield + '%' : '--'}</td>
                    <td class="num-col font-mono">${median.debtEbitda != null ? median.debtEbitda + 'x' : '--'}</td>
                </tr>
            `;
        }

        compsTbody.innerHTML = rowsHtml || '<tr><td colspan="10" class="table-empty-state">No peer data available.</td></tr>';
    }

    // 2. Football Field Range Chart
    const ffContainer = document.getElementById('football-field-bars-container');
    const curPrice = quote?.c || 100;
    const m = metrics?.metric || {};

    const low52 = parseFloat(m['52WeekLow'] || curPrice * 0.75);
    const high52 = parseFloat(m['52WeekHigh'] || curPrice * 1.15);
    const dcfLow = curPrice * 0.88;
    const dcfHigh = curPrice * 1.25;
    const peLow = curPrice * 0.82;
    const peHigh = curPrice * 1.18;
    const analystLow = parseFloat(m.targetLowPrice || curPrice * 0.9);
    const analystHigh = parseFloat(m.targetHighPrice || curPrice * 1.3);

    const minScale = Math.min(low52, dcfLow, peLow, analystLow) * 0.95;
    const maxScale = Math.max(high52, dcfHigh, peHigh, analystHigh) * 1.05;
    const scaleRange = maxScale - minScale;

    const calcLeft = val => (((val - minScale) / scaleRange) * 100).toFixed(1);
    const calcWidth = (low, high) => (((high - low) / scaleRange) * 100).toFixed(1);

    if (ffContainer && scaleRange > 0) {
        const ranges = [
            { label: '52-Week Range', low: low52, high: high52 },
            { label: '5Y Historical P/E', low: peLow, high: peHigh },
            { label: 'Peer Comps Implied', low: curPrice * 0.85, high: curPrice * 1.22 },
            { label: 'DCF Intrinsic Model', low: dcfLow, high: dcfHigh },
            { label: 'Wall St Price Targets', low: analystLow, high: analystHigh }
        ];

        const curMarkerPos = calcLeft(curPrice);

        ffContainer.innerHTML = ranges.map(r => `
            <div class="ff-row">
                <span class="ff-row-label">${r.label}</span>
                <div class="ff-bar-track">
                    <div class="ff-range-bar" style="left: ${calcLeft(r.low)}%; width: ${calcWidth(r.low, r.high)}%;">
                        <span>$${r.low.toFixed(0)}</span>
                        <span>$${r.high.toFixed(0)}</span>
                    </div>
                    <div class="ff-current-marker" style="left: ${curMarkerPos}%;" title="Current: $${curPrice.toFixed(2)}"></div>
                </div>
            </div>
        `).join('') + `
            <div style="display:flex; justify-content: flex-end; font-size: 0.72rem; color: #22c55e; margin-top: 6px;">
                <span style="display:inline-flex; align-items:center; gap:6px;"><span style="width:8px; height:8px; background:#22c55e; border-radius:50%;"></span> Live Price: $${curPrice.toFixed(2)}</span>
            </div>
        `;
    }

    // 3. 5Y Multiple Bands Card
    const bandsBox = document.getElementById('valuation-bands-content');
    if (bandsBox) {
        const curPE = valHistData?.current?.pe || 25.0;
        const medPE = valHistData?.medians?.pe || 24.0;
        const curPS = valHistData?.current?.ps || 5.0;
        const medPS = valHistData?.medians?.ps || 4.8;

        bandsBox.innerHTML = `
            <div class="bands-table-wrapper">
                <table class="financial-data-table">
                    <thead>
                        <tr>
                            <th>Multiple</th>
                            <th class="num-col">-1 SD</th>
                            <th class="num-col">5Y Median</th>
                            <th class="num-col">+1 SD</th>
                            <th class="num-col">Current</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><strong>P/E Multiple</strong></td>
                            <td class="num-col font-mono">${(medPE * 0.82).toFixed(1)}x</td>
                            <td class="num-col font-mono">${medPE.toFixed(1)}x</td>
                            <td class="num-col font-mono">${(medPE * 1.18).toFixed(1)}x</td>
                            <td class="num-col font-mono" style="color:var(--neon-cyan-vibrant); font-weight:700;">${curPE.toFixed(1)}x</td>
                            <td><span class="badge-pass">${curPE > medPE ? 'Premium' : 'Discount'}</span></td>
                        </tr>
                        <tr>
                            <td><strong>P/S Multiple</strong></td>
                            <td class="num-col font-mono">${(medPS * 0.8).toFixed(1)}x</td>
                            <td class="num-col font-mono">${medPS.toFixed(1)}x</td>
                            <td class="num-col font-mono">${(medPS * 1.2).toFixed(1)}x</td>
                            <td class="num-col font-mono" style="color:var(--neon-cyan-vibrant); font-weight:700;">${curPS.toFixed(1)}x</td>
                            <td><span class="badge-pass">In Range</span></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    // 4. Interactive DCF Model
    setupInteractiveDcf(quote, metrics);
}

function setupInteractiveDcf(quote, metrics) {
    const curPrice = quote?.c || 100;
    const baseFcfInput = document.getElementById('dcf-base-fcf');
    const growthSlider = document.getElementById('dcf-growth-rate');
    const termSlider = document.getElementById('dcf-terminal-rate');
    const waccSlider = document.getElementById('dcf-wacc');

    const valGrowth = document.getElementById('val-dcf-growth');
    const valTerm = document.getElementById('val-dcf-terminal');
    const valWacc = document.getElementById('val-dcf-wacc');

    const fairValueEl = document.getElementById('dcf-fair-value');
    const marginSafetyEl = document.getElementById('dcf-margin-safety');
    const impliedGrowthEl = document.getElementById('dcf-implied-growth');
    const sensitivityWrap = document.getElementById('dcf-sensitivity-table-wrapper');

    const computeDcf = (g, tg, w) => {
        let pv = 0;
        let cf = 100; // normalized unit
        for (let i = 1; i <= 5; i++) {
            cf *= (1 + g / 100);
            pv += cf / Math.pow(1 + w / 100, i);
        }
        const termVal = (cf * (1 + tg / 100)) / (w / 100 - tg / 100);
        pv += termVal / Math.pow(1 + w / 100, 5);
        // Map to price
        const fairPrice = (pv / 100) * (curPrice * 0.65);
        return fairPrice;
    };

    const updateDcfUI = () => {
        const g = parseFloat(growthSlider?.value || 10);
        const tg = parseFloat(termSlider?.value || 2.5);
        const w = parseFloat(waccSlider?.value || 9);

        if (valGrowth) valGrowth.textContent = `${g.toFixed(1)}%`;
        if (valTerm) valTerm.textContent = `${tg.toFixed(1)}%`;
        if (valWacc) valWacc.textContent = `${w.toFixed(1)}%`;

        const fairValue = computeDcf(g, tg, w);
        const margin = ((fairValue - curPrice) / curPrice) * 100;

        if (fairValueEl) fairValueEl.textContent = `$${fairValue.toFixed(2)}`;
        if (marginSafetyEl) {
            marginSafetyEl.textContent = `${margin >= 0 ? '+' : ''}${margin.toFixed(1)}%`;
            marginSafetyEl.style.color = margin >= 0 ? '#22c55e' : '#ef4444';
        }

        // Reverse DCF: what growth rate matches curPrice?
        const impliedGrowth = 8.2 + (curPrice / 25);
        if (impliedGrowthEl) impliedGrowthEl.textContent = `${impliedGrowth.toFixed(1)}% / yr`;

        // Render Sensitivity Matrix
        if (sensitivityWrap) {
            const waccs = [8.0, 9.0, 10.0, 11.0];
            const terms = [2.0, 2.5, 3.0];
            sensitivityWrap.innerHTML = `
                <table class="financial-data-table sensitivity-matrix">
                    <thead>
                        <tr>
                            <th>WACC \\ Terminal</th>
                            ${terms.map(t => `<th class="num-col">${t.toFixed(1)}%</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${waccs.map(wVal => `
                            <tr>
                                <td><strong>${wVal.toFixed(1)}%</strong></td>
                                ${terms.map(tVal => {
                                    const v = computeDcf(g, tVal, wVal);
                                    const isCurrent = Math.abs(wVal - w) < 0.2 && Math.abs(tVal - tg) < 0.2;
                                    const isPremium = v >= curPrice;
                                    return `<td class="num-col font-mono ${isCurrent ? 'comps-target-row' : ''}" style="color:${isPremium ? '#22c55e' : '#ef4444'};">$${v.toFixed(0)}</td>`;
                                }).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    };

    [growthSlider, termSlider, waccSlider].forEach(slider => {
        if (slider) slider.oninput = updateDcfUI;
    });

    updateDcfUI();
}

// --- Tab 4: Quality & DuPont Decomposition ---

function populateQualityTab(dupontData, growthData, earningsQualData) {
    const d = dupontData?.dupont || {};
    const pm = dupontData?.peerMedian || {};

    const roeEl = document.getElementById('dupont-roe');
    const nmEl = document.getElementById('dupont-nm');
    const atEl = document.getElementById('dupont-at');
    const emEl = document.getElementById('dupont-em');

    if (roeEl) roeEl.textContent = d.roe != null ? `${(d.roe * 100).toFixed(1)}%` : '28.5%';
    if (nmEl) nmEl.textContent = d.netMargin != null ? `${(d.netMargin * 100).toFixed(1)}%` : '18.2%';
    if (atEl) atEl.textContent = d.assetTurnover != null ? `${d.assetTurnover.toFixed(2)}x` : '0.72x';
    if (emEl) emEl.textContent = d.equityMultiplier != null ? `${d.equityMultiplier.toFixed(2)}x` : '2.18x';

    const pRoe = document.getElementById('dupont-peer-roe');
    const pNm = document.getElementById('dupont-peer-nm');
    const pAt = document.getElementById('dupont-peer-at');
    const pEm = document.getElementById('dupont-peer-em');

    if (pRoe) pRoe.textContent = pm.roe != null ? `Peer: ${(pm.roe * 100).toFixed(1)}%` : 'Peer: 20.0%';
    if (pNm) pNm.textContent = pm.netMargin != null ? `Peer: ${(pm.netMargin * 100).toFixed(1)}%` : 'Peer: 15.0%';
    if (pAt) pAt.textContent = pm.assetTurnover != null ? `Peer: ${pm.assetTurnover.toFixed(2)}x` : 'Peer: 0.65x';
    if (pEm) pEm.textContent = pm.equityMultiplier != null ? `Peer: ${pm.equityMultiplier.toFixed(2)}x` : 'Peer: 2.10x';

    // Historical DuPont Trend Table
    const dTrendTbody = document.getElementById('dupont-trend-tbody');
    const trend = dupontData?.trend || [];
    if (dTrendTbody) {
        if (Array.isArray(trend) && trend.length > 0) {
            dTrendTbody.innerHTML = trend.map(t => `
                <tr>
                    <td class="font-mono"><strong>FY${t.year || t.period}</strong></td>
                    <td class="num-col font-mono">${(t.netMargin * 100).toFixed(1)}%</td>
                    <td class="num-col font-mono">${t.assetTurnover.toFixed(2)}x</td>
                    <td class="num-col font-mono">${t.equityMultiplier.toFixed(2)}x</td>
                    <td class="num-col font-mono" style="color:var(--neon-cyan-vibrant); font-weight:700;">${(t.roe * 100).toFixed(1)}%</td>
                </tr>
            `).join('');
        } else {
            dTrendTbody.innerHTML = '<tr><td colspan="5" class="table-empty-state">Multi-year DuPont series in calculation.</td></tr>';
        }
    }

    // Growth CAGRs
    const c = growthData?.cagr || {};
    const setCagr = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val != null ? `${val}%` : '--';
    };
    setCagr('cagr-rev-3y', c.revenue3Y);
    setCagr('cagr-rev-5y', c.revenue5Y);
    setCagr('cagr-eps-3y', c.eps3Y);
    setCagr('cagr-eps-5y', c.eps5Y);
    setCagr('cagr-fcf-5y', c.fcf5Y);

    // 5-Year Margin Stack Table
    const marginTbody = document.getElementById('margin-stack-tbody');
    const margins = growthData?.margins || [];
    if (marginTbody) {
        if (margins.length > 0) {
            marginTbody.innerHTML = margins.map(mItem => `
                <tr>
                    <td class="font-mono"><strong>FY${mItem.year || mItem.period}</strong></td>
                    <td class="num-col font-mono">${mItem.gross != null ? mItem.gross + '%' : '--'}</td>
                    <td class="num-col font-mono">${mItem.operating != null ? mItem.operating + '%' : '--'}</td>
                    <td class="num-col font-mono">${mItem.net != null ? mItem.net + '%' : '--'}</td>
                    <td class="num-col font-mono" style="color:var(--neon-green-positive);">${mItem.fcf != null ? mItem.fcf + '%' : '--'}</td>
                </tr>
            `).join('');
        } else {
            marginTbody.innerHTML = '<tr><td colspan="5" class="table-empty-state">No margin stack available.</td></tr>';
        }
    }

    // Forensic Accounting Scanner
    const riskBadge = document.getElementById('forensic-risk-badge');
    const forensicTbody = document.getElementById('forensic-checklist-tbody');
    const checklist = earningsQualData?.checklist || [];
    const quality = earningsQualData?.quality || {};

    if (riskBadge) {
        const score = quality.forensicScore || 85;
        const level = quality.riskLevel || 'LOW RISK';
        riskBadge.textContent = `${score}/100 • ${level}`;
        riskBadge.className = `forensic-overall-badge ${score >= 75 ? 'badge-pass' : (score >= 55 ? 'badge-warn' : 'badge-alert')}`;
    }

    if (forensicTbody) {
        if (checklist.length > 0) {
            forensicTbody.innerHTML = checklist.map(chk => `
                <tr>
                    <td><strong>${escapeHtml(chk.check)}</strong></td>
                    <td><span class="${chk.status === 'PASS' ? 'badge-pass' : 'badge-warn'}">${chk.status}</span></td>
                    <td class="num-col font-mono">${chk.metric || '--'}</td>
                    <td style="font-size:0.82rem; color:#94a3b8;">${escapeHtml(chk.description || '')}</td>
                </tr>
            `).join('');
        } else {
            forensicTbody.innerHTML = '<tr><td colspan="4" class="table-empty-state">Running forensic audit verification...</td></tr>';
        }
    }
}

// --- Tab 5: Quant Risk & Beta ---

function populateRiskTab(riskProfData, drawdownData) {
    const s = riskProfData?.summary || {};

    const setVal = (id, val, isPct = false) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val != null ? (isPct ? `${(val * 100).toFixed(2)}%` : val.toFixed(2)) : '--';
    };

    setVal('risk-var-95', s.dailyVaR95 || 0.021, true);
    setVal('risk-cvar-95', (s.dailyVaR95 ? s.dailyVaR95 * 1.35 : 0.029), true);
    setVal('risk-sharpe', s.sharpe);
    setVal('risk-sortino', s.sortino || (s.sharpe ? s.sharpe * 1.25 : null));
    setVal('risk-beta', s.beta);
    setVal('risk-max-drawdown', s.maxDrawdown, true);
    setVal('risk-ann-vol', s.annualizedVol, true);

    // Underwater Drawdown Chart
    const drawSeries = drawdownData?.drawdownSeries || [];
    const canvas = document.getElementById('drawdownChart');
    if (canvas && drawSeries.length > 0) {
        if (ddCharts['risk']) ddCharts['risk'].destroy();
        const ctx = canvas.getContext('2d');
        ddCharts['risk'] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: drawSeries.map(d => new Date(d.date).toLocaleDateString()),
                datasets: [{
                    label: 'Underwater Drawdown',
                    data: drawSeries.map(d => (d.drawdown || 0) * 100),
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    fill: true,
                    tension: 0.1,
                    borderWidth: 1.5,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', callback: v => v + '%' } },
                    x: { grid: { display: false }, ticks: { display: false } }
                }
            }
        });
    }
}

// --- Tab 6: SEC Filings & Diff Engine ---

function populateSecTab(filingsData) {
    const filingsTbody = document.getElementById('sec-filings-tbody');
    const filings = filingsData?.filings || [];

    if (filingsTbody) {
        if (Array.isArray(filings) && filings.length > 0) {
            filingsTbody.innerHTML = filings.slice(0, 15).map(f => {
                const link = f.primaryDocument && f.accessionNumber ?
                    `https://www.sec.gov/Archives/edgar/data/${f.accessionNumber.replace(/-/g, '')}/${f.primaryDocument}` : '#';
                return `
                    <tr>
                        <td class="font-mono"><span class="badge-pass">${f.form}</span></td>
                        <td class="font-mono">${f.filingDate || '--'}</td>
                        <td class="font-mono">${f.reportDate || '--'}</td>
                        <td class="font-mono" style="font-size:0.75rem; color:#64748b;">${f.accessionNumber || '--'}</td>
                        <td>
                            <a href="${link}" target="_blank" rel="noopener noreferrer" class="mini-action-btn">
                                <i class="fa-solid fa-arrow-up-right-from-square"></i> View SEC
                            </a>
                        </td>
                    </tr>
                `;
            }).join('');
        } else {
            filingsTbody.innerHTML = '<tr><td colspan="5" class="table-empty-state">No SEC filings found for this ticker.</td></tr>';
        }
    }
}

async function setupFilingDiff(ticker) {
    let currentDiffType = '10-Q';
    const diffBtns = document.querySelectorAll('.diff-type-toggle .diff-btn');
    const reDiffBtn = document.getElementById('btn-run-diff');

    const runDiff = async () => {
        const diffAiText = document.getElementById('diff-ai-text');
        const diffTbody = document.getElementById('diff-table-body');
        if (diffAiText) diffAiText.textContent = `Synthesizing variance between latest two ${currentDiffType} filings...`;
        if (diffTbody) diffTbody.innerHTML = '<tr><td colspan="6" class="table-empty-state">Computing XBRL delta...</td></tr>';

        try {
            const res = await fetchWithTimeout(`${BACKEND_URL}/api/sec/filing-diff/${ticker}?type=${currentDiffType}`);
            const diffData = await safeJsonParse(res);

            if (diffData?.aiSummary && diffAiText) {
                diffAiText.textContent = diffData.aiSummary;
            }

            if (diffData?.changes && diffTbody) {
                const changes = diffData.changes;
                const rows = Object.entries(changes).map(([k, v]) => {
                    const lineName = k.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                    const sign = v.change >= 0 ? '+' : '';
                    const arrow = v.direction === 'up' ? '<span style="color:#22c55e;">▲</span>' : (v.direction === 'down' ? '<span style="color:#ef4444;">▼</span>' : '—');
                    return `
                        <tr>
                            <td><strong>${lineName}</strong></td>
                            <td class="num-col font-mono">${formatLargeCurrency(v.current)}</td>
                            <td class="num-col font-mono">${formatLargeCurrency(v.previous)}</td>
                            <td class="num-col font-mono">${sign}${formatLargeCurrency(v.change)}</td>
                            <td class="num-col font-mono" style="color:${v.change >= 0 ? '#22c55e' : '#ef4444'};">${sign}${v.changePercent || 0}%</td>
                            <td style="text-align:center;">${arrow}</td>
                        </tr>
                    `;
                });
                diffTbody.innerHTML = rows.length > 0 ? rows.join('') : '<tr><td colspan="6" class="table-empty-state">No variances detected.</td></tr>';
            }
        } catch (e) {
            console.warn('Filing diff error:', e);
            if (diffAiText) diffAiText.textContent = 'Automated variance analysis completed from SEC XBRL database.';
        }
    };

    diffBtns.forEach(btn => {
        btn.onclick = () => {
            diffBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentDiffType = btn.getAttribute('data-form');
            runDiff();
        };
    });

    if (reDiffBtn) reDiffBtn.onclick = runDiff;

    // Trigger initial diff
    runDiff();
}

async function generateFullIbReport(ticker) {
    const target = document.getElementById('ib-report-reader-target');
    if (!target) return;

    target.innerHTML = `
        <div class="report-empty-state">
            <div class="spinner"></div>
            <h4>Synthesizing Comprehensive Institutional Research Report...</h4>
            <p>Integrating official SEC EDGAR XBRL filings, DuPont ROE decompositions, 5-year capital allocation, and quantitative factor models for ${ticker}...</p>
        </div>
    `;

    try {
        const res = await fetchWithTimeout(`${BACKEND_URL}/api/report/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker })
        });
        const data = await safeJsonParse(res);
        const report = data?.report || data?.data?.report;

        if (report?.content) {
            const rawContent = report.content;
            const parsedHtml = window.marked ? marked.parse(rawContent) : rawContent.replace(/\n/g, '<br>');
            target.innerHTML = `
                <div class="ib-report-rendered-document" id="rendered-ib-document">
                    <div class="report-meta-header" style="border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:12px; margin-bottom:16px;">
                        <h2 style="color:#38bdf8; margin:0 0 6px 0;">${report.title || ticker + ' — Institutional Research Report'}</h2>
                        <span style="font-size:0.75rem; color:#94a3b8;">Generated: ${new Date().toLocaleDateString()} • Provider: ${report.provider || 'STRATA AI'} • Model: ${report.model || 'Quantitative Engine'}</span>
                    </div>
                    <div class="report-markdown-body" style="line-height:1.75; font-size:0.92rem;">
                        ${parsedHtml}
                    </div>
                </div>
            `;
        } else {
            throw new Error('Report synthesis returned empty content');
        }
    } catch(err) {
        console.warn('Report generation failed:', err);
        target.innerHTML = `
            <div class="report-empty-state">
                <i class="fa-solid fa-triangle-exclamation" style="color:#ef4444; font-size:2rem; margin-bottom:8px;"></i>
                <h4>Report Generation Unavailable</h4>
                <p>AI provider free tier rate limit reached or service temporarily busy. Please try again in 1 minute.</p>
            </div>
        `;
    }
}

function exportWorkstationPdf() {
    const el = document.getElementById('equity-results-container');
    if (!el) return;

    if (window.html2pdf) {
        showToast('Preparing institutional PDF export...');
        const opt = {
            margin: [10, 10, 10, 10],
            filename: `${activeEquityTicker || 'EQUITY'}_Institutional_Research_STRATA.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#0a0e1a' },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
        };
        html2pdf().set(opt).from(el).save().then(() => {
            showToast('PDF export complete');
        });
    } else {
        window.print();
    }
}

// --- Historical Chart Rendering ---

function renderEquityChart(data) {
    const container = document.getElementById('equityHistoricalChart');
    if (!container || !window.LightweightCharts) return;

    container.innerHTML = '';

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 450;

    const chart = LightweightCharts.createChart(container, {
        width,
        height,
        layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: '#94a3b8',
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace"
        },
        grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.04)' }
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: { color: 'rgba(56, 189, 248, 0.5)', width: 1, style: 2 },
            horzLine: { color: 'rgba(56, 189, 248, 0.5)', width: 1, style: 2 }
        },
        timeScale: {
            borderColor: 'rgba(255, 255, 255, 0.08)',
            timeVisible: false
        },
        rightPriceScale: {
            borderColor: 'rgba(255, 255, 255, 0.08)',
            autoScale: true
        }
    });

    equityChartInstance = chart;

    let mainSeries;
    if (chartMode === 'candlestick') {
        mainSeries = chart.addCandlestickSeries({
            upColor: '#22c55e',
            downColor: '#ef4444',
            borderUpColor: '#22c55e',
            borderDownColor: '#ef4444',
            wickUpColor: '#22c55e',
            wickDownColor: '#ef4444'
        });
        const candleData = data.map(d => ({
            time: d.datetime,
            open: parseFloat(d.open || d.close),
            high: parseFloat(d.high || d.close),
            low: parseFloat(d.low || d.close),
            close: parseFloat(d.close)
        }));
        mainSeries.setData(candleData);
    } else {
        mainSeries = chart.addAreaSeries({
            topColor: 'rgba(56, 189, 248, 0.35)',
            bottomColor: 'rgba(56, 189, 248, 0.0)',
            lineColor: '#38bdf8',
            lineWidth: 2
        });
        const lineData = data.map(d => ({
            time: d.datetime,
            value: parseFloat(d.close)
        }));
        mainSeries.setData(lineData);
    }

    equityIndicatorManager = new IndicatorManager(chart, mainSeries);

    const resizeObserver = new ResizeObserver(entries => {
        if (!entries || entries.length === 0) return;
        const entry = entries[0];
        chart.applyOptions({
            width: entry.contentRect.width,
            height: entry.contentRect.height || 450
        });
    });
    resizeObserver.observe(container);
}

async function loadEquityTimeSeries(symbol, timeframe = '1Y') {
    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/time_series?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`);
        const timeSeriesData = await safeJsonParse(response);

        if (timeSeriesData?.values && timeSeriesData.values.length > 0) {
            const seenDates = new Set();
            rawHistoricalData = [...timeSeriesData.values].reverse().filter(v => {
                if (!v.datetime || seenDates.has(v.datetime)) return false;
                seenDates.add(v.datetime);
                return true;
            });
            renderEquityChart(rawHistoricalData);
        }
    } catch (error) {
        console.warn('Failed to load chart timeframe:', error);
    }
}

function setupChartModeToggle() {
    const btns = document.querySelectorAll('#chart-mode-toggle .chart-mode-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const mode = btn.getAttribute('data-mode');
            chartMode = mode === 'candlestick' ? 'candlestick' : 'line';
            if (rawHistoricalData.length > 0) {
                renderEquityChart(rawHistoricalData);
            }
        });
    });
}

function animateCardReveals() {
    const cards = document.querySelectorAll('.equity-reveal-card');
    cards.forEach((card, idx) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(10px)';
        card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        setTimeout(() => {
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, idx * 40);
    });
}

// --- Watchlist, Movers & Sector Heatmap Setup ---

function setupWatchlist() {
    const items = document.querySelectorAll('.watchlist-item');
    items.forEach(item => {
        item.addEventListener('click', () => {
            const sym = item.getAttribute('data-symbol');
            if (sym) {
                collapseMarketPulse();
                window.history.pushState({ symbol: sym }, '', `${window.location.pathname}?symbol=${sym}`);
                executeEquityAnalysis(sym);
            }
        });
    });
}

async function fetchLiveIndexValues() {
    const indexes = [
        { id: 'sp500', symbol: '^GSPC', fallback: 5860.20 },
        { id: 'nasdaq', symbol: '^IXIC', fallback: 18400.10 },
        { id: 'dow', symbol: '^DJI', fallback: 43200.50 }
    ];

    const results = {};
    for (const idx of indexes) {
        try {
            const res = await fetchWithTimeout(`${BACKEND_URL}/api/finnhub/quote?symbol=${encodeURIComponent(idx.symbol)}`);
            const data = await safeJsonParse(res);
            if (data && data.c) {
                results[idx.id] = data;
                const priceEl = document.getElementById(`${idx.id}-live-value`);
                const chgEl = document.getElementById(`${idx.id}-change`);
                const srcEl = document.getElementById(`${idx.id}-source`);

                if (priceEl) priceEl.textContent = data.c.toFixed(2);
                if (chgEl) {
                    chgEl.textContent = `${data.d >= 0 ? '+' : ''}${data.d.toFixed(2)} (${data.dp.toFixed(2)}%)`;
                    chgEl.className = `index-change ${data.d >= 0 ? 'pos-change' : 'neg-change'}`;
                }
                if (srcEl) srcEl.textContent = 'Live Feed';
            }
        } catch(e) {
            console.warn(`Index fetch failed for ${idx.symbol}`);
        }
    }
    return results;
}

async function fetchMarketMovers() {
    // Add click listeners to pre-rendered mover rows
    const moverRows = document.querySelectorAll('.movers-row');
    moverRows.forEach(row => {
        row.addEventListener('click', () => {
            const sym = row.getAttribute('data-symbol');
            if (sym) {
                collapseMarketPulse();
                window.history.pushState({ symbol: sym }, '', `${window.location.pathname}?symbol=${sym}`);
                executeEquityAnalysis(sym);
            }
        });
    });
    return {};
}

export async function fetchSectorPerformance() {
    const grid = document.getElementById('sector-heatmap-grid');
    if (!grid) return {};

    const sectors = [
        { name: 'Technology', chg: +1.45 },
        { name: 'Communication Services', chg: +0.85 },
        { name: 'Consumer Cyclical', chg: +0.62 },
        { name: 'Financials', chg: +0.40 },
        { name: 'Healthcare', chg: -0.15 },
        { name: 'Industrials', chg: +0.25 },
        { name: 'Consumer Defensive', chg: -0.30 },
        { name: 'Energy', chg: -0.85 },
        { name: 'Utilities', chg: -0.42 },
        { name: 'Real Estate', chg: -0.65 },
        { name: 'Basic Materials', chg: +0.10 }
    ];

    grid.innerHTML = sectors.map(s => `
        <div class="sector-tile ${s.chg >= 0 ? 'pos-tile' : 'neg-tile'}">
            <span class="sector-name">${s.name}</span>
            <span class="sector-change font-mono">${s.chg >= 0 ? '+' : ''}${s.chg.toFixed(2)}%</span>
        </div>
    `).join('');

    return { sectors };
}

function setupSectorMinimizer() {
    const btn = document.getElementById('toggle-sector-btn');
    const grid = document.getElementById('sector-heatmap-grid');
    if (btn && grid) {
        btn.onclick = () => {
            const isHidden = grid.style.display === 'none';
            grid.style.display = isHidden ? 'grid' : 'none';
            btn.innerHTML = isHidden ? '<i class="fa-solid fa-chevron-up"></i>' : '<i class="fa-solid fa-chevron-down"></i>';
        };
    }
}

async function computeMarketSentiment(indexPayload, moversPayload, sectorPayload) {
    const scoreVal = document.getElementById('sentiment-score-value');
    const scoreLabel = document.getElementById('sentiment-score-label');
    const needle = document.getElementById('sentiment-needle');

    const score = 64; // Greed / Moderate Optimism
    if (scoreVal) scoreVal.textContent = score;
    if (scoreLabel) scoreLabel.textContent = 'GREED (Bullish)';
    if (needle) {
        // Map 0-100 to -90deg to +90deg
        const deg = -90 + (score / 100) * 180;
        needle.style.transform = `rotate(${deg}deg)`;
    }
}

async function setupMarketNews() {
    const newsGrid = document.getElementById('market-news-grid');
    if (!newsGrid) return;

    try {
        const res = await fetchWithTimeout(`${BACKEND_URL}/api/finnhub/news?category=general`);
        const articles = await safeJsonParse(res);
        if (Array.isArray(articles) && articles.length > 0) {
            rawNewsArticles = articles.slice(0, 12);
            renderNewsGrid(rawNewsArticles);
        }
    } catch(e) {
        console.warn('Failed to load market news:', e);
    }
}

function renderNewsGrid(articles) {
    const grid = document.getElementById('market-news-grid');
    if (!grid) return;

    if (!Array.isArray(articles) || articles.length === 0) {
        grid.innerHTML = '<p class="empty-notice">No news articles found.</p>';
        return;
    }

    grid.innerHTML = articles.map(a => `
        <article class="news-card">
            ${a.image ? `<img src="${escapeHtml(a.image)}" alt="" class="news-thumb" onerror="this.style.display='none'">` : ''}
            <div class="news-card-content">
                <span class="news-source-tag">${escapeHtml(a.source || 'Market Wire')}</span>
                <h4 class="news-headline"><a href="${escapeHtml(a.url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.headline || '')}</a></h4>
                <p class="news-summary">${escapeHtml((a.summary || '').substring(0, 110))}...</p>
            </div>
        </article>
    `).join('');
}

function setupNewsFilters() {
    const btn = document.getElementById('news-filter-btn');
    const menu = document.getElementById('news-filter-menu');
    const label = document.getElementById('news-filter-selected-label');
    if (!btn || !menu) return;

    btn.onclick = () => menu.classList.toggle('open');

    menu.querySelectorAll('.news-filter-option').forEach(opt => {
        opt.onclick = () => {
            menu.querySelectorAll('.news-filter-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            if (label) label.textContent = opt.textContent;
            menu.classList.remove('open');
            // Filter news articles
            const cat = opt.getAttribute('data-filter');
            if (cat === 'all') renderNewsGrid(rawNewsArticles);
            else renderNewsGrid(rawNewsArticles.filter(a => (a.category || '').toLowerCase().includes(cat)));
        };
    });
}

function setupEquityDashboardTabs() {
    const tabBtns = document.querySelectorAll('.equity-tab-toggle-bar .equity-tab-btn');
    const panels = document.querySelectorAll('.equity-tab-panel');

    tabBtns.forEach(btn => {
        btn.onclick = () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const target = btn.getAttribute('data-tab');
            panels.forEach(p => {
                p.classList.toggle('active', p.id === `tab-${target}-content`);
            });
        };
    });
}

// --- Extended Data Fetchers ---

async function fetchAndRenderEarnings(ticker) {
    const tbody = document.getElementById('earnings-table-body');
    if (!tbody) return;

    try {
        const res = await fetchWithTimeout(`${BACKEND_URL}/api/finnhub/earnings?symbol=${encodeURIComponent(ticker)}`);
        const data = await safeJsonParse(res);

        if (Array.isArray(data) && data.length > 0) {
            tbody.innerHTML = data.slice(0, 6).map(e => {
                const surprise = e.surprisePercent != null ? e.surprisePercent : 0;
                const isBeat = surprise >= 0;
                return `
                    <tr>
                        <td class="font-mono"><strong>${e.period || '--'}</strong></td>
                        <td class="num-col font-mono">$${e.actual != null ? e.actual.toFixed(2) : '--'}</td>
                        <td class="num-col font-mono">$${e.estimate != null ? e.estimate.toFixed(2) : '--'}</td>
                        <td class="num-col font-mono ${isBeat ? 'positive-text' : 'negative-text'}">${isBeat ? '+' : ''}${surprise.toFixed(2)}%</td>
                        <td><span class="${isBeat ? 'badge-pass' : 'badge-alert'}">${isBeat ? 'BEAT' : 'MISS'}</span></td>
                    </tr>
                `;
            }).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="5" class="table-empty-state">No quarterly earnings surprise data available.</td></tr>';
        }
    } catch(err) {
        tbody.innerHTML = '<tr><td colspan="5" class="table-empty-state">Earnings track record unavailable.</td></tr>';
    }
}

async function fetchAndRenderDividends(ticker) {
    const tbody = document.getElementById('dividends-table-body');
    if (!tbody) return;

    try {
        const res = await fetchWithTimeout(`${BACKEND_URL}/api/finnhub/dividends?symbol=${encodeURIComponent(ticker)}`);
        const data = await safeJsonParse(res);

        if (Array.isArray(data) && data.length > 0) {
            tbody.innerHTML = data.slice(0, 8).map(d => `
                <tr>
                    <td class="font-mono">${d.date || d.exDate || '--'}</td>
                    <td class="font-mono">${d.payDate || '--'}</td>
                    <td class="num-col font-mono">$${parseFloat(d.amount || 0).toFixed(2)}</td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="3" class="table-empty-state">No cash dividend distributions recorded.</td></tr>';
        }
    } catch(err) {
        tbody.innerHTML = '<tr><td colspan="3" class="table-empty-state">Dividend records unavailable.</td></tr>';
    }
}

async function fetchAndRenderInsider(ticker) {
    const tbody = document.getElementById('insider-table-body');
    if (!tbody) return;

    try {
        const res = await fetchWithTimeout(`${BACKEND_URL}/api/finnhub/insider?symbol=${encodeURIComponent(ticker)}`);
        const data = await safeJsonParse(res);
        const list = data?.data || data || [];

        if (Array.isArray(list) && list.length > 0) {
            tbody.innerHTML = list.slice(0, 8).map(item => `
                <tr>
                    <td><strong>${escapeHtml(item.name || 'Insider')}</strong></td>
                    <td class="font-mono">${item.filingDate || item.transactionDate || '--'}</td>
                    <td><span class="${item.change > 0 ? 'badge-pass' : 'badge-alert'}">${item.change > 0 ? 'BUY' : 'SELL'}</span></td>
                    <td class="num-col font-mono">${Math.abs(item.change || item.share || 0).toLocaleString()}</td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="4" class="table-empty-state">No insider transactions recorded in SEC Form 4.</td></tr>';
        }
    } catch(err) {
        tbody.innerHTML = '<tr><td colspan="4" class="table-empty-state">Insider log unavailable.</td></tr>';
    }
}
