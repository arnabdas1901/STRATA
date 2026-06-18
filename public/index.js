/**
 * EQUITRACK - Master JavaScript Engine
 * (Secured, Optimized, and Rate-Limit Resilient for Local Backend)
 */

// --- GLOBAL STATE ---
// Same origin when served by server.js; fallback for Live Server / file://
const BACKEND_URL = (window.location.protocol === 'file:' || (window.location.hostname === 'localhost' && window.location.port !== '3000') || (window.location.hostname === '127.0.0.1' && window.location.port !== '3000')) 
    ? 'http://localhost:3000' 
    : '';
let equityChartInstance = null;
let calcChartInstance = null;
let portfolioChartInstance = null;
let cryptoChartInstance = null;
let macroChartInstance = null;
let globalCountryMap = [];
let rawHistoricalData = [];
let activeEquityTicker = null;
let activeCalcType = 'sip';
let isAnalyzing = false;
let isAiRunning = false;
let commodityData = [];
let selectedCommoditySymbol = null;

const COMMODITY_PROXY_DEFINITIONS = [
    { id: 'gold', name: 'Gold', emoji: '🪙', symbol: 'GLD', description: 'SPDR Gold Shares' },
    { id: 'silver', name: 'Silver', emoji: '⚪', symbol: 'SLV', description: 'iShares Silver Trust' },
    { id: 'crude_oil', name: 'Crude Oil', emoji: '🛢️', symbol: 'USO', description: 'United States Oil Fund' },
    { id: 'natural_gas', name: 'Natural Gas', emoji: '🔥', symbol: 'UNG', description: 'United States Natural Gas Fund' },
    { id: 'copper', name: 'Copper', emoji: '🟠', symbol: 'CPER', description: 'United States Copper Index Fund' },
    { id: 'platinum', name: 'Platinum', emoji: '⚪', symbol: 'PPLT', description: 'abrdn Physical Platinum Shares' },
    { id: 'wheat', name: 'Wheat', emoji: '🌾', symbol: 'WEAT', description: 'Teucrium Wheat Fund' },
    { id: 'corn', name: 'Corn', emoji: '🌽', symbol: 'CORN', description: 'Teucrium Corn Fund' },
];

// ==========================================
// 1. SYSTEM INITIALIZATION & UI ROUTING
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupMobileMenu();
    setupStatementTabs();
    setupTimeframeSelectors();
    setupCalculators();
    fetchLiveIndexValues();
    setupCommodityWatchlist();
    setupCryptoTracker();
    setupInflationTracker();
    
    // Bind Equity Search
    document.getElementById('equity-search-btn').addEventListener('click', executeEquityAnalysis);
    document.getElementById('equity-search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') executeEquityAnalysis();
    });
    const backBtn = document.getElementById('equity-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', clearEquityResults);
    }

    // Bind Portfolio Generator
    document.getElementById('generate-portfolio-btn').addEventListener('click', generatePortfolio);
    
    const riskInput = document.getElementById('portfolio-risk-input');
    if (riskInput) {
        riskInput.addEventListener('change', generatePortfolio);
    }

    setupAiAdvisor();

    // Initial render of default dashboard states
    renderCalcInputs('sip');
    generatePortfolio();
});

function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const viewports = document.querySelectorAll('.dashboard-viewport');
    const sidebar = document.querySelector('.sidebar');
    const toggleBtn = document.getElementById('mobile-menu-toggle');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(n => n.classList.remove('active'));
            viewports.forEach(v => v.classList.remove('active'));
            
            item.classList.add('active');
            const targetId = item.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');

            sidebar?.classList.remove('mobile-open');
            document.body.classList.remove('mobile-nav-open');
            toggleBtn?.setAttribute('aria-expanded', 'false');
        });
    });
}

function setupMobileMenu() {
    const toggleBtn = document.getElementById('mobile-menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    if (!toggleBtn || !sidebar) return;

    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.addEventListener('click', () => {
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

function setupStatementTabs() {
    const tabBtns = document.querySelectorAll('#dashboard-equity .panel-tab-btn');
    const tabPanels = document.querySelectorAll('#dashboard-equity .tab-panel');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active-panel'));
            
            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            document.getElementById(targetId).classList.add('active-panel');
        });
    });
}

function setupTimeframeSelectors() {
    const tfBtns = document.querySelectorAll('#dashboard-equity .tf-btn');
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

async function loadEquityTimeSeries(symbol, timeframe = '1Y') {
    if (!symbol) return;

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/time_series?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`);
        const timeSeriesData = await safeJsonParse(response);

        if (timeSeriesData?.values && timeSeriesData.values.length > 0) {
            rawHistoricalData = [...timeSeriesData.values].reverse();
            renderEquityChart(rawHistoricalData, timeframe);
            return true;
        }

        console.warn('Time series response missing values, falling back to existing data', timeSeriesData);
        if (rawHistoricalData.length > 0) {
            renderEquityChart(rawHistoricalData, timeframe);
            return false;
        }
        if (equityChartInstance) equityChartInstance.destroy();
        return false;
    } catch (error) {
        console.warn('Failed to load equity chart data:', error);
        if (rawHistoricalData.length > 0) {
            renderEquityChart(rawHistoricalData, timeframe);
            return false;
        }
        if (equityChartInstance) equityChartInstance.destroy();
        return false;
    }
}

async function fetchLiveIndexValues() {
    const spValue = document.getElementById('sp500-live-value');
    const spSource = document.getElementById('sp500-source');
    const spChange = document.getElementById('sp500-change');
    const nasValue = document.getElementById('nasdaq-live-value');
    const nasSource = document.getElementById('nasdaq-source');
    const nasChange = document.getElementById('nasdaq-change');

    try {
        const response = await fetch(`${BACKEND_URL}/api/indices`);
        if (!response.ok) {
            throw new Error(`Index data request failed with status ${response.status}`);
        }

        const payload = await response.json();
        const formatIndexValue = (value) => parseFloat(value).toFixed(2);
        const formatChange = (value, percentage) => `${value >= 0 ? '+' : ''}${parseFloat(value).toFixed(2)} (${parseFloat(percentage).toFixed(2)}%)`;
        const formatSource = (item, fallback) => {
            const symbol = item.symbol || item.requestedSymbol || fallback;
            return item.source ? `${symbol} - ${item.source}` : symbol;
        };

        if (payload?.sp500) {
            spValue && (spValue.innerText = formatIndexValue(payload.sp500.price));
            spSource && (spSource.innerText = formatSource(payload.sp500, 'S&P 500'));
            if (spChange) {
                spChange.innerText = formatChange(payload.sp500.change, payload.sp500.changePercent);
                spChange.className = 'index-change ' + (payload.sp500.change >= 0 ? 'pos-change' : 'neg-change');
            }
        }

        if (payload?.nasdaq) {
            nasValue && (nasValue.innerText = formatIndexValue(payload.nasdaq.price));
            nasSource && (nasSource.innerText = formatSource(payload.nasdaq, 'NASDAQ'));
            if (nasChange) {
                nasChange.innerText = formatChange(payload.nasdaq.change, payload.nasdaq.changePercent);
                nasChange.className = 'index-change ' + (payload.nasdaq.change >= 0 ? 'pos-change' : 'neg-change');
            }
        }
    } catch (error) {
        console.warn('Failed to load live index values:', error);
        const notice = 'Unavailable';
        spValue && (spValue.innerText = notice);
        spSource && (spSource.innerText = notice);
        spChange && (spChange.innerText = notice);
        nasValue && (nasValue.innerText = notice);
        nasSource && (nasSource.innerText = notice);
        nasChange && (nasChange.innerText = notice);
    }
}

async function setupCommodityWatchlist() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/commodities`);
        if (!response.ok) {
            throw new Error(`Commodity list request failed: ${response.status}`);
        }
        const payload = await response.json();
        commodityData = payload.commodities || [];
        renderCommodityList(commodityData);
        if (commodityData.length) {
            selectCommodity(commodityData[0].symbol);
        }
    } catch (error) {
        console.warn('Failed to load commodity watchlist:', error);
        const grid = document.getElementById('commodity-selector-grid');
        if (grid) {
            grid.innerHTML = '<div class="commodity-card">Unable to load commodity data.</div>';
        }
    }
}

