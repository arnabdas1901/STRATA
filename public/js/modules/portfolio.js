/**
 * STRATA Portfolio Workstation Engine (BlackRock Aladdin / Citadel PMS)
 * Multi-asset portfolio accounting, real-time mark-to-market NAV,
 * active S&P 500 alpha, risk decomposition, target rebalancing, and trade execution.
 */

import { showToast, escapeHtml } from '../utils.js';

// ── Storage Keys & Initial Constants ───────────────────────────────────────────
const PMS_STATE_KEY = 'strata_pms_state';
const LEGACY_STORAGE_KEYS = ['strata_portfolio', 'portfolio_holdings', 'portfolioHoldings'];
const RISK_FREE_RATE = 0.045; // 4.5% US T-Bill annual baseline

// In-memory runtime caches
let sectorDonutChartInstance = null;
let pnlWaterfallChartInstance = null;
let performanceChartInstance = null;
const timeSeriesCache = new Map();

// Workstation State
let state = {
    startingCapital: 100000,
    cashBalance: 10000,
    realizedPnL: 0,
    holdings: [], // [{ symbol: 'AAPL', shares: 50, avgCost: 215.20 }]
    transactions: [], // [{ id, timestamp, type, symbol, quantity, price, notional, realizedPnL }]
    targetWeights: {}, // { 'AAPL': 15, 'CASH': 10 }
    marketData: {}, // { 'AAPL': { price, change, changePercent, beta, pe, dividendYield, high52w, low52w, logo, name, sector } }
    benchmarkData: null, // S&P 500 quote/day data
    activeTab: 'blotter',
    sortField: 'marketValue',
    sortAsc: false,
    filterQuery: '',
    visualMode: 'sector', // 'sector' | 'waterfall'
    perfTimeframe: '1Y',
    pendingTrimHolding: null
};

// ── Starter Institutional Portfolios ──────────────────────────────────────────
const STARTER_PRESETS = {
    core: {
        name: 'Institutional Core Compounders',
        cash: 10000,
        allocations: [
            { symbol: 'MSFT', targetVal: 11250 },
            { symbol: 'AAPL', targetVal: 11250 },
            { symbol: 'NVDA', targetVal: 11250 },
            { symbol: 'GOOGL', targetVal: 11250 },
            { symbol: 'JPM', targetVal: 11250 },
            { symbol: 'LLY', targetVal: 11250 },
            { symbol: 'COST', targetVal: 11250 },
            { symbol: 'XOM', targetVal: 11250 }
        ]
    },
    allweather: {
        name: 'All-Weather Multi-Asset ETF Book',
        cash: 10000,
        allocations: [
            { symbol: 'SPY', targetVal: 30000 },
            { symbol: 'TLT', targetVal: 30000 },
            { symbol: 'GLD', targetVal: 15000 },
            { symbol: 'QQQ', targetVal: 10000 },
            { symbol: 'USO', targetVal: 5000 }
        ]
    },
    dividend: {
        name: 'High-Yield Dividend & Value',
        cash: 10000,
        allocations: [
            { symbol: 'JPM', targetVal: 13000 },
            { symbol: 'XOM', targetVal: 13000 },
            { symbol: 'PG', targetVal: 13000 },
            { symbol: 'JNJ', targetVal: 13000 },
            { symbol: 'ABBV', targetVal: 13000 },
            { symbol: 'VZ', targetVal: 13000 },
            { symbol: 'KO', targetVal: 12000 }
        ]
    }
};

// ── Main Workstation Initialization Entrypoint ─────────────────────────────────
export async function initPortfolioWorkstation() {
    loadPersistedState();
    setupEventHandlers();
    
    // Initial fetch of live market quotes & benchmark
    await refreshMarketData();

    // Auto-load template if book is completely uninitialized
    if (state.holdings.length === 0 && state.transactions.length === 0 && !localStorage.getItem(PMS_STATE_KEY)) {
        await loadInstitutionalTemplate('core', true);
    } else {
        renderWorkstation();
    }
}

// Backward-compatible alias for any legacy imports
export function setupPortfolioBuilder() {
    initPortfolioWorkstation();
}

// ── State Persistence & Cross-Module Synchronization ───────────────────────────
function loadPersistedState() {
    try {
        const saved = localStorage.getItem(PMS_STATE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            state.startingCapital = parsed.startingCapital || 100000;
            state.cashBalance = parsed.cashBalance != null ? parsed.cashBalance : 10000;
            state.realizedPnL = parsed.realizedPnL || 0;
            state.holdings = Array.isArray(parsed.holdings) ? parsed.holdings : [];
            state.transactions = Array.isArray(parsed.transactions) ? parsed.transactions : [];
            state.targetWeights = parsed.targetWeights || {};
            return;
        }

        // Migration from legacy portfolio storage keys
        for (const key of LEGACY_STORAGE_KEYS) {
            const legacyRaw = localStorage.getItem(key);
            if (legacyRaw) {
                const legacy = JSON.parse(legacyRaw);
                const list = Array.isArray(legacy) ? legacy : (legacy?.holdings || []);
                if (list.length > 0) {
                    const migrated = [];
                    let cash = 10000;
                    list.forEach(item => {
                        const sym = (item.ticker || item.symbol || '').toUpperCase().trim();
                        if (!sym) return;
                        const shares = parseFloat(item.shares || item.quantity) || 0;
                        const avgCost = parseFloat(item.price || item.avgCost || item.costBasis) || 0;
                        if (sym === 'CASH') {
                            cash = shares * (avgCost || 1);
                        } else if (shares > 0) {
                            migrated.push({ symbol: sym, shares, avgCost: avgCost || 100 });
                        }
                    });
                    if (migrated.length > 0) {
                        state.holdings = migrated;
                        state.cashBalance = cash;
                        saveState();
                        return;
                    }
                }
            }
        }
    } catch (err) {
        console.warn('Error loading portfolio state:', err);
    }
}

function saveState() {
    try {
        const toSave = {
            startingCapital: state.startingCapital,
            cashBalance: state.cashBalance,
            realizedPnL: state.realizedPnL,
            holdings: state.holdings,
            transactions: state.transactions,
            targetWeights: state.targetWeights
        };
        localStorage.setItem(PMS_STATE_KEY, JSON.stringify(toSave));

        // Sync with stress tester and legacy consumers
        const syncList = state.holdings.map(h => {
            const live = state.marketData[h.symbol]?.price || h.avgCost;
            return {
                ticker: h.symbol,
                symbol: h.symbol,
                shares: h.shares,
                price: live,
                avgCost: h.avgCost,
                value: h.shares * live
            };
        });

        if (state.cashBalance > 0) {
            syncList.push({
                ticker: 'CASH',
                symbol: 'CASH',
                shares: state.cashBalance,
                price: 1,
                avgCost: 1,
                value: state.cashBalance
            });
        }

        const totalNAV = calculateNAVMetrics().totalNAV;
        localStorage.setItem('strata_portfolio', JSON.stringify(syncList));
        localStorage.setItem('portfolio_holdings', JSON.stringify(syncList));
        localStorage.setItem('stress_param_capital', String(Math.round(totalNAV)));
    } catch (err) {
        console.warn('Error saving portfolio state:', err);
    }
}

// ── Market Data Ingestion (Batch Snapshot & S&P 500 Benchmark) ─────────────────
async function refreshMarketData() {
    const refreshBtn = document.getElementById('pms-refresh-btn');
    if (refreshBtn) {
        refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Refreshing…';
        refreshBtn.disabled = true;
    }

    try {
        const symbols = Array.from(new Set(state.holdings.map(h => h.symbol)));
        
        // Parallel fetch of portfolio snapshot + benchmark index
        const [snapshots, benchmark] = await Promise.all([
            fetchPortfolioSnapshots(symbols),
            fetchBenchmarkIndex()
        ]);

        if (snapshots && Object.keys(snapshots).length > 0) {
            state.marketData = { ...state.marketData, ...snapshots };
        }
        if (benchmark) {
            state.benchmarkData = benchmark;
        }

        const tsEl = document.getElementById('pms-last-updated');
        if (tsEl) {
            const now = new Date();
            tsEl.innerHTML = `<i class="fa-regular fa-clock"></i> Updated ${now.toLocaleTimeString()}`;
        }
    } catch (err) {
        console.error('Failed to refresh portfolio market data:', err);
    } finally {
        if (refreshBtn) {
            refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh Quotes';
            refreshBtn.disabled = false;
        }
    }
}

