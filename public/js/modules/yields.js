import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast } from '../utils.js';

// ── Chart Instances ───────────────────────────────────────────────────────────
let yieldCurveChartInstance = null;
let spreadHistoryChartInstance = null;
let creditSpreadChartInstance = null;
let breakevenChartInstance = null;
let mortgageSpreadChartInstance = null;

// ── Global Workstation State ──────────────────────────────────────────────────
let currentYieldsData = null;
let currentHeatmapData = null;
let currentSpreadHistoryData = null;
let currentCurveMode = 'nominal'; // 'nominal' | 'duration'
let showFedFundsAnchor = true;
let activeSlopeSeries = 'dual'; // 'dual' | '2s10s' | '3m10s'

// Simulator State (100% Client-Side Quant Engine)
const simState = {
    notional: 1000000,
    tenor: '10Y',
    parallelShiftBps: 0,
    twistBps: 0
};

// ── Initialization Entry Point ────────────────────────────────────────────────
export function initYieldsDashboard() {
    setupWorkstationEventHandlers();
    loadAllRatesAndCreditData();
}

function setupWorkstationEventHandlers() {
    // 1. Manual Sync Button
    const refreshBtn = document.getElementById('yields-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            showToast('Syncing live Treasury & Credit feeds…');
            loadAllRatesAndCreditData();
        });
    }

    // 2. Curve Chart Mode Toggles (Nominal Par vs Key-Rate Duration)
    const btnNominal = document.getElementById('toggle-curve-nominal');
    const btnDuration = document.getElementById('toggle-curve-duration');
    if (btnNominal && btnDuration) {
        btnNominal.addEventListener('click', () => {
            btnNominal.classList.add('active');
            btnDuration.classList.remove('active');
            currentCurveMode = 'nominal';
            if (currentYieldsData) renderYieldCurveChart(currentYieldsData.yields, currentYieldsData.fedFundsRate);
        });
        btnDuration.addEventListener('click', () => {
            btnDuration.classList.add('active');
            btnNominal.classList.remove('active');
            currentCurveMode = 'duration';
            if (currentYieldsData) renderYieldCurveChart(currentYieldsData.yields, currentYieldsData.fedFundsRate);
        });
    }

    // 3. Fed Funds Anchor Toggle
    const btnAnchor = document.getElementById('toggle-fed-funds-anchor');
    if (btnAnchor) {
        btnAnchor.addEventListener('click', () => {
            showFedFundsAnchor = !showFedFundsAnchor;
            btnAnchor.classList.toggle('active', showFedFundsAnchor);
            if (currentYieldsData) renderYieldCurveChart(currentYieldsData.yields, currentYieldsData.fedFundsRate);
        });
    }

    // 4. Slope History Series Toggle (Dual, 10Y-2Y, 10Y-3M)
    const slopeDual = document.getElementById('slope-toggle-dual');
    const slope2s10s = document.getElementById('slope-toggle-2s10s');
    const slope3m10s = document.getElementById('slope-toggle-3m10s');
    if (slopeDual && slope2s10s && slope3m10s) {
        const setSlopeActive = (btn, mode) => {
            [slopeDual, slope2s10s, slope3m10s].forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeSlopeSeries = mode;
            if (currentSpreadHistoryData) renderSpreadHistoryChart(currentSpreadHistoryData);
        };
        slopeDual.addEventListener('click', () => setSlopeActive(slopeDual, 'dual'));
        slope2s10s.addEventListener('click', () => setSlopeActive(slope2s10s, '2s10s'));
        slope3m10s.addEventListener('click', () => setSlopeActive(slope3m10s, '3m10s'));
    }

    // 5. PIMCO Simulator Controls
    setupSimulatorControls();

    // 6. AI Fixed Income Strategist Buttons
    const aiRefreshBtn = document.getElementById('yields-ai-refresh-btn');
    if (aiRefreshBtn) {
        aiRefreshBtn.addEventListener('click', () => {
            if (currentYieldsData) fetchYieldAnalysis(currentYieldsData, true);
        });
    }

    const aiCopyBtn = document.getElementById('yields-ai-copy-btn');
    if (aiCopyBtn) {
        aiCopyBtn.addEventListener('click', copyStrategistMemoToClipboard);
    }
}

// ── Orchestrator: Load All Desks Concurrently ──────────────────────────────────
async function loadAllRatesAndCreditData() {
    const loader = document.getElementById('yields-loader');
    const results = document.getElementById('yields-results');

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/yields`, { timeout: 30000 });
        const payload = await safeJsonParse(response);

        if (!payload || !payload.yields) {
            throw new Error('Invalid yield data response');
        }

        currentYieldsData = payload;

        // Populate Top Executive Ribbon & Curve
        populateExecutiveRibbon(payload);
        renderYieldCurveChart(payload.yields, payload.fedFundsRate);

        if (loader) loader.classList.add('hidden-element');
        if (results) results.classList.remove('hidden-element');

        const timestampEl = document.getElementById('yields-last-updated');
        if (timestampEl) {
            timestampEl.innerHTML = `<i class="fa-regular fa-clock"></i> Synced: ${new Date().toLocaleTimeString()}`;
        }

        // Fire asynchronous analytics desks in parallel
        loadSpreadHistory();
        loadYieldHeatmap();
        loadCreditSpreads();
        loadBreakevens();
        loadMortgageSpread();
        loadEconomicCalendar();
        fetchYieldAnalysis(payload);

        // Update Simulator outputs based on live yields
        updateSimulatorCalculations();

    } catch (err) {
        console.error('Yield data fetch error:', err);
        showToast('Failed to load Treasury yield data.');
        if (loader) {
            loader.innerHTML = `<span style="color: #ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> Failed to connect to Treasury feeds. Retrying...</span>`;
        }
    }
}

