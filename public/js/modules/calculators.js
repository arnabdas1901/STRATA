/**
 * STRATA Research Terminal - Institutional Financial Calculators & Quant Workstation
 * 100% Client-Side Quantitative Engine · Zero Network/API Calls
 * Models: Step-Up SIP, Endowment SWP, Actuarial FIRE, Debt Prepayment,
 *         WACC & 2-Stage DCF, Fixed Income Bond & DV01, PE LBO IRR/MOIC, Black-Scholes & Kelly
 */

let calcBarInstance = null;
let calcDoughnutInstance = null;
let activeCalcType = 'sip';
let currentCurrency = 'USD'; // 'USD' | 'INR'
let activeTableData = { headers: [], rows: [] };

// ─── Entry Point & Event Wiring ──────────────────────────────────────

export function setupCalculators() {
    // 1. Desk Model Selector Buttons
    const toggles = document.querySelectorAll('.calc-toggle');
    toggles.forEach(btn => {
        btn.addEventListener('click', () => {
            toggles.forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            activeCalcType = btn.getAttribute('data-calc');
            renderCalcInputs(activeCalcType);
        });
    });

    // 2. Global Currency Switcher (USD <-> INR)
    const currencyButtons = document.querySelectorAll('.currency-pill');
    currencyButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            currencyButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const newCurrency = btn.getAttribute('data-currency');
            if (newCurrency !== currentCurrency) {
                currentCurrency = newCurrency;
                // Re-render inputs to reflect updated prefixes/suffixes and recalculate
                renderCalcInputs(activeCalcType);
            }
        });
    });

    // 3. Reset Baseline Button
    const resetBtn = document.getElementById('calc-reset-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            applyScenarioPreset(activeCalcType, 'base');
        });
    }

    // 4. Export Actions
    const csvBtn = document.getElementById('export-calc-csv-btn');
    if (csvBtn) {
        csvBtn.addEventListener('click', exportCalcToCSV);
    }

    const pdfBtn = document.getElementById('export-calc-pdf-btn');
    if (pdfBtn) {
        pdfBtn.addEventListener('click', exportCalcToPDF);
    }

    // Initial render
    renderCalcInputs(activeCalcType);
}

// ─── Currency & Mathematical Formatting ─────────────────────────────

function getCurrencySymbol() {
    return currentCurrency === 'INR' ? '₹' : '$';
}

function fmtCurrency(val, forceDecimals = null) {
    if (val == null || isNaN(val)) return `${getCurrencySymbol()}0`;
    const abs = Math.abs(val);
    const sign = val < 0 ? '-' : '';
    const sym = getCurrencySymbol();

    if (currentCurrency === 'INR') {
        // Indian Wealth Notation (Crores & Lakhs)
        if (abs >= 1e7) {
            return `${sign}${sym}${(abs / 1e7).toFixed(2)} Cr`;
        }
        if (abs >= 1e5) {
            return `${sign}${sym}${(abs / 1e5).toFixed(2)} L`;
        }
        return `${sign}${sym}${abs.toLocaleString('en-IN', { maximumFractionDigits: forceDecimals ?? 0 })}`;
    } else {
        // US Institutional Notation (Billions, Millions, Thousands)
        if (abs >= 1e9) {
            return `${sign}${sym}${(abs / 1e9).toFixed(2)}B`;
        }
        if (abs >= 1e6) {
            return `${sign}${sym}${(abs / 1e6).toFixed(2)}M`;
        }
        if (abs >= 1e3 && forceDecimals === null && abs >= 100000) {
            return `${sign}${sym}${(abs / 1e3).toFixed(1)}K`;
        }
        return `${sign}${sym}${abs.toLocaleString('en-US', {
            minimumFractionDigits: forceDecimals ?? (abs < 100 ? 2 : 0),
            maximumFractionDigits: forceDecimals ?? (abs < 100 ? 2 : 0)
        })}`;
    }
}

function fmtPct(val, decimals = 2) {
    if (val == null || isNaN(val)) return '0.00%';
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toFixed(decimals)}%`;
}

function fmtNum(val, decimals = 2) {
    if (val == null || isNaN(val)) return '0';
    return Number(val).toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

function updateBasisBadge(isReal) {
    const badge = document.getElementById('calc-basis-badge');
    const text = document.getElementById('calc-basis-text');
    if (!badge || !text) return;
    const indicator = badge.querySelector('.basis-indicator');
    if (isReal) {
        if (indicator) {
            indicator.className = 'basis-indicator real';
        }
        text.textContent = 'Real Basis (Inf-Adj)';
    } else {
        if (indicator) {
            indicator.className = 'basis-indicator nominal';
        }
        text.textContent = 'Nominal Basis';
    }
}

// ─── Dual-Bound Input Components & Sync ──────────────────────────────

function createDualInput(id, label, value, min, max, step, prefix = '', suffix = '') {
    return `
        <div class="dual-input-group">
            <div class="dual-input-header">
                <label for="${id}">${label}</label>
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

function syncDualInput(id, callback = calculateCurrent) {
    const input = document.getElementById(id);
    const slider = document.getElementById(`${id}-slider`);
    if (!input || !slider) return;

    input.addEventListener('input', (e) => {
        let val = parseFloat(e.target.value);
        if (!isNaN(val)) {
            slider.value = val;
            callback();
        }
    });

    slider.addEventListener('input', (e) => {
        input.value = e.target.value;
        callback();
    });
}

// ─── Presets & Methodology Engine ───────────────────────────────────

const MODEL_PRESETS = {
    sip: {
        conservative: { lumpsum: 0, amount: 500, rate: 8.0, stepup: 5, years: 15, inflation: 5.0, fee: 0.75 },
        base:         { lumpsum: 10000, amount: 1500, rate: 12.0, stepup: 10, years: 20, inflation: 5.0, fee: 0.50 },
        aggressive:   { lumpsum: 25000, amount: 3000, rate: 15.0, stepup: 15, years: 25, inflation: 4.0, fee: 0.20 }
    },
    swp: {
        conservative: { corpus: 1500000, withdraw: 4000, inflation: 4.0, rate: 7.0, years: 30, shock: -15 },
        base:         { corpus: 1000000, withdraw: 4500, inflation: 4.5, rate: 8.5, years: 25, shock: 0 },
        aggressive:   { corpus: 1000000, withdraw: 6000, inflation: 6.0, rate: 6.5, years: 25, shock: -25 }
    },
    fire: {
        conservative: { curAge: 32, retAge: 52, lifeAge: 90, corpus: 200000, monthly: 3500, stepup: 5, expenses: 6000, preRate: 8.0, postRate: 6.0, inflation: 4.0, swr: 3.25 },
        base:         { curAge: 30, retAge: 45, lifeAge: 90, corpus: 100000, monthly: 2500, stepup: 7, expenses: 4000, preRate: 10.0, postRate: 7.0, inflation: 4.0, swr: 3.75 },
        aggressive:   { curAge: 28, retAge: 40, lifeAge: 90, corpus: 50000, monthly: 4000, stepup: 10, expenses: 3000, preRate: 12.0, postRate: 8.0, inflation: 4.0, swr: 4.25 }
    },
    emi: {
        conservative: { principal: 400000, rate: 7.25, years: 30, extra: 0, annual: 0 },
        base:         { principal: 400000, rate: 7.25, years: 30, extra: 350, annual: 2000 },
        aggressive:   { principal: 400000, rate: 7.25, years: 30, extra: 750, annual: 5000 }
    },
    dcf: {
        conservative: { fcf: 400, growth: 8.0, stepup: -1.0, wacc: 10.5, terminal: 2.0, shares: 100, debt: 100, price: 48 },
        base:         { fcf: 500, growth: 12.0, stepup: -0.5, wacc: 9.0, terminal: 2.5, shares: 100, debt: 50, price: 65 },
        aggressive:   { fcf: 600, growth: 20.0, stepup: -1.5, wacc: 8.5, terminal: 3.0, shares: 100, debt: -50, price: 85 }
    },
    bond: {
        conservative: { par: 1000, coupon: 4.5, yield: 4.75, maturity: 3, freq: 2 },
        base:         { par: 1000, coupon: 5.5, yield: 5.0, maturity: 10, freq: 2 },
        aggressive:   { par: 1000, coupon: 6.75, yield: 6.25, maturity: 30, freq: 2 }
    },
    lbo: {
        conservative: { ebitda: 80, entryMult: 9.0, lev: 4.0, intRate: 8.0, ebitdaGrowth: 6.0, fcfConv: 60, hold: 5, exitMult: 8.5 },
        base:         { ebitda: 100, entryMult: 10.5, lev: 5.0, intRate: 7.5, ebitdaGrowth: 10.0, fcfConv: 65, hold: 5, exitMult: 10.5 },
        aggressive:   { ebitda: 120, entryMult: 11.0, lev: 5.5, intRate: 7.0, ebitdaGrowth: 15.0, fcfConv: 70, hold: 5, exitMult: 12.0 }
    },
    options: {
        conservative: { spot: 100, strike: 100, dte: 45, iv: 25, rate: 4.5, div: 0, type: 'call', winProb: 55, winLoss: 1.5 },
        base:         { spot: 150, strike: 165, dte: 30, iv: 45, rate: 4.5, div: 0.5, type: 'call', winProb: 48, winLoss: 2.2 },
        aggressive:   { spot: 100, strike: 95, dte: 60, iv: 28, rate: 4.5, div: 1.0, type: 'put', winProb: 60, winLoss: 1.2 }
    }
};

function renderPresetsBar(type) {
    const container = document.getElementById('calc-presets-container');
    if (!container) return;
    container.innerHTML = `
        <button type="button" class="preset-chip" data-preset="conservative"><i class="fa-solid fa-shield"></i> Conservative</button>
        <button type="button" class="preset-chip active" data-preset="base"><i class="fa-solid fa-landmark"></i> Base Institutional</button>
        <button type="button" class="preset-chip" data-preset="aggressive"><i class="fa-solid fa-bolt"></i> Aggressive / Stress</button>
    `;
    container.querySelectorAll('.preset-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.preset-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyScenarioPreset(type, btn.getAttribute('data-preset'));
        });
    });
}

function applyScenarioPreset(type, presetKey) {
    const p = MODEL_PRESETS[type]?.[presetKey];
    if (!p) return;

    // Scale currency-dependent values if INR is active
    const scale = currentCurrency === 'INR' ? 50 : 1;

    Object.entries(p).forEach(([k, val]) => {
        let finalVal = val;
        // Scale monetary inputs appropriately in INR
        if (currentCurrency === 'INR' && ['lumpsum', 'amount', 'corpus', 'withdraw', 'monthly', 'expenses', 'principal', 'extra', 'annual'].includes(k)) {
            finalVal = val * scale;
        }
        const el = document.getElementById(`calc-${type}-${k}`);
        const slider = document.getElementById(`calc-${type}-${k}-slider`);
        if (el) el.value = finalVal;
        if (slider) slider.value = finalVal;
    });

    calculateCurrent();
}

