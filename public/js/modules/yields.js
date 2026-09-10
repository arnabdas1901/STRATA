import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast } from '../utils.js';

let yieldCurveChartInstance = null;
let spreadHistoryChartInstance = null;
let creditSpreadChartInstance = null;
let breakevenChartInstance = null;
let mortgageSpreadChartInstance = null;

export function initYieldsDashboard() {
    loadYieldData();
    setupDurationCalculator();
}

async function loadYieldData() {
    const loader = document.getElementById('yields-loader');
    const results = document.getElementById('yields-results');

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/yields`, { timeout: 30000 });
        const payload = await safeJsonParse(response);

        if (!payload || !payload.yields) {
            throw new Error('Invalid yield data response');
        }

        populateYieldCards(payload.yields);
        populateSpreads(payload.spreads);
        populateRecessionRisk(payload.recessionRisk);
        populateFedFundsRate(payload.fedFundsRate);
        renderYieldCurveChart(payload.yields, payload.fedFundsRate);

        if (loader) loader.classList.add('hidden-element');
        if (results) results.classList.remove('hidden-element');

        // Fire async tasks
        fetchYieldAnalysis(payload);
        loadSpreadHistory();
        loadEconomicCalendar();
        loadCreditSpreads();
        loadBreakevens();
        loadYieldHeatmap();
        loadMortgageSpread();
        populateButterfly(payload.yields);

    } catch (err) {
        console.error('Yield data fetch error:', err);
        showToast('Failed to load Treasury yield data.');
        if (loader) {
            loader.innerHTML = `<span style="color: #ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> Failed to load yield data. Please retry.</span>`;
        }
    }
}

function populateYieldCards(yields) {
    const mapping = {
        '3M': 'yield-3m',
        '2Y': 'yield-2y',
        '5Y': 'yield-5y',
        '10Y': 'yield-10y',
        '30Y': 'yield-30y',
    };

    let latestDate = '—';

    for (const [key, elId] of Object.entries(mapping)) {
        const el = document.getElementById(elId);
        if (!el) continue;
        const yData = yields[key];
        if (yData && yData.yield != null) {
            el.innerText = `${yData.yield.toFixed(2)}%`;
            if (yData.date) latestDate = yData.date;

            // Add basis point change indicator dynamically
            if (yData.change != null) {
                const bps = Math.round(yData.change * 100);
                const changeEl = document.createElement('span');
                changeEl.className = 'yield-bps-change';
                const arrow = bps > 0 ? '▲' : bps < 0 ? '▼' : '—';
                const color = bps > 0 ? '#10b981' : bps < 0 ? '#ef4444' : '#64748b';
                changeEl.style.color = color;
                changeEl.innerText = `${arrow} ${Math.abs(bps)} bps`;
                el.parentElement.appendChild(changeEl);
            }
        } else {
            el.innerText = 'N/A';
            el.style.color = 'var(--text-secondary-muted)';
        }
    }

    const dateEl = document.getElementById('yield-date');
    if (dateEl) dateEl.innerText = latestDate;
}

function populateFedFundsRate(fedFunds) {
    const el = document.getElementById('yield-fed-rate');
    if (!el) return;
    if (fedFunds && fedFunds.rate != null) {
        el.innerText = `${fedFunds.rate.toFixed(2)}%`;
    } else {
        el.innerText = 'N/A';
        el.style.color = 'var(--text-secondary-muted)';
    }
}

function populateSpreads(spreads) {
    const spread10y2yEl = document.getElementById('yields-spread-10y2y');
    const spread10y3mEl = document.getElementById('yields-spread-10y3m');

    if (spread10y2yEl && spreads['10Y2Y'] != null) {
        const val = spreads['10Y2Y'];
        const sign = val >= 0 ? '+' : '';
        spread10y2yEl.innerText = `${sign}${val.toFixed(2)}%`;
        spread10y2yEl.style.color = val < 0 ? '#ef4444' : '#10b981';
    }

    if (spread10y3mEl && spreads['10Y3M'] != null) {
        const val = spreads['10Y3M'];
        const sign = val >= 0 ? '+' : '';
        spread10y3mEl.innerText = `${sign}${val.toFixed(2)}%`;
        spread10y3mEl.style.color = val < 0 ? '#ef4444' : '#10b981';
    }
}