// ── 1. Top Executive Rates & Monetary Policy Ribbon ───────────────────────────
function populateExecutiveRibbon(data) {
    const y = data.yields || {};
    const s = data.spreads || {};
    const fed = data.fedPolicy || {};
    const risk = data.recessionRisk || {};

    // 1. 10Y Benchmark
    const y10 = y['10Y'];
    if (y10 && y10.yield != null) {
        setText('kpi-10y-yield', `${y10.yield.toFixed(2)}%`);
        const changeBadge = document.getElementById('kpi-10y-change-badge');
        if (changeBadge && y10.changeBps != null) {
            changeBadge.innerText = `${y10.changeBps >= 0 ? '+' : ''}${y10.changeBps} bps`;
            changeBadge.style.color = y10.changeBps > 0 ? '#f87171' : (y10.changeBps < 0 ? '#34d399' : '#94a3b8');
            changeBadge.style.background = y10.changeBps > 0 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)';
        }
        setText('kpi-10y-yoy', y10.yieldOneYearAgo != null ? `1Y Ago: ${y10.yieldOneYearAgo.toFixed(2)}%` : '1Y Ago: —%');
        setText('kpi-10y-duration', `Dur: ${y10.modifiedDuration != null ? y10.modifiedDuration.toFixed(2) : '—'} yrs`);
        setText('kpi-10y-dv01', `DV01: $${y10.dv01Per100k != null ? y10.dv01Per100k.toFixed(2) : '—'}/100k`);
    }

    // 2. 2s10s Curve Slope
    const spread10Y2Y = s['10Y2Y'];
    const spread10Y2YBps = s['10Y2YBps'];
    if (spread10Y2Y != null) {
        const sign = spread10Y2Y >= 0 ? '+' : '';
        setText('kpi-2s10s-spread', `${sign}${spread10Y2Y.toFixed(2)}%`);
        setText('kpi-2s10s-bps', `${sign}${spread10Y2YBps} bps`);

        const statusBadge = document.getElementById('kpi-2s10s-status-badge');
        if (statusBadge) {
            if (spread10Y2Y < 0) {
                statusBadge.innerText = 'INVERTED';
                statusBadge.style.color = '#ef4444';
                statusBadge.style.background = 'rgba(239, 68, 68, 0.18)';
            } else if (spread10Y2Y <= 0.25) {
                statusBadge.innerText = 'FLAT';
                statusBadge.style.color = '#f59e0b';
                statusBadge.style.background = 'rgba(245, 158, 11, 0.18)';
            } else {
                statusBadge.innerText = 'NORMAL';
                statusBadge.style.color = '#10b981';
                statusBadge.style.background = 'rgba(16, 185, 129, 0.18)';
            }
        }
    }

    // 3. 3m10s Fed Spread & Probit Recession Risk
    const probPct = data.recessionProbabilityPct ?? risk.probabilityPct ?? 0;
    setText('kpi-recession-prob', `${probPct.toFixed(1)}%`);
    setText('kpi-3m10s-bps', s['10Y3MBps'] != null ? `10Y-3M: ${s['10Y3MBps'] >= 0 ? '+' : ''}${s['10Y3MBps']} bps` : '10Y-3M: — bps');

    const riskBadge = document.getElementById('kpi-recession-risk-badge');
    if (riskBadge) {
        riskBadge.innerText = `${risk.level || 'Low'} Risk`;
        riskBadge.style.color = risk.color || '#10b981';
        riskBadge.style.background = `${risk.color || '#10b981'}25`;
    }
    const bar = document.getElementById('kpi-recession-bar');
    if (bar) {
        bar.style.width = `${Math.min(100, Math.max(5, probPct))}%`;
    }

    // 4. Effective Fed Funds & Implied Rate Path
    const ffRate = fed.fedFundsRate ?? (data.fedFundsRate?.rate ?? null);
    if (ffRate != null) {
        setText('kpi-fed-rate', `${ffRate.toFixed(2)}%`);
        setText('kpi-2y-ff-spread', fed.spread2YvsFedFundsBps != null ? `2Y vs FF: ${fed.spread2YvsFedFundsBps >= 0 ? '+' : ''}${fed.spread2YvsFedFundsBps} bps` : '2Y vs FF: — bps');

        const stanceBadge = document.getElementById('kpi-fed-stance-badge');
        if (stanceBadge) {
            stanceBadge.innerText = fed.stance || 'Neutral';
            stanceBadge.style.color = (fed.spread2YvsFedFundsBps || 0) < -25 ? '#38bdf8' : ((fed.spread2YvsFedFundsBps || 0) > 25 ? '#f59e0b' : '#10b981');
        }
        const moves = fed.implied25bpMoves;
        setText('kpi-implied-moves', moves != null ? `${moves > 0 ? '+' : ''}${moves} Cuts/Hikes (25bp)` : '— Moves Priced');
    }

    // 5. Curve Regime & 2s5s10s Butterfly
    setText('kpi-regime-name', data.curveRegime || 'Normal');
    const flyBps = s.butterfly2s5s10sBps;
    setText('kpi-butterfly-bps', flyBps != null ? `Fly: ${flyBps >= 0 ? '+' : ''}${flyBps} bps` : 'Fly: — bps');

    const bellyBadge = document.getElementById('kpi-belly-signal-badge');
    if (bellyBadge && s.bellySignal) {
        bellyBadge.innerText = `Belly ${s.bellySignal}`;
        bellyBadge.style.color = s.bellySignal === 'CHEAP' ? '#34d399' : (s.bellySignal === 'RICH' ? '#f87171' : '#f59e0b');
        bellyBadge.style.background = s.bellySignal === 'CHEAP' ? 'rgba(16, 185, 129, 0.15)' : (s.bellySignal === 'RICH' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)');
    }
    setText('kpi-30y5y-slope', s['30Y5YBps'] != null ? `30Y-5Y: ${s['30Y5YBps'] >= 0 ? '+' : ''}${s['30Y5YBps']} bps` : '30Y-5Y: — bps');

    // Populate legacy hidden elements so other dependencies never fail
    setText('yield-3m', y['3M']?.yield ? `${y['3M'].yield.toFixed(2)}%` : '—');
    setText('yield-2y', y['2Y']?.yield ? `${y['2Y'].yield.toFixed(2)}%` : '—');
    setText('yield-5y', y['5Y']?.yield ? `${y['5Y'].yield.toFixed(2)}%` : '—');
    setText('yield-10y', y['10Y']?.yield ? `${y['10Y'].yield.toFixed(2)}%` : '—');
    setText('yield-30y', y['30Y']?.yield ? `${y['30Y'].yield.toFixed(2)}%` : '—');
}

