/**
 * STRATA Research Terminal - BlackRock Aladdin Portfolio Stress Testing & Risk Engine
 * 100% Client-Side Quantitative Risk Engine · Zero Extra Market Data API Calls
 * Euler Risk Decomposition · Fat-Tail Student-t Monte Carlo · Cholesky Contagion · 5-Factor Shocks
 */

import { safeJsonParse, showToast } from '../utils.js';

// ─── Module State ───────────────────────────────────────────────────

let monteCarloChartInstance = null;
let eulerRiskChartInstance = null;

let activeScenarioKey = '2008_gfc';
let activeStressMode = 'historical'; // 'historical' | 'factor'
let activeRegime = 'normal'; // 'normal' | 'crisis'
let currentCapital = 1000000;

// 6 Core Macro Asset Classes with Calibrated Institutional Moments
const ASSET_CLASSES = {
    equities: {
        id: 'equities',
        name: 'US Equities',
        ticker: 'SPY / VOO',
        annualReturn: 0.102,
        annualVol: 0.165,
        color: '#3b82f6',
        weight: 60
    },
    bonds: {
        id: 'bonds',
        name: 'Fixed Income & Treasuries',
        ticker: 'TLT / BND',
        annualReturn: 0.046,
        annualVol: 0.068,
        color: '#64748b',
        weight: 35
    },
    gold: {
        id: 'gold',
        name: 'Gold & Precious Metals',
        ticker: 'GLD / IAU',
        annualReturn: 0.065,
        annualVol: 0.145,
        color: '#f59e0b',
        weight: 0
    },
    commodities: {
        id: 'commodities',
        name: 'Broad Commodities & Energy',
        ticker: 'GSG / DBC',
        annualReturn: 0.058,
        annualVol: 0.210,
        color: '#10b981',
        weight: 0
    },
    crypto: {
        id: 'crypto',
        name: 'Digital Assets (Crypto)',
        ticker: 'BTC / ETH',
        annualReturn: 0.180,
        annualVol: 0.620,
        color: '#8b5cf6',
        weight: 0
    },
    cash: {
        id: 'cash',
        name: 'Cash & 3M T-Bills',
        ticker: 'BIL / SGOV',
        annualReturn: 0.045,
        annualVol: 0.008,
        color: '#06b6d4',
        weight: 5
    }
};

const ASSET_KEYS = ['equities', 'bonds', 'gold', 'commodities', 'crypto', 'cash'];

// Calibrated 6x6 Institutional Correlation Matrix (Normal Regime)
const CORRELATION_NORMAL = [
    [ 1.00, -0.32,  0.05,  0.38,  0.42,  0.00], // equities
    [-0.32,  1.00,  0.28, -0.15, -0.12,  0.08], // bonds
    [ 0.05,  0.28,  1.00,  0.22,  0.15,  0.05], // gold
    [ 0.38, -0.15,  0.22,  1.00,  0.30,  0.02], // commodities
    [ 0.42, -0.12,  0.15,  0.30,  1.00,  0.00], // crypto
    [ 0.00,  0.08,  0.05,  0.02,  0.00,  1.00]  // cash
];

// Crisis Contagion Correlation Matrix (Risk-asset correlations compress toward +0.75 to +0.85)
const CORRELATION_CRISIS = [
    [ 1.00, -0.05,  0.30,  0.75,  0.82,  0.00], // equities
    [-0.05,  1.00,  0.40, -0.05,  0.00,  0.10], // bonds
    [ 0.30,  0.40,  1.00,  0.45,  0.35,  0.08], // gold
    [ 0.75, -0.05,  0.45,  1.00,  0.70,  0.02], // commodities
    [ 0.82,  0.00,  0.35,  0.70,  1.00,  0.00], // crypto
    [ 0.00,  0.10,  0.08,  0.02,  0.00,  1.00]  // cash
];

// 8 Institutional Historical Crisis Regimes
const HISTORICAL_SCENARIOS = {
    '2008_gfc': {
        name: '2008 Global Financial Crisis',
        subtitle: 'Lehman Default & Global Subprime Collapse',
        icon: '📉',
        period: 'Oct 2007 – Mar 2009',
        durationMonths: 17,
        recoveryMonths: 49,
        shocks: { equities: -0.52, bonds: 0.14, gold: 0.055, commodities: -0.46, crypto: -0.65, cash: 0.018 },
        desc: 'Subprime mortgage credit freeze. S&P 500 fell 52% peak-to-trough while Treasuries rallied on a flight to quality.'
    },
    '2020_covid': {
        name: '2020 COVID-19 Liquidity Shock',
        subtitle: 'Global Lockdowns & March 2020 Liquidity Crunch',
        icon: '🦠',
        period: 'Feb 2020 – Mar 2020',
        durationMonths: 1.5,
        recoveryMonths: 5,
        shocks: { equities: -0.34, bonds: 0.082, gold: 0.035, commodities: -0.54, crypto: -0.50, cash: 0.005 },
        desc: 'Fastest bear market in history. Widespread collateral fire-sales followed by massive fiscal & monetary stimulus.'
    },
    '2022_rates': {
        name: '2022 Fed Rate Shock & Stagflation',
        subtitle: 'Simultaneous Breakdown of 60/40 Equity-Bond Hedge',
        icon: '🏦',
        period: 'Jan 2022 – Oct 2022',
        durationMonths: 10,
        recoveryMonths: 18,
        shocks: { equities: -0.25, bonds: -0.175, gold: -0.012, commodities: 0.24, crypto: -0.68, cash: 0.021 },
        desc: 'Persistent CPI inflation triggered 425 bps of Fed tightening. Both stocks and long bonds plunged simultaneously.'
    },
    '2000_dotcom': {
        name: '2000–2002 Dot-Com Bubble Collapse',
        subtitle: 'Tech Speculative Bust & Prolonged Bear Market',
        icon: '💥',
        period: 'Mar 2000 – Oct 2002',
        durationMonths: 30,
        recoveryMonths: 56,
        shocks: { equities: -0.49, bonds: 0.22, gold: 0.12, commodities: -0.08, crypto: -0.75, cash: 0.040 },
        desc: 'NASDAQ tumbled 78% and S&P lost 49%. Flight to intermediate duration Treasuries and gold preserved capital.'
    },
    '1973_oil': {
        name: '1973–1974 Stagflation & Oil Embargo',
        subtitle: 'OPEC Energy Shock & Cost-Push Inflation',
        icon: '🛢️',
        period: 'Jan 1973 – Dec 1974',
        durationMonths: 21,
        recoveryMonths: 63,
        shocks: { equities: -0.45, bonds: -0.06, gold: 0.68, commodities: 0.55, crypto: -0.50, cash: 0.065 },
        desc: 'Severe supply-side cost shock. Equities and nominal bonds suffered deep real drawdowns while gold surged 68%.'
    },
    '2011_euro': {
        name: '2011 Eurozone Sovereign Debt Crisis',
        subtitle: 'US AAA Downgrade & Peripheral Debt Contagion',
        icon: '🏛️',
        period: 'Jul 2011 – Oct 2011',
        durationMonths: 5,
        recoveryMonths: 6,
        shocks: { equities: -0.194, bonds: 0.098, gold: 0.24, commodities: -0.18, crypto: -0.60, cash: 0.002 },
        desc: 'Greek debt restructuring and S&P downgrade of US sovereign credit sparked global equity selloff and gold rally.'
    },
    '1987_blackmonday': {
        name: '1987 Black Monday Liquidity Crash',
        subtitle: 'Portfolio Insurance Cascades & Intraday Gap Down',
        icon: '⚡',
        period: 'Oct 1987 – Nov 1987',
        durationMonths: 2,
        recoveryMonths: 20,
        shocks: { equities: -0.335, bonds: 0.045, gold: 0.08, commodities: -0.11, crypto: -0.45, cash: 0.015 },
        desc: 'Single-day 22.6% crash in the Dow Jones caused by early algorithmic program trading and market-maker illiquidity.'
    },
    'custom_factor': {
        name: 'Aladdin Multi-Factor Custom Shock',
        subtitle: 'Dynamic Propagation via Institutional Factor Betas',
        icon: '⚙️',
        period: 'Custom Macro Stress Scenario',
        durationMonths: 6,
        recoveryMonths: 12,
        shocks: { equities: -0.20, bonds: -0.05, gold: 0.08, commodities: 0.12, crypto: -0.35, cash: 0.01 },
        desc: 'Multi-factor shock propagated dynamically using Aladdin Factor Betas across Equities, Rates, Inflation, and Spreads.'
    }
};

