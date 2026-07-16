import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast, formatLargeCurrency, setupTabs } from '../utils.js';

let equityChartInstance = null;
let rawHistoricalData = [];
let activeEquityTicker = null;
let rawNewsArticles = []; // Global store for loaded news articles

export function loadDashboard() {
    const init = () => {
        setupTabs('#dashboard-equity');
        
        const isDetailsPage = window.location.pathname.includes('equity-details.html');
        
        if (isDetailsPage) {
            setupSearch();
            setupTimeframeSelectors();
            
            const params = new URLSearchParams(window.location.search);
            const symbol = params.get('symbol');
            if (symbol) {
                executeEquityAnalysis(symbol);
            } else {
                window.location.href = 'index.html';
            }
        } else {
            setupSearch();
            setupWatchlist();
            fetchLiveIndexValues();
            setupMarketNews();
            setupNewsFilters();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}

function setupSearch() {
    const searchBtn = document.getElementById('equity-search-btn');
    const searchInput = document.getElementById('equity-search-input');

    const handleSearch = () => {
        if (!searchInput) return;
        const ticker = searchInput.value.trim().toUpperCase();
        if (ticker) {
            window.location.href = `equity-details.html?symbol=${ticker}`;
        } else {
            showToast("Please enter a valid US ticker symbol");
        }
    };

    if (searchBtn) {
        searchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleSearch();
        });
    }

    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSearch();
            }
        });
    }
}

function setupTimeframeSelectors() {
    const tfBtns = document.querySelectorAll('#dashboard-equity .tf-btn');
    tfBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            tfBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (activeEquityTicker) {
                await loadEquityTimeSeries(activeEquityTicker, btn.getAttribute('data-tf'));
            }
        });
    });
}