function renderCommodityList(items) {
    const grid = document.getElementById('commodity-selector-grid');
    if (!grid) return;

    grid.innerHTML = items.map(item => {
        const priceText = item.price != null ? `$${parseFloat(item.price).toFixed(2)}` : 'N/A';
        const changeText = item.change != null ? `${item.change >= 0 ? '+' : ''}${parseFloat(item.change).toFixed(2)} (${item.changePercent != null ? parseFloat(item.changePercent).toFixed(2) : '0.00'}%)` : 'Unavailable';
        const changeClass = item.change != null ? (item.change >= 0 ? 'pos-change' : 'neg-change') : '';
        return `
            <button type="button" class="commodity-card" data-symbol="${item.symbol}" aria-label="View ${item.name} details">
                <div class="commodity-card-title">
                    <span>${item.emoji}</span>
                    <div>
                        <div class="commodity-card-name">${item.name}</div>
                        <div class="commodity-card-symbol">${item.symbol}</div>
                    </div>
                </div>
                <div class="commodity-card-price">${priceText}</div>
                <div class="commodity-card-change ${changeClass}">${changeText}</div>
            </button>
        `;
    }).join('');

    grid.querySelectorAll('.commodity-card').forEach(card => {
        card.addEventListener('click', () => {
            const symbol = card.getAttribute('data-symbol');
            selectCommodity(symbol);
        });
    });
}

function updateCommoditySelectionUI(symbol) {
    const cards = document.querySelectorAll('.commodity-card');
    cards.forEach(card => {
        card.classList.toggle('active', card.getAttribute('data-symbol') === symbol);
    });
}

