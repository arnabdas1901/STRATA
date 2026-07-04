const express = require('express');
const router = express.Router();

const { requireTicker } = require('../utils/api');
const { fetchFmpMetrics, fetchFinnhubHistory } = require('../utils/equityProviders');

// Company Profile Endpoint
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

// Historical Time-Series (Charts)
router.get('/twelvedata/time_series', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;
    const timeframe = String(req.query.timeframe || '1Y').toUpperCase();

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
            if (fallback) return res.json(fallback);
            return res.status(500).json({ error: 'No time series values returned', raw: data });
        }

        if (timeframe === '1Y' && Array.isArray(data.values) && data.values.length < 180) {
            console.warn(`TwelveData 1Y values too short (${data.values.length}), using Finnhub fallback`);
            const fallback = await tryFinnhubFallback(symbol, timeframe);
            if (fallback) return res.json(fallback);
        }

        res.json(data);
    } catch (error) {
        console.error("TwelveData Time Series Error:", error);
        const fallback = await tryFinnhubFallback(symbol, timeframe);
        if (fallback) return res.json(fallback);
        res.status(500).json({ error: "Failed to fetch historical data" });
    }
});

// Financial Statements (Balance Sheet / Cash Flow)
router.get('/twelvedata/statements', async (req, res) => {
    const symbol = requireTicker(req, res);
    if (!symbol) return;
    const type = String(req.query.type || '').trim();
    const allowedStatementTypes = new Set(['balance_sheet', 'cash_flow']);
    if (!allowedStatementTypes.has(type)) {
        return res.status(400).json({ error: 'Valid statement type is required' });
    }

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
                    const fmpType = type === 'balance_sheet' ? 'balance-sheet-statement' : 'cash-flow-statement';
                    const fmpUrl = `https://financialmodelingprep.com/api/v3/${fmpType}/${encodeURIComponent(symbol)}?limit=1&apikey=${fmpKey}`;
                    const fmpResponse = await fetch(fmpUrl);
                    const fmpData = await fmpResponse.json();

                    if (Array.isArray(fmpData) && fmpData.length > 0 && !fmpData[0]?.['Error Message']) {
                        const stmt = fmpData[0];
                        if (type === 'balance_sheet') {
                            return res.json({ balance_sheet: [{ total_assets: stmt.totalAssets, total_liabilities: stmt.totalLiabilities, total_shareholders_equity: stmt.totalStockholdersEquity || stmt.totalEquity }] });
                        } else {
                            return res.json({ cash_flow: [{ operating_cash_flow: stmt.operatingCashFlow, investing_cash_flow: stmt.netCashUsedForInvestingActivites || stmt.netCashUsedForInvestingActivities, financing_cash_flow: stmt.netCashUsedProvidedByFinancingActivities, net_change_in_cash: stmt.netChangeInCash }] });
                        }
                    }
                } catch (fmpErr) {
                    console.warn("FMP statement fallback attempt failed:", fmpErr);
                }
            }

            // AlphaVantage statement fallback
            if (process.env.ALPHAVANTAGE_API_KEY) {
                try {
                    const avFunc = type === 'balance_sheet' ? 'BALANCE_SHEET' : 'CASH_FLOW';
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
                                    total_shareholders_equity: stmt.totalShareholderEquity && stmt.totalShareholderEquity !== 'None' ? Number(stmt.totalShareholderEquity) : null
                                }]
                            });
                        } else {
                            const operating = stmt.operatingCashflow && stmt.operatingCashflow !== 'None' ? Number(stmt.operatingCashflow) : 0;
                            const investing = stmt.cashflowFromInvestment && stmt.cashflowFromInvestment !== 'None' ? Number(stmt.cashflowFromInvestment) : 0;
                            const financing = stmt.cashflowFromFinancing && stmt.cashflowFromFinancing !== 'None' ? Number(stmt.cashflowFromFinancing) : 0;
                            const netChange = stmt.changeInCashAndCashEquivalents && stmt.changeInCashAndCashEquivalents !== 'None' ? Number(stmt.changeInCashAndCashEquivalents) : (operating + investing + financing);
                            return res.json({
                                cash_flow: [{
                                    operating_cash_flow: operating,
                                    investing_cash_flow: investing,
                                    financing_cash_flow: financing,
                                    net_change_in_cash: netChange
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
                        return res.json({
                            balance_sheet: [{
                                total_assets,
                                total_liabilities,
                                total_shareholders_equity
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
                        return res.json({
                            cash_flow: [{
                                operating_cash_flow: operating,
                                investing_cash_flow: investing,
                                financing_cash_flow: financing,
                                net_change_in_cash: netChange
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

module.exports = router;