async function executeEquityAnalysis(ticker) {
    activeEquityTicker = ticker;
    
    const searchBtn = document.getElementById('equity-search-btn');
    const newsWidget = document.querySelector('#dashboard-equity .news-widget');
    const indexStrip = document.querySelector('#dashboard-equity .index-summary-strip');
    const trendingStrip = document.querySelector('#dashboard-equity .trending-tickers-strip');
    const loader = document.getElementById('equity-loader');
    const resultsContainer = document.getElementById('equity-results-container');

    // Disable button and show loading state
    const originalBtnText = searchBtn ? searchBtn.textContent : '';
    if (searchBtn) {
        searchBtn.disabled = true;
        searchBtn.textContent = 'Analyzing...';
    }

    // Hide the news, index area and trending cards, show the loader
    if (newsWidget) newsWidget.classList.add('hidden-element');
    if (indexStrip) indexStrip.classList.add('hidden-element');
    if (trendingStrip) trendingStrip.classList.add('hidden-element');
    if (loader) loader.classList.remove('hidden-element');
    if (resultsContainer) resultsContainer.classList.add('hidden-element');

    try {
        const [profileRes, quoteRes, metricsRes, chartRes, bsRes, cfRes, incomeRes, recoRes, peersRes] = await Promise.all([
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/profile?symbol=${encodeURIComponent(ticker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/quote?symbol=${encodeURIComponent(ticker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/metrics?symbol=${encodeURIComponent(ticker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/time_series?symbol=${encodeURIComponent(ticker)}&timeframe=1Y`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/statements?symbol=${encodeURIComponent(ticker)}&type=balance_sheet`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/statements?symbol=${encodeURIComponent(ticker)}&type=cash_flow`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/statements?symbol=${encodeURIComponent(ticker)}&type=income_statement`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/recommendations?symbol=${encodeURIComponent(ticker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/peers-detailed?symbol=${encodeURIComponent(ticker)}`).catch(() => null)
        ]);

        const profile = await safeJsonParse(profileRes);
        const quote = await safeJsonParse(quoteRes);
        const metrics = await safeJsonParse(metricsRes);
        const chartData = await safeJsonParse(chartRes);
        const balanceSheet = await safeJsonParse(bsRes);
        const cashFlow = await safeJsonParse(cfRes);
        const incomeStatement = await safeJsonParse(incomeRes);
        const recommendations = await safeJsonParse(recoRes);
        const peersDetailed = await safeJsonParse(peersRes);

        if (profile?.error || quote?.error || !profile?.name) {
            throw new Error(profile?.error || quote?.error || 'Invalid ticker symbol or data unavailable');
        }

        updateUI(profile, quote, metrics, balanceSheet, cashFlow, incomeStatement, recommendations, peersDetailed);
        
        if (chartData && !chartData.error && chartData.values) {
            rawHistoricalData = [...chartData.values].reverse();
            renderEquityChart(rawHistoricalData);
        } else {
            console.warn('Chart data unavailable:', chartData);
        }

        if (resultsContainer) {
            resultsContainer.classList.remove('hidden-element');
            animateCardReveals();
        }
        
    } catch (error) {
        console.error("Market Data Fetch Error:", error);
        showToast(error.message || "Failed to load market data");
        // On error, restore the news, index area and trending cards so user can try again
        if (newsWidget) newsWidget.classList.remove('hidden-element');
        if (indexStrip) indexStrip.classList.remove('hidden-element');
        if (trendingStrip) trendingStrip.classList.remove('hidden-element');
    } finally {
        if (loader) loader.classList.add('hidden-element');
        // Restore button state
        if (searchBtn) {
            searchBtn.disabled = false;
            searchBtn.textContent = originalBtnText;
        }
    }
}


async function loadEquityTimeSeries(symbol, timeframe = '1Y') {
    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/time_series?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`);
        const timeSeriesData = await safeJsonParse(response);

        if (timeSeriesData?.values && timeSeriesData.values.length > 0) {
            rawHistoricalData = [...timeSeriesData.values].reverse();
            renderEquityChart(rawHistoricalData);
        }
    } catch (error) {
        console.warn('Failed to load equity chart data:', error);
    }
}

const getRatioColorClass = (type, valStr) => {
    const val = parseFloat(valStr);
    if (isNaN(val)) return '';
    if (type === 'pe') {
        if (val < 15) return 'ratio-good';
        if (val <= 25) return 'ratio-warning';
        return 'ratio-alert';
    }
    if (type === 'pb' || type === 'ps') {
        if (val < 2.0) return 'ratio-good';
        if (val <= 5.0) return 'ratio-warning';
        return 'ratio-alert';
    }
    if (type === 'percentage_high') {
        if (val > 15) return 'ratio-good';
        if (val >= 5) return 'ratio-warning';
        return 'ratio-alert';
    }
    if (type === 'current_ratio') {
        if (val >= 1.5) return 'ratio-good';
        if (val >= 1.0) return 'ratio-warning';
        return 'ratio-alert';
    }
    if (type === 'debt_equity') {
        if (val < 0.5) return 'ratio-good';
        if (val <= 1.5) return 'ratio-warning';
        return 'ratio-alert';
    }
    return '';
};

function updateUI(profile, quote, metrics, bs, cf, income, recommendations, peersDetailed) {
    const formatValue = (val, isCurrency = false) => {
        if (val == null) return '--';
        return isCurrency ? formatLargeCurrency(val * 1e6) : parseFloat(val).toFixed(2);
    };

    const metricData = metrics?.metric || {};

    // 1. Company Logo
    const logoImg = document.getElementById('company-logo-img');
    const logoFallback = document.getElementById('company-logo-fallback');
    if (logoImg && logoFallback) {
        if (profile?.logo) {
            logoImg.src = profile.logo;
            logoImg.style.display = 'block';
            logoFallback.style.display = 'none';
        } else {
            logoImg.src = '';
            logoImg.style.display = 'none';
            logoFallback.style.display = 'block';
        }
    }

    // 2. Industry Badge
    const industryText = document.getElementById('industry-badge-text');
    const industryBadge = document.getElementById('company-industry-badge');
    if (industryBadge && industryText) {
        if (profile?.finnhubIndustry) {
            industryText.textContent = profile.finnhubIndustry;
            industryBadge.style.display = 'inline-flex';
        } else {
            industryBadge.style.display = 'none';
        }
    }

    // 3. Price and daily change
    const changeArrow = document.getElementById('change-arrow-icon');
    const changeText = document.getElementById('change-text');
    const changeDisplay = document.getElementById('live-change-display');
    if (changeText) {
        const diff = quote?.d || 0;
        const pct = quote?.dp || 0;
        changeText.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${pct.toFixed(2)}%)`;
        if (changeArrow) {
            changeArrow.className = diff >= 0 ? 'fa-solid fa-caret-up' : 'fa-solid fa-caret-down';
        }
        if (changeDisplay) {
            changeDisplay.style.color = diff >= 0 ? '#10b981' : '#ef4444';
        }
    }

    const elements = {
        'company-name-display': profile?.name || 'Unknown',
        'company-ticker-badge': profile?.ticker || '--',
        'live-price-display': quote?.c ? `$${quote.c.toFixed(2)}` : '--',
        'metric-open': quote?.o ? `$${quote.o.toFixed(2)}` : '--',
        'metric-day-high': quote?.h ? `$${quote.h.toFixed(2)}` : '--',
        'metric-day-low': quote?.l ? `$${quote.l.toFixed(2)}` : '--',
        'metric-prev-close': quote?.pc ? `$${quote.pc.toFixed(2)}` : '--',
        'metric-mkt-cap': formatValue(profile?.marketCapitalization, true),
        'metric-beta': formatValue(metricData.beta),
        'metric-52w-high': metricData['52WeekHigh'] ? `$${parseFloat(metricData['52WeekHigh']).toFixed(2)}` : '--',
        'metric-52w-low': metricData['52WeekLow'] ? `$${parseFloat(metricData['52WeekLow']).toFixed(2)}` : '--'
    };

    for (const [id, value] of Object.entries(elements)) {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = value;
        }
    }

    // 52-Week Range Bar
    const rangeLabel = document.getElementById('equity-range-label');
    const rangeLow = document.getElementById('equity-range-low');
    const rangeHigh = document.getElementById('equity-range-high');
    const rangeMarker = document.getElementById('equity-range-marker');
    if (rangeMarker && quote?.c) {
        const currentPrice = quote.c;
        const low = metricData['52WeekLow'] || quote.l || currentPrice;
        const high = metricData['52WeekHigh'] || quote.h || currentPrice;
        const range = high - low;
        const pct = range > 0 ? Math.min(100, Math.max(0, ((currentPrice - low) / range) * 100)) : 50;
        
        rangeMarker.style.left = `${pct}%`;
        if (rangeLow) rangeLow.textContent = `$${parseFloat(low).toFixed(2)}`;
        if (rangeHigh) rangeHigh.textContent = `$${parseFloat(high).toFixed(2)}`;
        if (rangeLabel) rangeLabel.textContent = `Current: $${currentPrice.toFixed(2)} (${pct.toFixed(0)}% of range)`;
    }

    // Analyst Consensus Bar
    const recoContent = document.getElementById('analyst-reco-content');
    if (recoContent) {
        if (Array.isArray(recommendations) && recommendations.length > 0) {
            const r = recommendations[0];
            const strongBuy = r.strongBuy || 0;
            const buy = r.buy || 0;
            const hold = r.hold || 0;
            const sell = r.sell || 0;
            const strongSell = r.strongSell || 0;
            const total = strongBuy + buy + hold + sell + strongSell;

            if (total > 0) {
                let consensus = 'Hold';
                if (strongBuy + buy > total * 0.6) consensus = 'Strong Buy';
                else if (strongBuy + buy > total * 0.4) consensus = 'Buy';
                else if (sell + strongSell > total * 0.4) consensus = 'Sell';

                const buyPct = ((strongBuy + buy) / total) * 100;
                const holdPct = (hold / total) * 100;
                const sellPct = ((sell + strongSell) / total) * 100;

                recoContent.innerHTML = `
                    <div class="analyst-reco-layout">
                        <div class="analyst-reco-summary">
                            <span class="reco-consensus-badge">${consensus}</span>
                            <span class="reco-count-label">Based on ${total} analysts (${r.period})</span>
                        </div>
                        <div class="reco-stacked-bar">
                            <div class="reco-bar-segment buy" style="width: ${buyPct}%" title="Buy / Strong Buy: ${strongBuy + buy}"></div>
                            <div class="reco-bar-segment hold" style="width: ${holdPct}%" title="Hold: ${hold}"></div>
                            <div class="reco-bar-segment sell" style="width: ${sellPct}%" title="Sell / Strong Sell: ${sell + strongSell}"></div>
                        </div>
                        <div class="reco-legend">
                            <span><span class="legend-color-dot buy"></span> Buy (${strongBuy + buy})</span>
                            <span><span class="legend-color-dot hold"></span> Hold (${hold})</span>
                            <span><span class="legend-color-dot sell"></span> Sell (${sell + strongSell})</span>
                        </div>
                    </div>
                `;
            } else {
                recoContent.innerHTML = `<p class="empty-notice">No recommendation data available.</p>`;
            }
        } else {
            recoContent.innerHTML = `<p class="empty-notice">No recommendation data available.</p>`;
        }
    }

    // Populate Key Statistics KPI Summary Bar
    const kpiEps = document.getElementById('kpi-eps');
    const kpiDivYield = document.getElementById('kpi-div-yield');
    const kpiPe = document.getElementById('kpi-pe');
    const kpiMktCap = document.getElementById('kpi-mkt-cap');
    if (kpiEps) kpiEps.textContent = metricData.epsBasicExclExtraItemsTTM != null ? metricData.epsBasicExclExtraItemsTTM.toFixed(2) : '--';
    if (kpiDivYield) kpiDivYield.textContent = metricData.dividendYieldIndicatedAnnual != null ? metricData.dividendYieldIndicatedAnnual.toFixed(2) + '%' : '0.00%';
    if (kpiPe) kpiPe.textContent = metricData.peTTM != null ? metricData.peTTM.toFixed(2) : '--';
    if (kpiMktCap) kpiMktCap.textContent = formatValue(profile?.marketCapitalization, true);

    // Populate Sector Peer Comparison Table
    const peersTbody = document.getElementById('equity-peers-tbody');
    if (peersTbody) {
        if (Array.isArray(peersDetailed) && peersDetailed.length > 0) {
            peersTbody.innerHTML = peersDetailed.map(p => {
                const price = parseFloat(p.price).toFixed(2);
                const chg = parseFloat(p.changePercent).toFixed(2);
                const mkt = formatLargeCurrency(p.marketCap * 1e6);
                const peVal = p.pe ? parseFloat(p.pe).toFixed(2) : '--';
                const colorClass = p.changePercent >= 0 ? 'pos-change' : 'neg-change';
                const sign = p.changePercent >= 0 ? '+' : '';
                return `
                    <tr style="cursor: pointer;" class="peer-row-clickable">
                        <td class="font-mono"><strong>${p.symbol}</strong><br><span style="font-size: 0.75rem; color: var(--text-secondary-muted);">${p.name}</span></td>
                        <td class="num-col font-mono">$${price}</td>
                        <td class="num-col font-mono ${colorClass}">${sign}${chg}%</td>
                        <td class="num-col font-mono">${mkt}</td>
                        <td class="num-col font-mono">${peVal}</td>
                    </tr>
                `;
            }).join('');

            // Add click listeners to peer rows
            const rows = peersTbody.querySelectorAll('.peer-row-clickable');
            rows.forEach((row, idx) => {
                row.addEventListener('click', () => {
                    const peerSymbol = peersDetailed[idx].symbol;
                    if (peerSymbol) {
                        window.location.href = `equity-details.html?symbol=${peerSymbol}`;
                    }
                });
            });
        } else {
            peersTbody.innerHTML = `<tr><td colspan="5" class="table-empty-state">No peer comparison data available.</td></tr>`;
        }
    }

    // Populate Ratios Grid
    const ratiosGrid = document.getElementById('ratios-grid-target');
    if (ratiosGrid) {
        const ratios = [
            { label: 'P/E Ratio', value: formatValue(metricData.peTTM), type: 'pe' },
            { label: 'P/B Ratio', value: formatValue(metricData.pbAnnual), type: 'pb' },
            { label: 'P/S Ratio', value: formatValue(metricData.psTTM), type: 'ps' },
            { label: 'ROE', value: formatValue(metricData.roeTTM) + '%', type: 'percentage_high' },
            { label: 'ROA', value: formatValue(metricData.roaTTM) + '%', type: 'percentage_high' },
            { label: 'Net Margin', value: formatValue(metricData.netProfitMarginTTM) + '%', type: 'percentage_high' },
            { label: 'Current Ratio', value: formatValue(metricData.currentRatioAnnual), type: 'current_ratio' },
            { label: 'Debt/Equity', value: formatValue(metricData.debtToEquityAnnual), type: 'debt_equity' },
            { label: 'Revenue Growth 5Y', value: formatValue(metricData.revenueGrowth5Y) + '%', type: 'percentage_high' },
            { label: 'EPS Growth 5Y', value: formatValue(metricData.epsGrowth5Y) + '%', type: 'percentage_high' },
            { label: 'Dividend Yield', value: formatValue(metricData.dividendYieldIndicatedAnnual) + '%', type: 'dividend' }
        ];

        ratiosGrid.innerHTML = ratios.map(r => {
            const colorClass = getRatioColorClass(r.type, r.value);
            return `
                <div class="ratio-item ${colorClass}">
                    <span class="ratio-label">${r.label}</span>
                    <span class="ratio-value">${r.value}</span>
                </div>
            `;
        }).join('');
    }

    const descEl = document.getElementById('corporate-description-text');
    if (descEl) {
        descEl.textContent = profile?.name ? `${profile.name} is a company in the ${profile.finnhubIndustry || 'General'} sector, traded on ${profile.exchange || 'the public markets'}.` : 'Company description unavailable.';
    }

    // AI Profile Generation
    const aiGenBtn = document.getElementById('generate-ai-profile-btn');
    const aiOutput = document.getElementById('ai-profile-output');
    if (aiGenBtn && aiOutput) {
        aiOutput.innerHTML = `<span class="empty-notice">Click "Generate" to create an AI-powered executive summary for this company.</span>`;
        aiGenBtn.disabled = false;
        
        const newAiGenBtn = aiGenBtn.cloneNode(true);
        aiGenBtn.parentNode.replaceChild(newAiGenBtn, aiGenBtn);
        
        newAiGenBtn.addEventListener('click', async () => {
            newAiGenBtn.disabled = true;
            const originalBtnHtml = newAiGenBtn.innerHTML;
            newAiGenBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Generating...`;
            aiOutput.innerHTML = `<div style="display: flex; align-items: center; gap: 8px; color: var(--neon-cyan-vibrant);"><i class="fa-solid fa-robot fa-bounce"></i> Generating executive summary via AI...</div>`;
            try {
                const response = await fetch(`${BACKEND_URL}/api/company-profile-ai?symbol=${encodeURIComponent(activeEquityTicker)}`, {
                    method: 'POST'
                });
                const payload = await response.json();
                if (payload.summary) {
                    aiOutput.innerHTML = `<div class="ai-profile-summary-text">${payload.summary}</div>`;
                } else {
                    throw new Error(payload.error || 'Failed to generate summary');
                }
            } catch (err) {
                console.error(err);
                aiOutput.innerHTML = `<span class="error-text" style="color: var(--neon-red-vibrant);"><i class="fa-solid fa-triangle-exclamation"></i> ${err.message || 'Error generating AI summary.'}</span>`;
            } finally {
                newAiGenBtn.disabled = false;
                newAiGenBtn.innerHTML = originalBtnHtml;
            }
        });
    }

    // Income Statement Tab Table
    const incomeTable = document.getElementById('income-statement-table-body');
    if (incomeTable) {
        const incData = income?.income_statement?.[0] || {};
        incomeTable.innerHTML = `
            <tr><td>Total Revenue</td><td class="num-col font-mono">${formatLargeCurrency(incData.total_revenue || incData.totalRevenue || 0)}</td></tr>
            <tr><td>Cost of Revenue</td><td class="num-col font-mono">${formatLargeCurrency(incData.cost_of_revenue || incData.costOfRevenue || 0)}</td></tr>
            <tr><td>Gross Profit</td><td class="num-col font-mono">${formatLargeCurrency(incData.gross_profit || incData.grossProfit || 0)}</td></tr>
            <tr><td>Operating Income</td><td class="num-col font-mono">${formatLargeCurrency(incData.operating_income || incData.operatingIncome || 0)}</td></tr>
            <tr><td>EBITDA</td><td class="num-col font-mono">${formatLargeCurrency(incData.ebitda || 0)}</td></tr>
            <tr><td>Net Income</td><td class="num-col font-mono">${formatLargeCurrency(incData.net_income || incData.netIncome || 0)}</td></tr>
            <tr><td>EPS (Diluted)</td><td class="num-col font-mono">${incData.eps_diluted ? '$' + parseFloat(incData.eps_diluted).toFixed(2) : '--'}</td></tr>
        `;
    }

    // Balance Sheet Tab Table
    const bsTable = document.getElementById('balance-sheet-table-body');
    if (bsTable) {
        const bsData = bs?.balance_sheet?.[0] || {};
        bsTable.innerHTML = `
            <tr><td>Cash & Equivalents</td><td class="num-col font-mono">${formatLargeCurrency(bsData.cash_and_equivalents || bsData.cashAndEquivalents || 0)}</td></tr>
            <tr><td>Total Current Assets</td><td class="num-col font-mono">${formatLargeCurrency(bsData.total_current_assets || bsData.totalCurrentAssets || 0)}</td></tr>
            <tr><td>Total Assets</td><td class="num-col font-mono">${formatLargeCurrency(bsData.total_assets || bsData.totalAssets || 0)}</td></tr>
            <tr><td>Short-term Debt</td><td class="num-col font-mono">${formatLargeCurrency(bsData.short_term_debt || bsData.shortTermDebt || 0)}</td></tr>
            <tr><td>Long-term Debt</td><td class="num-col font-mono">${formatLargeCurrency(bsData.long_term_debt || bsData.longTermDebt || 0)}</td></tr>
            <tr><td>Total Liabilities</td><td class="num-col font-mono">${formatLargeCurrency(bsData.total_liabilities || bsData.totalLiabilities || 0)}</td></tr>
            <tr><td>Total Shareholders' Equity</td><td class="num-col font-mono">${formatLargeCurrency(bsData.total_shareholders_equity || bsData.totalEquity || bsData.totalShareholdersEquity || 0)}</td></tr>
        `;
    }

    // Cash Flow Tab Table
    const cfTable = document.getElementById('cashflow-table-body');
    if (cfTable) {
        const cfData = cf?.cash_flow?.[0] || {};
        const ocf = cfData.operating_cash_flow || cfData.operatingCashFlow || 0;
        const capex = cfData.capital_expenditures || cfData.capitalExpenditures || cfData.capitalExpenditure || 0;
        const fcf = ocf - capex;
        cfTable.innerHTML = `
            <tr><td>Operating Cash Flow</td><td class="num-col font-mono">${formatLargeCurrency(ocf)}</td></tr>
            <tr><td>Capital Expenditures</td><td class="num-col font-mono">${formatLargeCurrency(capex)}</td></tr>
            <tr><td>Free Cash Flow</td><td class="num-col font-mono">${formatLargeCurrency(fcf)}</td></tr>
            <tr><td>Investing Cash Flow</td><td class="num-col font-mono">${formatLargeCurrency(cfData.investing_cash_flow || cfData.investingCashFlow || 0)}</td></tr>
            <tr><td>Financing Cash Flow</td><td class="num-col font-mono">${formatLargeCurrency(cfData.financing_cash_flow || cfData.financingCashFlow || 0)}</td></tr>
            <tr><td>Net Change in Cash</td><td class="num-col font-mono">${formatLargeCurrency(cfData.net_change_in_cash || cfData.netChangeInCash || 0)}</td></tr>
        `;
    }
}

function animateCardReveals() {
    const cards = document.querySelectorAll('#dashboard-equity .equity-reveal-card');
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

function renderEquityChart(data) {
    const canvas = document.getElementById('equityHistoricalChart');
    if (!canvas || !data || data.length === 0) return;

    const labels = data.map(v => {
        const date = new Date(v.datetime);
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
    });
    const prices = data.map(v => parseFloat(v.close));
    const volumes = data.map(v => parseFloat(v.volume || 0));

    const isPositive = prices[prices.length - 1] >= prices[0];
    const color = isPositive ? '#10b981' : '#ef4444';
    
    const ctx = canvas.getContext('2d');
    const priceGradient = ctx.createLinearGradient(0, 0, 0, 320);
    if (isPositive) {
        priceGradient.addColorStop(0, 'rgba(16, 185, 129, 0.34)');
        priceGradient.addColorStop(0.45, 'rgba(6, 182, 212, 0.16)');
        priceGradient.addColorStop(1, 'rgba(37, 99, 235, 0)');
    } else {
        priceGradient.addColorStop(0, 'rgba(239, 68, 68, 0.32)');
        priceGradient.addColorStop(0.45, 'rgba(236, 72, 153, 0.14)');
        priceGradient.addColorStop(1, 'rgba(37, 99, 235, 0)');
    }

    // Color volume bars: green for days closing higher than previous close, red for lower
    const volumeColors = data.map((v, i) => {
        if (i === 0) return 'rgba(16, 185, 129, 0.2)';
        const prevClose = parseFloat(data[i - 1].close);
        const currClose = parseFloat(v.close);
        return currClose >= prevClose ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)';
    });

    if (equityChartInstance) {
        equityChartInstance.destroy();
    }

    equityChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Close Price',
                    data: prices,
                    borderColor: color,
                    backgroundColor: priceGradient,
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointBackgroundColor: color,
                    pointBorderColor: '#f8fafc',
                    pointBorderWidth: 1.5,
                    fill: true,
                    tension: 0.22,
                    yAxisID: 'y'
                },
                {
                    label: 'Volume',
                    data: volumes,
                    type: 'bar',
                    backgroundColor: volumeColors,
                    hoverBackgroundColor: volumeColors.map(c => c.replace('0.3', '0.6').replace('0.2', '0.5')),
                    borderColor: 'rgba(255,255,255,0.02)',
                    borderWidth: 1,
                    barPercentage: 0.72,
                    categoryPercentage: 0.82,
                    yAxisID: 'yVolume'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(3, 7, 18, 0.97)',
                    titleColor: 'rgba(255, 255, 255, 0.85)',
                    bodyColor: '#ffffff',
                    bodyFont: { family: "'JetBrains Mono', monospace", size: 13 },
                    borderColor: 'rgba(37, 99, 235, 0.45)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            const val = context.parsed.y;
                            if (context.dataset.label === 'Close Price') {
                                return `Price: $${val.toFixed(2)}`;
                            } else if (context.dataset.label === 'Volume') {
                                return `Volume: ${val.toLocaleString()}`;
                            }
                            return `${context.dataset.label}: ${val}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.4)',
                        maxTicksLimit: 8
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.6)',
                        font: { family: "'JetBrains Mono', monospace" },
                        callback: (val) => `$${val.toFixed(2)}`
                    }
                },
                yVolume: {
                    type: 'linear',
                    display: false,
                    position: 'left',
                    grid: {
                        drawOnChartArea: false
                    },
                    min: 0,
                    max: Math.max(...volumes) * 4
                }
            },
            animation: {
                duration: 1000,
                easing: 'easeOutQuart'
            }
        }
    });
}

// --- Live Indices ---
async function fetchLiveIndexValues() {
    const spValue = document.getElementById('sp500-live-value');
    const spSource = document.getElementById('sp500-source');
    const spChange = document.getElementById('sp500-change');
    const nasValue = document.getElementById('nasdaq-live-value');
    const nasSource = document.getElementById('nasdaq-source');
    const nasChange = document.getElementById('nasdaq-change');
    const dowValue = document.getElementById('dow-live-value');
    const dowSource = document.getElementById('dow-source');
    const dowChange = document.getElementById('dow-change');

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/indices`);
        const payload = await safeJsonParse(response);
        
        const formatIndexValue = (value) => parseFloat(value).toFixed(2);
        const formatChange = (value, percentage) => `${value >= 0 ? '+' : ''}${parseFloat(value).toFixed(2)} (${parseFloat(percentage).toFixed(2)}%)`;
        const formatSource = (item, fallback) => {
            const symbol = item.symbol || item.requestedSymbol || fallback;
            return item.source ? `${symbol} - ${item.source}` : symbol;
        };

        if (payload?.sp500) {
            spValue && (spValue.innerText = formatIndexValue(payload.sp500.price));
            spSource && (spSource.innerText = formatSource(payload.sp500, 'S&P 500'));
            if (spChange) {
                spChange.innerText = formatChange(payload.sp500.change, payload.sp500.changePercent);
                spChange.className = 'index-change ' + (payload.sp500.change >= 0 ? 'pos-change' : 'neg-change');
            }
        }

        if (payload?.nasdaq) {
            nasValue && (nasValue.innerText = formatIndexValue(payload.nasdaq.price));
            nasSource && (nasSource.innerText = formatSource(payload.nasdaq, 'NASDAQ'));
            if (nasChange) {
                nasChange.innerText = formatChange(payload.nasdaq.change, payload.nasdaq.changePercent);
                nasChange.className = 'index-change ' + (payload.nasdaq.change >= 0 ? 'pos-change' : 'neg-change');
            }
        }

        if (payload?.dowjones) {
            dowValue && (dowValue.innerText = formatIndexValue(payload.dowjones.price));
            dowSource && (dowSource.innerText = formatSource(payload.dowjones, 'DOW'));
            if (dowChange) {
                dowChange.innerText = formatChange(payload.dowjones.change, payload.dowjones.changePercent);
                dowChange.className = 'index-change ' + (payload.dowjones.change >= 0 ? 'pos-change' : 'neg-change');
            }
        }
    } catch (error) {
        console.warn('Failed to load live index values:', error);
    }
}

// --- Market News ---
async function setupMarketNews() {
    const grid = document.getElementById('market-news-grid');
    if (!grid) return;

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/finnhub/news`);
        const newsData = await safeJsonParse(response);
        
        if (Array.isArray(newsData) && newsData.length > 0) {
            rawNewsArticles = newsData; // Store globally
            const activeFilterBtn = document.querySelector('#dashboard-equity .news-filter-option.active');
            const activeFilter = activeFilterBtn ? activeFilterBtn.getAttribute('data-filter') : 'all';
            filterAndRenderNews(activeFilter);
        } else {
            grid.innerHTML = '<div class="news-note">No recent market news available.</div>';
        }
    } catch (error) {
        console.warn('Failed to load market news:', error);
        grid.innerHTML = '<div class="news-note">Unable to load news data. Please try again later.</div>';
    }
}

function renderNewsGrid(newsItems) {
    const grid = document.getElementById('market-news-grid');
    if (!grid) return;

    grid.innerHTML = newsItems.map(item => {
        const imageUrl = item.image || 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?q=80&w=1470&auto=format&fit=crop';
        const date = new Date(item.datetime * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        
        return `
            <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="news-card">
                <div class="news-thumbnail" style="background-image: url('${imageUrl}')"></div>
                <div class="news-content">
                    <div class="news-meta">
                        <span class="news-source">${item.source}</span>
                        <span class="news-date">${date}</span>
                    </div>
                    <h4 class="news-headline">${item.headline}</h4>
                    <p class="news-summary">${item.summary ? item.summary.substring(0, 100) + '...' : ''}</p>
                </div>
            </a>
        `;
    }).join('');
}

function setupWatchlist() {
    const items = document.querySelectorAll('#dashboard-equity .watchlist-item');
    items.forEach(item => {
        item.addEventListener('click', () => {
            const symbol = item.getAttribute('data-symbol');
            if (symbol) {
                window.location.href = `equity-details.html?symbol=${symbol}`;
            }
        });
    });
}

function setupNewsFilters() {
    const filterBtn = document.getElementById('news-filter-btn');
    const filterMenu = document.getElementById('news-filter-menu');
    const filterOptions = document.querySelectorAll('#dashboard-equity .news-filter-option');
    const selectedLabel = document.getElementById('news-filter-selected-label');

    if (!filterBtn || !filterMenu) return;

    // Toggle dropdown
    const toggleDropdown = (show) => {
        const isExpanded = show !== undefined ? show : filterBtn.getAttribute('aria-expanded') !== 'true';
        filterBtn.setAttribute('aria-expanded', String(isExpanded));
        if (isExpanded) {
            filterMenu.classList.add('show');
        } else {
            filterMenu.classList.remove('show');
        }
    };

    filterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown();
    });

    // Close on clicking outside
    document.addEventListener('click', (e) => {
        if (!filterBtn.contains(e.target) && !filterMenu.contains(e.target)) {
            toggleDropdown(false);
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            toggleDropdown(false);
        }
    });

    // Handle option click
    filterOptions.forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Remove active states
            filterOptions.forEach(opt => {
                opt.classList.remove('active');
                opt.setAttribute('aria-selected', 'false');
            });
            
            // Add active state to clicked option
            option.classList.add('active');
            option.setAttribute('aria-selected', 'true');
            
            // Update button label
            if (selectedLabel) {
                selectedLabel.textContent = option.textContent;
            }
            
            // Close dropdown
            toggleDropdown(false);
            
            // Trigger filter logic
            const filterType = option.getAttribute('data-filter');
            filterAndRenderNews(filterType);
        });
    });
}

function filterAndRenderNews(filterType) {
    if (!rawNewsArticles || rawNewsArticles.length === 0) return;
    
    let filtered = [...rawNewsArticles];
    if (filterType === 'tech') {
        const keywords = ['tech', 'software', 'chip', 'semiconductor', 'apple', 'microsoft', 'google', 'nvidia', 'meta', 'crypto', 'bitcoin', 'ai', 'cyber', 'phone', 'device'];
        filtered = rawNewsArticles.filter(item => {
            const text = `${item.headline} ${item.summary || ''}`.toLowerCase();
            return keywords.some(k => text.includes(k));
        });
    } else if (filterType === 'finance') {
        const keywords = ['bank', 'fed', 'inflation', 'rate', 'earnings', 'profit', 'stock', 'ipo', 'finance', 'debt', 'market', 'acquisition', 'merge', 'yield', 'treasury', 'economic'];
        filtered = rawNewsArticles.filter(item => {
            const text = `${item.headline} ${item.summary || ''}`.toLowerCase();
            return keywords.some(k => text.includes(k));
        });
    } else if (filterType === 'energy') {
        const keywords = ['oil', 'gas', 'energy', 'petroleum', 'gold', 'wheat', 'commodity', 'climate', 'solar', 'crude', 'mine', 'fuel', 'barrel'];
        filtered = rawNewsArticles.filter(item => {
            const text = `${item.headline} ${item.summary || ''}`.toLowerCase();
            return keywords.some(k => text.includes(k));
        });
    }
    
    renderNewsGrid(filtered.slice(0, 6));
}

