import { formatLargeCurrency } from '../utils.js';

let calcChartInstance = null;
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

function renderCalcInputs(type) {
    const wrapper = document.getElementById('calc-inputs-wrapper');
    if (!wrapper) return;

    if (type === 'sip') {
        wrapper.innerHTML = `
            <div class="input-field-group">
                <label>Monthly Investment ($)</label>
                <input type="number" id="calc-sip-amount" value="500">
            </div>
            <div class="input-field-group">
                <label>Expected Return Rate (Annual %)</label>
                <input type="number" id="calc-sip-rate" value="12">
            </div>
            <div class="input-field-group">
                <label>Time Period (Years)</label>
                <input type="number" id="calc-sip-years" value="10">
            </div>
            <button class="primary-btn fluid-btn" onclick="window.runCalc()">Calculate Returns</button>
        `;
    } else if (type === 'emi') {
        wrapper.innerHTML = `
            <div class="input-field-group">
                <label>Loan Amount ($)</label>
                <input type="number" id="calc-emi-amount" value="50000">
            </div>
            <div class="input-field-group">
                <label>Interest Rate (Annual %)</label>
                <input type="number" id="calc-emi-rate" value="7.5">
            </div>
            <div class="input-field-group">
                <label>Loan Tenure (Years)</label>
                <input type="number" id="calc-emi-years" value="5">
            </div>
            <button class="primary-btn fluid-btn" onclick="window.runCalc()">Calculate EMI</button>
        `;
    } else if (type === 'swp') {
        wrapper.innerHTML = `
            <div class="input-field-group">
                <label>Total Investment ($)</label>
                <input type="number" id="calc-swp-amount" value="100000">
            </div>
            <div class="input-field-group">
                <label>Withdrawal Per Month ($)</label>
                <input type="number" id="calc-swp-withdraw" value="1000">
            </div>
            <div class="input-field-group">
                <label>Expected Return Rate (Annual %)</label>
                <input type="number" id="calc-swp-rate" value="8">
            </div>
            <div class="input-field-group">
                <label>Time Period (Years)</label>
                <input type="number" id="calc-swp-years" value="5">
            </div>
            <button class="primary-btn fluid-btn" onclick="window.runCalc()">Calculate Balance</button>
        `;
    }
    window.runCalc = calculateCurrent;
    calculateCurrent();
}

function calculateCurrent() {
    if (activeCalcType === 'sip') calculateSIP();
    else if (activeCalcType === 'emi') calculateEMI();
    else if (activeCalcType === 'swp') calculateSWP();
}

function calculateSIP() {
    const P = parseFloat(document.getElementById('calc-sip-amount').value) || 0;
    const r = (parseFloat(document.getElementById('calc-sip-rate').value) || 0) / 100 / 12;
    const n = (parseFloat(document.getElementById('calc-sip-years').value) || 0) * 12;

    const invested = P * n;
    const futureValue = P * ((Math.pow(1 + r, n) - 1) / r) * (1 + r);
    const estReturns = futureValue - invested;

    renderCalcResults(
        ['Invested Amount', 'Est. Returns'],
        [invested, Math.max(0, estReturns)],
        ['#3b82f6', '#10b981'],
        `
        <div class="metric-card"><span class="metric-title">Invested Amount</span><span class="metric-value">$${invested.toLocaleString('en-US', {maximumFractionDigits:0})}</span></div>
        <div class="metric-card"><span class="metric-title">Est. Returns</span><span class="metric-value" style="color: #10b981;">+$${Math.max(0, estReturns).toLocaleString('en-US', {maximumFractionDigits:0})}</span></div>
        <div class="metric-card"><span class="metric-title">Total Value</span><span class="metric-value">$${futureValue.toLocaleString('en-US', {maximumFractionDigits:0})}</span></div>
        `
    );
}

function calculateEMI() {
    const P = parseFloat(document.getElementById('calc-emi-amount').value) || 0;
    const r = (parseFloat(document.getElementById('calc-emi-rate').value) || 0) / 100 / 12;
    const n = (parseFloat(document.getElementById('calc-emi-years').value) || 0) * 12;

    const emi = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    const totalPayment = emi * n;
    const totalInterest = totalPayment - P;

    renderCalcResults(
        ['Principal', 'Total Interest'],
        [P, Math.max(0, totalInterest)],
        ['#3b82f6', '#ef4444'],
        `
        <div class="metric-card"><span class="metric-title">Monthly EMI</span><span class="metric-value">$${emi.toLocaleString('en-US', {maximumFractionDigits:0})}</span></div>
        <div class="metric-card"><span class="metric-title">Principal Amount</span><span class="metric-value">$${P.toLocaleString('en-US', {maximumFractionDigits:0})}</span></div>
        <div class="metric-card"><span class="metric-title">Total Interest</span><span class="metric-value" style="color: #ef4444;">$${Math.max(0, totalInterest).toLocaleString('en-US', {maximumFractionDigits:0})}</span></div>
        `
    );
}

function calculateSWP() {
    const P = parseFloat(document.getElementById('calc-swp-amount').value) || 0;
    const W = parseFloat(document.getElementById('calc-swp-withdraw').value) || 0;
    const r = (parseFloat(document.getElementById('calc-swp-rate').value) || 0) / 100 / 12;
    const n = (parseFloat(document.getElementById('calc-swp-years').value) || 0) * 12;

    let balance = P;
    let totalWithdrawn = 0;
    for (let i = 0; i < n; i++) {
        balance = balance * (1 + r) - W;
        totalWithdrawn += W;
        if (balance < 0) balance = 0;
    }

    renderCalcResults(
        ['Final Balance', 'Total Withdrawn'],
        [balance, totalWithdrawn],
        ['#3b82f6', '#f59e0b'],
        `
        <div class="metric-card"><span class="metric-title">Total Investment</span><span class="metric-value">$${P.toLocaleString('en-US', {maximumFractionDigits:0})}</span></div>
        <div class="metric-card"><span class="metric-title">Total Withdrawn</span><span class="metric-value" style="color: #f59e0b;">$${totalWithdrawn.toLocaleString('en-US', {maximumFractionDigits:0})}</span></div>
        <div class="metric-card"><span class="metric-title">Final Balance</span><span class="metric-value">$${balance.toLocaleString('en-US', {maximumFractionDigits:0})}</span></div>
        `
    );
}

function renderCalcResults(labels, data, colors, html) {
    const summary = document.getElementById('calc-numerical-summary');
    if (summary) summary.innerHTML = html;

    const canvas = document.getElementById('calculatorPieChart');
    if (!canvas) return;

    if (calcChartInstance) calcChartInstance.destroy();
    calcChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{ data: data, backgroundColor: colors, borderWidth: 0 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: '#e2e8f0' } } }
        }
    });
}
