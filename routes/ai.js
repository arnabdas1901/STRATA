const express = require('express');
const router = express.Router();
const { requireTicker } = require('../utils/api');
const {
    AI_FRAME_INSTRUCTIONS,
    buildAiPrompt,
    getAiProvider,
    getAiProviderInfo,
    generateAiAnalysis,
    pickMetricsForAi,
    computeDeterministicQuant
} = require('../utils/aiProviders');
const { MemoryCache } = require('../utils/cache');
const { wrapWithProvenance, DATA_QUALITY, FRESHNESS } = require('../utils/provenance');
const {
    fetchCompanyFacts,
    fetchCapitalAllocation,
    fetchEarningsQualityData,
    fetchCompanyFilings
} = require('../utils/secProviders');
const {
    resolveCachedProfile,
    resolveCachedQuote,
    resolveCachedMetrics,
    resolveCachedRecommendations,
    resolveCachedPeers
} = require('../utils/equityProviders');

// Caches for analysis results, compare results, and unified ticker context
const aiAnalysisCache = new MemoryCache('ai-analysis', 15 * 60 * 1000, 100);
const aiCompareCache = new MemoryCache('ai-compare', 15 * 60 * 1000, 50);
const TICKER_CONTEXT_CACHE = new MemoryCache('ai-ticker-context', 30 * 60 * 1000, 100);
const inFlightContext = new Map();

// IP Rate Limiting (30 requests/minute, do not count cache hits)
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 30;
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

// ── Unified Ticker Context Fetcher (Zero-Redundancy Multi-Frame Deduplication) ──
async function getOrFetchTickerContext(symbol) {
    if (!symbol) return null;
    const sym = symbol.toUpperCase().trim();

    // 1. Check in-memory 30-min cache
    const cached = TICKER_CONTEXT_CACHE.getData(sym);
    if (cached) {
        return cached;
    }

    // 2. Check in-flight promise deduplication
    if (inFlightContext.has(sym)) {
        return inFlightContext.get(sym);
    }

    // 3. Initiate parallel non-redundant fetch using shared cached resolvers
    const contextPromise = (async () => {
        const [
            profile,
            quote,
            metricsPayload,
            recs,
            peersRaw,
            secFacts,
            capitalAllocation,
            earningsQuality,
            filings
        ] = await Promise.all([
            resolveCachedProfile(sym),
            resolveCachedQuote(sym),
            resolveCachedMetrics(sym),
            resolveCachedRecommendations(sym),
            resolveCachedPeers(sym),
            fetchCompanyFacts(sym).catch(() => null),
            fetchCapitalAllocation(sym).catch(() => []),
            fetchEarningsQualityData(sym).catch(() => []),
            fetchCompanyFilings(sym, '10-K').catch(() => [])
        ]);

        const analystConsensus = Array.isArray(recs) && recs.length > 0 ? recs[0] : null;
        const peers = (Array.isArray(peersRaw) ? peersRaw : []).map(p => ({
            symbol: typeof p === 'string' ? p : (p.symbol || p)
        }));

        // Compute deterministic quantitative scorecard
        const quantScorecard = computeDeterministicQuant({
            profile,
            quote,
            metricsPayload,
            secCapitalAllocation: capitalAllocation,
            secEarningsQuality: earningsQuality,
            analystConsensus
        });

        const context = {
            symbol: sym,
            profile,
            quote,
            metricsPayload,
            analystConsensus,
            peers,
            secFacts,
            capitalAllocation,
            earningsQuality,
            filings,
            quantScorecard
        };

        TICKER_CONTEXT_CACHE.set(sym, context);
        return context;
    })().finally(() => {
        inFlightContext.delete(sym);
    });

    inFlightContext.set(sym, contextPromise);
    return contextPromise;
}

// ── GET /api/ai/info (Dynamic Provider & Model Status) ──────────────────────────
router.get('/info', (req, res) => {
    const info = getAiProviderInfo();
    res.json(info);
});

