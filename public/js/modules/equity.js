import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast, formatLargeCurrency, setupTabs } from '../utils.js';

let equityChartInstance = null;
let rawHistoricalData = [];
let activeEquityTicker = null;

export function loadDashboard() {
    setupTabs('#dashboard-equity');
    setupSearch();
    setupTimeframeSelectors();
    fetchLiveIndexValues();
    setupMarketNews();
}

function setupSearch() {
    const searchBtn = document.querySelector('#equity-search-btn');
    const searchInput = document.querySelector('#equity-search-input');
    const backBtn = document.querySelector('#equity-back-btn');

    const handleSearch = () => {
        if (!searchInput) return;
        const ticker = searchInput.value.trim().toUpperCase();
        if (ticker) {
            executeEquityAnalysis(ticker);
        } else {
            showToast("Please enter a valid US ticker symbol");
        }
    };

    if (searchBtn) {
        searchBtn.addEventListener('click', handleSearch);
    }

    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSearch();
            }
        });
    }

    if (backBtn) {
        backBtn.addEventListener('click', clearEquityResults);
    }
}

function clearEquityResults() {
    const resultsContainer = document.getElementById('equity-results-container');
    const searchInput = document.getElementById('equity-search-input');
    const watchlist = document.querySelector('.commodities-widget');
    
    if (resultsContainer) resultsContainer.classList.add('hidden-element');
    if (searchInput) searchInput.value = '';
    if (watchlist) watchlist.classList.remove('hidden-element');
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

async function executeEquityAnalysis(ticker) {
    activeEquityTicker = ticker;
    
    const loader = document.getElementById('equity-loader');
    const resultsContainer = document.getElementById('equity-results-container');
    const watchlist = document.querySelector('.commodities-widget');
    
    if (loader) loader.classList.remove('hidden-element');
    if (resultsContainer) resultsContainer.classList.add('hidden-element');
    if (watchlist) watchlist.classList.add('hidden-element');

    try {
        const [profileRes, quoteRes, metricsRes, chartRes, bsRes, cfRes] = await Promise.all([
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/profile?symbol=${ticker}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/quote?symbol=${ticker}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/metrics?symbol=${ticker}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/time_series?symbol=${ticker}&timeframe=1Y`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/statements?symbol=${ticker}&type=balance_sheet`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/statements?symbol=${ticker}&type=cash_flow`).catch(() => null)
        ]);

        const profile = await safeJsonParse(profileRes);
        const quote = await safeJsonParse(quoteRes);
        const metrics = await safeJsonParse(metricsRes);
        const chartData = await safeJsonParse(chartRes);
        const balanceSheet = await safeJsonParse(bsRes);
        const cashFlow = await safeJsonParse(cfRes);

        if (profile?.error || quote?.error || !profile?.name) {
            throw new Error(profile?.error || quote?.error || 'Invalid ticker symbol or data unavailable');
        }

        updateUI(profile, quote, metrics, balanceSheet, cashFlow);
        
        if (chartData && !chartData.error && chartData.values) {
            rawHistoricalData = [...chartData.values].reverse();
            renderEquityChart(rawHistoricalData);
        } else {
            console.warn('Chart data unavailable:', chartData);
        }

        if (resultsContainer) resultsContainer.classList.remove('hidden-element');
        
    } catch (error) {
        console.error("Market Data Fetch Error:", error);
        showToast(error.message || "Failed to load market data");
    } finally {
        if (loader) loader.classList.add('hidden-element');
    }
}

async function loadEquityTimeSeries(symbol, timeframe = '1Y') {
    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/time_series?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`);
        const timeSeriesData = await safeJsonParse(response);

        if (timeSeriesData?.values && timeSeriesData.values.length > 0) {
            rawHistoricalData = [...timeSeriesData.values].reverse();
            renderEquityChart(rawHistoricalData);
        }
    } catch (error) {
        console.warn('Failed to load equity chart data:', error);
    }
}

function updateUI(profile, quote, metrics, bs, cf) {
    const formatValue = (val, isCurrency = false) => {
        if (val == null) return '--';
        return isCurrency ? formatLargeCurrency(val * 1e6) : parseFloat(val).toFixed(2);
    };

    const metricData = metrics?.metric || {};

    const elements = {
        'company-name-display': profile?.name || 'Unknown',
        'company-ticker-badge': profile?.ticker || '--',
        'live-price-display': quote?.c ? `$${quote.c.toFixed(2)}` : '--',
        'live-change-display': quote?.d ? `${quote.d > 0 ? '+' : ''}${quote.d.toFixed(2)} (${quote.dp?.toFixed(2)}%)` : '--',
        'metric-52w-high': quote?.h ? `$${quote.h.toFixed(2)}` : '--',
        'metric-52w-low': quote?.l ? `$${quote.l.toFixed(2)}` : '--',
        'metric-mkt-cap': formatValue(profile?.marketCapitalization, true),
        'metric-beta': formatValue(metricData.beta)
    };

    for (const [id, value] of Object.entries(elements)) {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = value;
            if (id === 'live-change-display' && quote?.d) {
                el.style.color = quote.d >= 0 ? '#10b981' : '#ef4444';
            }
        }
    }

    // Populate Ratios Grid
    const ratiosGrid = document.getElementById('ratios-grid-target');
    if (ratiosGrid) {
        const ratios = [
            { label: 'P/E Ratio', value: formatValue(metricData.peTTM) },
            { label: 'P/B Ratio', value: formatValue(metricData.pbAnnual) },
            { label: 'P/S Ratio', value: formatValue(metricData.psTTM) },
            { label: 'ROE', value: formatValue(metricData.roeTTM) + '%' },
            { label: 'ROA', value: formatValue(metricData.roaTTM) + '%' },
            { label: 'Net Margin', value: formatValue(metricData.netProfitMarginTTM) + '%' },
            { label: 'Current Ratio', value: formatValue(metricData.currentRatioAnnual) },
            { label: 'Debt/Equity', value: formatValue(metricData.debtToEquityAnnual) },
            { label: 'Revenue Growth 5Y', value: formatValue(metricData.revenueGrowth5Y) + '%' },
            { label: 'EPS Growth 5Y', value: formatValue(metricData.epsGrowth5Y) + '%' },
            { label: 'Dividend Yield', value: formatValue(metricData.dividendYieldIndicatedAnnual) + '%' }
        ];

        ratiosGrid.innerHTML = ratios.map(r => `
            <div class="ratio-item">
                <span class="ratio-label">${r.label}</span>
                <span class="ratio-value">${r.value}</span>
            </div>
        `).join('');
    }

    const descEl = document.getElementById('corporate-description-text');
    if (descEl) {
        descEl.textContent = profile?.name ? `${profile.name} is a company in the ${profile.finnhubIndustry || 'General'} sector, traded on ${profile.exchange || 'the public markets'}.` : 'Company description unavailable.';
    }

    const bsTable = document.getElementById('balance-sheet-table-body');
    if (bsTable) {
        const bsData = bs?.balance_sheet?.[0] || {};
        bsTable.innerHTML = `
            <tr><td>Total Assets</td><td>${formatLargeCurrency(bsData.total_assets || bsData.totalAssets)}</td></tr>
            <tr><td>Total Liabilities</td><td>${formatLargeCurrency(bsData.total_liabilities || bsData.totalLiabilities)}</td></tr>
            <tr><td>Total Equity</td><td>${formatLargeCurrency(bsData.total_shareholders_equity || bsData.totalEquity)}</td></tr>
        `;
    }

    const cfTable = document.getElementById('cashflow-table-body');
    if (cfTable) {
        const cfData = cf?.cash_flow?.[0] || {};
        cfTable.innerHTML = `
            <tr><td>Operating Cash Flow</td><td>${formatLargeCurrency(cfData.operating_cash_flow || cfData.operatingCashFlow)}</td></tr>
            <tr><td>Investing Cash Flow</td><td>${formatLargeCurrency(cfData.investing_cash_flow || cfData.netCashUsedForInvestingActivites)}</td></tr>
            <tr><td>Financing Cash Flow</td><td>${formatLargeCurrency(cfData.financing_cash_flow || cfData.netCashUsedProvidedByFinancingActivities)}</td></tr>
            <tr><td>Net Change in Cash</td><td>${formatLargeCurrency(cfData.net_change_in_cash || cfData.netChangeInCash)}</td></tr>
        `;
    }
}

function renderEquityChart(data) {
    const canvas = document.getElementById('equityHistoricalChart');
    if (!canvas || !data || data.length === 0) return;

    const labels = data.map(v => v.datetime);
    const prices = data.map(v => parseFloat(v.close));

    const isPositive = prices[prices.length - 1] >= prices[0];
    const color = isPositive ? '#10b981' : '#ef4444';
    const bgColor = isPositive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';

    if (equityChartInstance) {
        equityChartInstance.destroy();
    }

    equityChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Close Price',
                data: prices,
                borderColor: color,
                backgroundColor: bgColor,
                borderWidth: 2,
                pointRadius: 0,
                fill: true,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: { position: 'right', border: { display: false } }
            },
            interaction: {
                intersect: false,
                mode: 'index',
            }
        }
    });
}