async function selectCommodity(symbol) {
    if (!symbol) return;
    selectedCommoditySymbol = symbol;
    updateCommoditySelectionUI(symbol);
    const selected = commodityData.find(item => item.symbol === symbol);
    const nameEl = document.getElementById('commodity-detail-name');
    const symbolEl = document.getElementById('commodity-detail-symbol');
    const iconEl = document.getElementById('commodity-detail-icon');
    const priceEl = document.getElementById('commodity-detail-price');
    const changeEl = document.getElementById('commodity-detail-change');
    const noteEl = document.getElementById('commodity-detail-note');
    const sparklineEl = document.getElementById('commodity-sparkline');

    if (!selected) {
        noteEl && (noteEl.innerText = 'Commodity details not available.');
        return;
    }

    nameEl && (nameEl.innerText = selected.name);
    symbolEl && (symbolEl.innerText = selected.symbol);
    iconEl && (iconEl.innerText = selected.emoji);
    priceEl && (priceEl.innerText = selected.price != null ? `$${parseFloat(selected.price).toFixed(2)}` : 'N/A');
    if (changeEl) {
        if (selected.change != null) {
            changeEl.innerText = `${selected.change >= 0 ? '+' : ''}${parseFloat(selected.change).toFixed(2)} (${selected.changePercent != null ? parseFloat(selected.changePercent).toFixed(2) : '0.00'}%)`;
            changeEl.className = 'commodity-detail-change ' + (selected.change >= 0 ? 'pos-change' : 'neg-change');
        } else {
            changeEl.innerText = 'Unavailable';
            changeEl.className = 'commodity-detail-change';
        }
    }
    noteEl && (noteEl.innerText = `Updated at ${selected.source || 'live'} • Refreshes every 4 hours.`);

    if (sparklineEl) {
        sparklineEl.innerHTML = '<div class="commodity-note">Loading trend...</div>';
    }

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/commodities/history?symbol=${encodeURIComponent(symbol)}`);
        const data = await safeJsonParse(response);

        if (!data || data.status === 'error' || !Array.isArray(data.values)) {
            throw new Error(data?.message || 'No history available');
        }

        const values = data.values
            .filter(entry => entry.close != null)
            .map(entry => Number(entry.close))
            .reverse();

        if (sparklineEl) {
            sparklineEl.innerHTML = renderSparkline(values);
        }
    } catch (error) {
        console.warn('Failed to load commodity history:', error);
        if (sparklineEl) {
            sparklineEl.innerHTML = '<div class="commodity-note">Trend unavailable. Select another commodity or refresh later.</div>';
        }
    }
}

function renderSparkline(values) {
    if (!values || values.length < 2) {
        return '<div class="commodity-note">Not enough data for trend.</div>';
    }

    const width = 320;
    const height = 72;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const points = values.map((value, index) => {
        const x = (index / (values.length - 1)) * width;
        const y = height - ((value - min) / range) * height;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');

    return `
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Trend sparkline">
            <defs>
                <linearGradient id="sparklineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#22c55e" />
                    <stop offset="100%" stop-color="#38bdf8" />
                </linearGradient>
            </defs>
            <polyline points="${points}" fill="none" stroke="url(#sparklineGradient)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
    `;
}

// ==========================================
// 2. DASHBOARD 1: EQUITY ANALYSIS 
// ==========================================

// Helper: Fetch with Timeout mechanism
async function fetchWithTimeout(url, options = {}) {
    const { timeout = 10000, ...fetchOptions } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

// Helper: Safely parse JSON to prevent crashes on 500/502 HTML error pages
async function safeJsonParse(response) {
    if (!response) return {};
    try {
        return await response.json();
    } catch (e) {
        console.warn("Non-JSON response received. API may be returning an HTML error page.");
        return {};
    }
}

// Helper: Safely extract nested financial data
function safeExtractFinancials(data, rootKey) {
    if (!data || data.code === 429) return null;
    
    const root = data[rootKey];
    if (!root) return null;

    if (Array.isArray(root)) return root[0] || null;
    if (root.financials && Array.isArray(root.financials)) return root.financials[0] || null;
    
    return null;
}

async function setEquityWatchlistVisible(visible) {
    const watchlist = document.querySelector('.commodities-widget');
    if (!watchlist) return;
    watchlist.classList.toggle('hidden-element', !visible);
}

function clearEquityResults() {
    const resultsContainer = document.getElementById('equity-results-container');
    const searchInput = document.getElementById('equity-search-input');
    if (resultsContainer) resultsContainer.classList.add('hidden-element');
    if (searchInput) searchInput.value = '';
    setEquityWatchlistVisible(true);
}

async function executeEquityAnalysis() {
    if (isAnalyzing) return; 

    const tickerInput = document.getElementById('equity-search-input');
    const ticker = tickerInput.value.trim().toUpperCase();
    
    if (!ticker) {
        showToast("Please enter a valid ticker symbol (e.g., AAPL).");
        return;
    }

    activeEquityTicker = ticker;

    const loader = document.getElementById('equity-loader');
    const resultsContainer = document.getElementById('equity-results-container');
    const searchBtn = document.getElementById('equity-search-btn');

    isAnalyzing = true;
    searchBtn.disabled = true;
    loader.classList.remove('hidden', 'hidden-element');
    resultsContainer.classList.add('hidden-element');
    setEquityWatchlistVisible(false);

    try {
        // STEP 1: Profile & Real-Time Quote (Concurrent is safe for Finnhub's 60 req/min limit)
        const [profileRes, quoteRes] = await Promise.all([
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/profile?symbol=${ticker}`),
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/quote?symbol=${ticker}`)
        ]);

        const profileData = await safeJsonParse(profileRes);
        const quoteData = await safeJsonParse(quoteRes);

        if (!profileData?.name || typeof quoteData?.c !== 'number') {
            throw new Error("Asset not found or pricing data invalid.");
        }

        populateHeroMetrics(profileData, quoteData, ticker);
        resultsContainer.classList.remove('hidden-element');
        setEquityWatchlistVisible(false);

        // STEP 2: Metrics
        try {
            const metricsRes = await fetchWithTimeout(`${BACKEND_URL}/api/finnhub/metrics?symbol=${ticker}`);
            const metricsData = await safeJsonParse(metricsRes);
            populateRatiosGrid(metricsData || null);
        } catch (e) {
            console.warn("Metrics fetch failed/timed out:", e);
            populateRatiosGrid(null);
        }

        // STEP 3: Financial Statements (Waterfall sequential fetch to bypass TwelveData burst limits)
        try {
            const balanceRes = await fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/statements?symbol=${ticker}&type=balance_sheet`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1-second throttle
            
            const cashRes = await fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/statements?symbol=${ticker}&type=cash_flow`);
            
            const balanceData = await safeJsonParse(balanceRes);
            const cashData = await safeJsonParse(cashRes);

            populateFinancialTables(
                safeExtractFinancials(balanceData, 'balance_sheet'),
                safeExtractFinancials(cashData, 'cash_flow')
            );
        } catch (e) {
            console.warn("Statements fetch failed/timed out:", e);
            populateFinancialTables(null, null);
        }

        // STEP 4: Historical Trajectory
        try {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Another throttle delay
            await loadEquityTimeSeries(ticker, '1Y');
            document.querySelectorAll('#dashboard-equity .tf-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelector('#dashboard-equity .tf-btn[data-tf="1Y"]').classList.add('active');
        } catch (e) {
            console.warn("Chart data fetch failed/timed out:", e);
        }

        showToast(`Connected to ${ticker} data stream.`);

    } catch (error) {
        setEquityWatchlistVisible(true);
        console.error(error);
        if (error.name === 'AbortError') {
            showToast("Request timed out. The server is taking too long to respond.");
        } else {
            showToast("Data retrieval failed. Check ticker validity or API limits.");
        }
    } finally {
        isAnalyzing = false;
        searchBtn.disabled = false;
        loader.classList.add('hidden-element');
    }
}

function populateHeroMetrics(profile, quote, ticker) {
    document.getElementById('company-name-display').innerText = profile.name || "Unknown Company";
    document.getElementById('company-ticker-badge').innerText = ticker;
    document.getElementById('company-exchange-badge').innerText = profile.exchange ? profile.exchange.split(' ')[0] : "US";
    
    const price = quote.c; 
    const change = parseFloat(quote.d) || 0;
    const changePercent = parseFloat(quote.dp) || 0;
    
    const priceDisplay = document.getElementById('live-price-display');
    const changeDisplay = document.getElementById('live-change-display');
    
    priceDisplay.innerText = `$${price.toFixed(2)}`;
    changeDisplay.innerText = `${change > 0 ? '+' : ''}${change.toFixed(2)} (${changePercent.toFixed(2)}%)`;
    changeDisplay.className = 'price-change-percent ' + (change >= 0 ? 'pos-change' : 'neg-change');

    document.getElementById('metric-52w-low').innerText = quote.l != null ? `$${parseFloat(quote.l).toFixed(2)}` : "--";
    document.getElementById('metric-52w-high').innerText = quote.h != null ? `$${parseFloat(quote.h).toFixed(2)}` : "--";
    
    const mktCapValue = profile.marketCapitalization ? profile.marketCapitalization * 1e6 : null; 
    document.getElementById('metric-mkt-cap').innerText = formatLargeCurrency(mktCapValue);
    
    document.getElementById('metric-beta').innerText = "N/A"; 
    document.getElementById('corporate-description-text').innerText = `Industry: ${profile.finnhubIndustry || 'N/A'}. IPO Date: ${profile.ipo || 'N/A'}. Share Outstanding: ${profile.shareOutstanding ? profile.shareOutstanding.toLocaleString() : 'N/A'}. Connected via institutional token streams.`;
}

function parseNumericValue(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && !Number.isNaN(value)) return value;
    if (typeof value === 'string') {
        const cleaned = value.replace(/[,%\s]/g, '').replace(/\(+|\)+/g, '');
        const percentRemoved = cleaned.endsWith('%') ? cleaned.slice(0, -1) : cleaned;
        const parsed = Number(percentRemoved);
        return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
}

function resolveMetricValue(metricObj, fallbackObj, keys) {
    if (!metricObj && !fallbackObj) return null;
    for (const key of keys) {
        const value = parseNumericValue(metricObj?.[key]);
        if (value != null) return value;
    }
    for (const key of keys) {
        const value = parseNumericValue(fallbackObj?.[key]);
        if (value != null) return value;
    }
    return null;
}

function computeDebtToEquity(metricObj, fallbackObj) {
    const direct = resolveMetricValue(metricObj, fallbackObj, [
        'totalDebtTotalEquityAnnual',
        'totalDebtTotalEquityTTM',
        'debtToEquityAnnual',
        'debtToEquityTTM',
        'debtToEquity',
        'debtEquityRatio',
        'debtToEquityRatio',
        'totalDebtToEquity',
        'totalDebtEquityRatio',
        'longTermDebtToEquity',
        'totalDebtToEquityRatioTTM',
        'totalDebtToEquityRatioAnnual'
    ]);
    if (direct != null) return direct;

    const totalDebt = resolveMetricValue(metricObj, fallbackObj, [
        'totalDebt',
        'totalDebtTTM',
        'totalDebtAnnual',
        'longTermDebt',
        'shortTermDebt',
        'totalDebtInclMinorityInterest'
    ]);
    const totalEquity = resolveMetricValue(metricObj, fallbackObj, [
        'totalShareholdersEquity',
        'totalShareholdersEquityTTM',
        'totalShareholderEquity',
        'shareholdersEquity',
        'totalEquity',
        'totalEquityTTM',
        'stockholdersEquity'
    ]);

    if (totalDebt != null && totalEquity != null && totalEquity !== 0) {
        return totalDebt / totalEquity;
    }
    return null;
}

function computeEbitda(metricObj, fallbackObj) {
    const direct = resolveMetricValue(metricObj, fallbackObj, [
        'ebitdaWithReconciliationValuationTTM',
        'ebitda',
        'ebitdaTTM',
        'EBITDA',
        'ebitdaAdjusted'
    ]);
    if (direct != null) return direct;

    const ebit = resolveMetricValue(metricObj, fallbackObj, [
        'ebit',
        'operatingIncome',
        'incomeBeforeTax',
        'operatingIncomeTTM'
    ]);
    const da = resolveMetricValue(metricObj, fallbackObj, [
        'depreciationAndAmortization',
        'depreciationAndAmortizationTTM',
        'dAndA',
        'depreciation'
    ]);

    if (ebit != null && da != null) {
        return ebit + da;
    }
    return null;
}

function populateRatiosGrid(metricPayload) {
    const grid = document.getElementById('ratios-grid-target');
    if (!metricPayload) {
        grid.innerHTML = '<p class="empty-notice">Valuation metrics matrix unpopulated due to API limits or timeout.</p>';
        return;
    }

    const hubMetric = metricPayload.metric || metricPayload;
    const fmpMetric = metricPayload.fmpMetrics || null;

    const pe = resolveMetricValue(hubMetric, fmpMetric, ['peTTM', 'priceEarningsRatioTTM', 'priceEarningsRatio', 'peRatio']);
    const pb = resolveMetricValue(hubMetric, fmpMetric, ['pbAnnual', 'priceToBookAnnual', 'priceToBookRatio', 'pbRatio']);
    const debtToEquity = computeDebtToEquity(hubMetric, fmpMetric);
    const roe = resolveMetricValue(hubMetric, fmpMetric, ['returnOnEquityTTM', 'returnOnEquityAnnual', 'roeTTM', 'roe', 'returnOnEquity']);
    const currentRatio = resolveMetricValue(hubMetric, fmpMetric, ['currentRatioAnnual', 'currentRatio', 'currentRatioTTM']);
    const grossMargin = resolveMetricValue(hubMetric, fmpMetric, ['grossMarginTTM', 'grossProfitMarginTTM', 'grossMargin']);
    const netMargin = resolveMetricValue(hubMetric, fmpMetric, ['netProfitMarginTTM', 'netMarginTTM', 'netProfitMargin', 'netIncomeMargin']);
    const dividendYield = resolveMetricValue(hubMetric, fmpMetric, ['dividendYieldIndicatedAnnual', 'dividendYield', 'dividendYieldTTM']);
    const enterpriseValue = resolveMetricValue(hubMetric, fmpMetric, ['enterpriseValueTTM', 'enterpriseValue', 'enterpriseValueAnnual']);
    const ebitda = computeEbitda(hubMetric, fmpMetric);
    const evToEbitdaRatio = resolveMetricValue(hubMetric, fmpMetric, ['evToEbitda', 'evEbitda', 'enterpriseValueToEbitda', 'enterpriseValueToEbitdaTTM', 'evEbitdaRatio', 'enterpriseValueToEbitdaRatio'])
        ?? (enterpriseValue != null && ebitda != null && ebitda !== 0 ? enterpriseValue / ebitda : null);

    if (hubMetric.beta != null) document.getElementById('metric-beta').innerText = parseFloat(hubMetric.beta).toFixed(2);
    if (hubMetric['52WeekHigh'] != null) document.getElementById('metric-52w-high').innerText = `$${parseFloat(hubMetric['52WeekHigh']).toFixed(2)}`;
    if (hubMetric['52WeekLow'] != null) document.getElementById('metric-52w-low').innerText = `$${parseFloat(hubMetric['52WeekLow']).toFixed(2)}`;

    const safeFmt = (val, isPercent = false) => val != null ? `${parseFloat(val).toFixed(2)}${isPercent ? '%' : ''}` : 'N/A';

    const evEbitda = evToEbitdaRatio != null
        ? parseFloat(evToEbitdaRatio).toFixed(2)
        : 'N/A';

    const dataPoints = [
        { label: "P/E Ratio (TTM)", value: safeFmt(pe) },
        { label: "P/B Ratio", value: safeFmt(pb) },
        { label: "Debt to Equity", value: safeFmt(debtToEquity) },
        { label: "ROE (%)", value: safeFmt(roe, true) },
        { label: "Current Ratio", value: safeFmt(currentRatio) },
        { label: "Gross Margin (%)", value: safeFmt(grossMargin, true) },
        { label: "Net Margin (%)", value: safeFmt(netMargin, true) },
        { label: "EBITDA", value: safeFmt(ebitda) },
        { label: "EV / EBITDA", value: evEbitda },
        { label: "Dividend Yield", value: safeFmt(dividendYield, true) }
    ];

    grid.innerHTML = dataPoints.map(dp => `
        <div class="ratio-node">
            <span class="ratio-label">${dp.label}</span>
            <span class="ratio-value">${dp.value}</span>
        </div>
    `).join('');
}

function renderStatementSummaryTable(tbody, rows, emptyMessage) {
    if (!tbody) return;

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="2" class="table-empty-state">${emptyMessage}</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(row => {
        const formattedVal = formatLargeCurrency(parseFloat(row.value));
        return `<tr class="financial-summary-row"><td>${row.label}</td><td>${formattedVal}</td></tr>`;
    }).join('');
}

function populateFinancialTables(balance, cashflow) {
    const balanceTbody = document.getElementById('balance-sheet-table-body');
    const balanceRows = balance ? [
        { label: 'Total Assets', value: balance.assets?.total_assets ?? balance.total_assets },
        { label: 'Total Liabilities', value: balance.liabilities?.total_liabilities ?? balance.total_liabilities },
        {
            label: 'Total Shareholders\' Equity',
            value: balance.shareholders_equity?.total_shareholders_equity ?? balance.total_shareholders_equity,
        },
    ].filter((row) => row.value != null) : [];

    renderStatementSummaryTable(
        balanceTbody,
        balanceRows,
        'Balance sheet summary unavailable for this ticker.'
    );

    const cashTbody = document.getElementById('cashflow-table-body');
    const operating = cashflow?.operating_activities?.operating_cash_flow ?? cashflow?.operating_cash_flow;
    const investing = cashflow?.investing_activities?.investing_cash_flow ?? cashflow?.investing_cash_flow;
    const financing = cashflow?.financing_activities?.financing_cash_flow ?? cashflow?.financing_cash_flow;
    const netChange =
        cashflow?.net_change_in_cash ??
        (operating != null && investing != null && financing != null
            ? operating + investing + financing
            : null);

    const cashRows = cashflow ? [
        { label: 'Operating Cash Flow', value: operating },
        { label: 'Investing Cash Flow', value: investing },
        { label: 'Financing Cash Flow', value: financing },
        { label: 'Net Change in Cash', value: netChange },
    ].filter((row) => row.value != null) : [];

    renderStatementSummaryTable(
        cashTbody,
        cashRows,
        'Cash flow summary unavailable for this ticker.'
    );
}

function renderEquityChart(data, timeframe) {
    if (!data || data.length === 0) return;
    const canvas = document.getElementById('equityHistoricalChart');
    if (!canvas) return;

    let slicedData = data;
    if (timeframe === '1M') slicedData = data.slice(-21);
    else if (timeframe === '1Y') slicedData = data.slice(-252);
    else if (timeframe === '5Y') slicedData = data.slice(-1260);
    else if (timeframe === 'MAX') slicedData = data;

    const labels = slicedData.map((v) => {
        const date = new Date(v.datetime);
        if (isNaN(date.getTime())) return v.datetime;
        if (timeframe === '1M') {
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
        return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    });

    const prices = slicedData.map((v) => parseFloat(v.close));
    const isPositive = prices[prices.length - 1] >= prices[0];
    const lineColor = isPositive ? '#10b981' : '#ef4444';
    const fillColor = isPositive ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)';

    if (equityChartInstance) equityChartInstance.destroy();


    equityChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Closing Price',
                data: prices,
                borderColor: lineColor,
                backgroundColor: fillColor,
                borderWidth: 2,
                pointRadius: 0,
                fill: true,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` $${ctx.parsed.y.toFixed(2)}`
                    }
                }
            },
            scales: {
                x: {
                    display: false,
                    ticks: {
                        display: false
                    },
                    grid: { display: false }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: {
                        color: '#94a3b8',
                        callback: (val) => `$${val.toLocaleString()}`
                    }
                }
            }
        }
    });
}


// ==========================================
// 3. DASHBOARD 2: CALCULATORS
// ==========================================
function setupCalculators() {
    const calcToggles = document.querySelectorAll('.calc-toggle');
    calcToggles.forEach(toggle => {
        toggle.addEventListener('click', () => {
            calcToggles.forEach(t => t.classList.remove('active'));
            toggle.classList.add('active');
            activeCalcType = toggle.getAttribute('data-calc');
            renderCalcInputs(activeCalcType);
        });
    });
}

function renderCalcInputs(type) {
    const wrapper = document.getElementById('calc-inputs-wrapper');
    let html = '';

    if (type === 'sip') {
        html = `
            <div class="input-field-group"><label>Monthly Investment ($)</label><input type="number" id="calc-amount" value="1000"></div>
            <div class="input-field-group"><label>Expected Return Rate (p.a. %)</label><input type="number" id="calc-rate" value="12"></div>
            <div class="input-field-group"><label>Time Period (Years)</label><input type="number" id="calc-years" value="10"></div>
        `;
    } else if (type === 'emi') {
        html = `
            <div class="input-field-group"><label>Loan Amount ($)</label><input type="number" id="calc-amount" value="250000"></div>
            <div class="input-field-group"><label>Interest Rate (p.a. %)</label><input type="number" id="calc-rate" value="6.5"></div>
            <div class="input-field-group"><label>Loan Tenure (Years)</label><input type="number" id="calc-years" value="15"></div>
        `;
    } else if (type === 'swp') {
        html = `
            <div class="input-field-group"><label>Total Investment Corpus ($)</label><input type="number" id="calc-amount" value="1000000"></div>
            <div class="input-field-group"><label>Monthly Withdrawal ($)</label><input type="number" id="calc-withdrawal" value="5000"></div>
            <div class="input-field-group"><label>Expected Return Rate (p.a. %)</label><input type="number" id="calc-rate" value="8"></div>
            <div class="input-field-group"><label>Time Period (Years)</label><input type="number" id="calc-years" value="10"></div>
        `;
    }

    wrapper.innerHTML = html;
    
    wrapper.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', executeMath);
    });

    executeMath();
}

function executeMath() {
    const amount = parseFloat(document.getElementById('calc-amount')?.value) || 0;
    const rate = parseFloat(document.getElementById('calc-rate')?.value) || 0;
    const years = parseFloat(document.getElementById('calc-years')?.value) || 0;
    const months = years * 12;
    const monthlyRate = rate / 12 / 100;

    let chartLabels = [], chartData = [];
    let summaryHtml = '';

    if (activeCalcType === 'sip') {
        const invested = amount * months;
        let result = monthlyRate === 0 ? invested : amount * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) * (1 + monthlyRate);
        result = isNaN(result) ? 0 : result; // Safety check
        const estReturns = Math.max(0, result - invested);
        
        chartLabels = ['Invested Amount', 'Est. Returns'];
        chartData = [invested, estReturns];
        summaryHtml = `
            <div class="summary-row"><span class="label">Total Invested</span><span class="val">$${invested.toLocaleString('en-US')}</span></div>
            <div class="summary-row"><span class="label">Est. Returns</span><span class="val">$${estReturns.toLocaleString('en-US', {maximumFractionDigits:0})}</span></div>
            <div class="summary-row highlight"><span class="label">Total Value</span><span class="val">$${result.toLocaleString('en-US', {maximumFractionDigits:0})}</span></div>
        `;
    } 
    else if (activeCalcType === 'emi') {
        let emi = monthlyRate === 0 ? amount / months : (amount * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
        emi = isNaN(emi) || !isFinite(emi) ? 0 : emi; // Safety check
        const totalPaid = emi * months;
        const totalInterest = Math.max(0, totalPaid - amount);

        chartLabels = ['Principal Amount', 'Total Interest'];
        chartData = [amount, totalInterest];
        summaryHtml = `
            <div class="summary-row highlight"><span class="label">Monthly EMI</span><span class="val">$${emi.toLocaleString('en-US', {maximumFractionDigits:0})}</span></div>
            <div class="summary-row"><span class="label">Principal Amount</span><span class="val">$${amount.toLocaleString('en-US')}</span></div>
            <div class="summary-row"><span class="label">Total Interest</span><span class="val">$${totalInterest.toLocaleString('en-US', {maximumFractionDigits:0})}</span></div>
        `;
    } 
    else if (activeCalcType === 'swp') {
        const withdrawal = parseFloat(document.getElementById('calc-withdrawal')?.value) || 0;
        const totalWithdrawn = withdrawal * months;
        let finalBalance = monthlyRate === 0 ? amount - totalWithdrawn : (amount * Math.pow(1 + monthlyRate, months)) - (withdrawal * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate));
        finalBalance = isNaN(finalBalance) ? 0 : finalBalance; // Safety check
        const safeBalance = Math.max(0, finalBalance);

        chartLabels = ['Total Withdrawn', 'Remaining Balance'];
        chartData = [totalWithdrawn, safeBalance];
        summaryHtml = `
            <div class="summary-row"><span class="label">Total Investment</span><span class="val">$${amount.toLocaleString('en-US')}</span></div>
            <div class="summary-row"><span class="label">Total Withdrawn</span><span class="val">$${totalWithdrawn.toLocaleString('en-US')}</span></div>
            <div class="summary-row highlight"><span class="label">Final Balance</span><span class="val">${finalBalance < 0 ? 'Funds Exhausted' : '$' + finalBalance.toLocaleString('en-US', {maximumFractionDigits:0})}</span></div>
        `;
    }

    document.getElementById('calc-numerical-summary').innerHTML = summaryHtml;
    renderCalcPieChart(chartLabels, chartData);
}

function renderCalcPieChart(labels, data) {
    const canvas = document.getElementById('calculatorPieChart');
    if (!canvas) return;

    if (calcChartInstance) calcChartInstance.destroy();

    calcChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: ['#2563eb', '#06b6d4'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            cutout: '70%'
        }
    });
}

// ==========================================
// 4. DASHBOARD 3: PORTFOLIO ARCHITECT
// ==========================================
function generatePortfolio() {
    let rawAge = parseInt(document.getElementById('portfolio-age-input')?.value);
    let age = isNaN(rawAge) ? 30 : Math.max(18, Math.min(100, rawAge));
    const riskInput = document.getElementById('portfolio-risk-input');
    const risk = riskInput ? riskInput.value : 'moderate';
    
    let equity = 100 - age;

    if (risk === 'conservative') {
        equity -= 15;
    } else if (risk === 'aggressive') {
        equity += 15;
    }

    equity = Math.max(15, Math.min(85, equity));
    let metals = 10; 
    let debt = 100 - equity - metals; 

    const portfolioData = [
        Number(equity.toFixed(1)), 
        Number(debt.toFixed(1)), 
        Number(metals.toFixed(1))
    ];
    
    const colors = ['#2563eb', '#64748b', '#f59e0b'];

    const canvas = document.getElementById('portfolioPieChart');
    if (canvas) {
        if (portfolioChartInstance) portfolioChartInstance.destroy();
        portfolioChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'pie',
            data: { 
                labels: ['Equity', 'Fixed Income', 'Metals'], 
                datasets: [{ data: portfolioData, backgroundColor: colors, borderWidth: 0 }] 
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }

    const legendTarget = document.getElementById('portfolio-legend-target');
    if(legendTarget) {
        legendTarget.innerHTML = `
            <div class="legend-node">
                <div class="legend-meta"><div class="legend-color-dot" style="background:${colors[0]}"></div><span>Equity / Alpha Assets</span></div>
                <span class="legend-value">${portfolioData[0]}%</span>
            </div>
            <div class="legend-node">
                <div class="legend-meta"><div class="legend-color-dot" style="background:${colors[1]}"></div><span>Fixed Income / Debt</span></div>
                <span class="legend-value">${portfolioData[1]}%</span>
            </div>
            <div class="legend-node">
                <div class="legend-meta"><div class="legend-color-dot" style="background:${colors[2]}"></div><span>Precious Metals / Hedge</span></div>
                <span class="legend-value">${portfolioData[2]}%</span>
            </div>
        `;
    }
}

// ==========================================
// 5. AI INVESTMENT ADVISOR (GEMINI)
// ==========================================

function setupAiAdvisor() {
    const btn = document.getElementById('execute-ai-btn');
    const input = document.getElementById('ai-ticker-input');
    if (!btn) return;

    btn.addEventListener('click', executeAiAnalysis);
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') executeAiAnalysis();
        });
    }
}

async function executeAiAnalysis() {
    if (isAiRunning) return;

    const tickerInput = document.getElementById('ai-ticker-input');
    const frameSelect = document.getElementById('ai-model-select');
    const output = document.getElementById('ai-terminal-output');
    const btn = document.getElementById('execute-ai-btn');

    const ticker = tickerInput?.value.trim().toUpperCase();
    const frame = frameSelect?.value || 'dupont';

    if (!ticker) {
        showToast('Enter a ticker symbol for AI analysis.');
        return;
    }

    isAiRunning = true;
    if (btn) btn.disabled = true;

    const frameLabel = frameSelect?.selectedOptions?.[0]?.textContent || frame;
    if (output) {
        output.innerHTML = `<span class="terminal-prompt terminal-accent">&gt; Running ${escapeHtml(frameLabel)} on ${escapeHtml(ticker)}…</span>`;
    }

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/ai/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker, frame }),
            timeout: 90000,
        });

        const data = await safeJsonParse(response);

        if (!response.ok) {
            throw new Error(data?.error || 'AI analysis failed.');
        }

        if (output) {
            const providerNote = data.provider
                ? ` [${escapeHtml(data.provider)}${data.model ? ` / ${escapeHtml(data.model)}` : ''}]`
                : '';
            output.innerHTML = `
                <span class="terminal-prompt terminal-success">&gt; Scan complete: ${escapeHtml(ticker)} — ${escapeHtml(frameLabel)}${providerNote}</span>
                <div class="ai-analysis-text">${escapeHtml(data.analysis)}</div>
                <span class="terminal-prompt terminal-warn">&gt; Educational use only. Not financial advice.</span>
            `;
        }
        showToast(`AI analysis ready for ${ticker}.`);
    } catch (error) {
        console.error(error);
        const message =
            error.name === 'AbortError'
                ? 'AI request timed out. Try again in a moment.'
                : error.message || 'AI analysis failed.';
        if (output) {
            output.innerHTML = `<span class="terminal-prompt terminal-warn">&gt; ${escapeHtml(message)}</span>`;
        }
        showToast(message);
    } finally {
        isAiRunning = false;
        if (btn) btn.disabled = false;
    }
}

// ==========================================
// 6. CRYPTOCURRENCY TRACKER
// ==========================================

function setupCryptoTracker() {
    const searchBtn = document.getElementById('crypto-search-btn');
    const searchInput = document.getElementById('crypto-search-input');
    
    if (searchBtn) {
        searchBtn.addEventListener('click', executeCryptoSearch);
    }
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') executeCryptoSearch();
        });
    }

    setupCryptoTabs();
    loadTopCryptos();
}

async function loadTopCryptos() {
    const bracketsGrid = document.getElementById('crypto-brackets-grid');
    if (!bracketsGrid) return;

    bracketsGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #999;">Loading top cryptocurrencies...</p>';

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/crypto/top?limit=6`, {
            timeout: 10000,
        });
        const data = await safeJsonParse(response);

        if (!response.ok) {
            throw new Error(data?.error || 'Failed to load cryptocurrencies.');
        }

        bracketsGrid.innerHTML = '';
        data.forEach((crypto) => {
            const bracket = document.createElement('div');
            bracket.className = 'crypto-bracket-card';
            bracket.role = 'button';
            bracket.tabindex = '0';
            
            const change24h = crypto.price_change_percentage_24h || 0;
            const changeColor = change24h >= 0 ? '#10b981' : '#ef4444';
            const changeIcon = change24h >= 0 ? '▲' : '▼';

            bracket.innerHTML = `
                <div class="bracket-icon">${crypto.image ? `<img src="${crypto.image}" alt="${crypto.name}">` : '💰'}</div>
                <div class="bracket-name">${escapeHtml(crypto.name)}</div>
                <div class="bracket-symbol">${escapeHtml(crypto.symbol.toUpperCase())}</div>
                <div class="bracket-price">$${crypto.current_price?.toLocaleString('en-US', { maximumFractionDigits: 2 }) || '0.00'}</div>
                <div class="bracket-change" style="color: ${changeColor};">${changeIcon} ${Math.abs(change24h).toFixed(2)}%</div>
            `;

            bracket.addEventListener('click', () => displayCryptoDetails(crypto.id));
            bracket.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' || e.key === ' ') displayCryptoDetails(crypto.id);
            });

            bracketsGrid.appendChild(bracket);
        });
    } catch (error) {
        console.error('Error loading top cryptos:', error);
        bracketsGrid.innerHTML = `<p style="grid-column: 1/-1; color: #ef4444; text-align: center;">Error loading cryptocurrencies. Try again.</p>`;
        showToast('Failed to load top cryptocurrencies.');
    }
}