async function fetchPortfolioSnapshots(symbols) {
    if (!symbols || symbols.length === 0) return {};
    try {
        const res = await fetch('/api/portfolio/snapshot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbols })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.snapshots || {};
    } catch (err) {
        console.warn('Batch snapshot fetch error:', err);
        return {};
    }
}

async function fetchBenchmarkIndex() {
    try {
        const res = await fetch('/api/indices');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.sp500 || null;
    } catch (err) {
        console.warn('Failed to fetch S&P 500 benchmark:', err);
        return null;
    }
}

// ── Quantitative Analytics & Attribution Calculations ──────────────────────────
function calculateNAVMetrics() {
    let investedMarketValue = 0;
    let totalCostBasis = 0;
    let dayPnLDollar = 0;
    let projectedAnnualDividends = 0;

    const enrichedHoldings = state.holdings.map(h => {
        const snap = state.marketData[h.symbol] || {};
        const price = typeof snap.price === 'number' && snap.price > 0 ? snap.price : h.avgCost;
        const change = typeof snap.change === 'number' ? snap.change : 0;
        const changePercent = typeof snap.changePercent === 'number' ? snap.changePercent : 0;
        const beta = typeof snap.beta === 'number' ? snap.beta : 1.0;
        const pe = typeof snap.pe === 'number' && snap.pe > 0 ? snap.pe : null;
        const dividendYield = typeof snap.dividendYield === 'number' ? snap.dividendYield : 0;

        const marketValue = h.shares * price;
        const costBasis = h.shares * h.avgCost;
        const unrealizedPnL = marketValue - costBasis;
        const unrealizedPnLPct = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : 0;
        const holdingDayPnL = h.shares * change;
        const annualDiv = marketValue * (dividendYield / 100);
        const yoc = h.avgCost > 0 ? ((dividendYield / 100 * price) / h.avgCost) * 100 : 0;

        investedMarketValue += marketValue;
        totalCostBasis += costBasis;
        dayPnLDollar += holdingDayPnL;
        projectedAnnualDividends += annualDiv;

        return {
            ...h,
            price,
            change,
            changePercent,
            beta,
            pe,
            dividendYield,
            yoc,
            marketValue,
            costBasis,
            unrealizedPnL,
            unrealizedPnLPct,
            holdingDayPnL,
            annualDiv,
            name: snap.name || h.symbol,
            sector: snap.sector || 'Equities',
            logo: snap.logo || '',
            high52w: snap.high52w || price * 1.15,
            low52w: snap.low52w || price * 0.85
        };
    });

    const totalNAV = investedMarketValue + state.cashBalance;
    const unrealizedPnL = investedMarketValue - totalCostBasis;
    const unrealizedPnLPct = totalCostBasis > 0 ? (unrealizedPnL / totalCostBasis) * 100 : 0;
    const totalPnL = unrealizedPnL + state.realizedPnL;
    const totalBasisWithCash = totalCostBasis + Math.max(0, state.cashBalance);
    const totalReturnPct = totalBasisWithCash > 0 ? (totalPnL / totalBasisWithCash) * 100 : 0;

    const prevDayNAV = totalNAV - dayPnLDollar;
    const dayPnLPct = prevDayNAV > 0 ? (dayPnLDollar / prevDayNAV) * 100 : 0;

    const spxChangePct = state.benchmarkData?.changePercent || 0;
    const dailyAlphaBps = (dayPnLPct - spxChangePct) * 100; // in basis points

    // Weight and Day Contribution bps
    let weightedBeta = 0;
    let sumWeightInvPE = 0;
    let sumValidPEWeight = 0;
    let sumSquaredWeights = 0;

    enrichedHoldings.forEach(item => {
        item.navWeight = totalNAV > 0 ? (item.marketValue / totalNAV) * 100 : 0;
        item.investedWeight = investedMarketValue > 0 ? (item.marketValue / investedMarketValue) * 100 : 0;
        item.dayContribBps = (item.navWeight / 100) * item.changePercent * 100;

        weightedBeta += (item.navWeight / 100) * item.beta;

        // Herfindahl-Hirschman Index (invested weight fraction squared)
        const wFrac = item.investedWeight / 100;
        sumSquaredWeights += (wFrac * wFrac);

        // Harmonic P/E
        if (item.pe && item.pe > 0 && item.pe < 400) {
            sumWeightInvPE += (item.navWeight / 100) / item.pe;
            sumValidPEWeight += (item.navWeight / 100);
        }
    });

    // Cash has beta = 0, so weightedBeta already accounts for cash weight
    const hhi = sumSquaredWeights > 0 ? sumSquaredWeights : 1;
    const effectiveN = investedMarketValue > 0 ? (1 / hhi) : 0;

    const harmonicPE = (sumValidPEWeight > 0 && sumWeightInvPE > 0)
        ? (sumValidPEWeight / sumWeightInvPE)
        : null;

    const forwardYield = totalNAV > 0 ? (projectedAnnualDividends / totalNAV) * 100 : 0;
    const portfolioYOC = totalCostBasis > 0 ? (projectedAnnualDividends / totalCostBasis) * 100 : 0;

    return {
        investedMarketValue,
        totalCostBasis,
        totalNAV,
        unrealizedPnL,
        unrealizedPnLPct,
        totalPnL,
        totalReturnPct,
        dayPnLDollar,
        dayPnLPct,
        spxChangePct,
        dailyAlphaBps,
        weightedBeta,
        effectiveN,
        hhi,
        harmonicPE,
        projectedAnnualDividends,
        forwardYield,
        portfolioYOC,
        enrichedHoldings
    };
}

// ── Main UI Workstation Rendering ──────────────────────────────────────────────
export function renderWorkstation() {
    const metrics = calculateNAVMetrics();
    renderExecutiveRibbon(metrics);
    renderHoldingsBlotter(metrics);
    renderAllocationVisuals(metrics);
    renderRebalancerTab(metrics);
    renderLedgerTab();
}

// 1. Executive NAV, Alpha & Risk Ribbon (6 Cards)
function renderExecutiveRibbon(metrics) {
    const cashRatio = metrics.totalNAV > 0 ? (state.cashBalance / metrics.totalNAV) * 100 : 0;

    // Card 1: Total NAV
    const navEl = document.getElementById('kpi-total-nav');
    if (navEl) navEl.textContent = formatCurrency(metrics.totalNAV);
    const cashBadge = document.getElementById('pms-cash-ratio-badge');
    if (cashBadge) cashBadge.textContent = `Cash: ${cashRatio.toFixed(1)}%`;
    const costBasisEl = document.getElementById('kpi-cost-basis');
    if (costBasisEl) costBasisEl.textContent = `Basis: ${formatCurrency(metrics.totalCostBasis)}`;
    const investedEl = document.getElementById('kpi-invested-val');
    if (investedEl) investedEl.textContent = `Invested: ${formatCurrency(metrics.investedMarketValue)}`;
    const cashValEl = document.getElementById('kpi-cash-val');
    if (cashValEl) cashValEl.textContent = `Cash: ${formatCurrency(state.cashBalance)}`;

    // Card 2: Total P&L
    const totalPnlEl = document.getElementById('kpi-total-pnl');
    if (totalPnlEl) {
        totalPnlEl.textContent = formatSignedCurrency(metrics.totalPnL);
        applyColorClass(totalPnlEl, metrics.totalPnL);
    }
    const returnPctBadge = document.getElementById('kpi-total-return-pct');
    if (returnPctBadge) {
        returnPctBadge.textContent = `${metrics.totalReturnPct >= 0 ? '+' : ''}${metrics.totalReturnPct.toFixed(2)}%`;
        applyBadgeColor(returnPctBadge, metrics.totalReturnPct);
    }
    const unrealizedSub = document.getElementById('kpi-unrealized-sub');
    if (unrealizedSub) {
        unrealizedSub.textContent = `Unrealized: ${formatSignedCurrency(metrics.unrealizedPnL)}`;
    }
    const realizedSplit = document.getElementById('kpi-realized-split');
    if (realizedSplit) {
        realizedSplit.textContent = `Realized: ${formatSignedCurrency(state.realizedPnL)}`;
    }

    // Card 3: Day P&L & Benchmark Alpha
    const dayDollarEl = document.getElementById('kpi-day-pnl-dollar');
    if (dayDollarEl) {
        dayDollarEl.textContent = formatSignedCurrency(metrics.dayPnLDollar);
        applyColorClass(dayDollarEl, metrics.dayPnLDollar);
    }
    const dayPctEl = document.getElementById('kpi-day-pnl-pct');
    if (dayPctEl) {
        dayPctEl.textContent = `${metrics.dayPnLPct >= 0 ? '+' : ''}${metrics.dayPnLPct.toFixed(2)}%`;
        applyColorClass(dayPctEl, metrics.dayPnLPct);
    }
    const alphaPill = document.getElementById('kpi-alpha-pill');
    if (alphaPill) {
        const sign = metrics.dailyAlphaBps >= 0 ? '+' : '';
        alphaPill.textContent = `${sign}${Math.round(metrics.dailyAlphaBps)} bps vs S&P 500`;
        applyBadgeColor(alphaPill, metrics.dailyAlphaBps);
    }
    const spxBench = document.getElementById('kpi-spx-benchmark');
    if (spxBench) {
        const spxSign = metrics.spxChangePct >= 0 ? '+' : '';
        spxBench.textContent = `S&P 500 Today: ${spxSign}${metrics.spxChangePct.toFixed(2)}%`;
    }

    // Card 4: Risk Profile
    const betaEl = document.getElementById('kpi-portfolio-beta');
    if (betaEl) betaEl.textContent = `${metrics.weightedBeta.toFixed(2)} β`;

    // Card 5: Concentration
    const effNEl = document.getElementById('kpi-effective-n');
    if (effNEl) effNEl.textContent = metrics.effectiveN.toFixed(1);
    const divBadge = document.getElementById('kpi-diversification-badge');
    if (divBadge) {
        if (metrics.effectiveN >= 7) {
            divBadge.textContent = 'Well-Diversified';
            divBadge.className = 'pms-card-badge success-badge';
        } else if (metrics.effectiveN >= 3.5) {
            divBadge.textContent = 'Moderate';
            divBadge.className = 'pms-card-badge warning-badge';
        } else {
            divBadge.textContent = 'Concentrated';
            divBadge.className = 'pms-card-badge danger-badge';
        }
    }
    const topWeightEl = document.getElementById('kpi-top-weight');
    if (topWeightEl) {
        const maxWeight = metrics.enrichedHoldings.reduce((max, h) => Math.max(max, h.navWeight), 0);
        topWeightEl.textContent = `Top Position: ${maxWeight.toFixed(1)}%`;
    }

    // Card 6: Dividends & Fundamental P/E
    const divValEl = document.getElementById('kpi-annual-dividends');
    if (divValEl) divValEl.textContent = `${formatCurrency(metrics.projectedAnnualDividends)}/yr`;
    const fwdYieldBadge = document.getElementById('kpi-forward-yield-badge');
    if (fwdYieldBadge) fwdYieldBadge.textContent = `Yield: ${metrics.forwardYield.toFixed(2)}%`;
    const harmonicPeEl = document.getElementById('kpi-harmonic-pe');
    if (harmonicPeEl) {
        harmonicPeEl.textContent = metrics.harmonicPE ? `P/E: ${metrics.harmonicPE.toFixed(1)}x` : 'P/E: —';
    }
    const yocEl = document.getElementById('kpi-yoc-val');
    if (yocEl) yocEl.textContent = `Yield on Cost: ${metrics.portfolioYOC.toFixed(2)}%`;
}

// 2. Holdings Blotter Table
function renderHoldingsBlotter(metrics) {
    const tbody = document.getElementById('pms-holdings-tbody');
    if (!tbody) return;

    let items = [...metrics.enrichedHoldings];

    // Filter by ticker / sector / name
    if (state.filterQuery) {
        const q = state.filterQuery.toLowerCase();
        items = items.filter(h =>
            h.symbol.toLowerCase().includes(q) ||
            (h.name && h.name.toLowerCase().includes(q)) ||
            (h.sector && h.sector.toLowerCase().includes(q))
        );
    }

    // Column Sorting
    items.sort((a, b) => {
        let valA = a[state.sortField];
        let valB = b[state.sortField];
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return state.sortAsc ? -1 : 1;
        if (valA > valB) return state.sortAsc ? 1 : -1;
        return 0;
    });

    if (items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="13" class="table-empty-state">
                    ${metrics.enrichedHoldings.length === 0 
                        ? 'No active positions in portfolio. Use the trade ticket above or load an institutional preset.' 
                        : 'No positions matching search query.'}
                </td>
            </tr>
        `;
        renderBlotterFooter(metrics, 0);
        return;
    }

    let rowsHtml = '';
    items.forEach(h => {
        const daySign = h.change >= 0 ? '+' : '';
        const dayPctSign = h.changePercent >= 0 ? '+' : '';
        const dayClass = h.change >= 0 ? 'text-emerald' : 'text-rose';
        const contribSign = h.dayContribBps >= 0 ? '+' : '';
        const contribClass = h.dayContribBps >= 0 ? 'text-emerald' : 'text-rose';
        const pnlSign = h.unrealizedPnL >= 0 ? '+' : '';
        const pnlClass = h.unrealizedPnL >= 0 ? 'text-emerald' : 'text-rose';

        // 52-Week Range Bar position percentage
        let rangePct = 50;
        if (h.high52w > h.low52w) {
            rangePct = Math.max(0, Math.min(100, ((h.price - h.low52w) / (h.high52w - h.low52w)) * 100));
        }

        const logoHtml = h.logo 
            ? `<img src="${escapeHtml(h.logo)}" alt="${h.symbol}" class="pms-table-logo" onerror="this.style.display='none'">` 
            : `<div class="pms-table-logo-fallback">${h.symbol.slice(0, 3)}</div>`;

        rowsHtml += `
            <tr data-symbol="${h.symbol}">
                <td class="pms-instrument-cell">
                    ${logoHtml}
                    <div>
                        <div class="pms-sym-title">${escapeHtml(h.symbol)}</div>
                        <div class="pms-sym-subtitle">${escapeHtml(h.name || h.sector)}</div>
                    </div>
                </td>
                <td class="text-right font-mono">${formatNumber(h.shares, 2)}</td>
                <td class="text-right font-mono">$${h.avgCost.toFixed(2)}</td>
                <td class="text-right font-mono font-bold">$${h.price.toFixed(2)}</td>
                <td class="text-right font-mono ${dayClass}">
                    <div>${dayPctSign}${h.changePercent.toFixed(2)}%</div>
                    <div class="sub-num">${daySign}$${Math.abs(h.change).toFixed(2)}</div>
                </td>
                <td class="text-right font-mono font-bold ${contribClass}">
                    ${contribSign}${Math.round(h.dayContribBps)} bps
                </td>
                <td class="text-right font-mono font-bold">$${formatNumber(h.marketValue, 2)}</td>
                <td class="text-right font-mono">${h.navWeight.toFixed(2)}%</td>
                <td class="text-right font-mono ${pnlClass}">
                    <div>${pnlSign}$${formatNumber(Math.abs(h.unrealizedPnL), 2)}</div>
                    <div class="sub-num">(${pnlSign}${h.unrealizedPnLPct.toFixed(2)}%)</div>
                </td>
                <td class="text-right font-mono">${h.beta.toFixed(2)}</td>
                <td class="text-right font-mono">
                    <div>${h.dividendYield.toFixed(2)}%</div>
                    <div class="sub-num" title="Yield on Cost">YOC: ${h.yoc.toFixed(2)}%</div>
                </td>
                <td class="text-center">
                    <div class="pms-52w-wrap" title="52W Low: $${h.low52w.toFixed(2)} | High: $${h.high52w.toFixed(2)}">
                        <span class="pms-52w-bound">$${Math.round(h.low52w)}</span>
                        <div class="pms-52w-track">
                            <div class="pms-52w-fill" style="width: ${rangePct}%;"></div>
                            <div class="pms-52w-indicator" style="left: ${rangePct}%;"></div>
                        </div>
                        <span class="pms-52w-bound">$${Math.round(h.high52w)}</span>
                    </div>
                </td>
                <td class="text-center pms-actions-cell">
                    <button class="pms-mini-btn pms-trim-trigger" data-symbol="${h.symbol}" title="Trim or Close Position">
                        <i class="fa-solid fa-hand-holding-dollar"></i> Trim
                    </button>
                    <a href="index.html?symbol=${h.symbol}" class="pms-mini-icon-btn" title="View Equity Analysis">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    </a>
                    <a href="ai.html?symbol=${h.symbol}" class="pms-mini-icon-btn highlight" title="Ask AI Chief Risk Officer">
                        <i class="fa-solid fa-brain"></i>
                    </a>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = rowsHtml;
    renderBlotterFooter(metrics, items.length);

    // Attach Trim / Sell triggers
    tbody.querySelectorAll('.pms-trim-trigger').forEach(btn => {
        btn.addEventListener('click', () => {
            const sym = btn.getAttribute('data-symbol');
            const h = metrics.enrichedHoldings.find(x => x.symbol === sym);
            if (h) openTrimModal(h);
        });
    });
}

function renderBlotterFooter(metrics, filteredCount) {
    const totSharesEl = document.getElementById('pms-tot-shares');
    if (totSharesEl) {
        const totalShares = metrics.enrichedHoldings.reduce((sum, h) => sum + h.shares, 0);
        totSharesEl.textContent = formatNumber(totalShares, 2);
    }
    const totBasisEl = document.getElementById('pms-tot-basis');
    if (totBasisEl) totBasisEl.textContent = formatCurrency(metrics.totalCostBasis);
    
    const totDayEl = document.getElementById('pms-tot-day-chg');
    if (totDayEl) {
        const sign = metrics.dayPnLDollar >= 0 ? '+' : '';
        totDayEl.textContent = `${sign}${formatCurrency(metrics.dayPnLDollar)} (${sign}${metrics.dayPnLPct.toFixed(2)}%)`;
        applyColorClass(totDayEl, metrics.dayPnLDollar);
    }
    const totContribEl = document.getElementById('pms-tot-contrib');
    if (totContribEl) {
        const totalContrib = metrics.enrichedHoldings.reduce((s, h) => s + h.dayContribBps, 0);
        totContribEl.textContent = `${totalContrib >= 0 ? '+' : ''}${Math.round(totalContrib)} bps`;
        applyColorClass(totContribEl, totalContrib);
    }
    const totMvEl = document.getElementById('pms-tot-mv');
    if (totMvEl) totMvEl.textContent = formatCurrency(metrics.investedMarketValue);

    const totPnlEl = document.getElementById('pms-tot-pnl');
    if (totPnlEl) {
        const sign = metrics.unrealizedPnL >= 0 ? '+' : '';
        totPnlEl.textContent = `${sign}${formatCurrency(metrics.unrealizedPnL)} (${sign}${metrics.unrealizedPnLPct.toFixed(2)}%)`;
        applyColorClass(totPnlEl, metrics.unrealizedPnL);
    }
    const totBetaEl = document.getElementById('pms-tot-beta');
    if (totBetaEl) totBetaEl.textContent = `${metrics.weightedBeta.toFixed(2)} β`;

    const totYieldEl = document.getElementById('pms-tot-yield');
    if (totYieldEl) totYieldEl.textContent = `${metrics.forwardYield.toFixed(2)}%`;
}

// 3. Visuals: Sector Allocation Donut & P&L Attribution Waterfall
function renderAllocationVisuals(metrics) {
    renderSectorDonutChart(metrics);
    renderPnlWaterfallChart(metrics);
}

function renderSectorDonutChart(metrics) {
    const canvas = document.getElementById('portfolioSectorDonutChart');
    if (!canvas || typeof Chart === 'undefined') return;

    // Aggregate market values by Sector + Cash
    const sectorTotals = {};
    metrics.enrichedHoldings.forEach(h => {
        const sec = h.sector || 'Equities';
        sectorTotals[sec] = (sectorTotals[sec] || 0) + h.marketValue;
    });
    if (state.cashBalance > 0) {
        sectorTotals['Cash Reserve'] = (sectorTotals['Cash Reserve'] || 0) + state.cashBalance;
    }

    const labels = Object.keys(sectorTotals);
    const dataValues = Object.values(sectorTotals);

    const PALETTE = [
        '#38bdf8', '#818cf8', '#34d399', '#fbbf24', '#f87171',
        '#a78bfa', '#fb923c', '#2dd4bf', '#e879f9', '#94a3b8'
    ];

    if (sectorDonutChartInstance) {
        sectorDonutChartInstance.destroy();
        sectorDonutChartInstance = null;
    }

    const ctx = canvas.getContext('2d');
    sectorDonutChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: dataValues,
                backgroundColor: PALETTE.slice(0, labels.length),
                borderColor: '#0f172a',
                borderWidth: 2,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const val = ctx.raw;
                            const pct = metrics.totalNAV > 0 ? (val / metrics.totalNAV) * 100 : 0;
                            return ` ${ctx.label}: ${formatCurrency(val)} (${pct.toFixed(1)}%)`;
                        }
                    }
                }
            },
            cutout: '72%'
        }
    });

    // Custom HTML Legend
    const legendEl = document.getElementById('portfolio-sector-legend');
    if (legendEl) {
        legendEl.innerHTML = labels.map((lbl, i) => {
            const val = sectorTotals[lbl];
            const pct = metrics.totalNAV > 0 ? (val / metrics.totalNAV) * 100 : 0;
            const color = PALETTE[i % PALETTE.length];
            return `
                <div class="pms-legend-item">
                    <span class="pms-legend-dot" style="background: ${color};"></span>
                    <span class="pms-legend-label">${escapeHtml(lbl)}</span>
                    <span class="pms-legend-pct">${pct.toFixed(1)}%</span>
                </div>
            `;
        }).join('');
    }
}

