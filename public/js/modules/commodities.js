import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast } from '../utils.js';

let commoditiesData = [];
let commodityChartInstance = null;
let activeCommodity = null;
let activeTimeframe = '1Y';
let activeSector = 'all';

const SECTOR_DRIVERS = {
    precious_metals: [
        'Real yields & Fed policy expectations',
        'USD strength / weakness cycles',
        'Central bank reserve demand',
        'Geopolitical risk & safe-haven flows',
    ],
    energy: [
        'OPEC+ supply decisions & spare capacity',
        'Global demand / industrial activity',
        'Inventory levels & refinery utilization',
        'Geopolitical supply disruptions',
    ],
    industrial: [
        'China manufacturing & construction PMI',
        'Global infrastructure & electrification demand',
        'Mine supply & smelter capacity',
        'Inventory cycles at LME/COMEX warehouses',
    ],
    agriculture: [
        'Weather patterns & crop yield forecasts',
        'Export demand & trade policy',
        'Planting acreage & harvest reports (USDA)',
        'Energy costs & fertilizer pricing',
    ],
    other: [
        'Global supply & demand balance',
        'USD denomination & inflation expectations',
        'Trade flows & geopolitical risk',
        'Inventory & storage dynamics',
    ],
};

export function initCommoditiesDashboard() {
    const isDetailsPage = window.location.pathname.includes('commodity-details.html');
    
    if (isDetailsPage) {
        setupDetailsUIListeners();
        
        const params = new URLSearchParams(window.location.search);
        const symbol = params.get('symbol');
        const name = params.get('name');
        const query = params.get('query');
        if (symbol && name) {
            performCommoditySearch(name, symbol);
        } else if (query) {
            performCommoditySearch(query);
        } else {
            window.location.href = 'commodities.html';
        }
    } else {
        setupLandingUIListeners();
        loadCommodityDashboard();
    }
}

function setupDetailsUIListeners() {
    const searchBtn = document.getElementById('commodity-search-btn');
    const searchInput = document.getElementById('commodity-search-input');
    if (searchBtn && searchInput) {
        searchBtn.addEventListener('click', () => {
            const query = searchInput.value.trim();
            if (query) {
                window.location.href = `commodity-details.html?query=${encodeURIComponent(query)}`;
            } else {
                showToast('Enter a futures ticker or commodity name');
            }
        });
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchBtn.click();
        });
    }

    document.querySelectorAll('#commodity-chart-timeframes .tf-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            document.querySelectorAll('#commodity-chart-timeframes .tf-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            activeTimeframe = btn.getAttribute('data-tf') || '1Y';
            if (activeCommodity?.futuresTicker || activeCommodity?.symbol) {
                await reloadChart(activeCommodity.futuresTicker || activeCommodity.symbol);
            }
        });
    });
}

function setupLandingUIListeners() {
    const searchBtn = document.getElementById('commodity-search-btn');
    const searchInput = document.getElementById('commodity-search-input');
    if (searchBtn && searchInput) {
        searchBtn.addEventListener('click', () => {
            const query = searchInput.value.trim();
            if (query) {
                window.location.href = `commodity-details.html?query=${encodeURIComponent(query)}`;
            } else {
                showToast('Enter a futures ticker or commodity name');
            }
        });
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchBtn.click();
        });
    }

    document.querySelectorAll('#commodities-sector-filter .commodities-sector-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#commodities-sector-filter .commodities-sector-btn').forEach((b) => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            activeSector = btn.getAttribute('data-sector') || 'all';
            renderCommodityTable(commoditiesData);
            renderQuickGrid(commoditiesData);
        });
    });
}