async function executeCryptoSearch() {
    const input = document.getElementById('crypto-search-input');
    const query = input?.value.trim();

    if (!query) {
        showToast('Enter a cryptocurrency ticker or name to search.');
        return;
    }

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/crypto/search?query=${encodeURIComponent(query)}`, {
            timeout: 10000,
        });
        const data = await safeJsonParse(response);

        if (!response.ok) {
            throw new Error(data?.error || 'Search failed.');
        }

        if (!data.coins || data.coins.length === 0) {
            showToast('No cryptocurrencies found. Try another search.');
            return;
        }

        const topResult = data.coins[0];
        displayCryptoDetails(topResult.id);
        showToast(`Found: ${topResult.name}`);
    } catch (error) {
        console.error('Search error:', error);
        showToast('Search failed. Please try again.');
    }
}

async function displayCryptoDetails(cryptoId) {
    const loader = document.getElementById('crypto-loader');
    const resultsContainer = document.getElementById('crypto-results-container');

    if (loader) loader.classList.remove('hidden-element');
    if (resultsContainer) resultsContainer.classList.add('hidden-element');

    try {
        const [detailsResponse, historyResponse] = await Promise.all([
            fetchWithTimeout(`${BACKEND_URL}/api/crypto/details?id=${encodeURIComponent(cryptoId)}`, { timeout: 10000 }),
            fetchWithTimeout(`${BACKEND_URL}/api/crypto/history?id=${encodeURIComponent(cryptoId)}&days=365`, { timeout: 10000 }).catch(() => null),
        ]);

        const details = await safeJsonParse(detailsResponse);
        const history = await safeJsonParse(historyResponse);

        if (!detailsResponse || !detailsResponse.ok) throw new Error(details?.error || 'Failed to fetch details');

        populateCryptoDetails(details);
        renderCryptoChart(history);

        if (loader) loader.classList.add('hidden-element');
        if (resultsContainer) resultsContainer.classList.remove('hidden-element');
        showToast(`Loaded ${details.name} details.`);
    } catch (error) {
        console.error('Error displaying crypto:', error);
        if (loader) loader.classList.add('hidden-element');
        showToast('Failed to load cryptocurrency details.');
    }
}

function populateCryptoDetails(crypto) {
    const marketData = crypto.market_data || {};
    
    // Hero section
    const nameDisplay = document.getElementById('crypto-name-display');
    const tickerBadge = document.getElementById('crypto-ticker-badge');
    const rankBadge = document.getElementById('crypto-rank-badge');
    const iconDisplay = document.getElementById('crypto-icon-display');
    const priceDisplay = document.getElementById('crypto-live-price-display');
    const changeDisplay = document.getElementById('crypto-live-change-display');

    if (nameDisplay) nameDisplay.textContent = crypto.name;
    if (tickerBadge) tickerBadge.textContent = (crypto.symbol || '').toUpperCase();
    if (rankBadge) rankBadge.textContent = `#${crypto.market_cap_rank || '--'}`;
    if (iconDisplay) {
        const iconUrl = crypto.image?.thumb || crypto.image?.small || crypto.image?.large || crypto.image;
        iconDisplay.innerHTML = iconUrl
            ? `<img src="${iconUrl}" alt="${crypto.name}">`
            : '💰';
    }
    
    const currentPrice = marketData.current_price?.usd || 0;
    const change24h = marketData.price_change_percentage_24h || 0;
    
    if (priceDisplay) priceDisplay.textContent = `$${currentPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    if (changeDisplay) {
        changeDisplay.textContent = `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}% (24h)`;
        changeDisplay.style.color = change24h >= 0 ? '#10b981' : '#ef4444';
    }

    // Metrics
    const metrics = {
        'crypto-metric-24h-high': marketData.high_24h?.usd,
        'crypto-metric-24h-low': marketData.low_24h?.usd,
        'crypto-metric-market-cap': marketData.market_cap?.usd,
        'crypto-metric-volume': marketData.total_volume?.usd,
        'crypto-metric-supply': crypto.market_data?.circulating_supply,
        'crypto-metric-total-supply': crypto.market_data?.total_supply,
        'crypto-metric-ath': marketData.ath?.usd,
        'crypto-metric-ath-date': marketData.ath_date?.usd,
    };

    Object.entries(metrics).forEach(([id, value]) => {
        const elem = document.getElementById(id);
        if (elem) {
            if (id.includes('supply')) {
                elem.textContent = value ? value.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '--';
            } else if (id.includes('market-cap') || id.includes('volume')) {
                elem.textContent = formatLargeCurrency(value);
            } else if (id.includes('ath-date')) {
                elem.textContent = value ? new Date(value).toLocaleDateString() : '--';
            } else {
                elem.textContent = value ? `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '--';
            }
        }
    });

    // Overview tab
    const overviewBody = document.getElementById('crypto-overview-table-body');
    if (overviewBody) {
        overviewBody.innerHTML = `
            <tr><td>Market Cap Rank</td><td>#${crypto.market_cap_rank || '--'}</td></tr>
            <tr><td>Current Price (USD)</td><td>$${currentPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td></tr>
            <tr><td>24h Change</td><td style="color: ${change24h >= 0 ? '#10b981' : '#ef4444'}">${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%</td></tr>
            <tr><td>7d Change</td><td style="color: ${(marketData.price_change_percentage_7d || 0) >= 0 ? '#10b981' : '#ef4444'}">${(marketData.price_change_percentage_7d || 0) >= 0 ? '+' : ''}${(marketData.price_change_percentage_7d || 0).toFixed(2)}%</td></tr>
            <tr><td>30d Change</td><td style="color: ${(marketData.price_change_percentage_30d || 0) >= 0 ? '#10b981' : '#ef4444'}">${(marketData.price_change_percentage_30d || 0) >= 0 ? '+' : ''}${(marketData.price_change_percentage_30d || 0).toFixed(2)}%</td></tr>
            <tr><td>Market Cap</td><td>${formatLargeCurrency(marketData.market_cap?.usd)}</td></tr>
            <tr><td>24h Trading Volume</td><td>${formatLargeCurrency(marketData.total_volume?.usd)}</td></tr>
            <tr><td>Fully Diluted Valuation</td><td>${formatLargeCurrency(marketData.fully_diluted_valuation?.usd)}</td></tr>
        `;
    }

    // Advanced stats tab
    const statsBody = document.getElementById('crypto-stats-table-body');
    if (statsBody) {
        const athDate = marketData.ath_date?.usd ? new Date(marketData.ath_date.usd).toLocaleDateString() : '--';
        const atlDate = marketData.atl_date?.usd ? new Date(marketData.atl_date.usd).toLocaleDateString() : '--';
        
        statsBody.innerHTML = `
            <tr><td>All-Time High (USD)</td><td>$${(marketData.ath?.usd || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</td></tr>
            <tr><td>ATH Date</td><td>${athDate}</td></tr>
            <tr><td>All-Time Low (USD)</td><td>$${(marketData.atl?.usd || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</td></tr>
            <tr><td>ATL Date</td><td>${atlDate}</td></tr>
            <tr><td>Circulating Supply</td><td>${(crypto.market_data?.circulating_supply || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</td></tr>
            <tr><td>Total Supply</td><td>${(crypto.market_data?.total_supply || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</td></tr>
            <tr><td>Max Supply</td><td>${crypto.market_data?.max_supply ? crypto.market_data.max_supply.toLocaleString('en-US', { maximumFractionDigits: 0 }) : 'Unlimited'}</td></tr>
            <tr><td>Market Cap / Fully Diluted</td><td>${((marketData.market_cap?.usd / marketData.fully_diluted_valuation?.usd) * 100 || 0).toFixed(2)}%</td></tr>
        `;
    }
}

