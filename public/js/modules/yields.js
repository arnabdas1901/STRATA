import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast } from '../utils.js';

let yieldCurveChartInstance = null;
let spreadHistoryChartInstance = null;

export function initYieldsDashboard() {
    loadYieldData();
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
    const curveFill = isInverted ? 'rgba(239, 68, 68, 0.08)' : 'rgba(6, 182, 212, 0.08)';

    const datasets = [
        {
            label: 'Current Yield Curve',
            data: currentValues,
            borderColor: curveColor,
            backgroundColor: curveFill,
            tension: 0.35,
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
            tension: 0.35,
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

    const formatVal = (val, unit) => {
        if (val == null || val === '') return '—';
        return `${val}${unit || ''}`;
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
            <th>Forecast</th>
            <th>Previous</th>
        </tr></thead><tbody>`;

    for (const e of events) {
        html += `<tr>
            <td class="font-mono">${formatDate(e.date)}</td>
            <td>${e.event}</td>
            <td>${impactBadge(e.impact)}</td>
            <td class="font-mono">${formatVal(e.estimate, e.unit)}</td>
            <td class="font-mono">${formatVal(e.prev, e.unit)}</td>
        </tr>`;
    }

    html += '</tbody></table>';
    container.innerHTML = html;
}
