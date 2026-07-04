let portfolioChartInstance = null;
let projectionChartInstance = null;
let scatterChartInstance = null;
let currentSubAllocations = []; // Global store for active ETF sub-allocations
let currentTargetAllocations = {};
let currentPortfolioContext = {};

const CORRELATION_MATRIX = {
    VOO: { VOO: 1.0,  VEA: 0.82, VWO: 0.76, TLT: -0.31, LQD: 0.24, GLD: 0.08 },
    VEA: { VOO: 0.82, VEA: 1.0,  VWO: 0.85, TLT: -0.25, LQD: 0.28, GLD: 0.12 },
    VWO: { VOO: 0.76, VEA: 0.85, VWO: 1.0,  TLT: -0.22, LQD: 0.32, GLD: 0.15 },
    TLT: { VOO: -0.31, VEA: -0.25, VWO: -0.22, TLT: 1.0,  LQD: 0.58, GLD: 0.22 },
    LQD: { VOO: 0.24, VEA: 0.28, VWO: 0.32, TLT: 0.58, LQD: 1.0,  GLD: 0.15 },
    GLD: { VOO: 0.08, VEA: 0.12, VWO: 0.15, TLT: 0.22, LQD: 0.15, GLD: 1.0 }
};

const RISK_FREE_RATE = 0.045; // Current approx. US T-Bill rate

const ASSET_CLASSES = {
    usLargeCap: { name: 'US Large Cap', etf: 'Vanguard S&P 500 ETF', ticker: 'VOO', return: 0.10, vol: 0.15, er: 0.0003, yield: 0.013, color: '#2563eb', icon: 'fa-landmark', bucket: 'equity' },
    intlDev: { name: 'Intl Developed', etf: 'Vanguard FTSE Developed Markets', ticker: 'VEA', return: 0.07, vol: 0.16, er: 0.0005, yield: 0.031, color: '#7c3aed', icon: 'fa-globe', bucket: 'equity' },
    emerging: { name: 'Emerging Markets', etf: 'Vanguard FTSE Emerging Markets', ticker: 'VWO', return: 0.08, vol: 0.22, er: 0.0008, yield: 0.035, color: '#06b6d4', icon: 'fa-earth-asia', bucket: 'equity' },
    govBonds: { name: 'Government Bonds', etf: 'iShares 20+ Year Treasury Bond', ticker: 'TLT', return: 0.04, vol: 0.10, er: 0.0015, yield: 0.038, color: '#64748b', icon: 'fa-building-columns', bucket: 'fixedIncome' },
    corpBonds: { name: 'Corporate Bonds', etf: 'iShares iBoxx $ Inv Grade Corp', ticker: 'LQD', return: 0.05, vol: 0.07, er: 0.0014, yield: 0.042, color: '#94a3b8', icon: 'fa-file-contract', bucket: 'fixedIncome' },
    gold: { name: 'Gold', etf: 'SPDR Gold Shares', ticker: 'GLD', return: 0.06, vol: 0.14, er: 0.0040, yield: 0.000, color: '#f59e0b', icon: 'fa-coins', bucket: 'metals' },
    usSmallCap: { name: 'US Small Cap', etf: 'iShares Russell 2000 ETF', ticker: 'IWM', return: 0.085, vol: 0.19, er: 0.0019, yield: 0.014, color: '#10b981', icon: 'fa-chart-line', bucket: 'equity' },
    nasdaq100: { name: 'US Technology', etf: 'Invesco QQQ Trust', ticker: 'QQQ', return: 0.115, vol: 0.18, er: 0.0020, yield: 0.006, color: '#22c55e', icon: 'fa-arrow-trend-up', bucket: 'equity' },
    shortTreasury: { name: 'Short-Term Treasury', etf: 'SPDR Bloomberg 1-3 Month T-Bill', ticker: 'BIL', return: 0.045, vol: 0.005, er: 0.0013, yield: 0.051, color: '#38bdf8', icon: 'fa-droplet', bucket: 'cash' },
    muniBonds: { name: 'Municipal Bonds', etf: 'iShares National Muni Bond ETF', ticker: 'MUB', return: 0.045, vol: 0.04, er: 0.0005, yield: 0.028, color: '#818cf8', icon: 'fa-building-columns', bucket: 'fixedIncome' },
    cash: { name: 'Cash Reserve', etf: 'Treasury Bills / Savings Proxy', ticker: 'CASH', return: 0.04, vol: 0.005, er: 0.0000, yield: 0.035, color: '#e2e8f0', icon: 'fa-wallet', bucket: 'cash' },
    btc: { name: 'Bitcoin Satellite', etf: 'BTC Allocation Proxy', ticker: 'BTC', return: 0.14, vol: 0.65, er: 0.0000, yield: 0.000, color: '#f97316', icon: 'fa-coins', bucket: 'alternatives' }
};

const GOAL_CONFIG = {
    wealth: { label: 'Wealth Creation', equityTilt: 8, metalFloor: 5 },
    retirement: { label: 'Retirement Planning', equityTilt: 0, metalFloor: 7 },
    house: { label: 'House / Major Purchase', equityTilt: -12, metalFloor: 5 },
    education: { label: 'Education Corpus', equityTilt: -8, metalFloor: 5 },
    emergency: { label: 'Emergency Reserve', equityTilt: -35, metalFloor: 0 }
};

