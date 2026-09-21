const express = require('express');
const router = express.Router();
const { normalizeTicker, fetchJson } = require('../utils/api');
const { MemoryCache } = require('../utils/cache');
const { wrapWithProvenance, DATA_QUALITY } = require('../utils/provenance');
const { generateAiAnalysis, getAiProvider } = require('../utils/aiProviders');
const { fetchCompanyFacts, fetchCompanyFilings, fetchCapitalAllocation, fetchEarningsQualityData, extractFinancialTimeSeries } = require('../utils/secProviders');

const cache = new MemoryCache(1800); // 30 minutes cache

// Basic in-memory rate limiter (5 per min per IP)
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
        const ip = req.ip || req.connection.remoteAddress;
        if (!checkRateLimit(ip)) {
            return res.status(429).json({ error: 'Too many requests, please try again later.' });
        }

        const rawTicker = req.body.ticker;
        if (!rawTicker) {
            return res.status(400).json({ error: 'Ticker is required' });
        }
        
        const ticker = normalizeTicker(rawTicker);
        const cacheKey = `report_${ticker}`;
        
        const cached = cache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const aiProvider = getAiProvider();
        if (!aiProvider) {
            return res.status(503).json({ error: 'AI provider is required for report generation but none are configured' });
        }

        const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
        
        // Fetch data in parallel directly from external providers
        const [
            profileData,
            metricsData,
            quoteData,
            recommendationData,
            secFacts,
            secFilings,
            capitalAllocation,
            earningsQuality
        ] = await Promise.all([
            fetchJson(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB_KEY}`).catch(() => ({})),
            fetchJson(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB_KEY}`).catch(() => ({})),
            fetchJson(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`).catch(() => ({})),
            fetchJson(`https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${FINNHUB_KEY}`).catch(() => []),
            fetchCompanyFacts(ticker).catch(() => null),
            fetchCompanyFilings(ticker, 5).catch(() => []),
            fetchCapitalAllocation(ticker).catch(() => null),
            fetchEarningsQualityData(ticker).catch(() => null)
        ]);

        // Construct token-efficient evidence pack
        const evidencePack = `
COMPANY PROFILE:
${JSON.stringify(profileData)}

KEY METRICS:
${JSON.stringify(metricsData?.metric || {})}

CURRENT QUOTE:
${JSON.stringify(quoteData)}

ANALYST RECOMMENDATIONS:
${JSON.stringify(recommendationData?.[0] || {})}

CAPITAL ALLOCATION:
${JSON.stringify(capitalAllocation || {})}

EARNINGS QUALITY:
${JSON.stringify(earningsQuality || {})}

RECENT FILINGS:
${JSON.stringify(secFilings?.slice(0, 3).map(f => ({ form: f.form, date: f.filingDate })) || [])}
        `.trim().substring(0, 15000); // Limit length to avoid massive token costs

        const prompt = `You are a Senior Equity Research Analyst at a top-tier investment bank.
Generate a comprehensive equity research report for ${ticker}.

Use ONLY the following verified data. Cite sources using [Source: provider] notation.
Never fabricate any numbers.

Structure:
## Company Overview
## Investment Context  
## Financial Performance
## Valuation Assessment
## Peer Comparison Context
## Risk Assessment
## Macro Exposure
## Recent SEC Filings
## What The Data Does NOT Tell Us
## Data Sources

EVIDENCE PACK:
${evidencePack}`;

        const reportContent = await generateAiAnalysis(prompt, { maxTokens: 4000 });
        
        const responseData = {
            report: {
                ticker: ticker,
                title: `${ticker} — Equity Research Report`,
                generatedAt: new Date().toISOString(),
                content: reportContent,
                provider: aiProvider.provider,
                model: aiProvider.model,
                dataSources: ["SEC EDGAR", "Finnhub", "FRED"]
            }
        };

        const finalResponse = wrapWithProvenance(
            responseData,
            'report-generator',
            DATA_QUALITY.REALTIME,
            [
                { provider: 'Finnhub', type: 'market-data' },
                { provider: 'SEC', type: 'fundamental' },
                { provider: aiProvider.provider, type: 'ai-analysis' }
            ]
        );

        cache.set(cacheKey, finalResponse);
        res.json(finalResponse);

    } catch (error) {
        console.error('Report Generation Error:', error);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

module.exports = router;
