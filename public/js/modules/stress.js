import { BACKEND_URL, safeJsonParse, showToast } from '../utils.js';

// ─── Chart Instances ────────────────────────────────────────────────
let drawdownChartInstance = null;
let monteCarloChartInstance = null;
let comparisonChartInstance = null;
let tailRiskChartInstance = null;

// ─── Asset Classes (mirrored from portfolio.js for independence) ────
const ASSET_CLASSES = {
    usLargeCap: { name: 'US Large Cap',    ticker: 'VOO', annualReturn: 0.10, annualVol: 0.15, color: '#2563eb' },
    intlDev:    { name: 'Intl Developed',   ticker: 'VEA', annualReturn: 0.07, annualVol: 0.16, color: '#3b82f6' },
    emerging:   { name: 'Emerging Markets', ticker: 'VWO', annualReturn: 0.08, annualVol: 0.22, color: '#60a5fa' },
    govBonds:   { name: 'Government Bonds', ticker: 'TLT', annualReturn: 0.04, annualVol: 0.10, color: '#64748b' },
    corpBonds:  { name: 'Corporate Bonds',  ticker: 'LQD', annualReturn: 0.05, annualVol: 0.07, color: '#94a3b8' },
    gold:       { name: 'Gold',             ticker: 'GLD', annualReturn: 0.06, annualVol: 0.14, color: '#f59e0b' }
};

const ASSET_KEYS = Object.keys(ASSET_CLASSES);

// ─── Historical Scenarios (real-world peak-to-trough drawdowns) ─────
const HISTORICAL_SCENARIOS = {
    gfc2008: {
        name: '2008 Global Financial Crisis',
        period: 'Oct 2007 – Mar 2009 (17 months)',
        description: 'Subprime mortgage collapse and Lehman Brothers bankruptcy. S&P 500 fell 51% peak-to-trough, credit markets froze globally.',
        shocks: { usLargeCap: -0.51, intlDev: -0.56, emerging: -0.53, govBonds: 0.06, corpBonds: -0.04, gold: 0.04 },
        recoveryMonths: 49,
        icon: '📉'
    },
    covid2020: {
        name: '2020 COVID-19 Crash',
        period: 'Feb 2020 – Mar 2020 (33 days)',
        description: 'The fastest bear market in history. Global lockdowns triggered a 34% S&P 500 decline in just 23 trading days.',
        shocks: { usLargeCap: -0.34, intlDev: -0.33, emerging: -0.31, govBonds: 0.08, corpBonds: -0.13, gold: -0.03 },
        recoveryMonths: 5,
        icon: '🦠'
    },
    dotcom2000: {
        name: '2000 Dot-Com Bubble Burst',
        period: 'Mar 2000 – Oct 2002 (30 months)',
        description: 'Collapse of internet stocks after speculative mania. NASDAQ fell 78%, S&P 500 lost 49% over 2.5 years.',
        shocks: { usLargeCap: -0.49, intlDev: -0.48, emerging: -0.28, govBonds: 0.12, corpBonds: 0.09, gold: -0.06 },
        recoveryMonths: 56,
        icon: '💥'
    },
    rateShock2022: {
        name: '2022 Rate Hike Shock',
        period: 'Jan 2022 – Oct 2022 (10 months)',
        description: 'Aggressive Fed rate hikes crushed both stocks and bonds simultaneously — a rare "nowhere to hide" environment.',
        shocks: { usLargeCap: -0.25, intlDev: -0.16, emerging: -0.20, govBonds: -0.31, corpBonds: -0.17, gold: -0.01 },
        recoveryMonths: 14,
        icon: '🏦'
    }
};

// ─── Correlation Matrix ─────────────────────────────────────────────
// Order: usLargeCap, intlDev, emerging, govBonds, corpBonds, gold
// Based on rolling 10-year correlations of monthly returns
const CORRELATION_MATRIX = [
    [ 1.00,  0.85,  0.75, -0.30,  0.35,  0.05],
    [ 0.85,  1.00,  0.80, -0.20,  0.30,  0.10],
    [ 0.75,  0.80,  1.00, -0.15,  0.25,  0.15],
    [-0.30, -0.20, -0.15,  1.00,  0.60,  0.30],
    [ 0.35,  0.30,  0.25,  0.60,  1.00,  0.15],
    [ 0.05,  0.10,  0.15,  0.30,  0.15,  1.00]
];

// ─── Linear Algebra Utilities ───────────────────────────────────────

function choleskyDecompose(matrix) {
    const n = matrix.length;
    const L = Array.from({ length: n }, () => new Array(n).fill(0));

    for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
            let sum = 0;
            for (let k = 0; k < j; k++) {
                sum += L[i][k] * L[j][k];
            }
            if (i === j) {
                const diag = matrix[i][i] - sum;
                L[i][j] = diag > 0 ? Math.sqrt(diag) : 0;
            } else {
                L[i][j] = L[j][j] !== 0 ? (matrix[i][j] - sum) / L[j][j] : 0;
            }
        }
    }
    return L;
}

// Precompute Cholesky factor (constant since correlation matrix is fixed)
const CHOLESKY_L = choleskyDecompose(CORRELATION_MATRIX);

function boxMullerRandom() {
    let u1;
    do { u1 = Math.random(); } while (u1 === 0);
    const u2 = Math.random();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

function generateCorrelatedNormals(choleskyL) {
    const n = choleskyL.length;
    const z = Array.from({ length: n }, () => boxMullerRandom());
    const correlated = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
            correlated[i] += choleskyL[i][j] * z[j];
        }
    }
    return correlated;
}

// ─── Portfolio Allocation Logic (mirrors portfolio.js) ──────────────

function calculateAllocations(age, risk) {
    let baseEquity = Math.max(0, Math.min(100, 110 - age));
    let equity = baseEquity;
    let fixedIncome = 100 - baseEquity;
    let metals = 0;

    if (risk === 'aggressive') {
        equity = Math.min(100, baseEquity + 15);
        fixedIncome = 100 - equity;
    } else if (risk === 'conservative') {
        equity = Math.max(0, baseEquity - 15);
        fixedIncome = 100 - equity;
    }

    if (risk === 'conservative') {
        metals = 10; fixedIncome -= 10;
    } else if (risk === 'moderate') {
        metals = 5; fixedIncome -= 5;
    } else {
        metals = 0;
    }

    if (fixedIncome < 0) fixedIncome = 0;

    const total = equity + fixedIncome + metals;
    equity = Math.round((equity / total) * 100);
    metals = Math.round((metals / total) * 100);
    fixedIncome = 100 - equity - metals;

    let eqUS = 0.70, eqIntl = 0.20, eqEM = 0.10;
    let fiGov = 0.60, fiCorp = 0.40;

    if (risk === 'aggressive') {
        eqUS = 0.60; eqIntl = 0.20; eqEM = 0.20;
        fiGov = 0.50; fiCorp = 0.50;
    } else if (risk === 'conservative') {
        eqUS = 0.80; eqIntl = 0.15; eqEM = 0.05;
        fiGov = 0.70; fiCorp = 0.30;
    }

    return {
        usLargeCap: equity * eqUS,
        intlDev: equity * eqIntl,
        emerging: equity * eqEM,
        govBonds: fixedIncome * fiGov,
        corpBonds: fixedIncome * fiCorp,
        gold: metals
    };
}