export function setupPortfolioBuilder() {
    const generateBtn = document.getElementById('generate-portfolio-btn');
    const stressBtn = document.getElementById('portfolio-to-stress-btn');
    const pdfBtn = document.getElementById('portfolio-pdf-btn');
    const addHoldingBtn = document.getElementById('portfolio-add-holding-btn');

    if (generateBtn) generateBtn.addEventListener('click', generatePortfolio);
    if (stressBtn) stressBtn.addEventListener('click', navigateToStressTest);
    if (pdfBtn) pdfBtn.addEventListener('click', exportPortfolioPdf);
    if (addHoldingBtn) addHoldingBtn.addEventListener('click', addCustomHolding);

    // Restore state from sessionStorage if any
    const savedCapital = sessionStorage.getItem('portfolio_param_capital');
    const savedAge = sessionStorage.getItem('portfolio_param_age');
    const savedRisk = sessionStorage.getItem('portfolio_param_risk');
    const savedGoal = sessionStorage.getItem('portfolio_param_goal');
    const savedHorizon = sessionStorage.getItem('portfolio_param_horizon');
    const savedMonthly = sessionStorage.getItem('portfolio_param_monthly');

    if (savedCapital) {
        const input = document.getElementById('portfolio-capital-input');
        if (input) input.value = savedCapital;
    }
    if (savedAge) {
        const input = document.getElementById('portfolio-age-input');
        if (input) input.value = savedAge;
    }
    if (savedRisk) {
        const input = document.getElementById('portfolio-risk-input');
        if (input) input.value = savedRisk;
    }
    if (savedGoal) {
        const input = document.getElementById('portfolio-goal-input');
        if (input) input.value = savedGoal;
    }
    if (savedHorizon) {
        const input = document.getElementById('portfolio-horizon-input');
        if (input) input.value = savedHorizon;
    }
    if (savedMonthly) {
        const input = document.getElementById('portfolio-sip-input');
        if (input) input.value = savedMonthly;
    }

    // Generate initial
    generatePortfolio();
}

function navigateToStressTest() {
    // 1. Read current portfolio parameters
    const capital = document.getElementById('portfolio-capital-input')?.value;
    const age = document.getElementById('portfolio-age-input')?.value;
    const risk = document.getElementById('portfolio-risk-input')?.value;

    // 2. Sync them into sessionStorage
    if (capital) {
        sessionStorage.setItem('portfolio_param_capital', capital);
        sessionStorage.setItem('stress_param_capital', capital);
    }
    if (age) {
        sessionStorage.setItem('portfolio_param_age', age);
        sessionStorage.setItem('stress_param_age', age);
    }
    if (risk) {
        sessionStorage.setItem('portfolio_param_risk', risk);
        sessionStorage.setItem('stress_param_risk', risk);
    }
    sessionStorage.setItem('stress_param_autorun', 'true');

    // 3. Redirect to stress.html
    window.location.href = 'stress.html';
}

function generatePortfolio() {
    const age = parseInt(document.getElementById('portfolio-age-input')?.value) || 30;
    const risk = document.getElementById('portfolio-risk-input')?.value || 'moderate';
    const initialCapital = parseFloat(document.getElementById('portfolio-capital-input')?.value) || 100000;
    const goal = document.getElementById('portfolio-goal-input')?.value || 'wealth';
    const horizon = clampNumber(parseInt(document.getElementById('portfolio-horizon-input')?.value) || 10, 1, 40);
    const target = Math.max(0, parseFloat(document.getElementById('portfolio-target-input')?.value) || 0);
    const monthlyContribution = Math.max(0, parseFloat(document.getElementById('portfolio-sip-input')?.value) || 0);
    const stepUp = clampNumber(parseFloat(document.getElementById('portfolio-stepup-input')?.value) || 0, 0, 25) / 100;

    // Sync current values to sessionStorage so they can be imported on the stress page
    sessionStorage.setItem('portfolio_param_capital', String(initialCapital));
    sessionStorage.setItem('portfolio_param_age', String(age));
    sessionStorage.setItem('portfolio_param_risk', risk);
    sessionStorage.setItem('portfolio_param_goal', goal);
    sessionStorage.setItem('portfolio_param_horizon', String(horizon));
    sessionStorage.setItem('portfolio_param_monthly', String(monthlyContribution));

    currentPortfolioContext = { age, risk, initialCapital, goal, horizon, target, monthlyContribution, stepUp };

    // Macro Allocation (Tier 1)
    const goalConfig = GOAL_CONFIG[goal] || GOAL_CONFIG.wealth;
    let baseEquity = Math.max(0, Math.min(100, 110 - age));
    baseEquity += goalConfig.equityTilt;
    if (horizon <= 3) baseEquity -= 25;
    else if (horizon <= 5) baseEquity -= 12;
    else if (horizon >= 15) baseEquity += 8;
    baseEquity = clampNumber(baseEquity, 10, 95);
    let equity = baseEquity;
    let fixedIncome = 100 - baseEquity;
    let metals = goalConfig.metalFloor;

    if (risk === 'aggressive') {
        equity = Math.min(100, baseEquity + 15);
        fixedIncome = 100 - equity;
    } else if (risk === 'conservative') {
        equity = Math.max(0, baseEquity - 15);
        fixedIncome = 100 - equity;
    }

    if (risk === 'conservative') metals = Math.max(metals, 10);
    else if (risk === 'aggressive') metals = Math.max(0, metals - 3);
    fixedIncome -= metals;

    if (fixedIncome < 0) fixedIncome = 0;
    
    const total = equity + fixedIncome + metals;
    equity = Math.round((equity / total) * 100);
    metals = Math.round((metals / total) * 100);
    fixedIncome = 100 - equity - metals;

    // Micro Allocation for Projection (Tier 2/3)
    currentSubAllocations = calculateSubAllocations(equity, fixedIncome, metals, risk).map((asset) => ({
        ...asset,
        targetWeight: asset.weight
    }));
    currentTargetAllocations = Object.fromEntries(currentSubAllocations.map((asset) => [asset.ticker, asset.weight]));
    
    updatePortfolioRender(currentSubAllocations, initialCapital);

    // Animate card reveals
    animateCardReveals();
}

function calculateSubAllocations(equity, fixedIncome, metals, risk) {
    let eqUS = 0.70, eqIntl = 0.20, eqEM = 0.10;
    let fiGov = 0.60, fiCorp = 0.40;

    if (risk === 'aggressive') {
        eqUS = 0.60; eqIntl = 0.20; eqEM = 0.20;
        fiGov = 0.50; fiCorp = 0.50;
    } else if (risk === 'conservative') {
        eqUS = 0.80; eqIntl = 0.15; eqEM = 0.05;
        fiGov = 0.70; fiCorp = 0.30;
    }

    const allocations = [];

    if (equity > 0) {
        allocations.push({ ...ASSET_CLASSES.usLargeCap, weight: equity * eqUS });
        allocations.push({ ...ASSET_CLASSES.intlDev, weight: equity * eqIntl });
        allocations.push({ ...ASSET_CLASSES.emerging, weight: equity * eqEM });
    }
    if (fixedIncome > 0) {
        allocations.push({ ...ASSET_CLASSES.govBonds, weight: fixedIncome * fiGov });
        allocations.push({ ...ASSET_CLASSES.corpBonds, weight: fixedIncome * fiCorp });
    }
    if (metals > 0) {
        allocations.push({ ...ASSET_CLASSES.gold, weight: metals });
    }

    return allocations;
}