function renderCryptoChart(history) {
    const prices = history.prices || [];
    
    const labels = prices.map(([timestamp]) => {
        const date = new Date(timestamp);
        return (date.getMonth() + 1) + '/' + date.getDate();
    });

    const data = prices.map(([, price]) => price);

    const canvas = document.getElementById('cryptoHistoricalChart');
    if (!canvas) return;

    if (cryptoChartInstance) {
        cryptoChartInstance.data.labels = labels;
        cryptoChartInstance.data.datasets[0].data = data;
        cryptoChartInstance.update();
    } else {
        cryptoChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: '1-Year Price',
                    data: data,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.3,
                    fill: true,
                    pointRadius: 0,
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 8, right: 10, left: 6, bottom: 8 } },
                plugins: {
                    legend: { display: true },
                    title: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        ticks: { callback: (val) => '$' + val.toLocaleString('en-US', { maximumFractionDigits: 0 }) }
                    }
                }
            }
        });
    }
}

function setupCryptoTabs() {
    const tabBtns = document.querySelectorAll('#dashboard-crypto .panel-tab-btn');
    const tabPanels = document.querySelectorAll('#dashboard-crypto .tab-panel');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active-panel'));
            
            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            document.getElementById(targetId)?.classList.add('active-panel');
        });
    });
}