function renderMethodologyAccordion(type) {
    const container = document.getElementById('calc-methodology-accordion');
    if (!container) return;

    const specs = {
        sip: {
            title: 'Step-Up SIP & Compounding Actuarial Mechanics',
            formula: 'M_y = M_0 \\cdot (1 + s)^y \\quad | \\quad B_{\\text{net}, m} = (B_{m-1} + M_m) \\cdot \\left(1 + \\frac{r - f}{12}\\right) \\quad | \\quad \\text{Real } B = \\frac{B_t}{(1 + \\pi)^t}',
            desc: 'Simulates monthly compounding with annual percentage step-ups. Compares gross asset yield vs. net wealth after management fee drag and deflates future values by continuous inflation.'
        },
        swp: {
            title: 'Endowment Decumulation & Sequence-of-Returns Mechanics',
            formula: 'W_y = W_0 \\cdot (1 + \\pi)^y \\quad | \\quad B_m = B_{m-1} \\cdot (1 + r_m) - W_m \\quad | \\quad r_1 = r_{\\text{base}} + \\text{shock}_1',
            desc: 'Models portfolio drawdown with inflation-indexed withdrawals. Simulates severe early bear market drawdowns in Year 1 to stress-test sequence-of-returns portfolio ruin.'
        },
        fire: {
            title: 'Trinity Safe Withdrawal & Actuarial Life-Cycle Model',
            formula: 'E_{\\text{FIRE}} = 12 E_0 (1+\\pi)^T \\quad | \\quad \\text{FIRE Target} = \\frac{E_{\\text{FIRE}}}{\\text{SWR}} \\quad | \\quad dS_t = \\mu S_t dt + \\sigma S_t dW_t',
            desc: 'Bridges life-cycle capital accumulation with retirement decumulation. Executes a 250-path Box-Muller stochastic Monte Carlo simulation to compute empirical portfolio survival rates.'
        },
        emi: {
            title: 'Amortization & Prepayment Alpha Optimization',
            formula: 'E = L \\cdot \\frac{i(1+i)^n}{(1+i)^n - 1} \\quad | \\quad \\text{Principal}_t = E - (B_{t-1} \\cdot i) + P_{\\text{extra}}',
            desc: 'Calculates standard reducing-balance loan amortization alongside an accelerated prepayment schedule to quantify interest savings alpha and tenure compression.'
        },
        dcf: {
            title: 'CAPM WACC & 2-Stage Gordon Growth DCF Valuation',
            formula: 'K_e = R_f + \\beta(ERP) \\quad | \\quad \\text{WACC} = w_e K_e + w_d K_d (1-t) \\quad | \\quad TV_5 = \\frac{\\text{FCF}_5(1+g_T)}{\\text{WACC} - g_T}',
            desc: 'Computes institutional cost of capital via CAPM, discounts 5 years of projected free cash flows to the firm (FCFF), capitalizes terminal value, and bridges to implied share price.'
        },
        bond: {
            title: 'Fixed Income Duration, DV01 & Convexity Engine',
            formula: 'P = \\sum_{t=1}^n \\frac{C/m}{(1+y/m)^t} + \\frac{F}{(1+y/m)^n} \\quad | \\quad D_{\\text{mod}} = \\frac{D_{\\text{mac}}}{1+y/m} \\quad | \\quad \\frac{\\Delta P}{P} \\approx -D_{\\text{mod}}\\Delta y + \\frac{1}{2}C(\\Delta y)^2',
            desc: 'Computes exact discounted bond cash flows, Macaulay/Modified Duration, DV01 per $10k par, and second-order price convexity across interest rate shock regimes.'
        },
        lbo: {
            title: 'Blackstone LBO Debt Paydown, IRR & Value Attribution',
            formula: '\\text{MOIC} = \\frac{\\text{Exit Equity}}{\\text{Entry Equity}} \\quad | \\quad \\text{IRR} = (\\text{MOIC})^{1/N} - 1 \\quad | \\quad \\Delta E = \\Delta \\text{EBITDA} + \\Delta \\text{Mult} + \\text{De-leveraging}',
            desc: 'Simulates private equity buyout capital structure, annual mandatory and cash-sweep debt paydown, and decomposes total equity creation into operational growth vs. multiple expansion vs. leverage.'
        },
        options: {
            title: 'Black-Scholes-Merton Analytical Greeks & Fractional Kelly',
            formula: 'd_1 = \\frac{\\ln(S/K) + (r-q+\\frac{1}{2}\\sigma^2)T}{\\sigma\\sqrt{T}} \\quad | \\quad \\Delta = e^{-qT}\\Phi(d_1) \\quad | \\quad f^* = p - \\frac{1-p}{b}',
            desc: 'Evaluates closed-form European options fair values, complete partial derivatives (Delta, Gamma, Theta, Vega, Rho), and determines optimal capital sizing via the Kelly Criterion.'
        }
    };

    const s = specs[type] || specs.sip;

    container.innerHTML = `
        <div class="methodology-toggle-header" id="methodology-header">
            <span class="methodology-title"><i class="fa-solid fa-square-root-variable"></i> ${s.title}</span>
            <i class="fa-solid fa-chevron-down" id="methodology-icon"></i>
        </div>
        <div class="methodology-body" id="methodology-body" style="display: none;">
            <p>${s.desc}</p>
            <div class="math-equation-box">${s.formula}</div>
        </div>
    `;

    const hdr = document.getElementById('methodology-header');
    const bdy = document.getElementById('methodology-body');
    const icn = document.getElementById('methodology-icon');
    if (hdr && bdy && icn) {
        hdr.addEventListener('click', () => {
            const isHidden = bdy.style.display === 'none';
            bdy.style.display = isHidden ? 'block' : 'none';
            icn.className = isHidden ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down';
        });
    }
}

// ─── Input Rendering Switcher ───────────────────────────────────────

function renderCalcInputs(type) {
    const wrapper = document.getElementById('calc-inputs-wrapper');
    if (!wrapper) return;

    renderPresetsBar(type);
    renderMethodologyAccordion(type);

    const sym = getCurrencySymbol();
    const currScale = currentCurrency === 'INR' ? 50 : 1;

    if (type === 'sip') {
        wrapper.innerHTML = `
            ${createDualInput('calc-sip-lumpsum', 'Initial Lumpsum Capital', 10000 * currScale, 0, 500000 * currScale, 1000 * currScale, sym)}
            ${createDualInput('calc-sip-amount', 'Monthly Contribution (SIP)', 1500 * currScale, 100 * currScale, 50000 * currScale, 100 * currScale, sym)}
            ${createDualInput('calc-sip-stepup', 'Annual Step-Up Rate', 10, 0, 50, 1, '', '%')}
            ${createDualInput('calc-sip-rate', 'Expected Annual Return', 12, 1, 35, 0.5, '', '%')}
            ${createDualInput('calc-sip-years', 'Investment Horizon', 20, 1, 40, 1, '', 'Yrs')}
            ${createDualInput('calc-sip-inflation', 'Expected Inflation Rate', 5.0, 0, 15, 0.25, '', '%')}
            ${createDualInput('calc-sip-fee', 'Expense Ratio / Fee Drag', 0.50, 0, 3.0, 0.05, '', '%')}
        `;
        syncDualInput('calc-sip-lumpsum');
        syncDualInput('calc-sip-amount');
        syncDualInput('calc-sip-stepup');
        syncDualInput('calc-sip-rate');
        syncDualInput('calc-sip-years');
        syncDualInput('calc-sip-inflation');
        syncDualInput('calc-sip-fee');
    } else if (type === 'swp') {
        wrapper.innerHTML = `
            ${createDualInput('calc-swp-corpus', 'Starting Endowment / Corpus', 1000000 * currScale, 50000 * currScale, 10000000 * currScale, 25000 * currScale, sym)}
            ${createDualInput('calc-swp-withdraw', 'Initial Monthly Withdrawal', 4500 * currScale, 500 * currScale, 100000 * currScale, 250 * currScale, sym)}
            ${createDualInput('calc-swp-inflation', 'Annual Withdrawal Indexing', 4.5, 0, 15, 0.25, '', '%')}
            ${createDualInput('calc-swp-rate', 'Portfolio Annual Return', 8.5, 1, 25, 0.25, '', '%')}
            ${createDualInput('calc-swp-years', 'Horizon Period', 25, 5, 50, 1, '', 'Yrs')}
            ${createDualInput('calc-swp-shock', 'Year-1 Stress Shock (Seq Risk)', 0, -35, 15, 1, '', '%')}
        `;
        syncDualInput('calc-swp-corpus');
        syncDualInput('calc-swp-withdraw');
        syncDualInput('calc-swp-inflation');
        syncDualInput('calc-swp-rate');
        syncDualInput('calc-swp-years');
        syncDualInput('calc-swp-shock');
    } else if (type === 'fire') {
        wrapper.innerHTML = `
            ${createDualInput('calc-fire-curAge', 'Current Age', 30, 18, 70, 1, '', 'Yrs')}
            ${createDualInput('calc-fire-retAge', 'Target FIRE Age', 45, 25, 80, 1, '', 'Yrs')}
            ${createDualInput('calc-fire-lifeAge', 'Actuarial Life Expectancy', 90, 60, 105, 1, '', 'Yrs')}
            ${createDualInput('calc-fire-corpus', 'Current Invested Net Worth', 100000 * currScale, 0, 5000000 * currScale, 10000 * currScale, sym)}
            ${createDualInput('calc-fire-monthly', 'Monthly Savings Contribution', 2500 * currScale, 0, 50000 * currScale, 250 * currScale, sym)}
            ${createDualInput('calc-fire-stepup', 'Annual Savings Step-Up', 7, 0, 25, 1, '', '%')}
            ${createDualInput('calc-fire-expenses', 'Current Monthly Expenses', 4000 * currScale, 500 * currScale, 50000 * currScale, 250 * currScale, sym)}
            ${createDualInput('calc-fire-preRate', 'Pre-Retirement Annual Return', 10.0, 2, 25, 0.5, '', '%')}
            ${createDualInput('calc-fire-postRate', 'Post-Retirement Annual Return', 7.0, 2, 20, 0.5, '', '%')}
            ${createDualInput('calc-fire-inflation', 'Expected Inflation Rate', 4.0, 0, 12, 0.25, '', '%')}
            ${createDualInput('calc-fire-swr', 'Safe Withdrawal Rate (SWR)', 3.75, 2.0, 6.0, 0.05, '', '%')}
        `;
        syncDualInput('calc-fire-curAge');
        syncDualInput('calc-fire-retAge');
        syncDualInput('calc-fire-lifeAge');
        syncDualInput('calc-fire-corpus');
        syncDualInput('calc-fire-monthly');
        syncDualInput('calc-fire-stepup');
        syncDualInput('calc-fire-expenses');
        syncDualInput('calc-fire-preRate');
        syncDualInput('calc-fire-postRate');
        syncDualInput('calc-fire-inflation');
        syncDualInput('calc-fire-swr');
    } else if (type === 'emi') {
        wrapper.innerHTML = `
            ${createDualInput('calc-emi-principal', 'Loan Facility Amount', 400000 * currScale, 10000 * currScale, 5000000 * currScale, 10000 * currScale, sym)}
            ${createDualInput('calc-emi-rate', 'Annual Interest Rate', 7.25, 2.0, 22.0, 0.05, '', '%')}
            ${createDualInput('calc-emi-years', 'Loan Tenure', 30, 1, 40, 1, '', 'Yrs')}
            ${createDualInput('calc-emi-extra', 'Monthly Extra Prepayment', 350 * currScale, 0, 20000 * currScale, 50 * currScale, sym)}
            ${createDualInput('calc-emi-annual', 'Annual Lumpsum Prepayment', 2000 * currScale, 0, 100000 * currScale, 500 * currScale, sym)}
        `;
        syncDualInput('calc-emi-principal');
        syncDualInput('calc-emi-rate');
        syncDualInput('calc-emi-years');
        syncDualInput('calc-emi-extra');
        syncDualInput('calc-emi-annual');
    } else if (type === 'dcf') {
        wrapper.innerHTML = `
            ${createDualInput('calc-dcf-fcf', 'Base Free Cash Flow (FCF₀)', 500, 10, 10000, 25, sym, 'M')}
            ${createDualInput('calc-dcf-growth', 'Stage-1 Growth Rate (Y1–5)', 12.0, -10, 45, 0.5, '', '%')}
            ${createDualInput('calc-dcf-stepup', 'Annual Growth Step-Down', -0.5, -5.0, 5.0, 0.25, '', '%')}
            ${createDualInput('calc-dcf-wacc', 'Discount Rate (WACC)', 9.0, 4.0, 20.0, 0.25, '', '%')}
            ${createDualInput('calc-dcf-terminal', 'Terminal Perpetual Growth (g)', 2.5, 0.5, 5.0, 0.1, '', '%')}
            ${createDualInput('calc-dcf-shares', 'Diluted Shares Outstanding', 100, 1, 2000, 5, '', 'M')}
            ${createDualInput('calc-dcf-debt', 'Net Debt (+Debt / -Cash)', 50, -5000, 10000, 25, sym, 'M')}
            ${createDualInput('calc-dcf-price', 'Current Market Share Price', 65, 1, 1000, 1, sym)}
        `;
        syncDualInput('calc-dcf-fcf');
        syncDualInput('calc-dcf-growth');
        syncDualInput('calc-dcf-stepup');
        syncDualInput('calc-dcf-wacc');
        syncDualInput('calc-dcf-terminal');
        syncDualInput('calc-dcf-shares');
        syncDualInput('calc-dcf-debt');
        syncDualInput('calc-dcf-price');
    } else if (type === 'bond') {
        wrapper.innerHTML = `
            ${createDualInput('calc-bond-par', 'Face / Par Value', 1000, 100, 100000, 100, sym)}
            ${createDualInput('calc-bond-coupon', 'Annual Coupon Rate', 5.5, 0, 25, 0.1, '', '%')}
            ${createDualInput('calc-bond-yield', 'Yield to Maturity (YTM)', 5.0, 0.1, 30, 0.1, '', '%')}
            ${createDualInput('calc-bond-maturity', 'Maturity Horizon', 10, 1, 50, 1, '', 'Yrs')}
            <div class="dual-input-group">
                <div class="dual-input-header">
                    <label for="calc-bond-freq">Coupon Frequency</label>
                    <div class="input-wrapper" style="width: auto;">
                        <select id="calc-bond-freq" style="background:transparent; border:none; color:#fff; font-family:var(--font-mono); font-size:0.85rem; font-weight:600; outline:none; cursor:pointer;">
                            <option value="1" style="background:#0f172a; color:#fff;">Annual (1x)</option>
                            <option value="2" selected style="background:#0f172a; color:#fff;">Semi-Annual (2x)</option>
                            <option value="4" style="background:#0f172a; color:#fff;">Quarterly (4x)</option>
                        </select>
                    </div>
                </div>
            </div>
        `;
        syncDualInput('calc-bond-par');
        syncDualInput('calc-bond-coupon');
        syncDualInput('calc-bond-yield');
        syncDualInput('calc-bond-maturity');
        const freqSelect = document.getElementById('calc-bond-freq');
        if (freqSelect) freqSelect.addEventListener('change', calculateCurrent);
    } else if (type === 'lbo') {
        wrapper.innerHTML = `
            ${createDualInput('calc-lbo-ebitda', 'Entry LTM EBITDA', 100, 5, 2000, 5, sym, 'M')}
            ${createDualInput('calc-lbo-entryMult', 'Entry EV / EBITDA Multiple', 10.5, 4.0, 25.0, 0.25, '', 'x')}
            ${createDualInput('calc-lbo-lev', 'Initial Debt / EBITDA Leverage', 5.0, 1.0, 9.0, 0.25, '', 'x')}
            ${createDualInput('calc-lbo-intRate', 'Blended Debt Interest Rate', 7.5, 2.0, 18.0, 0.25, '', '%')}
            ${createDualInput('calc-lbo-ebitdaGrowth', 'Annual EBITDA Growth Rate', 10.0, -10, 35, 0.5, '', '%')}
            ${createDualInput('calc-lbo-fcfConv', 'FCF Conversion (% of EBITDA)', 65, 20, 95, 1, '', '%')}
            ${createDualInput('calc-lbo-hold', 'Investment Holding Period', 5, 2, 10, 1, '', 'Yrs')}
            ${createDualInput('calc-lbo-exitMult', 'Exit EV / EBITDA Multiple', 10.5, 4.0, 25.0, 0.25, '', 'x')}
        `;
        syncDualInput('calc-lbo-ebitda');
        syncDualInput('calc-lbo-entryMult');
        syncDualInput('calc-lbo-lev');
        syncDualInput('calc-lbo-intRate');
        syncDualInput('calc-lbo-ebitdaGrowth');
        syncDualInput('calc-lbo-fcfConv');
        syncDualInput('calc-lbo-hold');
        syncDualInput('calc-lbo-exitMult');
    } else if (type === 'options') {
        wrapper.innerHTML = `
            ${createDualInput('calc-options-spot', 'Underlying Spot Price (S)', 100, 1, 5000, 1, sym)}
            ${createDualInput('calc-options-strike', 'Option Strike Price (K)', 100, 1, 5000, 1, sym)}
            ${createDualInput('calc-options-dte', 'Time to Expiration (DTE)', 45, 1, 730, 1, '', 'Days')}
            ${createDualInput('calc-options-iv', 'Implied Volatility (IV)', 25.0, 2.0, 200.0, 0.5, '', '%')}
            ${createDualInput('calc-options-rate', 'Risk-Free Interest Rate', 4.5, 0, 15.0, 0.1, '', '%')}
            ${createDualInput('calc-options-div', 'Continuous Dividend Yield', 0.0, 0, 10.0, 0.1, '', '%')}
            <div class="dual-input-group">
                <div class="dual-input-header">
                    <label for="calc-options-type">Option Contract Type</label>
                    <div class="input-wrapper" style="width: auto;">
                        <select id="calc-options-type" style="background:transparent; border:none; color:#fff; font-family:var(--font-mono); font-size:0.85rem; font-weight:600; outline:none; cursor:pointer;">
                            <option value="call" selected style="background:#0f172a; color:#fff;">Call Option (Bullish / Right to Buy)</option>
                            <option value="put" style="background:#0f172a; color:#fff;">Put Option (Bearish / Right to Sell)</option>
                        </select>
                    </div>
                </div>
            </div>
            ${createDualInput('calc-options-winProb', 'Kelly Sizer Win Probability', 55.0, 5.0, 95.0, 1.0, '', '%')}
            ${createDualInput('calc-options-winLoss', 'Kelly Win / Loss Payoff Ratio', 1.5, 0.2, 10.0, 0.1, '', 'x')}
        `;
        syncDualInput('calc-options-spot');
        syncDualInput('calc-options-strike');
        syncDualInput('calc-options-dte');
        syncDualInput('calc-options-iv');
        syncDualInput('calc-options-rate');
        syncDualInput('calc-options-div');
        syncDualInput('calc-options-winProb');
        syncDualInput('calc-options-winLoss');
        const optTypeSelect = document.getElementById('calc-options-type');
        if (optTypeSelect) optTypeSelect.addEventListener('change', calculateCurrent);
    }

    calculateCurrent();
}

