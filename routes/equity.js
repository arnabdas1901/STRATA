const express = require('express');
const router = express.Router();

const { requireTicker } = require('../utils/api');
const {
    fetchFmpMetrics,
    fetchFinnhubHistory,
    fetchYahooProfile,
    fetchYahooQuote,
    fetchYahooTimeSeries,
    fetchYahooChart,
    fetchTwelveDataQuote,
    resolveCachedQuote,
    resolveCachedProfile,
    resolveCachedMetrics,
    resolveCachedRecommendations,
    resolveCachedPeers
} = require('../utils/equityProviders');
const { fetchCompanyFacts } = require('../utils/secProviders');
const { getAiProvider, generateAiAnalysis } = require('../utils/aiProviders');
const { MemoryCache, SingletonCache } = require('../utils/cache');

async function fetchWithTimeout(url, options = {}) {
    const timeoutMs = typeof options === 'number' ? options : (options.timeout || 10000);
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const fetchOptions = typeof options === 'object' ? { ...options } : {};
        if (!fetchOptions.signal) {
            fetchOptions.signal = controller.signal;
        }
        const response = await fetch(url, fetchOptions);
        clearTimeout(id);
        return response;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

// Single-Source-of-Truth Registered Memory Caches
const TIME_SERIES_CACHE = new MemoryCache('equity-time-series', 60 * 60 * 1000, 150);
const STATEMENTS_CACHE = new MemoryCache('equity-statements', 24 * 60 * 60 * 1000, 100);
const NEWS_CACHE = new SingletonCache('equity-news', 15 * 60 * 1000);
const EARNINGS_CACHE = new MemoryCache('equity-earnings', 6 * 60 * 60 * 1000, 100);
const DIVIDENDS_CACHE = new MemoryCache('equity-dividends', 6 * 60 * 60 * 1000, 100);
const INSIDER_CACHE = new MemoryCache('equity-insider', 6 * 60 * 60 * 1000, 100);
const MOVERS_CACHE = new SingletonCache('equity-movers', 15 * 60 * 1000);
const SECTOR_CACHE = new SingletonCache('equity-sectors', 30 * 60 * 1000);

// Historical Time-Series (Charts)
router.get('/twelvedata/time_series', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;
    const timeframe = String(req.query.timeframe || '1Y').toUpperCase();

    const cacheKey = `${symbol.toUpperCase()}_${timeframe}`;
    const cached = TIME_SERIES_CACHE.getData(cacheKey);
    if (cached) {
        return res.json(cached);
    }

    const timeframeConfig = {
        '1M': { interval: '1day', outputsize: 30 },
        '1Y': { interval: '1day', outputsize: 252 },
        '5Y': { interval: '1week', outputsize: 260 },
        'MAX': { interval: '1month', outputsize: 120 }
    };

    const config = timeframeConfig[timeframe];
    if (!config) {
        return res.status(400).json({ error: 'Valid timeframe is required' });
    }

    try {
        let chartData = null;
        if (process.env.TWELVEDATA_API_KEY) {
            try {
                const response = await fetchWithTimeout(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${config.interval}&outputsize=${config.outputsize}&apikey=${process.env.TWELVEDATA_API_KEY}`, 5000);
                const data = await response.json();
                if (data && data.status !== 'error' && Array.isArray(data.values) && data.values.length > 0) {
                    chartData = data;
                }
            } catch (err) {
                console.warn('TwelveData time series fetch failed:', err.message);
            }
        }

        if (!chartData) {
            // Priority 1 Fallback: Yahoo Finance Historical Bars (Fast & Accurate)
            const yahooBars = await fetchYahooTimeSeries(symbol, timeframe);
            if (yahooBars && Array.isArray(yahooBars.values) && yahooBars.values.length > 0) {
                chartData = yahooBars;
            }
        }

        if (!chartData) {
            // Priority 2 Fallback: Polygon or Finnhub
            const fallback = await tryPolygonFallback(symbol, timeframe) || await tryFinnhubFallback(symbol, timeframe);
            if (fallback) {
                chartData = fallback;
            }
        }

        if (chartData && Array.isArray(chartData.values)) {
            TIME_SERIES_CACHE.set(cacheKey, chartData);
            return res.json(chartData);
        }

        return res.status(500).json({ error: 'No time series values returned' });
    } catch (error) {
        console.error("TwelveData Time Series Error:", error);
        const fallback = await fetchYahooTimeSeries(symbol, timeframe) || await tryPolygonFallback(symbol, timeframe) || await tryFinnhubFallback(symbol, timeframe);
        if (fallback) {
            TIME_SERIES_CACHE.set(cacheKey, fallback);
            return res.json(fallback);
        }
        res.status(500).json({ error: "Failed to fetch historical data" });
    }
});

// Key Financial Metrics & Company Profile Endpoints (Unified Cached Resolvers)
router.get('/finnhub/profile', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;
    try {
        const profile = await resolveCachedProfile(symbol);
        return res.json(profile);
    } catch (error) {
        console.error("Company Profile Error:", error);
        return res.json({
            ticker: symbol.toUpperCase(),
            name: `${symbol.toUpperCase()} Asset`,
            country: 'US',
            currency: 'USD',
            exchange: 'US Markets',
            finnhubIndustry: 'Equities',
            logo: '',
            weburl: ''
        });
    }
});

router.get('/finnhub/metrics', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;
    try {
        const metrics = await resolveCachedMetrics(symbol);
        return res.json(metrics);
    } catch (error) {
        console.error("Finnhub Metrics Error:", error);
        res.json({ metric: {} });
    }
});

router.get('/finnhub/quote', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;
    try {
        const quote = await resolveCachedQuote(symbol);
        return res.json(quote);
    } catch (error) {
        console.error("Finnhub Quote Error:", error);
        res.status(500).json({ error: "Failed to fetch real-time quote" });
    }
});

async function tryPolygonFallback(symbol, timeframe) {
    if (!process.env.POLYGON_API_KEY) {
        return null;
    }

    let multiplier = 1;
    let timespan = 'day';
    let days = 365;

    if (timeframe === '1M') {
        multiplier = 1;
        timespan = 'day';
        days = 30;
    } else if (timeframe === '1Y') {
        multiplier = 1;
        timespan = 'day';
        days = 365;
    } else if (timeframe === '5Y') {
        multiplier = 1;
        timespan = 'week';
        days = 365 * 5;
    } else if (timeframe === 'MAX') {
        multiplier = 1;
        timespan = 'month';
        days = 365 * 10;
    }

    try {
        const endDateStr = new Date().toISOString().split('T')[0];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString().split('T')[0];

        const ticker = symbol.toUpperCase();
        const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${startDateStr}/${endDateStr}?adjusted=true&sort=asc&apiKey=${process.env.POLYGON_API_KEY}`;
        
        const response = await fetchWithTimeout(url);
        const data = await response.json();

        if ((data.status === 'OK' || data.status === 'DELAYED') && data.results && data.results.length > 0) {
            const values = data.results.map(r => ({
                datetime: new Date(r.t).toISOString().slice(0, 10),
                open: r.o,
                high: r.h,
                low: r.l,
                close: r.c,
                volume: r.v
            })).reverse();

            return { values };
        }
    } catch (err) {
        console.warn('Polygon stock history fallback failed:', err.message);
    }
    return null;
}

async function tryFinnhubFallback(symbol, timeframe) {
    if (!process.env.FINNHUB_API_KEY) {
        return null;
    }

    const now = Math.floor(Date.now() / 1000);
    let resolution = 'D';
    let days = 365;

    if (timeframe === '1M') {
        resolution = 'D';
        days = 30;
    } else if (timeframe === '1Y') {
        resolution = 'D';
        days = 365;
    } else if (timeframe === '5Y') {
        resolution = 'W';
        days = 365 * 5;
    } else if (timeframe === 'MAX') {
        resolution = 'M';
        days = 365 * 10;
    }

    const from = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
    const fh = await fetchFinnhubHistory(symbol, from, now, resolution);
    if (fh?.error || !Array.isArray(fh?.t) || fh.t.length === 0) {
        console.warn('Finnhub fallback did not return usable data:', fh);
        return null;
    }

    const values = fh.t.map((timestamp, index) => ({
        datetime: new Date(timestamp * 1000).toISOString().slice(0, 10),
        open: fh.o[index],
        high: fh.h[index],
        low: fh.l[index],
        close: fh.c[index],
        volume: fh.v[index]
    })).reverse();

    return { values };
}



async function getSecStatementsFallback(symbol, type) {
    try {
        const facts = await fetchCompanyFacts(symbol);
        if (!facts || !facts.facts) return null;

        const getAnnualVals = (conceptList) => {
            let taxonomy = 'us-gaap';
            if (!facts.facts['us-gaap'] && facts.facts['ifrs-full']) taxonomy = 'ifrs-full';
            if (!facts.facts[taxonomy]) return [];
            let concept = null;
            for (const c of conceptList) {
                if (facts.facts[taxonomy][c]) {
                    concept = c;
                    break;
                }
            }
            if (!concept && taxonomy === 'us-gaap' && facts.facts['ifrs-full']) {
                for (const c of conceptList) {
                    if (facts.facts['ifrs-full'][c]) {
                        taxonomy = 'ifrs-full';
                        concept = c;
                        break;
                    }
                }
            }
            if (!concept) return [];
            const cData = facts.facts[taxonomy][concept];
            if (!cData.units) return [];
            const unit = Object.keys(cData.units)[0];
            if (!unit || !cData.units[unit]) return [];
            const records = (cData.units[unit] || []).filter(r => (r.form === '10-K' || r.form === '20-F' || r.form === '40-F') && !r.segment);
            const byFy = {};
            for (const r of records) {
                const fy = r.fy || (r.end ? parseInt(r.end.slice(0, 4), 10) : null);
                if (fy) {
                    if (!byFy[fy] || new Date(r.filed || 0) > new Date(byFy[fy].filed || 0)) {
                        byFy[fy] = { fy, val: r.val, end: r.end };
                    }
                }
            }
            return Object.values(byFy).sort((a, b) => b.fy - a.fy); // descending, newest first
        };

        if (type === 'balance_sheet') {
            const assets = getAnnualVals(['Assets']);
            const liab = getAnnualVals(['Liabilities']);
            const eq = getAnnualVals(['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest']);
            const cash = getAnnualVals(['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents']);
            const curAssets = getAnnualVals(['AssetsCurrent']);
            const stDebt = getAnnualVals(['ShortTermBorrowings', 'DebtCurrent']);
            const ltDebt = getAnnualVals(['LongTermDebtNoncurrent', 'LongTermDebt']);

            const years = Array.from(new Set([...assets.map(r => r.fy), ...eq.map(r => r.fy)])).filter(Boolean).sort((a, b) => b - a).slice(0, 4);
            if (years.length === 0) return null;

            const list = years.map(fy => {
                const getV = arr => { const found = arr.find(x => x.fy === fy); return found ? found.val : null; };
                return {
                    fiscal_date: String(fy),
                    year: fy,
                    total_assets: getV(assets),
                    total_liabilities: getV(liab),
                    total_shareholders_equity: getV(eq),
                    cash_and_equivalents: getV(cash),
                    total_current_assets: getV(curAssets),
                    short_term_debt: getV(stDebt),
                    long_term_debt: getV(ltDebt)
                };
            });
            return { balance_sheet: list };
        } else if (type === 'cash_flow') {
            const ocf = getAnnualVals(['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations']);
            const capex = getAnnualVals(['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'CapitalExpendituresIncurredButNotYetPaid']);
            const icf = getAnnualVals(['NetCashProvidedByUsedInInvestingActivities', 'NetCashProvidedByUsedInInvestingActivitiesContinuingOperations']);
            const fcf = getAnnualVals(['NetCashProvidedByUsedInFinancingActivities', 'NetCashProvidedByUsedInFinancingActivitiesContinuingOperations']);

            const years = Array.from(new Set([...ocf.map(r => r.fy), ...capex.map(r => r.fy)])).filter(Boolean).sort((a, b) => b - a).slice(0, 4);
            if (years.length === 0) return null;

            const list = years.map(fy => {
                const getV = arr => { const found = arr.find(x => x.fy === fy); return found ? found.val : 0; };
                const ocfVal = getV(ocf);
                const capexVal = getV(capex);
                return {
                    fiscal_date: String(fy),
                    year: fy,
                    operating_cash_flow: ocfVal,
                    investing_cash_flow: getV(icf),
                    financing_cash_flow: getV(fcf),
                    net_change_in_cash: ocfVal + getV(icf) + getV(fcf),
                    capital_expenditures: capexVal,
                    free_cash_flow: ocfVal - capexVal
                };
            });
            return { cash_flow: list };
        } else if (type === 'income_statement') {
            const rev = getAnnualVals(['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'SalesRevenueGoodsNet', 'RevenuesNetOfInterestExpense', 'InterestAndDividendIncomeOperating']);
            const cost = getAnnualVals(['CostOfGoodsAndServicesSold', 'CostOfRevenue']);
            const gp = getAnnualVals(['GrossProfit']);
            const opInc = getAnnualVals(['OperatingIncomeLoss']);
            const ni = getAnnualVals(['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic']);
            const eps = getAnnualVals(['EarningsPerShareDiluted', 'EarningsPerShareBasic']);

            const years = Array.from(new Set([...rev.map(r => r.fy), ...ni.map(r => r.fy)])).filter(Boolean).sort((a, b) => b - a).slice(0, 4);
            if (years.length === 0) return null;

            const list = years.map(fy => {
                const getV = arr => { const found = arr.find(x => x.fy === fy); return found ? found.val : null; };
                const revVal = getV(rev);
                const costVal = getV(cost);
                const gpVal = getV(gp) || (revVal && costVal ? revVal - costVal : null);
                return {
                    fiscal_date: String(fy),
                    year: fy,
                    total_revenue: revVal,
                    cost_of_revenue: costVal,
                    gross_profit: gpVal,
                    operating_income: getV(opInc),
                    net_income: getV(ni),
                    eps_diluted: getV(eps)
                };
            });
            return { income_statement: list };
        }
    } catch (e) {
        console.warn('SEC statements fallback failed:', e.message);
    }
    return null;
}

// Financial Statements (Balance Sheet / Cash Flow)
router.get('/twelvedata/statements', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;
    const type = String(req.query.type || '').trim();
    const allowedStatementTypes = new Set(['balance_sheet', 'cash_flow', 'income_statement']);
    if (!allowedStatementTypes.has(type)) {
        return res.status(400).json({ error: 'Valid statement type is required' });
    }

    const cacheKey = `${symbol.toUpperCase()}_${type}`;
    const cached = STATEMENTS_CACHE.getData(cacheKey);
    if (cached) {
        return res.json(cached);
    }

    // Intercept res.json to cache successful responses
    const originalJson = res.json.bind(res);
    res.json = (payload) => {
        if (payload && !payload.error) {
            STATEMENTS_CACHE.set(cacheKey, payload);
        }
        return originalJson(payload);
    };

    try {
        let twelvedataFailed = false;
        let data = null;

        if (process.env.TWELVEDATA_API_KEY) {
            const response = await fetchWithTimeout(`https://api.twelvedata.com/${type}?symbol=${encodeURIComponent(symbol)}&apikey=${process.env.TWELVEDATA_API_KEY}`);
            data = await response.json();
            if (data?.status === 'error' || !data || data?.code >= 400 || !Array.isArray(data[type]) || data[type].length < 2) {
                twelvedataFailed = true;
            }
        } else {
            twelvedataFailed = true;
        }

        if (twelvedataFailed) {
            // Priority 1 Fallback: SEC EDGAR Audited 10-K XBRL Statements (Free, official, 4 full years)
            const secStmt = await getSecStatementsFallback(symbol, type);
            if (secStmt) {
                return res.json(secStmt);
            }

            const fmpKey = process.env.FMP_API_KEY || process.env.FINANCIAL_MODELING_PREP_API_KEY || process.env.FINANCIALMODELINGPREP_API_KEY;
            if (fmpKey) {
                try {
                    const fmpTypeMap = { balance_sheet: 'balance-sheet-statement', cash_flow: 'cash-flow-statement', income_statement: 'income-statement' };
                    const fmpType = fmpTypeMap[type];
                    const fmpUrl = `https://financialmodelingprep.com/api/v3/${fmpType}/${encodeURIComponent(symbol)}?limit=1&apikey=${fmpKey}`;
                    const fmpResponse = await fetchWithTimeout(fmpUrl);
                    const fmpData = await fmpResponse.json();

                    if (Array.isArray(fmpData) && fmpData.length > 0 && !fmpData[0]?.['Error Message']) {
                        if (type === 'balance_sheet') {
                            const list = fmpData.slice(0, 4).map(stmt => ({
                                fiscal_date: stmt.date || String(stmt.calendarYear || ''),
                                year: stmt.calendarYear ? parseInt(stmt.calendarYear, 10) : null,
                                total_assets: stmt.totalAssets,
                                total_liabilities: stmt.totalLiabilities,
                                total_shareholders_equity: stmt.totalStockholdersEquity || stmt.totalEquity,
                                cash_and_equivalents: stmt.cashAndCashEquivalents,
                                total_current_assets: stmt.totalCurrentAssets,
                                short_term_debt: stmt.shortTermDebt,
                                long_term_debt: stmt.longTermDebt
                            }));
                            return res.json({ balance_sheet: list });
                        } else if (type === 'cash_flow') {
                            const list = fmpData.slice(0, 4).map(stmt => ({
                                fiscal_date: stmt.date || String(stmt.calendarYear || ''),
                                year: stmt.calendarYear ? parseInt(stmt.calendarYear, 10) : null,
                                operating_cash_flow: stmt.operatingCashFlow,
                                investing_cash_flow: stmt.netCashUsedForInvestingActivites || stmt.netCashUsedForInvestingActivities,
                                financing_cash_flow: stmt.netCashUsedProvidedByFinancingActivities,
                                net_change_in_cash: stmt.netChangeInCash,
                                capital_expenditures: stmt.capitalExpenditure || 0
                            }));
                            return res.json({ cash_flow: list });
                        } else if (type === 'income_statement') {
                            const list = fmpData.slice(0, 4).map(stmt => ({
                                fiscal_date: stmt.date || String(stmt.calendarYear || ''),
                                year: stmt.calendarYear ? parseInt(stmt.calendarYear, 10) : null,
                                total_revenue: stmt.revenue,
                                cost_of_revenue: stmt.costOfRevenue,
                                gross_profit: stmt.grossProfit,
                                operating_income: stmt.operatingIncome,
                                net_income: stmt.netIncome,
                                ebitda: stmt.ebitda,
                                eps_diluted: stmt.epsdiluted
                            }));
                            return res.json({ income_statement: list });
                        }
                    }
                } catch (fmpErr) {
                    console.warn("FMP statement fallback attempt failed:", fmpErr);
                }
            }

            // AlphaVantage statement fallback
            if (process.env.ALPHAVANTAGE_API_KEY) {
                try {
                    const avFuncMap = { balance_sheet: 'BALANCE_SHEET', cash_flow: 'CASH_FLOW', income_statement: 'INCOME_STATEMENT' };
                    const avFunc = avFuncMap[type];
                    const avUrl = `https://www.alphavantage.co/query?function=${avFunc}&symbol=${encodeURIComponent(symbol)}&apikey=${process.env.ALPHAVANTAGE_API_KEY}`;
                    const avResponse = await fetchWithTimeout(avUrl);
                    const avData = await avResponse.json();

                    if (avData.annualReports && avData.annualReports.length > 0) {
                        const reports = avData.annualReports.slice(0, 4);
                        if (type === 'balance_sheet') {
                            const list = reports.map(stmt => ({
                                fiscal_date: stmt.fiscalDateEnding || '',
                                year: stmt.fiscalDateEnding ? parseInt(stmt.fiscalDateEnding.slice(0, 4), 10) : null,
                                total_assets: stmt.totalAssets && stmt.totalAssets !== 'None' ? Number(stmt.totalAssets) : null,
                                total_liabilities: stmt.totalLiabilities && stmt.totalLiabilities !== 'None' ? Number(stmt.totalLiabilities) : null,
                                total_shareholders_equity: stmt.totalShareholderEquity && stmt.totalShareholderEquity !== 'None' ? Number(stmt.totalShareholderEquity) : null,
                                cash_and_equivalents: stmt.cashAndCashEquivalentsAtCarryingValue && stmt.cashAndCashEquivalentsAtCarryingValue !== 'None' ? Number(stmt.cashAndCashEquivalentsAtCarryingValue) : null,
                                total_current_assets: stmt.totalCurrentAssets && stmt.totalCurrentAssets !== 'None' ? Number(stmt.totalCurrentAssets) : null,
                                short_term_debt: stmt.shortTermDebt && stmt.shortTermDebt !== 'None' ? Number(stmt.shortTermDebt) : null,
                                long_term_debt: stmt.longTermDebt && stmt.longTermDebt !== 'None' ? Number(stmt.longTermDebt) : null
                            }));
                            return res.json({ balance_sheet: list });
                        } else if (type === 'cash_flow') {
                            const list = reports.map(stmt => {
                                const operating = stmt.operatingCashflow && stmt.operatingCashflow !== 'None' ? Number(stmt.operatingCashflow) : 0;
                                const investing = stmt.cashflowFromInvestment && stmt.cashflowFromInvestment !== 'None' ? Number(stmt.cashflowFromInvestment) : 0;
                                const financing = stmt.cashflowFromFinancing && stmt.cashflowFromFinancing !== 'None' ? Number(stmt.cashflowFromFinancing) : 0;
                                const netChange = stmt.changeInCashAndCashEquivalents && stmt.changeInCashAndCashEquivalents !== 'None' ? Number(stmt.changeInCashAndCashEquivalents) : (operating + investing + financing);
                                const capex = stmt.capitalExpenditures && stmt.capitalExpenditures !== 'None' ? Number(stmt.capitalExpenditures) : 0;
                                return {
                                    fiscal_date: stmt.fiscalDateEnding || '',
                                    year: stmt.fiscalDateEnding ? parseInt(stmt.fiscalDateEnding.slice(0, 4), 10) : null,
                                    operating_cash_flow: operating,
                                    investing_cash_flow: investing,
                                    financing_cash_flow: financing,
                                    net_change_in_cash: netChange,
                                    capital_expenditures: capex
                                };
                            });
                            return res.json({ cash_flow: list });
                        } else if (type === 'income_statement') {
                            const list = reports.map(stmt => ({
                                fiscal_date: stmt.fiscalDateEnding || '',
                                year: stmt.fiscalDateEnding ? parseInt(stmt.fiscalDateEnding.slice(0, 4), 10) : null,
                                total_revenue: stmt.totalRevenue && stmt.totalRevenue !== 'None' ? Number(stmt.totalRevenue) : null,
                                cost_of_revenue: stmt.costOfRevenue && stmt.costOfRevenue !== 'None' ? Number(stmt.costOfRevenue) : null,
                                gross_profit: stmt.grossProfit && stmt.grossProfit !== 'None' ? Number(stmt.grossProfit) : null,
                                operating_income: stmt.operatingIncome && stmt.operatingIncome !== 'None' ? Number(stmt.operatingIncome) : null,
                                net_income: stmt.netIncome && stmt.netIncome !== 'None' ? Number(stmt.netIncome) : null,
                                ebitda: stmt.ebitda && stmt.ebitda !== 'None' ? Number(stmt.ebitda) : null,
                                eps_diluted: stmt.dilutedEPS && stmt.dilutedEPS !== 'None' ? Number(stmt.dilutedEPS) : null
                            }));
                            return res.json({ income_statement: list });
                        }
                    }
                } catch (avErr) {
                    console.warn("AlphaVantage statement fallback failed:", avErr);
                }
            }
        } else {
            // Normalise TwelveData response format to standard flat format (multi-year)
            if (data && !data.error) {
                if (type === 'balance_sheet') {
                    if (Array.isArray(data.balance_sheet) && data.balance_sheet.length > 0) {
                        const list = data.balance_sheet.slice(0, 4).map(stmt => {
                            const total_assets = stmt.assets?.total_assets ?? stmt.total_assets ?? stmt.totalAssets;
                            const total_liabilities = stmt.liabilities?.total_liabilities ?? stmt.total_liabilities ?? stmt.totalLiabilities;
                            const total_shareholders_equity = stmt.shareholders_equity?.total_shareholders_equity ?? stmt.total_shareholders_equity ?? stmt.totalEquity;
                            const cash_and_equivalents = stmt.assets?.current_assets?.cash_and_cash_equivalents ?? stmt.assets?.current_assets?.cash_equivalents ?? stmt.assets?.current_assets?.cash ?? stmt.assets?.cash_and_equivalents ?? stmt.cash_and_equivalents ?? stmt.cashAndCashEquivalents;
                            const total_current_assets = stmt.assets?.current_assets?.total_current_assets ?? stmt.assets?.total_current_assets ?? stmt.totalCurrentAssets;
                            const short_term_debt = stmt.liabilities?.current_liabilities?.short_term_debt ?? stmt.liabilities?.short_term_debt ?? stmt.shortTermDebt;
                            const long_term_debt = stmt.liabilities?.non_current_liabilities?.long_term_debt ?? stmt.liabilities?.long_term_debt ?? stmt.longTermDebt;
                            return {
                                fiscal_date: stmt.fiscal_date || String(stmt.year || ''),
                                year: stmt.year || (stmt.fiscal_date ? parseInt(stmt.fiscal_date.slice(0, 4), 10) : null),
                                total_assets,
                                total_liabilities,
                                total_shareholders_equity,
                                cash_and_equivalents,
                                total_current_assets,
                                short_term_debt,
                                long_term_debt
                            };
                        });
                        return res.json({ balance_sheet: list });
                    }
                } else if (type === 'cash_flow') {
                    if (Array.isArray(data.cash_flow) && data.cash_flow.length > 0) {
                        const list = data.cash_flow.slice(0, 4).map(stmt => {
                            const operating = stmt.operating_activities?.operating_cash_flow ?? stmt.operating_cash_flow ?? stmt.operatingCashFlow;
                            const investing = stmt.investing_activities?.investing_cash_flow ?? stmt.investing_cash_flow ?? stmt.netCashUsedForInvestingActivites;
                            const financing = stmt.financing_activities?.financing_cash_flow ?? stmt.financing_cash_flow ?? stmt.netCashUsedProvidedByFinancingActivities;
                            const netChange = stmt.net_change_in_cash ?? stmt.netChangeInCash ?? (Number(operating || 0) + Number(investing || 0) + Number(financing || 0));
                            const capital_expenditures = stmt.investing_activities?.capital_expenditures ?? stmt.capital_expenditures ?? stmt.capitalExpenditures ?? stmt.capitalExpenditure;
                            return {
                                fiscal_date: stmt.fiscal_date || String(stmt.year || ''),
                                year: stmt.year || (stmt.fiscal_date ? parseInt(stmt.fiscal_date.slice(0, 4), 10) : null),
                                operating_cash_flow: operating,
                                investing_cash_flow: investing,
                                financing_cash_flow: financing,
                                net_change_in_cash: netChange,
                                capital_expenditures: capital_expenditures || 0
                            };
                        });
                        return res.json({ cash_flow: list });
                    }
                } else if (type === 'income_statement') {
                    if (Array.isArray(data.income_statement) && data.income_statement.length > 0) {
                        const list = data.income_statement.slice(0, 4).map(stmt => {
                            const total_revenue = stmt.sales ?? stmt.total_revenue ?? stmt.revenue;
                            const cost_of_revenue = stmt.cost_of_goods_sold ?? stmt.cost_of_goods ?? stmt.cost_of_revenue;
                            const gross_profit = stmt.gross_profit;
                            const operating_income = stmt.operating_income;
                            const net_income = stmt.net_income;
                            const ebitda = stmt.ebitda;
                            const eps_diluted = stmt.eps_diluted ?? stmt.diluted_eps;
                            return {
                                fiscal_date: stmt.fiscal_date || String(stmt.year || ''),
                                year: stmt.year || (stmt.fiscal_date ? parseInt(stmt.fiscal_date.slice(0, 4), 10) : null),
                                total_revenue,
                                cost_of_revenue,
                                gross_profit,
                                operating_income,
                                net_income,
                                ebitda,
                                eps_diluted
                            };
                        });
                        return res.json({ income_statement: list });
                    }
                }
            }
        }

        res.json(data || { error: 'No data available' });
    } catch (error) {
        console.error(`Statements Error:`, error);
        res.status(500).json({ error: `Failed to fetch ${type}` });
    }
});

// General Market News
router.get('/finnhub/news', async (req, res) => {
    const cached = NEWS_CACHE.getData();
    if (cached) {
        return res.json(cached);
    }

    try {
        const response = await fetchWithTimeout(`https://finnhub.io/api/v1/news?category=general&token=${process.env.FINNHUB_API_KEY}`);
        const data = await response.json();
        
        if (Array.isArray(data)) {
            NEWS_CACHE.set(data);
        }
        res.json(data);
    } catch (error) {
        console.error("Finnhub News Error:", error);
        const fallback = NEWS_CACHE.getData();
        if (fallback) {
            return res.json(fallback);
        }
        res.status(500).json({ error: "Failed to fetch market news" });
    }
});

// Analyst Recommendations
router.get('/finnhub/recommendations', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;

    try {
        const data = await resolveCachedRecommendations(symbol);
        res.json(data);
    } catch (error) {
        console.error("Finnhub Recommendations Error:", error);
        res.status(500).json({ error: 'Failed to fetch recommendations' });
    }
});

// AI Company Profile Summary
router.post('/company-profile-ai', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;

    if (!getAiProvider()) {
        return res.status(503).json({ error: 'No AI API key configured' });
    }

    try {
        const [profile, quote, metricsPayload] = await Promise.all([
            resolveCachedProfile(symbol),
            resolveCachedQuote(symbol),
            resolveCachedMetrics(symbol)
        ]);
        const metric = metricsPayload?.metric || {};

        const prompt = `You are a senior equity research analyst. Write a concise 2-3 paragraph executive summary for ${profile.name} (${symbol}). Cover:
1. What the company does, its core business segments, and competitive positioning
2. Key financial characteristics: growth trajectory, profitability, and capital allocation approach
3. Current market context and investor considerations

Use these data points:
- Industry: ${profile.finnhubIndustry || 'Equities'}
- Market Cap: $${profile.marketCapitalization || 0}M
- Key Metrics: P/E ${metric.peTTM || 'N/A'}, ROE ${metric.roeTTM || metric.returnOnEquityTTM || 'N/A'}%, Net Margin ${metric.netProfitMarginTTM || 'N/A'}%, Revenue Growth 5Y ${metric.revenueGrowth5Y || 'N/A'}%
- Current Price: $${quote.c || 0}, Beta: ${metric.beta || 1.0}

Be factual and analytical. Do not give investment advice. Format in clean HTML paragraphs.`;

        const { analysis, provider } = await generateAiAnalysis(prompt);
        res.json({ summary: analysis, provider });
    } catch (error) {
        console.error("AI Company Profile Error:", error);
        res.status(500).json({ error: 'Failed to generate AI company profile' });
    }
});

// Peer Comparison Endpoint
router.get('/finnhub/peers-detailed', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;

    try {
        const peerSymbols = await resolveCachedPeers(symbol);
        if (!Array.isArray(peerSymbols) || peerSymbols.length === 0) {
            return res.json([]);
        }

        const targetPeers = peerSymbols.filter(s => s !== symbol.toUpperCase()).slice(0, 3);

        const peerData = await Promise.all(targetPeers.map(async (peer) => {
            try {
                const [q, m, p] = await Promise.all([
                    resolveCachedQuote(peer),
                    resolveCachedMetrics(peer),
                    resolveCachedProfile(peer)
                ]);
                
                return {
                    symbol: peer,
                    name: p?.name || peer,
                    price: q?.c || 0,
                    changePercent: q?.dp || 0,
                    marketCap: p?.marketCapitalization || 0,
                    pe: m?.metric?.peTTM || null
                };
            } catch (e) {
                console.warn(`Failed to fetch detailed data for peer ${peer}:`, e.message);
                return null;
            }
        }));

        const result = peerData.filter(Boolean);
        res.json(result);
    } catch (error) {
        console.error("Detailed peers fetch error:", error);
        res.status(500).json({ error: "Failed to fetch peer group details" });
    }
});

// Top Gainers & Top Losers Movers Endpoint (FMP API with Live Bellwether Fallback)
const BELLWETHERS = [
    { symbol: 'NVDA', name: 'NVIDIA Corporation' },
    { symbol: 'AAPL', name: 'Apple Inc.' },
    { symbol: 'MSFT', name: 'Microsoft Corporation' },
    { symbol: 'AMZN', name: 'Amazon.com Inc.' },
    { symbol: 'META', name: 'Meta Platforms Inc.' },
    { symbol: 'TSLA', name: 'Tesla Inc.' },
    { symbol: 'AMD', name: 'Advanced Micro Devices' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.' },
    { symbol: 'AVGO', name: 'Broadcom Inc.' },
    { symbol: 'NFLX', name: 'Netflix Inc.' },
    { symbol: 'JPM', name: 'JPMorgan Chase & Co.' },
    { symbol: 'LLY', name: 'Eli Lilly and Co.' },
    { symbol: 'UNH', name: 'UnitedHealth Group' },
    { symbol: 'XOM', name: 'Exxon Mobil Corp.' },
    { symbol: 'V', name: 'Visa Inc.' },
    { symbol: 'BA', name: 'Boeing Co.' },
    { symbol: 'INTC', name: 'Intel Corporation' },
    { symbol: 'PYPL', name: 'PayPal Holdings' },
    { symbol: 'DIS', name: 'Walt Disney Co.' },
    { symbol: 'COIN', name: 'Coinbase Global Inc.' }
];

router.get('/fmp/movers', async (req, res) => {
    const cached = MOVERS_CACHE.getData();
    if (cached) {
        return res.json(cached);
    }

    const fmpKey = process.env.FMP_API_KEY || process.env.FINANCIAL_MODELING_PREP_API_KEY || process.env.FINANCIALMODELINGPREP_API_KEY;

    if (fmpKey) {
        try {
            const [gainersRes, losersRes] = await Promise.all([
                fetchWithTimeout(`https://financialmodelingprep.com/api/v3/stock_market/gainers?apikey=${fmpKey}`, 5000),
                fetchWithTimeout(`https://financialmodelingprep.com/api/v3/stock_market/losers?apikey=${fmpKey}`, 5000)
            ]);

            const gainersRaw = await gainersRes.json();
            const losersRaw = await losersRes.json();

            const formatMovers = (list) => {
                if (!Array.isArray(list)) return [];
                return list.slice(0, 5).map(item => ({
                    symbol: item.symbol || item.ticker || 'N/A',
                    name: item.name || item.companyName || item.symbol || 'N/A',
                    price: Number(item.price || 0),
                    changesPercentage: Number(item.changesPercentage || item.changePercent || 0),
                    volume: Number(item.volume || 0)
                }));
            };

            const gainers = formatMovers(gainersRaw);
            const losers = formatMovers(losersRaw);

            if (gainers.length > 0 || losers.length > 0) {
                const data = { gainers, losers };
                MOVERS_CACHE.set(data, 'fmp-live');
                return res.json(data);
            }
        } catch (error) {
            console.warn("FMP Movers API call warning:", error.message);
        }
    }

    // Live Bellwether Fallback
    try {
        const quotes = await Promise.all(BELLWETHERS.map(async (b) => {
            try {
                const q = await resolveCachedQuote(b.symbol);
                if (q && typeof q.c === 'number' && q.c > 0) {
                    return {
                        symbol: b.symbol,
                        name: b.name,
                        price: Number(q.c.toFixed(2)),
                        change: Number((q.d || 0).toFixed(2)),
                        changesPercentage: Number((q.dp || 0).toFixed(2)),
                        volume: 25000000
                    };
                }
            } catch (e) {}
            return null;
        }));

        const valid = quotes.filter(Boolean);
        if (valid.length >= 5) {
            const gainers = [...valid].sort((a, b) => b.changesPercentage - a.changesPercentage).slice(0, 5);
            const losers = [...valid].sort((a, b) => a.changesPercentage - b.changesPercentage).slice(0, 5);
            const data = { gainers, losers };
            MOVERS_CACHE.set(data, 'bellwether-live');
            return res.json(data);
        }
    } catch (err) {
        console.warn("Live bellwether movers fallback warning:", err.message);
    }

    const fallback = {
        _isFallback: true,
        gainers: [
            { symbol: 'NVDA', name: 'NVIDIA Corporation', price: 128.50, changesPercentage: 5.42, volume: 48200000 },
            { symbol: 'AMD', name: 'Advanced Micro Devices', price: 162.10, changesPercentage: 4.18, volume: 32600000 },
            { symbol: 'AAPL', name: 'Apple Inc.', price: 224.30, changesPercentage: 3.15, volume: 55100000 },
            { symbol: 'AVGO', name: 'Broadcom Inc.', price: 172.80, changesPercentage: 2.90, volume: 18400000 },
            { symbol: 'MSFT', name: 'Microsoft Corporation', price: 448.90, changesPercentage: 2.64, volume: 24800000 }
        ],
        losers: [
            { symbol: 'INTC', name: 'Intel Corporation', price: 31.20, changesPercentage: -4.85, volume: 41000000 },
            { symbol: 'TSLA', name: 'Tesla Inc.', price: 248.50, changesPercentage: -3.72, volume: 62300000 },
            { symbol: 'PYPL', name: 'PayPal Holdings', price: 58.40, changesPercentage: -2.95, volume: 15700000 },
            { symbol: 'BA', name: 'Boeing Co.', price: 178.60, changesPercentage: -2.41, volume: 11200000 },
            { symbol: 'NKE', name: 'NIKE Inc.', price: 75.10, changesPercentage: -2.10, volume: 14500000 }
        ]
    };
    return res.json(fallback);
});

// U.S. Sector Performance Endpoint (FMP API with Live SPDR ETF Fallback)
const SECTOR_ETFS = [
    { etf: 'XLK', sector: 'Technology' },
    { etf: 'XLE', sector: 'Energy' },
    { etf: 'XLF', sector: 'Financial Services' },
    { etf: 'XLC', sector: 'Communication Services' },
    { etf: 'XLI', sector: 'Industrials' },
    { etf: 'XLY', sector: 'Consumer Cyclical' },
    { etf: 'XLB', sector: 'Basic Materials' },
    { etf: 'XLV', sector: 'Healthcare' },
    { etf: 'XLP', sector: 'Consumer Defensive' },
    { etf: 'XLU', sector: 'Utilities' },
    { etf: 'XLRE', sector: 'Real Estate' }
];

router.get('/fmp/sectors', async (req, res) => {
    const cached = SECTOR_CACHE.getData();
    if (cached) {
        return res.json(cached);
    }

    const fmpKey = process.env.FMP_API_KEY || process.env.FINANCIAL_MODELING_PREP_API_KEY || process.env.FINANCIALMODELINGPREP_API_KEY;

    if (fmpKey) {
        try {
            const response = await fetchWithTimeout(`https://financialmodelingprep.com/api/v3/sector-performance?apikey=${fmpKey}`, 5000);
            const rawData = await response.json();

            if (Array.isArray(rawData) && rawData.length > 0) {
                const sectors = rawData.map(item => ({
                    sector: item.sector || 'Unknown',
                    changesPercentage: parseFloat((parseFloat(item.changesPercentage || 0)).toFixed(2))
                }));
                const data = { sectors };
                SECTOR_CACHE.set(data, 'fmp-live');
                return res.json(data);
            }
        } catch (error) {
            console.warn("FMP Sector API warning:", error.message);
        }
    }

    // Live SPDR ETF Fallback
    try {
        const sectorResults = await Promise.all(SECTOR_ETFS.map(async ({ etf, sector }) => {
            try {
                const chart = await fetchYahooChart(etf, '5d', '1d');
                if (chart && Array.isArray(chart.close) && chart.close.length >= 2) {
                    const validCloses = chart.close.filter(c => typeof c === 'number' && !isNaN(c));
                    if (validCloses.length >= 2) {
                        const curr = validCloses[validCloses.length - 1];
                        const prev = validCloses[validCloses.length - 2];
                        const pct = parseFloat((((curr - prev) / prev) * 100).toFixed(2));
                        return { sector, changesPercentage: pct };
                    }
                }
                const q = await resolveCachedQuote(etf);
                if (q && typeof q.dp === 'number') {
                    return { sector, changesPercentage: parseFloat(Number(q.dp).toFixed(2)) };
                }
            } catch (e) {}
            return null;
        }));

        const validSectors = sectorResults.filter(Boolean);
        if (validSectors.length >= 5) {
            const data = { sectors: validSectors };
            SECTOR_CACHE.set(data, 'yahoo-spdr');
            return res.json(data);
        }
    } catch (err) {
        console.warn("Live SPDR sector fallback warning:", err.message);
    }

    const fallback = {
        _isFallback: true,
        sectors: [
            { sector: 'Technology', changesPercentage: 1.84 },
            { sector: 'Energy', changesPercentage: 1.45 },
            { sector: 'Financial Services', changesPercentage: 0.92 },
            { sector: 'Communication Services', changesPercentage: 0.65 },
            { sector: 'Industrials', changesPercentage: 0.38 },
            { sector: 'Consumer Cyclical', changesPercentage: 0.12 },
            { sector: 'Basic Materials', changesPercentage: -0.15 },
            { sector: 'Healthcare', changesPercentage: -0.42 },
            { sector: 'Consumer Defensive', changesPercentage: -0.68 },
            { sector: 'Utilities', changesPercentage: -0.95 },
            { sector: 'Real Estate', changesPercentage: -1.24 }
        ]
    };
    return res.json(fallback);
});

router.get('/finnhub/earnings', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;

    const cacheKey = symbol.toUpperCase();
    const cached = EARNINGS_CACHE.getData(cacheKey);
    if (cached) {
        return res.json(cached);
    }

    try {
        const response = await fetchWithTimeout(`https://finnhub.io/api/v1/stock/earnings?symbol=${encodeURIComponent(symbol)}&limit=8&token=${process.env.FINNHUB_API_KEY}`);
        const data = await response.json();
        if (Array.isArray(data)) {
            EARNINGS_CACHE.set(cacheKey, data);
        }
        res.json(data);
    } catch (error) {
        console.error('Finnhub Earnings Error:', error);
        res.status(500).json({ error: 'Failed to fetch earnings data' });
    }
});

router.get('/finnhub/dividends', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;

    const cacheKey = symbol.toUpperCase();
    const cached = DIVIDENDS_CACHE.getData(cacheKey);
    if (cached) {
        return res.json(cached);
    }

    try {
        const toDate = new Date().toISOString().split('T')[0];
        const fromDate = new Date();
        fromDate.setFullYear(fromDate.getFullYear() - 5);
        const fromDateStr = fromDate.toISOString().split('T')[0];
        
        const response = await fetchWithTimeout(`https://finnhub.io/api/v1/stock/dividend?symbol=${encodeURIComponent(symbol)}&from=${fromDateStr}&to=${toDate}&token=${process.env.FINNHUB_API_KEY}`);
        const data = await response.json();
        if (Array.isArray(data)) {
            DIVIDENDS_CACHE.set(cacheKey, data);
        }
        res.json(data);
    } catch (error) {
        console.error('Finnhub Dividends Error:', error);
        res.status(500).json({ error: 'Failed to fetch dividend data' });
    }
});

router.get('/finnhub/insider', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;

    const cacheKey = symbol.toUpperCase();
    const cached = INSIDER_CACHE.getData(cacheKey);
    if (cached) {
        return res.json(cached);
    }

    try {
        const response = await fetchWithTimeout(`https://finnhub.io/api/v1/stock/insider-transactions?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_API_KEY}`);
        const data = await response.json();
        if (data && Array.isArray(data.data)) {
            const items = data.data.slice(0, 20);
            INSIDER_CACHE.set(cacheKey, items);
            res.json(items);
        } else {
            res.json([]);
        }
    } catch (error) {
        console.error('Finnhub Insider Error:', error);
        res.status(500).json({ error: 'Failed to fetch insider transactions' });
    }
});

// ── Concurrency-limited promise pool helper ──────────────────────────────────
async function pMap(items, fn, concurrency = 5) {
    const results = [];
    const executing = new Set();
    for (const item of items) {
        const p = Promise.resolve().then(() => fn(item));
        results.push(p);
        executing.add(p);
        const clean = () => executing.delete(p);
        p.then(clean).catch(clean);
        if (executing.size >= concurrency) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}

// ── Batch Portfolio Snapshot Endpoint (/api/portfolio/snapshot) ───────────────
router.post('/portfolio/snapshot', async (req, res) => {
    try {
        const rawSymbols = Array.isArray(req.body?.symbols) ? req.body.symbols : [];
        const symbols = [...new Set(
            rawSymbols
                .map(s => String(s || '').trim().toUpperCase())
                .filter(s => s && s.length <= 12)
        )].slice(0, 30);

        if (symbols.length === 0) {
            return res.json({ snapshots: {}, portfolioAnalytics: null, fetchedAt: new Date().toISOString() });
        }

        const snapshots = {};

        await pMap(symbols, async (sym) => {
            try {
                const [quote, profile, metricsData] = await Promise.all([
                    resolveCachedQuote(sym),
                    resolveCachedProfile(sym),
                    resolveCachedMetrics(sym)
                ]);

                const metric = metricsData?.metric || {};
                const currentPrice = typeof quote?.c === 'number' && quote.c > 0 ? quote.c : (quote?.pc || 0);

                snapshots[sym] = {
                    symbol: sym,
                    name: profile?.name || `${sym} Asset`,
                    sector: profile?.finnhubIndustry || 'Equities',
                    exchange: profile?.exchange || 'US',
                    logo: profile?.logo || `https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/${sym}.png`,
                    price: currentPrice,
                    change: quote?.d ?? 0,
                    changePercent: quote?.dp ?? 0,
                    high52w: metric['52WeekHigh'] || quote?.h || currentPrice,
                    low52w: metric['52WeekLow'] || quote?.l || currentPrice,
                    beta: typeof metric?.beta === 'number' ? metric.beta : 1.0,
                    pe: typeof metric?.peTTM === 'number' ? metric.peTTM : null,
                    dividendYield: typeof metric?.dividendYieldIndicatedAnnual === 'number' ? metric.dividendYieldIndicatedAnnual : 0,
                    marketCap: profile?.marketCapitalization ?? null
                };
            } catch (err) {
                console.warn(`Snapshot resolution error for ${sym}:`, err.message);
                snapshots[sym] = {
                    symbol: sym,
                    name: `${sym} Asset`,
                    sector: 'Equities',
                    exchange: 'US',
                    logo: `https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/${sym}.png`,
                    price: 0,
                    change: 0,
                    changePercent: 0,
                    high52w: 0,
                    low52w: 0,
                    beta: 1.0,
                    pe: null,
                    dividendYield: 0,
                    marketCap: null
                };
            }
        }, 5);

        // ── Institutional Portfolio Analytics (Zero Extra API Cost) ─────────────
        const validSymbols = Object.keys(snapshots);
        const N = validSymbols.length;

        let rawWeights = {};
        if (req.body?.weights && typeof req.body.weights === 'object') {
            rawWeights = req.body.weights;
        } else if (req.body?.quantities && typeof req.body.quantities === 'object') {
            validSymbols.forEach(sym => {
                const qty = Number(req.body.quantities[sym] || req.body.quantities[sym.toLowerCase()] || 0);
                const price = snapshots[sym]?.price || 0;
                rawWeights[sym] = qty * price;
            });
        }

        let totalWeight = 0;
        validSymbols.forEach(sym => {
            const w = Number(rawWeights[sym] || rawWeights[sym.toLowerCase()] || (N > 0 ? 1 / N : 0));
            if (w > 0) totalWeight += w;
        });

        const normalizedWeights = {};
        validSymbols.forEach(sym => {
            const raw = Number(rawWeights[sym] || rawWeights[sym.toLowerCase()] || (N > 0 ? 1 / N : 0));
            normalizedWeights[sym] = totalWeight > 0 ? (raw / totalWeight) : (N > 0 ? 1 / N : 0);
        });

        let weightedBeta = 0;
        let weightedDividendYield = 0;
        let positivePeWeight = 0;
        let aggregateEarningsYield = 0;
        let sumSquaredWeights = 0;
        const sectorWeightsMap = {};

        validSymbols.forEach(sym => {
            const s = snapshots[sym];
            const w = normalizedWeights[sym] || 0;
            const beta = typeof s.beta === 'number' && !isNaN(s.beta) ? s.beta : 1.0;
            const divYield = typeof s.dividendYield === 'number' && !isNaN(s.dividendYield) ? s.dividendYield : 0;
            const pe = typeof s.pe === 'number' && !isNaN(s.pe) && s.pe > 0 ? s.pe : null;
            const sector = s.sector || 'Equities';

            weightedBeta += w * beta;
            weightedDividendYield += w * divYield;
            sumSquaredWeights += Math.pow(w, 2);

            if (pe != null && pe > 0) {
                positivePeWeight += w;
                aggregateEarningsYield += w * (1 / pe);
            }

            const pctWeight = w * 100;
            sectorWeightsMap[sector] = (sectorWeightsMap[sector] || 0) + pctWeight;
        });

        const sectorBreakdown = {};
        Object.keys(sectorWeightsMap).forEach(sec => {
            sectorBreakdown[sec] = Number(sectorWeightsMap[sec].toFixed(2));
        });

        let harmonicPortfolioPE = null;
        if (positivePeWeight > 0 && aggregateEarningsYield > 0) {
            const normalizedEY = aggregateEarningsYield / positivePeWeight;
            harmonicPortfolioPE = Number((1 / normalizedEY).toFixed(2));
        }

        const hhiConcentration = Math.round(sumSquaredWeights * 10000);
        const effectiveBets = sumSquaredWeights > 0 ? Number((1 / sumSquaredWeights).toFixed(1)) : N;

        const portfolioAnalytics = {
            weightedBeta: Number(weightedBeta.toFixed(2)),
            weightedDividendYield: Number(weightedDividendYield.toFixed(2)),
            harmonicPortfolioPE,
            peMethodology: 'Harmonic Mean P/E (Reciprocal of aggregate earnings yield normalized by positive-earning assets, eliminating extreme high-P/E outlier skewness)',
            hhiConcentration,
            effectiveBets,
            sectorBreakdown
        };

        res.json({
            snapshots,
            portfolioAnalytics,
            fetchedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('Batch portfolio snapshot error:', error);
        res.status(500).json({ error: 'Failed to resolve portfolio snapshot', snapshots: {} });
    }
});

module.exports = router;