async function loadCommodityDashboard() {
    const tableBody = document.getElementById('commodity-table-body');
    const feedStatus = document.getElementById('commodities-feed-status');
    if (!tableBody) return;

    feedStatus && (feedStatus.textContent = 'Syncing market feed…');

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/commodities`, { timeout: 30000 });
        const payload = await safeJsonParse(response);

        if (payload?.commodities && Array.isArray(payload.commodities)) {
            commoditiesData = payload.commodities;
            renderCommodityTable(commoditiesData);
            renderQuickGrid(commoditiesData);
            updateFeedStatus(payload);
        } else {
            tableBody.innerHTML = '<tr><td colspan="8" class="commodities-empty-cell">Unable to load market data.</td></tr>';
            feedStatus && (feedStatus.textContent = 'Feed unavailable');
        }
    } catch (error) {
        console.error('Failed to load commodities:', error);
        tableBody.innerHTML = '<tr><td colspan="8" class="commodities-empty-cell">Connection error. Retry shortly.</td></tr>';
        feedStatus && (feedStatus.textContent = 'Feed disconnected');
    }
}

function updateFeedStatus(payload) {
    const feedStatus = document.getElementById('commodities-feed-status');
    const syncLabel = document.getElementById('commodities-last-sync');
    const available = payload.commodities.filter((c) => !c.error).length;
    const total = payload.commodities.length;
    const syncTime = payload.fetchedAt
        ? new Date(payload.fetchedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '—';

    feedStatus && (feedStatus.textContent = `Live · ${available}/${total} instruments`);
    syncLabel && (syncLabel.textContent = `Last sync ${syncTime}`);
}

function filterBySector(items) {
    if (activeSector === 'all') return items;
    return items.filter((item) => item.sector === activeSector);
}

function formatCommodityPrice(value, unit) {
    if (value == null || Number.isNaN(Number(value))) return '—';
    const num = Number(value);
    if (num >= 10000) return `$${num.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    if (num >= 1000) return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (num >= 100) return `$${num.toFixed(2)}`;
    if (num >= 10) return `$${num.toFixed(2)}`;
    return `$${num.toFixed(3)}`;
}

function formatChange(value) {
    if (value == null || Number.isNaN(Number(value))) return '—';
    const num = Number(value);
    const sign = num >= 0 ? '+' : '';
    return `${sign}${num.toFixed(2)}`;
}

function formatChangePercent(value) {
    if (value == null || Number.isNaN(Number(value))) return '—';
    const num = Number(value);
    const sign = num >= 0 ? '+' : '';
    return `${sign}${num.toFixed(2)}%`;
}

function formatTimestamp(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderCommodityTable(items) {
    const tableBody = document.getElementById('commodity-table-body');
    if (!tableBody) return;

    const filtered = filterBySector(items);
    if (filtered.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8" class="commodities-empty-cell">No instruments in this sector.</td></tr>';
        return;
    }

    tableBody.innerHTML = filtered.map((item) => {
        if (item.error) {
            return `
                <tr class="commodities-row commodities-row-disabled">
                    <td>
                        <div class="commodities-instrument-cell">
                            <span class="commodities-instrument-icon sector-${item.sector || 'other'}"><i class="fa-solid ${item.icon || 'fa-chart-line'}"></i></span>
                            <div>
                                <span class="commodities-instrument-name">${item.name}</span>
                                <span class="commodities-instrument-symbol">${item.futuresTicker || item.symbol}</span>
                            </div>
                        </div>
                    </td>
                    <td><span class="commodities-sector-tag">${item.sectorLabel || '—'}</span></td>
                    <td>${item.exchange || '—'}</td>
                    <td class="num-col" colspan="4"><span class="commodities-unavailable">Unavailable</span></td>
                    <td>—</td>
                </tr>
            `;
        }

        const changeVal = item.changePercent != null ? Number(item.changePercent) : 0;
        const changeClass = changeVal >= 0 ? 'pos-change' : 'neg-change';
        const staleBadge = item.stale ? '<span class="commodities-stale-badge">Stale</span>' : '';

        return `
            <tr class="commodities-row" data-id="${item.id}" tabindex="0" role="button" aria-label="Analyze ${item.name}">
                <td>
                    <div class="commodities-instrument-cell">
                        <span class="commodities-instrument-icon sector-${item.sector || 'other'}"><i class="fa-solid ${item.icon || 'fa-chart-line'}"></i></span>
                        <div>
                            <span class="commodities-instrument-name">${item.name} ${staleBadge}</span>
                            <span class="commodities-instrument-symbol">${item.futuresTicker || item.symbol}</span>
                        </div>
                    </div>
                </td>
                <td><span class="commodities-sector-tag sector-tag-${item.sector}">${item.sectorLabel || '—'}</span></td>
                <td>${item.exchange || '—'}</td>
                <td class="num-col commodities-mono">${formatCommodityPrice(item.price, item.unit)}</td>
                <td class="num-col commodities-mono ${changeClass}">${formatChange(item.change)}</td>
                <td class="num-col commodities-mono ${changeClass}">${formatChangePercent(item.changePercent)}</td>
                <td class="commodities-unit-cell">${item.unit || 'USD'}</td>
                <td class="commodities-time-cell">${formatTimestamp(item.lastUpdated)}</td>
            </tr>
        `;
    }).join('');

    tableBody.querySelectorAll('.commodities-row:not(.commodities-row-disabled)').forEach((row) => {
        const open = () => selectCommodity(row.getAttribute('data-id'));
        row.addEventListener('click', open);
        row.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
            }
        });
    });
}

