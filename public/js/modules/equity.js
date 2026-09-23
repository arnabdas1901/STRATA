import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast, escapeHtml, formatLargeCurrency, setupTabs, setupChartFullscreen } from '../utils.js';
import { IndicatorManager, setupIndicatorsUI } from './indicators.js';

let equityChartInstance = null;
let equityIndicatorManager = null;
let rawHistoricalData = [];
let activeEquityTicker = null;
let rawNewsArticles = []; // Global store for loaded news articles
let chartMode = 'line'; // 'line' or 'candlestick'

export function loadDashboard() {
    const init = async () => {
        setupTabs('#dashboard-equity');
        
        const isDetailsPage = window.location.pathname.includes('equity-details.html');
        
        if (isDetailsPage) {
            setupSearch();
            setupTimeframeSelectors();
            setupChartModeToggle();
            setupIndicatorsUI('equity', () => rawHistoricalData, () => equityIndicatorManager);
            setupChartFullscreen();
            
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
            setupMarketNews();
            setupNewsFilters();
            setupEquityDashboardTabs();
            setupSectorMinimizer();

            const [indexPayload, moversData, sectorData] = await Promise.all([
                fetchLiveIndexValues(),
                fetchMarketMovers(),
                fetchSectorPerformance()
            ]);
            computeMarketSentiment(indexPayload, moversData, sectorData);
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

    let lastSearchTime = 0;

    const handleSearch = () => {
        const now = Date.now();
        if (now - lastSearchTime < 500) return;
        lastSearchTime = now;

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
        // Stage 1: Fast essential load (Profile, Quote, Metrics, Price Chart)
        const [profileRes, quoteRes, metricsRes, chartRes] = await Promise.all([
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/profile?symbol=${encodeURIComponent(ticker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/quote?symbol=${encodeURIComponent(ticker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/metrics?symbol=${encodeURIComponent(ticker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/time_series?symbol=${encodeURIComponent(ticker)}&timeframe=1Y`).catch(() => null)
        ]);

        const rawProfile = await safeJsonParse(profileRes);
        const rawQuote = await safeJsonParse(quoteRes);
        const metrics = await safeJsonParse(metricsRes);
        const chartData = await safeJsonParse(chartRes);

        const profile = (rawProfile && !rawProfile.error && rawProfile.name) ? rawProfile : {
            ticker: ticker.toUpperCase(),
            name: `${ticker.toUpperCase()} Asset`,
            currency: 'USD',
            exchange: 'US Markets',
            finnhubIndustry: 'Equities',
            logo: `https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/${ticker.toUpperCase()}.png`,
            weburl: `https://finance.yahoo.com/quote/${ticker.toUpperCase()}`
        };

        const quote = (rawQuote && !rawQuote.error && typeof rawQuote.c === 'number' && rawQuote.c > 0) ? rawQuote : (
            (chartData && chartData.values && chartData.values.length > 0) ? {
                c: parseFloat(chartData.values[0].close),
                d: parseFloat(chartData.values[0].close) - parseFloat(chartData.values[0].open || chartData.values[0].close),
                dp: ((parseFloat(chartData.values[0].close) - parseFloat(chartData.values[0].open || chartData.values[0].close)) / parseFloat(chartData.values[0].open || 1)) * 100,
                h: parseFloat(chartData.values[0].high || chartData.values[0].close),
                l: parseFloat(chartData.values[0].low || chartData.values[0].close),
                o: parseFloat(chartData.values[0].open || chartData.values[0].close),
                pc: parseFloat(chartData.values[0].open || chartData.values[0].close),
                t: Math.floor(Date.now() / 1000)
            } : null
        );

        if (!quote && (!rawProfile || !rawProfile.name)) {
            throw new Error(rawProfile?.error || rawQuote?.error || 'Invalid ticker symbol or data unavailable');
        }

        // Immediately update Hero Card and Chart
        updateUI(profile, quote || { c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0 }, metrics, null, null, null, null, null);
        
        const aiBtn = document.getElementById('equity-ai-btn');
        if (aiBtn) {
            aiBtn.onclick = (e) => {
                e.preventDefault();
                if (activeEquityTicker) {
                    window.location.href = `ai.html?ticker=${activeEquityTicker}&autoRun=true`;
                }
            };
        }
        
        if (chartData && !chartData.error && chartData.values) {
            // Deduplicate + sort ascending (Lightweight Charts v5 strict requirement)
            const seenDates = new Set();
            rawHistoricalData = [...chartData.values].reverse().filter(v => {
                if (!v.datetime || seenDates.has(v.datetime)) return false;
                seenDates.add(v.datetime);
                return true;
            });
        } else {
            console.warn('Chart data unavailable:', chartData);
        }

        // Unblock UI FIRST — chart must render into a visible container!
        if (loader) loader.classList.add('hidden-element');
        if (resultsContainer) {
            resultsContainer.classList.remove('hidden-element');
            animateCardReveals();
        }

        // Render chart AFTER container is visible so clientWidth/clientHeight are non-zero
        if (rawHistoricalData.length > 0) {
            // Small defer to let the browser do one layout pass before chart init
            requestAnimationFrame(() => renderEquityChart(rawHistoricalData));
        }

        // Stage 2 (Background non-blocking hydration): Analyst Reco, Peers, Financial Statements
        Promise.all([
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/recommendations?symbol=${encodeURIComponent(ticker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/finnhub/peers-detailed?symbol=${encodeURIComponent(ticker)}`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/statements?symbol=${encodeURIComponent(ticker)}&type=balance_sheet`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/statements?symbol=${encodeURIComponent(ticker)}&type=cash_flow`).catch(() => null),
            fetchWithTimeout(`${BACKEND_URL}/api/twelvedata/statements?symbol=${encodeURIComponent(ticker)}&type=income_statement`).catch(() => null)
        ]).then(async ([recoRes, peersRes, bsRes, cfRes, incomeRes]) => {
            const recommendations = await safeJsonParse(recoRes);
            const peersDetailed = await safeJsonParse(peersRes);
            const balanceSheet = await safeJsonParse(bsRes);
            const cashFlow = await safeJsonParse(cfRes);
            const incomeStatement = await safeJsonParse(incomeRes);

            // Hydrate background components
            updateUI(profile, quote, metrics, balanceSheet, cashFlow, incomeStatement, recommendations, peersDetailed);
        });

        // Stage 3: Extended data (Earnings, Dividends, Insider) — deferred to avoid rate limits
        setTimeout(() => {
            fetchAndRenderEarnings(ticker);
            fetchAndRenderDividends(ticker);
            fetchAndRenderInsider(ticker);
        }, 2000);

    } catch (error) {
        console.error("Market Data Fetch Error:", error);
        showToast(error.message || "Failed to load market data");
        if (newsWidget) newsWidget.classList.remove('hidden-element');
        if (indexStrip) indexStrip.classList.remove('hidden-element');
        if (trendingStrip) trendingStrip.classList.remove('hidden-element');
        if (loader) loader.classList.add('hidden-element');
    } finally {
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

    // Company Info Bar
    const infoBar = document.getElementById('company-info-bar');
    if (infoBar && profile) {
        let hasInfo = false;
        const infoCountry = document.querySelector('#info-country span');
        const infoIpo = document.querySelector('#info-ipo span');
        const infoShares = document.querySelector('#info-shares span');
        const infoWebsite = document.querySelector('#info-website a');

        if (profile.country && infoCountry) {
            infoCountry.textContent = profile.country;
            hasInfo = true;
        }
        if (profile.ipo && infoIpo) {
            const ipoDate = new Date(profile.ipo);
            infoIpo.textContent = isNaN(ipoDate) ? profile.ipo : ipoDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            hasInfo = true;
        }
        if (profile.shareOutstanding && infoShares) {
            const shares = profile.shareOutstanding;
            infoShares.textContent = shares >= 1000 ? (shares / 1000).toFixed(1) + 'B' : shares.toFixed(0) + 'M';
            hasInfo = true;
        }
        if (profile.weburl && infoWebsite) {
            infoWebsite.href = profile.weburl;
            try {
                infoWebsite.textContent = new URL(profile.weburl).hostname.replace('www.', '');
            } catch(e) {
                infoWebsite.textContent = 'Website';
            }
            hasInfo = true;
        }
        if (hasInfo) infoBar.style.display = '';
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

    // 52-Week Date Annotations
    const highDateEl = document.getElementById('metric-52w-high-date');
    const lowDateEl = document.getElementById('metric-52w-low-date');
    if (highDateEl && metricData['52WeekHighDate']) {
        highDateEl.textContent = new Date(metricData['52WeekHighDate']).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    if (lowDateEl && metricData['52WeekLowDate']) {
        lowDateEl.textContent = new Date(metricData['52WeekLowDate']).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

    // Analyst Recommendation Trend (Historical)
    const trendWrap = document.getElementById('analyst-trend-chart-wrap');
    const trendBars = document.getElementById('analyst-trend-bars');
    if (trendWrap && trendBars && Array.isArray(recommendations) && recommendations.length > 1) {
        const history = recommendations.slice(0, 6).reverse(); // oldest to newest, max 6 months
        trendBars.innerHTML = history.map(r => {
            const sb = r.strongBuy || 0;
            const b = r.buy || 0;
            const h = r.hold || 0;
            const s = r.sell || 0;
            const ss = r.strongSell || 0;
            const total = sb + b + h + s + ss;
            if (total === 0) return '';
            const buyPct = ((sb + b) / total) * 100;
            const holdPct = (h / total) * 100;
            const sellPct = ((s + ss) / total) * 100;
            const month = r.period ? new Date(r.period).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : '?';
            return `
                <div class="trend-bar-col">
                    <div class="trend-stacked-bar">
                        <div class="trend-seg buy" style="height:${buyPct}%" title="Buy: ${sb+b}"></div>
                        <div class="trend-seg hold" style="height:${holdPct}%" title="Hold: ${h}"></div>
                        <div class="trend-seg sell" style="height:${sellPct}%" title="Sell: ${s+ss}"></div>
                    </div>
                    <span class="trend-month-label">${month}</span>
                </div>
            `;
        }).join('');
        trendWrap.style.display = '';
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
        let deVal = metricData.debtToEquityAnnual ?? metricData['totalDebt/totalEquityAnnual'] ?? metricData['totalDebt/totalEquityQuarterly'] ?? metricData.totalDebtToEquity;
        if (deVal == null && bs) {
            const bsData = bs?.balance_sheet?.[0] || {};
            const shortDebt = Number(bsData.short_term_debt || bsData.shortTermDebt || 0);
            const longDebt = Number(bsData.long_term_debt || bsData.longTermDebt || 0);
            const totalDebt = shortDebt + longDebt;
            const equity = Number(bsData.total_shareholders_equity || bsData.totalEquity || bsData.totalShareholdersEquity || 0);
            if (equity > 0 && totalDebt > 0) {
                deVal = totalDebt / equity;
            }
        }

        const ratios = [
            { label: 'P/E Ratio', value: formatValue(metricData.peTTM), type: 'pe' },
            { label: 'P/B Ratio', value: formatValue(metricData.pbAnnual), type: 'pb' },
            { label: 'P/S Ratio', value: formatValue(metricData.psTTM), type: 'ps' },
            { label: 'ROE', value: formatValue(metricData.roeTTM) + '%', type: 'percentage_high' },
            { label: 'ROA', value: formatValue(metricData.roaTTM) + '%', type: 'percentage_high' },
            { label: 'Net Margin', value: formatValue(metricData.netProfitMarginTTM) + '%', type: 'percentage_high' },
            { label: 'Current Ratio', value: formatValue(metricData.currentRatioAnnual), type: 'current_ratio' },
            { label: 'Debt/Equity', value: formatValue(deVal), type: 'debt_equity' },
            { label: 'Revenue Growth 5Y', value: formatValue(metricData.revenueGrowth5Y) + '%', type: 'percentage_high' },
            { label: 'EPS Growth 5Y', value: formatValue(metricData.epsGrowth5Y) + '%', type: 'percentage_high' },
            { label: 'Dividend Yield', value: formatValue(metricData.dividendYieldIndicatedAnnual) + '%', type: 'dividend' },
            { label: 'Gross Margin', value: formatValue(metricData.grossMarginTTM) + '%', type: 'percentage_high' },
            { label: 'Operating Margin', value: formatValue(metricData.operatingMarginTTM) + '%', type: 'percentage_high' },
            { label: 'EV/EBITDA', value: formatValue(metricData.evToEbitda ?? metricData.evEbitda), type: 'pe' },
            { label: 'Quick Ratio', value: formatValue(metricData.quickRatioAnnual), type: 'current_ratio' }
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
            <tr><td>Total Revenue</td><td class="num-col font-mono">${formatLargeCurrency(incData.total_revenue ?? incData.totalRevenue ?? null)}</td></tr>
            <tr><td>Cost of Revenue</td><td class="num-col font-mono">${formatLargeCurrency(incData.cost_of_revenue ?? incData.costOfRevenue ?? null)}</td></tr>
            <tr><td>Gross Profit</td><td class="num-col font-mono">${formatLargeCurrency(incData.gross_profit ?? incData.grossProfit ?? null)}</td></tr>
            <tr><td>Operating Income</td><td class="num-col font-mono">${formatLargeCurrency(incData.operating_income ?? incData.operatingIncome ?? null)}</td></tr>
            <tr><td>EBITDA</td><td class="num-col font-mono">${formatLargeCurrency(incData.ebitda ?? null)}</td></tr>
            <tr><td>Net Income</td><td class="num-col font-mono">${formatLargeCurrency(incData.net_income ?? incData.netIncome ?? null)}</td></tr>
            <tr><td>EPS (Diluted)</td><td class="num-col font-mono">${incData.eps_diluted ? '$' + parseFloat(incData.eps_diluted).toFixed(2) : '--'}</td></tr>
        `;
    }

    // Balance Sheet Tab Table
    const bsTable = document.getElementById('balance-sheet-table-body');
    if (bsTable) {
        const bsData = bs?.balance_sheet?.[0] || {};
        bsTable.innerHTML = `
            <tr><td>Cash & Equivalents</td><td class="num-col font-mono">${formatLargeCurrency(bsData.cash_and_equivalents ?? bsData.cashAndEquivalents ?? null)}</td></tr>
            <tr><td>Total Current Assets</td><td class="num-col font-mono">${formatLargeCurrency(bsData.total_current_assets ?? bsData.totalCurrentAssets ?? null)}</td></tr>
            <tr><td>Total Assets</td><td class="num-col font-mono">${formatLargeCurrency(bsData.total_assets ?? bsData.totalAssets ?? null)}</td></tr>
            <tr><td>Short-term Debt</td><td class="num-col font-mono">${formatLargeCurrency(bsData.short_term_debt ?? bsData.shortTermDebt ?? null)}</td></tr>
            <tr><td>Long-term Debt</td><td class="num-col font-mono">${formatLargeCurrency(bsData.long_term_debt ?? bsData.longTermDebt ?? null)}</td></tr>
            <tr><td>Total Liabilities</td><td class="num-col font-mono">${formatLargeCurrency(bsData.total_liabilities ?? bsData.totalLiabilities ?? null)}</td></tr>
            <tr><td>Total Shareholders' Equity</td><td class="num-col font-mono">${formatLargeCurrency(bsData.total_shareholders_equity ?? bsData.totalEquity ?? bsData.totalShareholdersEquity ?? null)}</td></tr>
        `;
    }

    // Cash Flow Tab Table
    const cfTable = document.getElementById('cashflow-table-body');
    if (cfTable) {
        const cfData = cf?.cash_flow?.[0] || {};
        const ocf = cfData.operating_cash_flow ?? cfData.operatingCashFlow ?? null;
        const capex = cfData.capital_expenditures ?? cfData.capitalExpenditures ?? cfData.capitalExpenditure ?? null;
        const fcf = (ocf != null && capex != null) ? ocf - capex : null;
        cfTable.innerHTML = `
            <tr><td>Operating Cash Flow</td><td class="num-col font-mono">${formatLargeCurrency(ocf)}</td></tr>
            <tr><td>Capital Expenditures</td><td class="num-col font-mono">${formatLargeCurrency(capex)}</td></tr>
            <tr><td>Free Cash Flow</td><td class="num-col font-mono">${formatLargeCurrency(fcf)}</td></tr>
            <tr><td>Investing Cash Flow</td><td class="num-col font-mono">${formatLargeCurrency(cfData.investing_cash_flow ?? cfData.investingCashFlow ?? null)}</td></tr>
            <tr><td>Financing Cash Flow</td><td class="num-col font-mono">${formatLargeCurrency(cfData.financing_cash_flow ?? cfData.financingCashFlow ?? null)}</td></tr>
            <tr><td>Net Change in Cash</td><td class="num-col font-mono">${formatLargeCurrency(cfData.net_change_in_cash ?? cfData.netChangeInCash ?? null)}</td></tr>
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
    const container = document.getElementById('equityHistoricalChart');
    if (!container || !data || data.length === 0) return;

    // Clean up previous chart instance
    if (equityChartInstance) {
        if (equityChartInstance._resizeObserver) {
            equityChartInstance._resizeObserver.disconnect();
        }
        equityChartInstance.remove();
        equityChartInstance = null;
    }
    container.innerHTML = '';

    const isCandlestick = chartMode === 'candlestick';
    const prices = data.map(v => parseFloat(v.close));
    const isPositive = prices[prices.length - 1] >= prices[0];
    const accentColor = isPositive ? '#10b981' : '#ef4444';

    // Guarantee chart gets correct dimensions (safety net for any edge-case timing)
    const containerW = container.clientWidth || container.offsetWidth || 800;
    const containerH = container.clientHeight || container.offsetHeight || 420;

    // Create chart — premium Groww/TradingView aesthetic config
    const chart = LightweightCharts.createChart(container, {
        width: containerW,
        height: containerH,
        layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: '#64748b',
            fontFamily: "'JetBrains Mono', 'Inter', -apple-system, sans-serif",
            fontSize: 11,
        },
        grid: {
            vertLines: { visible: isCandlestick, color: 'rgba(255,255,255,0.02)', style: LightweightCharts.LineStyle.Solid },
            horzLines: { visible: isCandlestick, color: 'rgba(255,255,255,0.02)', style: LightweightCharts.LineStyle.Solid },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: {
                color: 'rgba(56, 189, 248, 0.5)',
                width: 1,
                style: LightweightCharts.LineStyle.Dashed,
                labelBackgroundColor: '#0f172a',
            },
            horzLine: {
                color: 'rgba(56, 189, 248, 0.5)',
                width: 1,
                style: LightweightCharts.LineStyle.Dashed,
                labelBackgroundColor: '#0f172a',
            },
        },
        rightPriceScale: {
            borderColor: 'transparent',
            scaleMargins: { top: 0.06, bottom: 0.12 },
            textColor: '#64748b',
        },
        timeScale: {
            borderColor: 'transparent',
            timeVisible: true,
            secondsVisible: false,
            fixLeftEdge: true,
            fixRightEdge: true,
            tickMarkFormatter: (time) => {
                const d = typeof time === 'string' ? new Date(time) : new Date(time * 1000);
                return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
            },
        },
        handleScroll: { vertTouchDrag: false, mouseWheel: true, pressedMouseMove: true },
        handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });

    // Main price series
    let mainSeries;
    if (isCandlestick) {
        mainSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: '#00d09c',
            downColor: '#ff6b6b',
            borderUpColor: '#00d09c',
            borderDownColor: '#ff6b6b',
            wickUpColor: '#00d09c',
            wickDownColor: '#ff6b6b',
        });
        // Deduplicate candle data too
        const candleSeen = new Set();
        const candleData = data
            .filter(v => { if (candleSeen.has(v.datetime)) return false; candleSeen.add(v.datetime); return true; })
            .map(v => ({
                time: v.datetime,
                open: parseFloat(v.open || v.close),
                high: parseFloat(v.high || v.close),
                low: parseFloat(v.low || v.close),
                close: parseFloat(v.close),
            }));
        mainSeries.setData(candleData);
    } else if (chartMode === 'bar') {
        mainSeries = chart.addSeries(LightweightCharts.BarSeries, {
            upColor: '#00d09c',
            downColor: '#ff6b6b',
            openVisible: true,
            thinBars: false,
        });
        const barSeen = new Set();
        const barData = data
            .filter(v => { if (barSeen.has(v.datetime)) return false; barSeen.add(v.datetime); return true; })
            .map(v => ({
                time: v.datetime,
                open: parseFloat(v.open || v.close),
                high: parseFloat(v.high || v.close),
                low: parseFloat(v.low || v.close),
                close: parseFloat(v.close),
            }));
        mainSeries.setData(barData);
    } else {
        mainSeries = chart.addSeries(LightweightCharts.AreaSeries, {
            topColor: isPositive ? 'rgba(0, 208, 156, 0.32)' : 'rgba(255, 75, 75, 0.32)',
            bottomColor: isPositive ? 'rgba(0, 208, 156, 0.0)' : 'rgba(255, 75, 75, 0.0)',
            lineColor: isPositive ? '#00d09c' : '#ff4b4b',
            lineWidth: 2.5,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 5,
            crosshairMarkerBorderColor: '#ffffff',
            crosshairMarkerBorderWidth: 2,
            crosshairMarkerBackgroundColor: isPositive ? '#00d09c' : '#ff4b4b',
        });
        const lineData = data.map(v => ({
            time: v.datetime,
            value: parseFloat(v.close),
        }));
        mainSeries.setData(lineData);
    }

    // Current price line
    const lastPrice = prices[prices.length - 1];
    mainSeries.createPriceLine({
        price: lastPrice,
        color: isPositive ? '#00d09c' : '#ff6b6b',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: '',
    });

    // Volume histogram series
    const volumeData = data.map((v, i) => {
        const currClose = parseFloat(v.close);
        const prevClose = i > 0 ? parseFloat(data[i - 1].close) : currClose;
        return {
            time: v.datetime,
            value: parseFloat(v.volume || 0),
            color: currClose >= prevClose ? 'rgba(0, 208, 156, 0.22)' : 'rgba(255, 107, 107, 0.22)',
        };
    });

    const volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
    });
    volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeries.setData(volumeData);

    // ── % Return Label (top-left overlay, zero API calls) ────────────────────
    const firstPrice = prices[0];
    const returnPct = ((lastPrice - firstPrice) / firstPrice * 100);
    const returnSign = returnPct >= 0 ? '+' : '';
    const returnStr = `${returnPct >= 0 ? '▲' : '▼'} ${returnSign}${returnPct.toFixed(2)}%`;
    let returnLabel = container.querySelector('.chart-return-label');
    if (!returnLabel) {
        returnLabel = document.createElement('div');
        container.appendChild(returnLabel);
    }
    returnLabel.className = `chart-return-label ${isPositive ? 'positive' : 'negative'}`;
    returnLabel.textContent = returnStr;

    // ── STRATA Watermark (built-in LW Charts v5 API, zero cost) ─────────────
    try {
        LightweightCharts.createTextWatermark(chart.panes()[0], {
            horzAlign: 'center',
            vertAlign: 'center',
            lines: [{
                text: 'STRATA',
                color: 'rgba(255,255,255,0.022)',
                fontSize: 56,
                fontStyle: 'bold',
                fontFamily: "'Inter', 'JetBrains Mono', sans-serif",
            }],
        });
    } catch (e) { /* watermark is optional */ }

    // Floating OHLC tooltip (Zerodha-style)
    const toolTipEl = document.createElement('div');
    toolTipEl.className = 'lw-chart-tooltip';
    container.appendChild(toolTipEl);

    chart.subscribeCrosshairMove(param => {
        if (!param || !param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
            toolTipEl.style.display = 'none';
            return;
        }

        const priceData = param.seriesData.get(mainSeries);
        const volData = param.seriesData.get(volumeSeries);
        if (!priceData) { toolTipEl.style.display = 'none'; return; }

        let tooltipHtml = '';
        const d = typeof param.time === 'string' ? new Date(param.time) : new Date(param.time * 1000);
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const volStr = volData ? volData.value.toLocaleString() : '—';

        if (isCandlestick && priceData.open !== undefined) {
            const chg = priceData.close - priceData.open;
            const chgPct = ((chg / priceData.open) * 100).toFixed(2);
            const chgClass = chg >= 0 ? 'tt-positive' : 'tt-negative';
            tooltipHtml = `
                <div class="tt-date">${dateStr}</div>
                <div class="tt-row"><span class="tt-label">O</span><span class="tt-val">$${priceData.open.toFixed(2)}</span></div>
                <div class="tt-row"><span class="tt-label">H</span><span class="tt-val">$${priceData.high.toFixed(2)}</span></div>
                <div class="tt-row"><span class="tt-label">L</span><span class="tt-val">$${priceData.low.toFixed(2)}</span></div>
                <div class="tt-row"><span class="tt-label">C</span><span class="tt-val ${chgClass}">$${priceData.close.toFixed(2)}</span></div>
                <div class="tt-row"><span class="tt-label">Chg</span><span class="tt-val ${chgClass}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)} (${chg >= 0 ? '+' : ''}${chgPct}%)</span></div>
                <div class="tt-row tt-vol"><span class="tt-label">Vol</span><span class="tt-val">${volStr}</span></div>
            `;
        } else {
            const val = priceData.value !== undefined ? priceData.value : priceData.close;
            tooltipHtml = `
                <div class="tt-date">${dateStr}</div>
                <div class="tt-row"><span class="tt-label">Price</span><span class="tt-val">$${val.toFixed(2)}</span></div>
                <div class="tt-row tt-vol"><span class="tt-label">Vol</span><span class="tt-val">${volStr}</span></div>
            `;
        }

        if (equityIndicatorManager) {
            tooltipHtml += equityIndicatorManager.getTooltipData(param);
        }

        toolTipEl.innerHTML = tooltipHtml;
        toolTipEl.style.display = 'block';

        const chartRect = container.getBoundingClientRect();
        const tooltipWidth = 160;
        const tooltipHeight = toolTipEl.offsetHeight || 120;
        let left = param.point.x + 16;
        let top = param.point.y - tooltipHeight / 2;

        if (left + tooltipWidth > chartRect.width) left = param.point.x - tooltipWidth - 16;
        if (top < 0) top = 4;
        if (top + tooltipHeight > chartRect.height) top = chartRect.height - tooltipHeight - 4;

        toolTipEl.style.left = left + 'px';
        toolTipEl.style.top = top + 'px';
    });

    // Fit content
    chart.timeScale().fitContent();

    // Responsive resize — also do an immediate size sync in case clientWidth changed
    const resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) {
                chart.applyOptions({ width, height });
                chart.timeScale().fitContent();
            }
        }
    });
    resizeObserver.observe(container);

    // Double-safety: force explicit size after next two frames in case layout shifts
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const w = container.clientWidth;
            const h = container.clientHeight;
            if (w > 0 && h > 0) {
                chart.applyOptions({ width: w, height: h });
                chart.timeScale().fitContent();
            }
        });
    });

    equityChartInstance = chart;
    // Store the observer so we can clean it up later
    equityChartInstance._resizeObserver = resizeObserver;

    // Initialize IndicatorManager
    equityIndicatorManager = new IndicatorManager(chart, mainSeries, volumeSeries);
    // Re-apply checked indicators if redrawing
    const menu = document.getElementById('equity-indicator-menu');
    if (menu) {
        menu.querySelectorAll('input').forEach(input => {
            if (input.checked) {
                equityIndicatorManager.active[input.value] = false;
                equityIndicatorManager.toggle(input.value, data);
            }
        });
    }
}



function setupChartModeToggle() {
    const toggle = document.getElementById('chart-mode-toggle');
    if (!toggle) return;

    toggle.querySelectorAll('.chart-mode-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const mode = btn.getAttribute('data-mode');
            if (mode === chartMode) return;

            chartMode = mode;
            toggle.querySelectorAll('.chart-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (rawHistoricalData.length > 0) {
                renderEquityChart(rawHistoricalData);
            }
        });
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
        
        // Market Status Badge
        const statusDot = document.getElementById('market-status-dot');
        const statusText = document.getElementById('market-status-text');
        if (statusDot && statusText) {
            const state = payload?.sp500?.marketState || payload?.nasdaq?.marketState || 'REGULAR';
            const stateMap = {
                'REGULAR': { text: 'Market Open', cls: 'status-open' },
                'PRE': { text: 'Pre-Market', cls: 'status-pre' },
                'POST': { text: 'After-Hours', cls: 'status-post' },
                'POSTPOST': { text: 'Market Closed', cls: 'status-closed' },
                'PREPRE': { text: 'Market Closed', cls: 'status-closed' },
                'CLOSED': { text: 'Market Closed', cls: 'status-closed' }
            };
            const info = stateMap[state] || stateMap['REGULAR'];
            statusText.textContent = info.text;
            statusDot.className = `market-status-dot ${info.cls}`;
            const strip = document.getElementById('market-status-strip');
            if (strip) strip.className = `market-status-strip ${info.cls}`;
        }

        const formatIndexValue = (value) => {
            const num = parseFloat(value);
            return Number.isFinite(num) ? num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';
        };
        const formatChange = (value, percentage) => {
            const valNum = parseFloat(value);
            const pctNum = parseFloat(percentage);
            if (!Number.isFinite(valNum) || !Number.isFinite(pctNum)) return '--';
            const sign = valNum >= 0 ? '+' : '';
            return `${sign}${valNum.toFixed(2)} (${sign}${pctNum.toFixed(2)}%)`;
        };
        const formatSource = (item, fallback) => {
            const symbol = item.symbol || item.requestedSymbol || fallback;
            return item.source ? `${symbol} - ${item.source}` : symbol;
        };

        if (payload?.sp500 && payload.sp500.price != null) {
            spValue && (spValue.innerText = formatIndexValue(payload.sp500.price));
            spSource && (spSource.innerText = formatSource(payload.sp500, 'S&P 500'));
            if (spChange) {
                spChange.innerText = formatChange(payload.sp500.change, payload.sp500.changePercent);
                spChange.className = 'index-change ' + (payload.sp500.change >= 0 ? 'pos-change' : 'neg-change');
            }
        } else if (spSource) {
            spSource.innerText = 'Unavailable';
        }

        if (payload?.nasdaq && payload.nasdaq.price != null) {
            nasValue && (nasValue.innerText = formatIndexValue(payload.nasdaq.price));
            nasSource && (nasSource.innerText = formatSource(payload.nasdaq, 'NASDAQ'));
            if (nasChange) {
                nasChange.innerText = formatChange(payload.nasdaq.change, payload.nasdaq.changePercent);
                nasChange.className = 'index-change ' + (payload.nasdaq.change >= 0 ? 'pos-change' : 'neg-change');
            }
        } else if (nasSource) {
            nasSource.innerText = 'Unavailable';
        }

        if (payload?.dowjones && payload.dowjones.price != null) {
            dowValue && (dowValue.innerText = formatIndexValue(payload.dowjones.price));
            dowSource && (dowSource.innerText = formatSource(payload.dowjones, 'DOW'));
            if (dowChange) {
                dowChange.innerText = formatChange(payload.dowjones.change, payload.dowjones.changePercent);
                dowChange.className = 'index-change ' + (payload.dowjones.change >= 0 ? 'pos-change' : 'neg-change');
            }
        } else if (dowSource) {
            dowSource.innerText = 'Unavailable';
        }
        return payload;
    } catch (error) {
        console.warn('Failed to load live index values:', error);
        if (spSource) spSource.innerText = 'Unavailable';
        if (nasSource) nasSource.innerText = 'Unavailable';
        if (dowSource) dowSource.innerText = 'Unavailable';
        return null;
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
        
        const tickerPills = item.related ? item.related.split(',').filter(t => t.trim()).slice(0, 3).map(t => 
            `<span class="news-ticker-pill" data-symbol="${t.trim()}">${t.trim()}</span>`
        ).join('') : '';

        return `
            <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="news-card">
                <div class="news-thumbnail" style="background-image: url('${imageUrl}')"></div>
                <div class="news-content">
                    <div class="news-meta">
                        <span class="news-source">${escapeHtml(item.source)}</span>
                        <span class="news-date">${date}</span>
                    </div>
                    <h4 class="news-headline">${escapeHtml(item.headline)}</h4>
                    <p class="news-summary">${item.summary ? escapeHtml(item.summary.substring(0, 100)) + '...' : ''}</p>
                    ${tickerPills ? `<div class="news-ticker-pills">${tickerPills}</div>` : ''}
                </div>
            </a>
        `;
    }).join('');

    // Add click handlers for news ticker pills
    grid.querySelectorAll('.news-ticker-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const symbol = pill.getAttribute('data-symbol');
            if (symbol) {
                window.location.href = `equity-details.html?symbol=${encodeURIComponent(symbol)}`;
            }
        });
    });
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

function setupEquityDashboardTabs() {
    const tabBtns = document.querySelectorAll('.equity-tab-btn');
    const panels = document.querySelectorAll('.equity-tab-panel');

    if (!tabBtns.length) return;

    tabBtns.forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const targetTab = btn.getAttribute('data-tab');

            tabBtns.forEach((b) => {
                const isActive = b === btn;
                b.classList.toggle('active', isActive);
                b.setAttribute('aria-selected', isActive ? 'true' : 'false');
            });

            panels.forEach((panel) => {
                const isTarget = panel.id === `tab-${targetTab}-content`;
                panel.classList.toggle('active', isTarget);
            });
        });
    });
}

async function fetchMarketMovers() {
    const gainersTbody = document.querySelector('.gainers-card tbody');
    const losersTbody = document.querySelector('.losers-card tbody');

    if (!gainersTbody && !losersTbody) return;

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/fmp/movers`);
        const data = await safeJsonParse(response);

        if (!data) {
            if (gainersTbody) gainersTbody.innerHTML = '<tr><td colspan="4" class="table-empty-state">Market movers unavailable</td></tr>';
            if (losersTbody) losersTbody.innerHTML = '<tr><td colspan="4" class="table-empty-state">Market movers unavailable</td></tr>';
            return;
        }

        if (data._isFallback) {
            const badge = document.querySelector('.movers-fallback-badge');
            if (badge) badge.style.display = 'inline-flex';
        }

        const formatVol = (num) => {
            if (!num || isNaN(num)) return '--';
            if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
            if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
            if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
            return num.toString();
        };

        const renderTableRows = (tbody, list, isPositive) => {
            if (!tbody || !Array.isArray(list) || !list.length) return;
            
            tbody.innerHTML = list.map((item) => {
                const sym = item.symbol || '';
                const name = item.name || sym;
                const pct = typeof item.changesPercentage === 'number' ? item.changesPercentage : 0;
                const pctStr = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
                const textClass = isPositive ? 'positive-text' : (pct < 0 ? 'negative-text' : 'positive-text');

                const priceStr = item.price != null ? `$${parseFloat(item.price).toFixed(2)}` : '--';
                const volStr = formatVol(item.volume);

                return `
                    <tr class="movers-row" data-symbol="${sym}" title="Click to view full analysis for ${sym}">
                        <td class="company-cell">
                            <span class="symbol-tag font-mono">${sym}</span>
                            <span class="company-name-text">${name}</span>
                        </td>
                        <td class="num-col font-mono">${priceStr}</td>
                        <td class="num-col font-mono ${textClass}">${pctStr}</td>
                        <td class="num-col font-mono movers-vol-col">${volStr}</td>
                    </tr>
                `;
            }).join('');

            tbody.querySelectorAll('.movers-row').forEach((row) => {
                row.onclick = (e) => {
                    e.preventDefault();
                    const symbol = row.getAttribute('data-symbol');
                    if (symbol) {
                        window.location.href = `equity-details.html?symbol=${encodeURIComponent(symbol)}`;
                    }
                };
            });
        };

        if (data.gainers && gainersTbody) {
            renderTableRows(gainersTbody, data.gainers, true);
        }
        if (data.losers && losersTbody) {
            renderTableRows(losersTbody, data.losers, false);
        }
        return data;
    } catch (err) {
        console.warn('Failed to fetch market movers:', err);
        return null;
    }
}

export async function fetchSectorPerformance() {
    const gridEl = document.getElementById('sector-heatmap-grid');
    if (!gridEl) return;

    const sectorIcons = {
        'Technology': 'fa-laptop-code',
        'Energy': 'fa-bolt',
        'Financial Services': 'fa-building-columns',
        'Financials': 'fa-building-columns',
        'Healthcare': 'fa-notes-medical',
        'Consumer Cyclical': 'fa-bag-shopping',
        'Industrials': 'fa-industry',
        'Communication Services': 'fa-tower-cell',
        'Utilities': 'fa-plug',
        'Consumer Defensive': 'fa-cart-shopping',
        'Real Estate': 'fa-city',
        'Basic Materials': 'fa-gem'
    };

    try {
        const res = await fetchWithTimeout(`${BACKEND_URL}/api/fmp/sectors`, { timeout: 8000 });
        const data = await safeJsonParse(res);

        if (!data || !Array.isArray(data.sectors) || !data.sectors.length) return;

        // Sort by performance descending (best first)
        const sorted = [...data.sectors].sort((a, b) => {
            const aP = typeof a.changesPercentage === 'number' ? a.changesPercentage : 0;
            const bP = typeof b.changesPercentage === 'number' ? b.changesPercentage : 0;
            return bP - aP;
        });

        // Find max absolute change for bar scaling
        const maxAbs = Math.max(...sorted.map(s => Math.abs(typeof s.changesPercentage === 'number' ? s.changesPercentage : 0)), 1);

        const rows = sorted.map((sec, idx) => {
            const name = sec.sector || 'Other';
            const pct = typeof sec.changesPercentage === 'number' ? sec.changesPercentage : 0;
            const isPos = pct >= 0;
            const pctStr = `${isPos ? '+' : ''}${pct.toFixed(2)}%`;
            const iconClass = sectorIcons[name] || 'fa-chart-pie';
            const barWidth = Math.min((Math.abs(pct) / maxAbs) * 100, 100);
            const colorClass = isPos ? 'spt-positive' : 'spt-negative';

            return `
                <tr class="spt-row">
                    <td class="spt-rank">${idx + 1}</td>
                    <td class="spt-sector-cell">
                        <span class="spt-icon-box"><i class="fa-solid ${iconClass}"></i></span>
                        <span class="spt-sector-name">${name}</span>
                    </td>
                    <td class="spt-change ${colorClass}">${pctStr}</td>
                    <td class="spt-bar-cell">
                        <div class="spt-bar-track">
                            <div class="spt-bar-fill ${colorClass}" style="width: ${barWidth}%"></div>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        gridEl.innerHTML = `
            <table class="sector-pro-table">
                <thead>
                    <tr>
                        <th class="spt-th-rank">#</th>
                        <th class="spt-th-sector">Sector</th>
                        <th class="spt-th-change">Change</th>
                        <th class="spt-th-bar">Performance</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
        return data;
    } catch (err) {
        console.warn('Failed to fetch sector performance:', err);
        return null;
    }
}

function setupSectorMinimizer() {
    const btn = document.getElementById('toggle-sector-btn');
    const grid = document.getElementById('sector-heatmap-grid');
    if (!btn || !grid) return;

    btn.onclick = (e) => {
        e.preventDefault();
        const isCollapsed = grid.classList.toggle('collapsed-sector-grid');
        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = isCollapsed ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
        }
        btn.setAttribute('aria-expanded', !isCollapsed);
    };
}

// --- Market Sentiment Gauge ---
async function computeMarketSentiment(indexPayload, moversPayload, sectorPayload) {
    const needle = document.getElementById('sentiment-needle');
    const scoreEl = document.getElementById('sentiment-score-value');
    const labelEl = document.getElementById('sentiment-score-label');
    const sfIndex = document.querySelector('#sf-index .sf-value');
    const sfMovers = document.querySelector('#sf-movers .sf-value');
    const sfSectors = document.querySelector('#sf-sectors .sf-value');

    if (!needle || !scoreEl || !labelEl) return;

    try {
        let indexScore = 50; // default neutral
        let moversScore = 50;
        let sectorScore = 50;

        // 1. INDEX MOMENTUM (weight: 40%)
        // Average the percent changes of S&P 500, NASDAQ, DOW
        const indexData = indexPayload;
        const changes = [];
        if (indexData) {
            const extractPct = (item) => {
                if (!item) return null;
                const val = parseFloat(item.changePercent);
                return Number.isFinite(val) ? val : null;
            };

            const spPct = extractPct(indexData.sp500);
            const nasPct = extractPct(indexData.nasdaq);
            const dowPct = extractPct(indexData.dowjones);

            if (spPct !== null) changes.push(spPct);
            if (nasPct !== null) changes.push(nasPct);
            if (dowPct !== null) changes.push(dowPct);
        }

        if (changes.length > 0) {
            const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
            // Map -3% to +3% range into 0-100
            indexScore = Math.min(100, Math.max(0, ((avgChange + 3) / 6) * 100));
            if (sfIndex) {
                const sign = avgChange > 0 ? '+' : '';
                sfIndex.textContent = `${sign}${avgChange.toFixed(2)}%`;
                sfIndex.className = `sf-value ${avgChange > 0 ? 'sf-positive' : (avgChange < 0 ? 'sf-negative' : 'sf-neutral')}`;
            }
        } else if (sfIndex) {
            sfIndex.textContent = '0.00%';
            sfIndex.className = 'sf-value sf-neutral';
        }

        // 2. GAINERS vs LOSERS RATIO (weight: 30%)
        const moversData = moversPayload;
        if (moversData) {
            const gCount = Array.isArray(moversData.gainers) ? moversData.gainers.length : 0;
            const lCount = Array.isArray(moversData.losers) ? moversData.losers.length : 0;
            const total = gCount + lCount;
            if (total > 0) {
                moversScore = (gCount / total) * 100;
                if (sfMovers) {
                    sfMovers.textContent = `${gCount}G / ${lCount}L`;
                    sfMovers.className = `sf-value ${gCount > lCount ? 'sf-positive' : (gCount < lCount ? 'sf-negative' : 'sf-neutral')}`;
                }
            } else if (sfMovers) {
                sfMovers.textContent = 'Neutral';
                sfMovers.className = 'sf-value sf-neutral';
            }
        } else if (sfMovers) {
            sfMovers.textContent = 'Neutral';
            sfMovers.className = 'sf-value sf-neutral';
        }

        // 3. SECTOR BREADTH (weight: 30%)
        // Count sectors with positive vs negative changes
        const sectorData = sectorPayload;
        if (sectorData && Array.isArray(sectorData.sectors)) {
            const posCount = sectorData.sectors.filter(s => (s.changesPercentage || 0) >= 0).length;
            const totalSectors = sectorData.sectors.length;
            if (totalSectors > 0) {
                sectorScore = (posCount / totalSectors) * 100;
                if (sfSectors) {
                    sfSectors.textContent = `${posCount}/${totalSectors} positive`;
                    sfSectors.className = `sf-value ${posCount > totalSectors / 2 ? 'sf-positive' : (posCount < totalSectors / 2 ? 'sf-negative' : 'sf-neutral')}`;
                }
            } else if (sfSectors) {
                sfSectors.textContent = 'Neutral';
                sfSectors.className = 'sf-value sf-neutral';
            }
        } else if (sfSectors) {
            sfSectors.textContent = 'Neutral';
            sfSectors.className = 'sf-value sf-neutral';
        }

        // Weighted composite score (0-100)
        const composite = Math.round(indexScore * 0.4 + moversScore * 0.3 + sectorScore * 0.3);

        // Map score to label and color
        let sentimentLabel, sentimentClass;
        if (composite <= 20) { sentimentLabel = 'Extreme Fear'; sentimentClass = 'extreme-fear'; }
        else if (composite <= 40) { sentimentLabel = 'Fear'; sentimentClass = 'fear'; }
        else if (composite <= 60) { sentimentLabel = 'Neutral'; sentimentClass = 'neutral'; }
        else if (composite <= 80) { sentimentLabel = 'Greed'; sentimentClass = 'greed'; }
        else { sentimentLabel = 'Extreme Greed'; sentimentClass = 'extreme-greed'; }

        // Update score display
        scoreEl.textContent = composite;
        labelEl.textContent = sentimentLabel;
        labelEl.className = `sentiment-score-label ${sentimentClass}`;

        // Rotate needle: 0 = -90deg (left), 100 = +90deg (right)
        const angle = -90 + (composite / 100) * 180;
        needle.setAttribute('transform', `rotate(${angle}, 100, 100)`);

    } catch (err) {
        console.warn('Failed to compute market sentiment:', err);
        scoreEl.textContent = '--';
        labelEl.textContent = 'Unavailable';
    }
}

// --- Earnings History ---
async function fetchAndRenderEarnings(ticker) {
    const tbody = document.getElementById('earnings-table-body');
    if (!tbody) return;

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/finnhub/earnings?symbol=${encodeURIComponent(ticker)}`);
        const data = await safeJsonParse(response);

        if (!Array.isArray(data) || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="table-empty-state">No earnings data available.</td></tr>';
            return;
        }

        tbody.innerHTML = data.map(e => {
            const quarter = `${e.period || '--'}`;
            const actual = e.actual != null ? `$${parseFloat(e.actual).toFixed(2)}` : '--';
            const estimate = e.estimate != null ? `$${parseFloat(e.estimate).toFixed(2)}` : '--';
            const surprise = e.surprisePercent != null ? parseFloat(e.surprisePercent).toFixed(2) + '%' : '--';
            const surpriseClass = e.surprisePercent > 0 ? 'pos-change' : (e.surprisePercent < 0 ? 'neg-change' : '');
            const icon = e.surprisePercent > 0 ? '▲' : (e.surprisePercent < 0 ? '▼' : '');
            return `
                <tr>
                    <td class="font-mono">${escapeHtml(quarter)}</td>
                    <td class="num-col font-mono">${actual}</td>
                    <td class="num-col font-mono">${estimate}</td>
                    <td class="num-col font-mono ${surpriseClass}">${icon} ${surprise}</td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.warn('Failed to load earnings:', err);
        tbody.innerHTML = '<tr><td colspan="4" class="table-empty-state">Failed to load earnings data.</td></tr>';
    }
}

// --- Dividend History ---
async function fetchAndRenderDividends(ticker) {
    const tbody = document.getElementById('dividends-table-body');
    const summaryEl = document.getElementById('dividends-summary');
    if (!tbody) return;

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/finnhub/dividends?symbol=${encodeURIComponent(ticker)}`);
        const data = await safeJsonParse(response);

        if (!Array.isArray(data) || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="table-empty-state">No dividend history — this company may not pay dividends.</td></tr>';
            if (summaryEl) summaryEl.innerHTML = '';
            return;
        }

        // Summary card
        if (summaryEl && data.length > 0) {
            const latestDiv = data[0];
            const annualTotal = data.filter(d => {
                const yr = new Date(d.payDate || d.date).getFullYear();
                return yr === new Date().getFullYear() || yr === new Date().getFullYear() - 1;
            }).reduce((sum, d) => sum + (d.amount || 0), 0);
            summaryEl.innerHTML = `
                <div class="kpi-summary-bar" style="margin-bottom: 16px;">
                    <div class="kpi-item"><span class="kpi-label">Latest Dividend</span><span class="kpi-value font-mono">$${parseFloat(latestDiv.amount || 0).toFixed(4)}</span></div>
                    <div class="kpi-item"><span class="kpi-label">Annual Total</span><span class="kpi-value font-mono">$${annualTotal.toFixed(4)}</span></div>
                    <div class="kpi-item"><span class="kpi-label">Frequency</span><span class="kpi-value font-mono">${data.length >= 16 ? 'Quarterly' : data.length >= 8 ? 'Semi-Annual' : 'Annual'}</span></div>
                </div>
            `;
        }

        tbody.innerHTML = data.slice(0, 20).map(d => {
            const exDate = d.date ? new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--';
            const payDate = d.payDate ? new Date(d.payDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--';
            const amount = d.amount != null ? `$${parseFloat(d.amount).toFixed(4)}` : '--';
            return `
                <tr>
                    <td class="font-mono">${exDate}</td>
                    <td class="font-mono">${payDate}</td>
                    <td class="num-col font-mono">${amount}</td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.warn('Failed to load dividends:', err);
        tbody.innerHTML = '<tr><td colspan="3" class="table-empty-state">Failed to load dividend data.</td></tr>';
    }
}

// --- Insider Transactions ---
async function fetchAndRenderInsider(ticker) {
    const tbody = document.getElementById('insider-table-body');
    if (!tbody) return;

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/finnhub/insider?symbol=${encodeURIComponent(ticker)}`);
        const data = await safeJsonParse(response);

        if (!Array.isArray(data) || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="table-empty-state">No insider transactions found.</td></tr>';
            return;
        }

        tbody.innerHTML = data.map(t => {
            const name = escapeHtml(t.name || 'Unknown');
            const date = t.transactionDate ? new Date(t.transactionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--';
            const type = (t.transactionType || t.transactionCode || '--');
            const isBuy = type.toLowerCase().includes('buy') || type.toLowerCase().includes('purchase') || type === 'P';
            const isSell = type.toLowerCase().includes('sell') || type.toLowerCase().includes('sale') || type === 'S';
            const typeLabel = isBuy ? 'Buy' : (isSell ? 'Sell' : type);
            const typeClass = isBuy ? 'pos-change' : (isSell ? 'neg-change' : '');
            const shares = t.share != null ? Math.abs(t.share).toLocaleString() : '--';
            const value = (t.share != null && t.transactionPrice != null) ? formatLargeCurrency(Math.abs(t.share * t.transactionPrice)) : '--';
            return `
                <tr>
                    <td>${name}</td>
                    <td class="font-mono">${date}</td>
                    <td class="font-mono ${typeClass}"><strong>${escapeHtml(typeLabel)}</strong></td>
                    <td class="num-col font-mono">${shares}</td>
                    <td class="num-col font-mono">${value}</td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.warn('Failed to load insider transactions:', err);
        tbody.innerHTML = '<tr><td colspan="5" class="table-empty-state">Failed to load insider data.</td></tr>';
    }
}



// --- Deep Dive Analytics ---
function setupAccordions() {
    document.querySelectorAll('.accordion-header').forEach(header => {
        header.addEventListener('click', () => {
            const accordion = header.parentElement;
            const section = accordion.id.replace('acc-', '');
            
            // Toggle
            const isOpen = accordion.classList.contains('open');
            document.querySelectorAll('.pro-accordion').forEach(a => a.classList.remove('open')); // Close others
            
            if (!isOpen) {
                accordion.classList.add('open');
                loadDeepDiveSection(section);
            }
        });
    });
}

const formatFinMoney = (val) => {
    if (val == null) return '--';
    if (Math.abs(val) >= 1e9) return $ + (val / 1e9).toFixed(2) + 'B';
    if (Math.abs(val) >= 1e6) return $ + (val / 1e6).toFixed(2) + 'M';
    if (Math.abs(val) >= 1e3) return $ + (val / 1e3).toFixed(2) + 'K';
    return $ + Number(val).toFixed(2);
};

const deepDiveState = { valuation: false, capalloc: false, 'earnings-qual': false, risk: false, segments: false };
let ddCharts = {};

async function loadDeepDiveSection(section) {
    if (!activeEquityTicker) return;
    if (deepDiveState[section]) return; // already loaded
    
    const loader = document.getElementById(loader- + section);
    const content = document.getElementById(content- + section);
    loader.style.display = 'flex';
    content.style.display = 'none';

    try {
        if (section === 'valuation') await fetchValuation(activeEquityTicker);
        if (section === 'capalloc') await fetchCapAlloc(activeEquityTicker);
        if (section === 'earnings-qual') await fetchEarningsQual(activeEquityTicker);
        if (section === 'risk') await fetchRisk(activeEquityTicker);
        if (section === 'segments') await fetchSegments(activeEquityTicker);
        
        deepDiveState[section] = true;
        loader.style.display = 'none';
        content.style.display = 'block';
    } catch(e) {
        loader.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#ef4444;"></i> Failed to load SEC/Provider data.';
    }
}

async function fetchValuation(ticker) {
    const res = await fetchWithTimeout(${BACKEND_URL}/api/analytics/valuation-history/);
    const data = await safeJsonParse(res);
    if(!data || !data.history) throw new Error('No data');
    
    // Sort chronological
    data.history.sort((a,b) => a.year - b.year);
    
    if(ddCharts['valuation']) ddCharts['valuation'].destroy();
    const ctx = document.getElementById('valChart').getContext('2d');
    
    ddCharts['valuation'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.history.map(h => h.year),
            datasets: [
                { label: 'P/E Ratio', data: data.history.map(h => h.pe), borderColor: '#3b82f6', tension: 0.4 },
                { label: 'P/S Ratio', data: data.history.map(h => h.ps), borderColor: '#10b981', tension: 0.4 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { color: '#94a3b8' } } },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
            }
        }
    });
}

async function fetchCapAlloc(ticker) {
    const res = await fetchWithTimeout(${BACKEND_URL}/api/sec/capital-allocation/);
    const data = await safeJsonParse(res);
    if(!data || !data.allocation || !data.allocation.length) throw new Error('No data');
    
    const latest = data.allocation[data.allocation.length - 1];
    document.getElementById('grid-capalloc').innerHTML = 
        <div class="fin-metric-card"><div class="fin-metric-label">CapEx (FY)</div><div class="fin-metric-val"></div></div>
        <div class="fin-metric-card"><div class="fin-metric-label">Stock Buybacks</div><div class="fin-metric-val"></div></div>
        <div class="fin-metric-card"><div class="fin-metric-label">Dividends Paid</div><div class="fin-metric-val"></div></div>
        <div class="fin-metric-card"><div class="fin-metric-label">Debt Issuance</div><div class="fin-metric-val"></div></div>
    ;
}

async function fetchEarningsQual(ticker) {
    const res = await fetchWithTimeout(${BACKEND_URL}/api/sec/earnings-quality/);
    const data = await safeJsonParse(res);
    if(!data || !data.quality) throw new Error('No data');
    
    const q = data.quality;
    const isGood = q.cashConversion && q.cashConversion > 0.8;
    const badge = isGood ? <span class="fin-badge good"><i class="fa-solid fa-check"></i> High Quality</span> : <span class="fin-badge warn"><i class="fa-solid fa-triangle-exclamation"></i> Review</span>;
    
    document.getElementById('grid-earnings-qual').innerHTML = 
        <div class="fin-metric-card"><div class="fin-metric-label">Cash Conversion (OCF/NI)</div><div class="fin-metric-val"></div></div>
        <div class="fin-metric-card"><div class="fin-metric-label">Accruals Ratio</div><div class="fin-metric-val"></div></div>
        <div class="fin-metric-card"><div class="fin-metric-label">Dilution (Share Change)</div><div class="fin-metric-val"></div></div>
        <div class="fin-metric-card"><div class="fin-metric-label">Quality Signal</div><div></div></div>
    ;
}

async function fetchRisk(ticker) {
    const [profRes, drawRes] = await Promise.all([
        fetchWithTimeout(${BACKEND_URL}/api/risk/profile/).catch(()=>null),
        fetchWithTimeout(${BACKEND_URL}/api/risk/drawdown/).catch(()=>null)
    ]);
    const prof = await safeJsonParse(profRes);
    const draw = await safeJsonParse(drawRes);
    
    if(prof && prof.summary) {
        const s = prof.summary;
        document.getElementById('grid-risk').innerHTML = 
            <div class="fin-metric-card"><div class="fin-metric-label">Ann. Volatility</div><div class="fin-metric-val">%</div></div>
            <div class="fin-metric-card"><div class="fin-metric-label">Beta vs SPY</div><div class="fin-metric-val"></div></div>
            <div class="fin-metric-card"><div class="fin-metric-label">Max Drawdown</div><div class="fin-metric-val" style="color:#ef4444;">%</div></div>
            <div class="fin-metric-card"><div class="fin-metric-label">Sharpe Ratio</div><div class="fin-metric-val"></div></div>
        ;
    }
    
    if(draw && draw.drawdownSeries) {
        if(ddCharts['risk']) ddCharts['risk'].destroy();
        const ctx = document.getElementById('drawdownChart').getContext('2d');
        ddCharts['risk'] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: draw.drawdownSeries.map(d => new Date(d.date).toLocaleDateString()),
                datasets: [{ label: 'Drawdown', data: draw.drawdownSeries.map(d => d.drawdown * 100), borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', fill: true, tension: 0.1, borderWidth: 1 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                elements: { point: { radius: 0 } },
                plugins: { legend: { display: false } },
                scales: {
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                    x: { grid: { display: false }, ticks: { display: false } }
                }
            }
        });
    }
}

async function fetchSegments(ticker) {
    const res = await fetchWithTimeout(${BACKEND_URL}/api/sec/segments/);
    const data = await safeJsonParse(res);
    if(!data || !data.segments || !data.segments.length) throw new Error('No data');
    
    document.getElementById('grid-segments').innerHTML = data.segments.slice(0,6).map(s => 
        <div class="fin-metric-card">
            <div class="fin-metric-label" style="text-transform:none;" title=""></div>
            <div class="fin-metric-val"></div>
        </div>
    ).join('');
}




window.toggleDeepDive = function(section) {
    const accordion = document.getElementById('acc-' + section);
    const isOpen = accordion.classList.contains('open');
    
    // Close others
    document.querySelectorAll('.pro-accordion').forEach(a => a.classList.remove('open'));
    
    if (!isOpen) {
        accordion.classList.add('open');
        loadDeepDiveSection(section);
    }
};

// Also remove setupAccordions call since we are using inline onclick to avoid double binding