// ─── Historical Stress Test ─────────────────────────────────────────

function runHistoricalStressTest(allocations, capital, scenarioKey) {
    const scenario = HISTORICAL_SCENARIOS[scenarioKey];
    if (!scenario) return null;

    let totalImpact = 0;
    const assetImpacts = [];

    ASSET_KEYS.forEach(key => {
        const weight = (allocations[key] || 0) / 100;
        const shock = scenario.shocks[key] || 0;
        const dollarImpact = capital * weight * shock;
        totalImpact += dollarImpact;

        if (weight > 0.005) {
            assetImpacts.push({
                key,
                name: ASSET_CLASSES[key].name,
                weight: weight * 100,
                shock: shock * 100,
                dollarImpact,
                color: shock >= 0 ? '#10b981' : '#ef4444'
            });
        }
    });

    return {
        scenario,
        assetImpacts,
        totalImpact,
        stressedValue: capital + totalImpact,
        totalDrawdown: (totalImpact / capital) * 100,
        capital
    };
}

function runCustomStressTest(allocations, capital) {
    const customShocks = {};
    ASSET_KEYS.forEach(key => {
        const slider = document.getElementById(`shock-${key}`);
        customShocks[key] = slider ? parseFloat(slider.value) / 100 : 0;
    });

    let totalImpact = 0;
    const assetImpacts = [];

    ASSET_KEYS.forEach(key => {
        const weight = (allocations[key] || 0) / 100;
        const shock = customShocks[key];
        const dollarImpact = capital * weight * shock;
        totalImpact += dollarImpact;

        if (weight > 0.005) {
            assetImpacts.push({
                key,
                name: ASSET_CLASSES[key].name,
                weight: weight * 100,
                shock: shock * 100,
                dollarImpact,
                color: shock >= 0 ? '#10b981' : '#ef4444'
            });
        }
    });

    return {
        scenario: {
            name: 'Custom Shock Scenario',
            period: 'User-defined',
            description: 'Custom stress scenario with user-defined asset class shocks.',
            recoveryMonths: null,
            icon: '⚙️'
        },
        assetImpacts,
        totalImpact,
        stressedValue: capital + totalImpact,
        totalDrawdown: (totalImpact / capital) * 100,
        capital
    };
}

// ─── Monte Carlo Simulation ─────────────────────────────────────────

async function runMonteCarloSimulation(allocations, capital, years, numPaths, onProgress) {
    const months = years * 12;
    const weights = ASSET_KEYS.map(key => (allocations[key] || 0) / 100);
    const paths = [];

    for (let p = 0; p < numPaths; p++) {
        const path = [capital];
        let value = capital;

        for (let m = 0; m < months; m++) {
            const normals = generateCorrelatedNormals(CHOLESKY_L);
            let portfolioReturn = 0;

            for (let i = 0; i < ASSET_KEYS.length; i++) {
                const asset = ASSET_CLASSES[ASSET_KEYS[i]];
                const monthlyMean = asset.annualReturn / 12;
                const monthlyVol = asset.annualVol / Math.sqrt(12);
                const assetReturn = monthlyMean + monthlyVol * normals[i];
                portfolioReturn += weights[i] * assetReturn;
            }

            value = Math.max(0, value * (1 + portfolioReturn));
            path.push(value);
        }
        paths.push(path);

        if (p > 0 && p % 100 === 0) {
            if (onProgress) onProgress(p);
            // Yield execution to the browser main thread
            await new Promise(r => setTimeout(r, 0));
        }
    }

    // Calculate percentiles at each time step
    const pctiles = [5, 25, 50, 75, 95];
    const percentileData = {};
    pctiles.forEach(p => { percentileData[p] = []; });

    for (let m = 0; m <= months; m++) {
        const monthValues = paths.map(path => path[m]).sort((a, b) => a - b);
        const n = monthValues.length;
        pctiles.forEach(p => {
            const idx = Math.max(0, Math.min(Math.ceil((p / 100) * n) - 1, n - 1));
            percentileData[p].push(monthValues[idx]);
        });
    }

    return { paths, percentileData, months };
}

// ─── Risk Metrics ───────────────────────────────────────────────────

function calculateRiskMetrics(paths, capital, years, percentileData) {
    if (!paths || paths.length === 0) return null;
    const finalValues = paths.map(p => p[p.length - 1]).sort((a, b) => a - b);
    const n = finalValues.length;

    // Value at Risk (95% confidence)
    const varIdx = Math.max(0, Math.floor(0.05 * n));
    const var95Value = finalValues[varIdx];
    const var95 = ((capital - var95Value) / capital) * 100;

    // Conditional VaR (Expected Shortfall)
    const tailValues = finalValues.slice(0, varIdx + 1);
    const cvarValue = tailValues.length > 0
        ? tailValues.reduce((a, b) => a + b, 0) / tailValues.length
        : var95Value;
    const cvar = ((capital - cvarValue) / capital) * 100;

    // Max Drawdown on median trajectory
    const medianData = percentileData[50];
    let maxDrawdown = 0;
    let peak = medianData[0];
    for (let i = 1; i < medianData.length; i++) {
        if (medianData[i] > peak) peak = medianData[i];
        const dd = peak > 0 ? (peak - medianData[i]) / peak : 0;
        if (dd > maxDrawdown) maxDrawdown = dd;
    }

    // Annualized returns per path
    const annualReturns = paths.map(p => {
        const fv = p[p.length - 1];
        if (fv <= 0 || capital <= 0) return -1;
        return Math.pow(fv / capital, 1 / years) - 1;
    });

    const meanReturn = annualReturns.reduce((a, b) => a + b, 0) / n;
    const variance = annualReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    // Sharpe Ratio (risk-free = 4%)
    const rf = 0.04;
    const sharpe = stdDev > 0 ? (meanReturn - rf) / stdDev : 0;

    // Sortino Ratio (downside deviation)
    const downsideReturns = annualReturns.filter(r => r < rf);
    const downsideVariance = downsideReturns.length > 0
        ? downsideReturns.reduce((sum, r) => sum + Math.pow(r - rf, 2), 0) / downsideReturns.length
        : 0;
    const downsideDev = Math.sqrt(downsideVariance);
    const sortino = downsideDev > 0 ? (meanReturn - rf) / downsideDev : 0;

    // Median final value
    const medianFinal = finalValues[Math.floor(n / 2)];

    // Probability of loss
    const lossCount = finalValues.filter(v => v < capital).length;
    const probLoss = (lossCount / n) * 100;

    return {
        var95: Math.max(0, var95),
        cvar: Math.max(0, cvar),
        maxDrawdown: maxDrawdown * 100,
        sharpe,
        sortino,
        medianFinal,
        meanReturn: meanReturn * 100,
        probLoss,
        var95Value,
        cvarValue
    };
}

// ─── Currency Formatter ─────────────────────────────────────────────