// ── POST /api/ai/analyze & /api/ai/analyze-stock (Flagship Quantitative Scan) ─────
const handleAiAnalyze = async (req, res) => {
    const { frame } = req.body || {};
    const symbol = requireTicker(req, res);
    if (!symbol) return;
    const frameKey = AI_FRAME_INSTRUCTIONS[frame] ? frame : 'ic_debate';

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

    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
        return res.status(429).json({
            error: 'Rate limit reached (30 scans/min). Please wait a moment before running another scan.',
            errorType: 'RATE_LIMITED'
        });
    }

    if (!getAiProvider()) {
        return res.status(503).json({
            error: 'No AI API key configured. Add GROQ_API_KEY (free at console.groq.com) or GEMINI_API_KEY to .env',
            errorType: 'AI_PROVIDER_ERROR'
        });
    }

    try {
        const context = await getOrFetchTickerContext(symbol);
        if (!context || !context.profile?.name) {
            return res.status(404).json({ error: 'Ticker not found or market data unavailable.', errorType: 'TICKER_NOT_FOUND' });
        }

        const prompt = buildAiPrompt(symbol, frameKey, context);
        const { analysis, provider } = await generateAiAnalysis(prompt);

        const metricData = context.metricsPayload?.metric || {};
        metricData.currentPrice = context.quote.c;
        const providerInfo = getAiProviderInfo();

        const payload = {
            analysis,
            symbol,
            frame: frameKey,
            provider,
            model: providerInfo.model || 'llama-3.3-70b-versatile',
            companyName: context.profile.name,
            industry: context.profile.finnhubIndustry,
            exchange: context.profile.exchange,
            marketCap: context.profile.marketCapitalization,
            price: context.quote.c,
            change: context.quote.d,
            changePercent: context.quote.dp,
            high52w: metricData['52WeekHigh'] || context.quote.h,
            low52w: metricData['52WeekLow'] || context.quote.l,
            metrics: pickMetricsForAi(metricData),
            quantScorecard: context.quantScorecard,
            capitalAllocation: (context.capitalAllocation || []).slice(-4),
            earningsQuality: (context.earningsQuality || []).slice(-4),
            analystConsensus: context.analystConsensus,
            peers: context.peers,
            secFilings: (context.filings || []).slice(-4)
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
};

router.post('/analyze', handleAiAnalyze);
router.post('/analyze-stock', handleAiAnalyze);

// ── POST /api/ai/compare (Head-to-Head Peer Showdown) ──────────────────────────
router.post('/compare', async (req, res) => {
    const { symbolA, symbolB } = req.body || {};
    if (!symbolA || !symbolB) {
        return res.status(400).json({ error: 'Missing required symbols for head-to-head comparison.' });
    }

    const symA = symbolA.toUpperCase().trim();
    const symB = symbolB.toUpperCase().trim();
    if (symA === symB) {
        return res.status(400).json({ error: 'Cannot compare a ticker against itself. Enter two distinct symbols.' });
    }

    const cacheKey = `${symA}_vs_${symB}`;
    const cached = aiCompareCache.getData(cacheKey);
    if (cached) {
        return res.json(wrapWithProvenance({ ...cached, cached: true }, {
            provider: cached.provider || 'AI',
            freshness: FRESHNESS.CACHED,
            dataQuality: DATA_QUALITY.OFFICIAL,
            endpoint: 'ai_compare'
        }));
    }

    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
        return res.status(429).json({ error: 'Rate limit reached. Please wait a moment.', errorType: 'RATE_LIMITED' });
    }

    try {
        const [ctxA, ctxB] = await Promise.all([
            getOrFetchTickerContext(symA),
            getOrFetchTickerContext(symB)
        ]);

        if (!ctxA || !ctxB) {
            return res.status(404).json({ error: 'One or both tickers could not be resolved.', errorType: 'TICKER_NOT_FOUND' });
        }

        const prompt = `You are STRATA, a Managing Director in Quantitative Equities and Principal Architect of BloombergGPT.
Perform an institutional Head-to-Head Quant & Fundamental Showdown between:
- Instrument A: ${symA} (${ctxA.profile?.name || symA})
- Instrument B: ${symB} (${ctxB.profile?.name || symB})

Compare them rigorously across 5 dimensions using the verified metrics below:
### 1. Valuation & Multiple Disconnect
Compare P/E, P/S, EV/EBITDA, FCF yield, and Reverse-DCF implied 5-year growth rates. Which stock offers better margin of safety?

### 2. Profitability, Moat & Margin Power
Compare Gross Margins, Operating Margins, ROIC, and DuPont decomposition drivers. Who has superior pricing power?

### 3. Balance Sheet Fortress & Solvency Risk
Compare Altman Z-Scores, Debt/Equity, and Current Ratios. Which company has lower distress risk?

### 4. Capital Allocation & Earnings Quality
Compare 5-year Capital Allocation (CapEx vs Buybacks/Dividends) and Piotroski F-Scores. Who has better capital stewardship?

### 5. Final Institutional Showdown Verdict
| Metric / Pillar | ${symA} | ${symB} | Decisive Winner |
| :--- | :--- | :--- | :--- |
| STRATA Conviction Score | ${ctxA.quantScorecard.convictionScore}/100 | ${ctxB.quantScorecard.convictionScore}/100 | |
| Piotroski F-Score | ${ctxA.quantScorecard.piotroski.totalScore}/9 | ${ctxB.quantScorecard.piotroski.totalScore}/9 | |
| Altman Z-Score | ${ctxA.quantScorecard.altman.zScore} (${ctxA.quantScorecard.altman.zone}) | ${ctxB.quantScorecard.altman.zScore} (${ctxB.quantScorecard.altman.zone}) | |
| Implied 5Y FCF CAGR | ${ctxA.quantScorecard.dcfModel.implied5YFcfCagrPct}% | ${ctxB.quantScorecard.dcfModel.implied5YFcfCagrPct}% | |
| Net Profit Margin | ${ctxA.quantScorecard.dupont.netProfitMarginPct}% | ${ctxB.quantScorecard.dupont.netProfitMarginPct}% | |

Conclude with the overall Risk-Adjusted Winner and the single primary catalyst/risk for each.
Not financial advice.`;

        const { analysis, provider } = await generateAiAnalysis(prompt);
        const providerInfo = getAiProviderInfo();

        const payload = {
            analysis,
            symbolA: symA,
            symbolB: symB,
            provider,
            model: providerInfo.model,
            contextA: {
                symbol: symA,
                companyName: ctxA.profile.name,
                price: ctxA.quote.c,
                changePercent: ctxA.quote.dp,
                quantScorecard: ctxA.quantScorecard,
                metrics: pickMetricsForAi(ctxA.metricsPayload?.metric)
            },
            contextB: {
                symbol: symB,
                companyName: ctxB.profile.name,
                price: ctxB.quote.c,
                changePercent: ctxB.quote.dp,
                quantScorecard: ctxB.quantScorecard,
                metrics: pickMetricsForAi(ctxB.metricsPayload?.metric)
            }
        };

        aiCompareCache.set(cacheKey, payload);
        res.json(wrapWithProvenance(payload, {
            provider,
            freshness: FRESHNESS.LIVE,
            dataQuality: DATA_QUALITY.OFFICIAL,
            endpoint: 'ai_compare'
        }));
    } catch (error) {
        console.error('AI Compare Error:', error);
        res.status(500).json({ error: error.message || 'Comparison failed.', errorType: 'AI_PROVIDER_ERROR' });
    }
});