function renderQuickGrid(items) {
    const grid = document.getElementById('commodity-quick-grid');
    if (!grid) return;

    const filtered = filterBySector(items).filter((item) => !item.error);
    if (filtered.length === 0) {
        grid.innerHTML = '';
        return;
    }

    grid.innerHTML = filtered.map((item) => {
        const changeVal = item.changePercent != null ? Number(item.changePercent) : 0;
        const changeClass = changeVal >= 0 ? 'pos-change' : 'neg-change';

        return `
            <button class="commodities-quick-card" data-id="${item.id}" type="button">
                <div class="commodities-quick-top">
                    <span class="commodities-instrument-icon sector-${item.sector || 'other'}"><i class="fa-solid ${item.icon || 'fa-chart-line'}"></i></span>
                    <span class="commodities-sector-tag sector-tag-${item.sector}">${item.sectorLabel}</span>
                </div>
                <div class="commodities-quick-name">${item.name}</div>
                <div class="commodities-quick-symbol">${item.futuresTicker || item.symbol}</div>
                <div class="commodities-quick-price">${formatCommodityPrice(item.price, item.unit)}</div>
                <div class="commodities-quick-change ${changeClass}">${formatChangePercent(item.changePercent)}</div>
            </button>
        `;
    }).join('');

    grid.querySelectorAll('.commodities-quick-card').forEach((card) => {
        card.addEventListener('click', () => selectCommodity(card.getAttribute('data-id')));
    });
}

function selectCommodity(id) {
    const item = commoditiesData.find((c) => c.id === id);
    if (!item || item.error) return;
    const ticker = item.futuresTicker || item.symbol;
    window.location.href = `commodity-details.html?symbol=${ticker}&name=${encodeURIComponent(item.name)}`;
}

async function performCommoditySearch(query, directSymbol = null) {
    document.getElementById('commodity-loader')?.classList.remove('hidden-element');
    document.getElementById('commodity-results-container')?.classList.add('hidden-element');
    setDetailLoadingState();

    try {
        const params = new URLSearchParams();
        if (directSymbol) {
            params.set('symbol', directSymbol);
            params.set('query', query);
        } else {
            params.set('query', query);
        }

        const response = await fetchWithTimeout(`${BACKEND_URL}/api/commodities/search?${params}`, { timeout: 45000 });
        const payload = await safeJsonParse(response);

        document.getElementById('commodity-loader')?.classList.add('hidden-element');
        document.getElementById('commodity-results-container')?.classList.remove('hidden-element');

        if (payload?.error) {
            showToast(payload.error);
            populateDetailError(payload.error);
            return;
        }

        if (payload) {
            activeCommodity = { ...activeCommodity, ...payload };
            populateDetailView(payload);
            if (payload.chartData?.length) {
                renderCommodityChart(payload.chartData, payload.name, Number(payload.changePercent) >= 0);
                updateAnalytics(payload.chartData, payload.price, payload.unit);
            }
        }
    } catch (error) {
        console.error('Failed to perform commodity search:', error);
        document.getElementById('commodity-loader')?.classList.add('hidden-element');
        document.getElementById('commodity-results-container')?.classList.remove('hidden-element');
        populateDetailError('Network error loading commodity data.');
        showToast('Failed to load commodity analysis');
    }
}

