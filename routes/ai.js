const express = require('express');
const router = express.Router();
const { requireTicker } = require('../utils/api');
const { AI_FRAME_INSTRUCTIONS, buildAiPrompt, getAiProvider, generateAiAnalysis, pickMetricsForAi } = require('../utils/aiProviders');
const { MemoryCache } = require('../utils/cache');
const { wrapWithProvenance, DATA_QUALITY, FRESHNESS } = require('../utils/provenance');

const aiAnalysisCache = new MemoryCache('ai-analysis', 15 * 60 * 1000, 100);
const statementsCache = new MemoryCache('ai-statements', 24 * 60 * 60 * 1000, 100);

const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 15;
const rateLimitStore = new Map();

function checkRateLimit(ip) {
    const now = Date.now();
    const record = rateLimitStore.get(ip);
    if (!record || now - record.windowStart > RATE_LIMIT_WINDOW) {
        rateLimitStore.set(ip, { windowStart: now, count: 1 });
        return true;
    }
    record.count++;
    if (record.count > RATE_LIMIT_MAX) return false;
    return true;
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of rateLimitStore) {
        if (now - record.windowStart > RATE_LIMIT_WINDOW * 2) rateLimitStore.delete(ip);
    }
}, 5 * 60 * 1000).unref();

// Derive comprehensive quantitative factor scorecard from Finnhub metrics payload
function computeQuantScorecard(metric = {}) {
    let valScore = 50;
    const pe = metric.peTTM || metric.peBasicExclExtraTTM;
    if (pe) {
        if (pe < 15) valScore = 85;
        else if (pe < 25) valScore = 70;
        else if (pe < 40) valScore = 50;
        else valScore = 30;
    }

    let profScore = 50;
    const roe = metric.roeTTM;
    const gm = metric.grossMarginTTM;
    if (roe != null || gm != null) {
        let p = 0, count = 0;
        if (roe != null) {
            p += (roe > 25 ? 90 : (roe > 15 ? 75 : (roe > 5 ? 50 : 25)));
            count++;
        }
        if (gm != null) {
            p += (gm > 50 ? 90 : (gm > 30 ? 70 : (gm > 15 ? 50 : 30)));
            count++;
        }
        profScore = count > 0 ? Math.round(p / count) : 50;
    }

    let healthScore = 60;
    const de = metric.totalDebtToEquityAnnual || metric['totalDebt/totalEquityQuarterly'];
    const cr = metric.currentRatioQuarterly || metric.currentRatioAnnual;
    if (de != null || cr != null) {
        let h = 0, count = 0;
        if (de != null) {
            h += (de < 50 ? 90 : (de < 120 ? 70 : (de < 250 ? 45 : 20)));
            count++;
        }
        if (cr != null) {
            h += (cr > 1.5 ? 85 : (cr >= 1.0 ? 70 : 35));
            count++;
        }
        healthScore = count > 0 ? Math.round(h / count) : 60;
    }

    let momScore = 50;
    const h52 = metric['52WeekHigh'];
    const l52 = metric['52WeekLow'];
    if (h52 && l52 && h52 > l52 && metric.currentPrice) {
        const pos = (metric.currentPrice - l52) / (h52 - l52);
        momScore = Math.round(pos * 100);
    }

    const compositeScore = Math.round((valScore * 0.25) + (profScore * 0.35) + (healthScore * 0.25) + (momScore * 0.15));
    let rating = 'Neutral / Market Perform';
    if (compositeScore >= 78) rating = 'High Conviction / Institutional Quality';
    else if (compositeScore >= 65) rating = 'Constructive / Favorable';
    else if (compositeScore < 45) rating = 'Defensive / Elevated Risk';

    return {
        compositeScore,
        rating,
        factors: {
            valuation: valScore,
            profitability: profScore,
            solvencyHealth: healthScore,
            momentum: momScore
        }
    };
}