function fmtCurrency(value) {
    if (value == null || isNaN(value)) return '$0';
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
    return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

// ─── Rendering: Allocation Chips ────────────────────────────────────

function renderAllocationChips(allocations) {
    const container = document.getElementById('stress-allocation-chips');
    if (!container) return;

    container.innerHTML = ASSET_KEYS
        .filter(key => allocations[key] > 0.5)
        .map(key => `<span class="stress-alloc-chip" style="border-color: ${ASSET_CLASSES[key].color}40">
            <span class="stress-chip-dot" style="background: ${ASSET_CLASSES[key].color}"></span>
            ${ASSET_CLASSES[key].name}: <strong>${allocations[key].toFixed(1)}%</strong>
        </span>`)
        .join('');
}

// ─── Rendering: Drawdown Waterfall Chart ────────────────────────────

function renderDrawdownWaterfall(stressResult) {
    const canvas = document.getElementById('stressDrawdownChart');
    if (!canvas) return;

    if (drawdownChartInstance) drawdownChartInstance.destroy();

    const labels = stressResult.assetImpacts.map(a => a.name);
    const data = stressResult.assetImpacts.map(a => a.dollarImpact);
    const colors = stressResult.assetImpacts.map(a =>
        a.dollarImpact >= 0 ? 'rgba(16, 185, 129, 0.75)' : 'rgba(239, 68, 68, 0.75)'
    );
    const borderColors = stressResult.assetImpacts.map(a =>
        a.dollarImpact >= 0 ? '#10b981' : '#ef4444'
    );

    drawdownChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Dollar Impact',
                data,
                backgroundColor: colors,
                borderColor: borderColors,
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(13, 19, 38, 0.95)',
                    borderColor: '#1e2d54',
                    borderWidth: 1,
                    titleColor: '#f8fafc',
                    bodyColor: '#e2e8f0',
                    padding: 12,
                    callbacks: {
                        label: (ctx) => {
                            const val = ctx.parsed.x;
                            const sign = val >= 0 ? '+' : '';
                            return ` Impact: ${sign}${fmtCurrency(val)}`;
                        },
                        afterLabel: (ctx) => {
                            const impact = stressResult.assetImpacts[ctx.dataIndex];
                            return ` Shock: ${impact.shock >= 0 ? '+' : ''}${impact.shock.toFixed(1)}% | Weight: ${impact.weight.toFixed(1)}%`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: {
                        color: '#94a3b8',
                        font: { size: 11 },
                        callback: (val) => {
                            const sign = val >= 0 ? '+' : '';
                            if (Math.abs(val) >= 1e6) return `${sign}$${(val / 1e6).toFixed(1)}M`;
                            if (Math.abs(val) >= 1e3) return `${sign}$${(val / 1e3).toFixed(0)}K`;
                            return `${sign}$${val}`;
                        }
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#e2e8f0', font: { size: 12, weight: 500 } }
                }
            }
        }
    });
}

// ─── Rendering: Monte Carlo Fan Chart ───────────────────────────────

function renderMonteCarloFanChart(percentileData, months, capital) {
    const canvas = document.getElementById('stressMonteCarloChart');
    if (!canvas) return;

    if (monteCarloChartInstance) monteCarloChartInstance.destroy();

    const labels = Array.from({ length: months + 1 }, (_, i) => {
        if (i === 0) return 'Start';
        if (i % 12 === 0) return `Yr ${i / 12}`;
        if (i % 6 === 0) return `M${i}`;
        return '';
    });

    // Extract final value of each percentile for legend tagging
    const val5 = percentileData[5][months];
    const val25 = percentileData[25][months];
    const val50 = percentileData[50][months];
    const val75 = percentileData[75][months];
    const val95 = percentileData[95][months];

    monteCarloChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: `Worst Case (5th Pctl): ${fmtCurrency(val5)}`,
                    data: percentileData[5],
                    borderColor: '#ef4444',
                    borderWidth: 1,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false,
                    tension: 0.2
                },
                {
                    label: `Downside (25th Pctl): ${fmtCurrency(val25)}`,
                    data: percentileData[25],
                    borderColor: 'rgba(239, 68, 68, 0.4)',
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: '-1',
                    tension: 0.2
                },
                {
                    label: `Median (50th Pctl): ${fmtCurrency(val50)}`,
                    data: percentileData[50],
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.06)',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    fill: '-1',
                    tension: 0.2
                },
                {
                    label: `Upside (75th Pctl): ${fmtCurrency(val75)}`,
                    data: percentileData[75],
                    borderColor: 'rgba(6, 182, 212, 0.5)',
                    backgroundColor: 'rgba(6, 182, 212, 0.06)',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: '-1',
                    tension: 0.2
                },
                {
                    label: `Best Case (95th Pctl): ${fmtCurrency(val95)}`,
                    data: percentileData[95],
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.08)',
                    borderWidth: 1,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: '-1',
                    tension: 0.2
                },
                {
                    label: `Initial Capital: ${fmtCurrency(capital)}`,
                    data: new Array(months + 1).fill(capital),
                    borderColor: 'rgba(255, 255, 255, 0.35)',
                    borderWidth: 1.5,
                    borderDash: [6, 6],
                    pointRadius: 0,
                    fill: false,
                    tension: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#e2e8f0',
                        padding: 14,
                        usePointStyle: true,
                        pointStyleWidth: 10,
                        boxWidth: 8,
                        font: { size: 11 }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(13, 19, 38, 0.95)',
                    borderColor: '#1e2d54',
                    borderWidth: 1,
                    titleColor: '#f8fafc',
                    bodyColor: '#e2e8f0',
                    padding: 12,
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label.split(':')[0]}: ${fmtCurrency(ctx.parsed.y)}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(30, 45, 84, 0.3)' },
                    ticks: { color: '#94a3b8', maxRotation: 0, font: { size: 11 } }
                },
                y: {
                    grid: { color: 'rgba(30, 45, 84, 0.3)' },
                    ticks: {
                        color: '#94a3b8',
                        font: { size: 11 },
                        callback: (val) => {
                            if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
                            if (Math.abs(val) >= 1e3) return `$${(val / 1e3).toFixed(0)}K`;
                            return `$${val}`;
                        }
                    }
                }
            }
        }
    });
}

// ─── Rendering: Scenario Metrics ────────────────────────────────────