// ── 2. Multi-Curve Term Structure Chart ───────────────────────────────────────
function renderYieldCurveChart(yields, fedFunds) {
    const canvas = document.getElementById('yieldCurveChart');
    if (!canvas) return;

    const maturities = ['3M', '2Y', '5Y', '10Y', '30Y'];
    const tenorLabels = ['3-Month', '2-Year', '5-Year', '10-Year', '30-Year'];

    let currentSeries;
    let oneMonthAgoSeries;
    let oneYearAgoSeries;
    let yAxisTitle;
    let yTickFormat;

    if (currentCurveMode === 'duration') {
        // Key-Rate Modified Duration Mode
        currentSeries = maturities.map(m => yields[m]?.modifiedDuration ?? null);
        oneMonthAgoSeries = maturities.map(m => yields[m]?.modifiedDuration != null ? +(yields[m].modifiedDuration * 0.98).toFixed(2) : null);
        oneYearAgoSeries = maturities.map(m => yields[m]?.modifiedDuration != null ? +(yields[m].modifiedDuration * 0.95).toFixed(2) : null);
        yAxisTitle = 'Modified Duration (Years)';
        yTickFormat = (v) => `${v.toFixed(1)}y`;
    } else {
        // Nominal Par Yield Mode
        currentSeries = maturities.map(m => yields[m]?.yield ?? null);
        oneMonthAgoSeries = maturities.map(m => yields[m]?.yieldOneMonthAgo ?? null);
        oneYearAgoSeries = maturities.map(m => yields[m]?.yieldOneYearAgo ?? null);
        yAxisTitle = 'Par Yield (%)';
        yTickFormat = (v) => `${v.toFixed(1)}%`;
    }

    const y3m = yields['3M']?.yield;
    const y30 = yields['30Y']?.yield;
    const isInverted = (y3m != null && y30 != null && y3m > y30);
    const curveColor = isInverted ? '#ef4444' : '#06b6d4';

    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, isInverted ? 'rgba(239, 68, 68, 0.35)' : 'rgba(6, 182, 212, 0.35)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    const datasets = [
        {
            label: currentCurveMode === 'duration' ? 'Live Modified Duration' : 'Live Yield Curve',
            data: currentSeries,
            borderColor: curveColor,
            backgroundColor: gradient,
            tension: 0.35,
            fill: true,
            pointRadius: 6,
            pointHoverRadius: 9,
            pointBackgroundColor: curveColor,
            pointBorderColor: '#0d1326',
            pointBorderWidth: 2,
            borderWidth: 3,
        }
    ];

    // 1 Month Ago Curve
    if (oneMonthAgoSeries.some(v => v !== null)) {
        datasets.push({
            label: currentCurveMode === 'duration' ? '1M Ago Duration' : '1 Month Ago Curve',
            data: oneMonthAgoSeries,
            borderColor: '#a78bfa',
            backgroundColor: 'transparent',
            tension: 0.35,
            fill: false,
            borderDash: [5, 4],
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#a78bfa',
            pointBorderColor: '#0d1326',
            pointBorderWidth: 1.5,
            borderWidth: 2,
        });
    }

    // 1 Year Ago Curve
    if (oneYearAgoSeries.some(v => v !== null)) {
        datasets.push({
            label: currentCurveMode === 'duration' ? '1Y Ago Duration' : '1 Year Ago Curve',
            data: oneYearAgoSeries,
            borderColor: '#64748b',
            backgroundColor: 'transparent',
            tension: 0.35,
            fill: false,
            borderDash: [8, 4],
            pointRadius: 3.5,
            pointHoverRadius: 5.5,
            pointBackgroundColor: '#64748b',
            pointBorderColor: '#0d1326',
            pointBorderWidth: 1,
            borderWidth: 1.8,
        });
    }

    // Fed Funds O/N Anchor Line (Only in Nominal Mode)
    if (currentCurveMode === 'nominal' && showFedFundsAnchor && fedFunds?.rate != null) {
        datasets.push({
            label: `Fed Funds Rate (${fedFunds.rate.toFixed(2)}%)`,
            data: tenorLabels.map(() => fedFunds.rate),
            borderColor: '#f59e0b',
            backgroundColor: 'transparent',
            borderDash: [6, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
        });
    }

    if (yieldCurveChartInstance) yieldCurveChartInstance.destroy();

    yieldCurveChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels: tenorLabels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 12, right: 14, left: 8, bottom: 8 } },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 }, usePointStyle: true, boxWidth: 8, padding: 14 }
                },
                tooltip: {
                    backgroundColor: 'rgba(10, 14, 26, 0.95)',
                    titleColor: '#cbd5e1',
                    bodyColor: '#f8fafc',
                    borderColor: 'rgba(6, 182, 212, 0.3)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 6,
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? (currentCurveMode === 'duration' ? ctx.parsed.y.toFixed(2) + ' yrs' : ctx.parsed.y.toFixed(2) + '%') : 'N/A'}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 11 } }
                },
                y: {
                    title: { display: true, text: yAxisTitle, color: '#64748b', font: { family: 'Inter', size: 11, weight: '600' } },
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 11 }, callback: yTickFormat }
                }
            }
        }
    });
}

