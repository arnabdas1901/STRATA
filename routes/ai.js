const express = require('express');
const router = express.Router();
const { requireTicker } = require('../utils/api');
const { AI_FRAME_INSTRUCTIONS, buildAiPrompt, getAiProvider, generateAiAnalysis } = require('../utils/aiProviders');

router.post('/analyze', async (req, res) => {
    const { frame } = req.body || {};
    const symbol = requireTicker(req, res);
    if (!symbol) return;
    const frameKey = AI_FRAME_INSTRUCTIONS[frame] ? frame : 'dupont';

    if (!getAiProvider()) {
        return res.status(503).json({
            error: 'No AI API key configured. Add GROQ_API_KEY (free at console.groq.com) to .env',
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
            return res.status(404).json({ error: 'Ticker not found or market data unavailable.' });
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

        // Fetch historical statements for DuPont, DCF, Moat, and Altman frames
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

        res.json({
            analysis,
            symbol,
            frame: frameKey,
            provider,
            model: provider === 'groq'
                ? (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile')
                : (process.env.GEMINI_MODEL || 'gemini-2.5-flash'),
        });
    } catch (error) {
        console.error('AI Analyze Error:', error);
        const status = error.statusCode || 500;
        const message =
            status === 500 ? 'Failed to generate AI analysis.' : error.message;
        res.status(status).json({ error: message });
    }
});

async function fetchHistoricalStatements(symbol) {
    const financials = { balanceSheet: null, cashFlow: null };
    if (!process.env.TWELVEDATA_API_KEY) {
        await fetchFmpStatements(symbol, financials);
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

module.exports = router;