// ==========================================
// 8. GLOBAL INFLATION & MACRO TRACKER
// ==========================================

async function setupInflationTracker() {
    const searchBtn = document.getElementById('inflation-search-btn');
    const searchInput = document.getElementById('inflation-search-input');
    
    if (searchBtn) {
        searchBtn.addEventListener('click', executeInflationSearch);
    }
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') executeInflationSearch();
        });
    }

    // Pre-fetch World Bank country mapping array for search resolution
    try {
        const res = await fetch('https://api.worldbank.org/v2/country?format=json&per_page=300');
        const data = await safeJsonParse(res);
        if (data && data[1]) {
            // Filter out aggregate zones (like 'World' or 'Latin America')
            globalCountryMap = data[1].filter(c => c.region.id !== 'NA'); 
        }
    } catch (e) {
        console.warn('Could not load WB country map', e);
    }

    loadMajorEconomies();
}

async function fetchWorldBankIndicator(countryCode, indicator) {
    // Fetches the last 20 records (roughly 20 years of annual data)
    const url = `https://api.worldbank.org/v2/country/${countryCode}/indicator/${indicator}?format=json&per_page=20`;
    const res = await fetch(url);
    const data = await safeJsonParse(res);
    if (!data || !data[1] || !Array.isArray(data[1])) return null;
    return data[1];
}