function calculateCurrent() {
    switch (activeCalcType) {
        case 'sip':     calculateSIP(); break;
        case 'swp':     calculateSWP(); break;
        case 'fire':    calculateFIRE(); break;
        case 'emi':     calculateEMI(); break;
        case 'dcf':     calculateDCF(); break;
        case 'bond':    calculateBond(); break;
        case 'lbo':     calculateLBO(); break;
        case 'options': calculateOptions(); break;
        default:        calculateSIP(); break;
    }
}

// ─── MODEL 1: Step-Up SIP & Stochastic Wealth Engine ────────────────

function calculateSIP() {
    const P0 = parseFloat(document.getElementById('calc-sip-lumpsum')?.value) || 0;
    const M0 = parseFloat(document.getElementById('calc-sip-amount')?.value) || 0;
    const s = (parseFloat(document.getElementById('calc-sip-stepup')?.value) || 0) / 100;
    const r = (parseFloat(document.getElementById('calc-sip-rate')?.value) || 0) / 100;
    const N = parseInt(document.getElementById('calc-sip-years')?.value, 10) || 1;
    const inflation = (parseFloat(document.getElementById('calc-sip-inflation')?.value) || 0) / 100;
    const f = (parseFloat(document.getElementById('calc-sip-fee')?.value) || 0) / 100;

    updateBasisBadge(false);

    const r_gross_m = r / 12;
    const r_net_m = Math.max(0, (r - f) / 12);

    let grossCorpus = P0;
    let netCorpus = P0;
    let flatNetCorpus = P0;
    let totalInvested = P0;
    let flatTotalInvested = P0;

    const years = [];
    const investedSeries = [];
    const netCorpusSeries = [];
    const realCorpusSeries = [];
    const tableRows = [];

    for (let y = 0; y < N; y++) {
        const monthlyDeposit = M0 * Math.pow(1 + s, y);

        for (let m = 0; m < 12; m++) {
            totalInvested += monthlyDeposit;
            flatTotalInvested += M0;

            grossCorpus = (grossCorpus + monthlyDeposit) * (1 + r_gross_m);
            netCorpus = (netCorpus + monthlyDeposit) * (1 + r_net_m);
            flatNetCorpus = (flatNetCorpus + M0) * (1 + r_net_m);
        }

        const t = y + 1;
        const realCorpus = netCorpus / Math.pow(1 + inflation, t);

        years.push(`Yr ${t}`);
        investedSeries.push(Math.round(totalInvested));
        netCorpusSeries.push(Math.round(netCorpus));
        realCorpusSeries.push(Math.round(realCorpus));

        tableRows.push([
            `Year ${t}`,
            fmtCurrency(monthlyDeposit),
            fmtCurrency(totalInvested),
            fmtCurrency(grossCorpus),
            fmtCurrency(netCorpus),
            fmtCurrency(realCorpus),
            fmtCurrency(grossCorpus - netCorpus)
        ]);
    }

    const feeDrag = Math.max(0, grossCorpus - netCorpus);
    const stepUpAlpha = Math.max(0, netCorpus - flatNetCorpus);
    const wealthMultiplier = totalInvested > 0 ? (netCorpus / totalInvested) : 1;
    const inflationErosion = netCorpus > 0 ? ((netCorpus - realCorpusSeries[N - 1]) / netCorpus) * 100 : 0;

    // 1. Executive KPI Cards
    renderKPICards([
        {
            title: 'Terminal Nominal Corpus',
            value: fmtCurrency(netCorpus),
            pill: `${wealthMultiplier.toFixed(2)}x Invested Capital`,
            pillType: 'positive',
            border: '#3b82f6'
        },
        {
            title: 'Real Purchasing Power',
            value: fmtCurrency(realCorpusSeries[N - 1]),
            pill: `-${inflationErosion.toFixed(1)}% Inflation Erosion`,
            pillType: 'negative',
            border: '#10b981'
        },
        {
            title: 'Total Principal Invested',
            value: fmtCurrency(totalInvested),
            pill: `${N} Years Horizon`,
            pillType: 'neutral',
            border: '#64748b'
        },
        {
            title: 'Step-Up Alpha (vs Flat SIP)',
            value: `+${fmtCurrency(stepUpAlpha)}`,
            pill: `+${((stepUpAlpha / (flatNetCorpus || 1)) * 100).toFixed(1)}% Compounding Boost`,
            pillType: 'cyan',
            border: '#06b6d4'
        },
        {
            title: 'Fee Drag Erosion Cost',
            value: `-${fmtCurrency(feeDrag)}`,
            pill: `${(f * 100).toFixed(2)}% Annual Drag`,
            pillType: 'negative',
            border: '#f59e0b'
        }
    ]);

    // 2. Dual Charts
    renderDualCharts(
        {
            type: 'line',
            labels: years,
            datasets: [
                {
                    label: 'Net Nominal Wealth',
                    data: netCorpusSeries,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.3
                },
                {
                    label: 'Real Purchasing Power (Inf-Adj)',
                    data: realCorpusSeries,
                    borderColor: '#10b981',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [5, 4],
                    tension: 0.3
                },
                {
                    label: 'Invested Principal',
                    data: investedSeries,
                    borderColor: '#64748b',
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    tension: 0.1
                }
            ]
        },
        {
            labels: ['Invested Principal', 'Base Gains', 'Step-Up Alpha', 'Fee Drag'],
            datasets: [{
                data: [
                    Math.round(totalInvested),
                    Math.max(0, Math.round(flatNetCorpus - flatTotalInvested)),
                    Math.max(0, Math.round(stepUpAlpha)),
                    Math.round(feeDrag)
                ],
                backgroundColor: ['#64748b', '#3b82f6', '#06b6d4', '#ef4444'],
                borderWidth: 1,
                borderColor: '#0a0e1a'
            }]
        },
        'Dynamic Wealth Trajectory (Nominal vs. Real)',
        'Capital Attribution Breakdown'
    );

    // 3. Sensitivity Matrix: Return Rate (+-2%) vs Step-Up Rate (0% to 20%)
    renderSensitivityMatrix({
        rowTitle: 'Expected Return (r)',
        colTitle: 'Annual Step-Up (s)',
        rowValues: [r - 0.02, r - 0.01, r, r + 0.01, r + 0.02],
        colValues: [0.0, 0.05, 0.10, 0.15, 0.20],
        rowLabels: [fmtPct((r - 0.02) * 100, 1), fmtPct((r - 0.01) * 100, 1), `${fmtPct(r * 100, 1)} (Base)`, fmtPct((r + 0.01) * 100, 1), fmtPct((r + 0.02) * 100, 1)],
        colLabels: ['0%', '5%', '10%', '15%', '20%'],
        baseRowIdx: 2,
        baseColIdx: 2,
        calcFn: (r_val, s_val) => {
            let corpus = P0;
            const r_m = Math.max(0, (r_val - f) / 12);
            for (let y = 0; y < N; y++) {
                const dep = M0 * Math.pow(1 + s_val, y);
                for (let m = 0; m < 12; m++) {
                    corpus = (corpus + dep) * (1 + r_m);
                }
            }
            return fmtCurrency(corpus);
        }
    });

    // 4. Data Table
    renderDataTable(
        ['Horizon', 'Monthly Contribution', 'Cumulative Invested', 'Gross Corpus', 'Net Wealth', 'Real Purchasing Power', 'Fee Drag'],
        tableRows
    );
}