router.post('/analyze', async (req, res) => {
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
        return res.status(429).json({ error: 'Rate limit reached. Please wait a moment before running another scan.', errorType: 'RATE_LIMITED' });
    }

    const { frame } = req.body || {};
    const symbol = requireTicker(req, res);
    if (!symbol) return;
    const frameKey = AI_FRAME_INSTRUCTIONS[frame] ? frame : 'dupont';

    const cacheKey = `${symbol}_${frameKey}`;
    const cached = aiAnalysisCache.getData(cacheKey);
    if (cached) {
        return res.json(wrapWithProvenance({ ...cached, cached: true }, {
            provider: cached.provider || 'AI',
            freshness: FRESHNESS.CACHED,
            dataQuality: DATA_QUALITY.OFFICIAL,
            endpoint: 'ai_analyze'
        }));
    }

    if (!getAiProvider()) {
        return res.status(503).json({
            error: 'No AI API key configured. Add GROQ_API_KEY (free at console.groq.com) to .env',
            errorType: 'AI_PROVIDER_ERROR'
        });
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

        if (!profile?.name || typeof quote?.c !== 'number') {
            return res.status(404).json({ error: 'Ticker not found or market data unavailable.', errorType: 'TICKER_NOT_FOUND' });
        }

        // Fetch extra technical signals for momentum frame
        let technicalData = {};
        if (frameKey === 'momentum') {
            try {
                const recRes = await fetch(
                    `https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(symbol)}&token=${finnhubToken}`
                );
                const recData = await recRes.json();
                if (Array.isArray(recData) && recData.length > 0) {
                    const latest = recData[0];
                    technicalData.analystConsensus = {
                        period: latest.period,
                        strongBuy: latest.strongBuy,
                        buy: latest.buy,
                        hold: latest.hold,
                        sell: latest.sell,
                        strongSell: latest.strongSell,
                    };
                }
            } catch (e) {
                console.warn('Could not fetch recommendation trends:', e.message);
            }
        }

        // Fetch historical statements for DuPont, DCF, Moat, and Altman frames (with cache)
        let financials = {};
        const statementFrames = new Set(['dupont', 'dcf', 'altman', 'moat']);
        if (statementFrames.has(frameKey)) {
            try {
                financials = await fetchHistoricalStatements(symbol);
            } catch (e) {
                console.warn('Could not fetch historical statements for AI context:', e.message);
            }
        }

        const prompt = buildAiPrompt(symbol, frameKey, profile, quote, metricsPayload, technicalData, financials);
        const { analysis, provider } = await generateAiAnalysis(prompt);

        const metricData = metricsPayload?.metric || {};
        metricData.currentPrice = quote.c;
        const quantScorecard = computeQuantScorecard(metricData);

        const payload = {
            analysis,
            symbol,
            frame: frameKey,
            provider,
            model: provider === 'groq'
                ? (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile')
                : (process.env.GEMINI_MODEL || 'gemini-2.5-flash'),
            companyName: profile.name,
            industry: profile.finnhubIndustry,
            exchange: profile.exchange,
            marketCap: profile.marketCapitalization,
            price: quote.c,
            change: quote.d,
            changePercent: quote.dp,
            high52w: metricData['52WeekHigh'],
            low52w: metricData['52WeekLow'],
            metrics: pickMetricsForAi(metricData),
            quantScorecard
        };

        aiAnalysisCache.set(cacheKey, payload);
        res.json(wrapWithProvenance(payload, {
            provider,
            freshness: FRESHNESS.LIVE,
            dataQuality: DATA_QUALITY.OFFICIAL,
            endpoint: 'ai_analyze'
        }));
    } catch (error) {
        console.error('AI Analyze Error:', error);
        const status = error.statusCode || 500;
        const message = status === 500 ? 'Failed to generate AI analysis.' : error.message;
        res.status(status).json({ error: message, errorType: status === 404 ? 'TICKER_NOT_FOUND' : 'AI_PROVIDER_ERROR' });
    }
});

