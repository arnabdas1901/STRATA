import { formatLargeCurrency } from '../utils.js';

let calcDoughnutInstance = null;
let calcBarInstance = null;
let activeCalcType = 'sip';

export function setupCalculators() {
    const toggles = document.querySelectorAll('.calc-toggle');
    toggles.forEach(btn => {
        btn.addEventListener('click', () => {
            toggles.forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            activeCalcType = btn.getAttribute('data-calc');
            renderCalcInputs(activeCalcType);
        });
    });

    const wrapper = document.getElementById('calc-inputs-wrapper');
    if (wrapper) {
        wrapper.addEventListener('input', calculateCurrent);
        wrapper.addEventListener('change', calculateCurrent);
    }

    // Initial render for default active tab (SIP)
    renderCalcInputs(activeCalcType);
}

// ─── Utility Helpers ────────────────────────────────────────────────

function fmtCurrency(value) {
    if (value == null || isNaN(value)) return '$0';
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
    return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fmtPct(value) {
    if (value == null || isNaN(value)) return '0%';
    return `${value.toFixed(2)}%`;
}

// ─── Inflation Slider Wiring ────────────────────────────────────────

function wireInflationSlider(sliderId, displayId) {
    const slider = document.getElementById(sliderId);
    const display = document.getElementById(displayId);
    if (!slider || !display) return;
    slider.addEventListener('input', (e) => {
        display.textContent = e.target.value + '%';
        if (window.runCalc) window.runCalc();
    });
}

function createDualInput(id, label, value, min, max, step, prefix = '', suffix = '') {
    return `
        <div class="dual-input-group">
            <div class="dual-input-header">
                <label>${label}</label>
                <div class="input-wrapper">
                    ${prefix ? `<span class="prefix">${prefix}</span>` : ''}
                    <input type="number" id="${id}" value="${value}" min="${min}" max="${max}" step="${step}">
                    ${suffix ? `<span class="suffix">${suffix}</span>` : ''}
                </div>
            </div>
            <input type="range" class="custom-range-slider" id="${id}-slider" min="${min}" max="${max}" step="${step}" value="${value}">
        </div>
    `;
}

function syncDualInput(id) {
    const input = document.getElementById(id);
    const slider = document.getElementById(`${id}-slider`);
    if (!input || !slider) return;

    input.addEventListener('input', (e) => {
        let val = parseFloat(e.target.value);
        if (!isNaN(val)) {
            slider.value = val;
            if (window.runCalc) window.runCalc();
        }
    });

    slider.addEventListener('input', (e) => {
        input.value = e.target.value;
        if (window.runCalc) window.runCalc();
    });
}

// ─── Input Rendering ────────────────────────────────────────────────

function renderCalcInputs(type) {
    const wrapper = document.getElementById('calc-inputs-wrapper');
    if (!wrapper) return;

    if (type === 'sip') {
        wrapper.innerHTML = `
            ${createDualInput('calc-sip-amount', 'Monthly Investment', 500, 0, 50000, 100, '$')}
            ${createDualInput('calc-sip-lumpsum', 'Initial Lump Sum', 0, 0, 500000, 1000, '$')}
            ${createDualInput('calc-sip-rate', 'Expected Return Rate', 12, 0, 40, 0.5, '', '%')}
            ${createDualInput('calc-sip-stepup', 'Annual Step-Up', 10, 0, 100, 1, '', '%')}
            ${createDualInput('calc-sip-years', 'Time Period', 10, 1, 50, 1, '', 'Yrs')}
            
            <div class="input-field-group inflation-input-group">
                <label><i class="fa-solid fa-chart-line"></i> Inflation Rate (Annual %)</label>
                <div class="range-input-row">
                    <input type="range" id="calc-sip-inflation" min="0" max="15" step="0.5" value="6" class="inflation-slider">
                    <span id="calc-sip-inflation-val" class="range-display-value">6%</span>
                </div>
            </div>
            <button class="primary-btn fluid-btn" onclick="window.runCalc()">Calculate Returns</button>
            <div class="calc-definition-card">
                <div class="calc-def-header">
                    <i class="fa-solid fa-arrow-trend-up calc-def-icon sip-icon"></i>
                    <span class="calc-def-term">Systematic Investment Plan (SIP)</span>
                </div>
                <p class="calc-def-text">A Systematic Investment Plan is a structured investment strategy that enables investors to allocate a <strong>predetermined capital amount</strong> at fixed periodic intervals...</p>
            </div>
        `;
        syncDualInput('calc-sip-amount');
        syncDualInput('calc-sip-lumpsum');
        syncDualInput('calc-sip-rate');
        syncDualInput('calc-sip-stepup');
        syncDualInput('calc-sip-years');
        wireInflationSlider('calc-sip-inflation', 'calc-sip-inflation-val');
    } else if (type === 'emi') {
        wrapper.innerHTML = `
            ${createDualInput('calc-emi-amount', 'Loan Amount', 50000, 1000, 2000000, 1000, '$')}
            ${createDualInput('calc-emi-rate', 'Interest Rate', 7.5, 0.1, 30, 0.1, '', '%')}
            ${createDualInput('calc-emi-years', 'Loan Tenure', 5, 1, 40, 1, '', 'Yrs')}
            
            <div class="input-field-group inflation-input-group">
                <label><i class="fa-solid fa-chart-line"></i> Inflation Rate (Annual %)</label>
                <div class="range-input-row">
                    <input type="range" id="calc-emi-inflation" min="0" max="15" step="0.5" value="6" class="inflation-slider">
                    <span id="calc-emi-inflation-val" class="range-display-value">6%</span>
                </div>
            </div>
            <button class="primary-btn fluid-btn" onclick="window.runCalc()">Calculate EMI</button>
            <div class="calc-definition-card">
                <div class="calc-def-header">
                    <i class="fa-solid fa-building-columns calc-def-icon emi-icon"></i>
                    <span class="calc-def-term">Equated Monthly Installment (EMI)</span>
                </div>
                <p class="calc-def-text">An Equated Monthly Installment is a fixed repayment amount paid by a borrower to a lending institution on a specified date each calendar month...</p>
            </div>
        `;
        syncDualInput('calc-emi-amount');
        syncDualInput('calc-emi-rate');
        syncDualInput('calc-emi-years');
        wireInflationSlider('calc-emi-inflation', 'calc-emi-inflation-val');
    } else if (type === 'swp') {
        wrapper.innerHTML = `
            ${createDualInput('calc-swp-amount', 'Total Investment', 100000, 1000, 5000000, 1000, '$')}
            ${createDualInput('calc-swp-withdraw', 'Withdrawal Per Month', 1000, 100, 50000, 100, '$')}
            ${createDualInput('calc-swp-rate', 'Expected Return Rate', 8, 0, 30, 0.5, '', '%')}
            ${createDualInput('calc-swp-years', 'Time Period', 5, 1, 50, 1, '', 'Yrs')}
            
            <div class="input-field-group inflation-input-group">
                <label><i class="fa-solid fa-chart-line"></i> Inflation Rate (Annual %)</label>
                <div class="range-input-row">
                    <input type="range" id="calc-swp-inflation" min="0" max="15" step="0.5" value="6" class="inflation-slider">
                    <span id="calc-swp-inflation-val" class="range-display-value">6%</span>
                </div>
            </div>
            <button class="primary-btn fluid-btn" onclick="window.runCalc()">Calculate Balance</button>
            <div class="calc-definition-card">
                <div class="calc-def-header">
                    <i class="fa-solid fa-wallet calc-def-icon swp-icon"></i>
                    <span class="calc-def-term">Systematic Withdrawal Plan (SWP)</span>
                </div>
                <p class="calc-def-text">A Systematic Withdrawal Plan is a structured <strong>decumulation strategy</strong> that enables investors to withdraw a fixed amount from their invested corpus at regular intervals...</p>
            </div>
        `;
        syncDualInput('calc-swp-amount');
        syncDualInput('calc-swp-withdraw');
        syncDualInput('calc-swp-rate');
        syncDualInput('calc-swp-years');
        wireInflationSlider('calc-swp-inflation', 'calc-swp-inflation-val');
    } else if (type === 'fire') {
        wrapper.innerHTML = `
            ${createDualInput('calc-fire-current-age', 'Current Age', 30, 18, 80, 1, '', 'Yrs')}
            ${createDualInput('calc-fire-retire-age', 'Target Retirement Age', 50, 20, 80, 1, '', 'Yrs')}
            ${createDualInput('calc-fire-corpus', 'Current Savings / Corpus', 50000, 0, 2000000, 1000, '$')}
            ${createDualInput('calc-fire-monthly', 'Monthly Savings Contribution', 1000, 0, 50000, 100, '$')}
            ${createDualInput('calc-fire-expenses', 'Annual Living Expenses Today', 40000, 1000, 500000, 1000, '$')}
            ${createDualInput('calc-fire-pre-rate', 'Pre-Retirement Annual Return', 10, 0, 30, 0.5, '', '%')}
            ${createDualInput('calc-fire-post-rate', 'Post-Retirement Annual Return', 7, 0, 30, 0.5, '', '%')}
            
            <div class="input-field-group inflation-input-group">
                <label><i class="fa-solid fa-chart-line"></i> Inflation Rate (Annual %)</label>
                <div class="range-input-row">
                    <input type="range" id="calc-fire-inflation" min="0" max="15" step="0.5" value="6" class="inflation-slider">
                    <span id="calc-fire-inflation-val" class="range-display-value">6%</span>
                </div>
            </div>
            <button class="primary-btn fluid-btn" onclick="window.runCalc()">Calculate FIRE Path</button>
            <div class="calc-definition-card">
                <div class="calc-def-header">
                    <i class="fa-solid fa-fire calc-def-icon fire-icon" style="color: #ff6b6b;"></i>
                    <span class="calc-def-term">Financial Independence Retire Early (FIRE)</span>
                </div>
                <p class="calc-def-text">The FIRE Planner is an advanced <strong>life-cycle capital mapping model</strong> that calculates the savings accumulation phase up to retirement, followed by a decumulation (withdrawal) phase...</p>
            </div>
        `;
        syncDualInput('calc-fire-current-age');
        syncDualInput('calc-fire-retire-age');
        syncDualInput('calc-fire-corpus');
        syncDualInput('calc-fire-monthly');
        syncDualInput('calc-fire-expenses');
        syncDualInput('calc-fire-pre-rate');
        syncDualInput('calc-fire-post-rate');
        wireInflationSlider('calc-fire-inflation', 'calc-fire-inflation-val');
    }
    window.runCalc = calculateCurrent;
    calculateCurrent();
}

// ─── Dispatcher ─────────────────────────────────────────────────────

function calculateCurrent() {
    if (activeCalcType === 'sip') calculateSIP();
    else if (activeCalcType === 'emi') calculateEMI();
    else if (activeCalcType === 'swp') calculateSWP();
    else if (activeCalcType === 'fire') calculateFIRE();
}

// ─── SIP Calculation: Step-Up + Inflation-Adjusted ──────────────────

function calculateSIP() {
    const baseMonthly = parseFloat(document.getElementById('calc-sip-amount').value) || 0;
    const lumpSum     = parseFloat(document.getElementById('calc-sip-lumpsum')?.value) || 0;
    const annualRate  = parseFloat(document.getElementById('calc-sip-rate').value) || 0;
    const stepUpPct   = parseFloat(document.getElementById('calc-sip-stepup').value) || 0;
    const years       = parseInt(document.getElementById('calc-sip-years').value) || 0;
    const inflationRate = parseFloat(document.getElementById('calc-sip-inflation').value) || 0;

    if (years <= 0 || (baseMonthly <= 0 && lumpSum <= 0)) return;

    const monthlyRate = annualRate / 100 / 12;
    let balance = lumpSum;
    let totalInvested = lumpSum;
    let currentMonthly = baseMonthly;
    const yearLabels = [];
    const yearInvestedCumulative = [];
    const yearGainsCumulative = [];
    const tableRows = [];

    for (let y = 1; y <= years; y++) {
        for (let m = 0; m < 12; m++) {
            totalInvested += currentMonthly;
            if (monthlyRate > 0) {
                balance = (balance + currentMonthly) * (1 + monthlyRate);
            } else {
                balance = balance + currentMonthly;
            }
        }
        yearLabels.push(`Yr ${y}`);
        yearInvestedCumulative.push(Math.round(totalInvested));
        yearGainsCumulative.push(Math.max(0, Math.round(balance - totalInvested)));
        
        tableRows.push([
            `Year ${y}`,
            fmtCurrency(Math.round(totalInvested)),
            fmtCurrency(Math.max(0, Math.round(balance - totalInvested))),
            fmtCurrency(Math.round(balance))
        ]);

        // Step up monthly contribution for the next year
        currentMonthly = currentMonthly * (1 + stepUpPct / 100);
    }
    
    renderDataTable(['Year', 'Invested Amount', 'Est. Returns', 'Total Value'], tableRows);

    const nominalFV = balance;
    const estReturns = nominalFV - totalInvested;
    const inflationAdjustedFV = nominalFV / Math.pow(1 + inflationRate / 100, years);
    const realReturns = inflationAdjustedFV - totalInvested;

    // Absolute return percentage
    const absoluteReturn = totalInvested > 0 ? ((nominalFV - totalInvested) / totalInvested) * 100 : 0;

    // Real rate of return (Fisher equation, annualized)
    const nominalDecimal = annualRate / 100;
    const inflDecimal = inflationRate / 100;
    const realRateAnnual = inflDecimal > 0
        ? (((1 + nominalDecimal) / (1 + inflDecimal)) - 1) * 100
        : annualRate;

    // Wealth gain multiple
    const wealthMultiple = totalInvested > 0 ? (nominalFV / totalInvested) : 0;

    renderCalcResults(
        ['Invested Amount', 'Est. Returns'],
        [totalInvested, Math.max(0, estReturns)],
        ['#3b82f6', '#10b981'],
        `
        <div class="metric-card">
            <span class="metric-title">Total Invested</span>
            <span class="metric-value">${fmtCurrency(totalInvested)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Nominal Future Value</span>
            <span class="metric-value" style="color: #10b981;">${fmtCurrency(nominalFV)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Wealth Gain <span class="metric-badge badge-nominal">Nominal</span></span>
            <span class="metric-value" style="color: #10b981;">+${fmtCurrency(Math.max(0, estReturns))}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Inflation-Adj. Value <span class="metric-badge badge-real">Real</span></span>
            <span class="metric-value" style="color: #f59e0b;">${fmtCurrency(inflationAdjustedFV)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Real Returns <span class="metric-badge badge-real">Real</span></span>
            <span class="metric-value" style="color: ${realReturns >= 0 ? '#10b981' : '#ef4444'};">${realReturns >= 0 ? '+' : ''}${fmtCurrency(realReturns)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Absolute Return</span>
            <span class="metric-value">${fmtPct(absoluteReturn)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Wealth Multiple</span>
            <span class="metric-value">${wealthMultiple.toFixed(2)}x</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Real Rate of Return <span class="metric-badge badge-real">Real</span></span>
            <span class="metric-value">${fmtPct(realRateAnnual)} p.a.</span>
        </div>
        `,
        {
            type: 'bar',
            labels: yearLabels,
            datasets: [
                {
                    label: 'Total Invested',
                    data: yearInvestedCumulative,
                    backgroundColor: 'rgba(59, 130, 246, 0.75)',
                    borderColor: '#3b82f6',
                    borderWidth: 1,
                    borderRadius: 3
                },
                {
                    label: 'Wealth Gains',
                    data: yearGainsCumulative,
                    backgroundColor: 'rgba(16, 185, 129, 0.75)',
                    borderColor: '#10b981',
                    borderWidth: 1,
                    borderRadius: 3
                }
            ],
            stacked: true
        }
    );
}

// ─── EMI Calculation: Amortization Schedule + Real Cost ─────────────

function calculateEMI() {
    const P          = parseFloat(document.getElementById('calc-emi-amount').value) || 0;
    const annualRate = parseFloat(document.getElementById('calc-emi-rate').value) || 0;
    const years      = parseInt(document.getElementById('calc-emi-years').value) || 0;
    const inflationRate = parseFloat(document.getElementById('calc-emi-inflation').value) || 0;

    if (years <= 0 || P <= 0) return;

    const r = annualRate / 100 / 12;
    const n = years * 12;

    // EMI calculation — guard against 0% interest
    let emi;
    if (r > 0) {
        emi = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    } else {
        emi = P / n;
    }

    const totalPayment = emi * n;
    const totalInterest = totalPayment - P;

    // Year-by-year amortization schedule
    let remainingPrincipal = P;
    const yearLabels = [];
    const yearPrincipalData = [];
    const yearInterestData = [];
    const tableRows = [];

    for (let y = 1; y <= years; y++) {
        let yearPrincipalPaid = 0;
        let yearInterestPaid = 0;
        for (let m = 0; m < 12; m++) {
            const interestComp = remainingPrincipal * r;
            const principalComp = emi - interestComp;
            remainingPrincipal = Math.max(0, remainingPrincipal - principalComp);
            yearPrincipalPaid += principalComp;
            yearInterestPaid += interestComp;
        }
        yearLabels.push(`Yr ${y}`);
        yearPrincipalData.push(Math.round(Math.max(0, yearPrincipalPaid)));
        yearInterestData.push(Math.round(Math.max(0, yearInterestPaid)));
        
        tableRows.push([
            `Year ${y}`,
            fmtCurrency(Math.max(0, yearPrincipalPaid)),
            fmtCurrency(Math.max(0, yearInterestPaid)),
            fmtCurrency(Math.max(0, remainingPrincipal))
        ]);
    }
    
    renderDataTable(['Year', 'Principal Paid', 'Interest Paid', 'Remaining Balance'], tableRows);

    // Interest-to-principal ratio
    const interestToPrincipal = P > 0 ? (totalInterest / P) * 100 : 0;

    // Inflation-adjusted real cost of loan
    const realTotalPayment = totalPayment / Math.pow(1 + inflationRate / 100, years);
    const realInterest = realTotalPayment - P;

    // Effective cost percentage (total payment / principal - 1)
    const effectiveCostPct = P > 0 ? ((totalPayment / P) - 1) * 100 : 0;

    renderCalcResults(
        ['Principal', 'Total Interest'],
        [P, Math.max(0, totalInterest)],
        ['#3b82f6', '#ef4444'],
        `
        <div class="metric-card">
            <span class="metric-title">Monthly EMI</span>
            <span class="metric-value" style="color: var(--neon-cyan-vibrant);">${fmtCurrency(emi)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Principal Amount</span>
            <span class="metric-value">${fmtCurrency(P)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Total Interest <span class="metric-badge badge-nominal">Nominal</span></span>
            <span class="metric-value" style="color: #ef4444;">${fmtCurrency(Math.max(0, totalInterest))}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Total Payment</span>
            <span class="metric-value">${fmtCurrency(totalPayment)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Inflation-Adj. Cost <span class="metric-badge badge-real">Real</span></span>
            <span class="metric-value" style="color: #f59e0b;">${fmtCurrency(realTotalPayment)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Real Interest Paid <span class="metric-badge badge-real">Real</span></span>
            <span class="metric-value" style="color: ${realInterest >= 0 ? '#ef4444' : '#10b981'};">${fmtCurrency(realInterest)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Interest-to-Principal</span>
            <span class="metric-value">${fmtPct(interestToPrincipal)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Effective Cost of Loan</span>
            <span class="metric-value">${fmtPct(effectiveCostPct)}</span>
        </div>
        `,
        {
            type: 'bar',
            labels: yearLabels,
            datasets: [
                {
                    label: 'Principal Repaid',
                    data: yearPrincipalData,
                    backgroundColor: 'rgba(59, 130, 246, 0.75)',
                    borderColor: '#3b82f6',
                    borderWidth: 1,
                    borderRadius: 3
                },
                {
                    label: 'Interest Paid',
                    data: yearInterestData,
                    backgroundColor: 'rgba(239, 68, 68, 0.75)',
                    borderColor: '#ef4444',
                    borderWidth: 1,
                    borderRadius: 3
                }
            ],
            stacked: true
        }
    );
}

// ─── SWP Calculation: Depletion Detection + Sustainable Rate ────────

function calculateSWP() {
    const P          = parseFloat(document.getElementById('calc-swp-amount').value) || 0;
    const W          = parseFloat(document.getElementById('calc-swp-withdraw').value) || 0;
    const annualRate = parseFloat(document.getElementById('calc-swp-rate').value) || 0;
    const years      = parseInt(document.getElementById('calc-swp-years').value) || 0;
    const inflationRate = parseFloat(document.getElementById('calc-swp-inflation').value) || 0;

    if (years <= 0 || P <= 0) return;

    const monthlyRate = annualRate / 100 / 12;
    const totalMonths = years * 12;
    let balance = P;
    let totalWithdrawn = 0;
    let totalReturnsEarned = 0;
    let depletionYear = null;
    let depleted = false;
    const yearLabels = [];
    const yearBalanceData = [];
    const tableRows = [];

    for (let y = 1; y <= years; y++) {
        let yearWithdrawn = 0;
        let yearInterest = 0;
        
        if (!depleted) {
            for (let m = 0; m < 12; m++) {
                const interest = balance * monthlyRate;
                totalReturnsEarned += interest;
                yearInterest += interest;
                
                balance = balance + interest - W;
                totalWithdrawn += W;
                yearWithdrawn += W;
                
                if (balance <= 0) {
                    balance = 0;
                    depleted = true;
                    if (!depletionYear) depletionYear = y;
                    break;
                }
            }
        }
        yearLabels.push(`Yr ${y}`);
        yearBalanceData.push(Math.round(Math.max(0, balance)));
        
        tableRows.push([
            `Year ${y}`,
            fmtCurrency(yearWithdrawn),
            fmtCurrency(yearInterest),
            fmtCurrency(balance)
        ]);
    }

    renderDataTable(['Year', 'Withdrawn', 'Returns Earned', 'Remaining Balance'], tableRows);

    const nominalBalance = balance;
    const inflationAdjustedBalance = nominalBalance / Math.pow(1 + inflationRate / 100, years);

    // Sustainable monthly withdrawal (annuity payment formula)
    let sustainableW = 0;
    if (monthlyRate > 0 && totalMonths > 0) {
        sustainableW = (P * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -totalMonths));
    } else if (totalMonths > 0) {
        sustainableW = P / totalMonths;
    }

    // Withdrawal yield = total withdrawn / initial investment
    const withdrawalYield = P > 0 ? (totalWithdrawn / P) * 100 : 0;

    // Corpus status
    const depletionHTML = depletionYear
        ? `<div class="metric-card metric-card-warning">
            <span class="metric-title"><i class="fa-solid fa-triangle-exclamation"></i> Corpus Depletion</span>
            <span class="metric-value" style="color: #ef4444;">Year ${depletionYear}</span>
           </div>`
        : `<div class="metric-card metric-card-success">
            <span class="metric-title"><i class="fa-solid fa-circle-check"></i> Corpus Status</span>
            <span class="metric-value" style="color: #10b981;">Sustainable</span>
           </div>`;

    renderCalcResults(
        ['Final Balance', 'Total Withdrawn'],
        [nominalBalance, totalWithdrawn],
        ['#3b82f6', '#f59e0b'],
        `
        <div class="metric-card">
            <span class="metric-title">Initial Investment</span>
            <span class="metric-value">${fmtCurrency(P)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Total Withdrawn <span class="metric-badge badge-nominal">Nominal</span></span>
            <span class="metric-value" style="color: #f59e0b;">${fmtCurrency(totalWithdrawn)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Nominal Final Balance</span>
            <span class="metric-value">${fmtCurrency(nominalBalance)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Inflation-Adj. Balance <span class="metric-badge badge-real">Real</span></span>
            <span class="metric-value" style="color: #f59e0b;">${fmtCurrency(inflationAdjustedBalance)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Returns Earned</span>
            <span class="metric-value" style="color: #10b981;">+${fmtCurrency(totalReturnsEarned)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Withdrawal Yield</span>
            <span class="metric-value">${fmtPct(withdrawalYield)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Sustainable Withdrawal</span>
            <span class="metric-value" style="color: var(--neon-cyan-vibrant);">${fmtCurrency(sustainableW)}/mo</span>
        </div>
        ${depletionHTML}
        `,
        {
            type: 'line',
            labels: yearLabels,
            datasets: [
                {
                    label: 'Corpus Balance',
                    data: yearBalanceData,
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.08)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.35,
                    pointBackgroundColor: yearBalanceData.map(v => v <= 0 ? '#ef4444' : '#06b6d4'),
                    pointBorderColor: yearBalanceData.map(v => v <= 0 ? '#ef4444' : '#06b6d4'),
                    pointRadius: yearBalanceData.map(v => v <= 0 ? 6 : 3),
                    pointHoverRadius: 6
                }
            ],
            stacked: false
        }
    );
}

