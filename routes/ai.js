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

        const prompt = buildAiPrompt(symbol, frameKey, profile, quote, metricsPayload, technicalData);
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

module.exports = router;