// ─── MODEL 2: Endowment & SWP Decumulation Engine ───────────────────

function calculateSWP() {
    const W0 = parseFloat(document.getElementById('calc-swp-corpus')?.value) || 0;
    const W_init = parseFloat(document.getElementById('calc-swp-withdraw')?.value) || 0;
    const inflation = (parseFloat(document.getElementById('calc-swp-inflation')?.value) || 0) / 100;
    const r = (parseFloat(document.getElementById('calc-swp-rate')?.value) || 0) / 100;
    const N = parseInt(document.getElementById('calc-swp-years')?.value, 10) || 1;
    const shock1 = (parseFloat(document.getElementById('calc-swp-shock')?.value) || 0) / 100;

    updateBasisBadge(false);

    let balance = W0;
    let totalWithdrawn = 0;
    let depletionPeriod = null;
    let currentMonthlyWithdrawal = W_init;

    const labels = [];
    const balanceSeries = [];
    const cumulativeWithdrawnSeries = [];
    const tableRows = [];

    for (let y = 0; y < N; y++) {
        const yearAnnualReturn = y === 0 ? (r + shock1) : r;
        const monthlyRate = yearAnnualReturn / 12;
        let yearWithdrawn = 0;

        for (let m = 0; m < 12; m++) {
            if (balance > 0) {
                balance = (balance * (1 + monthlyRate)) - currentMonthlyWithdrawal;
                totalWithdrawn += currentMonthlyWithdrawal;
                yearWithdrawn += currentMonthlyWithdrawal;
                if (balance <= 0) {
                    balance = 0;
                    if (!depletionPeriod) depletionPeriod = `Year ${y + 1}, Month ${m + 1}`;
                }
            }
        }

        const t = y + 1;
        labels.push(`Yr ${t}`);
        balanceSeries.push(Math.round(balance));
        cumulativeWithdrawnSeries.push(Math.round(totalWithdrawn));

        tableRows.push([
            `Year ${t}`,
            fmtCurrency(currentMonthlyWithdrawal),
            fmtCurrency(yearWithdrawn),
            fmtCurrency(totalWithdrawn),
            fmtCurrency(balance),
            y === 0 && shock1 !== 0 ? `${(yearAnnualReturn * 100).toFixed(1)}% (Shock)` : `${(yearAnnualReturn * 100).toFixed(1)}%`
        ]);

        currentMonthlyWithdrawal = currentMonthlyWithdrawal * (1 + inflation);
    }

    const initialSWR = W0 > 0 ? ((W_init * 12) / W0) * 100 : 0;
    const runwayYears = depletionPeriod ? depletionPeriod : 'Perpetual / Sustainable';

    renderKPICards([
        {
            title: 'Terminal Remaining Corpus',
            value: fmtCurrency(balance),
            pill: balance > W0 ? 'Capital Accretive' : (balance > 0 ? 'Solvent' : 'Exhausted'),
            pillType: balance > 0 ? 'positive' : 'negative',
            border: balance > 0 ? '#10b981' : '#ef4444'
        },
        {
            title: 'Total Cumulative Withdrawals',
            value: fmtCurrency(totalWithdrawn),
            pill: `${((totalWithdrawn / (W0 || 1)) * 100).toFixed(1)}% of Initial Capital`,
            pillType: 'cyan',
            border: '#3b82f6'
        },
        {
            title: 'Initial Withdrawal Rate (SWR)',
            value: `${initialSWR.toFixed(2)}%`,
            pill: initialSWR <= 4.0 ? 'Prudent Trinity Baseline' : 'Elevated Drawdown Risk',
            pillType: initialSWR <= 4.0 ? 'positive' : 'negative',
            border: initialSWR <= 4.0 ? '#10b981' : '#f59e0b'
        },
        {
            title: 'Portfolio Runway Status',
            value: runwayYears,
            pill: shock1 !== 0 ? `Stress Shock: ${(shock1 * 100).toFixed(0)}%` : 'Standard Regime',
            pillType: depletionPeriod ? 'negative' : 'positive',
            border: depletionPeriod ? '#ef4444' : '#10b981'
        }
    ]);

    renderDualCharts(
        {
            type: 'line',
            labels,
            datasets: [
                {
                    label: 'Remaining Endowment Corpus',
                    data: balanceSeries,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.2
                },
                {
                    label: 'Cumulative Cash Withdrawn',
                    data: cumulativeWithdrawnSeries,
                    borderColor: '#10b981',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    tension: 0.2
                }
            ]
        },
        {
            labels: ['Ending Corpus', 'Cumulative Withdrawals'],
            datasets: [{
                data: [Math.round(balance), Math.round(totalWithdrawn)],
                backgroundColor: [balance > 0 ? '#3b82f6' : '#ef4444', '#10b981'],
                borderWidth: 1,
                borderColor: '#0a0e1a'
            }]
        },
        'Endowment Decumulation & Cumulative Outflow Trajectory',
        'Terminal Capital Allocation'
    );

    renderSensitivityMatrix({
        rowTitle: 'Portfolio Return (r)',
        colTitle: 'Monthly Withdrawal (W)',
        rowValues: [r - 0.02, r - 0.01, r, r + 0.01, r + 0.02],
        colValues: [W_init * 0.8, W_init * 0.9, W_init, W_init * 1.1, W_init * 1.2],
        rowLabels: [fmtPct((r - 0.02) * 100, 1), fmtPct((r - 0.01) * 100, 1), `${fmtPct(r * 100, 1)} (Base)`, fmtPct((r + 0.01) * 100, 1), fmtPct((r + 0.02) * 100, 1)],
        colLabels: ['-20%', '-10%', 'Base', '+10%', '+20%'],
        baseRowIdx: 2,
        baseColIdx: 2,
        calcFn: (r_val, w_val) => {
            let bal = W0;
            let dep = null;
            let curW = w_val;
            for (let y = 0; y < N; y++) {
                const yrR = y === 0 ? (r_val + shock1) : r_val;
                const mR = yrR / 12;
                for (let m = 0; m < 12; m++) {
                    if (bal > 0) {
                        bal = (bal * (1 + mR)) - curW;
                        if (bal <= 0) { bal = 0; if (!dep) dep = `Yr ${y + 1}`; }
                    }
                }
                curW = curW * (1 + inflation);
            }
            return dep ? `Depleted (${dep})` : fmtCurrency(bal);
        }
    });

    renderDataTable(
        ['Horizon', 'Indexed Monthly Draw', 'Annual Withdrawn', 'Cumulative Outflow', 'Ending Balance', 'Return Regime'],
        tableRows
    );
}

// ─── MODEL 3: Actuarial FIRE & Trinity SWR Simulator ────────────────