async function reloadChart(symbol) {
    const subtitle = document.getElementById('commodity-chart-subtitle');
    subtitle && (subtitle.textContent = `Loading ${activeTimeframe} series…`);

    try {
        const response = await fetchWithTimeout(
            `${BACKEND_URL}/api/commodities/chart?symbol=${encodeURIComponent(symbol)}&range=${activeTimeframe}`,
            { timeout: 15000 }
        );
        const payload = await safeJsonParse(response);
        if (payload?.chartData?.length) {
            activeCommodity = { ...activeCommodity, ...payload };
            renderCommodityChart(payload.chartData, activeCommodity.name, Number(payload.changePercent) >= 0);
            updateAnalytics(payload.chartData, payload.price, activeCommodity.unit);
            subtitle && (subtitle.textContent = `${activeTimeframe} futures continuous contract · ${payload.exchange || activeCommodity.exchange || 'Global'}`);
        }
    } catch (error) {
        console.warn('Chart reload failed:', error);
        subtitle && (subtitle.textContent = 'Chart update failed');
    }
}

function setDetailLoadingState() {
    document.getElementById('commodity-name-display').textContent = 'Loading…';
    document.getElementById('commodity-ticker-badge').textContent = '…';
    document.getElementById('commodity-live-price-display').textContent = '—';
    document.getElementById('commodity-live-change-display').textContent = '—';
    document.getElementById('commodity-live-change-display').className = 'price-change-percent';
    document.getElementById('commodity-description-display').textContent = 'Generating macro profile…';
    document.getElementById('commodity-provider-label').textContent = 'Source: loading…';
}

function populateDetailError(message) {
    document.getElementById('commodity-name-display').textContent = 'Analysis Unavailable';
    document.getElementById('commodity-description-display').textContent = message;
}

function populateDetailView(payload) {
    const iconEl = document.querySelector('#commodity-icon-display i');
    if (iconEl) {
        iconEl.className = `fa-solid ${payload.icon || 'fa-chart-line'}`;
    }
    document.getElementById('commodity-sector-badge').textContent = payload.sectorLabel || 'Commodities';
    document.getElementById('commodity-sector-badge').className = `commodities-sector-badge sector-tag-${payload.sector || 'other'}`;
    document.getElementById('commodity-exchange-badge').textContent = payload.exchange || 'Global';
    document.getElementById('commodity-name-display').textContent = payload.name;
    document.getElementById('commodity-ticker-badge').textContent = payload.futuresTicker || payload.symbol;
    document.getElementById('commodity-unit-badge').textContent = payload.unit || 'USD';

    document.getElementById('commodity-live-price-display').textContent = formatCommodityPrice(payload.price, payload.unit);

    const changeVal = payload.changePercent != null ? Number(payload.changePercent) : 0;
    const changeEl = document.getElementById('commodity-live-change-display');
    changeEl.textContent = `${formatChange(payload.change)} (${formatChangePercent(payload.changePercent)})`;
    changeEl.className = `price-change-percent ${changeVal >= 0 ? 'pos-change' : 'neg-change'}`;

    document.getElementById('commodity-provider-label').textContent = `Source: ${payload.provider || 'Yahoo Finance'}`;
    document.getElementById('commodity-description-display').textContent = payload.description || 'Profile unavailable.';
    document.getElementById('commodity-chart-subtitle').textContent = `${activeTimeframe} futures continuous contract · ${payload.exchange || 'Global'}`;

    renderDrivers(payload.sector);
}