function renderPnlWaterfallChart(metrics) {
    const canvas = document.getElementById('portfolioAttributionChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const sorted = [...metrics.enrichedHoldings].sort((a, b) => b.unrealizedPnL - a.unrealizedPnL);
    const labels = sorted.map(h => h.symbol);
    const dataValues = sorted.map(h => Math.round(h.unrealizedPnL));
    const colors = dataValues.map(v => v >= 0 ? '#10b981' : '#f43f5e');

    if (pnlWaterfallChartInstance) {
        pnlWaterfallChartInstance.destroy();
        pnlWaterfallChartInstance = null;
    }

    const ctx = canvas.getContext('2d');
    pnlWaterfallChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Unrealized P&L ($)',
                data: dataValues,
                backgroundColor: colors,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` P&L: ${formatSignedCurrency(ctx.raw)}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: {
                        color: '#94a3b8',
                        callback: (v) => formatCurrency(v)
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#f8fafc', font: { weight: '600' } }
                }
            }
        }
    });
}

// 4. Performance vs S&P 500 Historical Backtest & Risk Decomposition
async function renderPerformanceTab() {
    const canvas = document.getElementById('portfolioPerformanceChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const metrics = calculateNAVMetrics();
    const symbols = Array.from(new Set(['SPY', ...metrics.enrichedHoldings.map(h => h.symbol)]));

    // Fetch 1Y daily time series for all holdings + SPY
    const seriesMap = await fetchMultipleTimeSeries(symbols);
    const spySeries = seriesMap['SPY'];

    if (!spySeries || spySeries.length < 10) {
        renderPlaceholderPerformanceChart(canvas);
        return;
    }

    // Align dates in chronological order
    const spySorted = [...spySeries].reverse(); // oldest to newest
    const dates = spySorted.map(d => d.datetime);

    // Compute portfolio returns by current weight
    const portfolioCurve = [];
    const spyCurve = [];
    let pCum = 100;
    let sCum = 100;

    const portfolioDailyReturns = [];
    const spyDailyReturns = [];

    for (let i = 0; i < dates.length; i++) {
        const dt = dates[i];
        if (i === 0) {
            portfolioCurve.push({ date: dt, value: 100 });
            spyCurve.push({ date: dt, value: 100 });
            continue;
        }

        // SPY return
        const sPrev = parseFloat(spySorted[i - 1].close);
        const sCurr = parseFloat(spySorted[i].close);
        const sRet = sPrev > 0 ? (sCurr - sPrev) / sPrev : 0;
        spyDailyReturns.push(sRet);
        sCum *= (1 + sRet);
        spyCurve.push({ date: dt, value: sCum });

        // Portfolio weighted return
        let pRet = 0;
        metrics.enrichedHoldings.forEach(h => {
            const symSeries = seriesMap[h.symbol];
            if (symSeries && symSeries.length > i) {
                const arr = [...symSeries].reverse();
                const hPrev = parseFloat(arr[i - 1]?.close);
                const hCurr = parseFloat(arr[i]?.close);
                if (hPrev > 0 && hCurr > 0) {
                    const r = (hCurr - hPrev) / hPrev;
                    pRet += (h.navWeight / 100) * r;
                }
            } else {
                pRet += (h.navWeight / 100) * sRet; // proxy with market return if history missing
            }
        });

        portfolioDailyReturns.push(pRet);
        pCum *= (1 + pRet);
        portfolioCurve.push({ date: dt, value: pCum });
    }

    // Slice based on timeframe toggle
    let sliceLen = dates.length;
    if (state.perfTimeframe === '1M') sliceLen = Math.min(21, dates.length);
    else if (state.perfTimeframe === '3M') sliceLen = Math.min(63, dates.length);
    else if (state.perfTimeframe === '6M') sliceLen = Math.min(126, dates.length);

    const slicedPortfolio = portfolioCurve.slice(-sliceLen);
    const slicedSpy = spyCurve.slice(-sliceLen);
    
    // Normalize to base 100 at start of timeframe
    const baseP = slicedPortfolio[0].value;
    const baseS = slicedSpy[0].value;
    const chartLabels = slicedPortfolio.map(d => d.date);
    const chartDataPortfolio = slicedPortfolio.map(d => ((d.value / baseP) - 1) * 100);
    const chartDataSpy = slicedSpy.map(d => ((d.value / baseS) - 1) * 100);

    // Compute the 7 Risk Metrics from the 252 daily returns
    computeAndRenderRiskStats(portfolioDailyReturns, spyDailyReturns);

    if (performanceChartInstance) {
        performanceChartInstance.destroy();
        performanceChartInstance = null;
    }

    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 320);
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.25)');
    grad.addColorStop(1, 'rgba(56, 189, 248, 0.00)');

    performanceChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: [
                {
                    label: 'Portfolio (Current Allocation)',
                    data: chartDataPortfolio,
                    borderColor: '#38bdf8',
                    backgroundColor: grad,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.2,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: 'S&P 500 (SPY)',
                    data: chartDataSpy,
                    borderColor: '#a855f7',
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    pointHoverRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    labels: { color: '#f8fafc', font: { family: 'JetBrains Mono' } }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw >= 0 ? '+' : ''}${ctx.raw.toFixed(2)}%`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8', maxTicksLimit: 8 }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: {
                        color: '#94a3b8',
                        callback: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
                    }
                }
            }
        }
    });
}