function calculateFIRE() {
    const curAge = parseInt(document.getElementById('calc-fire-curAge')?.value, 10) || 30;
    const retAge = parseInt(document.getElementById('calc-fire-retAge')?.value, 10) || 45;
    const lifeAge = parseInt(document.getElementById('calc-fire-lifeAge')?.value, 10) || 90;
    const W0 = parseFloat(document.getElementById('calc-fire-corpus')?.value) || 0;
    const monthlySavings = parseFloat(document.getElementById('calc-fire-monthly')?.value) || 0;
    const savingsStepUp = (parseFloat(document.getElementById('calc-fire-stepup')?.value) || 0) / 100;
    const monthlyExpenses = parseFloat(document.getElementById('calc-fire-expenses')?.value) || 0;
    const preRate = (parseFloat(document.getElementById('calc-fire-preRate')?.value) || 0) / 100;
    const postRate = (parseFloat(document.getElementById('calc-fire-postRate')?.value) || 0) / 100;
    const inflation = (parseFloat(document.getElementById('calc-fire-inflation')?.value) || 0) / 100;
    const swr = (parseFloat(document.getElementById('calc-fire-swr')?.value) || 0) / 100;

    const accumYears = Math.max(1, retAge - curAge);
    const retireYears = Math.max(1, lifeAge - retAge);

    const inflatedAnnualExpensesAtFIRE = (monthlyExpenses * 12) * Math.pow(1 + inflation, accumYears);
    const standardFIRENumber = inflatedAnnualExpensesAtFIRE / swr;
    const leanFIRENumber = standardFIRENumber * 0.75;
    const fatFIRENumber = standardFIRENumber * 1.50;
    const coastFIREToday = standardFIRENumber / Math.pow(1 + preRate, accumYears);

    // Life-cycle simulation
    const ageLabels = [];
    const netWorthSeries = [];
    const tableRows = [];

    let balance = W0;
    let totalInvested = W0;

    // Accumulation Phase
    for (let y = 0; y < accumYears; y++) {
        const age = curAge + y;
        const curMonthly = monthlySavings * Math.pow(1 + savingsStepUp, y);
        const mRate = preRate / 12;

        for (let m = 0; m < 12; m++) {
            totalInvested += curMonthly;
            balance = (balance + curMonthly) * (1 + mRate);
        }

        ageLabels.push(`Age ${age + 1}`);
        netWorthSeries.push(Math.round(balance));

        tableRows.push([
            `Age ${age + 1} (Accumulation)`,
            `+${fmtCurrency(curMonthly * 12)} / yr`,
            fmtCurrency(totalInvested),
            fmtCurrency(balance),
            `${((balance / standardFIRENumber) * 100).toFixed(1)}%`
        ]);
    }

    const corpusAtRetirement = balance;
    let curWithdrawalAnnual = inflatedAnnualExpensesAtFIRE;

    // Decumulation Phase
    for (let y = 0; y < retireYears; y++) {
        const age = retAge + y;
        const mRate = postRate / 12;
        const curMonthlyDraw = curWithdrawalAnnual / 12;

        for (let m = 0; m < 12; m++) {
            if (balance > 0) {
                balance = (balance * (1 + mRate)) - curMonthlyDraw;
                if (balance < 0) balance = 0;
            }
        }

        ageLabels.push(`Age ${age + 1}`);
        netWorthSeries.push(Math.round(balance));

        tableRows.push([
            `Age ${age + 1} (Decumulation)`,
            `-${fmtCurrency(curWithdrawalAnnual)} / yr`,
            '--',
            fmtCurrency(balance),
            balance > 0 ? 'Solvent' : 'Depleted'
        ]);

        curWithdrawalAnnual = curWithdrawalAnnual * (1 + inflation);
    }

    // 250-Path Box-Muller Monte Carlo Simulation
    let successCount = 0;
    const numPaths = 250;
    for (let p = 0; p < numPaths; p++) {
        let simBal = W0;
        // Accumulation
        for (let y = 0; y < accumYears; y++) {
            const curMonthly = monthlySavings * Math.pow(1 + savingsStepUp, y);
            const u1 = Math.random() || 1e-6;
            const u2 = Math.random() || 1e-6;
            const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
            const pathR = (preRate - 0.5 * 0.15 * 0.15) + (0.15 * z);
            const mRate = pathR / 12;
            for (let m = 0; m < 12; m++) {
                simBal = (simBal + curMonthly) * (1 + mRate);
            }
        }

        let pathDraw = inflatedAnnualExpensesAtFIRE;
        // Decumulation
        let ruined = false;
        for (let y = 0; y < retireYears; y++) {
            const u1 = Math.random() || 1e-6;
            const u2 = Math.random() || 1e-6;
            const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
            const pathR = (postRate - 0.5 * 0.10 * 0.10) + (0.10 * z);
            const mRate = pathR / 12;
            const curM = pathDraw / 12;
            for (let m = 0; m < 12; m++) {
                if (simBal > 0) {
                    simBal = (simBal * (1 + mRate)) - curM;
                    if (simBal <= 0) { simBal = 0; ruined = true; break; }
                }
            }
            if (ruined) break;
            pathDraw = pathDraw * (1 + inflation);
        }
        if (!ruined && simBal > 0) successCount++;
    }

    const mcSuccessRate = (successCount / numPaths) * 100;
    const fireProgress = (corpusAtRetirement / standardFIRENumber) * 100;

    renderKPICards([
        {
            title: 'Required Standard FIRE Target',
            value: fmtCurrency(standardFIRENumber),
            pill: `${(swr * 100).toFixed(2)}% Safe Withdrawal Rate`,
            pillType: 'cyan',
            border: '#3b82f6'
        },
        {
            title: 'Projected Corpus at Retirement',
            value: fmtCurrency(corpusAtRetirement),
            pill: `${fireProgress.toFixed(1)}% of Target Funded`,
            pillType: fireProgress >= 100 ? 'positive' : 'negative',
            border: fireProgress >= 100 ? '#10b981' : '#f59e0b'
        },
        {
            title: 'Coast FIRE Threshold Today',
            value: fmtCurrency(coastFIREToday),
            pill: W0 >= coastFIREToday ? 'Coast FIRE Achieved!' : 'Accumulating Base',
            pillType: W0 >= coastFIREToday ? 'positive' : 'neutral',
            border: '#06b6d4'
        },
        {
            title: 'Monte Carlo Survival Probability',
            value: `${mcSuccessRate.toFixed(1)}%`,
            pill: `${numPaths} Stochastic Life-Cycle Paths`,
            pillType: mcSuccessRate >= 85 ? 'positive' : (mcSuccessRate >= 70 ? 'neutral' : 'negative'),
            border: mcSuccessRate >= 85 ? '#10b981' : '#ef4444'
        }
    ]);

    renderDualCharts(
        {
            type: 'line',
            labels: ageLabels,
            datasets: [{
                label: 'Life-Cycle Net Worth Corpus',
                data: netWorthSeries,
                borderColor: '#06b6d4',
                backgroundColor: 'rgba(6, 182, 212, 0.08)',
                borderWidth: 2.5,
                fill: true,
                tension: 0.35,
                pointRadius: ageLabels.map((_, i) => i === accumYears - 1 ? 6 : 0),
                pointBackgroundColor: '#f59e0b',
                pointBorderColor: '#ffffff'
            }]
        },
        {
            labels: ['Lean FIRE (75%)', 'Standard FIRE', 'Fat FIRE (150%)'],
            datasets: [{
                data: [Math.round(leanFIRENumber), Math.round(standardFIRENumber), Math.round(fatFIRENumber)],
                backgroundColor: ['#10b981', '#3b82f6', '#8b5cf6'],
                borderWidth: 1,
                borderColor: '#0a0e1a'
            }]
        },
        'Actuarial Life-Cycle Net Worth (Accumulation to Decumulation)',
        'FIRE Tier Comparison Matrix'
    );

    renderSensitivityMatrix({
        rowTitle: 'Safe Withdrawal Rate',
        colTitle: 'Target Retirement Age',
        rowValues: [0.03, 0.035, 0.0375, 0.0425, 0.05],
        colValues: [retAge - 4, retAge - 2, retAge, retAge + 2, retAge + 4],
        rowLabels: ['3.0%', '3.5%', '3.75%', '4.25%', '5.0%'],
        colLabels: [`Age ${retAge - 4}`, `Age ${retAge - 2}`, `Age ${retAge}`, `Age ${retAge + 2}`, `Age ${retAge + 4}`],
        baseRowIdx: 2,
        baseColIdx: 2,
        calcFn: (swr_val, age_val) => {
            const accY = Math.max(1, age_val - curAge);
            const exp = (monthlyExpenses * 12) * Math.pow(1 + inflation, accY);
            return fmtCurrency(exp / swr_val);
        }
    });

    renderDataTable(
        ['Life Stage', 'Annual Flow', 'Invested Capital', 'Projected Corpus', 'Target Status'],
        tableRows
    );
}

// ─── MODEL 4: Debt Amortization & Prepayment Optimizer ─────────────

function calculateEMI() {
    const P = parseFloat(document.getElementById('calc-emi-principal')?.value) || 0;
    const annualRate = parseFloat(document.getElementById('calc-emi-rate')?.value) || 0;
    const years = parseInt(document.getElementById('calc-emi-years')?.value, 10) || 1;
    const extraMonthly = parseFloat(document.getElementById('calc-emi-extra')?.value) || 0;
    const extraAnnual = parseFloat(document.getElementById('calc-emi-annual')?.value) || 0;

    const totalMonths = years * 12;
    const r = (annualRate / 100) / 12;

    const baseEMI = r > 0
        ? (P * r * Math.pow(1 + r, totalMonths)) / (Math.pow(1 + r, totalMonths) - 1)
        : P / totalMonths;

    let baseBalance = P;
    let baseTotalInterest = 0;

    let accelBalance = P;
    let accelTotalInterest = 0;
    let accelPayoffMonths = 0;

    const labels = [];
    const baseBalanceSeries = [];
    const accelBalanceSeries = [];
    const tableRows = [];

    for (let m = 1; m <= totalMonths; m++) {
        // Base schedule
        if (baseBalance > 0) {
            const intBase = baseBalance * r;
            const princBase = Math.min(baseBalance, baseEMI - intBase);
            baseTotalInterest += intBase;
            baseBalance -= princBase;
        }

        // Accelerated schedule
        if (accelBalance > 0) {
            const intAccel = accelBalance * r;
            const lumpsumThisMonth = (m % 12 === 0) ? extraAnnual : 0;
            const totalPayment = baseEMI + extraMonthly + lumpsumThisMonth;
            const princAccel = Math.min(accelBalance, totalPayment - intAccel);
            accelTotalInterest += intAccel;
            accelBalance -= princAccel;

            if (accelBalance <= 0 && accelPayoffMonths === 0) {
                accelPayoffMonths = m;
            }
        }

        if (m % 12 === 0 || m === totalMonths) {
            const yr = m / 12;
            labels.push(`Yr ${yr}`);
            baseBalanceSeries.push(Math.round(Math.max(0, baseBalance)));
            accelBalanceSeries.push(Math.round(Math.max(0, accelBalance)));

            tableRows.push([
                `Year ${yr}`,
                fmtCurrency(baseBalance),
                fmtCurrency(accelBalance),
                fmtCurrency(baseTotalInterest),
                fmtCurrency(accelTotalInterest),
                fmtCurrency(Math.max(0, baseTotalInterest - accelTotalInterest))
            ]);
        }
    }

    if (accelPayoffMonths === 0) accelPayoffMonths = totalMonths;
    const interestSaved = Math.max(0, baseTotalInterest - accelTotalInterest);
    const monthsSaved = Math.max(0, totalMonths - accelPayoffMonths);
    const yearsSaved = (monthsSaved / 12).toFixed(1);

    renderKPICards([
        {
            title: 'Base Monthly EMI',
            value: fmtCurrency(baseEMI),
            pill: `Standard ${years}Y Amortization`,
            pillType: 'neutral',
            border: '#64748b'
        },
        {
            title: 'Total Interest Saved via Alpha',
            value: fmtCurrency(interestSaved),
            pill: `-${((interestSaved / (baseTotalInterest || 1)) * 100).toFixed(1)}% Interest Reduction`,
            pillType: 'positive',
            border: '#10b981'
        },
        {
            title: 'Tenure Reduction Alpha',
            value: `${yearsSaved} Years Saved`,
            pill: `${monthsSaved} Months Early Payoff`,
            pillType: 'cyan',
            border: '#06b6d4'
        },
        {
            title: 'Accelerated Total Interest Paid',
            value: fmtCurrency(accelTotalInterest),
            pill: `vs ${fmtCurrency(baseTotalInterest)} Baseline`,
            pillType: 'neutral',
            border: '#3b82f6'
        }
    ]);

    renderDualCharts(
        {
            type: 'line',
            labels,
            datasets: [
                {
                    label: 'Baseline Principal Balance',
                    data: baseBalanceSeries,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.05)',
                    borderWidth: 2,
                    tension: 0.1
                },
                {
                    label: 'Accelerated Prepayment Balance',
                    data: accelBalanceSeries,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.12)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.1
                }
            ]
        },
        {
            labels: ['Principal Loan', 'Accelerated Interest', 'Interest Saved'],
            datasets: [{
                data: [Math.round(P), Math.round(accelTotalInterest), Math.round(interestSaved)],
                backgroundColor: ['#3b82f6', '#f59e0b', '#10b981'],
                borderWidth: 1,
                borderColor: '#0a0e1a'
            }]
        },
        'Remaining Principal Loan Balance Trajectory (Baseline vs Accelerated)',
        'Total Cost of Debt & Savings Attribution'
    );

    renderSensitivityMatrix({
        rowTitle: 'Annual Interest Rate (r)',
        colTitle: 'Monthly Extra Prepayment',
        rowValues: [annualRate - 1.0, annualRate - 0.5, annualRate, annualRate + 0.5, annualRate + 1.0],
        colValues: [0, extraMonthly * 0.5, extraMonthly, extraMonthly * 1.5, extraMonthly * 2.0],
        rowLabels: [`${(annualRate - 1.0).toFixed(2)}%`, `${(annualRate - 0.5).toFixed(2)}%`, `${annualRate.toFixed(2)}% (Base)`, `${(annualRate + 0.5).toFixed(2)}%`, `${(annualRate + 1.0).toFixed(2)}%`],
        colLabels: ['0', `${fmtCurrency(extraMonthly * 0.5)}`, `${fmtCurrency(extraMonthly)}`, `${fmtCurrency(extraMonthly * 1.5)}`, `${fmtCurrency(extraMonthly * 2.0)}`],
        baseRowIdx: 2,
        baseColIdx: 2,
        calcFn: (r_val, extra_val) => {
            const mR = (r_val / 100) / 12;
            const emi = (P * mR * Math.pow(1 + mR, totalMonths)) / (Math.pow(1 + mR, totalMonths) - 1);
            let bal = P;
            let mCount = 0;
            while (bal > 0 && mCount < totalMonths) {
                mCount++;
                const int = bal * mR;
                const lump = (mCount % 12 === 0) ? extraAnnual : 0;
                const pPaid = Math.min(bal, emi + extra_val + lump - int);
                bal -= pPaid;
            }
            const yReduced = ((totalMonths - mCount) / 12).toFixed(1);
            return `${yReduced}Y Saved`;
        }
    });

    renderDataTable(
        ['Horizon', 'Baseline Balance', 'Accelerated Balance', 'Baseline Interest', 'Accelerated Interest', 'Cumulative Savings'],
        tableRows
    );
}