// ─── Dual-Chart Rendering Engine ────────────────────────────────────

function renderCalcResults(doughnutLabels, doughnutData, doughnutColors, metricsHtml, barChartConfig) {
    // Inject metric cards
    const summary = document.getElementById('calc-numerical-summary');
    if (summary) summary.innerHTML = metricsHtml;

    // ── Doughnut Chart ──
    const doughnutCanvas = document.getElementById('calculatorPieChart');
    if (doughnutCanvas) {
        if (calcDoughnutInstance) calcDoughnutInstance.destroy();
        calcDoughnutInstance = new Chart(doughnutCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: doughnutLabels,
                datasets: [{
                    data: doughnutData,
                    backgroundColor: doughnutColors,
                    borderWidth: 0,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#e2e8f0', padding: 16, usePointStyle: true, pointStyleWidth: 10, font: { size: 12 } }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(13, 19, 38, 0.95)',
                        borderColor: 'rgba(30, 45, 84, 0.8)',
                        borderWidth: 1,
                        titleColor: '#f8fafc',
                        bodyColor: '#e2e8f0',
                        padding: 12,
                        callbacks: {
                            label: function(context) {
                                const val = context.parsed;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
                                return ` ${context.label}: ${fmtCurrency(val)} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    // ── Bar / Line Chart (Year-by-Year Projection) ──
    const barCanvas = document.getElementById('calculatorBarChart');
    if (barCanvas && barChartConfig) {
        if (calcBarInstance) calcBarInstance.destroy();

        const isStacked = barChartConfig.stacked;
        const chartType = barChartConfig.type || 'bar';

        calcBarInstance = new Chart(barCanvas.getContext('2d'), {
            type: chartType,
            data: {
                labels: barChartConfig.labels,
                datasets: barChartConfig.datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                scales: {
                    x: {
                        stacked: isStacked,
                        ticks: { color: '#94a3b8', font: { size: 11 } },
                        grid: { color: 'rgba(30, 45, 84, 0.4)', drawBorder: false }
                    },
                    y: {
                        stacked: isStacked,
                        beginAtZero: true,
                        ticks: {
                            color: '#94a3b8',
                            font: { size: 11 },
                            callback: function(value) {
                                if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
                                if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
                                return `$${value}`;
                            }
                        },
                        grid: { color: 'rgba(30, 45, 84, 0.4)', drawBorder: false }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: '#e2e8f0', padding: 14, usePointStyle: true, pointStyleWidth: 10, boxWidth: 8, font: { size: 11 } }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(13, 19, 38, 0.95)',
                        borderColor: 'rgba(30, 45, 84, 0.8)',
                        borderWidth: 1,
                        titleColor: '#f8fafc',
                        bodyColor: '#e2e8f0',
                        padding: 12,
                        callbacks: {
                            label: function(context) {
                                return ` ${context.dataset.label}: ${fmtCurrency(context.parsed.y)}`;
                            }
                        }
                    }
                }
            }
        });
    }
}

function calculateFIRE() {
    const currentAge  = parseInt(document.getElementById('calc-fire-current-age').value) || 30;
    const retireAge   = parseInt(document.getElementById('calc-fire-retire-age').value) || 50;
    const initialSavings = parseFloat(document.getElementById('calc-fire-corpus').value) || 0;
    const monthlySavings = parseFloat(document.getElementById('calc-fire-monthly').value) || 0;
    const annualExpensesToday = parseFloat(document.getElementById('calc-fire-expenses').value) || 0;
    const preRate     = parseFloat(document.getElementById('calc-fire-pre-rate').value) || 0;
    const postRate    = parseFloat(document.getElementById('calc-fire-post-rate').value) || 0;
    const inflation   = parseFloat(document.getElementById('calc-fire-inflation').value) || 0;

    if (retireAge <= currentAge || currentAge <= 0) return;

    const preMonthlyRate = preRate / 100 / 12;
    const postMonthlyRate = postRate / 100 / 12;

    let balance = initialSavings;
    let totalSavingsInvested = initialSavings;
    
    const yearsToRetire = retireAge - currentAge;
    const ageLabels = [];
    const corpusBalanceData = [];
    const principalInvestedData = [];

    ageLabels.push(currentAge);
    corpusBalanceData.push(Math.round(balance));
    principalInvestedData.push(Math.round(totalSavingsInvested));

    const tableRows = [];
    tableRows.push([
        `Age ${currentAge} (Start)`,
        fmtCurrency(initialSavings),
        '$0',
        fmtCurrency(initialSavings)
    ]);

    for (let y = 1; y <= yearsToRetire; y++) {
        let yearSaved = 0;
        let startBal = balance;
        for (let m = 0; m < 12; m++) {
            balance = (balance + monthlySavings) * (1 + preMonthlyRate);
            totalSavingsInvested += monthlySavings;
            yearSaved += monthlySavings;
        }
        ageLabels.push(currentAge + y);
        corpusBalanceData.push(Math.round(balance));
        principalInvestedData.push(Math.round(totalSavingsInvested));
        
        tableRows.push([
            `Age ${currentAge + y} (Accum.)`,
            `+${fmtCurrency(yearSaved)} (In)`,
            `+${fmtCurrency(Math.max(0, balance - startBal - yearSaved))} (Gain)`,
            fmtCurrency(balance)
        ]);
    }

    const corpusAtRetirement = balance;
    const investedAtRetirement = totalSavingsInvested;
    const gainsAtRetirement = Math.max(0, corpusAtRetirement - investedAtRetirement);

    const expensesAtRetirement = annualExpensesToday * Math.pow(1 + inflation / 100, yearsToRetire);
    const fireNumber = expensesAtRetirement * 25;

    const yearsInRetirement = Math.max(5, 85 - retireAge);
    let decumBalance = corpusAtRetirement;
    let depleted = false;
    let depletionAge = null;
    let totalWithdrawn = 0;

    let currentExpenses = expensesAtRetirement;

    for (let y = 1; y <= yearsInRetirement; y++) {
        const currentYearExpenses = currentExpenses;
        const monthlyWithdrawal = currentYearExpenses / 12;
        let yearWithdrawn = 0;
        let startBal = decumBalance;
        
        for (let m = 0; m < 12; m++) {
            if (decumBalance > 0) {
                decumBalance = (decumBalance * (1 + postMonthlyRate)) - monthlyWithdrawal;
                totalWithdrawn += monthlyWithdrawal;
                yearWithdrawn += monthlyWithdrawal;
                if (decumBalance < 0) {
                    decumBalance = 0;
                }
            } else {
                decumBalance = 0;
            }
        }
        
        currentExpenses = currentExpenses * (1 + inflation / 100);

        ageLabels.push(retireAge + y);
        corpusBalanceData.push(Math.round(decumBalance));
        principalInvestedData.push(Math.round(investedAtRetirement));

        tableRows.push([
            `Age ${retireAge + y} (Retire)`,
            `-${fmtCurrency(yearWithdrawn)} (Out)`,
            `+${fmtCurrency(Math.max(0, decumBalance - startBal + yearWithdrawn))} (Gain)`,
            fmtCurrency(decumBalance)
        ]);

        if (decumBalance <= 0 && !depleted) {
            depleted = true;
            depletionAge = retireAge + y;
        }
    }

    renderDataTable(['Age', 'Cash Flow', 'Investment Gains', 'Net Worth'], tableRows);

    const fireProgress = fireNumber > 0 ? (corpusAtRetirement / fireNumber) * 100 : 0;

    const statusHTML = depletionAge
        ? `<div class="metric-card metric-card-warning">
            <span class="metric-title"><i class="fa-solid fa-triangle-exclamation"></i> Corpus Depletion</span>
            <span class="metric-value" style="color: #ef4444;">Age ${depletionAge}</span>
           </div>`
        : `<div class="metric-card metric-card-success">
            <span class="metric-title"><i class="fa-solid fa-circle-check"></i> Sustainability</span>
            <span class="metric-value" style="color: #10b981;">Sustainable</span>
           </div>`;

    renderCalcResults(
        ['Invested Capital', 'Accumulated Gains'],
        [investedAtRetirement, gainsAtRetirement],
        ['#2563eb', '#10b981'],
        `
        <div class="metric-card">
            <span class="metric-title">Corpus at Retirement</span>
            <span class="metric-value" style="color: var(--neon-cyan-vibrant);">${fmtCurrency(corpusAtRetirement)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Required FIRE Number</span>
            <span class="metric-value">${fmtCurrency(fireNumber)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">FIRE Target Progress</span>
            <span class="metric-value" style="color: ${fireProgress >= 100 ? '#10b981' : '#f59e0b'};">${fireProgress.toFixed(1)}%</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Invested Savings</span>
            <span class="metric-value">${fmtCurrency(investedAtRetirement)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Investment Gains</span>
            <span class="metric-value" style="color: #10b981;">+${fmtCurrency(gainsAtRetirement)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Total Withdrawals (Age 85)</span>
            <span class="metric-value" style="color: #f59e0b;">${fmtCurrency(totalWithdrawn)}</span>
        </div>
        <div class="metric-card">
            <span class="metric-title">Nominal Final Balance</span>
            <span class="metric-value">${fmtCurrency(decumBalance)}</span>
        </div>
        ${statusHTML}
        `,
        {
            type: 'line',
            labels: ageLabels.map(age => `Age ${age}`),
            datasets: [
                {
                    label: 'Net Worth Corpus ($)',
                    data: corpusBalanceData,
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.06)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.35,
                    pointBackgroundColor: ageLabels.map((age, idx) => {
                        if (age === retireAge) return '#f59e0b';
                        if (corpusBalanceData[idx] <= 0) return '#ef4444';
                        return '#06b6d4';
                    }),
                    pointBorderColor: ageLabels.map((age, idx) => {
                        if (age === retireAge) return '#f59e0b';
                        if (corpusBalanceData[idx] <= 0) return '#ef4444';
                        return '#06b6d4';
                    }),
                    pointRadius: ageLabels.map((age, idx) => {
                        if (age === retireAge) return 6;
                        if (corpusBalanceData[idx] <= 0) return 6;
                        return 0;
                    }),
                    pointHoverRadius: 6
                }
            ],
            stacked: false
        }
        }
    );
}

// ─── Data Table & Export ────────────────────────────────────────────

function renderDataTable(headers, rows) {
    const thead = document.getElementById('calc-table-head');
    const tbody = document.getElementById('calc-table-body');
    if (!thead || !tbody) return;

    let headerHtml = '<tr>';
    headers.forEach(h => {
        headerHtml += `<th>${h}</th>`;
    });
    headerHtml += '</tr>';
    thead.innerHTML = headerHtml;

    let bodyHtml = '';
    rows.forEach(row => {
        bodyHtml += '<tr>';
        row.forEach(cell => {
            bodyHtml += `<td>${cell}</td>`;
        });
        bodyHtml += '</tr>';
    });
    tbody.innerHTML = bodyHtml;
}

window.exportCalcToPDF = function() {
    const btn = document.querySelector('.export-pdf-btn');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';
    
    const element = document.querySelector('.calculator-visualization-card');
    
    // Temporarily hide the button from the PDF output
    const originalDisplay = btn ? btn.style.display : 'flex';
    if (btn) btn.style.display = 'none';

    html2pdf().set({
        margin: [10, 10, 10, 10],
        filename: `STRATA_Projection_${activeCalcType.toUpperCase()}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(element).save().then(() => {
        if (btn) {
            btn.style.display = originalDisplay;
            btn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Download Report';
        }
        showToast('PDF Report generated successfully');
    });
};