function populateRecessionRisk(risk) {
    if (!risk) return;

    const banner = document.getElementById('yields-risk-banner');
    const icon = document.getElementById('yields-risk-icon');
    const level = document.getElementById('yields-risk-level');
    const desc = document.getElementById('yields-risk-description');

    if (level) {
        level.innerText = risk.level;
        level.style.color = risk.color;
    }
    if (icon && risk.icon) {
        icon.className = `fa-solid ${risk.icon}`;
        icon.style.color = risk.color;
    }
    if (desc) desc.innerText = risk.description;
    if (banner) {
        banner.style.borderColor = risk.color + '40';
        banner.style.background = risk.color + '08';
    }
}

function renderYieldCurveChart(yields, fedFunds) {
    const canvas = document.getElementById('yieldCurveChart');
    if (!canvas) return;

    const maturities = ['3M', '2Y', '5Y', '10Y', '30Y'];
    const labels = ['3-Month', '2-Year', '5-Year', '10-Year', '30-Year'];

    const currentValues = maturities.map(m => yields[m]?.yield ?? null);
    const historicalValues = maturities.map(m => yields[m]?.yieldOneYearAgo ?? null);
    const hasHistorical = historicalValues.some(v => v !== null);

    const y3m = yields['3M']?.yield;
    const y30 = yields['30Y']?.yield;
    const isInverted = (y3m != null && y30 != null && y3m > y30);
    const curveColor = isInverted ? '#ef4444' : '#06b6d4';
    
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, isInverted ? 'rgba(239, 68, 68, 0.4)' : 'rgba(6, 182, 212, 0.4)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    const curveFill = gradient;

    const datasets = [
        {
            label: 'Current Yield Curve',
            data: currentValues,
            borderColor: curveColor,
            backgroundColor: curveFill,
            tension: 0.4,
            fill: true,
            pointRadius: 6,
            pointHoverRadius: 9,
            pointBackgroundColor: curveColor,
            pointBorderColor: '#0d1326',
            pointBorderWidth: 2,
            borderWidth: 3,
        },
    ];

    if (hasHistorical) {
        datasets.push({
            label: '1 Year Ago',
            data: historicalValues,
            borderColor: '#64748b',
            backgroundColor: 'transparent',
            tension: 0.4,
            fill: false,
            borderDash: [6, 4],
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#64748b',
            pointBorderColor: '#0d1326',
            pointBorderWidth: 1,
            borderWidth: 2,
        });
    }

    // Fed Funds Rate as a flat reference line dataset
    if (fedFunds && fedFunds.rate != null) {
        datasets.push({
            label: `Fed Funds Rate (${fedFunds.rate.toFixed(2)}%)`,
            data: labels.map(() => fedFunds.rate),
            borderColor: '#f59e0b',
            backgroundColor: 'transparent',
            borderDash: [8, 4],
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 0,
            fill: false,
        });
    }

    if (yieldCurveChartInstance) yieldCurveChartInstance.destroy();

    yieldCurveChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 10, right: 14, left: 8, bottom: 10 } },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#8f9bb3', usePointStyle: true, pointStyle: 'circle', padding: 16 },
                },
                tooltip: {
                    backgroundColor: 'rgba(13, 19, 38, 0.95)',
                    titleColor: '#94a3b8',
                    bodyColor: '#f8fafc',
                    borderColor: 'rgba(6, 182, 212, 0.3)',
                    borderWidth: 1,
                    padding: 14,
                    cornerRadius: 10,
                    displayColors: true,
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + '%' : 'N/A'}`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#64748b', font: { size: 12, weight: '500' } },
                },
                y: {
                    title: { display: true, text: 'Yield (%)', color: '#64748b', font: { weight: '500' } },
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#64748b', callback: (val) => val.toFixed(1) + '%' },
                },
            },
        },
    });
}

// ── Spread History Chart ───────────────────────────────────────────────────────
async function loadSpreadHistory() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/yields/spread-history`);
        const payload = await res.json();

        if (!payload.data || payload.data.length === 0) {
            const container = document.getElementById('spread-history-container');
            if (container) container.innerHTML = '<p style="color: var(--text-secondary-muted); text-align: center; padding: 30px;">Historical spread data unavailable.</p>';
            return;
        }

        renderSpreadHistoryChart(payload.data);
    } catch (err) {
        console.warn('Spread history load error:', err);
    }
}

