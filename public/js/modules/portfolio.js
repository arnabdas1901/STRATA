let portfolioChartInstance = null;
let projectionChartInstance = null;
let scatterChartInstance = null;

const RISK_FREE_RATE = 0.045; // Current approx. US T-Bill rate

const ASSET_CLASSES = {
    usLargeCap: { name: 'US Large Cap', etf: 'Vanguard S&P 500 ETF', ticker: 'VOO', return: 0.10, vol: 0.15, er: 0.0003, yield: 0.013, color: '#2563eb', icon: 'fa-landmark' },
    intlDev: { name: 'Intl Developed', etf: 'Vanguard FTSE Developed Markets', ticker: 'VEA', return: 0.07, vol: 0.16, er: 0.0005, yield: 0.031, color: '#7c3aed', icon: 'fa-globe' },
    emerging: { name: 'Emerging Markets', etf: 'Vanguard FTSE Emerging Markets', ticker: 'VWO', return: 0.08, vol: 0.22, er: 0.0008, yield: 0.035, color: '#06b6d4', icon: 'fa-earth-asia' },
    govBonds: { name: 'Government Bonds', etf: 'iShares 20+ Year Treasury Bond', ticker: 'TLT', return: 0.04, vol: 0.10, er: 0.0015, yield: 0.038, color: '#64748b', icon: 'fa-building-columns' },
    corpBonds: { name: 'Corporate Bonds', etf: 'iShares iBoxx $ Inv Grade Corp', ticker: 'LQD', return: 0.05, vol: 0.07, er: 0.0014, yield: 0.042, color: '#94a3b8', icon: 'fa-file-contract' },
    gold: { name: 'Gold', etf: 'SPDR Gold Shares', ticker: 'GLD', return: 0.06, vol: 0.14, er: 0.0040, yield: 0.000, color: '#f59e0b', icon: 'fa-coins' }
};

export function setupPortfolioBuilder() {
    const generateBtn = document.getElementById('generate-portfolio-btn');
    const stressBtn = document.getElementById('portfolio-to-stress-btn');

    if (generateBtn) generateBtn.addEventListener('click', generatePortfolio);
    if (stressBtn) stressBtn.addEventListener('click', navigateToStressTest);

    // Generate initial
    generatePortfolio();
}

function navigateToStressTest() {
    // 1. Read current portfolio parameters
    const capital = document.getElementById('portfolio-capital-input')?.value;
    const age = document.getElementById('portfolio-age-input')?.value;
    const risk = document.getElementById('portfolio-risk-input')?.value;

    // 2. Sync them into the Stress Tester inputs
    const stressCapital = document.getElementById('stress-capital-input');
    const stressAge = document.getElementById('stress-age-input');
    const stressRisk = document.getElementById('stress-risk-input');

    if (stressCapital && capital) stressCapital.value = capital;
    if (stressAge && age) stressAge.value = age;
    if (stressRisk && risk) stressRisk.value = risk;

    // 3. Navigate to the Stress Tester dashboard
    const stressNav = document.querySelector('[data-target="dashboard-stress"]');
    if (stressNav) stressNav.click();

    // 4. Auto-run the stress test after a brief delay for the dashboard to render
    setTimeout(() => {
        const runBtn = document.getElementById('stress-run-btn');
        if (runBtn) runBtn.click();
    }, 150);
}