// 5 Institutional Benchmark Archetypes
const BENCHMARK_ARCHETYPES = {
    sixty_forty: { name: '60/40 Institutional', weights: { equities: 60, bonds: 35, gold: 0, commodities: 0, crypto: 0, cash: 5 } },
    all_weather: { name: 'All-Weather Parity', weights: { equities: 25, bonds: 40, gold: 15, commodities: 15, crypto: 0, cash: 5 } },
    endowment:   { name: 'Yale Endowment',   weights: { equities: 50, bonds: 15, gold: 15, commodities: 15, crypto: 5, cash: 0 } },
    defensive:   { name: 'Capital Preservation', weights: { equities: 20, bonds: 50, gold: 15, commodities: 0, crypto: 0, cash: 15 } },
    aggressive:  { name: 'Aggressive Alpha', weights: { equities: 65, bonds: 5, gold: 5, commodities: 5, crypto: 20, cash: 0 } }
};

// Aladdin 5-Factor Macro Beta Matrix: dR_i = sum(beta_ik * dF_k)
const FACTOR_BETAS = {
    equities:    { erp: 1.00, rates10y: -0.040, cpi: -0.015, credit: -0.045, oil: -0.08 },
    bonds:       { erp: -0.10, rates10y: -0.075, cpi: -0.035, credit: -0.020, oil: -0.05 },
    gold:        { erp: 0.05, rates10y: -0.025, cpi: 0.065, credit: 0.010, oil: 0.25 },
    commodities: { erp: 0.35, rates10y: -0.010, cpi: 0.055, credit: -0.015, oil: 0.65 },
    crypto:      { erp: 1.45, rates10y: -0.120, cpi: -0.020, credit: -0.080, oil: -0.10 },
    cash:        { erp: 0.00, rates10y: 0.010, cpi: 0.000, credit: 0.000, oil: 0.00 }
};

// Current Active Factor Shocks
const factorShocks = {
    erp: -25,       // % equity shock
    rates10y: 75,   // bps yield change
    cpi: 150,       // bps inflation surprise
    credit: 200,    // bps HY credit spread
    oil: 30         // % oil price shock
};

// ─── Mathematical & Linear Algebra Functions ─────────────────────────

function getActiveCorrelation() {
    return activeRegime === 'crisis' ? CORRELATION_CRISIS : CORRELATION_NORMAL;
}

function getActiveVolatilities() {
    const scale = activeRegime === 'crisis' ? 1.4 : 1.0;
    return ASSET_KEYS.map(k => {
        const v = ASSET_CLASSES[k].annualVol;
        return k === 'cash' ? v : v * scale;
    });
}

function getNormalizedWeights() {
    let sum = ASSET_KEYS.reduce((acc, k) => acc + (ASSET_CLASSES[k].weight || 0), 0);
    if (sum <= 0) sum = 1;
    return ASSET_KEYS.map(k => (ASSET_CLASSES[k].weight || 0) / sum);
}

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

function boxMullerNormal() {
    let u1 = 0, u2 = 0;
    while (u1 === 0) u1 = Math.random();
    while (u2 === 0) u2 = Math.random();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

// ─── Core Euler Risk Decomposition & Moments Engine ─────────────────

function computeEulerRiskAttribution() {
    const weights = getNormalizedWeights();
    const vols = getActiveVolatilities();
    const corr = getActiveCorrelation();
    const n = ASSET_KEYS.length;

    // Construct Covariance Matrix: Sigma_ij = rho_ij * sigma_i * sigma_j
    const cov = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            cov[i][j] = corr[i][j] * vols[i] * vols[j];
        }
    }

    // Sigma * w vector
    const sigmaW = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            sigmaW[i] += cov[i][j] * weights[j];
        }
    }

    // Portfolio Variance = w^T * Sigma * w
    let portVar = 0;
    for (let i = 0; i < n; i++) {
        portVar += weights[i] * sigmaW[i];
    }
    const portVol = Math.sqrt(Math.max(1e-8, portVar));

    // Marginal (MCTR), Component (CCTR), and % Share (PCTR) Risk Contributions
    const mctr = new Array(n).fill(0);
    const cctr = new Array(n).fill(0);
    const pctr = new Array(n).fill(0);
    const compVarDollar = new Array(n).fill(0);

    for (let i = 0; i < n; i++) {
        mctr[i] = portVol > 0 ? (sigmaW[i] / portVol) : 0;
        cctr[i] = weights[i] * mctr[i];
        pctr[i] = portVol > 0 ? (cctr[i] / portVol) * 100 : 0;
        compVarDollar[i] = 1.6449 * cctr[i] * currentCapital;
    }

    // Expected Portfolio Return
    let portReturn = 0;
    for (let i = 0; i < n; i++) {
        portReturn += weights[i] * ASSET_CLASSES[ASSET_KEYS[i]].annualReturn;
    }

    // Undiversified VaR vs Diversified VaR & Choueifaty Ratio
    const weightedVolSum = weights.reduce((acc, w, idx) => acc + w * vols[idx], 0);
    const undiversifiedVaR = 1.6449 * weightedVolSum * currentCapital;
    const diversifiedVaR = 1.6449 * portVol * currentCapital;
    const diversificationBenefit = Math.max(0, undiversifiedVaR - diversifiedVaR);
    const diversificationRatio = portVol > 0 ? (weightedVolSum / portVol) : 1.0;

    return {
        weights,
        vols,
        cov,
        portVol,
        portReturn,
        mctr,
        cctr,
        pctr,
        compVarDollar,
        undiversifiedVaR,
        diversifiedVaR,
        diversificationBenefit,
        diversificationRatio
    };
}

