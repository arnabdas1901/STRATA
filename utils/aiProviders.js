const pickMetricsForAi = (metric) => {
    if (!metric) return {};
    return {
        // Valuation
        peTTM: metric.peTTM,
        pbAnnual: metric.pbAnnual,
        psTTM: metric.psTTM,
        // Profitability
        roeTTM: metric.roeTTM,
        roaTTM: metric.roaTTM,
        netProfitMarginTTM: metric.netProfitMarginTTM,
        grossMarginTTM: metric.grossMarginTTM,
        operatingMarginTTM: metric.operatingMarginTTM,
        // Leverage & Liquidity
        currentRatioAnnual: metric.currentRatioAnnual,
        quickRatioAnnual: metric.quickRatioAnnual,
        debtToEquityAnnual: metric.debtToEquityAnnual,
        longTermDebtToEquityAnnual: metric.longTermDebtToEquityAnnual,
        totalDebtToTotalAssetAnnual: metric.totalDebtToTotalAssetAnnual,
        // Efficiency
        assetTurnoverTTM: metric.assetTurnoverTTM,
        inventoryTurnoverTTM: metric.inventoryTurnoverTTM,
        // Growth
        revenueGrowth5Y: metric.revenueGrowth5Y,
        revenueGrowth3Y: metric.revenueGrowth3Y,
        epsGrowth5Y: metric.epsGrowth5Y,
        epsGrowthTTMYoy: metric.epsGrowthTTMYoy,
        // Shareholder
        dividendYieldIndicatedAnnual: metric.dividendYieldIndicatedAnnual,
        payoutRatioAnnual: metric.payoutRatioAnnual,
        // Technical
        beta: metric.beta,
        '52WeekHigh': metric['52WeekHigh'],
        '52WeekLow': metric['52WeekLow'],
        '10DayAverageTradingVolume': metric['10DayAverageTradingVolume'],
        '3MonthAverageTradingVolume': metric['3MonthAverageTradingVolume'],
    };
};

const AI_FRAME_INSTRUCTIONS = {
    dupont:
        'Perform a 3-stage DuPont ROE decomposition (net profit margin × asset turnover × equity multiplier). Explain drivers using the metrics provided.',
    redflags:
        'Run an automated financial red flags scan: valuation stretch, leverage, liquidity, growth quality, and macro/sector risks.',
    dcf:
        'Explain a discounted cash flow (DCF) framework for this company: key assumptions, FCFF vs FCFE, WACC inputs, and terminal value—educational only, no fabricated precise intrinsic price.',
    benchmarking:
        'Provide qualitative peer-group / sector benchmarking: how valuation and profitability likely compare to sector norms.',
    piotroski:
        `Calculate a proxy Piotroski F-Score (0–9) using the data provided. Follow these steps strictly:
### Step 1 — Profitability (4 points)
* +1 if ROA (roaTTM) > 0
* +1 if Operating Cash Flow proxy (operatingMarginTTM) > 0
* +1 if ROA is improving (compare epsGrowthTTMYoy > 0 as a proxy)
* +1 if Operating Margin > ROA (quality of earnings)
### Step 2 — Leverage & Liquidity (3 points)
* +1 if Debt-to-Equity decreased or is below 0.5
* +1 if Current Ratio > 1.0
* +1 if no significant dilution (infer from payoutRatioAnnual and growth trends)
### Step 3 — Operating Efficiency (2 points)
* +1 if Gross Margin is expanding (grossMarginTTM above sector median ~40%)
* +1 if Asset Turnover is improving (assetTurnoverTTM)
Conclude with the total score and a 2-sentence verdict: Is this a deep value play, a fair-value compounder, or a value trap?`,
    altman:
        `Perform an Altman Z-Score style bankruptcy & financial distress assessment. Follow these steps:
### Step 1 — Liquidity Analysis
Evaluate Current Ratio and Quick Ratio. A current ratio below 1.0 is a red flag. Calculate Working Capital / Total Assets proxy.
### Step 2 — Solvency & Leverage
Analyze Debt-to-Equity and Total Debt / Total Assets. High leverage (D/E > 2.0) significantly increases distress risk.
### Step 3 — Profitability Buffer
Check ROA, Net Margins, and Retained Earnings proxy (EPS growth). Persistent losses erode the equity cushion.
### Step 4 — Market Signal
Compare Market Cap to implied total liabilities (using P/B and D/E). A low market-to-book with high debt is the classic distress signature.
Conclude with a final rating: **Safe Zone** (Z > 2.99), **Grey Zone** (1.81–2.99), or **Distress Zone** (Z < 1.81). Explain why in 2 sentences.`,
    momentum:
        `Analyze the stock's technical momentum and price action setup. Follow these steps:
### Step 1 — Price Position
Calculate where the current price sits relative to the 52-week high and 52-week low. Express this as a percentile (e.g., "trading at 85% of its 52-week range").
### Step 2 — Trend & Volatility
Use the Beta to assess volatility relative to the market. A beta > 1.3 means high volatility; < 0.8 means defensive. Contextualize the recent price change (daily %) against the beta.
### Step 3 — Volume Signal
Compare 10-day average trading volume vs 3-month average. A surge (10d >> 3m) signals institutional accumulation or distribution. A collapse signals apathy.
### Step 4 — Valuation Context
Cross-reference the price momentum against PE and PS multiples. Rising price + expanding multiples = momentum euphoria. Rising price + stable multiples = earnings-driven rally.
Conclude with a setup classification: **Overbought Euphoria**, **Healthy Uptrend**, **Consolidation**, **Oversold Capitulation**, or **Dead Money**.`,
    moat:
        `Perform a Buffett/Munger qualitative Economic Moat analysis. Ignore short-term price action entirely. Focus on durable competitive advantage.
### Step 1 — Pricing Power (Margins)
A company with a moat has sustainably high margins. Check Gross Margin (>40% is strong), Net Margin (>15% is excellent), and Operating Margin. Consistent margins over multiple years (use 3Y/5Y growth as stability proxy) indicate pricing power.
### Step 2 — Capital Efficiency
ROE > 15% sustained over time suggests a moat. ROA > 7% confirms the returns aren't just leverage-driven. Compare ROE and D/E — if ROE is high but D/E is also very high, the "moat" is illusory.
### Step 3 — Growth Without Debt
Check if revenue and EPS growth (3Y and 5Y) are positive while Debt-to-Equity is stable or declining. Growth funded by debt is fragile; growth funded by reinvested earnings is a moat signal.
### Step 4 — Moat Source Classification
Based on the above evidence, classify the moat source:
* **Brand Power** — High margins + premium valuation (high P/E) in consumer-facing industry
* **Network Effect** — Tech/platform company with accelerating revenue growth
* **Switching Costs** — Enterprise/B2B with stable recurring revenue and low churn (steady margins)
* **Cost Advantage** — Low margins but dominant market share and high asset turnover
* **No Moat** — Explain why the company lacks durable advantage
Conclude with a **Moat Rating**: Wide, Narrow, or None.`,
};