function computeAndRenderRiskStats(pRets, sRets) {
    if (pRets.length < 5 || sRets.length < 5) return;

    const N = pRets.length;
    const meanP = pRets.reduce((s, r) => s + r, 0) / N;
    const meanS = sRets.reduce((s, r) => s + r, 0) / N;

    // Variance & Annualized Volatility
    let varP = 0;
    let varS = 0;
    let cov = 0;
    let downsideVar = 0;
    let trackingVar = 0;

    for (let i = 0; i < N; i++) {
        const diffP = pRets[i] - meanP;
        const diffS = sRets[i] - meanS;
        varP += diffP * diffP;
        varS += diffS * diffS;
        cov += diffP * diffS;

        if (pRets[i] < 0) {
            downsideVar += pRets[i] * pRets[i];
        }

        const diffTrack = (pRets[i] - sRets[i]);
        trackingVar += diffTrack * diffTrack;
    }

    const dailyVolP = Math.sqrt(varP / (N - 1));
    const annualVolP = dailyVolP * Math.sqrt(252);
    const annualVolS = Math.sqrt(varS / (N - 1)) * Math.sqrt(252);

    // Beta = Cov(P, S) / Var(S)
    const beta = varS > 0 ? (cov / varS) : 1.0;

    // Annualized Returns
    const annualRetP = Math.pow(1 + meanP, 252) - 1;
    const annualRetS = Math.pow(1 + meanS, 252) - 1;

    // Sharpe Ratio (Rf = 4.5%)
    const sharpe = annualVolP > 0 ? (annualRetP - RISK_FREE_RATE) / annualVolP : 0;

    // Sortino Ratio
    const downsideDev = Math.sqrt(downsideVar / N) * Math.sqrt(252);
    const sortino = downsideDev > 0 ? (annualRetP - RISK_FREE_RATE) / downsideDev : 0;

    // Tracking Error & Information Ratio
    const trackingError = Math.sqrt(trackingVar / (N - 1)) * Math.sqrt(252);
    const infoRatio = trackingError > 0 ? (annualRetP - annualRetS) / trackingError : 0;

    // Jensen's Alpha = R_p - [R_f + Beta * (R_m - R_f)]
    const jensenAlpha = annualRetP - (RISK_FREE_RATE + beta * (annualRetS - RISK_FREE_RATE));

    // 1Y Max Drawdown
    let peak = -Infinity;
    let maxDD = 0;
    let cum = 100;
    for (const r of pRets) {
        cum *= (1 + r);
        if (cum > peak) peak = cum;
        const dd = (cum - peak) / peak;
        if (dd < maxDD) maxDD = dd;
    }

    // Update Tab 2 Risk Metric Cards
    updateElemText('perf-jensen-alpha', `${jensenAlpha >= 0 ? '+' : ''}${(jensenAlpha * 100).toFixed(2)}%`, jensenAlpha);
    updateElemText('perf-portfolio-beta', beta.toFixed(2));
    updateElemText('perf-tracking-error', `${(trackingError * 100).toFixed(2)}%`);
    updateElemText('perf-info-ratio', infoRatio.toFixed(2), infoRatio);
    updateElemText('perf-annual-vol', `${(annualVolP * 100).toFixed(2)}%`);
    updateElemText('perf-sharpe-ratio', sharpe.toFixed(2), sharpe);
    updateElemText('perf-max-drawdown', `${(maxDD * 100).toFixed(2)}%`, maxDD);

    // Also sync to Executive Ribbon Card 4
    updateElemText('kpi-volatility-sub', `Vol: ${(annualVolP * 100).toFixed(1)}%`);
    updateElemText('kpi-sharpe-badge', `Sharpe: ${sharpe.toFixed(2)}`);
    updateElemText('kpi-max-drawdown', `1Y Max DD: ${(maxDD * 100).toFixed(1)}%`);
}