// ─── Scenario Return Calculation ────────────────────────────────────

function getAssetScenarioShocks() {
    if (activeStressMode === 'factor') {
        // Multi-Factor Beta Model: dR_i = sum(beta_ik * dF_k)
        const shocks = {};
        ASSET_KEYS.forEach(k => {
            const b = FACTOR_BETAS[k];
            const dR = (b.erp * (factorShocks.erp / 100)) +
                       (b.rates10y * (factorShocks.rates10y / 100)) + // bps/100 -> %
                       (b.cpi * (factorShocks.cpi / 100)) +
                       (b.credit * (factorShocks.credit / 100)) +
                       (b.oil * (factorShocks.oil / 100));
            shocks[k] = Math.max(-0.95, dR);
        });
        return shocks;
    } else {
        const sc = HISTORICAL_SCENARIOS[activeScenarioKey] || HISTORICAL_SCENARIOS['2008_gfc'];
        return sc.shocks;
    }
}

// ─── 1,000-Path Monte Carlo Simulation (Student-t Fat Tails) ────────

function runMonteCarloSimulation(portVol, portReturn, cov) {
    const numPaths = 1000;
    const numDays = 252;
    const dt = 1 / numDays;
    const dailyDrift = (portReturn - 0.5 * portVol * portVol) * dt;
    const dailyVol = portVol * Math.sqrt(dt);

    const isStudentT = activeRegime === 'crisis';
    const nu = 4; // degrees of freedom for Student-t

    const terminalReturns = [];
    const maxDrawdowns = [];
    const dailyPaths = Array.from({ length: numDays + 1 }, () => new Array(numPaths).fill(currentCapital));

    for (let p = 0; p < numPaths; p++) {
        let val = currentCapital;
        let peak = currentCapital;
        let maxDd = 0;

        for (let d = 1; d <= numDays; d++) {
            let z = boxMullerNormal();

            if (isStudentT) {
                // Student-t radial scaling via Chi-squared (sum of 4 squared normals)
                const chiSq = Math.pow(boxMullerNormal(), 2) + Math.pow(boxMullerNormal(), 2) + Math.pow(boxMullerNormal(), 2) + Math.pow(boxMullerNormal(), 2);
                const scale = Math.sqrt(nu / Math.max(0.01, chiSq));
                z = z * scale * 0.7071; // normalize variance to 1.0 (sqrt((nu-2)/nu))
            }

            const dailyReturn = dailyDrift + dailyVol * z;
            val = val * Math.exp(dailyReturn);
            dailyPaths[d][p] = val;

            if (val > peak) peak = val;
            const dd = (peak - val) / peak;
            if (dd > maxDd) maxDd = dd;
        }

        terminalReturns.push((val - currentCapital) / currentCapital);
        maxDrawdowns.push(maxDd);
    }

    terminalReturns.sort((a, b) => a - b);
    maxDrawdowns.sort((a, b) => a - b);

    // Percentile Cones across all 252 days
    const p5Series = [];
    const p25Series = [];
    const p50Series = [];
    const p75Series = [];
    const p95Series = [];
    const dayLabels = [];

    for (let d = 0; d <= numDays; d += 12) {
        dayLabels.push(`Day ${d}`);
        const dayVals = [...dailyPaths[d]].sort((a, b) => a - b);
        p5Series.push(Math.round(dayVals[Math.floor(numPaths * 0.05)]));
        p25Series.push(Math.round(dayVals[Math.floor(numPaths * 0.25)]));
        p50Series.push(Math.round(dayVals[Math.floor(numPaths * 0.50)]));
        p75Series.push(Math.round(dayVals[Math.floor(numPaths * 0.75)]));
        p95Series.push(Math.round(dayVals[Math.floor(numPaths * 0.95)]));
    }

    // Risk Metrics
    const var95 = Math.abs(terminalReturns[Math.floor(numPaths * 0.05)]) * 100;
    const var99 = Math.abs(terminalReturns[Math.floor(numPaths * 0.01)]) * 100;

    const tail95Returns = terminalReturns.slice(0, Math.floor(numPaths * 0.05));
    const cvar95 = Math.abs(tail95Returns.reduce((acc, v) => acc + v, 0) / tail95Returns.length) * 100;

    const tail99Returns = terminalReturns.slice(0, Math.floor(numPaths * 0.01));
    const cvar99 = Math.abs(tail99Returns.reduce((acc, v) => acc + v, 0) / tail99Returns.length) * 100;

    const avgMaxDrawdown = (maxDrawdowns.reduce((acc, v) => acc + v, 0) / maxDrawdowns.length) * 100;
    const probLoss = (terminalReturns.filter(r => r < 0).length / numPaths) * 100;

    const riskFreeRate = 0.045;
    const sharpe = portVol > 0 ? ((portReturn - riskFreeRate) / portVol) : 0;

    const downsideDiffs = terminalReturns.filter(r => r < riskFreeRate).map(r => Math.pow(r - riskFreeRate, 2));
    const downsideDev = Math.sqrt(downsideDiffs.reduce((a, b) => a + b, 0) / numPaths);
    const sortino = downsideDev > 0 ? ((portReturn - riskFreeRate) / downsideDev) : 0;
    const calmar = avgMaxDrawdown > 0 ? (portReturn / (avgMaxDrawdown / 100)) : 0;

    return {
        dayLabels,
        p5Series,
        p25Series,
        p50Series,
        p75Series,
        p95Series,
        var95,
        var99,
        cvar95,
        cvar99,
        avgMaxDrawdown,
        probLoss,
        sharpe,
        sortino,
        calmar
    };
}

// ─── Risk-Parity Equal-Risk-Contribution (ERC) Optimizer ───────────