function renderSpreadHistoryChart(spreadData) {
    const canvas = document.getElementById('spreadHistoryChart');
    if (!canvas) return;

    const reversed = [...spreadData].reverse();
    const labels = reversed.map(d => d.date);
    const values = reversed.map(d => d.spread);

    if (spreadHistoryChartInstance) spreadHistoryChartInstance.destroy();

    spreadHistoryChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: '10Y - 2Y Spread',
                    data: values,
                    borderColor: '#06b6d4',
                    segment: {
                        borderColor: (ctx) => (ctx.p0.parsed.y < 0 || ctx.p1.parsed.y < 0) ? '#ef4444' : '#10b981',
                    },
                    backgroundColor: 'transparent',
                    tension: 0.2,
                    fill: false,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                },
                {
                    label: '',
                    data: labels.map(() => 0),
                    borderColor: 'rgba(245, 158, 11, 0.5)',
                    backgroundColor: 'transparent',
                    borderDash: [6, 4],
                    borderWidth: 1.5,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    fill: false,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 10, right: 14, left: 8, bottom: 10 } },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(13, 19, 38, 0.95)',
                    titleColor: '#94a3b8',
                    bodyColor: '#f8fafc',
                    borderColor: 'rgba(6, 182, 212, 0.3)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 10,
                    filter: (item) => item.dataset.label !== '',
                    callbacks: {
                        title: (items) => items[0]?.label || '',
                        label: (ctx) => ` Spread: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + '%' : 'N/A'}`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#64748b', maxTicksLimit: 8, font: { size: 11 } },
                },
                y: {
                    title: { display: true, text: 'Spread (%)', color: '#64748b', font: { weight: '500' } },
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#64748b', callback: (val) => val.toFixed(1) + '%' },
                },
            },
        },
    });
}

async function fetchYieldAnalysis(payload) {
    const analysisDisplay = document.getElementById('yields-analysis-display');
    if (!analysisDisplay) return;

    const y = payload.yields;
    const s = payload.spreads;

    try {
        const params = new URLSearchParams({
            spread10y2y: s['10Y2Y'] ?? '',
            spread10y3m: s['10Y3M'] ?? '',
            risk: payload.recessionRisk?.level ?? '',
            y3m: y['3M']?.yield?.toFixed(2) ?? '',
            y2y: y['2Y']?.yield?.toFixed(2) ?? '',
            y10y: y['10Y']?.yield?.toFixed(2) ?? '',
            y30y: y['30Y']?.yield?.toFixed(2) ?? '',
            fedrate: payload.fedFundsRate?.rate?.toFixed(2) ?? '',
        });

        const res = await fetch(`${BACKEND_URL}/api/yields/analysis?${params}`);
        const data = await res.json();

        if (data.analysis) {
            analysisDisplay.innerText = data.analysis;
        } else {
            analysisDisplay.innerText = 'Analysis unavailable.';
        }
    } catch (err) {
        analysisDisplay.innerText = 'Failed to load yield curve analysis due to a network error.';
    }
}

// ── Economic Calendar ───────────────────────────────────────────────────────────
async function loadEconomicCalendar() {
    const container = document.getElementById('econ-calendar-body');
    if (!container) return;

    try {
        const res = await fetch(`${BACKEND_URL}/api/yields/calendar`);
        const data = await res.json();

        if (!data.events || data.events.length === 0) {
            container.innerHTML = '<p style="color: var(--text-secondary-muted); text-align: center; padding: 20px 0;">No upcoming economic events found.</p>';
            return;
        }

        renderCalendarTable(container, data.events);
    } catch (err) {
        console.warn('Economic calendar error:', err);
        container.innerHTML = '<p style="color: var(--text-secondary-muted); text-align: center; padding: 20px 0;">Economic calendar unavailable.</p>';
    }
}