async function fetchMultipleTimeSeries(symbols) {
    const results = {};
    const toFetch = symbols.filter(s => !timeSeriesCache.has(s));

    // Max 4 parallel requests to conserve free-tier concurrency
    const chunks = [];
    for (let i = 0; i < toFetch.length; i += 4) {
        chunks.push(toFetch.slice(i, i + 4));
    }

    for (const chunk of chunks) {
        await Promise.all(chunk.map(async (sym) => {
            try {
                const res = await fetch(`/api/twelvedata/time_series?symbol=${encodeURIComponent(sym)}&timeframe=1Y`);
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.values) {
                        timeSeriesCache.set(sym, data.values);
                    }
                }
            } catch (err) {
                console.warn(`Time series fetch failed for ${sym}:`, err);
            }
        }));
    }

    symbols.forEach(s => {
        if (timeSeriesCache.has(s)) {
            results[s] = timeSeriesCache.get(s);
        }
    });

    return results;
}

function renderPlaceholderPerformanceChart(canvas) {
    if (performanceChartInstance) {
        performanceChartInstance.destroy();
        performanceChartInstance = null;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#64748b';
    ctx.font = '14px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('Market history loading or unavailable. Add positions to view backtest.', canvas.width / 2, canvas.height / 2);
}

// 5. Target Rebalancer & Order Generator Tab
function renderRebalancerTab(metrics) {
    const listEl = document.getElementById('pms-rebalance-sliders-list');
    if (!listEl) return;

    if (metrics.enrichedHoldings.length === 0) {
        listEl.innerHTML = '<p class="empty-notice">Add active positions in the blotter to enable the rebalancing desk.</p>';
        renderRebalanceOrdersTable([]);
        return;
    }

    // Ensure state.targetWeights is initialized
    if (!state.targetWeights || Object.keys(state.targetWeights).length === 0) {
        metrics.enrichedHoldings.forEach(h => {
            state.targetWeights[h.symbol] = parseFloat(h.navWeight.toFixed(1));
        });
        const cashWeight = metrics.totalNAV > 0 ? (state.cashBalance / metrics.totalNAV) * 100 : 0;
        state.targetWeights['CASH'] = parseFloat(cashWeight.toFixed(1));
    }

    let rowsHtml = '';
    metrics.enrichedHoldings.forEach(h => {
        const curWeight = h.navWeight;
        const tgtWeight = state.targetWeights[h.symbol] != null ? state.targetWeights[h.symbol] : curWeight;
        const drift = curWeight - tgtWeight;
        const driftSign = drift >= 0 ? '+' : '';
        const driftClass = Math.abs(drift) < 0.5 ? 'drift-flat' : (drift > 0 ? 'drift-over' : 'drift-under');

        rowsHtml += `
            <div class="pms-rebalance-row" data-symbol="${h.symbol}">
                <div class="pms-rebal-asset">
                    <strong>${escapeHtml(h.symbol)}</strong>
                    <span class="sub-txt">${escapeHtml(h.sector)}</span>
                </div>
                <div class="pms-rebal-cur font-mono">${curWeight.toFixed(1)}%</div>
                <div class="pms-rebal-slider-wrap">
                    <input type="range" class="pms-rebal-slider" min="0" max="60" step="0.5" value="${tgtWeight}" data-symbol="${h.symbol}">
                    <input type="number" class="pms-rebal-num-input font-mono" min="0" max="100" step="0.5" value="${tgtWeight.toFixed(1)}" data-symbol="${h.symbol}">
                </div>
                <div class="pms-rebal-drift font-mono ${driftClass}">
                    ${driftSign}${drift.toFixed(1)}%
                </div>
            </div>
        `;
    });

    // Cash row
    const curCashWeight = metrics.totalNAV > 0 ? (state.cashBalance / metrics.totalNAV) * 100 : 0;
    const tgtCashWeight = state.targetWeights['CASH'] != null ? state.targetWeights['CASH'] : curCashWeight;
    const cashDrift = curCashWeight - tgtCashWeight;
    rowsHtml += `
        <div class="pms-rebalance-row cash-row" data-symbol="CASH">
            <div class="pms-rebal-asset">
                <strong>CASH RESERVE</strong>
                <span class="sub-txt">Cash &amp; Equivalents</span>
            </div>
            <div class="pms-rebal-cur font-mono">${curCashWeight.toFixed(1)}%</div>
            <div class="pms-rebal-slider-wrap">
                <input type="range" class="pms-rebal-slider" min="0" max="100" step="0.5" value="${tgtCashWeight}" data-symbol="CASH">
                <input type="number" class="pms-rebal-num-input font-mono" min="0" max="100" step="0.5" value="${tgtCashWeight.toFixed(1)}" data-symbol="CASH">
            </div>
            <div class="pms-rebal-drift font-mono ${Math.abs(cashDrift) < 0.5 ? 'drift-flat' : (cashDrift > 0 ? 'drift-over' : 'drift-under')}">
                ${cashDrift >= 0 ? '+' : ''}${cashDrift.toFixed(1)}%
            </div>
        </div>
    `;

    listEl.innerHTML = rowsHtml;
    updateTargetSumDisplay();

    // Attach listeners for range sliders & numeric inputs
    listEl.querySelectorAll('.pms-rebal-slider').forEach(slider => {
        slider.addEventListener('input', (e) => {
            const sym = e.target.getAttribute('data-symbol');
            const val = parseFloat(e.target.value) || 0;
            state.targetWeights[sym] = val;
            const numInput = listEl.querySelector(`.pms-rebal-num-input[data-symbol="${sym}"]`);
            if (numInput) numInput.value = val.toFixed(1);
            updateTargetSumDisplay();
            generateAndRenderRebalanceOrders(metrics);
        });
    });

    listEl.querySelectorAll('.pms-rebal-num-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const sym = e.target.getAttribute('data-symbol');
            const val = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
            state.targetWeights[sym] = val;
            const slider = listEl.querySelector(`.pms-rebal-slider[data-symbol="${sym}"]`);
            if (slider) slider.value = val;
            updateTargetSumDisplay();
            generateAndRenderRebalanceOrders(metrics);
        });
    });

    generateAndRenderRebalanceOrders(metrics);
}

