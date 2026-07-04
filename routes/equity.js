const express = require('express');
const router = express.Router();

const { requireTicker } = require('../utils/api');
const { fetchFmpMetrics, fetchFinnhubHistory } = require('../utils/equityProviders');
const { getAiProvider, generateAiAnalysis } = require('../utils/aiProviders');

// Cache stores to protect API limits
const TIME_SERIES_CACHE = {};
const STATEMENTS_CACHE = {};
const PEERS_CACHE = {};

// Company Profile Endpoint
// ... (omitted profile endpoint as it's not changing, target starting from time_series) ...

// Historical Time-Series (Charts)
router.get('/twelvedata/time_series', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;
    const timeframe = String(req.query.timeframe || '1Y').toUpperCase();

    const cacheKey = `${symbol.toUpperCase()}_${timeframe}`;
    const now = Date.now();
    if (TIME_SERIES_CACHE[cacheKey] && (now - TIME_SERIES_CACHE[cacheKey].lastFetched < 60 * 60 * 1000)) {
        return res.json(TIME_SERIES_CACHE[cacheKey].data);
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
        const response = await fetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${config.interval}&outputsize=${config.outputsize}&apikey=${process.env.TWELVEDATA_API_KEY}`);
        const data = await response.json();

        if (data?.status === 'error' || !Array.isArray(data?.values)) {
            console.warn('TwelveData time series fallback triggered:', data);
            const fallback = await tryFinnhubFallback(symbol, timeframe);
            if (fallback) {
                TIME_SERIES_CACHE[cacheKey] = { lastFetched: now, data: fallback };
                return res.json(fallback);
            }
            return res.status(500).json({ error: 'No time series values returned', raw: data });
        }

        if (timeframe === '1Y' && Array.isArray(data.values) && data.values.length < 180) {
            console.warn(`TwelveData 1Y values too short (${data.values.length}), using Finnhub fallback`);
            const fallback = await tryFinnhubFallback(symbol, timeframe);
            if (fallback) {
                TIME_SERIES_CACHE[cacheKey] = { lastFetched: now, data: fallback };
                return res.json(fallback);
            }
        }

        TIME_SERIES_CACHE[cacheKey] = { lastFetched: now, data: data };
        res.json(data);
    } catch (error) {
        console.error("TwelveData Time Series Error:", error);
        const fallback = await tryFinnhubFallback(symbol, timeframe);
        if (fallback) {
            TIME_SERIES_CACHE[cacheKey] = { lastFetched: now, data: fallback };
            return res.json(fallback);
        }
        res.status(500).json({ error: "Failed to fetch historical data" });
    }
});
router.get('/finnhub/profile', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;

    try {
        const response = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_API_KEY}`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("Finnhub Profile Error:", error);
        res.status(500).json({ error: "Failed to fetch company profile" });
    }
});

// Key Financial Metrics Endpoint
router.get('/finnhub/metrics', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;

    try {
        const response = await fetch(
            `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${process.env.FINNHUB_API_KEY}`
        );
        const data = await response.json();

        const needsFallback = !data?.metric ||
            data.metric.returnOnEquityTTM == null ||
            data.metric.totalDebtTotalEquityAnnual == null ||
            (data.metric.enterpriseValueTTM == null && data.metric.evToEbitda == null && data.metric.evEbitda == null);

        if (needsFallback && (process.env.FMP_API_KEY || process.env.FINANCIAL_MODELING_PREP_API_KEY || process.env.FINANCIALMODELINGPREP_API_KEY)) {
            try {
                const fallback = await fetchFmpMetrics(symbol);
                if (!fallback.error) {
                    data.fmpMetrics = fallback;
                }
            } catch (fallbackError) {
                console.warn('FMP metrics fallback failed:', fallbackError);
            }
        }

        res.json(data);
    } catch (error) {
        console.error("Finnhub Metrics Error:", error);
        res.status(500).json({ error: "Failed to fetch financial metrics" });
    }
});

