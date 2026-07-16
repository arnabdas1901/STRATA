import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast, normalizeForexPair } from '../utils.js';

let forexChartInstance = null;
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
    const cards = document.querySelectorAll('#forex-brackets-grid .forex-table-row');
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

async function loadLatestForexRates() {
    try {
        const res = await fetchWithTimeout(`${BACKEND_URL}/api/forex/latest`, { timeout: 8000 });
        const data = await safeJsonParse(res);
        if (!res.ok || !data || !data.rates) {
            throw new Error(data?.error || 'No forex rate data returned');
        }

        const cards = document.querySelectorAll('#forex-brackets-grid .forex-table-row');
        cards.forEach(card => {
            const symbolEl = card.querySelector('.bracket-symbol');
            const priceEl = card.querySelector('.bracket-price');
            const changeEl = card.querySelector('.bracket-change');
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

        if (data.chartData && data.chartData.length > 0) {
            renderForexChart(data.chartData, `${data.fromSymbol}/${data.toSymbol}`, isPositive);
        }

        if (loader) loader.classList.add('hidden-element');
        if (results) results.classList.remove('hidden-element');

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
    const canvas = document.getElementById('forexHistoricalChart');
    if (!canvas) return;

    if (forexChartInstance) {
        forexChartInstance.destroy();
    }

    const labels = chartData.map(d => {
        const date = new Date(d.time * 1000);
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    });
    const dataPoints = chartData.map(d => d.close);

    const gradient = canvas.getContext('2d').createLinearGradient(0, 0, 0, 400);
    if (isPositive) {
        gradient.addColorStop(0, 'rgba(0, 255, 255, 0.2)');
        gradient.addColorStop(1, 'rgba(0, 255, 255, 0)');
    } else {
        gradient.addColorStop(0, 'rgba(255, 0, 85, 0.2)');
        gradient.addColorStop(1, 'rgba(255, 0, 85, 0)');
    }

    const lineColor = isPositive ? '#00ffff' : '#ff0055';

    forexChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `${pairName} Close Price`,
                data: dataPoints,
                borderColor: lineColor,
                backgroundColor: gradient,
                borderWidth: 2.5,
                pointRadius: 0,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(10, 14, 23, 0.95)',
                    titleColor: 'rgba(255, 255, 255, 0.7)',
                    bodyColor: '#00f0ff',
                    bodyFont: { family: "'JetBrains Mono', monospace", size: 14, weight: 'bold' },
                    borderColor: 'rgba(0, 240, 255, 0.3)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: (ctx) => `Price: ${ctx.parsed.y.toFixed(4)}`
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.04)',
                        drawBorder: false
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.4)',
                        maxTicksLimit: 6,
                        font: { size: 11 }
                    }
                },
                y: {
                    display: true,
                    position: 'right',
                    grid: {
                        color: 'rgba(255, 255, 255, 0.04)',
                        drawBorder: false
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.4)',
                        font: { family: "'JetBrains Mono', monospace" },
                        callback: (val) => val.toFixed(4)
                    }
                }
            }
        }
    });
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