function renderCalendarTable(container, events) {
    const impactBadge = (impact) => {
        if (impact === 'high') return '<span class="econ-badge econ-badge-high">🔴 HIGH</span>';
        if (impact === 'medium') return '<span class="econ-badge econ-badge-med">🟡 MED</span>';
        return '<span class="econ-badge econ-badge-low">LOW</span>';
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '—';
        try {
            const d = new Date(dateStr + 'T00:00:00');
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } catch { return dateStr; }
    };

    let html = `<table class="econ-calendar-table">
        <thead><tr>
            <th>Date</th>
            <th>Event</th>
            <th>Impact</th>
            <th>Category</th>
            <th>Source</th>
        </tr></thead><tbody>`;

    for (const e of events) {
        html += `<tr>
            <td class="font-mono">${formatDate(e.date)}</td>
            <td>${e.event}</td>
            <td>${impactBadge(e.impact)}</td>
            <td><span style="text-transform: capitalize; font-size: 0.8rem; color: var(--text-secondary-muted);">${e.category.toLowerCase()}</span></td>
            <td style="font-size: 0.8rem; color: var(--text-secondary-muted);">${e.source}</td>
        </tr>`;
    }

    html += '</tbody></table>';
    container.innerHTML = html;
}

// ── Credit Spread Monitor ──────────────────────────────────────────────────────
async function loadCreditSpreads() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/yields/credit-spreads`);
        const data = await res.json();

        if (!data || data.error) {
            console.warn('Credit spread data unavailable:', data?.error);
            return;
        }

        // Populate current values
        const igEl = document.getElementById('credit-ig-spread');
        const hyEl = document.getElementById('credit-hy-spread');

        if (igEl && data.ig?.current != null) {
            igEl.innerText = `${data.ig.current.toFixed(2)}%`;
        }
        if (hyEl && data.hy?.current != null) {
            hyEl.innerText = `${data.hy.current.toFixed(2)}%`;
        }

        // Render chart
        if (data.ig?.history?.length && data.hy?.history?.length) {
            renderCreditSpreadChart(data.ig.history, data.hy.history);
        }
    } catch (err) {
        console.warn('Credit spread load error:', err);
    }
}

function renderCreditSpreadChart(igHistory, hyHistory) {
    const canvas = document.getElementById('creditSpreadChart');
    if (!canvas) return;

    const reversed_ig = [...igHistory].reverse();
    const reversed_hy = [...hyHistory].reverse();

    // Align dates from IG series (typically shorter)
    const labels = reversed_ig.map(d => d.date);
    const igValues = reversed_ig.map(d => d.value);

    // Map HY by date for alignment
    const hyMap = {};
    for (const d of reversed_hy) hyMap[d.date] = d.value;
    const hyValues = labels.map(date => hyMap[date] ?? null);

    if (creditSpreadChartInstance) creditSpreadChartInstance.destroy();

    creditSpreadChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'IG Spread (OAS)',
                    data: igValues,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.06)',
                    fill: true,
                    tension: 0.25,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                },
                {
                    label: 'HY Spread (OAS)',
                    data: hyValues,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.06)',
                    fill: true,
                    tension: 0.25,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 10, right: 14, left: 8, bottom: 10 } },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#8f9bb3', usePointStyle: true, pointStyle: 'circle', padding: 16 },
                },
                tooltip: {
                    backgroundColor: 'rgba(13, 19, 38, 0.95)',
                    titleColor: '#94a3b8',
                    bodyColor: '#f8fafc',
                    borderColor: 'rgba(6, 182, 212, 0.3)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 10,
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + '%' : 'N/A'}`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#64748b', maxTicksLimit: 8, font: { size: 11 } },
                },
                y: {
                    title: { display: true, text: 'Spread (%)', color: '#64748b', font: { weight: '500' } },
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#64748b', callback: (val) => val.toFixed(1) + '%' },
                },
            },
        },
    });
}

