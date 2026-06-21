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
    if (slider && display) {
        slider.addEventListener('input', () => {
            display.textContent = `${slider.value}%`;
        });
    }
}

// ─── Input Rendering ────────────────────────────────────────────────

function renderCalcInputs(type) {
    const wrapper = document.getElementById('calc-inputs-wrapper');
    if (!wrapper) return;

    if (type === 'sip') {
        wrapper.innerHTML = `
            <div class="input-field-group">
                <label>Monthly Investment ($)</label>
                <input type="number" id="calc-sip-amount" value="500" min="0" step="100">
            </div>
            <div class="input-field-group">
                <label>Expected Return Rate (Annual %)</label>
                <input type="number" id="calc-sip-rate" value="12" min="0" max="100" step="0.5">
            </div>
            <div class="input-field-group">
                <label>Annual Step-Up (%)</label>
                <input type="number" id="calc-sip-stepup" value="10" min="0" max="100" step="1">
            </div>
            <div class="input-field-group">
                <label>Time Period (Years)</label>
                <input type="number" id="calc-sip-years" value="10" min="1" max="50" step="1">
            </div>
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
                <p class="calc-def-text">A Systematic Investment Plan is a structured investment strategy that enables investors to allocate a <strong>predetermined capital amount</strong> at fixed periodic intervals — typically monthly — into mutual funds, index funds, or other market-linked securities. By distributing investments across multiple market cycles, SIPs leverage <strong>dollar-cost averaging (DCA)</strong>, which mitigates the impact of short-term volatility by purchasing more units when prices are low and fewer when prices are high.</p>
                <p class="calc-def-text" style="margin-top: 8px;">The projection model employs the <strong>future value of an annuity-due formula</strong>, compounding monthly contributions at the specified annual rate of return. Over extended horizons, the exponential nature of compound interest causes returns to substantially outpace the principal invested — a phenomenon often referred to as the <strong>"snowball effect"</strong> of wealth accumulation.</p>
                <p class="calc-def-formula"><i class="fa-solid fa-lightbulb"></i> Key Insight: Starting early matters more than investing large amounts. A 10-year head start can outperform double the monthly contribution begun later.</p>
            </div>
        `;
        wireInflationSlider('calc-sip-inflation', 'calc-sip-inflation-val');
    } else if (type === 'emi') {
        wrapper.innerHTML = `
            <div class="input-field-group">
                <label>Loan Amount ($)</label>
                <input type="number" id="calc-emi-amount" value="50000" min="0" step="1000">
            </div>
            <div class="input-field-group">
                <label>Interest Rate (Annual %)</label>
                <input type="number" id="calc-emi-rate" value="7.5" min="0" max="50" step="0.25">
            </div>
            <div class="input-field-group">
                <label>Loan Tenure (Years)</label>
                <input type="number" id="calc-emi-years" value="5" min="1" max="30" step="1">
            </div>
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
                <p class="calc-def-text">An Equated Monthly Installment is a fixed repayment amount paid by a borrower to a lending institution on a specified date each calendar month. The EMI is computed using an <strong>amortization schedule</strong>, where each payment is composed of two components: <strong>interest on the outstanding principal</strong> (which decreases over time) and a <strong>principal repayment portion</strong> (which increases correspondingly). This structure ensures the debt is fully retired by the end of the loan tenure.</p>
                <p class="calc-def-text" style="margin-top: 8px;">The calculator applies the <strong>standard reducing-balance amortization formula</strong>, which accounts for monthly compounding of the stated annual interest rate. The resulting EMI remains constant throughout the tenure, providing borrowers with predictable cash-flow obligations. The total interest paid — the true <strong>cost of borrowing</strong> — is the difference between the aggregate of all EMIs and the original principal amount.</p>
                <p class="calc-def-formula"><i class="fa-solid fa-lightbulb"></i> Key Insight: Even a 0.5% reduction in interest rate or a shorter tenure can save thousands in total interest paid over the life of the loan.</p>
            </div>
        `;
        wireInflationSlider('calc-emi-inflation', 'calc-emi-inflation-val');
    } else if (type === 'swp') {
        wrapper.innerHTML = `
            <div class="input-field-group">
                <label>Total Investment ($)</label>
                <input type="number" id="calc-swp-amount" value="100000" min="0" step="1000">
            </div>
            <div class="input-field-group">
                <label>Withdrawal Per Month ($)</label>
                <input type="number" id="calc-swp-withdraw" value="1000" min="0" step="100">
            </div>
            <div class="input-field-group">
                <label>Expected Return Rate (Annual %)</label>
                <input type="number" id="calc-swp-rate" value="8" min="0" max="50" step="0.5">
            </div>
            <div class="input-field-group">
                <label>Time Period (Years)</label>
                <input type="number" id="calc-swp-years" value="5" min="1" max="50" step="1">
            </div>
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
                <p class="calc-def-text">A Systematic Withdrawal Plan is a structured <strong>decumulation strategy</strong> that enables investors to withdraw a fixed amount from their invested corpus at regular intervals while the remaining balance continues to accrue returns at the prevailing rate. Functionally the <strong>inverse of a SIP</strong>, an SWP is a cornerstone of retirement income planning — converting a lump-sum portfolio into a predictable, pension-like cash-flow stream without requiring full liquidation of holdings.</p>
                <p class="calc-def-text" style="margin-top: 8px;">The projection engine uses an <strong>iterative month-over-month simulation model</strong>: each period, the outstanding balance is compounded at the monthly equivalent of the annual return rate, after which the fixed withdrawal is deducted. The critical variable is the <strong>sustainable withdrawal rate</strong> — if monthly withdrawals exceed the portfolio's growth, the corpus will deplete before the planned horizon; if returns outpace withdrawals, the investor retains residual capital.</p>
                <p class="calc-def-formula"><i class="fa-solid fa-lightbulb"></i> Key Insight: The widely cited "4% rule" suggests withdrawing 4% of your portfolio annually to sustain a 30-year retirement, though actual sustainability depends on market conditions.</p>
            </div>
        `;
        wireInflationSlider('calc-swp-inflation', 'calc-swp-inflation-val');
    }
    window.runCalc = calculateCurrent;
    calculateCurrent();
}

