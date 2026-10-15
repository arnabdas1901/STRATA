const express = require('express');
const router = express.Router();
const { normalizeTicker, fetchJson } = require('../utils/api');
const { MemoryCache } = require('../utils/cache');
const { wrapWithProvenance, DATA_QUALITY, FRESHNESS } = require('../utils/provenance');
const { generateAiAnalysis, getAiProvider, getAiProviderInfo, buildEvidencePack } = require('../utils/aiProviders');
const { fetchCompanyFacts, fetchCompanyFilings, fetchCapitalAllocation, fetchEarningsQualityData } = require('../utils/secProviders');

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
        
        const cached = cache.getData(cacheKey);
        if (cached) {
            return res.json(wrapWithProvenance(cached, {
                provider: 'Cache',
                freshness: FRESHNESS.CACHED,
                dataQuality: DATA_QUALITY.OFFICIAL,
                endpoint: 'report_cache'
            }));
        }

        const aiProvider = getAiProvider();
        if (!aiProvider) {
            return res.status(503).json({ error: 'AI provider is required for report generation but none are configured' });
        }
        const aiInfo = getAiProviderInfo();

        const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
        const start = Date.now();
        
        // Fetch data in parallel directly from external providers with proper fetchJson destructuring
        const [
            profileRes,
            metricsRes,
            quoteRes,
            recommendationRes,
            secFacts,
            secFilings,
            capitalAllocation,
            earningsQuality
        ] = await Promise.all([
            fetchJson(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB_KEY}`).catch(() => ({ data: {} })),
            fetchJson(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB_KEY}`).catch(() => ({ data: {} })),
            fetchJson(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`).catch(() => ({ data: {} })),
            fetchJson(`https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${FINNHUB_KEY}`).catch(() => ({ data: [] })),
            fetchCompanyFacts(ticker).catch(() => null),
            fetchCompanyFilings(ticker).catch(() => []),
            fetchCapitalAllocation(ticker).catch(() => null),
            fetchEarningsQualityData(ticker).catch(() => null)
        ]);

        const profileData = profileRes.data || {};
        const metricsData = metricsRes.data || {};
        const quoteData = quoteRes.data || {};
        const recommendationData = Array.isArray(recommendationRes.data) ? recommendationRes.data : [];

        // Build token-efficient structured evidence pack
        const evidencePack = buildEvidencePack(ticker, {
            profile: profileData,
            quote: quoteData,
            metrics: metricsData,
            recommendations: recommendationData,
            secFacts,
            filings: secFilings,
            capitalAllocation,
            earningsQuality
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
