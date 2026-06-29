let portfolioChartInstance = null;
let projectionChartInstance = null;

const ASSET_CLASSES = {
    usLargeCap: { name: 'US Large Cap', etf: 'Vanguard S&P 500', ticker: 'VOO', return: 0.10, vol: 0.15, er: 0.0003, yield: 0.013, color: '#2563eb' },
    intlDev: { name: 'Intl Developed', etf: 'Vanguard FTSE Dev', ticker: 'VEA', return: 0.07, vol: 0.16, er: 0.0005, yield: 0.031, color: '#3b82f6' },
    emerging: { name: 'Emerging Markets', etf: 'Vanguard FTSE EM', ticker: 'VWO', return: 0.08, vol: 0.22, er: 0.0008, yield: 0.035, color: '#60a5fa' },
    govBonds: { name: 'Government Bonds', etf: 'iShares 20+ Yr Treas', ticker: 'TLT', return: 0.04, vol: 0.10, er: 0.0015, yield: 0.038, color: '#64748b' },
    corpBonds: { name: 'Corporate Bonds', etf: 'iShares iBoxx Inv Grd', ticker: 'LQD', return: 0.05, vol: 0.07, er: 0.0014, yield: 0.042, color: '#94a3b8' },
    gold: { name: 'Gold', etf: 'SPDR Gold Trust', ticker: 'GLD', return: 0.06, vol: 0.14, er: 0.0040, yield: 0.000, color: '#f59e0b' }
};

export function setupPortfolioBuilder() {
    const generateBtn = document.getElementById('generate-portfolio-btn');
    const riskInput = document.getElementById('portfolio-risk-input');
    const ageInput = document.getElementById('portfolio-age-input');
    const capitalInput = document.getElementById('portfolio-capital-input');

    if (generateBtn) generateBtn.addEventListener('click', generatePortfolio);

    // Generate initial
    generatePortfolio();
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

    renderPortfolioPieChart([equity, fixedIncome, metals]);

    // Micro Allocation (Tier 2)
    const subAllocations = calculateSubAllocations(equity, fixedIncome, metals, risk);
    renderETFTable(subAllocations, initialCapital);
    
    // Projection (Tier 3)
    calculateAndRenderProjection(subAllocations, initialCapital);
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

function renderETFTable(allocations, initialCapital) {
    const tbody = document.getElementById('portfolio-etf-body');
    const summaryBar = document.getElementById('portfolio-summary-bar');
    if (!tbody) return;

    tbody.innerHTML = '';
    let totalER = 0;
    let totalYield = 0;
    
    allocations.forEach(alloc => {
        if (alloc.weight < 0.5) return; // Skip tiny weights
        
        const allocDollar = initialCapital * (alloc.weight / 100);
        const weightDec = alloc.weight / 100;
        
        totalER += alloc.er * weightDec;
        totalYield += alloc.yield * weightDec;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div class="etf-asset-name">
                    <div class="etf-color-indicator" style="background-color: ${alloc.color}"></div>
                    <div class="etf-name-group">
                        <span>${alloc.name}</span>
                        <span class="etf-subtitle">${alloc.etf}</span>
                    </div>
                </div>
            </td>
            <td><span class="ticker-chip">${alloc.ticker}</span></td>
            <td>${alloc.weight.toFixed(1)}%</td>
            <td style="color: var(--neon-cyan-vibrant); font-weight: 600;">$${allocDollar.toLocaleString('en-US', {maximumFractionDigits: 0})}</td>
            <td>${(alloc.yield * 100).toFixed(2)}%</td>
            <td class="fees-col">${(alloc.er * 100).toFixed(2)}%</td>
        `;
        tbody.appendChild(tr);
    });

    if (summaryBar) {
        const estIncome = initialCapital * totalYield;
        summaryBar.innerHTML = `
            <div class="summary-metric">
                <span class="summary-label">Weighted Expense Ratio</span>
                <span class="summary-value fees-col">${(totalER * 100).toFixed(2)}%</span>
            </div>
            <div class="summary-metric">
                <span class="summary-label">Est. Year 1 Income</span>
                <span class="summary-value" style="color: #10b981;">$${estIncome.toLocaleString('en-US', {maximumFractionDigits: 0})}</span>
            </div>
        `;
    }
}

function calculateAndRenderProjection(allocations, initialCapital) {
    let weightedReturn = 0;
    allocations.forEach(alloc => {
        weightedReturn += (alloc.weight / 100) * alloc.return;
    });

    const years = 10;
    const labels = [];
    const dataPoints = [];

    let currentVal = initialCapital;
    for (let i = 0; i <= years; i++) {
        labels.push(`Year ${i}`);
        dataPoints.push(currentVal);
        currentVal = currentVal * (1 + weightedReturn);
    }

    const cagrPercent = (weightedReturn * 100).toFixed(2);
    const desc = document.getElementById('portfolio-projection-desc');
    if (desc) {
        desc.textContent = `Estimating future growth based on a weighted historical CAGR of ${cagrPercent}%.`;
    }

    const canvas = document.getElementById('portfolioProjectionChart');
    if (!canvas) return;

    if (projectionChartInstance) projectionChartInstance.destroy();
    projectionChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Projected Value',
                data: dataPoints,
                borderColor: '#06b6d4',
                backgroundColor: 'rgba(6, 182, 212, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointRadius: 3,
                pointBackgroundColor: '#06b6d4'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    ticks: { callback: function(val) { return '$' + val.toLocaleString(); } },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderPortfolioPieChart(dataArr) {
    const colors = ['#2563eb', '#64748b', '#f59e0b'];
    const canvas = document.getElementById('portfolioPieChart');
    if (!canvas) return;

    if (portfolioChartInstance) portfolioChartInstance.destroy();
    portfolioChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'pie',
        data: { 
            labels: ['Equity', 'Fixed Income', 'Metals'], 
            datasets: [{ data: dataArr, backgroundColor: colors, borderWidth: 0 }] 
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });

    const legendTarget = document.getElementById('portfolio-legend-target');
    if(legendTarget) {
        legendTarget.innerHTML = `
            <div class="legend-node">
                <div class="legend-meta"><div class="legend-color-dot" style="background:${colors[0]}"></div><span>Equity / Alpha Assets</span></div>
                <span class="legend-value">${dataArr[0]}%</span>
            </div>
            <div class="legend-node">
                <div class="legend-meta"><div class="legend-color-dot" style="background:${colors[1]}"></div><span>Fixed Income / Debt</span></div>
                <span class="legend-value">${dataArr[1]}%</span>
            </div>
            <div class="legend-node">
                <div class="legend-meta"><div class="legend-color-dot" style="background:${colors[2]}"></div><span>Precious Metals / Hedge</span></div>
                <span class="legend-value">${dataArr[2]}%</span>
            </div>
        `;
    }
}