// ── Inflation Breakevens / TIPS Monitor ─────────────────────────────────────────
async function loadBreakevens() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/yields/breakevens`);
        const data = await res.json();

        if (!data || data.error) {
            console.warn('Breakeven data unavailable:', data?.error);
            return;
        }

        // Populate current values
        const beEl = document.getElementById('breakeven-rate');
        const realEl = document.getElementById('real-yield-rate');

        if (beEl && data.breakeven?.current != null) {
            beEl.innerText = `${data.breakeven.current.toFixed(2)}%`;
        }
        if (realEl && data.realYield?.current != null) {
            realEl.innerText = `${data.realYield.current.toFixed(2)}%`;
        }

        // Render chart
        if (data.history?.length) {
            renderBreakevenChart(data.history);
        }
    } catch (err) {
        console.warn('Breakeven load error:', err);
    }
}

function renderBreakevenChart(history) {
    const canvas = document.getElementById('breakevenChart');
    if (!canvas) return;

    const reversed = [...history].reverse();
    const labels = reversed.map(d => d.date);
    const nominalValues = reversed.map(d => d.nominal);
    const realValues = reversed.map(d => d.real);
    const beValues = reversed.map(d => d.breakeven);

    if (breakevenChartInstance) breakevenChartInstance.destroy();

    breakevenChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: '10Y Nominal Yield',
                    data: nominalValues,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'transparent',
                    tension: 0.25,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                    fill: false,
                },
                {
                    label: '10Y Real Yield (TIPS)',
                    data: realValues,
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.06)',
                    tension: 0.25,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                    fill: true,
                },
                {
                    label: '10Y Breakeven Inflation',
                    data: beValues,
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249, 115, 22, 0.06)',
                    tension: 0.25,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                    fill: true,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 10, right: 14, left: 8, bottom: 10 } },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#8f9bb3', usePointStyle: true, pointStyle: 'circle', padding: 16 },
                },
                tooltip: {
                    backgroundColor: 'rgba(13, 19, 38, 0.95)',
                    titleColor: '#94a3b8',
                    bodyColor: '#f8fafc',
                    borderColor: 'rgba(6, 182, 212, 0.3)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 10,
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + '%' : 'N/A'}`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#64748b', maxTicksLimit: 8, font: { size: 11 } },
                },
                y: {
                    title: { display: true, text: 'Yield / Rate (%)', color: '#64748b', font: { weight: '500' } },
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#64748b', callback: (val) => val.toFixed(1) + '%' },
                },
            },
        },
    });
}

// ── Duration & Convexity Calculator ─────────────────────────────────────────────
function setupDurationCalculator() {
    const inputs = ['bond-coupon-rate', 'bond-ytm', 'bond-maturity-years'];
    const update = () => {
        const faceValue = parseFloat(document.getElementById('bond-face-value')?.value) || 1000;
        const couponRate = parseFloat(document.getElementById('bond-coupon-rate')?.value) / 100 || 0;
        const ytm = parseFloat(document.getElementById('bond-ytm')?.value) / 100 || 0;
        const maturityYears = parseInt(document.getElementById('bond-maturity-years')?.value) || 10;
        const frequency = parseInt(document.getElementById('bond-frequency')?.value) || 2;
        const result = calculateDurationConvexity(faceValue, couponRate, ytm, maturityYears, frequency);
        displayDurationResults(result, faceValue, couponRate, ytm, maturityYears, frequency);
    };
    
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', update);
    });
    
    // Initial calculate
    setTimeout(update, 500);
}

function calculateDurationConvexity(faceValue, couponRate, ytm, maturityYears, frequency) {
    const periodsTotal = maturityYears * frequency;
    const couponPerPeriod = (couponRate * faceValue) / frequency;
    const yieldPerPeriod = ytm / frequency;

    if (yieldPerPeriod === 0) {
        // Edge case: zero yield — simplified calculation
        let price = couponPerPeriod * periodsTotal + faceValue;
        return {
            price,
            macaulayDuration: maturityYears,
            modifiedDuration: maturityYears,
            convexity: maturityYears * maturityYears,
        };
    }

    let price = 0;
    let macaulayNumerator = 0;
    let convexityNumerator = 0;

    for (let t = 1; t <= periodsTotal; t++) {
        const cf = (t === periodsTotal) ? couponPerPeriod + faceValue : couponPerPeriod;
        const discountFactor = Math.pow(1 + yieldPerPeriod, -t);
        const pvCf = cf * discountFactor;

        price += pvCf;
        macaulayNumerator += t * pvCf;
        convexityNumerator += t * (t + 1) * pvCf;
    }

    const macaulayDuration = (macaulayNumerator / price) / frequency; // in years
    const modifiedDuration = macaulayDuration / (1 + yieldPerPeriod);
    const convexity = (convexityNumerator / (price * Math.pow(1 + yieldPerPeriod, 2))) / (frequency * frequency);

    return { price, macaulayDuration, modifiedDuration, convexity };
}

function calculateBondPrice(faceValue, couponRate, ytm, maturityYears, frequency) {
    const periodsTotal = maturityYears * frequency;
    const couponPerPeriod = (couponRate * faceValue) / frequency;
    const yieldPerPeriod = ytm / frequency;

    if (yieldPerPeriod === 0) return couponPerPeriod * periodsTotal + faceValue;

    let price = 0;
    for (let t = 1; t <= periodsTotal; t++) {
        const cf = (t === periodsTotal) ? couponPerPeriod + faceValue : couponPerPeriod;
        price += cf / Math.pow(1 + yieldPerPeriod, t);
    }
    return price;
}