// ── Portfolio Summary KPI Bar ──────────────────────────────────
function renderPortfolioSummaryBar(allocations, initialCapital) {
    const target = document.getElementById('portfolio-kpi-bar');
    if (!target) return;

    const { weightedReturn, weightedER, weightedYield } = calculatePortfolioStats(allocations);

    const portfolioVol = calculatePortfolioVolatility(allocations);
    const sharpe = portfolioVol > 0 ? (weightedReturn - RISK_FREE_RATE) / portfolioVol : 0;
    const horizon = currentPortfolioContext.horizon || 10;
    const projection = projectPortfolioValue(
        initialCapital,
        currentPortfolioContext.monthlyContribution || 0,
        currentPortfolioContext.stepUp || 0,
        weightedReturn,
        horizon
    );

    const kpis = [
        { label: 'Expected Return', value: (weightedReturn * 100).toFixed(2), suffix: '%', accent: 'var(--neon-green-positive)' },
        { label: 'Portfolio Risk (σ)', value: (portfolioVol * 100).toFixed(2), suffix: '%', accent: '#f59e0b' },
        { label: 'Sharpe Ratio', value: sharpe.toFixed(2), suffix: '', accent: 'var(--neon-cyan-vibrant)' },
        { label: 'Weighted Exp. Ratio', value: (weightedER * 100).toFixed(3), suffix: '%', accent: '#94a3b8' },
        { label: 'Dividend Yield', value: (weightedYield * 100).toFixed(2), suffix: '%', accent: '#7c3aed' },
        { label: `${horizon}Y Projected Value`, value: formatCurrency(projection.finalValue), suffix: '', accent: '#2563eb' }
    ];

    target.innerHTML = kpis.map(kpi => `
        <div class="portfolio-kpi-tile">
            <div class="kpi-accent" style="background: ${kpi.accent}"></div>
            <div class="kpi-body">
                <span class="kpi-value" data-target="${kpi.value}" style="color: ${kpi.accent}">${kpi.value}${kpi.suffix}</span>
                <span class="kpi-label">${kpi.label}</span>
            </div>
        </div>
    `).join('');

    // Animate the KPI values with a counter effect
    animateKPICounters(target);
}

// ── ETF Holdings Table ─────────────────────────────────────────
function renderETFHoldingsTable(allocations, initialCapital) {
    const tbody = document.getElementById('portfolio-etf-tbody');
    if (!tbody) return;

    const sorted = [...allocations].sort((a, b) => b.weight - a.weight);

    let totalWeight = 0;
    let totalTarget = 0;
    let totalAllocation = 0;
    let totalAbsDrift = 0;

    tbody.innerHTML = sorted.map((a, i) => {
        const dollarValue = (a.weight / 100) * initialCapital;
        const targetWeight = a.targetWeight ?? currentTargetAllocations[a.ticker] ?? 0;
        const drift = a.weight - targetWeight;
        totalWeight += a.weight;
        totalTarget += targetWeight;
        totalAllocation += dollarValue;
        totalAbsDrift += Math.abs(drift);
        const driftClass = Math.abs(drift) < 0.5 ? 'neutral-drift' : drift > 0 ? 'positive-drift' : 'negative-drift';
        return `
            <tr class="etf-row" style="animation-delay: ${i * 60}ms">
                <td>
                    <div class="etf-asset-cell">
                        <div class="etf-color-indicator" style="background: ${a.color}"></div>
                        <div class="etf-name-stack">
                            <span class="etf-primary-name">${a.name}</span>
                            <span class="etf-secondary-name">${a.etf}</span>
                        </div>
                    </div>
                </td>
                <td><span class="etf-ticker-badge">${a.ticker}</span></td>
                <td class="num-col" style="padding-top: 8px; padding-bottom: 8px;">
                    <div class="weight-cell" style="display: flex; align-items: center; justify-content: flex-end;">
                        <input type="number" class="etf-weight-input font-mono" data-ticker="${a.ticker}" value="${a.weight.toFixed(1)}" min="0" max="100" step="0.5">
                        <div class="weight-bar-track" style="width: 40px; height: 4px; background: rgba(255,255,255,0.05); margin-left: 8px; border-radius: 2px; overflow: hidden; position: relative;">
                            <div class="weight-bar-fill" style="width: ${a.weight}%; height: 100%; background: ${a.color}; border-radius: 2px;"></div>
                        </div>
                    </div>
                </td>
                <td class="num-col font-mono">${targetWeight.toFixed(1)}%</td>
                <td class="num-col font-mono ${driftClass}">${drift >= 0 ? '+' : ''}${drift.toFixed(1)}%</td>
                <td class="num-col font-mono">${formatCurrency(dollarValue)}</td>
                <td class="num-col pos-change font-mono">${(a.return * 100).toFixed(1)}%</td>
                <td class="num-col font-mono">${(a.vol * 100).toFixed(1)}%</td>
                <td class="num-col fees-col font-mono">${(a.er * 100).toFixed(2)}%</td>
                <td class="num-col"><button class="portfolio-row-action" data-ticker="${a.ticker}" title="Remove holding"><i class="fa-solid fa-xmark"></i></button></td>
            </tr>
        `;
    }).join('');

    const footerWeight = document.getElementById('etf-total-weight');
    const footerTarget = document.getElementById('etf-total-target');
    const footerDrift = document.getElementById('etf-total-drift');
    const footerAllocation = document.getElementById('etf-total-allocation');
    if (footerWeight) footerWeight.textContent = totalWeight.toFixed(1) + '%';
    if (footerTarget) footerTarget.textContent = totalTarget.toFixed(1) + '%';
    if (footerDrift) footerDrift.textContent = totalAbsDrift.toFixed(1) + '%';
    if (footerAllocation) footerAllocation.textContent = formatCurrency(totalAllocation);
    renderDriftSummary(totalAbsDrift);

    tbody.querySelectorAll('.etf-weight-input').forEach(input => {
        input.addEventListener('change', handleWeightChange);
        input.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') handleWeightChange(e);
        });
    });

    tbody.querySelectorAll('.portfolio-row-action').forEach((button) => {
        button.addEventListener('click', () => removeHolding(button.dataset.ticker));
    });
}