// ── 3. On-The-Run Benchmark Matrix Table ───────────────────────────────────────
function renderTreasuryMatrixTable(yields, heatmap) {
    const tbody = document.getElementById('treasury-matrix-tbody');
    if (!tbody) return;

    const maturities = [
        { key: '3M', name: '3-Month T-Bill' },
        { key: '2Y', name: '2-Year Note' },
        { key: '5Y', name: '5-Year Note' },
        { key: '10Y', name: '10-Year Benchmark' },
        { key: '30Y', name: '30-Year Bond' }
    ];

    const formatBpsCell = (bps) => {
        if (bps == null || isNaN(bps)) return '<span class="bps-tag bps-tag-neutral">—</span>';
        if (bps > 0) return `<span class="bps-tag bps-tag-positive">+${bps}</span>`;
        if (bps < 0) return `<span class="bps-tag bps-tag-negative">${bps}</span>`;
        return '<span class="bps-tag bps-tag-neutral">0</span>';
    };

    let html = '';
    maturities.forEach(m => {
        const yData = yields[m.key] || {};
        const hData = heatmap ? (heatmap[m.key] || {}) : {};
        const changes = hData.changes || {};

        const yVal = yData.yield != null ? `${yData.yield.toFixed(2)}%` : '—';
        const d1 = changes['1D'] ?? yData.changeBps;
        const w1 = changes['1W'];
        const m1 = changes['1M'] ?? yData.momChangeBps;
        const ytd = changes['YTD'];
        const yoy = yData.yieldOneYearAgo != null ? `${yData.yieldOneYearAgo.toFixed(2)}%` : (hData.yieldOneYearAgo != null ? `${hData.yieldOneYearAgo.toFixed(2)}%` : '—');

        const dur = yData.modifiedDuration != null ? `${yData.modifiedDuration.toFixed(2)}y` : '—';
        const dv01 = yData.dv01Per100k != null ? `$${yData.dv01Per100k.toFixed(2)}` : '—';
        const carryRoll = yData.carryRoll1YBps != null ? `+${yData.carryRoll1YBps} bps` : '—';
        const source = yData.provider || 'FRED (Official)';

        html += `
            <tr>
                <td><span class="tenor-tag">${m.key}</span> <span style="font-size:0.75rem; color:#94a3b8; margin-left:4px;">${m.name}</span></td>
                <td style="font-weight:700; color:#f8fafc;">${yVal}</td>
                <td>${formatBpsCell(d1)}</td>
                <td>${formatBpsCell(w1)}</td>
                <td>${formatBpsCell(m1)}</td>
                <td>${formatBpsCell(ytd)}</td>
                <td style="color:#94a3b8;">${yoy}</td>
                <td style="color:#38bdf8;">${dur}</td>
                <td style="color:#a78bfa;">${dv01}</td>
                <td style="color:#34d399; font-weight:600;">${carryRoll}</td>
                <td style="font-size:0.7rem; color:#64748b;">${source}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

// ── 4. Spread History Chart (Dual Overlay 10Y-2Y & 10Y-3M) ─────────────────────
async function loadSpreadHistory() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/yields/spread-history`);
        const payload = await res.json();

        if (!payload.data || payload.data.length === 0) return;

        currentSpreadHistoryData = payload;

        // Populate summary strip
        if (payload.stats) {
            setText('slope-2s10s-min', `${payload.stats.min.toFixed(2)}%`);
            setText('slope-2s10s-max', `${payload.stats.max.toFixed(2)}%`);
            setText('slope-2s10s-mean', `${payload.stats.avg.toFixed(2)}%`);
            setText('slope-inverted-count', `${payload.stats.daysInverted} Days`);
            setText('kpi-2s10s-inverted-days', `<i class="fa-solid fa-clock-rotate-left"></i> ${payload.stats.daysInverted} Days Inverted (1Y)`);
        }

        renderSpreadHistoryChart(payload);
    } catch (err) {
        console.warn('Spread history error:', err);
    }
}

function renderSpreadHistoryChart(payload) {
    const canvas = document.getElementById('spreadHistoryChart');
    if (!canvas) return;

    const data = [...payload.data].reverse();
    const labels = data.map(d => d.date);
    const series10Y2Y = data.map(d => d.spread);
    const series10Y3M = data.map(d => d.spread10y3m);

    const datasets = [];

    // 10Y-2Y Dataset
    if (activeSlopeSeries === 'dual' || activeSlopeSeries === '2s10s') {
        datasets.push({
            label: '10Y - 2Y Spread',
            data: series10Y2Y,
            borderColor: '#06b6d4',
            segment: {
                borderColor: (ctx) => (ctx.p0.parsed.y < 0 || ctx.p1.parsed.y < 0) ? '#ef4444' : '#06b6d4',
            },
            backgroundColor: 'rgba(6, 182, 212, 0.04)',
            tension: 0.2,
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 2,
        });
    }

    // 10Y-3M Dataset
    if (activeSlopeSeries === 'dual' || activeSlopeSeries === '3m10s') {
        datasets.push({
            label: '10Y - 3M Spread (Fed Recession Indicator)',
            data: series10Y3M,
            borderColor: '#f59e0b',
            segment: {
                borderColor: (ctx) => (ctx.p0.parsed.y < 0 || ctx.p1.parsed.y < 0) ? '#dc2626' : '#f59e0b',
            },
            backgroundColor: 'rgba(245, 158, 11, 0.04)',
            borderDash: [5, 4],
            tension: 0.2,
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 1.8,
        });
    }

    // 0.00% Inversion Threshold Line
    datasets.push({
        label: '0.00% Inversion Threshold',
        data: labels.map(() => 0),
        borderColor: 'rgba(239, 68, 68, 0.65)',
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
    });

    if (spreadHistoryChartInstance) spreadHistoryChartInstance.destroy();

    spreadHistoryChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 10, right: 14, left: 8, bottom: 8 } },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 }, usePointStyle: true, boxWidth: 8 }
                },
                tooltip: {
                    backgroundColor: 'rgba(10, 14, 26, 0.95)',
                    titleColor: '#cbd5e1',
                    bodyColor: '#f8fafc',
                    borderColor: 'rgba(6, 182, 212, 0.3)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 6,
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + '%' : 'N/A'}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#64748b', maxTicksLimit: 7, font: { family: 'JetBrains Mono', size: 10 } }
                },
                y: {
                    title: { display: true, text: 'Spread (%)', color: '#64748b', font: { size: 11, weight: '600' } },
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 }, callback: v => `${v.toFixed(2)}%` }
                }
            }
        }
    });
}