function displayDurationResults(result, faceValue, couponRate, ytm, maturityYears, frequency) {
    const panel = document.getElementById('duration-results');
    if (panel) panel.classList.remove('hidden-element');

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    };

    set('dur-bond-price', `$${result.price.toFixed(2)}`);
    set('dur-macaulay', `${result.macaulayDuration.toFixed(4)} yrs`);
    set('dur-modified', `${result.modifiedDuration.toFixed(4)}`);
    set('dur-convexity', `${result.convexity.toFixed(4)}`);

    // Rate shock scenarios
    const shocks = [0.0025, -0.0025, 0.01, -0.01];
    const shockIds = ['dur-shock-up25', 'dur-shock-dn25', 'dur-shock-up100', 'dur-shock-dn100'];

    for (let i = 0; i < shocks.length; i++) {
        const newYtm = ytm + shocks[i];
        const newPrice = calculateBondPrice(faceValue, couponRate, newYtm, maturityYears, frequency);
        const pctChange = ((newPrice - result.price) / result.price) * 100;
        const el = document.getElementById(shockIds[i]);
        if (el) {
            el.innerText = `$${newPrice.toFixed(2)} (${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%)`;
            el.style.color = pctChange >= 0 ? '#10b981' : '#ef4444';
        }
    }
}

// ── Yield Change Heatmap ───────────────────────────────────────────────────────
async function loadYieldHeatmap() {
    const container = document.getElementById('yield-heatmap-body');
    if (!container) return;
    try {
        const res = await fetch(`${BACKEND_URL}/api/yields/yield-heatmap`);
        const data = await res.json();
        if (!data.heatmap) throw new Error('No heatmap data');
        renderHeatmapTable(container, data.heatmap);
    } catch (err) {
        console.warn('Heatmap load error:', err);
        container.innerHTML = '<p style="color: var(--text-secondary-muted); text-align: center; padding: 20px 0;">Heatmap data unavailable.</p>';
    }
}

