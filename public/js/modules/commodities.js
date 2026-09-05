import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast } from '../utils.js';
import { IndicatorManager, setupIndicatorsUI } from './indicators.js';

let commoditiesData = [];
let commodityChartInstance = null;
window.commodityIndicatorManager = null;
window.currentCommodityChartData = [];
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
        setupIndicatorsUI('commodity', () => window.currentCommodityChartData || [], () => window.commodityIndicatorManager);
        
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
    const container = document.getElementById('commodity-chart');
    if (!container) return;

    // Clean up previous chart instance
    if (commodityChartInstance) {
        if (commodityChartInstance._resizeObserver) {
            commodityChartInstance._resizeObserver.disconnect();
        }
        commodityChartInstance.remove();
        commodityChartInstance = null;
    }
    container.innerHTML = '';

    const dataPoints = chartData.map(d => d.close);
    const accentColor = isPositive ? '#10b981' : '#ef4444';

    // Guarantee chart gets correct dimensions (safety net for any edge-case timing)
    const containerW = container.clientWidth || container.offsetWidth || 800;
    const containerH = container.clientHeight || container.offsetHeight || 420;

    // Create chart
    const chart = LightweightCharts.createChart(container, {
        width: containerW,
        height: containerH,
        layout: {
            background: { type: 'solid', color: '#0d1117' },
            textColor: '#9ca3af',
            fontFamily: "'JetBrains Mono', 'Inter', monospace",
            fontSize: 11,
        },
        grid: {
            vertLines: { color: 'rgba(255,255,255,0.04)', style: LightweightCharts.LineStyle.Solid },
            horzLines: { color: 'rgba(255,255,255,0.04)', style: LightweightCharts.LineStyle.Solid },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: {
                color: 'rgba(99, 179, 237, 0.6)',
                width: 1,
                style: LightweightCharts.LineStyle.Solid,
                labelBackgroundColor: '#1e40af',
            },
            horzLine: {
                color: 'rgba(99, 179, 237, 0.6)',
                width: 1,
                style: LightweightCharts.LineStyle.Solid,
                labelBackgroundColor: '#1e40af',
            },
        },
        rightPriceScale: {
            borderColor: 'rgba(255,255,255,0.06)',
            scaleMargins: { top: 0.1, bottom: 0.1 },
            textColor: '#6b7280',
        },
        timeScale: {
            borderColor: 'rgba(255,255,255,0.06)',
            timeVisible: true,
            secondsVisible: false,
            fixLeftEdge: true,
            fixRightEdge: true,
            tickMarkFormatter: (time) => {
                const d = typeof time === 'string' ? new Date(time) : new Date(time * 1000);
                return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
            },
        },
        handleScroll: { vertTouchDrag: false, mouseWheel: true, pressedMouseMove: true },
        handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });

    // Area series for commodity price
    const mainSeries = chart.addSeries(LightweightCharts.AreaSeries, {
        topColor: isPositive ? 'rgba(0, 208, 156, 0.28)' : 'rgba(255, 107, 107, 0.28)',
        bottomColor: isPositive ? 'rgba(0, 208, 156, 0.01)' : 'rgba(255, 107, 107, 0.01)',
        lineColor: isPositive ? '#00d09c' : '#ff6b6b',
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: '#ffffff',
        crosshairMarkerBorderWidth: 1.5,
        crosshairMarkerBackgroundColor: isPositive ? '#00d09c' : '#ff6b6b',
        priceFormat: {
            type: 'custom',
            formatter: (val) => formatCommodityPrice(val),
        },
    });

    // Convert unix timestamps to YYYY-MM-DD for lightweight-charts
    const lineData = chartData.map(d => {
        const dt = new Date(d.time * 1000);
        const yyyy = dt.getFullYear();
        const mm = String(dt.getMonth() + 1).padStart(2, '0');
        const dd = String(dt.getDate()).padStart(2, '0');
        return { time: `${yyyy}-${mm}-${dd}`, value: d.close };
    });

    // Deduplicate by date
    const uniqueData = [];
    const seenDates = new Set();
    for (const item of lineData) {
        if (!seenDates.has(item.time)) {
            seenDates.add(item.time);
            uniqueData.push(item);
        }
    }
    mainSeries.setData(uniqueData);

    // Current price line
    const lastPrice = dataPoints[dataPoints.length - 1];
    mainSeries.createPriceLine({
        price: lastPrice,
        color: accentColor,
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: '',
    });

    // ── % Return Label ────────────────────────────────────────────────────────
    const firstPrice = dataPoints[0];
    const retPct = ((lastPrice - firstPrice) / firstPrice * 100);
    const retStr = `${retPct >= 0 ? '▲ +' : '▼ '}${retPct.toFixed(2)}%`;
    let retLabel = container.querySelector('.chart-return-label');
    if (!retLabel) {
        retLabel = document.createElement('div');
        container.appendChild(retLabel);
    }
    retLabel.className = `chart-return-label ${isPositive ? 'positive' : 'negative'}`;
    retLabel.textContent = retStr;

    // ── STRATA Watermark ──────────────────────────────────────────────────────
    try {
        LightweightCharts.createTextWatermark(chart.panes()[0], {
            horzAlign: 'center', vertAlign: 'center',
            lines: [{ text: 'STRATA', color: 'rgba(255,255,255,0.022)', fontSize: 56, fontStyle: 'bold', fontFamily: "'Inter', sans-serif" }],
        });
    } catch (e) { /* optional */ }

    // Floating tooltip
    const toolTipEl = document.createElement('div');
    toolTipEl.className = 'lw-chart-tooltip';
    container.appendChild(toolTipEl);

    chart.subscribeCrosshairMove(param => {
        if (!param || !param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
            toolTipEl.style.display = 'none';
            return;
        }

        const priceData = param.seriesData.get(mainSeries);
        if (!priceData) { toolTipEl.style.display = 'none'; return; }

        const d = typeof param.time === 'string' ? new Date(param.time) : new Date(param.time * 1000);
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        let tooltipHtml = `
            <div class="tt-date">${dateStr}</div>
            <div class="tt-row"><span class="tt-label">${name}</span><span class="tt-val">${formatCommodityPrice(priceData.value)}</span></div>
        `;

        if (window.commodityIndicatorManager) {
            tooltipHtml += window.commodityIndicatorManager.getTooltipData(param);
        }

        toolTipEl.innerHTML = tooltipHtml;
        toolTipEl.style.display = 'block';

        const chartRect = container.getBoundingClientRect();
        const tooltipWidth = 160;
        const tooltipHeight = toolTipEl.offsetHeight || 60;
        let left = param.point.x + 16;
        let top = param.point.y - tooltipHeight / 2;

        if (left + tooltipWidth > chartRect.width) left = param.point.x - tooltipWidth - 16;
        if (top < 0) top = 4;
        if (top + tooltipHeight > chartRect.height) top = chartRect.height - tooltipHeight - 4;

        toolTipEl.style.left = left + 'px';
        toolTipEl.style.top = top + 'px';
    });

    // Fit content
    chart.timeScale().fitContent();

    // Responsive resize
    const resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) {
                chart.applyOptions({ width, height });
                chart.timeScale().fitContent();
            }
        }
    });
    resizeObserver.observe(container);

    // Double-safety: force explicit size after next two frames
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const w = container.clientWidth;
            const h = container.clientHeight;
            if (w > 0 && h > 0) {
                chart.applyOptions({ width: w, height: h });
                chart.timeScale().fitContent();
            }
        });
    });

    commodityChartInstance = chart;
    commodityChartInstance._resizeObserver = resizeObserver;

    window.currentCommodityChartData = uniqueData;
    window.commodityIndicatorManager = new IndicatorManager(chart, mainSeries, null); // No volume series in commodities
    const menu = document.getElementById('commodity-indicator-menu');
    if (menu) {
        menu.querySelectorAll('input').forEach(input => {
            if (input.checked) {
                window.commodityIndicatorManager.active[input.value] = false;
                window.commodityIndicatorManager.toggle(input.value, uniqueData);
            }
        });
    }
}