async function fetchHistoricalStatements(symbol) {
    const cached = statementsCache.getData(symbol);
    if (cached) return cached;

    const financials = { balanceSheet: null, cashFlow: null };
    if (!process.env.TWELVEDATA_API_KEY) {
        await fetchFmpStatements(symbol, financials);
        if (financials.balanceSheet || financials.cashFlow) statementsCache.set(symbol, financials);
        return financials;
    }

    try {
        const [bsRes, cfRes] = await Promise.all([
            fetch(`https://api.twelvedata.com/balance_sheet?symbol=${encodeURIComponent(symbol)}&apikey=${process.env.TWELVEDATA_API_KEY}`),
            fetch(`https://api.twelvedata.com/cash_flow?symbol=${encodeURIComponent(symbol)}&apikey=${process.env.TWELVEDATA_API_KEY}`)
        ]);

        const bsData = await bsRes.json();
        const cfData = await cfRes.json();

        if (bsData?.status === 'ok' && Array.isArray(bsData.balance_sheet)) {
            financials.balanceSheet = bsData.balance_sheet.slice(0, 3).map(item => ({
                fiscalDate: item.datetime,
                totalAssets: item.total_assets || item.totalAssets,
                totalLiabilities: item.total_liabilities || item.totalLiabilities,
                totalEquity: item.total_shareholders_equity || item.totalEquity
            }));
        }
        if (cfData?.status === 'ok' && Array.isArray(cfData.cash_flow)) {
            financials.cashFlow = cfData.cash_flow.slice(0, 3).map(item => ({
                fiscalDate: item.datetime,
                operatingCashFlow: item.operating_cash_flow || item.operatingCashFlow,
                capitalExpenditures: item.capital_expenditures || item.capitalExpenditures || item.netCashUsedForInvestingActivites,
                netChangeInCash: item.net_change_in_cash || item.netChangeInCash
            }));
        }
    } catch (error) {
        console.warn('TwelveData fetch failed for AI statements, trying FMP fallback:', error.message);
    }

    if (!financials.balanceSheet || !financials.cashFlow) {
        await fetchFmpStatements(symbol, financials);
    }

    if (financials.balanceSheet || financials.cashFlow) {
        statementsCache.set(symbol, financials);
    }

    return financials;
}

async function fetchFmpStatements(symbol, financials) {
    const fmpKey = process.env.FMP_API_KEY || process.env.FINANCIAL_MODELING_PREP_API_KEY || process.env.FINANCIALMODELINGPREP_API_KEY;
    if (!fmpKey) return;

    try {
        if (!financials.balanceSheet) {
            const bsRes = await fetch(`https://financialmodelingprep.com/api/v3/balance-sheet-statement/${encodeURIComponent(symbol)}?limit=3&apikey=${fmpKey}`);
            const bsData = await bsRes.json();
            if (Array.isArray(bsData)) {
                financials.balanceSheet = bsData.map(item => ({
                    fiscalDate: item.date,
                    totalAssets: item.totalAssets,
                    totalLiabilities: item.totalLiabilities,
                    totalEquity: item.totalStockholdersEquity || item.totalEquity
                }));
            }
        }
        if (!financials.cashFlow) {
            const cfRes = await fetch(`https://financialmodelingprep.com/api/v3/cash-flow-statement/${encodeURIComponent(symbol)}?limit=3&apikey=${fmpKey}`);
            const cfData = await cfRes.json();
            if (Array.isArray(cfData)) {
                financials.cashFlow = cfData.map(item => ({
                    fiscalDate: item.date,
                    operatingCashFlow: item.operatingCashFlow,
                    capitalExpenditures: item.capitalExpenditures || item.netCashUsedForInvestingActivites || item.netCashUsedForInvestingActivities,
                    netChangeInCash: item.netChangeInCash
                }));
            }
        }
    } catch (error) {
        console.warn('FMP statements fallback failed:', error.message);
    }
}

router.post('/followup', async (req, res) => {
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
        return res.status(429).json({ error: 'Rate limit reached. Please wait a moment before running another scan.', errorType: 'RATE_LIMITED' });
    }

    const { ticker, previousAnalysis, question } = req.body;
    if (!ticker || !previousAnalysis || !question) {
        return res.status(400).json({ error: 'Missing required fields: ticker, previousAnalysis, question' });
    }

    if (!getAiProvider()) {
        return res.status(503).json({
            error: 'No AI API key configured. Add GROQ_API_KEY (free at console.groq.com) to .env',
            errorType: 'AI_PROVIDER_ERROR'
        });
    }

    try {
        const prompt = `You are STRATA, an educational institutional equity research assistant.
The user previously ran an analysis on ${ticker}:
---
${previousAnalysis}
---
The user has a follow-up question: ${question}
Answer concisely (under 300 words). Use markdown formatting. Not financial advice.`;

        const { analysis, provider } = await generateAiAnalysis(prompt);
        res.json(wrapWithProvenance({ analysis, provider }, {
            provider,
            freshness: FRESHNESS.LIVE,
            dataQuality: DATA_QUALITY.OFFICIAL,
            endpoint: 'ai_followup'
        }));
    } catch (error) {
        console.error('AI Followup Error:', error);
        const status = error.statusCode || 500;
        const message = status === 500 ? 'Failed to generate AI followup.' : error.message;
        res.status(status).json({ error: message, errorType: 'AI_PROVIDER_ERROR' });
    }
});

module.exports = router;