function renderScenarioMetrics(stressResult) {
    const container = document.getElementById('stress-scenario-metrics');
    const descEl = document.getElementById('stress-scenario-desc');
    if (!container) return;

    const s = stressResult;
    const isLoss = s.totalDrawdown < 0;

    if (descEl) {
        descEl.innerHTML = `<strong>${s.scenario.icon} ${s.scenario.name}</strong> — ${s.scenario.period}<br><span style="color: var(--text-secondary-muted)">${s.scenario.description}</span>`;
    }

    let recoveryHtml = '';
    if (s.scenario.recoveryMonths !== null) {
        const yrs = Math.floor(s.scenario.recoveryMonths / 12);
        const mos = s.scenario.recoveryMonths % 12;
        const label = yrs > 0 ? `${yrs}y ${mos}m` : `${mos} months`;
        recoveryHtml = `
        <div class="metric-card">
            <span class="metric-title"><i class="fa-solid fa-clock-rotate-left"></i> Historical Recovery</span>
            <span class="metric-value">${label}</span>
        </div>`;
    }

    container.innerHTML = `
        <div class="metric-card ${isLoss ? 'metric-card-warning' : 'metric-card-success'}">
            <span class="metric-title"><i class="fa-solid fa-chart-line"></i> Portfolio Drawdown</span>
            <span class="metric-value" style="color: ${isLoss ? '#ef4444' : '#10b981'}">${s.totalDrawdown >= 0 ? '+' : ''}${s.totalDrawdown.toFixed(2)}%</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Starting Value</span>
            <span class="metric-value">${fmtCurrency(s.capital)}</span>
        </div>
        <div class="metric-card ${isLoss ? 'metric-card-warning' : 'metric-card-success'}">
            <span class="metric-title">Stressed Value</span>
            <span class="metric-value" style="color: ${isLoss ? '#ef4444' : '#10b981'}">${fmtCurrency(s.stressedValue)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Dollar Impact</span>
            <span class="metric-value" style="color: ${s.totalImpact >= 0 ? '#10b981' : '#ef4444'}">${s.totalImpact >= 0 ? '+' : ''}${fmtCurrency(s.totalImpact)}</span>
        </div>
        ${recoveryHtml}
    `;
}

// ─── Rendering: Risk Metrics Grid ───────────────────────────────────

function renderRiskMetrics(metrics) {
    const container = document.getElementById('stress-risk-metrics');
    if (!container) return;

    const varColor = metrics.var95 > 30 ? '#ef4444' : metrics.var95 > 15 ? '#f59e0b' : '#10b981';
    const ddColor = metrics.maxDrawdown > 40 ? '#ef4444' : metrics.maxDrawdown > 20 ? '#f59e0b' : '#10b981';
    const sharpeColor = metrics.sharpe >= 0.5 ? '#10b981' : metrics.sharpe >= 0 ? '#f59e0b' : '#ef4444';
    const sortinoColor = metrics.sortino >= 0.8 ? '#10b981' : metrics.sortino >= 0 ? '#f59e0b' : '#ef4444';
    const lossColor = metrics.probLoss > 50 ? '#ef4444' : metrics.probLoss > 30 ? '#f59e0b' : '#10b981';

    container.innerHTML = `
        <div class="metric-card">
            <span class="metric-title">Value at Risk (95%)</span>
            <span class="metric-value" style="color: ${varColor}">${metrics.var95.toFixed(2)}%</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Conditional VaR (CVaR)</span>
            <span class="metric-value" style="color: ${varColor}">${metrics.cvar.toFixed(2)}%</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Max Drawdown</span>
            <span class="metric-value" style="color: ${ddColor}">${metrics.maxDrawdown.toFixed(2)}%</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Sharpe Ratio</span>
            <span class="metric-value" style="color: ${sharpeColor}">${metrics.sharpe.toFixed(3)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Sortino Ratio</span>
            <span class="metric-value" style="color: ${sortinoColor}">${metrics.sortino.toFixed(3)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Probability of Loss</span>
            <span class="metric-value" style="color: ${lossColor}">${metrics.probLoss.toFixed(1)}%</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Median Final Value</span>
            <span class="metric-value" style="color: #06b6d4">${fmtCurrency(metrics.medianFinal)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Expected Annual Return</span>
            <span class="metric-value" style="color: ${metrics.meanReturn >= 0 ? '#10b981' : '#ef4444'}">${metrics.meanReturn >= 0 ? '+' : ''}${metrics.meanReturn.toFixed(2)}%</span>
        </div>
    `;
}

// ─── AI Risk Commentary ─────────────────────────────────────────────

