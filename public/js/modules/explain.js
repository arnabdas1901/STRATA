(function() {
    const METRIC_DEFINITIONS = {
        pe: { name: 'Price-to-Earnings Ratio', formula: 'Market Price / EPS (TTM)', interpretation: 'How much investors pay per dollar of earnings. Higher = more expensive.', benchmarks: { low: '<15', median: '15-25', high: '>25' } },
        forwardPe: { name: 'Forward P/E', formula: 'Market Price / Forward EPS Estimate', interpretation: 'Price to earnings using analyst estimates for the next 12 months. Useful for growth companies.' },
        evEbitda: { name: 'EV/EBITDA', formula: '(Market Cap + Debt - Cash) / EBITDA', interpretation: 'Enterprise value per unit of operating earnings. Useful for comparing companies with different capital structures.', benchmarks: { low: '<10', median: '10-18', high: '>18' } },
        ps: { name: 'Price-to-Sales', formula: 'Market Cap / Annual Revenue', interpretation: 'How much investors pay per dollar of sales. Useful for pre-profitability companies.' },
        pfcf: { name: 'Price-to-Free Cash Flow', formula: 'Market Cap / Free Cash Flow', interpretation: 'Measures equity valuation relative to actual cash generated.' },
        peg: { name: 'PEG Ratio', formula: 'P/E / EPS Growth Rate', interpretation: 'Adjusts P/E for growth. A PEG < 1 is traditionally considered undervalued.' },
        fcfYield: { name: 'FCF Yield', formula: 'Free Cash Flow / Market Cap', interpretation: 'The percentage of market cap generated in free cash flow. Higher is better.' },
        roe: { name: 'Return on Equity', formula: 'Net Income / Shareholders Equity', interpretation: 'How efficiently a company generates profits from shareholders\' capital.' },
        roic: { name: 'Return on Invested Capital', formula: 'NOPAT / Invested Capital', interpretation: 'How efficiently a company generates returns from its capital. Higher = better capital allocation.' },
        roa: { name: 'Return on Assets', formula: 'Net Income / Total Assets', interpretation: 'Measures asset efficiency in generating profits.' },
        grossMargin: { name: 'Gross Margin', formula: '(Revenue - COGS) / Revenue', interpretation: 'Percentage of revenue left after direct costs of production.' },
        operatingMargin: { name: 'Operating Margin', formula: 'Operating Income / Revenue', interpretation: 'Profitability from core operations before interest and taxes.' },
        netMargin: { name: 'Net Margin', formula: 'Net Income / Revenue', interpretation: 'The percentage of revenue remaining as bottom-line profit.' },
        fcfMargin: { name: 'FCF Margin', formula: 'Free Cash Flow / Revenue', interpretation: 'Percentage of revenue converted to free cash flow.' },
        debtEquity: { name: 'Debt-to-Equity', formula: 'Total Debt / Shareholders Equity', interpretation: 'Financial leverage indicator. High ratios suggest higher risk.' },
        debtEbitda: { name: 'Debt/EBITDA', formula: 'Total Debt / EBITDA', interpretation: 'How many years of current EBITDA it would take to pay off all debt.' },
        currentRatio: { name: 'Current Ratio', formula: 'Current Assets / Current Liabilities', interpretation: 'Short-term liquidity measure. Values > 1 indicate ability to cover short-term obligations.' },
        beta: { name: 'Beta', formula: 'Cov(stock, market) / Var(market)', interpretation: 'Sensitivity to market movements. Beta > 1 = more volatile than market.' },
        sharpe: { name: 'Sharpe Ratio', formula: '(Return - Risk-Free Rate) / Volatility', interpretation: 'Risk-adjusted return. Higher is better.' },
        sortino: { name: 'Sortino Ratio', formula: '(Return - Risk-Free Rate) / Downside Deviation', interpretation: 'Similar to Sharpe but only penalizes downside volatility.' },
        maxDrawdown: { name: 'Maximum Drawdown', formula: '(Trough - Peak) / Peak', interpretation: 'The largest single drop from peak to trough.' },
        var95: { name: 'Value at Risk (95%)', formula: '5th percentile of return distribution', interpretation: 'The maximum expected loss over a specific timeframe with 95% confidence.' },
        cvar: { name: 'Conditional VaR', formula: 'Mean of returns below VaR threshold', interpretation: 'Expected loss given that the VaR threshold has been breached.' },
        accruals: { name: 'Accruals Ratio', formula: '(Net Income - Operating Cash Flow) / Total Assets', interpretation: 'Measures how much of earnings come from non-cash items. High accruals = lower earnings quality.' },
        cashConversion: { name: 'Cash Conversion Ratio', formula: 'Free Cash Flow / Net Income', interpretation: 'How well accounting earnings convert to actual cash. Values > 1.0 indicate strong cash generation.' },
        sbcRatio: { name: 'SBC / Net Income', formula: 'Stock-Based Compensation / Net Income', interpretation: 'Measures shareholder dilution disguised as operating profit.' },
        cagr: { name: 'CAGR', formula: '(End Value / Start Value)^(1/Years) - 1', interpretation: 'Smoothed annualized growth rate.' },
        dupontNetMargin: { name: 'DuPont Net Margin', formula: 'Net Income / Revenue', interpretation: 'Profitability component of DuPont ROE decomposition.' },
        dupontAssetTurnover: { name: 'DuPont Asset Turnover', formula: 'Revenue / Total Assets', interpretation: 'Efficiency component of DuPont ROE decomposition.' },
        dupontLeverage: { name: 'DuPont Equity Multiplier', formula: 'Total Assets / Equity', interpretation: 'Leverage component of DuPont ROE decomposition.' },
        dividendYield: { name: 'Dividend Yield', formula: 'Annual Dividends / Share Price', interpretation: 'Annual dividend return as a percentage of share price.' },
        payoutRatio: { name: 'Payout Ratio', formula: 'Dividends / Net Income', interpretation: 'Percentage of earnings paid out as dividends.' }
    };

    let stylesInjected = false;
    let activePopup = null;

    function injectStyles() {
        if (stylesInjected) return;
        const style = document.createElement('style');
        style.textContent = `
            .strata-explain-icon {
                display: inline-block;
                width: 14px;
                height: 14px;
                line-height: 14px;
                text-align: center;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.1);
                color: #94a3b8;
                font-size: 10px;
                margin-left: 6px;
                cursor: pointer;
                transition: all 0.2s;
                user-select: none;
            }
            .strata-explain-icon:hover {
                background: #3b82f6;
                color: #fff;
            }
            .strata-explain-popup {
                position: absolute;
                z-index: 10000;
                width: 320px;
                background: #0f1629;
                border: 1px solid #1e293b;
                border-radius: 8px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.5);
                padding: 16px;
                color: #e2e8f0;
                font-family: 'Inter', sans-serif;
                font-size: 13px;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .strata-explain-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #1e293b;
                padding-bottom: 8px;
            }
            .strata-explain-title {
                font-weight: 600;
                font-size: 14px;
                color: #fff;
            }
            .strata-explain-value {
                font-family: 'JetBrains Mono', monospace;
                font-weight: 600;
                color: #3b82f6;
                font-size: 14px;
            }
            .strata-explain-formula {
                background: rgba(255,255,255,0.05);
                padding: 8px;
                border-radius: 4px;
                font-family: 'JetBrains Mono', monospace;
                font-size: 11px;
                color: #94a3b8;
            }
            .strata-explain-interpretation {
                line-height: 1.5;
            }
            .strata-explain-meta {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
                font-size: 11px;
                color: #94a3b8;
                background: rgba(0,0,0,0.2);
                padding: 8px;
                border-radius: 4px;
            }
            .strata-explain-meta span {
                color: #e2e8f0;
                font-family: 'JetBrains Mono', monospace;
            }
            .strata-explain-trend.positive { color: #10b981; }
            .strata-explain-trend.negative { color: #ef4444; }
        `;
        document.head.appendChild(style);
        stylesInjected = true;

        // Global listeners for closing popup
        document.addEventListener('click', (e) => {
            if (activePopup && !activePopup.contains(e.target) && !e.target.classList.contains('strata-explain-icon')) {
                closePopup();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && activePopup) {
                closePopup();
            }
        });
    }

    function closePopup() {
        if (activePopup) {
            activePopup.remove();
            activePopup = null;
        }
    }

    function createPopup(metric, value, opts, rect) {
        closePopup();
        
        const popup = document.createElement('div');
        popup.className = 'strata-explain-popup';
        
        let metaHtml = '';
        if (opts.peerMedian || opts.percentile || opts.source || opts.trend) {
            metaHtml = '<div class="strata-explain-meta">';
            if (opts.source) metaHtml += `<div>Source: <span>${opts.source}</span></div>`;
            if (opts.period) metaHtml += `<div>Period: <span>${opts.period}</span></div>`;
            if (opts.peerMedian) metaHtml += `<div>Peer Median: <span>${opts.peerMedian}</span></div>`;
            if (opts.percentile) metaHtml += `<div>Percentile: <span>${opts.percentile}</span></div>`;
            
            if (opts.trend && opts.prevValue) {
                const isPos = opts.trend === 'up';
                metaHtml += `<div>Trend: <span class="strata-explain-trend ${isPos ? 'positive' : 'negative'}">
                    ${isPos ? '▲' : '▼'} from ${opts.prevValue}
                </span></div>`;
            }
            metaHtml += '</div>';
        }

        popup.innerHTML = `
            <div class="strata-explain-header">
                <div class="strata-explain-title">${metric.name}</div>
                <div class="strata-explain-value">${value}</div>
            </div>
            <div class="strata-explain-formula">${metric.formula}</div>
            <div class="strata-explain-interpretation">${metric.interpretation}</div>
            ${metaHtml}
        `;

        document.body.appendChild(popup);

        // Position popup
        const offset = 10;
        let top = rect.bottom + offset + window.scrollY;
        let left = rect.left + window.scrollX - popup.offsetWidth / 2 + rect.width / 2;

        // Bound checking
        if (left + popup.offsetWidth > window.innerWidth) {
            left = window.innerWidth - popup.offsetWidth - offset;
        }
        if (left < offset) {
            left = offset;
        }
        if (top + popup.offsetHeight > window.innerHeight + window.scrollY) {
            top = rect.top + window.scrollY - popup.offsetHeight - offset;
        }

        popup.style.top = `${top}px`;
        popup.style.left = `${left}px`;
        
        activePopup = popup;
    }

    window.StrataExplain = {
        attachExplainer: (containerElement, metricKey, currentValue, opts = {}) => {
            if (!METRIC_DEFINITIONS[metricKey]) {
                console.warn(`StrataExplain: No definition found for metric '${metricKey}'`);
                return;
            }

            injectStyles();

            const icon = document.createElement('span');
            icon.className = 'strata-explain-icon';
            icon.innerHTML = 'i';
            icon.title = 'Explain this metric';
            
            icon.addEventListener('click', (e) => {
                e.stopPropagation();
                const rect = icon.getBoundingClientRect();
                createPopup(METRIC_DEFINITIONS[metricKey], currentValue, opts, rect);
            });

            containerElement.appendChild(icon);
        },
        getDefinition: (metricKey) => METRIC_DEFINITIONS[metricKey]
    };
})();