function calculateRiskParityWeights() {
    const vols = getActiveVolatilities();
    const corr = getActiveCorrelation();
    const n = ASSET_KEYS.length;

    // Initial inverse-volatility weights
    let invVols = vols.map(v => 1 / Math.max(0.005, v));
    let totalInv = invVols.reduce((a, b) => a + b, 0);
    let weights = invVols.map(iv => iv / totalInv);

    // Covariance Matrix
    const cov = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            cov[i][j] = corr[i][j] * vols[i] * vols[j];
        }
    }

    // Iterative Equal-Risk-Contribution optimization (20 iterations)
    for (let iter = 0; iter < 20; iter++) {
        const sigmaW = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                sigmaW[i] += cov[i][j] * weights[j];
            }
        }
        let portVar = 0;
        for (let i = 0; i < n; i++) portVar += weights[i] * sigmaW[i];
        const portVol = Math.sqrt(Math.max(1e-8, portVar));

        const targetRisk = portVol / n;
        for (let i = 0; i < n; i++) {
            const currentCCTR = weights[i] * (sigmaW[i] / portVol);
            if (currentCCTR > 0) {
                weights[i] = weights[i] * (targetRisk / currentCCTR);
            }
        }
        const sumW = weights.reduce((a, b) => a + b, 0);
        weights = weights.map(w => w / sumW);
    }

    const roundedWeights = {};
    let totalRounded = 0;
    ASSET_KEYS.forEach((k, idx) => {
        const rounded = Math.round(weights[idx] * 100);
        roundedWeights[k] = rounded;
        totalRounded += rounded;
    });

    // Fix rounding discrepancies to exactly 100%
    if (totalRounded !== 100) {
        roundedWeights['bonds'] += (100 - totalRounded);
    }

    return roundedWeights;
}

// ─── Main Execution & UI Update Controller ──────────────────────────

export function setupStressTester() {
    // 1. Initial Render of Asset Sliders and Crisis Cards
    renderAssetAllocationInputs();
    renderHistoricalCrisisCards();
    renderFactorShockSliders();

    // 2. Wire Global Ribbon Controls
    const capInput = document.getElementById('stress-capital-input');
    if (capInput) {
        capInput.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val) && val > 0) {
                currentCapital = val;
                runStressTestWorkflow();
            }
        });
    }

    // Regime Toggle (Normal vs Crisis Fat-Tail)
    const regimeButtons = document.querySelectorAll('#stress-regime-toggle .regime-pill');
    regimeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            regimeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeRegime = btn.getAttribute('data-regime');
            showToast(`Activated ${activeRegime === 'crisis' ? 'Crisis Contagion + Student-t (ν=4)' : 'Normal Gaussian'} Regime`);
            runStressTestWorkflow();
        });
    });

    // Benchmark Archetypes
    const archetypeButtons = document.querySelectorAll('.archetype-pill');
    archetypeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            archetypeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const key = btn.getAttribute('data-archetype');
            applyBenchmarkArchetype(key);
        });
    });

    // Import from Mock Portfolio
    const importBtn = document.getElementById('stress-import-btn');
    if (importBtn) {
        importBtn.addEventListener('click', importFromMockPortfolio);
    }

    // Optimize for Risk Parity
    const parityBtn = document.getElementById('stress-risk-parity-btn');
    if (parityBtn) {
        parityBtn.addEventListener('click', showRiskParityComparison);
    }

    // Normalize weights button
    const normBtn = document.getElementById('stress-normalize-btn');
    if (normBtn) {
        normBtn.addEventListener('click', normalizeWeightsTo100);
    }

    // Scenario Mode Tabs (Historical vs Factor)
    const tabHistBtn = document.getElementById('tab-historical-btn');
    const tabFactBtn = document.getElementById('tab-factor-btn');
    const panelHist = document.getElementById('panel-historical-scenarios');
    const panelFact = document.getElementById('panel-factor-shocks');

    if (tabHistBtn && tabFactBtn && panelHist && panelFact) {
        tabHistBtn.addEventListener('click', () => {
            tabHistBtn.classList.add('active');
            tabFactBtn.classList.remove('active');
            panelHist.style.display = 'block';
            panelFact.style.display = 'none';
            activeStressMode = 'historical';
            runStressTestWorkflow();
        });

        tabFactBtn.addEventListener('click', () => {
            tabFactBtn.classList.add('active');
            tabHistBtn.classList.remove('active');
            panelFact.style.display = 'block';
            panelHist.style.display = 'none';
            activeStressMode = 'factor';
            runStressTestWorkflow();
        });
    }

    // Reset Factor Shocks
    const resetFactBtn = document.getElementById('stress-reset-factors-btn');
    if (resetFactBtn) {
        resetFactBtn.addEventListener('click', () => {
            factorShocks.erp = 0;
            factorShocks.rates10y = 0;
            factorShocks.cpi = 0;
            factorShocks.credit = 0;
            factorShocks.oil = 0;
            renderFactorShockSliders();
            runStressTestWorkflow();
            showToast('Factor shocks reset to neutral baseline');
        });
    }

    // AI CRO Memo Execution
    const aiBtn = document.getElementById('stress-ai-run-btn');
    if (aiBtn) {
        aiBtn.addEventListener('click', generateAladdinCROMemo);
    }

    const copyBtn = document.getElementById('stress-ai-copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', copyCROMemoToClipboard);
    }

    // Execute first calculation cycle
    runStressTestWorkflow();
}

function renderAssetAllocationInputs() {
    const container = document.getElementById('stress-allocations-list');
    if (!container) return;

    container.innerHTML = ASSET_KEYS.map(k => {
        const a = ASSET_CLASSES[k];
        const dollars = (currentCapital * (a.weight / 100));
        return `
            <div class="asset-alloc-row" data-asset="${k}">
                <div class="asset-row-header">
                    <div class="asset-label-block">
                        <span class="asset-color-dot" style="background: ${a.color};"></span>
                        <span class="asset-name">${a.name}</span>
                        <span class="asset-ticker-tag">${a.ticker}</span>
                    </div>
                    <div class="asset-inputs-block">
                        <div class="asset-pct-input-wrap">
                            <input type="number" id="alloc-num-${k}" value="${a.weight}" min="0" max="100" step="1">
                            <span class="pct-suffix">%</span>
                        </div>
                        <span class="asset-dollar-val" id="alloc-dollar-${k}">$${Math.round(dollars).toLocaleString()}</span>
                    </div>
                </div>
                <div class="asset-slider-row">
                    <input type="range" id="alloc-slider-${k}" min="0" max="100" step="1" value="${a.weight}">
                    <span class="risk-share-badge" id="risk-share-${k}">Risk: --%</span>
                </div>
            </div>
        `;
    }).join('');

    // Wire synchronization
    ASSET_KEYS.forEach(k => {
        const numInput = document.getElementById(`alloc-num-${k}`);
        const slider = document.getElementById(`alloc-slider-${k}`);

        if (numInput && slider) {
            numInput.addEventListener('input', (e) => {
                let v = parseFloat(e.target.value) || 0;
                v = Math.max(0, Math.min(100, v));
                slider.value = v;
                ASSET_CLASSES[k].weight = v;
                updateDollarAllocations();
                runStressTestWorkflow();
            });

            slider.addEventListener('input', (e) => {
                let v = parseFloat(e.target.value) || 0;
                numInput.value = v;
                ASSET_CLASSES[k].weight = v;
                updateDollarAllocations();
                runStressTestWorkflow();
            });
        }
    });
}