function updateTargetSumDisplay() {
    const sumEl = document.getElementById('pms-target-sum-val');
    if (!sumEl) return;
    const total = Object.values(state.targetWeights || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    sumEl.textContent = `${total.toFixed(1)}%`;
    sumEl.style.color = Math.abs(total - 100) < 0.2 ? '#10b981' : '#f43f5e';
}

function generateAndRenderRebalanceOrders(metrics) {
    const orders = [];
    const totalNAV = metrics.totalNAV;

    metrics.enrichedHoldings.forEach(h => {
        const targetPct = state.targetWeights[h.symbol] || 0;
        const targetVal = totalNAV * (targetPct / 100);
        const curVal = h.marketValue;
        const diffVal = targetVal - curVal;

        if (Math.abs(diffVal) >= 15 && h.price > 0) {
            const sharesToTrade = diffVal / h.price;
            orders.push({
                symbol: h.symbol,
                name: h.name,
                curShares: h.shares,
                targetShares: h.shares + sharesToTrade,
                action: sharesToTrade > 0 ? 'BUY' : 'SELL',
                sharesToTrade: Math.abs(sharesToTrade),
                tradeValue: Math.abs(diffVal),
                price: h.price,
                avgCost: h.avgCost
            });
        }
    });

    renderRebalanceOrdersTable(orders);
}

function renderRebalanceOrdersTable(orders) {
    const tbody = document.getElementById('pms-rebalance-orders-tbody');
    const execBtn = document.getElementById('pms-execute-rebalance-btn');
    if (!tbody) return;

    if (orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="table-empty-state">No rebalancing orders required. Target weights match current portfolio.</td></tr>`;
        if (execBtn) execBtn.disabled = true;
        return;
    }

    let rowsHtml = '';
    orders.forEach(o => {
        const actionBadge = o.action === 'BUY'
            ? `<span class="pms-order-pill buy"><i class="fa-solid fa-plus"></i> BUY +${formatNumber(o.sharesToTrade, 2)}</span>`
            : `<span class="pms-order-pill sell"><i class="fa-solid fa-minus"></i> SELL -${formatNumber(o.sharesToTrade, 2)}</span>`;

        rowsHtml += `
            <tr>
                <td><strong>${escapeHtml(o.symbol)}</strong></td>
                <td class="text-right">${formatNumber(o.curShares, 2)}</td>
                <td class="text-right font-bold">${formatNumber(Math.max(0, o.targetShares), 2)}</td>
                <td class="text-center">${actionBadge}</td>
                <td class="text-right font-bold">${formatCurrency(o.tradeValue)}</td>
            </tr>
        `;
    });

    tbody.innerHTML = rowsHtml;
    if (execBtn) {
        execBtn.disabled = false;
        execBtn.onclick = () => executeRebalancePlan(orders);
    }
}

async function executeRebalancePlan(orders) {
    if (!orders || orders.length === 0) return;

    // Execute SELLs first to free up liquidity
    const sells = orders.filter(o => o.action === 'SELL');
    const buys = orders.filter(o => o.action === 'BUY');

    sells.forEach(o => {
        executeTradeOrder({
            side: 'SELL',
            symbol: o.symbol,
            shares: o.sharesToTrade,
            price: o.price,
            deductCash: true,
            isRebalance: true
        });
    });

    buys.forEach(o => {
        executeTradeOrder({
            side: 'BUY',
            symbol: o.symbol,
            shares: o.sharesToTrade,
            price: o.price,
            deductCash: true,
            isRebalance: true
        });
    });

    saveState();
    showToast(`Executed ${orders.length} rebalancing orders successfully!`);
    await refreshMarketData();
    renderWorkstation();
}

// 6. Cash Book & Trade Execution Ledger Tab
function renderLedgerTab() {
    const tbody = document.getElementById('pms-ledger-tbody');
    if (!tbody) return;

    if (state.transactions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="table-empty-state">No transaction history recorded yet.</td></tr>`;
        return;
    }

    const sorted = [...state.transactions].reverse();
    let rowsHtml = '';

    sorted.forEach(tx => {
        let typeBadge = '';
        if (tx.type === 'BUY') {
            typeBadge = `<span class="pms-tx-badge buy">BUY</span>`;
        } else if (tx.type === 'SELL') {
            typeBadge = `<span class="pms-tx-badge sell">SELL</span>`;
        } else if (tx.type === 'CASH_DEPOSIT') {
            typeBadge = `<span class="pms-tx-badge deposit">DEPOSIT</span>`;
        } else if (tx.type === 'CASH_WITHDRAW') {
            typeBadge = `<span class="pms-tx-badge withdraw">WITHDRAW</span>`;
        } else {
            typeBadge = `<span class="pms-tx-badge rebal">${escapeHtml(tx.type)}</span>`;
        }

        const dateStr = new Date(tx.timestamp).toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        const pnlStr = tx.type === 'SELL' && tx.realizedPnL != null
            ? `<span class="${tx.realizedPnL >= 0 ? 'text-emerald' : 'text-rose'}">${formatSignedCurrency(tx.realizedPnL)}</span>`
            : '—';

        rowsHtml += `
            <tr>
                <td>${dateStr}</td>
                <td>${typeBadge}</td>
                <td><strong>${escapeHtml(tx.symbol)}</strong></td>
                <td class="text-right">${formatNumber(tx.quantity, 2)}</td>
                <td class="text-right font-mono">${tx.price > 0 ? `$${tx.price.toFixed(2)}` : '—'}</td>
                <td class="text-right font-mono font-bold">${formatCurrency(tx.notional)}</td>
                <td class="text-right font-mono">${pnlStr}</td>
            </tr>
        `;
    });

    tbody.innerHTML = rowsHtml;
}

// ── Trade Order Execution Mechanics (Institutional Tax-Lot Accounting) ────────
function executeTradeOrder({ side, symbol, shares, price, deductCash = true, isRebalance = false }) {
    symbol = symbol.toUpperCase().trim();
    shares = parseFloat(shares);
    price = parseFloat(price);
    const notional = shares * price;

    if (!symbol || isNaN(shares) || shares <= 0 || isNaN(price) || price <= 0) {
        showToast('Invalid order parameters');
        return false;
    }

    let existingHolding = state.holdings.find(h => h.symbol === symbol);

    if (side === 'BUY') {
        if (deductCash) {
            state.cashBalance -= notional;
        }

        if (existingHolding) {
            const totalShares = existingHolding.shares + shares;
            const totalCost = (existingHolding.shares * existingHolding.avgCost) + notional;
            existingHolding.avgCost = totalCost / totalShares;
            existingHolding.shares = totalShares;
        } else {
            state.holdings.push({
                symbol,
                shares,
                avgCost: price
            });
        }

        state.transactions.push({
            id: 'tx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            timestamp: new Date().toISOString(),
            type: isRebalance ? 'REBAL_BUY' : 'BUY',
            symbol,
            quantity: shares,
            price,
            notional,
            realizedPnL: 0
        });

        return true;
    }

    if (side === 'SELL') {
        if (!existingHolding || existingHolding.shares < (shares - 0.0001)) {
            showToast(`Cannot sell ${shares} ${symbol}: only ${existingHolding ? existingHolding.shares.toFixed(2) : 0} owned.`);
            return false;
        }

        const realizedTradePnL = shares * (price - existingHolding.avgCost);
        state.realizedPnL += realizedTradePnL;

        if (deductCash) {
            state.cashBalance += notional;
        }

        existingHolding.shares -= shares;
        if (existingHolding.shares <= 0.0001) {
            state.holdings = state.holdings.filter(h => h.symbol !== symbol);
        }

        state.transactions.push({
            id: 'tx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            timestamp: new Date().toISOString(),
            type: isRebalance ? 'REBAL_SELL' : 'SELL',
            symbol,
            quantity: shares,
            price,
            notional,
            realizedPnL: realizedTradePnL
        });

        return true;
    }

    return false;
}

// ── Modals & Quick Action Handlers ─────────────────────────────────────────────
function openTrimModal(holding) {
    state.pendingTrimHolding = holding;
    const modal = document.getElementById('pms-trim-modal');
    if (!modal) return;

    document.getElementById('trim-modal-symbol').textContent = holding.symbol;
    document.getElementById('trim-modal-shares-owned').textContent = formatNumber(holding.shares, 2);
    document.getElementById('trim-modal-avg-cost').textContent = `$${holding.avgCost.toFixed(2)}`;
    document.getElementById('trim-modal-live-price').textContent = `$${holding.price.toFixed(2)}`;

    const qtyInput = document.getElementById('trim-modal-qty-input');
    const priceInput = document.getElementById('trim-modal-price-input');
    qtyInput.value = (holding.shares * 0.5).toFixed(2);
    priceInput.value = holding.price.toFixed(2);

    updateTrimModalCalculations();
    modal.classList.remove('hidden-element');
}

function updateTrimModalCalculations() {
    const holding = state.pendingTrimHolding;
    if (!holding) return;

    const qty = parseFloat(document.getElementById('trim-modal-qty-input')?.value) || 0;
    const price = parseFloat(document.getElementById('trim-modal-price-input')?.value) || holding.price;

    const proceeds = qty * price;
    const pnl = qty * (price - holding.avgCost);
    const pnlPct = holding.avgCost > 0 ? ((price - holding.avgCost) / holding.avgCost) * 100 : 0;

    const proceedsEl = document.getElementById('trim-modal-est-proceeds');
    if (proceedsEl) proceedsEl.textContent = formatCurrency(proceeds);

    const pnlEl = document.getElementById('trim-modal-est-pnl');
    if (pnlEl) {
        pnlEl.textContent = `${formatSignedCurrency(pnl)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`;
        applyColorClass(pnlEl, pnl);
    }
}

function closeTrimModal() {
    const modal = document.getElementById('pms-trim-modal');
    if (modal) modal.classList.add('hidden-element');
    state.pendingTrimHolding = null;
}

function openCashModal() {
    const modal = document.getElementById('pms-cash-modal');
    if (!modal) return;
    const balEl = document.getElementById('cash-modal-current-bal');
    if (balEl) balEl.textContent = formatCurrency(state.cashBalance);
    modal.classList.remove('hidden-element');
}

function closeCashModal() {
    const modal = document.getElementById('pms-cash-modal');
    if (modal) modal.classList.add('hidden-element');
}

// ── Event Handlers & User Interactions ─────────────────────────────────────────
function setupEventHandlers() {
    // 1. Refresh Button
    document.getElementById('pms-refresh-btn')?.addEventListener('click', async () => {
        await refreshMarketData();
        renderWorkstation();
        showToast('Quotes refreshed from live feeds.');
    });

    // 2. Segmented Tabs
    document.querySelectorAll('.pms-segmented-tabs .pms-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.pms-segmented-tabs .pms-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const targetTab = btn.getAttribute('data-tab');
            state.activeTab = targetTab;

            document.querySelectorAll('.pms-tab-content').forEach(p => p.classList.remove('active'));
            const targetPane = document.getElementById(`pms-tab-${targetTab}`);
            if (targetPane) targetPane.classList.add('active');

            if (targetTab === 'performance') {
                renderPerformanceTab();
            } else if (targetTab === 'rebalancer') {
                renderRebalancerTab(calculateNAVMetrics());
            } else if (targetTab === 'ledger') {
                renderLedgerTab();
            }
        });
    });

    // 3. Quick Trade Ticket: Live Price Auto-Fill
    const tickerInput = document.getElementById('portfolio-ticker-input');
    const priceInput = document.getElementById('portfolio-price-input');
    const sharesInput = document.getElementById('portfolio-shares-input');
    const totalValEl = document.getElementById('pms-ticket-total-val');

    const updateTicketTotal = () => {
        const q = parseFloat(sharesInput?.value) || 0;
        const p = parseFloat(priceInput?.value) || 0;
        if (totalValEl) totalValEl.textContent = formatCurrency(q * p);
    };

    sharesInput?.addEventListener('input', updateTicketTotal);
    priceInput?.addEventListener('input', updateTicketTotal);

    document.getElementById('pms-fetch-price-btn')?.addEventListener('click', async () => {
        const sym = tickerInput?.value.toUpperCase().trim();
        if (!sym) return;
        showToast(`Fetching live quote for ${sym}…`);
        try {
            const snaps = await fetchPortfolioSnapshots([sym]);
            if (snaps && snaps[sym] && snaps[sym].price) {
                if (priceInput) priceInput.value = snaps[sym].price.toFixed(2);
                updateTicketTotal();
                showToast(`Live price for ${sym}: $${snaps[sym].price.toFixed(2)}`);
            } else {
                showToast(`Could not find live quote for ${sym}. Enter execution price manually.`);
            }
        } catch (e) {
            showToast(`Quote lookup error: ${e.message}`);
        }
    });

    // 4. Submit Quick Trade Ticket
    document.getElementById('pms-trade-ticket-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const side = document.getElementById('portfolio-side-select')?.value || 'BUY';
        const symbol = tickerInput?.value.toUpperCase().trim();
        const shares = parseFloat(sharesInput?.value);
        const price = parseFloat(priceInput?.value);
        const deductCash = document.getElementById('portfolio-deduct-cash-toggle')?.checked ?? true;

        const success = executeTradeOrder({ side, symbol, shares, price, deductCash });
        if (success) {
            saveState();
            showToast(`Order Executed: ${side} ${shares} ${symbol} @ $${price.toFixed(2)}`);
            tickerInput.value = '';
            sharesInput.value = '';
            priceInput.value = '';
            updateTicketTotal();
            await refreshMarketData();
            renderWorkstation();
        }
    });

    // 5. Visual Mode Toggle (Sectors vs Waterfall)
    document.getElementById('pms-vis-toggle-sector')?.addEventListener('click', () => {
        document.getElementById('pms-vis-toggle-sector').classList.add('active');
        document.getElementById('pms-vis-toggle-waterfall').classList.remove('active');
        document.getElementById('pms-sector-view').style.display = 'flex';
        document.getElementById('pms-waterfall-view').style.display = 'none';
    });

    document.getElementById('pms-vis-toggle-waterfall')?.addEventListener('click', () => {
        document.getElementById('pms-vis-toggle-waterfall').classList.add('active');
        document.getElementById('pms-vis-toggle-sector').classList.remove('active');
        document.getElementById('pms-sector-view').style.display = 'none';
        document.getElementById('pms-waterfall-view').style.display = 'block';
        renderPnlWaterfallChart(calculateNAVMetrics());
    });

    // 6. Blotter Table Search & Sort
    document.getElementById('pms-blotter-search')?.addEventListener('input', (e) => {
        state.filterQuery = e.target.value.trim();
        renderHoldingsBlotter(calculateNAVMetrics());
    });

    document.querySelectorAll('#pms-holdings-table th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.getAttribute('data-sort');
            if (state.sortField === field) {
                state.sortAsc = !state.sortAsc;
            } else {
                state.sortField = field;
                state.sortAsc = false;
            }
            renderHoldingsBlotter(calculateNAVMetrics());
        });
    });

    // 7. Timeframe Toggle in Performance Tab
    document.querySelectorAll('.pms-timeframe-toggle .pill-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.pms-timeframe-toggle .pill-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.perfTimeframe = btn.getAttribute('data-tf');
            renderPerformanceTab();
        });
    });

    // 8. Rebalance Preset Buttons
    document.getElementById('rebal-opt-equal')?.addEventListener('click', () => {
        const metrics = calculateNAVMetrics();
        const N = metrics.enrichedHoldings.length;
        if (N === 0) return;
        const targetPerHolding = (95.0 / N);
        state.targetWeights = {};
        metrics.enrichedHoldings.forEach(h => {
            state.targetWeights[h.symbol] = parseFloat(targetPerHolding.toFixed(1));
        });
        state.targetWeights['CASH'] = 5.0;
        renderRebalancerTab(metrics);
        showToast('Set Equal-Weight Target Allocation (5% Cash).');
    });

    document.getElementById('rebal-opt-inverse-beta')?.addEventListener('click', () => {
        const metrics = calculateNAVMetrics();
        const N = metrics.enrichedHoldings.length;
        if (N === 0) return;

        let sumInvBeta = 0;
        metrics.enrichedHoldings.forEach(h => {
            const invBeta = 1 / Math.max(0.2, h.beta);
            sumInvBeta += invBeta;
        });

        state.targetWeights = {};
        metrics.enrichedHoldings.forEach(h => {
            const invBeta = 1 / Math.max(0.2, h.beta);
            const w = (invBeta / sumInvBeta) * 95.0;
            state.targetWeights[h.symbol] = parseFloat(w.toFixed(1));
        });
        state.targetWeights['CASH'] = 5.0;
        renderRebalancerTab(metrics);
        showToast('Set Inverse-Beta Defensive Allocation (5% Cash).');
    });

    document.getElementById('rebal-opt-dividend')?.addEventListener('click', () => {
        const metrics = calculateNAVMetrics();
        const N = metrics.enrichedHoldings.length;
        if (N === 0) return;

        let sumYield = 0;
        metrics.enrichedHoldings.forEach(h => {
            sumYield += Math.max(0.5, h.dividendYield);
        });

        state.targetWeights = {};
        metrics.enrichedHoldings.forEach(h => {
            const w = (Math.max(0.5, h.dividendYield) / sumYield) * 95.0;
            state.targetWeights[h.symbol] = parseFloat(w.toFixed(1));
        });
        state.targetWeights['CASH'] = 5.0;
        renderRebalancerTab(metrics);
        showToast('Set Dividend Income Tilt Allocation (5% Cash).');
    });

    document.getElementById('rebal-reset-btn')?.addEventListener('click', () => {
        const metrics = calculateNAVMetrics();
        state.targetWeights = {};
        metrics.enrichedHoldings.forEach(h => {
            state.targetWeights[h.symbol] = parseFloat(h.navWeight.toFixed(1));
        });
        const cashW = metrics.totalNAV > 0 ? (state.cashBalance / metrics.totalNAV) * 100 : 0;
        state.targetWeights['CASH'] = parseFloat(cashW.toFixed(1));
        renderRebalancerTab(metrics);
        showToast('Reset target weights to current actual weights.');
    });

    document.getElementById('pms-normalize-targets-btn')?.addEventListener('click', () => {
        const total = Object.values(state.targetWeights || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
        if (total <= 0) return;
        const scale = 100 / total;
        for (const k in state.targetWeights) {
            state.targetWeights[k] = parseFloat((state.targetWeights[k] * scale).toFixed(1));
        }
        renderRebalancerTab(calculateNAVMetrics());
        showToast('Targets normalized to 100.0%.');
    });

    // 9. Load Starter Preset Dropdown
    document.getElementById('pms-preset-select')?.addEventListener('change', async (e) => {
        const presetKey = e.target.value;
        if (presetKey) {
            await loadInstitutionalTemplate(presetKey);
            e.target.value = '';
        }
    });

    // 10. Cash Management Modal
    document.getElementById('pms-manage-cash-btn')?.addEventListener('click', openCashModal);
    document.getElementById('pms-close-cash-modal-btn')?.addEventListener('click', closeCashModal);

    document.getElementById('pms-confirm-cash-btn')?.addEventListener('click', () => {
        const action = document.getElementById('cash-modal-action-select')?.value || 'DEPOSIT';
        const amt = parseFloat(document.getElementById('cash-modal-amount-input')?.value);
        if (isNaN(amt) || amt <= 0) {
            showToast('Please enter a valid cash amount.');
            return;
        }

        if (action === 'WITHDRAW' && amt > state.cashBalance) {
            showToast(`Insufficient cash: available balance is ${formatCurrency(state.cashBalance)}.`);
            return;
        }

        if (action === 'DEPOSIT') {
            state.cashBalance += amt;
            state.transactions.push({
                id: 'tx-' + Date.now(),
                timestamp: new Date().toISOString(),
                type: 'CASH_DEPOSIT',
                symbol: 'USD',
                quantity: amt,
                price: 1,
                notional: amt,
                realizedPnL: 0
            });
            showToast(`Deposited ${formatCurrency(amt)} into cash reserve.`);
        } else {
            state.cashBalance -= amt;
            state.transactions.push({
                id: 'tx-' + Date.now(),
                timestamp: new Date().toISOString(),
                type: 'CASH_WITHDRAW',
                symbol: 'USD',
                quantity: amt,
                price: 1,
                notional: amt,
                realizedPnL: 0
            });
            showToast(`Withdrew ${formatCurrency(amt)} from cash reserve.`);
        }

        saveState();
        closeCashModal();
        renderWorkstation();
    });

    // 11. Trim / Sell Modal Actions
    document.getElementById('pms-close-trim-modal-btn')?.addEventListener('click', closeTrimModal);

    document.querySelectorAll('.pms-chip-btn[data-pct]').forEach(btn => {
        btn.addEventListener('click', () => {
            const pct = parseFloat(btn.getAttribute('data-pct')) || 100;
            const holding = state.pendingTrimHolding;
            if (holding) {
                const qtyInput = document.getElementById('trim-modal-qty-input');
                if (qtyInput) {
                    qtyInput.value = (holding.shares * (pct / 100)).toFixed(2);
                    updateTrimModalCalculations();
                }
            }
        });
    });

    document.getElementById('trim-modal-qty-input')?.addEventListener('input', updateTrimModalCalculations);
    document.getElementById('trim-modal-price-input')?.addEventListener('input', updateTrimModalCalculations);

    document.getElementById('pms-confirm-trim-btn')?.addEventListener('click', () => {
        const holding = state.pendingTrimHolding;
        if (!holding) return;

        const qty = parseFloat(document.getElementById('trim-modal-qty-input')?.value);
        const price = parseFloat(document.getElementById('trim-modal-price-input')?.value);

        const success = executeTradeOrder({
            side: 'SELL',
            symbol: holding.symbol,
            shares: qty,
            price,
            deductCash: true
        });

        if (success) {
            saveState();
            closeTrimModal();
            showToast(`Trim Executed: Sold ${qty} ${holding.symbol} @ $${price.toFixed(2)}`);
            renderWorkstation();
        }
    });

    // 12. Send to Stress Tester Button
    document.getElementById('pms-to-stress-btn')?.addEventListener('click', () => {
        saveState();
        showToast('Syncing book to Stress Tester…');
        setTimeout(() => {
            window.location.href = 'stress.html';
        }, 300);
    });

    // 13. Export Blotter as CSV
    document.getElementById('pms-export-csv-btn')?.addEventListener('click', exportBlotterCSV);

    // 14. Clear / Reset Portfolio Button
    document.getElementById('pms-clear-portfolio-btn')?.addEventListener('click', () => {
        if (confirm('Are you sure you want to completely clear this portfolio book and transaction ledger?')) {
            state.holdings = [];
            state.transactions = [];
            state.realizedPnL = 0;
            state.cashBalance = 100000;
            state.startingCapital = 100000;
            state.targetWeights = {};
            saveState();
            renderWorkstation();
            showToast('Portfolio cleared. Reset to $100,000 cash.');
        }
    });
}