// ── Enhanced Doughnut Chart ────────────────────────────────────
function renderPortfolioDoughnut(dataArr, initialCapital) {
    const macroColors = ['#2563eb', '#64748b', '#f59e0b'];
    const macroLabels = ['Equity', 'Fixed Income', 'Metals'];
    const canvas = document.getElementById('portfolioPieChart');
    if (!canvas) return;

    if (portfolioChartInstance) portfolioChartInstance.destroy();
    portfolioChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: { 
            labels: macroLabels, 
            datasets: [{ 
                data: dataArr, 
                backgroundColor: macroColors, 
                borderWidth: 0,
                hoverBorderWidth: 2,
                hoverBorderColor: '#fff',
                spacing: 2,
                borderRadius: 4
            }] 
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: { 
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(13, 19, 38, 0.95)',
                    titleFont: { family: "'Inter', sans-serif", weight: 600 },
                    bodyFont: { family: "'JetBrains Mono', monospace" },
                    borderColor: 'rgba(6, 182, 212, 0.3)',
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 12,
                    callbacks: {
                        label: function(ctx) {
                            const val = ctx.parsed;
                            const dollarVal = (val / 100) * initialCapital;
                            return ` ${ctx.label}: ${val}% ($${dollarVal.toLocaleString()})`;
                        }
                    }
                }
            },
            animation: {
                animateRotate: true,
                duration: 800,
                easing: 'easeOutQuart'
            }
        }
    });

    // Center text
    const centerText = document.getElementById('doughnut-center-text');
    if (centerText) {
        centerText.innerHTML = `
            <span class="center-capital-label">Total Capital</span>
            <span class="center-capital-value">${formatCurrency(initialCapital)}</span>
        `;
    }

    // Legend
    const legendTarget = document.getElementById('portfolio-legend-target');
    if (legendTarget) {
        legendTarget.innerHTML = macroLabels.map((label, i) => {
            const sublabel = ['Alpha & Growth Assets', 'Income & Stability', 'Inflation Hedge'][i];
            return `
                <div class="legend-node-pro">
                    <div class="legend-node-left">
                        <div class="legend-color-dot-pro" style="background: ${macroColors[i]}"></div>
                        <div class="legend-text-group">
                            <span class="legend-primary">${label}</span>
                            <span class="legend-secondary">${sublabel}</span>
                        </div>
                    </div>
                    <div class="legend-node-right">
                        <span class="legend-pct">${dataArr[i]}%</span>
                        <div class="legend-bar-track"><div class="legend-bar-fill" style="width: ${dataArr[i]}%; background: ${macroColors[i]}"></div></div>
                    </div>
                </div>
            `;
        }).join('');
    }
}