// ─── Dispatcher ─────────────────────────────────────────────────────

function calculateCurrent() {
    if (activeCalcType === 'sip') calculateSIP();
    else if (activeCalcType === 'emi') calculateEMI();
    else if (activeCalcType === 'swp') calculateSWP();
}

// ─── SIP Calculation: Step-Up + Inflation-Adjusted ──────────────────

function calculateSIP() {
    const baseMonthly = parseFloat(document.getElementById('calc-sip-amount').value) || 0;
    const annualRate  = parseFloat(document.getElementById('calc-sip-rate').value) || 0;
    const stepUpPct   = parseFloat(document.getElementById('calc-sip-stepup').value) || 0;
    const years       = parseInt(document.getElementById('calc-sip-years').value) || 0;
    const inflationRate = parseFloat(document.getElementById('calc-sip-inflation').value) || 0;

    if (years <= 0 || baseMonthly <= 0) return;

    const monthlyRate = annualRate / 100 / 12;
    let balance = 0;
    let totalInvested = 0;
    let currentMonthly = baseMonthly;
    const yearLabels = [];
    const yearInvestedCumulative = [];
    const yearGainsCumulative = [];

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

        // Step up monthly contribution for the next year
        currentMonthly = currentMonthly * (1 + stepUpPct / 100);
    }

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
    }

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

    for (let y = 1; y <= years; y++) {
        if (!depleted) {
            for (let m = 0; m < 12; m++) {
                const interest = balance * monthlyRate;
                totalReturnsEarned += interest;
                balance = balance + interest - W;
                totalWithdrawn += W;
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
    }

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