async function loadMajorEconomies() {
    const grid = document.getElementById('macro-brackets-grid');
    if (!grid) return;
    
    const economies = [
        { code: 'US', name: 'United States', flag: '🇺🇸', bank: 'Federal Reserve' },
        { code: 'EU', name: 'Euro Area', flag: '🇪🇺', bank: 'ECB' },
        { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', bank: 'Bank of England' },
        { code: 'JP', name: 'Japan', flag: '🇯🇵', bank: 'Bank of Japan' },
        { code: 'IN', name: 'India', flag: '🇮🇳', bank: 'Reserve Bank of India' },
        { code: 'CN', name: 'China', flag: '🇨🇳', bank: 'PBOC' }
    ];

    grid.innerHTML = '';
    for (const eco of economies) {
        const bracket = document.createElement('div');
        bracket.className = 'crypto-bracket-card';
        bracket.role = 'button';
        bracket.tabindex = '0';
        bracket.innerHTML = `
            <div class="bracket-icon"><span style="font-size: 32px;">${eco.flag}</span></div>
            <div class="bracket-name">${eco.name}</div>
            <div class="bracket-symbol">${eco.bank}</div>
            <div class="bracket-price">--%</div>
            <div class="bracket-change">CPI (YoY)</div>
        `;
        grid.appendChild(bracket);
        
        bracket.addEventListener('click', () => displayMacroDetails(eco.code, eco.name, eco.flag, eco.bank));
        bracket.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' || e.key === ' ') displayMacroDetails(eco.code, eco.name, eco.flag, eco.bank);
        });

        // Asynchronously populate their inflation values
        fetchWorldBankIndicator(eco.code, 'FP.CPI.TOTL.ZG').then(data => {
            if (data) {
                const latest = data.find(d => d.value !== null);
                if (latest) {
                    const priceEl = bracket.querySelector('.bracket-price');
                    const changeEl = bracket.querySelector('.bracket-change');
                    priceEl.innerText = `${latest.value.toFixed(2)}%`;
                    changeEl.style.color = latest.value > 3.0 ? '#ef4444' : '#10b981';
                    changeEl.innerText = `CPI (YoY, ${latest.date})`;
                }
            }
        });
    }
}