// ── 10-Year Projection with Scenario Bands ─────────────────────
function calculateAndRenderProjection(allocations, initialCapital) {
    const { weightedReturn } = calculatePortfolioStats(allocations);

    const portfolioVol = calculatePortfolioVolatility(allocations);

    const years = currentPortfolioContext.horizon || 10;
    const monthlyContribution = currentPortfolioContext.monthlyContribution || 0;
    const stepUp = currentPortfolioContext.stepUp || 0;
    const labels = [];
    const baseData = [];
    const optimisticData = [];
    const pessimisticData = [];

    let baseVal = initialCapital;
    let optVal = initialCapital;
    let pessVal = initialCapital;

    for (let i = 0; i <= years; i++) {
        labels.push(i === 0 ? 'Today' : `Yr ${i}`);
        baseData.push(Math.round(baseVal));
        optimisticData.push(Math.round(optVal));
        pessimisticData.push(Math.round(pessVal));

        // Projections compound dynamically using standard deviation envelopes
        const t = i + 1;
        const optReturn = weightedReturn + portfolioVol * (Math.sqrt(t) - Math.sqrt(i));
        const pessReturn = Math.max(0.001, weightedReturn - portfolioVol * (Math.sqrt(t) - Math.sqrt(i)));

        const yearlyContribution = monthlyContribution * 12 * Math.pow(1 + stepUp, i);
        baseVal = baseVal * (1 + weightedReturn) + yearlyContribution;
        optVal = optVal * (1 + optReturn) + yearlyContribution;
        pessVal = pessVal * (1 + pessReturn) + yearlyContribution;
    }

    const cagrPercent = (weightedReturn * 100).toFixed(2);
    const volPercent = (portfolioVol * 100).toFixed(2);
    const desc = document.getElementById('portfolio-projection-desc');
    if (desc) {
        desc.textContent = `Base CAGR: ${cagrPercent}% · Volatility: ${volPercent}% · Horizon: ${years} years`;
    }

    const canvas = document.getElementById('portfolioProjectionChart');
    if (!canvas) return;

    if (projectionChartInstance) projectionChartInstance.destroy();
    projectionChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Optimistic (+1σ)',
                    data: optimisticData,
                    borderColor: 'rgba(16, 185, 129, 0.4)',
                    backgroundColor: 'rgba(16, 185, 129, 0.05)',
                    borderWidth: 1,
                    borderDash: [4, 4],
                    fill: false,
                    tension: 0.35,
                    pointRadius: 0
                },
                {
                    label: 'Base Case',
                    data: baseData,
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.08)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 4,
                    pointBackgroundColor: '#06b6d4',
                    pointBorderColor: '#0d1326',
                    pointBorderWidth: 2,
                    pointHoverRadius: 6
                },
                {
                    label: 'Pessimistic (-1σ)',
                    data: pessimisticData,
                    borderColor: 'rgba(239, 68, 68, 0.4)',
                    backgroundColor: 'rgba(239, 68, 68, 0.05)',
                    borderWidth: 1,
                    borderDash: [4, 4],
                    fill: false,
                    tension: 0.35,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: {
                        color: '#94a3b8',
                        font: { size: 11, family: "'Inter', sans-serif" },
                        boxWidth: 12,
                        boxHeight: 2,
                        padding: 16,
                        usePointStyle: false
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(13, 19, 38, 0.95)',
                    titleFont: { family: "'Inter', sans-serif", weight: 600 },
                    bodyFont: { family: "'JetBrains Mono', monospace", size: 12 },
                    borderColor: 'rgba(6, 182, 212, 0.3)',
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 12,
                    callbacks: {
                        label: function(ctx) {
                            return ` ${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    ticks: {
                        callback: function(val) {
                            if (val >= 1000000) return '$' + (val / 1000000).toFixed(1) + 'M';
                            if (val >= 1000) return '$' + (val / 1000).toFixed(0) + 'K';
                            return '$' + val.toLocaleString();
                        },
                        color: '#64748b',
                        font: { family: "'JetBrains Mono', monospace", size: 11 }
                    },
                    grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false }
                },
                x: {
                    ticks: { color: '#64748b', font: { size: 11 } },
                    grid: { display: false }
                }
            }
        }
    });
}

// ── Risk-Return Scatter (Bubble Chart) ─────────────────────────
function renderRiskReturnScatter(allocations) {
    const canvas = document.getElementById('portfolioScatterChart');
    if (!canvas) return;

    const bubbleData = allocations.filter(a => a.weight > 0).map(a => ({
        x: a.vol * 100,
        y: a.return * 100,
        r: Math.max(6, Math.sqrt(a.weight) * 4),
        label: a.name,
        ticker: a.ticker,
        weight: a.weight,
        color: a.color
    }));

    if (scatterChartInstance) scatterChartInstance.destroy();
    scatterChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'bubble',
        data: {
            datasets: bubbleData.map(b => ({
                label: b.label,
                data: [{ x: b.x, y: b.y, r: b.r }],
                backgroundColor: b.color + '55',
                borderColor: b.color,
                borderWidth: 2,
                hoverBackgroundColor: b.color + '88',
                hoverBorderWidth: 3
            }))
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        color: '#94a3b8',
                        font: { size: 11, family: "'Inter', sans-serif" },
                        boxWidth: 10,
                        boxHeight: 10,
                        padding: 14,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(13, 19, 38, 0.95)',
                    titleFont: { family: "'Inter', sans-serif", weight: 600 },
                    bodyFont: { family: "'JetBrains Mono', monospace", size: 12 },
                    borderColor: 'rgba(6, 182, 212, 0.3)',
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 12,
                    callbacks: {
                        title: function(ctx) {
                            const ds = ctx[0].dataset;
                            return ds.label;
                        },
                        label: function(ctx) {
                            const d = ctx.raw;
                            const matchedAlloc = allocations.find(a => Math.abs(a.vol * 100 - d.x) < 0.01);
                            return [
                                ` Return: ${d.y.toFixed(1)}%`,
                                ` Volatility: ${d.x.toFixed(1)}%`,
                                ` Weight: ${matchedAlloc ? matchedAlloc.weight.toFixed(1) : '?'}%`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Annual Volatility (%)', color: '#64748b', font: { size: 12, weight: 500 } },
                    ticks: { color: '#64748b', font: { family: "'JetBrains Mono', monospace", size: 11 }, callback: v => v + '%' },
                    grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
                    min: 0
                },
                y: {
                    title: { display: true, text: 'Expected Annual Return (%)', color: '#64748b', font: { size: 12, weight: 500 } },
                    ticks: { color: '#64748b', font: { family: "'JetBrains Mono', monospace", size: 11 }, callback: v => v + '%' },
                    grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
                    min: 0
                }
            }
        }
    });
}

// ── Utilities ──────────────────────────────────────────────────
function formatCurrency(val) {
    const sign = val < 0 ? '-' : '';
    const abs = Math.abs(val);
    if (abs >= 1000000) return sign + '$' + (abs / 1000000).toFixed(2) + 'M';
    if (abs >= 1000) return sign + '$' + (abs / 1000).toFixed(1) + 'K';
    return sign + '$' + abs.toFixed(0);
}

function animateKPICounters(container) {
    const tiles = container.querySelectorAll('.portfolio-kpi-tile');
    tiles.forEach((tile, i) => {
        tile.style.opacity = '0';
        tile.style.transform = 'translateY(12px)';
        setTimeout(() => {
            tile.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            tile.style.opacity = '1';
            tile.style.transform = 'translateY(0)';
        }, i * 80);
    });
}

function animateCardReveals() {
    const cards = document.querySelectorAll('#dashboard-portfolio .portfolio-reveal-card');
    cards.forEach((card, i) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(16px)';
        setTimeout(() => {
            card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, 150 + i * 100);
    });
}

function updatePortfolioRender(subAllocations, initialCapital) {
    let equity = 0, fixedIncome = 0, metals = 0, other = 0;
    subAllocations.forEach(a => {
        if (a.bucket === 'equity') equity += a.weight;
        else if (a.bucket === 'fixedIncome' || a.bucket === 'cash') fixedIncome += a.weight;
        else if (a.bucket === 'metals') metals += a.weight;
        else other += a.weight;
    });
    if (other > 0) equity += other;

    renderPortfolioDoughnut([equity, fixedIncome, metals], initialCapital);
    renderPortfolioSummaryBar(subAllocations, initialCapital);
    renderETFHoldingsTable(subAllocations, initialCapital);
    calculateAndRenderProjection(subAllocations, initialCapital);
    renderRiskReturnScatter(subAllocations);
    renderPortfolioCommandCenter(subAllocations, initialCapital);
}

function calculatePortfolioVolatility(allocations) {
    let variance = 0;
    const active = allocations.filter(a => a.weight > 0);
    if (active.length === 0) return 0;
    
    active.forEach(a => {
        const w = a.weight / 100;
        variance += Math.pow(w * a.vol, 2);
    });
    
    for (let i = 0; i < active.length; i++) {
        for (let j = i + 1; j < active.length; j++) {
            const assetA = active[i];
            const assetB = active[j];
            const wA = assetA.weight / 100;
            const wB = assetB.weight / 100;
            const corr = getAssetCorrelation(assetA, assetB);
            variance += 2 * wA * wB * assetA.vol * assetB.vol * corr;
        }
    }
    
    return Math.sqrt(variance);
}

function calculatePortfolioStats(allocations) {
    return allocations.reduce((stats, asset) => {
        const w = asset.weight / 100;
        stats.weightedReturn += w * asset.return;
        stats.weightedER += w * asset.er;
        stats.weightedYield += w * asset.yield;
        return stats;
    }, { weightedReturn: 0, weightedER: 0, weightedYield: 0 });
}

function getAssetCorrelation(assetA, assetB) {
    if (assetA.ticker === assetB.ticker) return 1;
    const direct = CORRELATION_MATRIX[assetA.ticker]?.[assetB.ticker];
    if (direct != null) return direct;
    if (assetA.bucket === assetB.bucket) {
        if (assetA.bucket === 'equity') return 0.75;
        if (assetA.bucket === 'fixedIncome') return 0.55;
        if (assetA.bucket === 'cash') return 0.15;
        return 0.35;
    }
    if (assetA.bucket === 'cash' || assetB.bucket === 'cash') return 0.05;
    if (assetA.bucket === 'metals' || assetB.bucket === 'metals') return 0.15;
    if (assetA.bucket === 'alternatives' || assetB.bucket === 'alternatives') return 0.25;
    return 0.2;
}

function projectPortfolioValue(initialCapital, monthlyContribution, stepUp, annualReturn, years) {
    let value = initialCapital;
    let totalContributed = initialCapital;
    for (let year = 0; year < years; year++) {
        const yearlyContribution = monthlyContribution * 12 * Math.pow(1 + stepUp, year);
        value = value * (1 + annualReturn) + yearlyContribution;
        totalContributed += yearlyContribution;
    }
    return { finalValue: value, totalContributed };
}

function calculateHealthScore(allocations, initialCapital) {
    const { weightedReturn, weightedER } = calculatePortfolioStats(allocations);
    const volatility = calculatePortfolioVolatility(allocations);
    const projection = projectPortfolioValue(
        initialCapital,
        currentPortfolioContext.monthlyContribution || 0,
        currentPortfolioContext.stepUp || 0,
        weightedReturn,
        currentPortfolioContext.horizon || 10
    );
    const target = currentPortfolioContext.target || 0;
    const goalProgress = target > 0 ? Math.min(1, projection.finalValue / target) : 0.75;
    const activeCount = allocations.filter((a) => a.weight > 1).length;
    const diversificationScore = Math.min(1, activeCount / 6);
    const riskFit = currentPortfolioContext.risk === 'aggressive'
        ? Math.max(0, 1 - Math.abs(volatility - 0.18) / 0.22)
        : currentPortfolioContext.risk === 'conservative'
            ? Math.max(0, 1 - Math.abs(volatility - 0.08) / 0.18)
            : Math.max(0, 1 - Math.abs(volatility - 0.13) / 0.2);
    const costScore = Math.max(0, 1 - weightedER / 0.006);
    const score = Math.round(100 * (
        goalProgress * 0.3 +
        diversificationScore * 0.25 +
        riskFit * 0.3 +
        costScore * 0.15
    ));
    return { score: clampNumber(score, 0, 100), projection, volatility, weightedReturn, weightedER, goalProgress, diversificationScore, riskFit };
}

function renderPortfolioCommandCenter(allocations, initialCapital) {
    const scoreEl = document.getElementById('portfolio-health-score');
    const labelEl = document.getElementById('portfolio-health-label');
    const driversEl = document.getElementById('portfolio-health-drivers');
    const projectedEl = document.getElementById('portfolio-goal-projected');
    const gapEl = document.getElementById('portfolio-goal-gap');
    const signalEl = document.getElementById('portfolio-goal-signal');
    const summaryEl = document.getElementById('portfolio-goal-summary');
    if (!scoreEl) return;

    const health = calculateHealthScore(allocations, initialCapital);
    const target = currentPortfolioContext.target || 0;
    const gap = health.projection.finalValue - target;
    const signal = target <= 0 ? 'Tracking' : gap >= 0 ? 'On Track' : 'Needs Boost';
    const goalLabel = GOAL_CONFIG[currentPortfolioContext.goal]?.label || 'Wealth Creation';

    scoreEl.textContent = String(health.score);
    labelEl.textContent = health.score >= 80 ? 'Strong Setup' : health.score >= 65 ? 'Balanced, Watch Risk' : health.score >= 50 ? 'Needs Tuning' : 'High Attention';
    driversEl.innerHTML = `
        <span>Diversification: ${(health.diversificationScore * 100).toFixed(0)}%</span>
        <span>Risk fit: ${(health.riskFit * 100).toFixed(0)}%</span>
        <span>Expense drag: ${(health.weightedER * 100).toFixed(2)}%</span>
    `;

    if (projectedEl) projectedEl.textContent = formatCurrency(health.projection.finalValue);
    if (gapEl) {
        gapEl.textContent = target > 0 ? `${gap >= 0 ? '+' : ''}${formatCurrency(gap)}` : '--';
        gapEl.style.color = gap >= 0 ? '#10b981' : '#f59e0b';
    }
    if (signalEl) {
        signalEl.textContent = signal;
        signalEl.style.color = signal === 'On Track' ? '#10b981' : '#f59e0b';
    }
    if (summaryEl) {
        const monthly = formatCurrency(currentPortfolioContext.monthlyContribution || 0);
        summaryEl.textContent = `${goalLabel} over ${currentPortfolioContext.horizon || 10} years with ${monthly}/month and ${(currentPortfolioContext.stepUp || 0) * 100}% annual step-up.`;
    }
}

function renderDriftSummary(totalAbsDrift) {
    const summary = document.getElementById('portfolio-drift-summary');
    if (!summary) return;
    const largest = [...currentSubAllocations]
        .map((asset) => ({ ...asset, drift: asset.weight - (asset.targetWeight ?? 0) }))
        .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))[0];
    if (!largest || totalAbsDrift < 1) {
        summary.innerHTML = '<span class="drift-ok">Portfolio is close to target weights.</span>';
        return;
    }
    summary.innerHTML = `
        <span class="drift-watch">Total drift: ${totalAbsDrift.toFixed(1)}%</span>
        <span>Largest move: ${largest.ticker} ${largest.drift >= 0 ? '+' : ''}${largest.drift.toFixed(1)}% vs target.</span>
    `;
}

function addCustomHolding() {
    const select = document.getElementById('portfolio-add-asset-select');
    const weightInput = document.getElementById('portfolio-add-weight-input');
    const key = select?.value;
    const template = ASSET_CLASSES[key];
    if (!template) return;
    const desiredWeight = clampNumber(parseFloat(weightInput?.value) || 5, 1, 25);
    const existing = currentSubAllocations.find((asset) => asset.ticker === template.ticker);
    if (existing) {
        existing.weight = clampNumber(existing.weight + desiredWeight, 0, 100);
    } else {
        currentSubAllocations.push({ ...template, weight: desiredWeight, targetWeight: 0 });
    }
    scaleOtherHoldings(template.ticker, desiredWeight);
    normalizeWeights();
    updatePortfolioRender(currentSubAllocations, parseFloat(document.getElementById('portfolio-capital-input')?.value) || 100000);
}

function removeHolding(ticker) {
    if (currentSubAllocations.length <= 1) return;
    const removed = currentSubAllocations.find((asset) => asset.ticker === ticker);
    currentSubAllocations = currentSubAllocations.filter((asset) => asset.ticker !== ticker);
    const redistribute = removed?.weight || 0;
    const total = currentSubAllocations.reduce((sum, asset) => sum + asset.weight, 0);
    currentSubAllocations.forEach((asset) => {
        asset.weight += total > 0 ? redistribute * (asset.weight / total) : redistribute / currentSubAllocations.length;
    });
    normalizeWeights();
    updatePortfolioRender(currentSubAllocations, parseFloat(document.getElementById('portfolio-capital-input')?.value) || 100000);
}

function scaleOtherHoldings(ticker, addedWeight) {
    const others = currentSubAllocations.filter((asset) => asset.ticker !== ticker);
    const total = others.reduce((sum, asset) => sum + asset.weight, 0);
    if (total <= 0) return;
    others.forEach((asset) => {
        asset.weight = Math.max(0, asset.weight - addedWeight * (asset.weight / total));
    });
}

function normalizeWeights() {
    const total = currentSubAllocations.reduce((sum, asset) => sum + asset.weight, 0);
    if (total <= 0) return;
    currentSubAllocations.forEach((asset) => {
        asset.weight = (asset.weight / total) * 100;
    });
}

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function handleWeightChange(e) {
    const input = e.target;
    const ticker = input.getAttribute('data-ticker');
    let newVal = parseFloat(input.value);
    if (isNaN(newVal) || newVal < 0) newVal = 0;
    if (newVal > 100) newVal = 100;
    
    const targetAsset = currentSubAllocations.find(a => a.ticker === ticker);
    if (!targetAsset) return;
    const oldVal = targetAsset.weight;
    const diff = newVal - oldVal;
    
    targetAsset.weight = newVal;
    
    const others = currentSubAllocations.filter(a => a.ticker !== ticker);
    const othersSum = others.reduce((sum, a) => sum + a.weight, 0);
    
    if (othersSum > 0) {
        others.forEach(a => {
            a.weight = Math.max(0, a.weight - diff * (a.weight / othersSum));
        });
    } else if (others.length > 0) {
        const share = -diff / others.length;
        others.forEach(a => {
            a.weight = Math.max(0, share);
        });
    }
    
    const newSum = currentSubAllocations.reduce((sum, a) => sum + a.weight, 0);
    if (newSum > 0) {
        currentSubAllocations.forEach(a => {
            a.weight = (a.weight / newSum) * 100;
        });
    }
    
    const initialCapital = parseFloat(document.getElementById('portfolio-capital-input')?.value) || 100000;
    updatePortfolioRender(currentSubAllocations, initialCapital);
}

async function exportPortfolioPdf() {
    if (!window.html2pdf) {
        import('../utils.js').then(({ showToast }) => showToast('PDF library is still loading...'));
        return;
    }

    const initialCapital = parseFloat(document.getElementById('portfolio-capital-input')?.value) || 100000;
    const age = parseInt(document.getElementById('portfolio-age-input')?.value) || 30;
    const risk = document.getElementById('portfolio-risk-input')?.value || 'moderate';

    const pieCanvas = document.getElementById('portfolioPieChart');
    const projCanvas = document.getElementById('portfolioProjectionChart');
    const scatterCanvas = document.getElementById('portfolioScatterChart');

    const pieImg = pieCanvas ? pieCanvas.toDataURL('image/png') : '';
    const projImg = projCanvas ? projCanvas.toDataURL('image/png') : '';
    const scatterImg = scatterCanvas ? scatterCanvas.toDataURL('image/png') : '';

    let totalReturn = 0;
    let totalER = 0;
    let totalYield = 0;
    currentSubAllocations.forEach(a => {
        const w = a.weight / 100;
        totalReturn += w * a.return;
        totalER += w * a.er;
        totalYield += w * a.yield;
    });
    const totalVol = calculatePortfolioVolatility(currentSubAllocations);
    const sharpe = totalVol > 0 ? (totalReturn - RISK_FREE_RATE) / totalVol : 0;

    const tableRowsHtml = currentSubAllocations.map(a => `
        <tr>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb;"><strong>${a.name}</strong><br><span style="font-size: 9px; color: #6b7280;">${a.etf}</span></td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-family: monospace;">${a.ticker}</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-family: monospace; text-align: right;">${a.weight.toFixed(1)}%</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-family: monospace; text-align: right;">$${((a.weight / 100) * initialCapital).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-family: monospace; text-align: right; color: #10b981;">${(a.return * 100).toFixed(1)}%</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-family: monospace; text-align: right;">${(a.vol * 100).toFixed(1)}%</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-family: monospace; text-align: right;">${(a.yield * 100).toFixed(2)}%</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-family: monospace; text-align: right;">${(a.er * 100).toFixed(2)}%</td>
        </tr>
    `).join('');

    const element = document.createElement('div');
    element.style.position = 'absolute';
    element.style.left = '-9999px';
    element.style.top = '0';
    element.style.width = '750px';
    element.style.background = '#ffffff';
    element.style.zIndex = '1';

    element.innerHTML = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937; padding: 40px; line-height: 1.5;">
            <!-- Header -->
            <div style="border-bottom: 2px solid #111827; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end;">
                <div>
                    <h1 style="margin: 0; font-size: 28px; color: #111827; font-weight: 800; letter-spacing: 0.5px;">STRATA</h1>
                    <p style="margin: 4px 0 0 0; font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 1.5px;">Institutional Portfolio Architect</p>
                </div>
                <div style="text-align: right;">
                    <p style="margin: 0; font-size: 12px; font-weight: bold; color: #111827;">PORTFOLIO ARCHITECT SUMMARY</p>
                    <p style="margin: 4px 0 0 0; font-size: 10px; color: #6b7280;">Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
            </div>
            
            <!-- Parameters -->
            <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin-bottom: 24px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; font-size: 12px; border-left: 4px solid #3b82f6;">
                <div><strong>Initial Capital:</strong> $${initialCapital.toLocaleString()}</div>
                <div><strong>Investor Age:</strong> ${age} Years</div>
                <div><strong>Risk Profile:</strong> ${risk.toUpperCase()}</div>
            </div>

            <!-- Metrics -->
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; text-align: center;">
                <div style="border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; background: #fafafa;">
                    <div style="font-size: 10px; text-transform: uppercase; color: #6b7280; margin-bottom: 4px;">Expected Return</div>
                    <div style="font-size: 20px; font-weight: bold; color: #10b981;">${(totalReturn * 100).toFixed(2)}%</div>
                </div>
                <div style="border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; background: #fafafa;">
                    <div style="font-size: 10px; text-transform: uppercase; color: #6b7280; margin-bottom: 4px;">Portfolio Risk (σ)</div>
                    <div style="font-size: 20px; font-weight: bold; color: #f59e0b;">${(totalVol * 100).toFixed(2)}%</div>
                </div>
                <div style="border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; background: #fafafa;">
                    <div style="font-size: 10px; text-transform: uppercase; color: #6b7280; margin-bottom: 4px;">Sharpe Ratio</div>
                    <div style="font-size: 20px; font-weight: bold; color: #2563eb;">${sharpe.toFixed(2)}</div>
                </div>
            </div>

            <h3 style="font-size: 14px; margin: 24px 0 8px 0; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; font-weight: bold; color: #111827;">ETF-Level Holdings Breakdown</h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 28px;">
                <thead>
                    <tr style="background: #f3f4f6; border-bottom: 1px solid #d1d5db;">
                        <th style="padding: 8px; text-align: left; color: #111827; font-weight: bold;">Asset Class</th>
                        <th style="padding: 8px; text-align: left; color: #111827; font-weight: bold;">Ticker</th>
                        <th style="padding: 8px; text-align: right; color: #111827; font-weight: bold;">Weight</th>
                        <th style="padding: 8px; text-align: right; color: #111827; font-weight: bold;">Allocation</th>
                        <th style="padding: 8px; text-align: right; color: #111827; font-weight: bold;">Return</th>
                        <th style="padding: 8px; text-align: right; color: #111827; font-weight: bold;">Volatility</th>
                        <th style="padding: 8px; text-align: right; color: #111827; font-weight: bold;">Yield</th>
                        <th style="padding: 8px; text-align: right; color: #111827; font-weight: bold;">Exp. Ratio</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRowsHtml}
                </tbody>
            </table>

            <div style="page-break-before: always; padding-top: 20px;">
                <h3 style="font-size: 14px; margin-bottom: 16px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; font-weight: bold; color: #111827;">Allocation & Projections</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px;">
                    <div style="border: 1px solid #e5e7eb; padding: 12px; border-radius: 6px; text-align: center;">
                        <h4 style="margin: 0 0 10px 0; font-size: 11px; text-transform: uppercase; color: #6b7280;">Strategic Allocation</h4>
                        ${pieImg ? `<img src="${pieImg}" style="width: 240px; height: auto; max-height: 180px;">` : 'Image Error'}
                    </div>
                    <div style="border: 1px solid #e5e7eb; padding: 12px; border-radius: 6px; text-align: center;">
                        <h4 style="margin: 0 0 10px 0; font-size: 11px; text-transform: uppercase; color: #6b7280;">Risk-Return Profile</h4>
                        ${scatterImg ? `<img src="${scatterImg}" style="width: 240px; height: auto; max-height: 180px;">` : 'Image Error'}
                    </div>
                </div>

                <div style="border: 1px solid #e5e7eb; padding: 16px; border-radius: 6px; text-align: center;">
                    <h4 style="margin: 0 0 10px 0; font-size: 11px; text-transform: uppercase; color: #6b7280;">10-Year Wealth Projection Cones</h4>
                    ${projImg ? `<img src="${projImg}" style="width: 580px; height: auto; max-height: 220px;">` : 'Image Error'}
                </div>
            </div>

            <!-- Footer -->
            <div style="margin-top: 48px; border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 9px; color: #9ca3af; text-align: center; line-height: 1.4;">
                STRATA Portfolio Risk Engine (v4.0.1). Educational use only. Not financial or investment advice.<br>
                All calculations represent mathematical approximations derived from historical assets returns.
            </div>
        </div>
    `;

    document.body.appendChild(element);

    const opt = {
        margin:       10,
        filename:     `STRATA_Portfolio_Architect.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, logging: false, windowWidth: 800 },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    const btn = document.getElementById('portfolio-pdf-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...';

    try {
        await window.html2pdf().set(opt).from(element).save();
    } catch (err) {
        console.error("PDF generation failed:", err);
    } finally {
        document.body.removeChild(element);
        btn.innerHTML = originalText;
    }
}