// ── POST /api/ai/followup (Full Financial Context Awareness) ───────────────────
router.post('/followup', async (req, res) => {
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
        return res.status(429).json({ error: 'Rate limit reached. Please wait a moment.', errorType: 'RATE_LIMITED' });
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
        // Retrieve full context from cache to give LLM omniscient company awareness
        const context = await getOrFetchTickerContext(ticker).catch(() => null);

        let contextSummary = '';
        if (context) {
            const q = context.quantScorecard;
            contextSummary = `
FINANCIAL DATA FOR ${ticker}:
- Price: $${context.quote.c} (${context.quote.dp >= 0 ? '+' : ''}${context.quote.dp}%)
- Piotroski F-Score: ${q?.piotroski?.totalScore}/9 (${q?.piotroski?.label})
- Altman Z-Score: ${q?.altman?.zScore} (${q?.altman?.zone})
- WACC: ${q?.dcfModel?.waccPct}%, FCF Yield: ${q?.dcfModel?.fcfYieldPct}%, Implied 5Y FCF CAGR: ${q?.dcfModel?.implied5YFcfCagrPct}% (${q?.dcfModel?.valuationStance})
- DuPont: ROE=${q?.dupont?.reportedRoePct}%, NPM=${q?.dupont?.netProfitMarginPct}%, AssetTurnover=${q?.dupont?.assetTurnover}x, EquityMultiplier=${q?.dupont?.equityMultiplier}x
- Core Metrics: ${JSON.stringify(pickMetricsForAi(context.metricsPayload?.metric))}
`;
        }

        const prompt = `You are STRATA, an institutional equity research analyst.
The user previously reviewed this research on ${ticker}:
---
${previousAnalysis.slice(0, 2500)}
---
${contextSummary}

The user has a specific follow-up question:
"${question}"

Answer directly, quantitatively, and concisely (under 250 words). Use markdown formatting and cite exact figures where relevant. Educational only—not financial advice.`;

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
module.exports.getOrFetchTickerContext = getOrFetchTickerContext;
