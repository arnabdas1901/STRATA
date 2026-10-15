const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getAiProvider, generateAiAnalysis } = require('../utils/aiProviders');
const { MemoryCache } = require('../utils/cache');
const { wrapWithProvenance, DATA_QUALITY, FRESHNESS } = require('../utils/provenance');

const stressCache = new MemoryCache('stress-analysis', 30 * 60 * 1000, 100);

// In-memory sliding window rate limiter (5 per minute per IP)
const rateLimits = new Map();
function checkStressRateLimit(ip) {
    const now = Date.now();
    const windowStart = now - 60000;
    if (!rateLimits.has(ip)) {
        rateLimits.set(ip, []);
    }
    const timestamps = rateLimits.get(ip).filter(t => t > windowStart);
    if (timestamps.length >= 5) {
        return false;
    }
    timestamps.push(now);
    rateLimits.set(ip, timestamps);
    return true;
}

router.post('/analyze', async (req, res) => {
    try {
        const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
        if (!checkStressRateLimit(clientIp)) {
            return res.status(429).json({ error: 'Too many stress test analyses requested. Please wait a minute.' });
        }

        const aiProvider = getAiProvider();
        if (!aiProvider) {
            return res.status(503).json({ analysis: null, error: 'No AI provider configured' });
        }

        const { scenario, totalDrawdown, stressedValue, capital, allocations, riskMetrics } = req.body;

        // Create cache key based on payload signature
        const payloadHash = crypto.createHash('md5')
            .update(JSON.stringify({ scenario, totalDrawdown, stressedValue, allocations, riskMetrics }))
            .digest('hex');
        const cacheKey = `stress_${payloadHash}`;

        const cached = stressCache.getData(cacheKey);
        if (cached) {
            return res.json(wrapWithProvenance(cached, {
                provider: 'AI (Cached)',
                freshness: FRESHNESS.CACHED,
                dataQuality: DATA_QUALITY.OFFICIAL,
                endpoint: 'stress_analyze'
            }));
        }

        const prompt = `You are a Chief Risk Officer at an institutional investment firm. Write a professional, concise (5–7 sentences) risk assessment based on the following portfolio stress test results. Use a formal, Bloomberg-terminal style tone. Do NOT use markdown headings.

STRESS TEST RESULTS:
- Scenario: ${scenario || 'N/A'}
- Portfolio Capital: $${Number(capital || 0).toLocaleString()}
- Total Drawdown: ${Number(totalDrawdown || 0).toFixed(2)}%
- Stressed Portfolio Value: $${Number(stressedValue || 0).toLocaleString()}
- Value at Risk (95%): ${Number(riskMetrics?.var95 || 0).toFixed(2)}%
- Conditional VaR: ${Number(riskMetrics?.cvar || 0).toFixed(2)}%
- Max Drawdown: ${Number(riskMetrics?.maxDrawdown || 0).toFixed(2)}%
- Sharpe Ratio: ${Number(riskMetrics?.sharpe || 0).toFixed(3)}
- Sortino Ratio: ${Number(riskMetrics?.sortino || 0).toFixed(3)}
- Probability of Loss: ${Number(riskMetrics?.probLoss || 0).toFixed(1)}%
- Expected Annual Return: ${Number(riskMetrics?.meanReturn || 0).toFixed(2)}%
- Portfolio Allocation: ${JSON.stringify(allocations || {})}

INSTRUCTIONS:
1. Assess whether the portfolio's risk profile is appropriate given the drawdown exposure.
2. Comment on the VaR and CVaR levels relative to the portfolio's expected return (risk-reward tradeoff).
3. Suggest ONE specific, actionable rebalancing recommendation to improve resilience.
4. Do NOT include conversational filler, disclaimers, or "I'd recommend" phrasing. Write as if this is a risk report excerpt.
5. Keep it under 150 words.`;

        const aiResponse = await generateAiAnalysis(prompt, { maxTokens: 400, temperature: 0.4 });
        const analysis = typeof aiResponse === 'string' ? aiResponse : (aiResponse?.analysis || '');

        const responseData = { analysis };
        stressCache.set(cacheKey, responseData);

        res.json(wrapWithProvenance(responseData, {
            provider: aiResponse?.provider || 'AI',
            freshness: FRESHNESS.LIVE,
            dataQuality: DATA_QUALITY.OFFICIAL,
            endpoint: 'stress_analyze'
        }));

    } catch (err) {
        console.error('Stress AI Error:', err);
        res.status(500).json({ analysis: null, error: err.message });
    }
});

module.exports = router;