function renderHeatmapTable(container, heatmap) {
    const maturities = ['3M', '2Y', '5Y', '10Y', '30Y'];
    const periods = ['1D', '1W', '1M', '3M', 'YTD'];

    const cellColor = (bps) => {
        if (bps == null) return { bg: 'transparent', text: '#64748b' };
        const abs = Math.abs(bps);
        if (bps > 0) {
            const alpha = Math.min(abs / 80, 1) * 0.35;
            return { bg: `rgba(239, 68, 68, ${alpha.toFixed(2)})`, text: abs > 20 ? '#fca5a5' : '#ef4444' };
        } else {
            const alpha = Math.min(abs / 80, 1) * 0.35;
            return { bg: `rgba(16, 185, 129, ${alpha.toFixed(2)})`, text: abs > 20 ? '#6ee7b7' : '#10b981' };
        }
    };

    let html = `<table class="yield-heatmap-table tabular-nums">
        <thead><tr><th>Maturity</th><th>Current</th>`;
    for (const p of periods) html += `<th>${p}</th>`;
    html += '</tr></thead><tbody>';

    for (const mat of maturities) {
        const row = heatmap[mat];
        if (!row) continue;
        html += `<tr><td style="font-size: 0.85rem; font-weight: 600;">${mat}</td><td style="color: #f8fafc; font-size: 0.85rem;" class="font-mono tabular-nums">${row.current != null ? row.current.toFixed(2) + '%' : 'N/A'}</td>`;
        for (const p of periods) {
            const bps = row.changes?.[p];
            const { bg, text } = cellColor(bps);
            const display = bps != null ? `${bps > 0 ? '+' : ''}${bps}` : '—';
            html += `<td><span class="heatmap-cell font-mono tabular-nums" style="font-size: 0.85rem;" style="background: ${bg}; color: ${text};">${display}</span></td>`;
        }
        html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

// ── Curve Butterfly Spread ────────────────────────────────────────────────────
function populateButterfly(yields) {
    const y2 = yields['2Y']?.yield;
    const y5 = yields['5Y']?.yield;
    const y10 = yields['10Y']?.yield;
    const y30 = yields['30Y']?.yield;

    // Butterfly: 2*(5Y) - 2Y - 10Y
    const butterflyEl = document.getElementById('butterfly-value');
    if (butterflyEl && y2 != null && y5 != null && y10 != null) {
        const bfly = 2 * y5 - y2 - y10;
        const bps = Math.round(bfly * 100);
        butterflyEl.innerText = `${bps > 0 ? '+' : ''}${bps} bps`;
        butterflyEl.style.color = bps >= 0 ? '#10b981' : '#ef4444';
    }

    // Steepness: 30Y - 2Y
    const steepEl = document.getElementById('steepness-value');
    if (steepEl && y2 != null && y30 != null) {
        const steep = y30 - y2;
        steepEl.innerText = `${steep >= 0 ? '+' : ''}${steep.toFixed(2)}%`;
        steepEl.style.color = steep >= 0 ? '#10b981' : '#ef4444';
    }

    // Belly signal
    const bellyEl = document.getElementById('belly-signal');
    if (bellyEl && y2 != null && y5 != null && y10 != null) {
        const bfly = 2 * y5 - y2 - y10;
        const bps = Math.round(bfly * 100);
        if (bps > 10) {
            bellyEl.innerText = 'CHEAP';
            bellyEl.style.color = '#10b981';
        } else if (bps < -10) {
            bellyEl.innerText = 'RICH';
            bellyEl.style.color = '#ef4444';
        } else {
            bellyEl.innerText = 'FAIR';
            bellyEl.style.color = '#f59e0b';
        }
    }
}

// ── Mortgage Spread Tracker ──────────────────────────────────────────────────
async function loadMortgageSpread() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/yields/mortgage-spread`);
        const data = await res.json();
        if (!data || data.error) return;

        const mortEl = document.getElementById('mortgage-rate');
        const spreadEl = document.getElementById('mortgage-spread-value');

        if (mortEl && data.current?.mortgage != null) {
            mortEl.innerText = `${data.current.mortgage.toFixed(2)}%`;
        }
        if (spreadEl && data.current?.spread != null) {
            spreadEl.innerText = `${data.current.spread.toFixed(2)}%`;
            spreadEl.style.color = data.current.spread > 2.0 ? '#ef4444' : data.current.spread > 1.5 ? '#f59e0b' : '#10b981';
        }

        if (data.history?.length) {
            renderMortgageSpreadChart(data.history);
        }
    } catch (err) {
        console.warn('Mortgage spread load error:', err);
    }
}

function renderMortgageSpreadChart(history) {
    const canvas = document.getElementById('mortgageSpreadChart');
    if (!canvas) return;

    const reversed = [...history].reverse();
    const labels = reversed.map(d => d.date);
    const mortValues = reversed.map(d => d.mortgage);
    const trsyValues = reversed.map(d => d.treasury10y);
    const spreadValues = reversed.map(d => d.spread);

    if (mortgageSpreadChartInstance) mortgageSpreadChartInstance.destroy();

    mortgageSpreadChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: '30Y Mortgage Rate',
                    data: mortValues,
                    borderColor: '#a78bfa',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                    yAxisID: 'y',
                },
                {
                    label: '10Y Treasury',
                    data: trsyValues,
                    borderColor: '#06b6d4',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                    yAxisID: 'y',
                },
                {
                    label: 'Spread',
                    data: spreadValues,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.08)',
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                    fill: true,
                    yAxisID: 'y1',
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 10, right: 14, left: 8, bottom: 10 } },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#8f9bb3', usePointStyle: true, pointStyle: 'circle', padding: 16 },
                },
                tooltip: {
                    backgroundColor: 'rgba(13, 19, 38, 0.95)',
                    titleColor: '#94a3b8',
                    bodyColor: '#f8fafc',
                    borderColor: 'rgba(6, 182, 212, 0.3)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 10,
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + '%' : 'N/A'}`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#64748b', maxTicksLimit: 8, font: { size: 11 } },
                },
                y: {
                    position: 'left',
                    title: { display: true, text: 'Rate (%)', color: '#64748b', font: { weight: '500' } },
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#64748b', callback: (val) => val.toFixed(1) + '%' },
                },
                y1: {
                    position: 'right',
                    title: { display: true, text: 'Spread (%)', color: '#f59e0b', font: { weight: '500' } },
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#f59e0b', callback: (val) => val.toFixed(1) + '%' },
                },
            },
        },
    });
}