// ── Template Loading Helper ────────────────────────────────────────────────────
async function loadInstitutionalTemplate(key, silent = false) {
    const template = STARTER_PRESETS[key];
    if (!template) return;

    if (!silent) {
        showToast(`Loading "${template.name}"…`);
    }

    const symbols = template.allocations.map(a => a.symbol);
    const snapshots = await fetchPortfolioSnapshots(symbols);
    state.marketData = { ...state.marketData, ...snapshots };

    state.holdings = [];
    state.transactions = [];
    state.realizedPnL = 0;
    state.cashBalance = template.cash;
    state.startingCapital = 100000;

    template.allocations.forEach(alloc => {
        const snap = snapshots[alloc.symbol] || {};
        const price = snap.price || 100;
        const shares = parseFloat((alloc.targetVal / price).toFixed(2));
        executeTradeOrder({
            side: 'BUY',
            symbol: alloc.symbol,
            shares,
            price,
            deductCash: false
        });
    });

    saveState();
    if (!silent) {
        showToast(`Loaded ${template.name}!`);
    }
    await refreshMarketData();
    renderWorkstation();
}

// ── CSV Export Routine ─────────────────────────────────────────────────────────
function exportBlotterCSV() {
    const metrics = calculateNAVMetrics();
    const rows = [
        ['Symbol', 'Name', 'Sector', 'Shares', 'AvgCost', 'LivePrice', 'DayChangeDollar', 'DayChangePct', 'MarketValue', 'NAVWeightPct', 'UnrealizedPnLDollar', 'UnrealizedPnLPct', 'Beta', 'DivYieldPct']
    ];

    metrics.enrichedHoldings.forEach(h => {
        rows.push([
            h.symbol,
            `"${(h.name || '').replace(/"/g, '""')}"`,
            `"${(h.sector || '').replace(/"/g, '""')}"`,
            h.shares.toFixed(2),
            h.avgCost.toFixed(2),
            h.price.toFixed(2),
            h.change.toFixed(2),
            h.changePercent.toFixed(2),
            h.marketValue.toFixed(2),
            h.navWeight.toFixed(2),
            h.unrealizedPnL.toFixed(2),
            h.unrealizedPnLPct.toFixed(2),
            h.beta.toFixed(2),
            h.dividendYield.toFixed(2)
        ]);
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(r => r.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `strata_portfolio_blotter_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Exported holdings blotter as CSV.');
}

// ── UI Formatting Helpers ──────────────────────────────────────────────────────
function formatCurrency(val) {
    if (val == null || isNaN(val)) return '$0';
    return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatSignedCurrency(val) {
    if (val == null || isNaN(val)) return '$0';
    const num = Number(val);
    const sign = num >= 0 ? '+' : '-';
    return `${sign}$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatNumber(val, decimals = 2) {
    if (val == null || isNaN(val)) return '0';
    return Number(val).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function applyColorClass(el, val) {
    if (!el) return;
    el.classList.remove('text-emerald', 'text-rose');
    if (val > 0) el.classList.add('text-emerald');
    else if (val < 0) el.classList.add('text-rose');
}

function applyBadgeColor(el, val) {
    if (!el) return;
    el.classList.remove('positive-badge', 'negative-badge');
    if (val >= 0) el.classList.add('positive-badge');
    else el.classList.add('negative-badge');
}

function updateElemText(id, text, signVal = null) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (signVal != null) {
        applyColorClass(el, signVal);
    }
}