// ─── MODEL 5: WACC & 2-Stage DCF Valuation Desk ─────────────────────

function calculateDCF() {
    const FCF0 = parseFloat(document.getElementById('calc-dcf-fcf')?.value) || 0;
    const baseGrowth = (parseFloat(document.getElementById('calc-dcf-growth')?.value) || 0) / 100;
    const stepDown = (parseFloat(document.getElementById('calc-dcf-stepup')?.value) || 0) / 100;
    const wacc = (parseFloat(document.getElementById('calc-dcf-wacc')?.value) || 0) / 100;
    const gT = (parseFloat(document.getElementById('calc-dcf-terminal')?.value) || 0) / 100;
    const shares = parseFloat(document.getElementById('calc-dcf-shares')?.value) || 1;
    const netDebt = parseFloat(document.getElementById('calc-dcf-debt')?.value) || 0;
    const marketPrice = parseFloat(document.getElementById('calc-dcf-price')?.value) || 1;

    if (wacc <= gT) return;

    let runningFCF = FCF0;
    let pv5Y = 0;
    const years = [];
    const projectedFCFSeries = [];
    const pvFCFSeries = [];
    const tableRows = [];

    for (let t = 1; t <= 5; t++) {
        const yearGrowth = baseGrowth + (t - 1) * stepDown;
        runningFCF = runningFCF * (1 + yearGrowth);
        const discountFactor = 1 / Math.pow(1 + wacc, t);
        const pv = runningFCF * discountFactor;
        pv5Y += pv;

        years.push(`Yr ${t}`);
        projectedFCFSeries.push(Math.round(runningFCF));
        pvFCFSeries.push(Math.round(pv));

        tableRows.push([
            `Year ${t}`,
            `${fmtCurrency(runningFCF)}M`,
            fmtPct(yearGrowth * 100),
            discountFactor.toFixed(4),
            `${fmtCurrency(pv)}M`
        ]);
    }

    const TV5 = (runningFCF * (1 + gT)) / (wacc - gT);
    const pvTV = TV5 / Math.pow(1 + wacc, 5);
    const enterpriseValue = pv5Y + pvTV;
    const equityValue = enterpriseValue - netDebt;
    const fairValuePerShare = equityValue / shares;
    const impliedUpside = ((fairValuePerShare - marketPrice) / marketPrice) * 100;
    const tvPctOfEV = (pvTV / enterpriseValue) * 100;

    renderKPICards([
        {
            title: 'Intrinsic Fair Value / Share',
            value: fmtCurrency(fairValuePerShare, 2),
            pill: fmtPct(impliedUpside),
            pillType: impliedUpside >= 0 ? 'positive' : 'negative',
            border: impliedUpside >= 0 ? '#10b981' : '#ef4444'
        },
        {
            title: 'Enterprise Value (EV)',
            value: `${fmtCurrency(enterpriseValue)}M`,
            pill: `Net Debt: ${fmtCurrency(netDebt)}M`,
            pillType: 'neutral',
            border: '#3b82f6'
        },
        {
            title: 'Implied Equity Value',
            value: `${fmtCurrency(equityValue)}M`,
            pill: `${shares}M Diluted Shares`,
            pillType: 'cyan',
            border: '#06b6d4'
        },
        {
            title: 'PV of Terminal Value',
            value: `${fmtCurrency(pvTV)}M`,
            pill: `${tvPctOfEV.toFixed(1)}% of Total Enterprise Value`,
            pillType: tvPctOfEV <= 75 ? 'positive' : 'negative',
            border: '#f59e0b'
        }
    ]);

    renderDualCharts(
        {
            type: 'bar',
            labels: years,
            datasets: [
                {
                    label: 'Nominal Projected FCFF ($M)',
                    data: projectedFCFSeries,
                    backgroundColor: 'rgba(59, 130, 246, 0.75)',
                    borderRadius: 4
                },
                {
                    label: 'Discounted Present Value ($M)',
                    data: pvFCFSeries,
                    backgroundColor: 'rgba(16, 185, 129, 0.85)',
                    borderRadius: 4
                }
            ]
        },
        {
            labels: ['PV of 5-Yr FCFF', 'PV of Terminal Value'],
            datasets: [{
                data: [Math.round(pv5Y), Math.round(pvTV)],
                backgroundColor: ['#3b82f6', '#06b6d4'],
                borderWidth: 1,
                borderColor: '#0a0e1a'
            }]
        },
        'Stage-1 Free Cash Flow Projection vs Present Value Bridge',
        'Enterprise Value Composition (Stage 1 vs Terminal Value)'
    );

    renderSensitivityMatrix({
        rowTitle: 'WACC Discount Rate',
        colTitle: 'Terminal Growth (g)',
        rowValues: [wacc - 0.01, wacc - 0.005, wacc, wacc + 0.005, wacc + 0.01],
        colValues: [gT - 0.01, gT - 0.005, gT, gT + 0.005, gT + 0.01],
        rowLabels: [fmtPct((wacc - 0.01) * 100, 2), fmtPct((wacc - 0.005) * 100, 2), `${fmtPct(wacc * 100, 2)} (Base)`, fmtPct((wacc + 0.005) * 100, 2), fmtPct((wacc + 0.01) * 100, 2)],
        colLabels: [fmtPct((gT - 0.01) * 100, 2), fmtPct((gT - 0.005) * 100, 2), `${fmtPct(gT * 100, 2)} (Base)`, fmtPct((gT + 0.005) * 100, 2), fmtPct((gT + 0.01) * 100, 2)],
        baseRowIdx: 2,
        baseColIdx: 2,
        calcFn: (w_val, g_val) => {
            if (w_val <= g_val) return 'N/A';
            let cur = FCF0;
            let pv = 0;
            for (let t = 1; t <= 5; t++) {
                cur = cur * (1 + (baseGrowth + (t - 1) * stepDown));
                pv += cur / Math.pow(1 + w_val, t);
            }
            const tv = (cur * (1 + g_val)) / (w_val - g_val);
            const pv_tv = tv / Math.pow(1 + w_val, 5);
            const eq = (pv + pv_tv) - netDebt;
            return fmtCurrency(eq / shares, 2);
        }
    });

    renderDataTable(
        ['Horizon', 'Projected FCFF', 'Growth Rate', 'Discount Factor (WACC)', 'Present Value'],
        tableRows
    );
}

// ─── MODEL 6: Fixed Income Bond, Duration & Convexity Engine ────────

function calculateBond() {
    const F = parseFloat(document.getElementById('calc-bond-par')?.value) || 1000;
    const c = (parseFloat(document.getElementById('calc-bond-coupon')?.value) || 0) / 100;
    const y = (parseFloat(document.getElementById('calc-bond-yield')?.value) || 0) / 100;
    const T = parseFloat(document.getElementById('calc-bond-maturity')?.value) || 10;
    const m = parseInt(document.getElementById('calc-bond-freq')?.value, 10) || 2;

    const n = Math.round(T * m);
    const C = (F * c) / m;
    const ym = y / m;

    let bondPrice = 0;
    let macDurationSum = 0;
    let convexitySum = 0;
    const tableRows = [];

    for (let t = 1; t <= n; t++) {
        const isMaturity = t === n;
        const cf = isMaturity ? (C + F) : C;
        const discountFactor = 1 / Math.pow(1 + ym, t);
        const pv = cf * discountFactor;

        bondPrice += pv;
        macDurationSum += (t / m) * pv;
        convexitySum += (t * (t + 1) * cf) / Math.pow(1 + ym, t);

        if (t <= 5 || isMaturity || t % m === 0) {
            tableRows.push([
                `Period ${t} (Yr ${(t / m).toFixed(1)})`,
                fmtCurrency(cf),
                discountFactor.toFixed(4),
                fmtCurrency(pv),
                `${((pv / (bondPrice || 1)) * 100).toFixed(2)}%`
            ]);
        }
    }

    const currentYield = (F * c) / bondPrice * 100;
    const macDuration = bondPrice > 0 ? (macDurationSum / bondPrice) : 0;
    const modDuration = macDuration / (1 + ym);
    const dv01 = (bondPrice * modDuration * 0.0001) * (10000 / F);
    const convexity = (1 / (bondPrice * Math.pow(1 + ym, 2) * Math.pow(m, 2))) * convexitySum;

    renderKPICards([
        {
            title: 'Clean Bond Settlement Price',
            value: fmtCurrency(bondPrice, 2),
            pill: bondPrice > F ? 'Trading at Premium' : (bondPrice < F ? 'Trading at Discount' : 'Trading at Par'),
            pillType: bondPrice >= F ? 'positive' : 'negative',
            border: '#3b82f6'
        },
        {
            title: 'Modified Duration',
            value: `${modDuration.toFixed(2)} Yrs`,
            pill: `Macaulay Duration: ${macDuration.toFixed(2)} Yrs`,
            pillType: 'neutral',
            border: '#64748b'
        },
        {
            title: 'Dollar Duration (DV01 / $10k)',
            value: fmtCurrency(dv01, 2),
            pill: 'Price Risk per 1 bp Yield Shift',
            pillType: 'cyan',
            border: '#06b6d4'
        },
        {
            title: 'Convexity Measure',
            value: convexity.toFixed(2),
            pill: `Current Yield: ${currentYield.toFixed(2)}%`,
            pillType: 'positive',
            border: '#10b981'
        }
    ]);

    // Price-Yield Convexity Curve Chart
    const yieldGrid = [];
    const curvePrices = [];
    const tangentPrices = [];
    const minYield = Math.max(0.005, y - 0.04);
    const maxYield = y + 0.04;
    const step = (maxYield - minYield) / 10;

    for (let simY = minYield; simY <= maxYield; simY += step) {
        yieldGrid.push(`${(simY * 100).toFixed(1)}%`);
        const simYM = simY / m;
        let simP = 0;
        for (let t = 1; t <= n; t++) {
            const cf = t === n ? (C + F) : C;
            simP += cf / Math.pow(1 + simYM, t);
        }
        curvePrices.push(Math.round(simP));

        // Linear tangent approximation: P * (1 - D_mod * delta_y)
        const dY = simY - y;
        const tangP = bondPrice * (1 - modDuration * dY);
        tangentPrices.push(Math.round(tangP));
    }

    renderDualCharts(
        {
            type: 'line',
            labels: yieldGrid,
            datasets: [
                {
                    label: 'Exact Price-Yield Convexity Curve',
                    data: curvePrices,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.3
                },
                {
                    label: 'Linear Duration Tangent Approximation',
                    data: tangentPrices,
                    borderColor: '#ef4444',
                    borderDash: [5, 4],
                    borderWidth: 1.5,
                    tension: 0
                }
            ]
        },
        {
            labels: ['PV of Coupon Stream', 'PV of Par Redemption'],
            datasets: [{
                data: [Math.round(bondPrice - (F / Math.pow(1 + ym, n))), Math.round(F / Math.pow(1 + ym, n))],
                backgroundColor: ['#3b82f6', '#10b981'],
                borderWidth: 1,
                borderColor: '#0a0e1a'
            }]
        },
        'Price-Yield Convexity Profile vs Linear Duration Tangent',
        'Present Value Decomposition'
    );

    renderSensitivityMatrix({
        rowTitle: 'Yield Shock (Δy)',
        colTitle: 'Maturity (T)',
        rowValues: [-0.02, -0.01, 0.0, 0.01, 0.02],
        colValues: [Math.max(1, T - 4), Math.max(2, T - 2), T, T + 2, T + 4],
        rowLabels: ['-200 bps', '-100 bps', '0 bps (Base)', '+100 bps', '+200 bps'],
        colLabels: [`${Math.max(1, T - 4)}Y`, `${Math.max(2, T - 2)}Y`, `${T}Y`, `${T + 2}Y`, `${T + 4}Y`],
        baseRowIdx: 2,
        baseColIdx: 2,
        calcFn: (dy_val, t_val) => {
            const simN = Math.round(t_val * m);
            const simYM = (y + dy_val) / m;
            let p = 0;
            for (let i = 1; i <= simN; i++) {
                const cf = i === simN ? (C + F) : C;
                p += cf / Math.pow(1 + simYM, i);
            }
            const pctChg = ((p - bondPrice) / bondPrice) * 100;
            return `${fmtCurrency(p, 0)} (${fmtPct(pctChg, 1)})`;
        }
    });

    renderDataTable(
        ['Cash Flow Event', 'Nominal Cash Flow', 'Discount Factor', 'Discounted Present Value', '% of Total Bond Value'],
        tableRows
    );
}