async function executeInflationSearch() {
    const input = document.getElementById('inflation-search-input');
    const query = input?.value.trim().toLowerCase();
    
    if (!query) {
        showToast("Enter a country name (e.g., Brazil, Canada).");
        return;
    }

    // Map search query to Country Data
    let country = globalCountryMap.find(c => 
        c.name.toLowerCase().includes(query) || 
        c.id.toLowerCase() === query || 
        c.iso2Code.toLowerCase() === query
    );

    if (!country) {
        showToast("Country not found in database. Try another name.");
        return;
    }

    displayMacroDetails(country.id, country.name, '🌍', 'Central Bank');
    showToast(`Connecting to World Bank data for ${country.name}`);
}

async function displayMacroDetails(code, name, flag, bank) {
    const loader = document.getElementById('inflation-loader');
    const results = document.getElementById('inflation-results-container');
    const landing = document.getElementById('macro-landing-view');

    if(loader) loader.classList.remove('hidden-element');
    if(results) results.classList.add('hidden-element');
    if(landing) landing.classList.add('hidden-element');

    document.getElementById('country-name-display').innerText = name;
    document.getElementById('country-flag-display').innerText = flag;
    document.getElementById('central-bank-badge').innerText = bank || 'Central Bank';

    try {
        // Fetch CPI (FP.CPI.TOTL.ZG) and Lending Interest Rate (FR.INR.LEND)
        const [cpiData, rateData] = await Promise.all([
            fetchWorldBankIndicator(code, 'FP.CPI.TOTL.ZG'),
            fetchWorldBankIndicator(code, 'FR.INR.LEND')
        ]);

        if (!cpiData || cpiData.length === 0) {
            throw new Error("No macroeconomic data available for this country.");
        }

        // Extract Valid Data
        const validCpi = cpiData.filter(d => d.value !== null).sort((a,b) => parseInt(a.date) - parseInt(b.date));
        const latestCpi = validCpi.length > 0 ? validCpi[validCpi.length - 1] : null;
        const validRates = rateData ? rateData.filter(d => d.value !== null) : [];
        const latestRate = validRates.length > 0 ? validRates[0] : null;

        // Update UI
        if (latestCpi) {
            document.getElementById('inflation-live-display').innerText = `${latestCpi.value.toFixed(2)}%`;
            document.getElementById('inflation-change-display').innerText = `Reported CPI (YoY, ${latestCpi.date})`;
            document.getElementById('metric-inflation-date').innerText = latestCpi.date;
            document.getElementById('metric-core-inflation').innerText = `${latestCpi.value.toFixed(2)}%`;
        }

        document.getElementById('metric-interest-rate').innerText = latestRate ? `${latestRate.value.toFixed(2)}%` : 'N/A';
        
        // Update metadata badge
        const countryObj = globalCountryMap.find(c => c.id === code || c.iso2Code === code);
        document.getElementById('currency-badge').innerText = countryObj && countryObj.capitalCity ? `Capital: ${countryObj.capitalCity}` : 'Sovereign Macro';

        // Render Historical Trajectory Chart
        const labels = validCpi.map(d => d.date);
        const values = validCpi.map(d => d.value);
        renderMacroChart(labels, values);

        if(loader) loader.classList.add('hidden-element');
        if(results) results.classList.remove('hidden-element');
    } catch (err) {
        console.error("Macro Fetch Error:", err);
        showToast(err.message || "Failed to load macro data.");
        if(loader) loader.classList.add('hidden-element');
        if(landing) landing.classList.remove('hidden-element');
    }
}

function renderMacroChart(labels, data) {
    const canvas = document.getElementById('inflationHistoricalChart');
    if (!canvas) return;

    if (macroChartInstance) {
        macroChartInstance.data.labels = labels;
        macroChartInstance.data.datasets[0].data = data;
        macroChartInstance.update();
    } else {
        macroChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Annual Inflation Rate (%)',
                    data: data,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    tension: 0.3,
                    fill: true,
                    pointRadius: 4,
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 8, right: 10, left: 6, bottom: 8 } },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ${ctx.parsed.y.toFixed(2)}%`
                        }
                    }
                },
                scales: {
                    y: {
                        ticks: { callback: (val) => val + '%' }
                    }
                }
            }
        });
    }
}

// ==========================================
// 7. HELPER FUNCTIONS
// ==========================================
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatLargeCurrency(value) {
    if (value == null || isNaN(value)) return 'N/A';
    if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    return `$${value.toLocaleString()}`;
}

function showToast(message) {
    const toast = document.getElementById('global-toast-notification');
    if (!toast) return;
    toast.innerText = message;
    toast.classList.remove('hidden-toast');
    setTimeout(() => { toast.classList.add('hidden-toast'); }, 3000);
}
