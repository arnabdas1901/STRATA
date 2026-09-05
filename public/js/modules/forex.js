import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast, normalizeForexPair } from '../utils.js';
import { IndicatorManager, setupIndicatorsUI } from './indicators.js';

let forexChartInstance = null;
window.forexIndicatorManager = null;
window.currentForexChartData = [];
let currentForexPair = null;
let activeSymbol = null;
let activeDays = 365;
let isSwapped = false;

// ── Entry Point ────────────────────────────────────────────────────────────────
export function setupForexTracker() {
    const init = async () => {
        const isDetailsPage = window.location.pathname.includes('forex-details.html');

        setupSearch();

        if (isDetailsPage) {
            setupDetailsPageHandlers();
            setupIndicatorsUI('forex', () => window.currentForexChartData || [], () => window.forexIndicatorManager);
            
            const params = new URLSearchParams(window.location.search);
            const symbol = params.get('symbol');
            const normalized = normalizeForexPair(symbol);
            if (normalized) {
                activeSymbol = normalized;
                executeForexSearch(normalized, activeDays);
            } else {
                window.location.href = 'forex.html';
            }
        } else {
            setupLandingGridClicks();
            loadLatestForexRates();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}

// ── Unified Search Handler ─────────────────────────────────────────────────────
function setupSearch() {
    const searchBtn = document.getElementById('forex-search-btn');
    const searchInput = document.getElementById('forex-search-input');

    const handleSearch = () => {
        if (!searchInput) return;
        const normalized = normalizeForexPair(searchInput.value);
        if (!normalized) {
            showToast('Invalid format. Use XXX/YYY (e.g. EUR/USD) or XXXYYY (e.g. EURUSD).');
            return;
        }

        window.location.href = `forex-details.html?symbol=${encodeURIComponent(normalized)}`;
    };

    if (searchBtn) searchBtn.addEventListener('click', handleSearch);
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSearch();
        });
    }
}

// ── Details Page Handlers ──────────────────────────────────────────────────────
function setupDetailsPageHandlers() {
    const aiGenBtn = document.getElementById('forex-ai-generate-btn');
    if (aiGenBtn) {
        aiGenBtn.addEventListener('click', generateAiForexProfile);
    }

    // Timeframe button click handlers
    const tfBtns = document.querySelectorAll('.chart-timeframe-selectors .tf-btn');
    tfBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tfBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeDays = parseInt(btn.getAttribute('data-tf')) || 365;
            if (activeSymbol) {
                executeForexSearch(activeSymbol, activeDays);
            }
        });
    });
}

// ── Landing Page: Grid Clicks & Live Rates ─────────────────────────────────────
function setupLandingGridClicks() {
    const cards = document.querySelectorAll('#forex-brackets-grid .crypto-bracket-card');
    cards.forEach(card => {
        const getSymbolAndRedirect = () => {
            const symbol = card.querySelector('.bracket-symbol').innerText;
            if (symbol) {
                window.location.href = `forex-details.html?symbol=${encodeURIComponent(symbol)}`;
            }
        };
        card.addEventListener('click', getSymbolAndRedirect);
        card.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                getSymbolAndRedirect();
            }
        });
    });
}