const buildAiPrompt = (symbol, frameKey, profile, quote, metricsPayload, technicalData, financials) => {
    const context = {
        symbol,
        company: profile.name,
        industry: profile.finnhubIndustry,
        exchange: profile.exchange,
        marketCap: profile.marketCapitalization,
        price: quote.c,
        change: quote.d,
        changePercent: quote.dp,
        week52High: quote.h,
        week52Low: quote.l,
        metrics: pickMetricsForAi(metricsPayload?.metric),
    };

    // Attach technical/recommendation data when available
    if (technicalData && Object.keys(technicalData).length > 0) {
        context.technicalSignals = technicalData;
    }

    // Attach historical financial statements when available
    if (financials && Object.keys(financials).length > 0) {
        context.historicalFinancials = financials;
    }

    return `You are STRATA, an educational equity research assistant.

RULES:
- Not financial advice; include a one-sentence disclaimer at the end.
- Use markdown headings (###) and bullet points (*); stay under 550 words.
- Use only the JSON data below; if a field is null or missing, write "data unavailable".
- Do not invent exact price targets or fabricated financial statement line items.
- Show your reasoning step by step as instructed.

TASK: ${AI_FRAME_INSTRUCTIONS[frameKey]}

DATA:
${JSON.stringify(context, null, 2)}

Write the analysis for ${symbol}.`;
};

const getAiProvider = () => {
    if (process.env.GROQ_API_KEY) return 'groq';
    if (process.env.GEMINI_API_KEY) return 'gemini';
    return null;
};

async function generateWithGroq(prompt) {
    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.6,
            max_tokens: 1024,
        }),
    });

    const data = await response.json();
    if (!response.ok) {
        const message = data?.error?.message || 'Groq API request failed';
        console.error('Groq API Error:', data);
        const err = new Error(message);
        err.statusCode = 502;
        throw err;
    }

    const text = data?.choices?.[0]?.message?.content || '';
    if (!text.trim()) {
        const err = new Error('Empty response from AI model.');
        err.statusCode = 502;
        throw err;
    }
    return text.trim();
}

async function generateWithGemini(prompt) {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const geminiUrl =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.6,
                maxOutputTokens: 1024,
            },
        }),
    });

    const data = await response.json();
    if (!response.ok) {
        let message = data?.error?.message || 'Gemini API request failed';
        if (message.includes('limit: 0')) {
            message =
                'Gemini free tier is not active on your Google project. Use Groq instead: add GROQ_API_KEY from console.groq.com (free, no card).';
        }
        console.error('Gemini API Error:', data);
        const err = new Error(message);
        err.statusCode = 502;
        throw err;
    }

    const text =
        data?.candidates?.[0]?.content?.parts
            ?.map((part) => part.text)
            .filter(Boolean)
            .join('') || '';

    if (!text.trim()) {
        const err = new Error('Empty response from AI model.');
        err.statusCode = 502;
        throw err;
    }
    return text.trim();
}

async function generateAiAnalysis(prompt) {
    const provider = getAiProvider();
    if (provider === 'groq') return { analysis: await generateWithGroq(prompt), provider: 'groq' };
    if (provider === 'gemini') return { analysis: await generateWithGemini(prompt), provider: 'gemini' };
    const err = new Error(
        'No AI API key configured. Add GROQ_API_KEY (free at console.groq.com, no credit card) or GEMINI_API_KEY to .env'
    );
    err.statusCode = 503;
    throw err;
}

module.exports = {
    AI_FRAME_INSTRUCTIONS,
    buildAiPrompt,
    getAiProvider,
    generateAiAnalysis
};