// --- Live Indices ---
async function fetchLiveIndexValues() {
    const spValue = document.getElementById('sp500-live-value');
    const spSource = document.getElementById('sp500-source');
    const spChange = document.getElementById('sp500-change');
    const nasValue = document.getElementById('nasdaq-live-value');
    const nasSource = document.getElementById('nasdaq-source');
    const nasChange = document.getElementById('nasdaq-change');

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/indices`);
        const payload = await safeJsonParse(response);
        
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
    }
}

// --- Market News ---
async function setupMarketNews() {
    const grid = document.getElementById('market-news-grid');
    if (!grid) return;

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/finnhub/news`);
        const newsData = await safeJsonParse(response);
        
        if (Array.isArray(newsData) && newsData.length > 0) {
            renderNewsGrid(newsData.slice(0, 6)); // Display top 6 news items
        } else {
            grid.innerHTML = '<div class="news-note">No recent market news available.</div>';
        }
    } catch (error) {
        console.warn('Failed to load market news:', error);
        grid.innerHTML = '<div class="news-note">Unable to load news data. Please try again later.</div>';
    }
}

function renderNewsGrid(newsItems) {
    const grid = document.getElementById('market-news-grid');
    if (!grid) return;

    grid.innerHTML = newsItems.map(item => {
        const imageUrl = item.image || 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?q=80&w=1470&auto=format&fit=crop';
        const date = new Date(item.datetime * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        
        return `
            <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="news-card">
                <div class="news-thumbnail" style="background-image: url('${imageUrl}')"></div>
                <div class="news-content">
                    <div class="news-meta">
                        <span class="news-source">${item.source}</span>
                        <span class="news-date">${date}</span>
                    </div>
                    <h4 class="news-headline">${item.headline}</h4>
                    <p class="news-summary">${item.summary ? item.summary.substring(0, 100) + '...' : ''}</p>
                </div>
            </a>
        `;
    }).join('');
}