function generateSparklineSvg(dataPoints, width = 120, height = 30) {
    if (!dataPoints || dataPoints.length < 2) return '';
    const min = Math.min(...dataPoints);
    const max = Math.max(...dataPoints);
    const range = max - min === 0 ? 1 : max - min;
    
    const points = dataPoints.map((val, index) => {
        const x = (index / (dataPoints.length - 1)) * width;
        const y = height - ((val - min) / range) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    
    const isPositive = dataPoints[dataPoints.length - 1] >= dataPoints[0];
    const strokeColor = isPositive ? '#10b981' : '#ef4444';
    
    return `
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow: visible; display: block; margin: 8px auto 0;">
            <polyline fill="none" stroke="${strokeColor}" stroke-width="1.5" points="${points.join(' ')}" />
        </svg>
    `;
}

async function loadLatestForexRates() {
    try {
        const res = await fetchWithTimeout(`${BACKEND_URL}/api/forex/latest`, { timeout: 8000 });
        const data = await safeJsonParse(res);
        if (!res.ok || !data || !data.rates) {
            throw new Error(data?.error || 'No forex rate data returned');
        }

        const cards = document.querySelectorAll('#forex-brackets-grid .crypto-bracket-card');
        cards.forEach(card => {
            const symbolEl = card.querySelector('.bracket-symbol');
            const priceEl = card.querySelector('.bracket-price');
            const changeEl = card.querySelector('.bracket-change');
            const sparklineEl = card.querySelector('.bracket-sparkline');
            if (!symbolEl || !priceEl || !changeEl) return;

            const symbol = symbolEl.innerText;
            let fromCurrency = 'USD';
            let toCurrency = 'USD';

            if (symbol.includes('/')) {
                [fromCurrency, toCurrency] = symbol.split('/');
            }

            let liveRate = null;
            let changeVal = 0;
            let changePercent = 0;

            if (fromCurrency === 'USD') {
                const metric = data.changes[toCurrency];
                if (metric) {
                    liveRate = metric.rate;
                    changeVal = metric.change;
                    changePercent = metric.changePercent;

                    // Draw sparkline
                    const history = data.sparklines?.[toCurrency];
                    if (history && sparklineEl) {
                        sparklineEl.innerHTML = generateSparklineSvg(history);
                    }
                }
            } else if (toCurrency === 'USD') {
                const metric = data.changes[fromCurrency];
                if (metric && metric.rate > 0) {
                    const yesterdayRate = metric.rate - metric.change;
                    const liveRateInverted = 1 / metric.rate;
                    const yesterdayRateInverted = 1 / yesterdayRate;
                    liveRate = liveRateInverted;
                    changeVal = liveRateInverted - yesterdayRateInverted;
                    changePercent = (changeVal / yesterdayRateInverted) * 100;

                    // Draw sparkline (inverted)
                    const history = data.sparklines?.[fromCurrency];
                    if (history && sparklineEl) {
                        const invertedHistory = history.map(h => h > 0 ? 1 / h : 0);
                        sparklineEl.innerHTML = generateSparklineSvg(invertedHistory);
                    }
                }
            }

            if (liveRate !== null) {
                priceEl.innerText = liveRate.toFixed(4);
                const prefix = changeVal >= 0 ? '+' : '';
                changeEl.innerText = `${prefix}${changePercent.toFixed(2)}%`;
                changeEl.style.color = changeVal >= 0 ? 'var(--neon-green-positive)' : 'var(--neon-red-negative)';
            }
        });

        const providerLabel = data.provider || 'Frankfurter (ECB)';
        const providerText = `${providerLabel}${data.lastRefreshed ? ` · ${new Date(data.lastRefreshed).toLocaleTimeString()}` : ''}`;
        const kpiSource = document.getElementById('kpi-data-source');
        if (kpiSource) {
            kpiSource.innerHTML = `${providerText} <i class="fa-solid fa-check-circle" style="font-size: 0.8em;"></i>`;
        }

        const eurMetric = data.changes['EUR'];
        const kpiEurUsd = document.getElementById('kpi-eur-usd-value');
        if (kpiEurUsd && eurMetric && eurMetric.rate > 0) {
            const eurUsdRate = 1 / eurMetric.rate;
            kpiEurUsd.innerHTML = `${eurUsdRate.toFixed(4)} <i class="fa-solid fa-arrow-right-arrow-left" style="font-size: 0.7em;"></i>`;
        }
    } catch (err) {
        console.warn('Could not load latest forex rates', err);
        showToast('Unable to refresh forex benchmarks. Showing the latest available data.');
    }
}

// ── Details Page: Full Pair Analysis ───────────────────────────────────────────
async function executeForexSearch(pairQuery, days = 365) {
    const loader = document.getElementById('forex-loader');
    const results = document.getElementById('forex-results-container');
    const errorContainer = document.getElementById('forex-error-container');

    if (loader) loader.classList.remove('hidden-element');
    if (results) results.classList.add('hidden-element');
    if (errorContainer) errorContainer.classList.add('hidden-element');

    try {
        const res = await fetchWithTimeout(`${BACKEND_URL}/api/forex/search?pair=${encodeURIComponent(pairQuery)}&days=${days}`, { timeout: 10000 });
        const data = await safeJsonParse(res);
        if (!res.ok || data?.error) {
            throw new Error(data?.error || 'Failed to retrieve forex data');
        }

        const isPositive = data.change >= 0;
        const colorClass = isPositive ? 'positive' : 'negative';
        const sign = isPositive ? '+' : '';

        // Update identity
        document.getElementById('forex-name-display').innerText = `${data.fromSymbol} / ${data.toSymbol}`;
        document.getElementById('forex-symbol-badge').innerText = `${data.fromSymbol}${data.toSymbol}`;
        document.getElementById('forex-live-price').innerText = data.price.toFixed(4);

        const changeEl = document.getElementById('forex-change-display');
        changeEl.innerText = `${sign}${data.change.toFixed(4)} (${sign}${data.changePercent.toFixed(2)}%)`;
        changeEl.className = `price-change-percent ${colorClass}`;

        const lastUpdatedEl = document.getElementById('forex-last-updated');
        if (lastUpdatedEl && data.lastUpdated) {
            const updatedDate = new Date(data.lastUpdated);
            lastUpdatedEl.innerText = `As of ${updatedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
            lastUpdatedEl.style.display = '';
        } else if (lastUpdatedEl) {
            lastUpdatedEl.style.display = 'none';
        }

        document.getElementById('forex-description-display').innerText = 'Click "Generate Profile" to run on-demand AI macroeconomic analysis.';

        const btn = document.getElementById('forex-ai-generate-btn');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-robot"></i> Generate Profile';
        }

        currentForexPair = {
            fromSymbol: data.fromSymbol,
            toSymbol: data.toSymbol,
            price: data.price
        };

        // Render KPI Metrics Grid
        renderForexMetrics(data);

        // Setup Currency Converter
        setupConverter(data.fromSymbol, data.toSymbol, data.price);

        if (loader) loader.classList.add('hidden-element');
        if (results) results.classList.remove('hidden-element');

        // Render chart AFTER container is visible so clientWidth/clientHeight are non-zero
        if (data.chartData && data.chartData.length > 0) {
            requestAnimationFrame(() => renderForexChart(data.chartData, `${data.fromSymbol}/${data.toSymbol}`, isPositive));
        }

    } catch (err) {
        console.error("Forex Search Error:", err);
        if (loader) loader.classList.add('hidden-element');

        if (errorContainer) {
            const errorMsg = errorContainer.querySelector('.error-message-text');
            const errorPair = errorContainer.querySelector('.error-pair-name');
            if (errorMsg) errorMsg.innerText = err.message || 'Failed to load forex data.';
            if (errorPair) errorPair.innerText = pairQuery;
            errorContainer.classList.remove('hidden-element');
        } else {
            showToast(err.message || "Failed to load forex data.");
        }
    }
}

// ── Render Metrics Grid ────────────────────────────────────────────────────────
function renderForexMetrics(data) {
    const prices = data.chartData ? data.chartData.map(d => d.close) : [];
    if (prices.length === 0) return;

    // 52-Week Range / Selected Range bounds
    const minVal = Math.min(...prices);
    const maxVal = Math.max(...prices);

    // Dynamic Bid/Ask Spread (simulate tight institutional pricing: ~1.5 pips)
    const pipMultiplier = data.price > 20 ? 0.01 : 0.0001; // wider spread for high value currencies like Yen
    const spreadVal = 1.5 * pipMultiplier;
    const bidPrice = data.price - (spreadVal / 2);
    const askPrice = data.price + (spreadVal / 2);

    // Daily Range (simulate recent daily high/low based on last day volatility)
    const dailyVolatility = data.price * 0.0035; // typical daily FX deviation of 0.35%
    const dailyLow = data.price - (dailyVolatility / 2);
    const dailyHigh = data.price + (dailyVolatility / 2);

    // Yearly/Series Performance
    const startPrice = prices[0];
    const performancePct = ((data.price - startPrice) / startPrice) * 100;

    // Mathematical Volatility (Coefficient of Variation)
    const mean = prices.reduce((s, x) => s + x, 0) / prices.length;
    const variance = prices.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);
    const volatilityPct = (stdDev / mean) * 100;

    // Fill UI elements
    document.getElementById('forex-metric-daily-range').innerText = `${dailyLow.toFixed(4)} - ${dailyHigh.toFixed(4)}`;
    document.getElementById('forex-metric-52w-range').innerText = `${minVal.toFixed(4)} - ${maxVal.toFixed(4)}`;
    
    const perfEl = document.getElementById('forex-metric-yearly-perf');
    perfEl.innerText = `${performancePct >= 0 ? '+' : ''}${performancePct.toFixed(2)}%`;
    perfEl.style.color = performancePct >= 0 ? 'var(--neon-green-positive)' : 'var(--neon-red-negative)';

    document.getElementById('forex-metric-spread').innerText = `${bidPrice.toFixed(4)} / ${askPrice.toFixed(4)}`;
    document.getElementById('forex-metric-volatility').innerText = `${volatilityPct.toFixed(2)}%`;
    document.getElementById('forex-metric-provider').innerText = data.provider || 'Frankfurter';
}

// ── Setup Currency Converter ───────────────────────────────────────────────────
function setupConverter(base, quote, rate) {
    const baseInput = document.getElementById('converter-base-input');
    const quoteInput = document.getElementById('converter-quote-input');
    const baseLabel = document.getElementById('converter-base-label');
    const quoteLabel = document.getElementById('converter-quote-label');
    const swapBtn = document.getElementById('converter-swap-btn');
    const rateFeed = document.getElementById('converter-rate-feed');

    if (!baseInput || !quoteInput || !baseLabel || !quoteLabel || !swapBtn || !rateFeed) return;

    isSwapped = false;

    const updateConversion = (direction) => {
        const activeRate = isSwapped ? (1 / rate) : rate;
        if (direction === 'base') {
            const val = parseFloat(baseInput.value);
            if (!isNaN(val)) {
                quoteInput.value = (val * activeRate).toFixed(4);
            } else {
                quoteInput.value = '';
            }
        } else {
            const val = parseFloat(quoteInput.value);
            if (!isNaN(val)) {
                baseInput.value = (val / activeRate).toFixed(4);
            } else {
                baseInput.value = '';
            }
        }
    };

    const updateFeed = () => {
        if (isSwapped) {
            rateFeed.innerText = `1 ${quote} = ${(1 / rate).toFixed(4)} ${base}`;
            baseLabel.innerText = `Amount (${quote})`;
            quoteLabel.innerText = `Result (${base})`;
        } else {
            rateFeed.innerText = `1 ${base} = ${rate.toFixed(4)} ${quote}`;
            baseLabel.innerText = `Amount (${base})`;
            quoteLabel.innerText = `Result (${quote})`;
        }
    };

    // Remove existing event listeners by replacing elements
    const newBaseInput = baseInput.cloneNode(true);
    const newQuoteInput = quoteInput.cloneNode(true);
    const newSwapBtn = swapBtn.cloneNode(true);

    baseInput.parentNode.replaceChild(newBaseInput, baseInput);
    quoteInput.parentNode.replaceChild(newQuoteInput, quoteInput);
    swapBtn.parentNode.replaceChild(newSwapBtn, swapBtn);

    newBaseInput.addEventListener('input', () => updateConversion('base'));
    newQuoteInput.addEventListener('input', () => updateConversion('quote'));
    
    newSwapBtn.addEventListener('click', () => {
        isSwapped = !isSwapped;
        const temp = newBaseInput.value;
        newBaseInput.value = newQuoteInput.value;
        newQuoteInput.value = temp;
        updateFeed();
        updateConversion('base');
    });

    updateFeed();
    updateConversion('base');
}

// ── Chart Rendering ────────────────────────────────────────────────────────────
function renderForexChart(chartData, pairName, isPositive) {
    const container = document.getElementById('forexHistoricalChart');
    if (!container) return;

    // Clean up previous chart instance
    if (forexChartInstance) {
        if (forexChartInstance._resizeObserver) {
            forexChartInstance._resizeObserver.disconnect();
        }
        forexChartInstance.remove();
        forexChartInstance = null;
    }
    container.innerHTML = '';

    const dataPoints = chartData.map(d => d.close);
    const accentColor = isPositive ? '#00ffff' : '#ff0055';

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

    // Area series for exchange rate
    const mainSeries = chart.addSeries(LightweightCharts.AreaSeries, {
        topColor: isPositive ? 'rgba(0, 255, 255, 0.28)' : 'rgba(255, 0, 85, 0.28)',
        bottomColor: isPositive ? 'rgba(0, 255, 255, 0.01)' : 'rgba(255, 0, 85, 0.01)',
        lineColor: isPositive ? '#00ffff' : '#ff0055',
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: '#ffffff',
        crosshairMarkerBorderWidth: 1.5,
        crosshairMarkerBackgroundColor: isPositive ? '#00ffff' : '#ff0055',
        priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
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
    const retStr = `${retPct >= 0 ? '▲ +' : '▼ '}${retPct.toFixed(4)}%`;
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
            <div class="tt-row"><span class="tt-label">${pairName}</span><span class="tt-val">${priceData.value.toFixed(4)}</span></div>
        `;
        
        if (window.forexIndicatorManager) {
            tooltipHtml += window.forexIndicatorManager.getTooltipData(param);
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

    forexChartInstance = chart;
    forexChartInstance._resizeObserver = resizeObserver;
    
    window.currentForexChartData = uniqueData;
    window.forexIndicatorManager = new IndicatorManager(chart, mainSeries, null); // No volume series in forex
    const menu = document.getElementById('forex-indicator-menu');
    if (menu) {
        menu.querySelectorAll('input').forEach(input => {
            if (input.checked) {
                window.forexIndicatorManager.active[input.value] = false;
                window.forexIndicatorManager.toggle(input.value, uniqueData);
            }
        });
    }
}

// ── AI Macro Profile Generation ────────────────────────────────────────────────
async function generateAiForexProfile() {
    if (!currentForexPair) return;

    const btn = document.getElementById('forex-ai-generate-btn');
    const display = document.getElementById('forex-description-display');

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';
    }
    display.innerHTML = '<span class="pulse-text" style="color: var(--neon-cyan-vibrant);">Consulting AI FX Strategist...</span>';

    try {
        const res = await fetch(`${BACKEND_URL}/api/forex/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentForexPair)
        });
        const data = await safeJsonParse(res);

        if (data.error) throw new Error(data.error);

        display.innerText = data.analysis || 'Analysis unavailable.';

        const cachedBadge = document.getElementById('forex-ai-cached-badge');
        if (cachedBadge) {
            cachedBadge.style.display = data.cached ? '' : 'none';
        }

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Regenerate Profile';
        }

    } catch (err) {
        console.error('Forex AI Gen Error:', err);
        display.innerText = 'Failed to generate profile. Please try again.';
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-robot"></i> Retry Profile';
        }
    }
}