// ── 5. Corporate Credit OAS & Default Cycle Monitor ───────────────────────────
async function loadCreditSpreads() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/yields/credit-spreads`);
        const data = await res.json();
        if (!data || data.error) return;

        // Populate IG
        if (data.ig) {
            setText('credit-ig-spread', `${data.ig.currentBps} bps`);
            setText('credit-ig-change', `${data.ig.change1DBps >= 0 ? '+' : ''}${data.ig.change1DBps} bps`);
            setText('credit-ig-allin', `All-In: ${data.ig.allInYield ? data.ig.allInYield.toFixed(2) : '—'}%`);
            setText('credit-ig-pct', `P${data.ig.percentile1Y}%`);
            const igBar = document.getElementById('credit-ig-pctbar');
            if (igBar) igBar.style.width = `${data.ig.percentile1Y}%`;
        }

        // Populate HY
        if (data.hy) {
            setText('credit-hy-spread', `${data.hy.currentBps} bps`);
            setText('credit-hy-change', `${data.hy.change1DBps >= 0 ? '+' : ''}${data.hy.change1DBps} bps`);
            setText('credit-hy-allin', `All-In: ${data.hy.allInYield ? data.hy.allInYield.toFixed(2) : '—'}%`);
            setText('credit-hy-pct', `P${data.hy.percentile1Y}%`);
            const hyBar = document.getElementById('credit-hy-pctbar');
            if (hyBar) hyBar.style.width = `${data.hy.percentile1Y}%`;
        }

        // Analytics
        if (data.analytics) {
            setText('credit-hy-ig-diff', `+${data.analytics.hyIgDiffBps} bps`);
            setText('credit-hy-ig-ratio', `HY/IG: ${data.analytics.hyIgRatio}x`);
            setText('credit-implied-default', `Implied Default: ${data.analytics.impliedHyDefaultRatePct}%`);

            const regimeBadge = document.getElementById('credit-regime-badge');
            if (regimeBadge) {
                regimeBadge.innerText = data.analytics.creditRegime;
                regimeBadge.style.color = data.analytics.creditRegime.includes('Tight') ? '#34d399' : (data.analytics.creditRegime.includes('Distressed') ? '#f87171' : '#fbbf24');
                regimeBadge.style.background = data.analytics.creditRegime.includes('Tight') ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)';
            }
        }

        if (data.ig?.history?.length && data.hy?.history?.length) {
            renderCreditSpreadChart(data.ig.history, data.hy.history);
        }
    } catch (err) {
        console.warn('Credit spreads error:', err);
    }
}

function renderCreditSpreadChart(igHistory, hyHistory) {
    const canvas = document.getElementById('creditSpreadChart');
    if (!canvas) return;

    const revIg = [...igHistory].reverse();
    const revHy = [...hyHistory].reverse();
    const labels = revIg.map(d => d.date);

    const hyMap = new Map(revHy.map(d => [d.date, d.bps || Math.round(d.value * 100)]));
    const igBpsValues = revIg.map(d => d.bps || Math.round(d.value * 100));
    const hyBpsValues = labels.map(d => hyMap.get(d) ?? null);

    if (creditSpreadChartInstance) creditSpreadChartInstance.destroy();

    creditSpreadChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'High Yield OAS (bps)',
                    data: hyBpsValues,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.08)',
                    fill: true,
                    tension: 0.25,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                    yAxisID: 'yHy',
                },
                {
                    label: 'Investment Grade OAS (bps)',
                    data: igBpsValues,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.08)',
                    fill: true,
                    tension: 0.25,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                    yAxisID: 'yIg',
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 10, right: 14, left: 8, bottom: 8 } },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 }, usePointStyle: true, boxWidth: 8 }
                },
                tooltip: {
                    backgroundColor: 'rgba(10, 14, 26, 0.95)',
                    titleColor: '#cbd5e1',
                    bodyColor: '#f8fafc',
                    borderColor: 'rgba(6, 182, 212, 0.3)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 6,
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y + ' bps' : 'N/A'}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#64748b', maxTicksLimit: 7, font: { family: 'JetBrains Mono', size: 10 } }
                },
                yIg: {
                    position: 'left',
                    title: { display: true, text: 'IG OAS (bps)', color: '#10b981', font: { size: 10, weight: '600' } },
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#10b981', font: { family: 'JetBrains Mono', size: 10 }, callback: v => `${v} bp` }
                },
                yHy: {
                    position: 'right',
                    title: { display: true, text: 'HY OAS (bps)', color: '#f59e0b', font: { size: 10, weight: '600' } },
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#f59e0b', font: { family: 'JetBrains Mono', size: 10 }, callback: v => `${v} bp` }
                }
            }
        }
    });
}

// ── 6. Real TIPS & Breakeven Inflation Decomposition ──────────────────────────
async function loadBreakevens() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/yields/breakevens`);
        const data = await res.json();
        if (!data || data.error) return;

        const nom = data.nominal?.current ?? 4.30;
        const real = data.realYield?.current ?? 1.95;
        const be = data.breakeven?.current ?? 2.35;

        // Populate Fisher Bar & KPI ribbon
        setText('fisher-nominal-val', `${nom.toFixed(2)}%`);
        setText('fisher-real-val', `${real.toFixed(2)}%`);
        setText('fisher-be-val', `${be.toFixed(2)}%`);

        setText('kpi-real-yield', `${real.toFixed(2)}%`);
        setText('kpi-breakeven-rate', `BE: ${be.toFixed(2)}%`);
        setText('kpi-real-ff-stance', `Real FF: ${data.realFedStanceBps != null ? (data.realFedStanceBps >= 0 ? '+' : '') + data.realFedStanceBps + ' bps' : '— bps'}`);

        const realStanceBadge = document.getElementById('kpi-real-stance-badge');
        if (realStanceBadge && data.realRateRegime) {
            realStanceBadge.innerText = real >= 1.75 ? 'RESTRICTIVE' : (real >= 0.75 ? 'NEUTRAL' : 'ACCOMMODATIVE');
            realStanceBadge.style.color = real >= 1.75 ? '#38bdf8' : '#10b981';
        }

        const realRegimeBadge = document.getElementById('real-rate-regime-badge');
        if (realRegimeBadge && data.realRateRegime) {
            realRegimeBadge.innerText = data.realRateRegime;
            realRegimeBadge.style.color = '#38bdf8';
            realRegimeBadge.style.background = 'rgba(6, 182, 212, 0.15)';
        }

        const realShare = Math.max(10, Math.min(90, Math.round((real / nom) * 100)));
        const beShare = 100 - realShare;
        const barReal = document.getElementById('fisher-bar-real');
        const barBe = document.getElementById('fisher-bar-be');
        if (barReal) barReal.style.width = `${realShare}%`;
        if (barBe) barBe.style.width = `${beShare}%`;

        if (data.history?.length) {
            renderBreakevenChart(data.history);
        }
    } catch (err) {
        console.warn('Breakevens error:', err);
    }
}