function generatePortfolio() {
    const age = parseInt(document.getElementById('portfolio-age-input')?.value) || 30;
    const risk = document.getElementById('portfolio-risk-input')?.value || 'moderate';
    const initialCapital = parseFloat(document.getElementById('portfolio-capital-input')?.value) || 100000;

    // Macro Allocation (Tier 1)
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
        metals = 10;
        fixedIncome -= 10;
    } else if (risk === 'moderate') {
        metals = 5;
        fixedIncome -= 5;
    } else {
        metals = 0;
    }

    if (fixedIncome < 0) fixedIncome = 0;
    
    const total = equity + fixedIncome + metals;
    equity = Math.round((equity / total) * 100);
    metals = Math.round((metals / total) * 100);
    fixedIncome = 100 - equity - metals;

    // Micro Allocation for Projection (Tier 2/3)
    const subAllocations = calculateSubAllocations(equity, fixedIncome, metals, risk);
    
    // Render all sections
    renderPortfolioDoughnut([equity, fixedIncome, metals], initialCapital);
    renderPortfolioSummaryBar(subAllocations, initialCapital);
    renderETFHoldingsTable(subAllocations, initialCapital);
    calculateAndRenderProjection(subAllocations, initialCapital);
    renderRiskReturnScatter(subAllocations);

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

    let weightedReturn = 0;
    let weightedVol = 0;
    let weightedER = 0;
    let weightedYield = 0;

    allocations.forEach(a => {
        const w = a.weight / 100;
        weightedReturn += w * a.return;
        weightedVol += w * a.vol;
        weightedER += w * a.er;
        weightedYield += w * a.yield;
    });

    const sharpe = weightedVol > 0 ? (weightedReturn - RISK_FREE_RATE) / weightedVol : 0;
    const projectedValue = initialCapital * Math.pow(1 + weightedReturn, 10);

    const kpis = [
        { label: 'Expected Return', value: (weightedReturn * 100).toFixed(2), suffix: '%', accent: 'var(--neon-green-positive)' },
        { label: 'Portfolio Risk (σ)', value: (weightedVol * 100).toFixed(2), suffix: '%', accent: '#f59e0b' },
        { label: 'Sharpe Ratio', value: sharpe.toFixed(2), suffix: '', accent: 'var(--neon-cyan-vibrant)' },
        { label: 'Weighted Exp. Ratio', value: (weightedER * 100).toFixed(3), suffix: '%', accent: '#94a3b8' },
        { label: 'Dividend Yield', value: (weightedYield * 100).toFixed(2), suffix: '%', accent: '#7c3aed' },
        { label: '10Y Projected Value', value: formatCurrency(projectedValue), suffix: '', accent: '#2563eb' }
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

    // Sort by weight descending
    const sorted = [...allocations].sort((a, b) => b.weight - a.weight);

    let totalWeight = 0;
    let totalAllocation = 0;

    tbody.innerHTML = sorted.map((a, i) => {
        const dollarValue = (a.weight / 100) * initialCapital;
        totalWeight += a.weight;
        totalAllocation += dollarValue;
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
                <td class="num-col">
                    <div class="weight-cell">
                        <span class="weight-number">${a.weight.toFixed(1)}%</span>
                        <div class="weight-bar-track"><div class="weight-bar-fill" style="width: ${a.weight}%; background: ${a.color}"></div></div>
                    </div>
                </td>
                <td class="num-col">${formatCurrency(dollarValue)}</td>
                <td class="num-col pos-change">${(a.return * 100).toFixed(1)}%</td>
                <td class="num-col">${(a.vol * 100).toFixed(1)}%</td>
                <td class="num-col">${(a.yield * 100).toFixed(2)}%</td>
                <td class="num-col fees-col">${(a.er * 100).toFixed(2)}%</td>
            </tr>
        `;
    }).join('');

    // Update footer totals
    const footerWeight = document.getElementById('etf-total-weight');
    const footerAllocation = document.getElementById('etf-total-allocation');
    if (footerWeight) footerWeight.textContent = totalWeight.toFixed(1) + '%';
    if (footerAllocation) footerAllocation.textContent = formatCurrency(totalAllocation);
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
    let weightedReturn = 0;
    let weightedVol = 0;
    allocations.forEach(alloc => {
        const w = alloc.weight / 100;
        weightedReturn += w * alloc.return;
        weightedVol += w * alloc.vol;
    });

    const years = 10;
    const labels = [];
    const baseData = [];
    const optimisticData = [];
    const pessimisticData = [];

    const optReturn = weightedReturn + 0.02;
    const pessReturn = Math.max(0.005, weightedReturn - 0.02);

    let baseVal = initialCapital;
    let optVal = initialCapital;
    let pessVal = initialCapital;

    for (let i = 0; i <= years; i++) {
        labels.push(i === 0 ? 'Today' : `Yr ${i}`);
        baseData.push(Math.round(baseVal));
        optimisticData.push(Math.round(optVal));
        pessimisticData.push(Math.round(pessVal));
        baseVal *= (1 + weightedReturn);
        optVal *= (1 + optReturn);
        pessVal *= (1 + pessReturn);
    }

    const cagrPercent = (weightedReturn * 100).toFixed(2);
    const desc = document.getElementById('portfolio-projection-desc');
    if (desc) {
        desc.textContent = `Base CAGR: ${cagrPercent}% · Optimistic: +2pp · Pessimistic: −2pp · ${years}-year horizon`;
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
                    label: 'Optimistic',
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
                    label: 'Pessimistic',
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
    if (val >= 1000000) return '$' + (val / 1000000).toFixed(2) + 'M';
    if (val >= 1000) return '$' + (val / 1000).toFixed(1) + 'K';
    return '$' + val.toFixed(0);
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