// Real-Time Quote Endpoint
router.get('/finnhub/quote', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;

    try {
        const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_API_KEY}`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("Finnhub Quote Error:", error);
        res.status(500).json({ error: "Failed to fetch real-time quote" });
    }
});

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
    const now = Date.now();
    if (STATEMENTS_CACHE[cacheKey] && (now - STATEMENTS_CACHE[cacheKey].lastFetched < 2 * 60 * 60 * 1000)) {
        return res.json(STATEMENTS_CACHE[cacheKey].data);
    }

    // Intercept res.json to cache successful responses
    const originalJson = res.json.bind(res);
    res.json = (payload) => {
        if (payload && !payload.error) {
            STATEMENTS_CACHE[cacheKey] = { lastFetched: now, data: payload };
        }
        return originalJson(payload);
    };

    try {
        let twelvedataFailed = false;
        let data = null;

        if (process.env.TWELVEDATA_API_KEY) {
            const response = await fetch(`https://api.twelvedata.com/${type}?symbol=${encodeURIComponent(symbol)}&apikey=${process.env.TWELVEDATA_API_KEY}`);
            data = await response.json();
            if (data?.status === 'error' || !data || data?.code >= 400) {
                twelvedataFailed = true;
            }
        } else {
            twelvedataFailed = true;
        }

        if (twelvedataFailed) {
            const fmpKey = process.env.FMP_API_KEY || process.env.FINANCIAL_MODELING_PREP_API_KEY || process.env.FINANCIALMODELINGPREP_API_KEY;
            if (fmpKey) {
                try {
                    const fmpTypeMap = { balance_sheet: 'balance-sheet-statement', cash_flow: 'cash-flow-statement', income_statement: 'income-statement' };
                    const fmpType = fmpTypeMap[type];
                    const fmpUrl = `https://financialmodelingprep.com/api/v3/${fmpType}/${encodeURIComponent(symbol)}?limit=1&apikey=${fmpKey}`;
                    const fmpResponse = await fetch(fmpUrl);
                    const fmpData = await fmpResponse.json();

                    if (Array.isArray(fmpData) && fmpData.length > 0 && !fmpData[0]?.['Error Message']) {
                        const stmt = fmpData[0];
                        if (type === 'balance_sheet') {
                            return res.json({
                                balance_sheet: [{
                                    total_assets: stmt.totalAssets,
                                    total_liabilities: stmt.totalLiabilities,
                                    total_shareholders_equity: stmt.totalStockholdersEquity || stmt.totalEquity,
                                    cash_and_equivalents: stmt.cashAndCashEquivalents,
                                    total_current_assets: stmt.totalCurrentAssets,
                                    short_term_debt: stmt.shortTermDebt,
                                    long_term_debt: stmt.longTermDebt
                                }]
                            });
                        } else if (type === 'cash_flow') {
                            return res.json({
                                cash_flow: [{
                                    operating_cash_flow: stmt.operatingCashFlow,
                                    investing_cash_flow: stmt.netCashUsedForInvestingActivites || stmt.netCashUsedForInvestingActivities,
                                    financing_cash_flow: stmt.netCashUsedProvidedByFinancingActivities,
                                    net_change_in_cash: stmt.netChangeInCash,
                                    capital_expenditures: stmt.capitalExpenditure || 0
                                }]
                            });
                        } else if (type === 'income_statement') {
                            return res.json({ income_statement: [{ total_revenue: stmt.revenue, cost_of_revenue: stmt.costOfRevenue, gross_profit: stmt.grossProfit, operating_income: stmt.operatingIncome, net_income: stmt.netIncome, ebitda: stmt.ebitda, eps_diluted: stmt.epsdiluted }] });
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
                    const avResponse = await fetch(avUrl);
                    const avData = await avResponse.json();

                    if (avData.annualReports && avData.annualReports.length > 0) {
                        const stmt = avData.annualReports[0];
                        if (type === 'balance_sheet') {
                            return res.json({
                                balance_sheet: [{
                                    total_assets: stmt.totalAssets && stmt.totalAssets !== 'None' ? Number(stmt.totalAssets) : null,
                                    total_liabilities: stmt.totalLiabilities && stmt.totalLiabilities !== 'None' ? Number(stmt.totalLiabilities) : null,
                                    total_shareholders_equity: stmt.totalShareholderEquity && stmt.totalShareholderEquity !== 'None' ? Number(stmt.totalShareholderEquity) : null,
                                    cash_and_equivalents: stmt.cashAndCashEquivalentsAtCarryingValue && stmt.cashAndCashEquivalentsAtCarryingValue !== 'None' ? Number(stmt.cashAndCashEquivalentsAtCarryingValue) : null,
                                    total_current_assets: stmt.totalCurrentAssets && stmt.totalCurrentAssets !== 'None' ? Number(stmt.totalCurrentAssets) : null,
                                    short_term_debt: stmt.shortTermDebt && stmt.shortTermDebt !== 'None' ? Number(stmt.shortTermDebt) : null,
                                    long_term_debt: stmt.longTermDebt && stmt.longTermDebt !== 'None' ? Number(stmt.longTermDebt) : null
                                }]
                            });
                        } else if (type === 'cash_flow') {
                            const operating = stmt.operatingCashflow && stmt.operatingCashflow !== 'None' ? Number(stmt.operatingCashflow) : 0;
                            const investing = stmt.cashflowFromInvestment && stmt.cashflowFromInvestment !== 'None' ? Number(stmt.cashflowFromInvestment) : 0;
                            const financing = stmt.cashflowFromFinancing && stmt.cashflowFromFinancing !== 'None' ? Number(stmt.cashflowFromFinancing) : 0;
                            const netChange = stmt.changeInCashAndCashEquivalents && stmt.changeInCashAndCashEquivalents !== 'None' ? Number(stmt.changeInCashAndCashEquivalents) : (operating + investing + financing);
                            const capex = stmt.capitalExpenditures && stmt.capitalExpenditures !== 'None' ? Number(stmt.capitalExpenditures) : 0;
                            return res.json({
                                cash_flow: [{
                                    operating_cash_flow: operating,
                                    investing_cash_flow: investing,
                                    financing_cash_flow: financing,
                                    net_change_in_cash: netChange,
                                    capital_expenditures: capex
                                }]
                            });
                        } else if (type === 'income_statement') {
                            return res.json({
                                income_statement: [{
                                    total_revenue: stmt.totalRevenue && stmt.totalRevenue !== 'None' ? Number(stmt.totalRevenue) : null,
                                    cost_of_revenue: stmt.costOfRevenue && stmt.costOfRevenue !== 'None' ? Number(stmt.costOfRevenue) : null,
                                    gross_profit: stmt.grossProfit && stmt.grossProfit !== 'None' ? Number(stmt.grossProfit) : null,
                                    operating_income: stmt.operatingIncome && stmt.operatingIncome !== 'None' ? Number(stmt.operatingIncome) : null,
                                    net_income: stmt.netIncome && stmt.netIncome !== 'None' ? Number(stmt.netIncome) : null,
                                    ebitda: stmt.ebitda && stmt.ebitda !== 'None' ? Number(stmt.ebitda) : null,
                                    eps_diluted: stmt.dilutedEPS && stmt.dilutedEPS !== 'None' ? Number(stmt.dilutedEPS) : null
                                }]
                            });
                        }
                    }
                } catch (avErr) {
                    console.warn("AlphaVantage statement fallback failed:", avErr);
                }
            }
        } else {
            // Normalise TwelveData response format to standard flat format
            if (data && !data.error) {
                if (type === 'balance_sheet') {
                    if (Array.isArray(data.balance_sheet) && data.balance_sheet.length > 0) {
                        const stmt = data.balance_sheet[0];
                        const total_assets = stmt.assets?.total_assets ?? stmt.total_assets ?? stmt.totalAssets;
                        const total_liabilities = stmt.liabilities?.total_liabilities ?? stmt.total_liabilities ?? stmt.totalLiabilities;
                        const total_shareholders_equity = stmt.shareholders_equity?.total_shareholders_equity ?? stmt.total_shareholders_equity ?? stmt.totalEquity;
                        const cash_and_equivalents = stmt.assets?.current_assets?.cash_and_cash_equivalents ?? stmt.assets?.current_assets?.cash_equivalents ?? stmt.assets?.current_assets?.cash ?? stmt.assets?.cash_and_equivalents ?? stmt.cash_and_equivalents ?? stmt.cashAndCashEquivalents;
                        const total_current_assets = stmt.assets?.current_assets?.total_current_assets ?? stmt.assets?.total_current_assets ?? stmt.totalCurrentAssets;
                        const short_term_debt = stmt.liabilities?.current_liabilities?.short_term_debt ?? stmt.liabilities?.short_term_debt ?? stmt.shortTermDebt;
                        const long_term_debt = stmt.liabilities?.non_current_liabilities?.long_term_debt ?? stmt.liabilities?.long_term_debt ?? stmt.longTermDebt;
                        return res.json({
                            balance_sheet: [{
                                total_assets,
                                total_liabilities,
                                total_shareholders_equity,
                                cash_and_equivalents,
                                total_current_assets,
                                short_term_debt,
                                long_term_debt
                            }]
                        });
                    }
                } else if (type === 'cash_flow') {
                    if (Array.isArray(data.cash_flow) && data.cash_flow.length > 0) {
                        const stmt = data.cash_flow[0];
                        const operating = stmt.operating_activities?.operating_cash_flow ?? stmt.operating_cash_flow ?? stmt.operatingCashFlow;
                        const investing = stmt.investing_activities?.investing_cash_flow ?? stmt.investing_cash_flow ?? stmt.netCashUsedForInvestingActivites;
                        const financing = stmt.financing_activities?.financing_cash_flow ?? stmt.financing_cash_flow ?? stmt.netCashUsedProvidedByFinancingActivities;
                        const netChange = stmt.net_change_in_cash ?? stmt.netChangeInCash ?? (Number(operating || 0) + Number(investing || 0) + Number(financing || 0));
                        const capital_expenditures = stmt.investing_activities?.capital_expenditures ?? stmt.capital_expenditures ?? stmt.capitalExpenditures ?? stmt.capitalExpenditure;
                        return res.json({
                            cash_flow: [{
                                operating_cash_flow: operating,
                                investing_cash_flow: investing,
                                financing_cash_flow: financing,
                                net_change_in_cash: netChange,
                                capital_expenditures: capital_expenditures || 0
                            }]
                        });
                    }
                } else if (type === 'income_statement') {
                    if (Array.isArray(data.income_statement) && data.income_statement.length > 0) {
                        const stmt = data.income_statement[0];
                        const total_revenue = stmt.sales ?? stmt.total_revenue ?? stmt.revenue;
                        const cost_of_revenue = stmt.cost_of_goods_sold ?? stmt.cost_of_goods ?? stmt.cost_of_revenue;
                        const gross_profit = stmt.gross_profit;
                        const operating_income = stmt.operating_income;
                        const net_income = stmt.net_income;
                        const ebitda = stmt.ebitda;
                        const eps_diluted = stmt.eps_diluted ?? stmt.diluted_eps;
                        return res.json({
                            income_statement: [{
                                total_revenue,
                                cost_of_revenue,
                                gross_profit,
                                operating_income,
                                net_income,
                                ebitda,
                                eps_diluted
                            }]
                        });
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

const NEWS_CACHE = {
    lastFetched: 0,
    ttlMs: 5 * 60 * 1000, // 5 minutes
    data: null,
};

// General Market News
router.get('/finnhub/news', async (req, res) => {
    const now = Date.now();
    if (NEWS_CACHE.data && now - NEWS_CACHE.lastFetched < NEWS_CACHE.ttlMs) {
        return res.json(NEWS_CACHE.data);
    }

    try {
        const response = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${process.env.FINNHUB_API_KEY}`);
        const data = await response.json();
        
        if (Array.isArray(data)) {
            NEWS_CACHE.data = data;
            NEWS_CACHE.lastFetched = now;
        }
        res.json(data);
    } catch (error) {
        console.error("Finnhub News Error:", error);
        if (NEWS_CACHE.data) {
            return res.json(NEWS_CACHE.data);
        }
        res.status(500).json({ error: "Failed to fetch market news" });
    }
});

// Analyst Recommendations
router.get('/finnhub/recommendations', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;

    try {
        const response = await fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_API_KEY}`);
        const data = await response.json();
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
        const finnhubToken = process.env.FINNHUB_API_KEY;
        const [profileRes, quoteRes, metricsRes] = await Promise.all([
            fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${finnhubToken}`),
            fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhubToken}`),
            fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${finnhubToken}`),
        ]);

        const profile = await profileRes.json();
        const quote = await quoteRes.json();
        const metricsPayload = await metricsRes.json();
        const metric = metricsPayload?.metric || {};

        const prompt = `You are a senior equity research analyst. Write a concise 2-3 paragraph executive summary for ${profile.name} (${symbol}). Cover:
1. What the company does, its core business segments, and competitive positioning
2. Key financial characteristics: growth trajectory, profitability, and capital allocation approach
3. Current market context and investor considerations

Use these data points:
- Industry: ${profile.finnhubIndustry}
- Market Cap: $${profile.marketCapitalization}M
- Key Metrics: P/E ${metric.peTTM}, ROE ${metric.roeTTM}%, Net Margin ${metric.netProfitMarginTTM}%, Revenue Growth 5Y ${metric.revenueGrowth5Y}%
- Current Price: $${quote.c}, Beta: ${metric.beta}

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

    const cacheKey = symbol.toUpperCase();
    const now = Date.now();
    if (PEERS_CACHE[cacheKey] && (now - PEERS_CACHE[cacheKey].lastFetched < 15 * 60 * 1000)) {
        return res.json(PEERS_CACHE[cacheKey].data);
    }

    try {
        const finnhubToken = process.env.FINNHUB_API_KEY;
        const peersRes = await fetch(`https://finnhub.io/api/v1/stock/peers?symbol=${encodeURIComponent(symbol)}&token=${finnhubToken}`);
        const peerSymbols = await peersRes.json();

        if (!Array.isArray(peerSymbols) || peerSymbols.length === 0) {
            return res.json([]);
        }

        const targetPeers = peerSymbols.filter(s => s !== symbol).slice(0, 4);

        const peerData = await Promise.all(targetPeers.map(async (peer) => {
            try {
                const [qRes, mRes, pRes] = await Promise.all([
                    fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(peer)}&token=${finnhubToken}`),
                    fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(peer)}&metric=all&token=${finnhubToken}`),
                    fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(peer)}&token=${finnhubToken}`)
                ]);
                const q = await qRes.json();
                const m = await mRes.json();
                const p = await pRes.json();
                
                return {
                    symbol: peer,
                    name: p.name || peer,
                    price: q.c || 0,
                    changePercent: q.dp || 0,
                    marketCap: p.marketCapitalization || 0,
                    pe: m?.metric?.peTTM || null
                };
            } catch (e) {
                console.warn(`Failed to fetch detailed data for peer ${peer}:`, e.message);
                return null;
            }
        }));

        const result = peerData.filter(Boolean);
        PEERS_CACHE[cacheKey] = { lastFetched: now, data: result };
        res.json(result);
    } catch (error) {
        console.error("Detailed peers fetch error:", error);
        res.status(500).json({ error: "Failed to fetch peer group details" });
    }
});

module.exports = router;