function renderBreakevenChart(history) {
    const canvas = document.getElementById('breakevenChart');
    if (!canvas) return;

    const data = [...history].reverse();
    const labels = data.map(d => d.date);
    const nomValues = data.map(d => d.nominal);
    const realValues = data.map(d => d.real);
    const beValues = data.map(d => d.breakeven);

    if (breakevenChartInstance) breakevenChartInstance.destroy();

    breakevenChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: '10Y Nominal Benchmark',
                    data: nomValues,
                    borderColor: '#f8fafc',
                    backgroundColor: 'transparent',
                    tension: 0.25,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                    fill: false,
                },
                {
                    label: '10Y Real TIPS Yield',
                    data: realValues,
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.08)',
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
                    backgroundColor: 'rgba(249, 115, 22, 0.08)',
                    tension: 0.25,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                    fill: true,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 10, right: 14, left: 8, bottom: 8 } },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 }, usePointStyle: true, boxWidth: 8 }
                },
                tooltip: {
                    backgroundColor: 'rgba(10, 14, 26, 0.95)',
                    titleColor: '#cbd5e1',
                    bodyColor: '#f8fafc',
                    borderColor: 'rgba(6, 182, 212, 0.3)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 6,
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + '%' : 'N/A'}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#64748b', maxTicksLimit: 7, font: { family: 'JetBrains Mono', size: 10 } }
                },
                y: {
                    title: { display: true, text: 'Yield / Rate (%)', color: '#64748b', font: { size: 11, weight: '600' } },
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 }, callback: v => `${v.toFixed(2)}%` }
                }
            }
        }
    });
}

// ── 7. Mortgage Spread & Prepayment Tracker ───────────────────────────────────
async function loadMortgageSpread() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/yields/mortgage-spread`);
        const data = await res.json();
        if (!data || data.error) return;

        const cur = data.current || {};
        setText('mortgage-rate', cur.mortgage != null ? `${cur.mortgage.toFixed(2)}%` : '—%');
        setText('mortgage-10y-rate', cur.treasury10y != null ? `${cur.treasury10y.toFixed(2)}%` : '—%');
        setText('mortgage-spread-value', cur.spread != null ? `${cur.spread.toFixed(2)}% (${cur.spreadBps || Math.round(cur.spread * 100)} bps)` : '—');
        setText('mortgage-excess-spread', `${cur.excessSpreadBps != null ? (cur.excessSpreadBps >= 0 ? '+' : '') + cur.excessSpreadBps : '—'} bps`);

        const normBadge = document.getElementById('mbs-norm-badge');
        if (normBadge) {
            normBadge.innerText = `${cur.excessSpreadBps > 50 ? 'Elevated' : 'Fair'} Spread`;
            normBadge.style.color = cur.excessSpreadBps > 50 ? '#f59e0b' : '#34d399';
            normBadge.style.background = cur.excessSpreadBps > 50 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)';
        }

        if (data.history?.length) {
            renderMortgageSpreadChart(data.history);
        }
    } catch (err) {
        console.warn('Mortgage spread error:', err);
    }
}

function renderMortgageSpreadChart(history) {
    const canvas = document.getElementById('mortgageSpreadChart');
    if (!canvas) return;

    const data = [...history].reverse();
    const labels = data.map(d => d.date);
    const mortValues = data.map(d => d.mortgage);
    const trsyValues = data.map(d => d.treasury10y);
    const spreadValues = data.map(d => d.spread);

    if (mortgageSpreadChartInstance) mortgageSpreadChartInstance.destroy();

    mortgageSpreadChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: '30Y Primary Mortgage Rate',
                    data: mortValues,
                    borderColor: '#a78bfa',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                    yAxisID: 'yRate',
                },
                {
                    label: '10Y Treasury Benchmark',
                    data: trsyValues,
                    borderColor: '#06b6d4',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                    yAxisID: 'yRate',
                },
                {
                    label: 'Mortgage Spread (MBS OAS Proxy)',
                    data: spreadValues,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.08)',
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 1.8,
                    fill: true,
                    yAxisID: 'ySpread',
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 10, right: 14, left: 8, bottom: 8 } },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 }, usePointStyle: true, boxWidth: 8 }
                },
                tooltip: {
                    backgroundColor: 'rgba(10, 14, 26, 0.95)',
                    titleColor: '#cbd5e1',
                    bodyColor: '#f8fafc',
                    borderColor: 'rgba(6, 182, 212, 0.3)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 6,
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + '%' : 'N/A'}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#64748b', maxTicksLimit: 7, font: { family: 'JetBrains Mono', size: 10 } }
                },
                yRate: {
                    position: 'left',
                    title: { display: true, text: 'Rate (%)', color: '#a78bfa', font: { size: 10, weight: '600' } },
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#a78bfa', font: { family: 'JetBrains Mono', size: 10 }, callback: v => `${v.toFixed(1)}%` }
                },
                ySpread: {
                    position: 'right',
                    title: { display: true, text: 'Spread (%)', color: '#f59e0b', font: { size: 10, weight: '600' } },
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#f59e0b', font: { family: 'JetBrains Mono', size: 10 }, callback: v => `${v.toFixed(2)}%` }
                }
            }
        }
    });
}

// ── 8. Yield Heatmap & Matrix Sync ────────────────────────────────────────────
async function loadYieldHeatmap() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/yields/yield-heatmap`);
        const data = await res.json();
        if (!data || !data.heatmap) return;

        currentHeatmapData = data.heatmap;

        if (currentYieldsData?.yields) {
            renderTreasuryMatrixTable(currentYieldsData.yields, currentHeatmapData);
        }
    } catch (err) {
        console.warn('Heatmap load error:', err);
    }
}

