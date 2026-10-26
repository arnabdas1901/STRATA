const express = require('express');
const router = express.Router();
const { normalizeTicker } = require('../utils/api');
const { MemoryCache } = require('../utils/cache');
const { wrapWithProvenance, DATA_QUALITY, FRESHNESS } = require('../utils/provenance');
const { generateAiAnalysis, getAiProvider, getAiProviderInfo, buildEvidencePack } = require('../utils/aiProviders');
const { getOrFetchTickerContext } = require('./ai');

const cache = new MemoryCache('report', 30 * 60 * 1000, 50); // 30 minutes cache

// In-memory rate limiter (5 per min per IP)
const rateLimits = new Map();
const checkRateLimit = (ip) => {
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
};

router.post('/generate', async (req, res) => {
    try {
        const ip = req.ip || req.connection?.remoteAddress || '127.0.0.1';
        if (!checkRateLimit(ip)) {
            return res.status(429).json({ error: 'Too many requests, please try again later.' });
        }

        const rawTicker = req.body.ticker;
        if (!rawTicker) {
            return res.status(400).json({ error: 'Ticker is required' });
        }
        
        const ticker = normalizeTicker(rawTicker);
        const cacheKey = `report_${ticker}`;
        
        const cached = cache.getValue(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const aiProvider = getAiProvider();
        if (!aiProvider) {
            return res.status(503).json({ error: 'AI provider is required for report generation but none are configured' });
        }
        const aiInfo = getAiProviderInfo();
        const start = Date.now();
        
        // Retrieve unified ticker context (shares cache with AI scan, 0 outbound calls if already analyzed)
        const context = await getOrFetchTickerContext(ticker);
        if (!context) {
            return res.status(404).json({ error: `Could not retrieve market or fundamental context for ${ticker}` });
        }

        // Build token-efficient structured evidence pack with deterministic quant scorecard
        const evidencePack = buildEvidencePack(ticker, {
            profile: context.profile,
            quote: context.quote,
            metrics: context.metricsPayload?.metric || {},
            recommendations: context.analystConsensus ? [context.analystConsensus] : [],
            secFacts: context.secFacts,
            filings: context.filings,
            capitalAllocation: context.capitalAllocation,
            earningsQuality: context.earningsQuality,
            quantScorecard: context.quantScorecard,
            peers: context.peers
        });

        const prompt = `You are a Senior Institutional Equity Research Analyst at a top-tier investment bank.
Generate an institutional-grade equity research report for ${ticker}.

Use ONLY the verified facts from the EVIDENCE PACK below. Cite data sources using institutional [Source: ...] bracket notation.
Never fabricate any numbers. If a specific figure is missing, state that it is unavailable.

Report Structure:
## Company Overview & Business Model
## Macro & Industry Competitive Landscape
## Financial Performance & Margin Profile
## Valuation Assessment & Multiples Context
## Capital Allocation & Balance Sheet Durability
## Earnings Quality & Forensic Checks
## Key Risks & Downside Scenarios
## What The Available Data Does NOT Tell Us
## Institutional Verdict & Consensus Summary

${evidencePack}`;

        const reportContent = await generateAiAnalysis(prompt, { maxTokens: 3500, temperature: 0.5 });
        
        const responseData = {
            report: {
                ticker: ticker,
                title: `${ticker} — Institutional Equity Research Report`,
                generatedAt: new Date().toISOString(),
                content: typeof reportContent === 'string' ? reportContent : (reportContent?.analysis || ''),
                provider: aiInfo.provider || 'AI',
                model: aiInfo.model || 'unknown',
                dataSources: ["SEC EDGAR (XBRL)", "Finnhub", "FRED"]
            }
        };

        const finalResponse = wrapWithProvenance(responseData, {
            provider: aiInfo.provider || 'AI',
            freshness: FRESHNESS.LIVE,
            dataQuality: DATA_QUALITY.OFFICIAL,
            latencyMs: Date.now() - start,
            endpoint: 'report_generate'
        });

        cache.set(cacheKey, finalResponse);
        res.json(finalResponse);

    } catch (error) {
        console.error('Report Generation Error:', error);
        res.status(500).json({ error: 'Failed to generate report', details: error.message });
    }
});

module.exports = router;