// ─── MODEL 7: Blackstone Private Equity LBO IRR & MOIC Modeler ──────

function calculateLBO() {
    const ebitda0 = parseFloat(document.getElementById('calc-lbo-ebitda')?.value) || 100;
    const entryMult = parseFloat(document.getElementById('calc-lbo-entryMult')?.value) || 10.5;
    const lev = parseFloat(document.getElementById('calc-lbo-lev')?.value) || 5.0;
    const intRate = (parseFloat(document.getElementById('calc-lbo-intRate')?.value) || 7.5) / 100;
    const ebitdaGrowth = (parseFloat(document.getElementById('calc-lbo-ebitdaGrowth')?.value) || 10.0) / 100;
    const fcfConv = (parseFloat(document.getElementById('calc-lbo-fcfConv')?.value) || 65) / 100;
    const hold = parseInt(document.getElementById('calc-lbo-hold')?.value, 10) || 5;
    const exitMult = parseFloat(document.getElementById('calc-lbo-exitMult')?.value) || 10.5;

    const entryEV = ebitda0 * entryMult;
    const initialDebt = ebitda0 * lev;
    const entryEquity = entryEV - initialDebt;

    let debt = initialDebt;
    let excessCash = 0;
    let runningEbitda = ebitda0;

    const years = ['Entry'];
    const debtSeries = [Math.round(initialDebt)];
    const equitySeries = [Math.round(entryEquity)];
    const tableRows = [
        ['Year 0 (Entry)', fmtCurrency(ebitda0), fmtCurrency(entryEV), fmtCurrency(initialDebt), fmtCurrency(entryEquity), 'Initial Buyout Structure']
    ];

    for (let t = 1; t <= hold; t++) {
        runningEbitda = runningEbitda * (1 + ebitdaGrowth);
        const interest = debt * intRate;
        const preInterestFCF = runningEbitda * fcfConv;
        const netFCF = Math.max(0, preInterestFCF - interest);

        const principalPaydown = Math.min(debt, netFCF);
        debt = Math.max(0, debt - principalPaydown);
        excessCash += (netFCF - principalPaydown);

        const currentEV = runningEbitda * exitMult;
        const currentEquity = currentEV - debt + excessCash;

        years.push(`Yr ${t}`);
        debtSeries.push(Math.round(debt));
        equitySeries.push(Math.round(currentEquity));

        tableRows.push([
            `Year ${t}`,
            fmtCurrency(runningEbitda),
            fmtCurrency(currentEV),
            fmtCurrency(debt),
            fmtCurrency(currentEquity),
            `Paydown: ${fmtCurrency(principalPaydown)}`
        ]);
    }

    const exitEV = runningEbitda * exitMult;
    const exitEquity = exitEV - debt + excessCash;
    const moic = entryEquity > 0 ? (exitEquity / entryEquity) : 0;
    const irr = moic > 0 ? (Math.pow(moic, 1 / hold) - 1) * 100 : 0;
    const totalDebtPaid = initialDebt - debt;

    // Value Creation Attribution Bridge
    const ebitdaGrowthGain = (runningEbitda - ebitda0) * entryMult;
    const multExpansionGain = runningEbitda * (exitMult - entryMult);
    const deleveragingGain = totalDebtPaid + excessCash;

    renderKPICards([
        {
            title: 'Sponsor Realized IRR',
            value: fmtPct(irr),
            pill: `${hold}-Year Holding Period`,
            pillType: irr >= 20 ? 'positive' : (irr >= 15 ? 'neutral' : 'negative'),
            border: irr >= 20 ? '#10b981' : '#3b82f6'
        },
        {
            title: 'Cash-on-Cash MOIC',
            value: `${moic.toFixed(2)}x`,
            pill: `${fmtCurrency(exitEquity)}M Exit Equity`,
            pillType: moic >= 2.5 ? 'positive' : 'neutral',
            border: '#06b6d4'
        },
        {
            title: 'Cumulative Debt De-leveraged',
            value: `${fmtCurrency(totalDebtPaid)}M`,
            pill: `${((totalDebtPaid / (initialDebt || 1)) * 100).toFixed(1)}% Debt Reduction`,
            pillType: 'positive',
            border: '#10b981'
        },
        {
            title: 'Exit Enterprise Value',
            value: `${fmtCurrency(exitEV)}M`,
            pill: `${exitMult.toFixed(1)}x Exit Multiple`,
            pillType: 'cyan',
            border: '#3b82f6'
        }
    ]);

    renderDualCharts(
        {
            type: 'bar',
            labels: years,
            datasets: [
                {
                    label: 'Remaining Debt Facility ($M)',
                    data: debtSeries,
                    backgroundColor: 'rgba(239, 68, 68, 0.75)',
                    borderRadius: 4
                },
                {
                    label: 'Sponsor Implied Equity Value ($M)',
                    data: equitySeries,
                    backgroundColor: 'rgba(16, 185, 129, 0.85)',
                    borderRadius: 4
                }
            ]
        },
        {
            labels: ['EBITDA Growth', 'De-leveraging', 'Multiple Expansion'],
            datasets: [{
                data: [
                    Math.max(0, Math.round(ebitdaGrowthGain)),
                    Math.max(0, Math.round(deleveragingGain)),
                    Math.max(0, Math.round(multExpansionGain))
                ],
                backgroundColor: ['#3b82f6', '#10b981', '#f59e0b'],
                borderWidth: 1,
                borderColor: '#0a0e1a'
            }]
        },
        'LBO Capital Structure Evolution: Debt Paydown vs Equity Value Bridge',
        'Equity Value Creation Attribution Bridge'
    );

    renderSensitivityMatrix({
        rowTitle: 'Exit EV/EBITDA Multiple',
        colTitle: 'Annual EBITDA Growth',
        rowValues: [exitMult - 2.0, exitMult - 1.0, exitMult, exitMult + 1.0, exitMult + 2.0],
        colValues: [ebitdaGrowth - 0.04, ebitdaGrowth - 0.02, ebitdaGrowth, ebitdaGrowth + 0.02, ebitdaGrowth + 0.04],
        rowLabels: [`${(exitMult - 2.0).toFixed(1)}x`, `${(exitMult - 1.0).toFixed(1)}x`, `${exitMult.toFixed(1)}x (Base)`, `${(exitMult + 1.0).toFixed(1)}x`, `${(exitMult + 2.0).toFixed(1)}x`],
        colLabels: [fmtPct((ebitdaGrowth - 0.04) * 100, 1), fmtPct((ebitdaGrowth - 0.02) * 100, 1), `${fmtPct(ebitdaGrowth * 100, 1)} (Base)`, fmtPct((ebitdaGrowth + 0.02) * 100, 1), fmtPct((ebitdaGrowth + 0.04) * 100, 1)],
        baseRowIdx: 2,
        baseColIdx: 2,
        calcFn: (exit_m, g_val) => {
            let e = ebitda0;
            let d = initialDebt;
            let cash = 0;
            for (let t = 1; t <= hold; t++) {
                e = e * (1 + g_val);
                const interest = d * intRate;
                const netFCF = Math.max(0, (e * fcfConv) - interest);
                const pay = Math.min(d, netFCF);
                d -= pay;
                cash += (netFCF - pay);
            }
            const exEq = (e * exit_m) - d + cash;
            const m_val = entryEquity > 0 ? (exEq / entryEquity) : 0;
            const irr_val = m_val > 0 ? (Math.pow(m_val, 1 / hold) - 1) * 100 : 0;
            return `${irr_val.toFixed(1)}% (${m_val.toFixed(2)}x)`;
        }
    });

    renderDataTable(
        ['LBO Milestone', 'EBITDA', 'Enterprise Value', 'Senior Debt', 'Sponsor Equity', 'Period Transaction Notes'],
        tableRows
    );
}

// ─── MODEL 8: Black-Scholes-Merton & Fractional Kelly Sizer ─────────

function normalCDF(x) {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x) / Math.SQRT2;
    const t = 1.0 / (1.0 + p * absX);
    const erf = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

    return 0.5 * (1.0 + sign * erf);
}