function renderDrivers(sector) {
    const list = document.getElementById('commodity-drivers-list');
    if (!list) return;
    const drivers = SECTOR_DRIVERS[sector] || SECTOR_DRIVERS.other;
    list.innerHTML = drivers.map((driver) => `<li><i class="fa-solid fa-chevron-right"></i>${driver}</li>`).join('');
}

function computeAnalytics(chartData, currentPrice) {
    const closes = chartData.map((d) => d.close).filter((v) => Number.isFinite(v));
    if (closes.length === 0) return null;

    const high = Math.max(...closes);
    const low = Math.min(...closes);
    const price = Number.isFinite(currentPrice) ? currentPrice : closes[closes.length - 1];
    const rangePct = high > low ? ((price - low) / (high - low)) * 100 : 50;

    const returns = [];
    for (let i = 1; i < closes.length; i++) {
        if (closes[i - 1] !== 0) {
            returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
        }
    }
    const mean = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length || 1);
    const dailyVol = Math.sqrt(variance);
    const annVol = dailyVol * Math.sqrt(252) * 100;

    return { high, low, price, rangePct, annVol };
}

function updateAnalytics(chartData, currentPrice, unit) {
    const stats = computeAnalytics(chartData, currentPrice);
    if (!stats) return;

    document.getElementById('commodity-metric-52h').textContent = formatCommodityPrice(stats.high, unit);
    document.getElementById('commodity-metric-52l').textContent = formatCommodityPrice(stats.low, unit);
    document.getElementById('commodity-metric-range-pct').textContent = `${stats.rangePct.toFixed(1)}%`;
    document.getElementById('commodity-metric-volatility').textContent = `${stats.annVol.toFixed(1)}%`;

    document.getElementById('commodity-range-low').textContent = formatCommodityPrice(stats.low, unit);
    document.getElementById('commodity-range-high').textContent = formatCommodityPrice(stats.high, unit);
    document.getElementById('commodity-range-label').textContent = `${stats.rangePct.toFixed(0)}% of range`;

    const marker = document.getElementById('commodity-range-marker');
    if (marker) {
        marker.style.left = `${Math.min(Math.max(stats.rangePct, 2), 98)}%`;
    }
}

function renderCommodityChart(chartData, name, isPositive) {
    const ctx = document.getElementById('commodity-chart');
    if (!ctx) return;

    if (commodityChartInstance) {
        commodityChartInstance.destroy();
    }

    const labels = chartData.map((d) => {
        const date = new Date(d.time * 1000);
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    });
    const dataPoints = chartData.map((d) => d.close);

    const lineColor = isPositive ? '#10b981' : '#ef4444';
    const gradientStart = isPositive ? 'rgba(16, 185, 129, 0.18)' : 'rgba(239, 68, 68, 0.18)';
    const gradientEnd = isPositive ? 'rgba(16, 185, 129, 0)' : 'rgba(239, 68, 68, 0)';

    const chartCtx = ctx.getContext('2d');
    const gradient = chartCtx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, gradientStart);
    gradient.addColorStop(1, gradientEnd);

    commodityChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: `${name} Price`,
                data: dataPoints,
                borderColor: lineColor,
                backgroundColor: gradient,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: lineColor,
                fill: true,
                tension: 0.15,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0d1326',
                    titleColor: '#94a3b8',
                    bodyColor: '#f8fafc',
                    borderColor: '#1e2d54',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        title: (items) => items[0]?.label || '',
                        label: (context) => formatCommodityPrice(context.parsed.y),
                    },
                },
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
                    ticks: { color: '#64748b', maxTicksLimit: 8, font: { size: 11 } },
                },
                y: {
                    position: 'right',
                    grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
                    ticks: {
                        color: '#64748b',
                        font: { family: 'JetBrains Mono, monospace', size: 11 },
                        callback: (value) => formatCommodityPrice(value),
                    },
                },
            },
        },
    });
}