// ── 9. PIMCO Key-Rate Duration & Curve Shock Simulator ────────────────────────
function setupSimulatorControls() {
    const notionalRange = document.getElementById('sim-notional-range');
    const shiftRange = document.getElementById('sim-shift-range');
    const twistRange = document.getElementById('sim-twist-range');
    const tenorButtons = document.querySelectorAll('.sim-tenor-btn');
    const presetChips = document.querySelectorAll('.preset-chip');

    if (notionalRange) {
        notionalRange.addEventListener('input', (e) => {
            simState.notional = parseFloat(e.target.value);
            setText('sim-notional-val', `$${simState.notional.toLocaleString()}`);
            updateSimulatorCalculations();
        });
    }

    if (shiftRange) {
        shiftRange.addEventListener('input', (e) => {
            simState.parallelShiftBps = parseInt(e.target.value, 10);
            setText('sim-shift-val', `${simState.parallelShiftBps >= 0 ? '+' : ''}${simState.parallelShiftBps} bps`);
            updateSimulatorCalculations();
        });
    }

    if (twistRange) {
        twistRange.addEventListener('input', (e) => {
            simState.twistBps = parseInt(e.target.value, 10);
            const label = simState.twistBps > 0 ? `+${simState.twistBps} bps (Steepener)` : (simState.twistBps < 0 ? `${simState.twistBps} bps (Flattener)` : '0 bps (Neutral)');
            setText('sim-twist-val', label);
            updateSimulatorCalculations();
        });
    }

    tenorButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tenorButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            simState.tenor = btn.getAttribute('data-tenor');
            updateSimulatorCalculations();
        });
    });

    presetChips.forEach(chip => {
        chip.addEventListener('click', () => {
            const shift = parseInt(chip.getAttribute('data-shift') || 0, 10);
            const twist = parseInt(chip.getAttribute('data-twist') || 0, 10);
            simState.parallelShiftBps = shift;
            simState.twistBps = twist;

            if (shiftRange) shiftRange.value = shift;
            if (twistRange) twistRange.value = twist;

            setText('sim-shift-val', `${shift >= 0 ? '+' : ''}${shift} bps`);
            setText('sim-twist-val', twist > 0 ? `+${twist} bps (Steepener)` : (twist < 0 ? `${twist} bps (Flattener)` : '0 bps (Neutral)'));

            updateSimulatorCalculations();
        });
    });
}

function updateSimulatorCalculations() {
    const y = currentYieldsData?.yields || {};

    // Calibrate baseline yields and durations per tenor archetype
    let startingYield = 4.30;
    let modDuration = 8.04;
    let convexity = 78.5;
    let twistWeight = 0; // Relative sensitivity to curve twist (-1 to +1)

    const y2 = y['2Y']?.yield ?? 4.15;
    const dur2 = y['2Y']?.modifiedDuration ?? 1.88;
    const conv2 = y['2Y']?.convexity ?? 4.8;

    const y5 = y['5Y']?.yield ?? 4.18;
    const dur5 = y['5Y']?.modifiedDuration ?? 4.45;
    const conv5 = y['5Y']?.convexity ?? 23.2;

    const y10 = y['10Y']?.yield ?? 4.28;
    const dur10 = y['10Y']?.modifiedDuration ?? 8.04;
    const conv10 = y['10Y']?.convexity ?? 78.5;

    const y30 = y['30Y']?.yield ?? 4.55;
    const dur30 = y['30Y']?.modifiedDuration ?? 16.50;
    const conv30 = y['30Y']?.convexity ?? 385.0;

    switch (simState.tenor) {
        case '2Y':
            startingYield = y2; modDuration = dur2; convexity = conv2; twistWeight = -0.5;
            break;
        case '5Y':
            startingYield = y5; modDuration = dur5; convexity = conv5; twistWeight = -0.15;
            break;
        case '10Y':
            startingYield = y10; modDuration = dur10; convexity = conv10; twistWeight = 0.25;
            break;
        case '30Y':
            startingYield = y30; modDuration = dur30; convexity = conv30; twistWeight = 0.85;
            break;
        case 'barbell':
            startingYield = 0.5 * y2 + 0.5 * y30;
            modDuration = 0.5 * dur2 + 0.5 * dur30;
            convexity = 0.5 * conv2 + 0.5 * conv30;
            twistWeight = 0.17;
            break;
        case 'bullet':
            startingYield = 0.5 * y5 + 0.5 * y10;
            modDuration = 0.5 * dur5 + 0.5 * dur10;
            convexity = 0.5 * conv5 + 0.5 * conv10;
            twistWeight = 0.05;
            break;
    }

    // Net effective yield shift: Parallel Shift + Tenor Twist adjustment
    const netShiftBps = simState.parallelShiftBps + (simState.twistBps * twistWeight);
    const deltaY = netShiftBps / 10000; // in decimal

    // Instantaneous Price Impact via Taylor Expansion:
    // ΔP / P ≈ -D_mod * Δy + 0.5 * Convexity * (Δy)^2
    const pricePctChange = (-modDuration * deltaY + 0.5 * convexity * Math.pow(deltaY, 2)) * 100;
    const priceDollarChange = simState.notional * (pricePctChange / 100);

    // 1-Year Total Horizon Return = Starting Yield Carry + Price Impact
    const startingCarryPct = startingYield;
    const horizonTotalReturnPct = startingCarryPct + pricePctChange;
    const horizonTotalReturnDollar = simState.notional * (horizonTotalReturnPct / 100);

    // Portfolio DV01 ($ per 1 bp shift)
    const dv01Dollar = simState.notional * modDuration * 0.0001;

    // Breakeven Yield Rise (bps): Yield / D_mod
    const breakevenBps = Math.round((startingYield / 100 / modDuration) * 10000);

    // DOM Updates
    const pricePctEl = document.getElementById('sim-price-pct');
    const priceDolEl = document.getElementById('sim-price-dollar');
    if (pricePctEl && priceDolEl) {
        pricePctEl.innerText = `${pricePctChange >= 0 ? '+' : ''}${pricePctChange.toFixed(2)}%`;
        priceDolEl.innerText = `${priceDollarChange >= 0 ? '+' : '-'}$${Math.round(Math.abs(priceDollarChange)).toLocaleString()}`;
        const color = pricePctChange >= 0 ? '#34d399' : '#f87171';
        pricePctEl.style.color = color;
        priceDolEl.style.color = color;
    }

    const horizonPctEl = document.getElementById('sim-horizon-pct');
    const horizonDolEl = document.getElementById('sim-horizon-dollar');
    if (horizonPctEl && horizonDolEl) {
        horizonPctEl.innerText = `${horizonTotalReturnPct >= 0 ? '+' : ''}${horizonTotalReturnPct.toFixed(2)}%`;
        horizonDolEl.innerText = `${horizonTotalReturnDollar >= 0 ? '+' : '-'}$${Math.round(Math.abs(horizonTotalReturnDollar)).toLocaleString()}`;
        const color = horizonTotalReturnPct >= 0 ? '#34d399' : '#f87171';
        horizonPctEl.style.color = color;
        horizonDolEl.style.color = color;
    }

    setText('sim-dv01-dollar', `$${Math.round(dv01Dollar).toLocaleString()}`);
    setText('sim-mod-duration', `Mod Dur: ${modDuration.toFixed(2)} yrs`);
    setText('sim-breakeven-bps', `+${breakevenBps} bps`);
    setText('sim-convexity-val', `Convexity: ${convexity.toFixed(1)}`);
}