async function fetchAiRiskCommentary(stressResult, riskMetrics, allocations, capital) {
    const commentaryEl = document.getElementById('stress-ai-commentary');
    if (!commentaryEl) return;

    commentaryEl.innerHTML = '<span class="pulse-text" style="color: var(--neon-cyan-vibrant);">Generating AI risk assessment...</span>';

    try {
        const payload = {
            scenario: stressResult.scenario.name,
            totalDrawdown: stressResult.totalDrawdown,
            stressedValue: stressResult.stressedValue,
            capital,
            allocations,
            riskMetrics: {
                var95: riskMetrics.var95,
                cvar: riskMetrics.cvar,
                maxDrawdown: riskMetrics.maxDrawdown,
                sharpe: riskMetrics.sharpe,
                sortino: riskMetrics.sortino,
                probLoss: riskMetrics.probLoss,
                meanReturn: riskMetrics.meanReturn
            }
        };

        const res = await fetch(`${BACKEND_URL}/api/stress/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await safeJsonParse(res);

        if (data?.analysis) {
            commentaryEl.innerHTML = `<div class="stress-ai-text">${formatAiText(data.analysis)}</div>`;
        } else {
            commentaryEl.innerHTML = '<span style="color: var(--text-secondary-muted);">AI risk assessment unavailable. Configure GROQ_API_KEY or GEMINI_API_KEY in .env</span>';
        }
    } catch (err) {
        console.warn('AI risk commentary error:', err);
        commentaryEl.innerHTML = '<span style="color: var(--text-secondary-muted);">AI risk assessment could not be generated.</span>';
    }
}

function formatAiText(text) {
    return text
        .replace(/### (.*)/g, '<h4 style="margin: 12px 0 6px; color: #f8fafc;">$1</h4>')
        .replace(/## (.*)/g, '<h3 style="margin: 14px 0 8px; color: #f8fafc;">$1</h3>')
        .replace(/\*\*(.*?)\*\*/g, '<strong style="color: #06b6d4;">$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

// ─── Custom Shock Inputs Generator ──────────────────────────────────

function updateCustomShockDisplay() {
    const capital = parseFloat(document.getElementById('stress-capital-input')?.value) || 100000;
    const age = parseInt(document.getElementById('stress-age-input')?.value) || 30;
    const risk = document.getElementById('stress-risk-input')?.value || 'moderate';
    const allocations = calculateAllocations(age, risk);

    ASSET_KEYS.forEach(key => {
        const slider = document.getElementById(`shock-${key}`);
        const display = document.getElementById(`shock-${key}-val`);
        if (slider && display) {
            const shock = parseFloat(slider.value);
            const weight = (allocations[key] || 0) / 100;
            const dollarImpact = capital * weight * (shock / 100);
            const sign = dollarImpact >= 0 ? '+' : '';
            display.innerHTML = `${shock}% <span class="shock-value-display" style="color: ${dollarImpact >= 0 ? '#10b981' : '#ef4444'}">(${sign}${fmtCurrency(dollarImpact)})</span>`;
        }
    });
}

function generateCustomShockInputs() {
    const container = document.getElementById('custom-shock-inputs');
    if (!container) return;

    const defaults = {
        usLargeCap: -40, intlDev: -35, emerging: -45,
        govBonds: 5, corpBonds: -5, gold: 5
    };

    container.innerHTML = ASSET_KEYS.map(key => {
        const asset = ASSET_CLASSES[key];
        const defaultVal = defaults[key] || 0;
        return `
            <div class="input-field-group" style="margin-top: 8px;">
                <label style="display: flex; justify-content: space-between;">
                    <span>${asset.name}</span>
                    <span id="shock-${key}-val" class="range-display-value" style="min-width: 48px; text-align: right;">${defaultVal}%</span>
                </label>
                <input type="range" id="shock-${key}" min="-80" max="30" step="1" value="${defaultVal}" class="shock-slider">
            </div>
        `;
    }).join('');

    // Append presets row
    const presetsDiv = document.createElement('div');
    presetsDiv.className = 'stress-presets-row';
    presetsDiv.innerHTML = `
        <span style="font-size: 0.8rem; color: var(--text-secondary-muted); width: 100%; display: block; margin-bottom: 4px;">Presets:</span>
        <button class="preset-badge" type="button" data-preset="mild">Mild Recession</button>
        <button class="preset-badge" type="button" data-preset="severe">Severe Crash</button>
        <button class="preset-badge" type="button" data-preset="stagflation">Stagflation</button>
    `;
    container.appendChild(presetsDiv);

    // Bind presets events
    const presetValues = {
        mild: { usLargeCap: -15, intlDev: -15, emerging: -15, govBonds: 5, corpBonds: 5, gold: 0 },
        severe: { usLargeCap: -50, intlDev: -50, emerging: -50, govBonds: -10, corpBonds: -10, gold: 0 },
        stagflation: { usLargeCap: -20, intlDev: -20, emerging: -20, govBonds: -15, corpBonds: -15, gold: 15 }
    };

    presetsDiv.querySelectorAll('.preset-badge').forEach(btn => {
        btn.addEventListener('click', () => {
            const p = presetValues[btn.getAttribute('data-preset')];
            if (p) {
                ASSET_KEYS.forEach(key => {
                    const slider = document.getElementById(`shock-${key}`);
                    if (slider) {
                        slider.value = p[key];
                    }
                });
                updateCustomShockDisplay();
            }
        });
    });

    // Wire change listeners
    ASSET_KEYS.forEach(key => {
        const slider = document.getElementById(`shock-${key}`);
        if (slider) {
            slider.addEventListener('input', updateCustomShockDisplay);
        }
    });

    // Initial update
    updateCustomShockDisplay();
}

// ─── Loader State & Stepper Helper ───────────────────────────────────

function updateLoaderState(percent, activeStepId, text) {
    const progressBar = document.getElementById('stress-progress-bar');
    const loaderText = document.getElementById('stress-loader-text');
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (loaderText) loaderText.textContent = text;

    const steps = ['step-alloc', 'step-stress', 'step-mc', 'step-risk'];
    steps.forEach(stepId => {
        const el = document.getElementById(stepId);
        if (el) {
            if (stepId === activeStepId) {
                el.className = 'stepper-item active';
            } else if (steps.indexOf(stepId) < steps.indexOf(activeStepId)) {
                el.className = 'stepper-item completed';
            } else {
                el.className = 'stepper-item';
            }
        }
    });
}

// ─── Portfolio Efficiency Score Helpers ──────────────────────────────

function calculateEfficiencyScore(metrics) {
    const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
    const normalize = (val, min, max) => clamp((val - min) / (max - min), 0, 1);

    const sharpeScore = normalize(metrics.sharpe, -0.5, 2.0);
    const sortinoScore = normalize(metrics.sortino, -0.5, 3.0);
    const varScore = 1 - normalize(metrics.var95, 0, 50);
    const lossScore = 1 - normalize(metrics.probLoss, 0, 100);

    const score = Math.round(100 * (0.25 * sharpeScore + 0.25 * sortinoScore + 0.25 * varScore + 0.25 * lossScore));
    return clamp(score, 0, 100);
}

function renderEfficiencyScore(score, metrics) {
    const progressCircle = document.getElementById('efficiency-progress-circle');
    const scoreVal = document.getElementById('efficiency-score-value');
    const verdictEl = document.getElementById('efficiency-score-verdict');

    if (scoreVal) scoreVal.textContent = score;

    if (progressCircle) {
        const offset = 314.159 * (1 - score / 100);
        progressCircle.style.strokeDashoffset = offset;

        // Set color thresholds
        let ringColor = 'var(--neon-cyan-vibrant)';
        if (score >= 70) {
            ringColor = '#10b981'; // Green
        } else if (score >= 40) {
            ringColor = '#f59e0b'; // Amber
        } else {
            ringColor = '#ef4444'; // Red
        }
        progressCircle.style.stroke = ringColor;
    }

    if (verdictEl) {
        let verdict = 'Critical';
        let color = '#ef4444';
        if (score >= 80) {
            verdict = 'Excellent';
            color = '#10b981';
        } else if (score >= 60) {
            verdict = 'Good';
            color = '#06b6d4';
        } else if (score >= 40) {
            verdict = 'Moderate';
            color = '#f59e0b';
        } else if (score >= 20) {
            verdict = 'Poor';
            color = '#f97316';
        }
        verdictEl.textContent = verdict;
        verdictEl.style.color = color;
    }

    // Set mini metric pills color-coded dots
    const thresholds = {
        sharpe: { val: metrics.sharpe, green: 0.5, red: 0 },
        sortino: { val: metrics.sortino, green: 0.8, red: 0 },
        var: { val: metrics.var95, green: 15, red: 30, invert: true },
        loss: { val: metrics.probLoss, green: 30, red: 50, invert: true }
    };

    const fmtMapping = {
        sharpe: metrics.sharpe.toFixed(3),
        sortino: metrics.sortino.toFixed(3),
        var: `${metrics.var95.toFixed(2)}%`,
        loss: `${metrics.probLoss.toFixed(1)}%`
    };

    Object.keys(thresholds).forEach(key => {
        const pill = document.querySelector(`.efficiency-metric-pill[data-metric="${key}"]`);
        const valueEl = document.getElementById(`eff-${key}`);
        if (valueEl) valueEl.textContent = fmtMapping[key];

        if (pill) {
            const dot = pill.querySelector('.pill-dot');
            if (dot) {
                const t = thresholds[key];
                let isGood = false;
                let isBad = false;
                if (t.invert) {
                    isGood = t.val <= t.green;
                    isBad = t.val >= t.red;
                } else {
                    isGood = t.val >= t.green;
                    isBad = t.val <= t.red;
                }

                if (isGood) {
                    dot.style.backgroundColor = '#10b981';
                } else if (isBad) {
                    dot.style.backgroundColor = '#ef4444';
                } else {
                    dot.style.backgroundColor = '#f59e0b';
                }
            }
        }
    });
}

// ─── Tail Risk Analysis Helpers ──────────────────────────────────────

function calculateTailMetrics(paths, capital) {
    const finalValues = paths.map(p => p[p.length - 1]);
    const n = finalValues.length;
    const mean = finalValues.reduce((a, b) => a + b, 0) / n;
    const variance = finalValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    let skewness = 0;
    if (stdDev > 0) {
        skewness = finalValues.reduce((sum, v) => sum + Math.pow((v - mean) / stdDev, 3), 0) / n;
    }

    let kurtosis = 0;
    if (variance > 0) {
        kurtosis = (finalValues.reduce((sum, v) => sum + Math.pow(v - mean, 4), 0) / n) / Math.pow(variance, 2) - 3;
    }

    const leftTailCount = finalValues.filter(v => v < capital * 0.5).length;
    const leftTailWeight = (leftTailCount / n) * 100;
    const worstLoss = Math.min(...finalValues);

    return { skewness, kurtosis, leftTailWeight, worstLoss };
}

function renderTailRiskAnalysis(tailMetrics, paths, capital) {
    const leftWeightEl = document.getElementById('tail-left-weight');
    const skewnessEl = document.getElementById('tail-skewness');
    const kurtosisEl = document.getElementById('tail-kurtosis');
    const worstLossEl = document.getElementById('tail-worst-loss');

    if (leftWeightEl) leftWeightEl.textContent = `${tailMetrics.leftTailWeight.toFixed(1)}%`;
    if (skewnessEl) {
        skewnessEl.textContent = tailMetrics.skewness.toFixed(3);
        skewnessEl.style.color = tailMetrics.skewness < 0 ? '#ef4444' : '#10b981';
    }
    if (kurtosisEl) {
        kurtosisEl.textContent = tailMetrics.kurtosis.toFixed(3);
        kurtosisEl.style.color = tailMetrics.kurtosis > 0 ? '#10b981' : '#94a3b8';
    }
    if (worstLossEl) worstLossEl.textContent = fmtCurrency(tailMetrics.worstLoss);

    renderTailRiskHistogram(paths, capital);
    renderWorstPathsTable(paths, capital);
}

function renderTailRiskHistogram(paths, capital) {
    const canvas = document.getElementById('stressTailRiskChart');
    if (!canvas) return;

    const finalValues = paths.map(p => p[p.length - 1]);
    const n = finalValues.length;
    const maxRange = capital * 2.5;
    const numBins = 15;
    const binWidth = maxRange / numBins;
    const binCounts = new Array(numBins).fill(0);

    finalValues.forEach(v => {
        const binIdx = Math.min(numBins - 1, Math.floor(v / binWidth));
        binCounts[binIdx]++;
    });

    const labels = binCounts.map((_, i) => {
        const low = i * binWidth;
        const high = (i + 1) * binWidth;
        return `${fmtCurrency(low)}-${fmtCurrency(high)}`;
    });

    const sortedValues = [...finalValues].sort((a, b) => a - b);
    const p5 = sortedValues[Math.max(0, Math.floor(0.05 * n))];
    const p95 = sortedValues[Math.max(0, Math.min(n - 1, Math.floor(0.95 * n)))];

    const colors = [];
    const borderColors = [];
    for (let i = 0; i < numBins; i++) {
        const binCenter = (i + 0.5) * binWidth;
        if (binCenter < p5) {
            colors.push('rgba(239, 68, 68, 0.75)');
            borderColors.push('#ef4444');
        } else if (binCenter > p95) {
            colors.push('rgba(16, 185, 129, 0.75)');
            borderColors.push('#10b981');
        } else {
            colors.push('rgba(6, 182, 212, 0.75)');
            borderColors.push('#06b6d4');
        }
    }

    if (tailRiskChartInstance) tailRiskChartInstance.destroy();

    tailRiskChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Frequency',
                data: binCounts,
                backgroundColor: colors,
                borderColor: borderColors,
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(13, 19, 38, 0.95)',
                    borderColor: '#1e2d54',
                    borderWidth: 1,
                    titleColor: '#f8fafc',
                    bodyColor: '#e2e8f0',
                    callbacks: {
                        label: (ctx) => ` Frequency: ${ctx.parsed.y} paths (${((ctx.parsed.y / n) * 100).toFixed(1)}%)`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8', font: { size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8', font: { size: 10 } }
                }
            }
        }
    });
}

function getWorstPathsAnalysis(paths, capital) {
    const worstPaths = paths
        .map((p, idx) => ({ path: p, index: idx }))
        .sort((a, b) => a.path[a.path.length - 1] - b.path[b.path.length - 1])
        .slice(0, 5);

    return worstPaths.map((wp, rank) => {
        const p = wp.path;
        const finalVal = p[p.length - 1];
        const totalReturn = ((finalVal - capital) / capital) * 100;

        let maxDD = 0;
        let peak = p[0];
        let worstMonth = 0;

        for (let m = 1; m < p.length; m++) {
            if (p[m] > peak) peak = p[m];
            const dd = peak > 0 ? (peak - p[m]) / peak : 0;
            if (dd > maxDD) maxDD = dd;

            const mRet = (p[m] - p[m - 1]) / p[m - 1];
            if (mRet < worstMonth) worstMonth = mRet;
        }

        return {
            rank: rank + 1,
            finalVal,
            totalReturn,
            maxDrawdown: maxDD * 100,
            worstMonth: worstMonth * 100
        };
    });
}

function renderWorstPathsTable(paths, capital) {
    const tbody = document.getElementById('stress-worst-paths-tbody');
    if (!tbody) return;

    const worstPaths = getWorstPathsAnalysis(paths, capital);
    tbody.innerHTML = worstPaths.map(wp => {
        return `
            <tr>
                <td style="font-weight: 600; color: #ef4444;">Rank #${wp.rank}</td>
                <td class="font-mono" style="color: #ef4444; font-weight: 600;">${fmtCurrency(wp.finalVal)}</td>
                <td class="font-mono" style="color: #ef4444;">${wp.totalReturn.toFixed(2)}%</td>
                <td class="font-mono" style="color: #ef4444;">-${wp.maxDrawdown.toFixed(2)}%</td>
                <td class="font-mono" style="color: #ef4444;">-${Math.abs(wp.worstMonth).toFixed(2)}%</td>
            </tr>
        `;
    }).join('');
}

// ─── Heatmap Correlation Grid Helper ─────────────────────────────────

function renderCorrelationHeatmap() {
    const headerRow = document.getElementById('correlation-header-row');
    const tbody = document.getElementById('correlation-matrix-tbody');
    if (!tbody || !headerRow) return;

    headerRow.innerHTML = '<th>Asset Class</th>';
    ASSET_KEYS.forEach(key => {
        headerRow.innerHTML += `<th class="font-mono" style="font-size: 0.75rem; text-align: center;">${ASSET_CLASSES[key].ticker}</th>`;
    });

    tbody.innerHTML = '';
    for (let i = 0; i < ASSET_KEYS.length; i++) {
        const rowKey = ASSET_KEYS[i];
        const rowAsset = ASSET_CLASSES[rowKey];
        let rowHtml = `<tr><td style="font-size: 0.85rem; font-weight: 600;">${rowAsset.name} (${rowAsset.ticker})</td>`;

        for (let j = 0; j < ASSET_KEYS.length; j++) {
            const val = CORRELATION_MATRIX[i][j];
            let bg = '';
            let textColor = '#f8fafc';
            if (val > 0) {
                bg = `rgba(16, 185, 129, ${val * 0.45})`;
            } else if (val < 0) {
                bg = `rgba(239, 68, 68, ${Math.abs(val) * 0.45})`;
            } else {
                bg = 'rgba(255, 255, 255, 0.02)';
            }
            rowHtml += `<td class="heatmap-cell" style="background-color: ${bg}; color: ${textColor};">${val >= 0 ? '+' : ''}${val.toFixed(2)}</td>`;
        }
        rowHtml += '</tr>';
        tbody.innerHTML += rowHtml;
    }
}

// ─── Multi-Scenario Comparison Mode ──────────────────────────────────

async function executeComparisonMode() {
    const capital = parseFloat(document.getElementById('stress-capital-input')?.value) || 100000;
    const age = parseInt(document.getElementById('stress-age-input')?.value) || 30;
    const risk = document.getElementById('stress-risk-input')?.value || 'moderate';

    if (capital <= 0) {
        showToast('Please enter a valid capital amount.');
        return;
    }

    const loader = document.getElementById('stress-loader');
    const results = document.getElementById('stress-results-container');
    const compCard = document.getElementById('stress-comparison-card');

    if (loader) loader.classList.remove('hidden-element');
    if (results) results.classList.add('hidden-element');
    if (compCard) compCard.classList.add('hidden-element');

    updateLoaderState(25, 'step-stress', 'Running portfolio comparison under multiple historical crisis scenarios...');
    await new Promise(r => setTimeout(r, 60));

    try {
        const allocations = calculateAllocations(age, risk);
        const scenarioResults = Object.keys(HISTORICAL_SCENARIOS).map(key => {
            const res = runHistoricalStressTest(allocations, capital, key);
            return { key, ...res };
        });

        const tbody = document.getElementById('stress-comparison-tbody');
        if (tbody) {
            tbody.innerHTML = scenarioResults.map(r => {
                const drawdownVal = r.totalDrawdown;
                const isLoss = drawdownVal < 0;
                let severity = 'LOW';
                let severityColor = '#10b981';
                const absDD = Math.abs(drawdownVal);
                if (absDD > 40) {
                    severity = 'SEVERE';
                    severityColor = '#ef4444';
                } else if (absDD > 25) {
                    severity = 'HIGH';
                    severityColor = '#f97316';
                } else if (absDD > 15) {
                    severity = 'MODERATE';
                    severityColor = '#f59e0b';
                }

                return `
                    <tr>
                        <td style="font-weight: 600;">${r.scenario.icon} ${r.scenario.name}</td>
                        <td class="font-mono" style="color: ${isLoss ? '#ef4444' : '#10b981'}; font-weight: 600;">${drawdownVal >= 0 ? '+' : ''}${drawdownVal.toFixed(2)}%</td>
                        <td class="font-mono" style="color: ${r.totalImpact >= 0 ? '#10b981' : '#ef4444'}">${r.totalImpact >= 0 ? '+' : ''}${fmtCurrency(r.totalImpact)}</td>
                        <td class="font-mono">${fmtCurrency(r.stressedValue)}</td>
                        <td>${r.scenario.recoveryMonths ? `${r.scenario.recoveryMonths} months` : 'N/A'}</td>
                        <td><span style="background: ${severityColor}15; color: ${severityColor}; padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 700;">${severity}</span></td>
                    </tr>
                `;
            }).join('');
        }

        renderComparisonBarChart(scenarioResults);

        updateLoaderState(60, 'step-mc', 'Running Monte Carlo projections to compile portfolio efficiency scores...');
        const mcResult = await runMonteCarloSimulation(allocations, capital, 5, 1000, (p) => {
            updateLoaderState(60 + Math.floor((p / 1000) * 20), 'step-mc', `Projecting assets: path ${p} / 1,000...`);
        });

        updateLoaderState(90, 'step-risk', 'Computing Sharpe ratios, Tail VaR and multi-asset risk indicators...');
        const riskMetrics = calculateRiskMetrics(mcResult.paths, capital, 5, mcResult.percentileData);

        renderAllocationChips(allocations);
        renderMonteCarloFanChart(mcResult.percentileData, mcResult.months, capital);
        renderRiskMetrics(riskMetrics);

        const efficiencyScore = calculateEfficiencyScore(riskMetrics);
        renderEfficiencyScore(efficiencyScore, riskMetrics);

        const tailMetrics = calculateTailMetrics(mcResult.paths, capital);
        renderTailRiskAnalysis(tailMetrics, mcResult.paths, capital);

        if (loader) loader.classList.add('hidden-element');
        if (results) results.classList.remove('hidden-element');
        if (compCard) compCard.classList.remove('hidden-element');

        const commentaryEl = document.getElementById('stress-ai-commentary');
        if (commentaryEl) commentaryEl.innerHTML = '<span class="terminal-prompt">Scenario comparison complete. Click "Execute Stress Test" to fetch commentary for a specific scenario.</span>';

    } catch (err) {
        console.error('Scenario comparison error:', err);
        showToast('Comparison failed: ' + err.message);
        if (loader) loader.classList.add('hidden-element');
    }
}

function renderComparisonBarChart(results) {
    const canvas = document.getElementById('stressComparisonChart');
    if (!canvas) return;

    if (comparisonChartInstance) comparisonChartInstance.destroy();

    const labels = results.map(r => r.scenario.name);
    const drawdowns = results.map(r => r.totalDrawdown);
    const colors = drawdowns.map(dd => dd < 0 ? 'rgba(239, 68, 68, 0.75)' : 'rgba(16, 185, 129, 0.75)');
    const borderColors = drawdowns.map(dd => dd < 0 ? '#ef4444' : '#10b981');

    comparisonChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Drawdown (%)',
                data: drawdowns,
                backgroundColor: colors,
                borderColor: borderColors,
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(13, 19, 38, 0.95)',
                    borderColor: '#1e2d54',
                    borderWidth: 1,
                    titleColor: '#f8fafc',
                    bodyColor: '#e2e8f0',
                    callbacks: {
                        label: (ctx) => ` Drawdown: ${ctx.parsed.y.toFixed(2)}%`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8', font: { size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: {
                        color: '#94a3b8',
                        font: { size: 10 },
                        callback: (val) => `${val}%`
                    }
                }
            }
        }
    });
}
// ─── Import from Portfolio Builder ──────────────────────────────────

function importFromPortfolio() {
    const capital = sessionStorage.getItem('portfolio_param_capital');
    const age = sessionStorage.getItem('portfolio_param_age');
    const risk = sessionStorage.getItem('portfolio_param_risk');

    let imported = false;
    if (capital) { document.getElementById('stress-capital-input').value = capital; imported = true; }
    if (age) { document.getElementById('stress-age-input').value = age; imported = true; }
    if (risk) { document.getElementById('stress-risk-input').value = risk; imported = true; }

    if (imported) {
        showToast('Portfolio parameters imported successfully!');
    } else {
        showToast('No portfolio data found. Configure the Portfolio Builder first.');
    }
}

// ─── Main Execution Flow ────────────────────────────────────────────

async function executeStressTest() {
    const capital = parseFloat(document.getElementById('stress-capital-input')?.value) || 100000;
    const age = parseInt(document.getElementById('stress-age-input')?.value) || 30;
    const risk = document.getElementById('stress-risk-input')?.value || 'moderate';
    const scenarioKey = document.getElementById('stress-scenario-select')?.value || 'gfc2008';
    const mcYears = parseInt(document.getElementById('stress-mc-years')?.value) || 5;
    const numPaths = Math.min(5000, parseInt(document.getElementById('stress-mc-paths')?.value) || 1000);

    if (capital <= 0) {
        showToast('Please enter a valid capital amount.');
        return;
    }

    const loader = document.getElementById('stress-loader');
    const results = document.getElementById('stress-results-container');
    const compCard = document.getElementById('stress-comparison-card');

    if (loader) loader.classList.remove('hidden-element');
    if (results) results.classList.add('hidden-element');
    if (compCard) compCard.classList.add('hidden-element');

    // Yield to UI so loader renders before heavy computation
    updateLoaderState(10, 'step-alloc', 'Configuring allocation structure based on investor age & risk profile...');
    await new Promise(r => setTimeout(r, 60));

    try {
        // 1. Calculate allocations
        const allocations = calculateAllocations(age, risk);
        renderAllocationChips(allocations);

        // 2. Historical / Custom stress test
        updateLoaderState(30, 'step-stress', 'Simulating portfolio performance under historical crisis shocks...');
        await new Promise(r => setTimeout(r, 60));
        
        const stressResult = scenarioKey === 'custom'
            ? runCustomStressTest(allocations, capital)
            : runHistoricalStressTest(allocations, capital, scenarioKey);

        if (!stressResult) throw new Error('Invalid scenario selected.');

        renderDrawdownWaterfall(stressResult);
        renderScenarioMetrics(stressResult);

        // 3. Monte Carlo simulation
        updateLoaderState(50, 'step-mc', 'Running Monte Carlo paths using Cholesky factor matrix...');
        const mcResult = await runMonteCarloSimulation(allocations, capital, mcYears, numPaths, (p) => {
            updateLoaderState(50 + Math.floor((p / numPaths) * 35), 'step-mc', `Simulating path ${p} / ${numPaths}...`);
        });
        
        renderMonteCarloFanChart(mcResult.percentileData, mcResult.months, capital);

        // 4. Risk metrics
        updateLoaderState(90, 'step-risk', 'Computing Sharpe ratios, Value at Risk (VaR), and expected shortfall...');
        const riskMetrics = calculateRiskMetrics(mcResult.paths, capital, mcYears, mcResult.percentileData);
        renderRiskMetrics(riskMetrics);

        // 5. Portfolio Efficiency Score
        const efficiencyScore = calculateEfficiencyScore(riskMetrics);
        renderEfficiencyScore(efficiencyScore, riskMetrics);

        // 6. Tail Risk & Extreme Event Analysis
        const tailMetrics = calculateTailMetrics(mcResult.paths, capital);
        renderTailRiskAnalysis(tailMetrics, mcResult.paths, capital);

        // 7. Correlation Heatmap
        renderCorrelationHeatmap();

        // 8. Show results
        if (loader) loader.classList.add('hidden-element');
        if (results) results.classList.remove('hidden-element');

        // 9. AI commentary (non-blocking)
        fetchAiRiskCommentary(stressResult, riskMetrics, allocations, capital);

    } catch (err) {
        console.error('Stress test error:', err);
        showToast('Stress test failed: ' + err.message);
        if (loader) loader.classList.add('hidden-element');
    }
}

// ─── Setup ──────────────────────────────────────────────────────────

export function setupStressTester() {
    const runBtn = document.getElementById('stress-run-btn');
    const compareBtn = document.getElementById('stress-compare-btn');
    const importBtn = document.getElementById('stress-import-btn');
    const backBtn = document.getElementById('stress-to-portfolio-btn');
    const scenarioSelect = document.getElementById('stress-scenario-select');

    if (runBtn) runBtn.addEventListener('click', executeStressTest);
    if (compareBtn) compareBtn.addEventListener('click', executeComparisonMode);
    if (importBtn) importBtn.addEventListener('click', () => {
        importFromPortfolio();
        updateCustomShockDisplay();
    });
    if (backBtn) backBtn.addEventListener('click', navigateToPortfolio);

    if (scenarioSelect) {
        scenarioSelect.addEventListener('change', () => {
            const customInputs = document.getElementById('custom-shock-inputs');
            if (scenarioSelect.value === 'custom') {
                customInputs?.classList.remove('hidden-element');
                updateCustomShockDisplay();
            } else {
                customInputs?.classList.add('hidden-element');
            }
        });
    }

    // Attach listeners to config inputs to update custom shock display live
    const capitalInput = document.getElementById('stress-capital-input');
    const ageInput = document.getElementById('stress-age-input');
    const riskInput = document.getElementById('stress-risk-input');

    if (capitalInput) capitalInput.addEventListener('input', updateCustomShockDisplay);
    if (ageInput) ageInput.addEventListener('input', updateCustomShockDisplay);
    if (riskInput) riskInput.addEventListener('change', updateCustomShockDisplay);

    // Generate custom shock slider inputs
    generateCustomShockInputs();

    // Check for auto-run or parameters passed from portfolio page
    const runOnLoad = sessionStorage.getItem('stress_param_autorun');
    const savedCapital = sessionStorage.getItem('stress_param_capital');
    const savedAge = sessionStorage.getItem('stress_param_age');
    const savedRisk = sessionStorage.getItem('stress_param_risk');

    if (savedCapital) {
        const input = document.getElementById('stress-capital-input');
        if (input) input.value = savedCapital;
        sessionStorage.removeItem('stress_param_capital');
    }
    if (savedAge) {
        const input = document.getElementById('stress-age-input');
        if (input) input.value = savedAge;
        sessionStorage.removeItem('stress_param_age');
    }
    if (savedRisk) {
        const input = document.getElementById('stress-risk-input');
        if (input) input.value = savedRisk;
        sessionStorage.removeItem('stress_param_risk');
    }

    // Update Custom Shock Display values initially
    updateCustomShockDisplay();

    if (runOnLoad === 'true') {
        sessionStorage.removeItem('stress_param_autorun');
        setTimeout(() => {
            if (runBtn) runBtn.click();
        }, 150);
    }
}

function navigateToPortfolio() {
    // 1. Read current stress tester parameters
    const capital = document.getElementById('stress-capital-input')?.value;
    const age = document.getElementById('stress-age-input')?.value;
    const risk = document.getElementById('stress-risk-input')?.value;

    // 2. Sync them into sessionStorage
    if (capital) sessionStorage.setItem('portfolio_param_capital', capital);
    if (age) sessionStorage.setItem('portfolio_param_age', age);
    if (risk) sessionStorage.setItem('portfolio_param_risk', risk);

    // 3. Redirect to portfolio.html
    window.location.href = 'portfolio.html';
}