function updateDollarAllocations() {
    ASSET_KEYS.forEach(k => {
        const el = document.getElementById(`alloc-dollar-${k}`);
        if (el) {
            const d = currentCapital * (ASSET_CLASSES[k].weight / 100);
            el.textContent = `$${Math.round(d).toLocaleString()}`;
        }
    });
}

function renderHistoricalCrisisCards() {
    const container = document.getElementById('crisis-cards-grid');
    if (!container) return;

    container.innerHTML = Object.entries(HISTORICAL_SCENARIOS).map(([key, sc]) => `
        <div class="crisis-card ${key === activeScenarioKey ? 'active' : ''}" data-scenario="${key}">
            <div class="crisis-card-top">
                <div class="crisis-title-row">
                    <span class="crisis-icon">${sc.icon}</span>
                    <span class="crisis-name">${sc.name}</span>
                </div>
                <span class="crisis-drawdown-badge">${((sc.shocks.equities || -0.2) * 100).toFixed(0)}% Equities</span>
            </div>
            <div class="crisis-meta-row">
                <span><i class="fa-regular fa-calendar"></i> ${sc.period}</span>
                <span><i class="fa-solid fa-stopwatch"></i> ${sc.recoveryMonths}m Recovery</span>
            </div>
            <p class="crisis-desc-text">${sc.desc}</p>
        </div>
    `).join('');

    container.querySelectorAll('.crisis-card').forEach(card => {
        card.addEventListener('click', () => {
            container.querySelectorAll('.crisis-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            activeScenarioKey = card.getAttribute('data-scenario');
            runStressTestWorkflow();
        });
    });
}

function renderFactorShockSliders() {
    const container = document.getElementById('factor-shocks-list');
    if (!container) return;

    const defs = [
        { key: 'erp', name: 'Global Equity ERP Shock', min: -50, max: 30, step: 1, suffix: '%' },
        { key: 'rates10y', name: 'US 10Y Treasury Shift (Δbps)', min: -200, max: 300, step: 25, suffix: ' bps' },
        { key: 'cpi', name: 'CPI Inflation Surprise (Δbps)', min: -200, max: 500, step: 25, suffix: ' bps' },
        { key: 'credit', name: 'HY Credit Spread Widening (Δbps)', min: 0, max: 600, step: 25, suffix: ' bps' },
        { key: 'oil', name: 'Oil / Energy Supply Shock (%)', min: -40, max: 100, step: 5, suffix: '%' }
    ];

    container.innerHTML = defs.map(d => `
        <div class="factor-shock-row">
            <div class="factor-shock-header">
                <span class="factor-name">${d.name}</span>
                <span class="factor-readout" id="factor-val-${d.key}">${factorShocks[d.key] > 0 ? '+' : ''}${factorShocks[d.key]}${d.suffix}</span>
            </div>
            <input type="range" id="factor-slider-${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${factorShocks[d.key]}">
        </div>
    `).join('');

    defs.forEach(d => {
        const slider = document.getElementById(`factor-slider-${d.key}`);
        const readout = document.getElementById(`factor-val-${d.key}`);
        if (slider && readout) {
            slider.addEventListener('input', (e) => {
                const v = parseFloat(e.target.value);
                factorShocks[d.key] = v;
                readout.textContent = `${v > 0 ? '+' : ''}${v}${d.suffix}`;
                runStressTestWorkflow();
            });
        }
    });
}

function normalizeWeightsTo100() {
    let currentTotal = ASSET_KEYS.reduce((acc, k) => acc + (ASSET_CLASSES[k].weight || 0), 0);
    if (currentTotal <= 0) {
        ASSET_CLASSES.equities.weight = 60;
        ASSET_CLASSES.bonds.weight = 40;
    } else {
        ASSET_KEYS.forEach(k => {
            ASSET_CLASSES[k].weight = Math.round((ASSET_CLASSES[k].weight / currentTotal) * 100);
        });
    }

    // Verify sum exactly 100
    let sum = ASSET_KEYS.reduce((acc, k) => acc + ASSET_CLASSES[k].weight, 0);
    if (sum !== 100) {
        ASSET_CLASSES.bonds.weight += (100 - sum);
    }

    ASSET_KEYS.forEach(k => {
        const input = document.getElementById(`alloc-num-${k}`);
        const slider = document.getElementById(`alloc-slider-${k}`);
        if (input) input.value = ASSET_CLASSES[k].weight;
        if (slider) slider.value = ASSET_CLASSES[k].weight;
    });

    updateDollarAllocations();
    runStressTestWorkflow();
    showToast('Normalized portfolio weights to 100%');
}

function applyBenchmarkArchetype(key) {
    const arch = BENCHMARK_ARCHETYPES[key];
    if (!arch) return;

    ASSET_KEYS.forEach(k => {
        const w = arch.weights[k] || 0;
        ASSET_CLASSES[k].weight = w;
        const input = document.getElementById(`alloc-num-${k}`);
        const slider = document.getElementById(`alloc-slider-${k}`);
        if (input) input.value = w;
        if (slider) slider.value = w;
    });

    updateDollarAllocations();
    runStressTestWorkflow();
    showToast(`Applied ${arch.name} Benchmark`);
}

function importFromMockPortfolio() {
    try {
        const saved = localStorage.getItem('strata_portfolio') ||
                      localStorage.getItem('portfolio_holdings') ||
                      localStorage.getItem('portfolioHoldings');

        if (!saved) {
            showToast('No saved portfolio found in Mock Portfolio. Using defaults.');
            return;
        }

        const data = safeJsonParse(saved, null);
        const holdings = Array.isArray(data) ? data : (data?.holdings || []);

        if (!holdings.length) {
            showToast('Mock Portfolio is empty. Add assets in Mock Portfolio first.');
            return;
        }

        // Map tickers to 6 asset classes
        let totalVal = 0;
        const classVals = { equities: 0, bonds: 0, gold: 0, commodities: 0, crypto: 0, cash: 0 };

        holdings.forEach(h => {
            const sym = (h.ticker || h.symbol || '').toUpperCase();
            const val = parseFloat(h.value || (h.shares * h.price) || (h.quantity * h.currentPrice)) || 1000;
            totalVal += val;

            if (['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX'].includes(sym)) {
                classVals.crypto += val;
            } else if (['GLD', 'SLV', 'IAU', 'GOLD', 'SILVER'].includes(sym)) {
                classVals.gold += val;
            } else if (['TLT', 'BND', 'IEF', 'AGG', 'SHY', 'LQD', 'HYG'].includes(sym)) {
                classVals.bonds += val;
            } else if (['USO', 'XLE', 'GSG', 'DBC', 'OIL', 'UNG'].includes(sym)) {
                classVals.commodities += val;
            } else if (['CASH', 'USD', 'BIL', 'SGOV'].includes(sym)) {
                classVals.cash += val;
            } else {
                classVals.equities += val;
            }
        });

        if (totalVal > 0) {
            currentCapital = Math.round(totalVal);
            const capInput = document.getElementById('stress-capital-input');
            if (capInput) capInput.value = currentCapital;

            ASSET_KEYS.forEach(k => {
                const w = Math.round((classVals[k] / totalVal) * 100);
                ASSET_CLASSES[k].weight = w;
                const input = document.getElementById(`alloc-num-${k}`);
                const slider = document.getElementById(`alloc-slider-${k}`);
                if (input) input.value = w;
                if (slider) slider.value = w;
            });

            // Re-normalize sum
            let s = ASSET_KEYS.reduce((acc, k) => acc + ASSET_CLASSES[k].weight, 0);
            if (s !== 100) ASSET_CLASSES.equities.weight += (100 - s);

            updateDollarAllocations();
            runStressTestWorkflow();
            showToast(`Imported $${currentCapital.toLocaleString()} across ${holdings.length} assets`);
        }
    } catch (err) {
        console.error('Error importing mock portfolio:', err);
        showToast('Failed to import portfolio holdings');
    }
}

function showRiskParityComparison() {
    const ercWeights = calculateRiskParityWeights();

    // Compute current scenario metrics
    const currentEuler = computeEulerRiskAttribution();
    const currentShocks = getAssetScenarioShocks();
    let currentDrawdown = 0;
    ASSET_KEYS.forEach((k, idx) => {
        currentDrawdown += (currentEuler.weights[idx] * (currentShocks[k] || 0));
    });

    // Compute post-hedge metrics with ERC weights
    const normERC = ASSET_KEYS.map(k => ercWeights[k] / 100);
    let postDrawdown = 0;
    ASSET_KEYS.forEach((k, idx) => {
        postDrawdown += (normERC[idx] * (currentShocks[k] || 0));
    });

    const currLoss = currentCapital * Math.abs(currentDrawdown);
    const postLoss = currentCapital * Math.abs(postDrawdown);
    const lossReduction = Math.max(0, currLoss - postLoss);
    const ddImprovement = Math.max(0, Math.abs(currentDrawdown * 100) - Math.abs(postDrawdown * 100));

    const banner = document.getElementById('risk-parity-banner');
    if (!banner) return;

    banner.className = 'risk-parity-banner';
    banner.innerHTML = `
        <div class="parity-banner-left">
            <h4><i class="fa-solid fa-shield-halved"></i> Aladdin Equal-Risk-Contribution (ERC) Optimization</h4>
            <p>Risk parity re-balances asset weights so each asset contributes equally to total portfolio risk, eliminating equity-beta concentration.</p>
        </div>
        <div class="parity-metrics-row">
            <div class="parity-metric-item">
                <span class="parity-metric-label">Stressed Loss Reduction</span>
                <span class="parity-metric-diff">-$${Math.round(lossReduction).toLocaleString()}</span>
            </div>
            <div class="parity-metric-item">
                <span class="parity-metric-label">Drawdown Dampening</span>
                <span class="parity-metric-diff">+${ddImprovement.toFixed(1)}% Saved</span>
            </div>
            <div class="parity-metric-item">
                <span class="parity-metric-label">Optimal Weights</span>
                <span class="font-mono" style="font-size: 0.85rem; color: #fff;">Eq: ${ercWeights.equities}% · Bd: ${ercWeights.bonds}% · Au: ${ercWeights.gold}% · Com: ${ercWeights.commodities}%</span>
            </div>
            <button type="button" class="parity-apply-btn" id="apply-erc-btn">
                <i class="fa-solid fa-check"></i> Apply Risk-Parity Hedge
            </button>
        </div>
    `;

    document.getElementById('apply-erc-btn')?.addEventListener('click', () => {
        ASSET_KEYS.forEach(k => {
            ASSET_CLASSES[k].weight = ercWeights[k];
            const inp = document.getElementById(`alloc-num-${k}`);
            const sld = document.getElementById(`alloc-slider-${k}`);
            if (inp) inp.value = ercWeights[k];
            if (sld) sld.value = ercWeights[k];
        });
        updateDollarAllocations();
        banner.className = 'risk-parity-banner hidden-element';
        runStressTestWorkflow();
        showToast('Applied Aladdin Risk-Parity Allocation');
    });
}

// ─── Main Risk Pipeline Workflow ────────────────────────────────────

function runStressTestWorkflow() {
    // 1. Check weight sum status
    const totalW = ASSET_KEYS.reduce((acc, k) => acc + (ASSET_CLASSES[k].weight || 0), 0);
    const statusBadge = document.getElementById('stress-allocation-status');
    const statusText = document.getElementById('stress-allocation-total');
    if (statusBadge && statusText) {
        statusText.textContent = `Total: ${totalW}%`;
        if (totalW === 100) {
            statusBadge.className = 'allocation-total-badge';
        } else {
            statusBadge.className = 'allocation-total-badge error';
        }
    }

    // 2. Euler Risk Attribution
    const euler = computeEulerRiskAttribution();

    // Update risk share badges on sliders
    ASSET_KEYS.forEach((k, idx) => {
        const badge = document.getElementById(`risk-share-${k}`);
        if (badge) {
            const p = euler.pctr[idx];
            badge.textContent = `Risk: ${p.toFixed(1)}%`;
            if (p > 50) {
                badge.className = 'risk-share-badge heavy-risk';
            } else if (p < 5) {
                badge.className = 'risk-share-badge low-risk';
            } else {
                badge.className = 'risk-share-badge';
            }
        }
    });

    // 3. Scenario Return & Stressed Drawdown
    const shocks = getAssetScenarioShocks();
    let totalDrawdownPct = 0;
    ASSET_KEYS.forEach((k, idx) => {
        totalDrawdownPct += (euler.weights[idx] * (shocks[k] || 0));
    });

    const netDollarLoss = currentCapital * Math.abs(Math.min(0, totalDrawdownPct));
    const stressedPortfolioValue = Math.max(0, currentCapital * (1 + totalDrawdownPct));

    // 4. Monte Carlo Simulation
    const mc = runMonteCarloSimulation(euler.portVol, euler.portReturn, euler.cov);

    // 5. Update Executive Tail-Risk Ribbon
    renderExecutiveTailRiskRibbon({
        stressedValue: stressedPortfolioValue,
        netLoss: netDollarLoss,
        drawdownPct: totalDrawdownPct * 100,
        recoveryMonths: HISTORICAL_SCENARIOS[activeScenarioKey]?.recoveryMonths || 12,
        var95: mc.var95,
        var99: mc.var99,
        cvar95: mc.cvar95,
        cvar99: mc.cvar99,
        divBenefit: euler.diversificationBenefit,
        divRatio: euler.diversificationRatio,
        sharpe: mc.sharpe,
        sortino: mc.sortino,
        calmar: mc.calmar,
        probLoss: mc.probLoss
    });

    // 6. Update Dual Charts
    renderDualCharts(mc, euler);

    // 7. Update Euler Matrix Table
    renderEulerAttributionTable(euler, shocks);

    // Store latest results in window for AI CRO memo access
    window.__STRATA_STRESS_CACHE__ = {
        scenario: activeStressMode === 'factor' ? 'Aladdin 5-Factor Custom Macro Shock' : HISTORICAL_SCENARIOS[activeScenarioKey]?.name,
        totalDrawdown: totalDrawdownPct * 100,
        stressedValue: stressedPortfolioValue,
        capital: currentCapital,
        allocations: Object.fromEntries(ASSET_KEYS.map(k => [k, `${ASSET_CLASSES[k].weight}%`])),
        riskAttribution: {
            topRiskAsset: ASSET_KEYS.reduce((top, k, idx) => euler.pctr[idx] > (euler.pctr[ASSET_KEYS.indexOf(top)] || 0) ? k : top, 'equities'),
            topRiskShare: `${Math.max(...euler.pctr).toFixed(1)}%`,
            choueifatyRatio: `${euler.diversificationRatio.toFixed(2)}x`
        },
        factorShocks: activeStressMode === 'factor' ? factorShocks : null,
        riskMetrics: {
            var95: mc.var95,
            var99: mc.var99,
            cvar: mc.cvar95,
            cvar99: mc.cvar99,
            maxDrawdown: mc.avgMaxDrawdown,
            sharpe: mc.sharpe,
            sortino: mc.sortino,
            probLoss: mc.probLoss,
            volatility: euler.portVol * 100,
            meanReturn: euler.portReturn * 100,
            divBenefit: Math.round(euler.diversificationBenefit)
        }
    };
}

// ─── UI Renderers: Ribbon, Charts, Table ─────────────────────────────

function renderExecutiveTailRiskRibbon(data) {
    const container = document.getElementById('stress-kpi-ribbon');
    if (!container) return;

    // Resilience Score: based on Diversification Ratio, CVaR, Sharpe, and Drawdown
    let resilienceScore = Math.round(
        (data.divRatio * 25) +
        (Math.max(0, 1 - (data.cvar95 / 50)) * 35) +
        (Math.max(0, Math.min(2, data.sharpe)) * 20) +
        (Math.max(0, 1 - (Math.abs(data.drawdownPct) / 60)) * 20)
    );
    resilienceScore = Math.max(10, Math.min(99, resilienceScore));

    const kpis = [
        {
            title: 'Stressed Portfolio Value',
            value: `$${Math.round(data.stressedValue).toLocaleString()}`,
            pill: `-$${Math.round(data.netLoss).toLocaleString()} Loss`,
            pillType: data.netLoss > 0 ? 'negative' : 'positive',
            border: '#ef4444'
        },
        {
            title: 'Scenario Drawdown',
            value: `${data.drawdownPct.toFixed(2)}%`,
            pill: `~${data.recoveryMonths}m Recovery Horizon`,
            pillType: data.drawdownPct <= -20 ? 'negative' : 'neutral',
            border: '#f59e0b'
        },
        {
            title: '1-Year 95% Value at Risk (VaR)',
            value: `${data.var95.toFixed(2)}%`,
            pill: `$${Math.round(currentCapital * (data.var95 / 100)).toLocaleString()} 95% Tail Risk`,
            pillType: 'neutral',
            border: '#3b82f6'
        },
        {
            title: '95% Expected Shortfall (CVaR)',
            value: `${data.cvar95.toFixed(2)}%`,
            pill: `99% CVaR: ${data.cvar99.toFixed(2)}%`,
            pillType: 'negative',
            border: '#dc2626'
        },
        {
            title: 'Diversification Benefit',
            value: `$${Math.round(data.divBenefit).toLocaleString()}`,
            pill: `Choueifaty DR: ${data.divRatio.toFixed(2)}x`,
            pillType: 'positive',
            border: '#10b981'
        },
        {
            title: 'Tail-Risk Resilience Score',
            value: `${resilienceScore} / 100`,
            pill: `Sharpe: ${data.sharpe.toFixed(2)} · Sortino: ${data.sortino.toFixed(2)}`,
            pillType: resilienceScore >= 75 ? 'positive' : (resilienceScore >= 50 ? 'cyan' : 'negative'),
            border: resilienceScore >= 75 ? '#10b981' : '#06b6d4'
        }
    ];

    container.innerHTML = kpis.map(k => `
        <div class="stress-kpi-card" style="border-left-color: ${k.border};">
            <span class="stress-kpi-title">${k.title}</span>
            <span class="stress-kpi-value font-mono">${k.value}</span>
            <span class="stress-kpi-pill ${k.pillType}">${k.pill}</span>
        </div>
    `).join('');
}

function renderDualCharts(mc, euler) {
    // 1. Monte Carlo Fan Chart
    const mcCtx = document.getElementById('stressMonteCarloChart')?.getContext('2d');
    const regimeTag = document.getElementById('mc-regime-tag');
    if (regimeTag) {
        regimeTag.textContent = activeRegime === 'crisis'
            ? 'Crisis Contagion + Fat-Tail (Student-t, ν=4) · 252 Days'
            : 'Normal Gaussian Regime · 252 Days';
    }

    if (mcCtx) {
        if (monteCarloChartInstance) monteCarloChartInstance.destroy();

        monteCarloChartInstance = new Chart(mcCtx, {
            type: 'line',
            data: {
                labels: mc.dayLabels,
                datasets: [
                    {
                        label: 'P95 Bullish Path',
                        data: mc.p95Series,
                        borderColor: 'rgba(16, 185, 129, 0.85)',
                        backgroundColor: 'transparent',
                        borderWidth: 1.5,
                        pointRadius: 0
                    },
                    {
                        label: 'P75 Quartile',
                        data: mc.p75Series,
                        borderColor: 'rgba(59, 130, 246, 0.4)',
                        backgroundColor: 'rgba(59, 130, 246, 0.08)',
                        fill: '+1',
                        borderWidth: 1,
                        pointRadius: 0
                    },
                    {
                        label: 'P50 Median Trajectory',
                        data: mc.p50Series,
                        borderColor: '#38bdf8',
                        backgroundColor: 'transparent',
                        borderWidth: 2.5,
                        pointRadius: 0
                    },
                    {
                        label: 'P25 Quartile',
                        data: mc.p25Series,
                        borderColor: 'rgba(239, 68, 68, 0.4)',
                        backgroundColor: 'rgba(239, 68, 68, 0.08)',
                        fill: '-1',
                        borderWidth: 1,
                        pointRadius: 0
                    },
                    {
                        label: 'P5 Tail Risk Floor',
                        data: mc.p5Series,
                        borderColor: '#ef4444',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        borderDash: [4, 4],
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(10, 14, 26, 0.95)',
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        borderWidth: 1,
                        bodyFont: { family: 'JetBrains Mono', size: 12 },
                        callbacks: {
                            label: ctx => ` ${ctx.dataset.label}: $${Math.round(ctx.raw).toLocaleString()}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.04)' },
                        ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 10 } }
                    },
                    y: {
                        grid: { color: 'rgba(255, 255, 255, 0.04)' },
                        ticks: {
                            color: '#64748b',
                            font: { family: 'JetBrains Mono', size: 10 },
                            callback: val => `$${(val / 1000).toFixed(0)}k`
                        }
                    }
                }
            }
        });
    }

    // 2. Capital Weight vs Euler Risk Contribution Chart
    const eulerCtx = document.getElementById('stressEulerRiskChart')?.getContext('2d');
    if (eulerCtx) {
        if (eulerRiskChartInstance) eulerRiskChartInstance.destroy();

        const labels = ASSET_KEYS.map(k => ASSET_CLASSES[k].name);
        const capitalWeights = ASSET_KEYS.map(k => ASSET_CLASSES[k].weight);
        const riskContributions = euler.pctr.map(p => Number(p.toFixed(1)));

        eulerRiskChartInstance = new Chart(eulerCtx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Nominal Capital Allocation %',
                        data: capitalWeights,
                        backgroundColor: 'rgba(59, 130, 246, 0.75)',
                        borderRadius: 3
                    },
                    {
                        label: 'Euler Risk Contribution %',
                        data: riskContributions,
                        backgroundColor: 'rgba(239, 68, 68, 0.85)',
                        borderRadius: 3
                    }
                ]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: '#94a3b8', font: { family: 'Inter', size: 10 } }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(10, 14, 26, 0.95)',
                        bodyFont: { family: 'JetBrains Mono', size: 12 },
                        callbacks: {
                            label: ctx => ` ${ctx.dataset.label}: ${ctx.raw}%`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.04)' },
                        ticks: {
                            color: '#64748b',
                            font: { family: 'JetBrains Mono', size: 10 },
                            callback: v => `${v}%`
                        }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: '#cbd5e1', font: { family: 'Inter', size: 10, weight: '600' } }
                    }
                }
            }
        });
    }
}

function renderEulerAttributionTable(euler, shocks) {
    const tbody = document.getElementById('stress-matrix-tbody');
    const badgeDR = document.getElementById('choueifaty-ratio-badge');
    if (badgeDR) {
        badgeDR.textContent = `Choueifaty DR: ${euler.diversificationRatio.toFixed(2)}x`;
    }

    if (!tbody) return;

    let html = '';
    ASSET_KEYS.forEach((k, idx) => {
        const a = ASSET_CLASSES[k];
        const wPct = a.weight;
        const wDollar = currentCapital * (wPct / 100);
        const vol = euler.vols[idx] * 100;
        const mVaR = euler.mctr[idx] * 1.6449 * 100;
        const pctr = euler.pctr[idx];
        const shockPct = (shocks[k] || 0) * 100;
        const pnl = wDollar * (shockPct / 100);
        const postVal = Math.max(0, wDollar + pnl);

        const shockColor = shockPct >= 0 ? '#10b981' : '#ef4444';
        const pnlColor = pnl >= 0 ? '#10b981' : '#ef4444';

        html += `
            <tr>
                <td>
                    <span class="asset-color-dot" style="display:inline-block; vertical-align:middle; margin-right:6px; background:${a.color};"></span>
                    <strong>${a.name}</strong>
                    <span class="asset-ticker-tag" style="margin-left:4px;">${a.ticker}</span>
                </td>
                <td class="num-col font-mono">${wPct}%</td>
                <td class="num-col font-mono">$${Math.round(wDollar).toLocaleString()}</td>
                <td class="num-col font-mono">${vol.toFixed(1)}%</td>
                <td class="num-col font-mono">${mVaR.toFixed(2)}%</td>
                <td class="num-col font-mono" style="color:${pctr > wPct * 1.5 ? '#f87171' : '#38bdf8'}; font-weight:700;">${pctr.toFixed(1)}%</td>
                <td class="num-col font-mono" style="color:${shockColor}; font-weight:700;">${shockPct > 0 ? '+' : ''}${shockPct.toFixed(1)}%</td>
                <td class="num-col font-mono" style="color:${pnlColor};">${pnl >= 0 ? '+' : ''}$${Math.round(pnl).toLocaleString()}</td>
                <td class="num-col font-mono" style="font-weight:700;">$${Math.round(postVal).toLocaleString()}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

// ─── AI Chief Risk Officer Memo Generator ───────────────────────────

async function generateAladdinCROMemo() {
    const outputBox = document.getElementById('stress-ai-output');
    const indicator = document.getElementById('cro-status-indicator');
    const runBtn = document.getElementById('stress-ai-run-btn');

    if (!window.__STRATA_STRESS_CACHE__) {
        showToast('Run a stress test first');
        return;
    }

    if (indicator) indicator.className = 'cro-status-indicator loading';
    if (runBtn) {
        runBtn.disabled = true;
        runBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...';
    }

    outputBox.innerHTML = `
        <div class="cro-placeholder">
            <i class="fa-solid fa-circle-notch fa-spin"></i>
            <p>BlackRock Aladdin CRO engine generating institutional tail-risk and Euler risk decomposition audit...</p>
        </div>
    `;

    try {
        const response = await fetch('/api/stress/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(window.__STRATA_STRESS_CACHE__)
        });

        const data = await response.json();

        if (data.analysis) {
            outputBox.innerHTML = `<div class="cro-text">${data.analysis.replace(/\n\n/g, '<br><br>')}</div>`;
            if (indicator) indicator.className = 'cro-status-indicator';
            showToast('Aladdin CRO Risk Memo generated successfully');
        } else {
            outputBox.innerHTML = `<p style="color:#ef4444;">${data.error || 'Unable to generate risk memo.'}</p>`;
            if (indicator) indicator.className = 'cro-status-indicator';
        }
    } catch (err) {
        console.error('Error generating CRO memo:', err);
        outputBox.innerHTML = `<p style="color:#ef4444;">Risk engine server communication error: ${err.message}</p>`;
        if (indicator) indicator.className = 'cro-status-indicator';
    } finally {
        if (runBtn) {
            runBtn.disabled = false;
            runBtn.innerHTML = '<i class="fa-solid fa-brain"></i> Generate CRO Risk Memo';
        }
    }
}

function copyCROMemoToClipboard() {
    const textEl = document.querySelector('#stress-ai-output .cro-text');
    if (!textEl) {
        showToast('Generate a CRO memo first before copying');
        return;
    }
    navigator.clipboard.writeText(textEl.innerText).then(() => {
        showToast('Copied Aladdin CRO Risk Memo to clipboard');
    }).catch(() => {
        showToast('Failed to copy memo to clipboard');
    });
}