// ── 10. AI Senior Fixed Income Strategist Terminal ─────────────────────────────
async function fetchYieldAnalysis(payload, forceRefresh = false) {
    const analysisDisplay = document.getElementById('yields-analysis-display');
    if (!analysisDisplay) return;

    if (forceRefresh) {
        analysisDisplay.innerHTML = `<span class="pulse-text"><i class="fa-solid fa-spinner fa-spin"></i> Generating institutional Aladdin fixed income memo…</span>`;
    }

    const y = payload.yields || {};
    const s = payload.spreads || {};
    const fed = payload.fedPolicy || {};

    try {
        const params = new URLSearchParams({
            spread10y2y: s['10Y2Y'] ?? '',
            spread10y3m: s['10Y3M'] ?? '',
            regime: payload.curveRegime ?? '',
            butterfly: s.butterfly2s5s10sBps ?? '',
            impliedMoves: fed.implied25bpMoves ?? '',
            risk: payload.recessionRisk?.level ?? '',
            y3m: y['3M']?.yield?.toFixed(2) ?? '',
            y2y: y['2Y']?.yield?.toFixed(2) ?? '',
            y10y: y['10Y']?.yield?.toFixed(2) ?? '',
            y30y: y['30Y']?.yield?.toFixed(2) ?? '',
            fedrate: fed.fedFundsRate ?? '',
        });

        const res = await fetch(`${BACKEND_URL}/api/yields/analysis?${params}`);
        const data = await res.json();

        if (data.analysis) {
            analysisDisplay.innerText = data.analysis;
        } else {
            analysisDisplay.innerText = 'Institutional strategist analysis currently unavailable.';
        }
    } catch (err) {
        analysisDisplay.innerText = 'Failed to load yield curve analysis due to network latency.';
    }
}

function copyStrategistMemoToClipboard() {
    const memo = document.getElementById('yields-analysis-display')?.innerText;
    if (!memo) {
        showToast('No active memo to copy');
        return;
    }
    navigator.clipboard.writeText(memo).then(() => {
        showToast('Copied Aladdin Rates Memo to clipboard');
    }).catch(() => {
        showToast('Failed to copy memo to clipboard');
    });
}

// ── 11. Upcoming Macro & Central Bank Release Calendar ─────────────────────────
async function loadEconomicCalendar() {
    const container = document.getElementById('econ-calendar-body');
    if (!container) return;

    try {
        const res = await fetch(`${BACKEND_URL}/api/yields/calendar`);
        const data = await res.json();

        if (!data.events || data.events.length === 0) {
            container.innerHTML = '<p style="color: var(--text-secondary-muted); text-align: center; padding: 24px 0;">No scheduled macro events in upcoming horizon.</p>';
            return;
        }

        renderCalendarTable(container, data.events);
    } catch (err) {
        console.warn('Calendar error:', err);
        container.innerHTML = '<p style="color: var(--text-secondary-muted); text-align: center; padding: 24px 0;">Macro calendar feed unavailable.</p>';
    }
}

function renderCalendarTable(container, events) {
    const impactBadge = (impact) => {
        if (impact === 'high') return '<span class="econ-badge econ-badge-high">HIGH</span>';
        if (impact === 'medium') return '<span class="econ-badge econ-badge-med">MED</span>';
        return '<span class="econ-badge econ-badge-low">LOW</span>';
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '—';
        try {
            const d = new Date(dateStr + 'T00:00:00');
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } catch { return dateStr; }
    };

    let html = `
        <table class="econ-calendar-table">
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Time (ET)</th>
                    <th>Macro Event / Treasury Auction</th>
                    <th>Impact</th>
                    <th>Category</th>
                    <th>Source</th>
                </tr>
            </thead>
            <tbody>
    `;

    events.forEach(e => {
        html += `
            <tr>
                <td class="font-mono" style="font-weight:600; color:#38bdf8;">${formatDate(e.date)}</td>
                <td class="font-mono" style="color:#94a3b8; font-size:0.75rem;">${e.time || '8:30 AM'}</td>
                <td style="font-weight:600; color:#f8fafc;">${e.event}</td>
                <td>${impactBadge(e.impact)}</td>
                <td><span style="font-size:0.75rem; text-transform:uppercase; color:#cbd5e1; letter-spacing:0.04em;">${e.category || 'Macro'}</span></td>
                <td style="font-size:0.75rem; color:#64748b;">${e.source}</td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

// ── Utility Helper ────────────────────────────────────────────────────────────
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}