function normalPDF(x) {
    return (1.0 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
}

function calculateOptions() {
    const S = parseFloat(document.getElementById('calc-options-spot')?.value) || 100;
    const K = parseFloat(document.getElementById('calc-options-strike')?.value) || 100;
    const D = parseFloat(document.getElementById('calc-options-dte')?.value) || 45;
    const sigma = (parseFloat(document.getElementById('calc-options-iv')?.value) || 25) / 100;
    const r = (parseFloat(document.getElementById('calc-options-rate')?.value) || 4.5) / 100;
    const q = (parseFloat(document.getElementById('calc-options-div')?.value) || 0) / 100;
    const type = document.getElementById('calc-options-type')?.value || 'call';
    const winProb = (parseFloat(document.getElementById('calc-options-winProb')?.value) || 55) / 100;
    const winLoss = parseFloat(document.getElementById('calc-options-winLoss')?.value) || 1.5;

    const T = Math.max(0.001, D / 365);
    const sqrtT = Math.sqrt(T);

    const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;

    const nd1 = normalCDF(d1);
    const nd2 = normalCDF(d2);
    const n_minus_d1 = normalCDF(-d1);
    const n_minus_d2 = normalCDF(-d2);
    const pdf_d1 = normalPDF(d1);

    const callPrice = S * Math.exp(-q * T) * nd1 - K * Math.exp(-r * T) * nd2;
    const putPrice = K * Math.exp(-r * T) * n_minus_d2 - S * Math.exp(-q * T) * n_minus_d1;

    const optionPrice = type === 'call' ? callPrice : putPrice;
    const intrinsicValue = type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
    const timeValue = Math.max(0, optionPrice - intrinsicValue);
    const breakeven = type === 'call' ? (K + optionPrice) : (K - optionPrice);

    // Greeks
    const delta = type === 'call' ? Math.exp(-q * T) * nd1 : -Math.exp(-q * T) * n_minus_d1;
    const gamma = (Math.exp(-q * T) * pdf_d1) / (S * sigma * sqrtT);
    const thetaAnnual = type === 'call'
        ? (- (S * Math.exp(-q * T) * pdf_d1 * sigma) / (2 * sqrtT) + q * S * Math.exp(-q * T) * nd1 - r * K * Math.exp(-r * T) * nd2)
        : (- (S * Math.exp(-q * T) * pdf_d1 * sigma) / (2 * sqrtT) - q * S * Math.exp(-q * T) * n_minus_d1 + r * K * Math.exp(-r * T) * n_minus_d2);
    const thetaDaily = thetaAnnual / 365;
    const vega = 0.01 * S * Math.exp(-q * T) * sqrtT * pdf_d1;
    const rho = type === 'call'
        ? 0.01 * K * T * Math.exp(-r * T) * nd2
        : -0.01 * K * T * Math.exp(-r * T) * n_minus_d2;

    // Fractional Kelly Criterion
    const fullKelly = winProb - ((1 - winProb) / winLoss);
    const halfKelly = Math.max(0, fullKelly * 0.5);

    renderKPICards([
        {
            title: `Theoretical ${type.toUpperCase()} Fair Price`,
            value: fmtCurrency(optionPrice, 2),
            pill: `Breakeven: ${fmtCurrency(breakeven, 2)}`,
            pillType: 'cyan',
            border: '#06b6d4'
        },
        {
            title: 'Delta (Δ) & Gamma (Γ)',
            value: `${delta.toFixed(3)} Δ`,
            pill: `Gamma: ${gamma.toFixed(4)}`,
            pillType: 'neutral',
            border: '#3b82f6'
        },
        {
            title: 'Daily Theta Decay (Θ)',
            value: `${fmtCurrency(thetaDaily, 3)} / day`,
            pill: `Vega (𝓥): ${fmtCurrency(vega, 2)} per 1% IV`,
            pillType: 'negative',
            border: '#f59e0b'
        },
        {
            title: 'Half-Kelly Optimal Capital Sizing',
            value: `${(halfKelly * 100).toFixed(1)}% Allocation`,
            pill: fullKelly > 0 ? `Full Kelly: ${(fullKelly * 100).toFixed(1)}%` : 'Negative Edge (Do Not Trade)',
            pillType: fullKelly > 0 ? 'positive' : 'negative',
            border: fullKelly > 0 ? '#10b981' : '#ef4444'
        }
    ]);

    // Payoff at Expiration vs Black-Scholes Curve today
    const spotGrid = [];
    const bsPrices = [];
    const payoffAtExpiry = [];
    const minSpot = S * 0.75;
    const maxSpot = S * 1.25;
    const step = (maxSpot - minSpot) / 10;

    for (let simS = minSpot; simS <= maxSpot; simS += step) {
        spotGrid.push(fmtCurrency(simS, 0));
        const simD1 = (Math.log(simS / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
        const simD2 = simD1 - sigma * sqrtT;
        const curPrice = type === 'call'
            ? simS * Math.exp(-q * T) * normalCDF(simD1) - K * Math.exp(-r * T) * normalCDF(simD2)
            : K * Math.exp(-r * T) * normalCDF(-simD2) - simS * Math.exp(-q * T) * normalCDF(-simD1);
        bsPrices.push(Number(curPrice.toFixed(2)));

        const expP = type === 'call' ? Math.max(0, simS - K) : Math.max(0, K - simS);
        payoffAtExpiry.push(Number(expP.toFixed(2)));
    }

    renderDualCharts(
        {
            type: 'line',
            labels: spotGrid,
            datasets: [
                {
                    label: `Black-Scholes ${type.toUpperCase()} Curve Today`,
                    data: bsPrices,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.12)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.3
                },
                {
                    label: 'Intrinsic Payoff at Expiration',
                    data: payoffAtExpiry,
                    borderColor: '#10b981',
                    borderDash: [5, 4],
                    borderWidth: 2,
                    tension: 0
                }
            ]
        },
        {
            labels: ['Intrinsic Value', 'Time / Extrinsic Value'],
            datasets: [{
                data: [Math.round(intrinsicValue * 100) / 100, Math.round(timeValue * 100) / 100],
                backgroundColor: ['#10b981', '#f59e0b'],
                borderWidth: 1,
                borderColor: '#0a0e1a'
            }]
        },
        'Option Pricing Curve vs Terminal Intrinsic Payoff Profile',
        'Option Premium Attribution'
    );

    renderSensitivityMatrix({
        rowTitle: 'Spot Price (S)',
        colTitle: 'Implied Volatility (IV)',
        rowValues: [S * 0.9, S * 0.95, S, S * 1.05, S * 1.1],
        colValues: [sigma - 0.10, sigma - 0.05, sigma, sigma + 0.05, sigma + 0.10],
        rowLabels: [fmtCurrency(S * 0.9, 0), fmtCurrency(S * 0.95, 0), `${fmtCurrency(S, 0)} (Spot)`, fmtCurrency(S * 1.05, 0), fmtCurrency(S * 1.1, 0)],
        colLabels: [fmtPct((sigma - 0.10) * 100, 0), fmtPct((sigma - 0.05) * 100, 0), `${fmtPct(sigma * 100, 0)} (Base)`, fmtPct((sigma + 0.05) * 100, 0), fmtPct((sigma + 0.10) * 100, 0)],
        baseRowIdx: 2,
        baseColIdx: 2,
        calcFn: (s_val, iv_val) => {
            const curIV = Math.max(0.01, iv_val);
            const curD1 = (Math.log(s_val / K) + (r - q + 0.5 * curIV * curIV) * T) / (curIV * sqrtT);
            const curD2 = curD1 - curIV * sqrtT;
            const p = type === 'call'
                ? s_val * Math.exp(-q * T) * normalCDF(curD1) - K * Math.exp(-r * T) * normalCDF(curD2)
                : K * Math.exp(-r * T) * normalCDF(-curD2) - s_val * Math.exp(-q * T) * normalCDF(-curD1);
            return fmtCurrency(p, 2);
        }
    });

    renderDataTable(
        ['Greek / Parameter', 'Analytical Value', 'Formula / Sensitivity', 'Interpretation'],
        [
            ['Underlying Spot (S)', fmtCurrency(S, 2), 'Market Price', 'Asset current spot level'],
            ['Strike Price (K)', fmtCurrency(K, 2), 'Contract Exercise Price', 'Moneyness benchmark'],
            ['Theoretical Option Price', fmtCurrency(optionPrice, 2), 'BSM Closed-Form', `${type.toUpperCase()} fair market valuation`],
            ['Delta (Δ)', delta.toFixed(4), '∂V/∂S', 'Hedge ratio per 1 share underlying'],
            ['Gamma (Γ)', gamma.toFixed(4), '∂²V/∂S²', 'Rate of change in delta per $1 move'],
            ['Theta (Θ / Day)', fmtCurrency(thetaDaily, 3), '∂V/∂t', 'Calendar time decay cost per day'],
            ['Vega (𝓥)', fmtCurrency(vega, 3), '∂V/∂σ', 'Price impact per 1.0% increase in IV'],
            ['Rho (ρ)', fmtCurrency(rho, 3), '∂V/∂r', 'Interest rate sensitivity per 1.0% shift'],
            ['Fractional Kelly Sizer', `${(halfKelly * 100).toFixed(1)}%`, 'Half-Kelly (0.5 f*)', 'Mathematically optimal capital risk']
        ]
    );
}

// ─── Shared UI Renderers: KPI Ribbon, Charts, Sensitivity, Table ───

function renderKPICards(kpis) {
    const container = document.getElementById('calc-numerical-summary');
    if (!container) return;

    container.innerHTML = kpis.map(k => `
        <div class="metric-card" style="border-left-color: ${k.border || '#3b82f6'};">
            <span class="metric-title">${k.title}</span>
            <span class="metric-value font-mono">${k.value}</span>
            ${k.pill ? `<span class="metric-subpill ${k.pillType || 'neutral'}">${k.pill}</span>` : ''}
        </div>
    `).join('');
}

function renderDualCharts(barConfig, pieConfig, barTitle = 'Dynamic Wealth Trajectory', pieTitle = 'Capital Attribution') {
    // 1. Titles
    const bTitleEl = document.getElementById('calc-bar-chart-title');
    if (bTitleEl) bTitleEl.innerHTML = `<i class="fa-solid fa-chart-line"></i> ${barTitle}`;

    const pTitleEl = document.getElementById('calc-pie-chart-title');
    if (pTitleEl) pTitleEl.innerHTML = `<i class="fa-solid fa-chart-pie"></i> ${pieTitle}`;

    // 2. Bar / Line Trajectory Chart
    const barCtx = document.getElementById('calculatorBarChart')?.getContext('2d');
    if (barCtx) {
        if (calcBarInstance) calcBarInstance.destroy();

        calcBarInstance = new Chart(barCtx, {
            type: barConfig.type || 'line',
            data: {
                labels: barConfig.labels,
                datasets: barConfig.datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: '#94a3b8', font: { family: 'Inter', size: 11, weight: '500' } }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(10, 14, 26, 0.95)',
                        titleColor: '#ffffff',
                        bodyColor: '#cbd5e1',
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        borderWidth: 1,
                        padding: 10,
                        bodyFont: { family: 'JetBrains Mono', size: 12 }
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
                            callback: val => fmtCurrency(val)
                        }
                    }
                }
            }
        });
    }

    // 3. Attribution Pie / Doughnut Chart
    const pieCtx = document.getElementById('calculatorPieChart')?.getContext('2d');
    if (pieCtx) {
        if (calcDoughnutInstance) calcDoughnutInstance.destroy();

        calcDoughnutInstance = new Chart(pieCtx, {
            type: 'doughnut',
            data: pieConfig,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '62%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#94a3b8', font: { family: 'Inter', size: 10 } }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(10, 14, 26, 0.95)',
                        bodyFont: { family: 'JetBrains Mono', size: 12 },
                        callbacks: {
                            label: function(context) {
                                const val = context.raw || 0;
                                return ` ${context.label}: ${fmtCurrency(val)}`;
                            }
                        }
                    }
                }
            }
        });
    }
}

function renderSensitivityMatrix({ rowTitle, colTitle, rowValues, colValues, rowLabels, colLabels, baseRowIdx, baseColIdx, calcFn }) {
    const container = document.getElementById('calc-sensitivity-matrix');
    if (!container) return;

    let html = `<table class="sensitivity-table">`;
    html += `<thead><tr>`;
    html += `<th class="corner-header">${rowTitle} \\ ${colTitle}</th>`;
    colLabels.forEach((cLab, cIdx) => {
        html += `<th class="${cIdx === baseColIdx ? 'base-col' : ''}">${cLab}</th>`;
    });
    html += `</tr></thead><tbody>`;

    rowValues.forEach((rVal, rIdx) => {
        html += `<tr>`;
        html += `<td class="row-header">${rowLabels[rIdx]}</td>`;

        colValues.forEach((cVal, cIdx) => {
            const cellResult = calcFn(rVal, cVal);
            const isBaseCase = (rIdx === baseRowIdx && cIdx === baseColIdx);
            html += `<td class="sensitivity-cell ${isBaseCase ? 'base-case-cell' : ''}" title="${rowTitle}: ${rowLabels[rIdx]} | ${colTitle}: ${colLabels[cIdx]}">${cellResult}</td>`;
        });
        html += `</tr>`;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
}

function renderDataTable(headers, rows) {
    activeTableData = { headers, rows };

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

// ─── Export Features: Clean CSV & Executive PDF ─────────────────────

function exportCalcToCSV() {
    if (!activeTableData.headers.length || !activeTableData.rows.length) {
        showToast('No calculation schedule available to export');
        return;
    }

    const csvRows = [];
    csvRows.push(activeTableData.headers.map(h => `"${h.replace(/"/g, '""')}"`).join(','));

    activeTableData.rows.forEach(r => {
        csvRows.push(r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','));
    });

    const csvContent = csvRows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().slice(0, 10);
    link.setAttribute('href', url);
    link.setAttribute('download', `STRATA_${activeCalcType.toUpperCase()}_Schedule_${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`Exported ${activeCalcType.toUpperCase()} schedule as CSV`);
}

function exportCalcToPDF() {
    const btn = document.getElementById('export-calc-pdf-btn');
    const origHTML = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...';

    const element = document.querySelector('.calculator-visualization-card');
    if (!element) return;

    const opt = {
        margin: [10, 10, 10, 10],
        filename: `STRATA_Executive_${activeCalcType.toUpperCase()}_Report_${new Date().toISOString().slice(0, 10)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };

    if (window.html2pdf) {
        window.html2pdf().set(opt).from(element).save().then(() => {
            if (btn) btn.innerHTML = origHTML;
            showToast(`Generated PDF for ${activeCalcType.toUpperCase()}`);
        }).catch(err => {
            console.error('PDF generation error:', err);
            if (btn) btn.innerHTML = origHTML;
            showToast('PDF generation completed');
        });
    } else {
        window.print();
        if (btn) btn.innerHTML = origHTML;
    }
}

function showToast(message) {
    const toast = document.getElementById('global-toast-notification');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'toast-system show-toast';
    setTimeout(() => {
        toast.className = 'toast-system hidden-toast';
    }, 3500);
}
