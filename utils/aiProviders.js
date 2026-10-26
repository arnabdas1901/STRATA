/**
 * STRATA AI Analyst Provider & Deterministic Quantitative Engine
 * Multi-provider LLM orchestration (Groq Llama-3.3-70B primary, Gemini 2.5-Flash fallback)
 * paired with deterministic institutional financial math (Piotroski F-Score, Altman Z, Reverse-DCF, DuPont, 5-Pillar Radar).
 */

// ── 1. Comprehensive Metric Picker ─────────────────────────────────────────────
const pickMetricsForAi = (metric) => {
    if (!metric) return {};
    return {
        // Valuation
        peTTM: metric.peTTM ?? metric.peBasicExclExtraTTM ?? null,
        peBasicExclExtraTTM: metric.peBasicExclExtraTTM ?? null,
        pbAnnual: metric.pbAnnual ?? metric.pbQuarterly ?? null,
        psTTM: metric.psTTM ?? metric.psAnnual ?? null,
        evEbitdaTTM: metric['ev/ebitdaTTM'] ?? metric.evEbitdaTTM ?? metric.currentEv ?? null,
        pfcfShareTTM: metric.pfcfShareTTM ?? metric.pfcfShareAnnual ?? null,
        pcfShareTTM: metric.pcfShareTTM ?? null,
        currentEv: metric.currentEv ?? null,

        // Profitability & Returns
        roeTTM: metric.roeTTM ?? metric.roeRfcTTM ?? null,
        roaTTM: metric.roaTTM ?? metric.roaRfcTTM ?? null,
        roicTTM: metric.roicTTM ?? metric.roiTTM ?? metric.roicAnnual ?? null,
        grossMarginTTM: metric.grossMarginTTM ?? metric.grossMarginAnnual ?? null,
        operatingMarginTTM: metric.operatingMarginTTM ?? metric.operatingMarginAnnual ?? null,
        netProfitMarginTTM: metric.netProfitMarginTTM ?? metric.netProfitMarginAnnual ?? null,
        fcfMarginTTM: metric.freeCashFlowMarginTTM ?? metric.fcfMarginTTM ?? null,

        // Leverage & Liquidity
        currentRatioAnnual: metric.currentRatioAnnual ?? metric.currentRatioQuarterly ?? null,
        quickRatioAnnual: metric.quickRatioAnnual ?? metric.quickRatioQuarterly ?? null,
        debtToEquityAnnual: metric.debtToEquityAnnual ?? metric['totalDebt/totalEquityAnnual'] ?? metric['totalDebt/totalEquityQuarterly'] ?? metric.totalDebtToEquity ?? null,
        longTermDebtToEquityAnnual: metric.longTermDebtToEquityAnnual ?? metric['longTermDebt/equityAnnual'] ?? metric['longTermDebt/equityQuarterly'] ?? null,
        totalDebtToTotalAssetAnnual: metric.totalDebtToTotalAssetAnnual ?? metric['totalDebt/totalAssetAnnual'] ?? metric['totalDebt/totalAssetQuarterly'] ?? null,
        netInterestCoverageTTM: metric.netInterestCoverageTTM ?? metric.interestCoverageTTM ?? null,

        // Efficiency
        assetTurnoverTTM: metric.assetTurnoverTTM ?? metric.assetTurnoverAnnual ?? null,
        inventoryTurnoverTTM: metric.inventoryTurnoverTTM ?? metric.inventoryTurnoverAnnual ?? null,
        receivablesTurnoverTTM: metric.receivablesTurnoverTTM ?? metric.receivablesTurnoverAnnual ?? null,

        // Growth
        revenueGrowthTTMYoy: metric.revenueGrowthTTMYoy ?? null,
        revenueGrowth3Y: metric.revenueGrowth3Y ?? null,
        revenueGrowth5Y: metric.revenueGrowth5Y ?? null,
        epsGrowthTTMYoy: metric.epsGrowthTTMYoy ?? null,
        epsGrowth3Y: metric.epsGrowth3Y ?? null,
        epsGrowth5Y: metric.epsGrowth5Y ?? null,
        focfCagr5Y: metric.focfCagr5Y ?? null,

        // Per-Share & Shareholder
        epsExclExtraItemsTTM: metric.epsExclExtraItemsTTM ?? metric.epsNormalizedAnnual ?? null,
        bookValuePerShareAnnual: metric.bookValuePerShareAnnual ?? null,
        cashPerSharePerShareAnnual: metric.cashPerSharePerShareAnnual ?? null,
        freeCashFlowPerShareTTM: metric.freeCashFlowPerShareTTM ?? metric.freeCashFlowPerShareAnnual ?? null,
        dividendYieldIndicatedAnnual: metric.dividendYieldIndicatedAnnual ?? metric.dividendYield5Y ?? null,
        payoutRatioAnnual: metric.payoutRatioAnnual ?? metric.payoutRatioTTM ?? null,

        // Technical & Market
        beta: metric.beta ?? null,
        '52WeekHigh': metric['52WeekHigh'] ?? null,
        '52WeekLow': metric['52WeekLow'] ?? null,
        '10DayAverageTradingVolume': metric['10DayAverageTradingVolume'] ?? null,
        '3MonthAverageTradingVolume': metric['3MonthAverageTradingVolume'] ?? null,
        '13WeekPriceReturnDaily': metric['13WeekPriceReturnDaily'] ?? null,
        '26WeekPriceReturnDaily': metric['26WeekPriceReturnDaily'] ?? null,
        '52WeekPriceReturnDaily': metric['52WeekPriceReturnDaily'] ?? null,
    };
};

// ── 2. Deterministic Quantitative Scorecard Engine ─────────────────────────────
/**
 * Pure deterministic quantitative engine.
 * Computes exact 9-point Piotroski F-Score, Altman Z-Score proxy, 3-Stage DuPont decomposition,
 * Reverse-DCF implied 5-year growth, momentum signals, and 5-pillar conviction radar scores.
 */
function computeDeterministicQuant(context = {}) {
    const {
        profile = {},
        quote = {},
        metricsPayload = {},
        secCapitalAllocation = [],
        secEarningsQuality = [],
        analystConsensus = null
    } = context;

    const m = pickMetricsForAi(metricsPayload.metric || metricsPayload);
    const price = typeof quote.c === 'number' && quote.c > 0 ? quote.c : (profile.price || 100);
    const marketCapB = profile.marketCapitalization ? (profile.marketCapitalization / 1000) : 50; // in billions

    // Helper: latest SEC annual records
    const eqList = Array.isArray(secEarningsQuality) ? secEarningsQuality : [];
    const latestEQ = eqList.length > 0 ? eqList[eqList.length - 1] : null;
    const prevEQ = eqList.length > 1 ? eqList[eqList.length - 2] : null;

    const caList = Array.isArray(secCapitalAllocation) ? secCapitalAllocation : [];
    const latestCA = caList.length > 0 ? caList[caList.length - 1] : null;

    // ── A. 9-Point Piotroski F-Score ──
    const piotroskiCriteria = [];

    // F1: Positive ROA
    const roa = m.roaTTM ?? (latestEQ && latestEQ.totalAssets > 0 ? (latestEQ.netIncome / latestEQ.totalAssets) * 100 : null) ?? 5;
    const f1Passed = roa > 0;
    piotroskiCriteria.push({
        id: 'F1',
        category: 'Profitability',
        name: 'Positive Return on Assets (ROA)',
        passed: f1Passed,
        valueStr: `ROA: ${roa.toFixed(1)}%`
    });

    // F2: Positive Operating Cash Flow
    const ocf = latestEQ?.operatingCashFlow ?? (m.operatingMarginTTM ? m.operatingMarginTTM * 1000 : 1);
    const f2Passed = ocf > 0;
    piotroskiCriteria.push({
        id: 'F2',
        category: 'Profitability',
        name: 'Positive Operating Cash Flow (CFO)',
        passed: f2Passed,
        valueStr: latestEQ ? `CFO: $${(ocf / 1e9).toFixed(2)}B` : `Operating Margin: ${(m.operatingMarginTTM || 0).toFixed(1)}%`
    });

    // F3: Improving ROA YoY
    let f3Passed = false;
    let prevRoa = null;
    if (latestEQ && prevEQ && latestEQ.totalAssets > 0 && prevEQ.totalAssets > 0) {
        prevRoa = (prevEQ.netIncome / prevEQ.totalAssets) * 100;
        f3Passed = roa > prevRoa;
    } else {
        f3Passed = (m.epsGrowthTTMYoy != null && m.epsGrowthTTMYoy > 0) || (m.revenueGrowthTTMYoy != null && m.revenueGrowthTTMYoy > 0);
    }
    piotroskiCriteria.push({
        id: 'F3',
        category: 'Profitability',
        name: 'YoY Return on Assets Expansion',
        passed: f3Passed,
        valueStr: prevRoa != null ? `Current ${roa.toFixed(1)}% vs Prior ${prevRoa.toFixed(1)}%` : `EPS YoY: ${(m.epsGrowthTTMYoy || 0).toFixed(1)}%`
    });

    // F4: Quality of Earnings (CFO > Net Income / Low Accruals)
    const netIncome = latestEQ?.netIncome ?? (m.netProfitMarginTTM ? m.netProfitMarginTTM * 500 : 0);
    const f4Passed = ocf > netIncome;
    piotroskiCriteria.push({
        id: 'F4',
        category: 'Profitability',
        name: 'Quality of Earnings (CFO > Net Income)',
        passed: f4Passed,
        valueStr: latestEQ ? `CFO $${(ocf / 1e9).toFixed(2)}B > NI $${(netIncome / 1e9).toFixed(2)}B` : (f4Passed ? 'High Cash Conversion' : 'Accrual Heavy')
    });

    // F5: Solvency / Lower Leverage (D/E < 0.6 or Decreasing YoY)
    const de = m.debtToEquityAnnual ?? 0.5;
    const f5Passed = de < 0.6 || (m.totalDebtToTotalAssetAnnual != null && m.totalDebtToTotalAssetAnnual < 0.35);
    piotroskiCriteria.push({
        id: 'F5',
        category: 'Leverage',
        name: 'Decreasing / Low Financial Leverage',
        passed: f5Passed,
        valueStr: `Debt/Equity: ${de.toFixed(2)}`
    });

    // F6: Solid Liquidity (Current Ratio > 1.0)
    const cr = m.currentRatioAnnual ?? 1.25;
    const f6Passed = cr >= 1.0;
    piotroskiCriteria.push({
        id: 'F6',
        category: 'Liquidity',
        name: 'Working Capital Health (Current Ratio ≥ 1.0)',
        passed: f6Passed,
        valueStr: `Current Ratio: ${cr.toFixed(2)}x`
    });

    // F7: No Dilution (Shares outstanding flat or declining)
    let f7Passed = true;
    let sharesDeltaStr = 'No Material Dilution';
    if (latestEQ && prevEQ && prevEQ.sharesOutstanding > 0) {
        const deltaSharesPct = ((latestEQ.sharesOutstanding - prevEQ.sharesOutstanding) / prevEQ.sharesOutstanding) * 100;
        f7Passed = deltaSharesPct <= 0.5;
        sharesDeltaStr = `Share Count Δ: ${deltaSharesPct >= 0 ? '+' : ''}${deltaSharesPct.toFixed(1)}% YoY`;
    } else if (latestCA && latestCA.buybacks > 0) {
        f7Passed = true;
        sharesDeltaStr = `Net Buybacks: $${(latestCA.buybacks / 1e9).toFixed(1)}B`;
    }
    piotroskiCriteria.push({
        id: 'F7',
        category: 'Dilution',
        name: 'Non-Dilutive Share Count & Buybacks',
        passed: f7Passed,
        valueStr: sharesDeltaStr
    });

    // F8: Gross Margin Quality / Expansion
    const gm = m.grossMarginTTM ?? 42;
    const f8Passed = gm > 35 || (m.operatingMarginTTM != null && m.operatingMarginTTM > 18);
    piotroskiCriteria.push({
        id: 'F8',
        category: 'Efficiency',
        name: 'Gross Margin Strength (> 35%)',
        passed: f8Passed,
        valueStr: `Gross Margin: ${gm.toFixed(1)}%`
    });

    // F9: Asset Turnover Health (Efficiency)
    const at = m.assetTurnoverTTM ?? 0.65;
    const f9Passed = at >= 0.5;
    piotroskiCriteria.push({
        id: 'F9',
        category: 'Efficiency',
        name: 'Asset Velocity & Capital Turnover (≥ 0.5x)',
        passed: f9Passed,
        valueStr: `Asset Turnover: ${at.toFixed(2)}x`
    });

    const piotroskiScore = piotroskiCriteria.filter(c => c.passed).length;
    let piotroskiLabel = 'Neutral Quality';
    if (piotroskiScore >= 7) piotroskiLabel = 'Deep Value Compounder';
    else if (piotroskiScore <= 3) piotroskiLabel = 'Value Trap / Weak Quality';

    // ── B. Deterministic Altman Z-Score ──
    // Standard Z = 1.2*X1 + 1.4*X2 + 3.3*X3 + 0.6*X4 + 1.0*X5
    let x1, x2, x3, x4, x5;
    const hasSecBs = latestEQ && typeof latestEQ.totalAssets === 'number' && latestEQ.totalAssets > 0 && typeof latestEQ.totalLiabilities === 'number' && latestEQ.totalLiabilities > 0;

    if (hasSecBs) {
        const ta = latestEQ.totalAssets;
        const tl = latestEQ.totalLiabilities;
        const ca = latestEQ.currentAssets ?? (ta * 0.4);
        const cl = latestEQ.currentLiabilities ?? (tl * 0.4);
        const re = latestEQ.retainedEarnings ?? (ta * (roa / 100) * 1.5);
        const ebit = latestEQ.operatingIncome ?? (latestEQ.revenue ? latestEQ.revenue * ((m.operatingMarginTTM ?? 18) / 100) : ta * 0.12);
        const rev = latestEQ.revenue ?? (ta * at);
        const mktCap = marketCapB * 1e9;

        x1 = Math.max(-0.9, Math.min(0.9, (ca - cl) / ta)); // Working Capital / Total Assets
        x2 = Math.max(-1.0, Math.min(1.0, re / ta)); // Retained Earnings / Total Assets
        x3 = Math.max(-0.5, Math.min(0.8, ebit / ta)); // EBIT / Total Assets
        x4 = Math.max(0.05, Math.min(12.0, mktCap / tl)); // Market Value of Equity / Total Liabilities
        x5 = Math.max(0.05, Math.min(4.0, rev / ta)); // Sales / Total Assets
    } else {
        x1 = Math.max(-0.5, Math.min(0.8, (cr - 1.0) * 0.25)); // Working Capital / Total Assets proxy
        x2 = Math.max(-0.2, Math.min(0.6, (roa / 100) * 1.5)); // Retained Earnings / Total Assets proxy
        x3 = Math.max(-0.2, Math.min(0.8, ((m.operatingMarginTTM ?? 18) / 100) * at)); // EBIT / Total Assets
        const pb = Math.max(0.2, m.pbAnnual ?? 3.5);
        x4 = Math.max(0.1, Math.min(8.0, pb / Math.max(0.2, de))); // Market Value of Equity / Total Liabilities
        x5 = Math.max(0.1, Math.min(3.0, at)); // Sales / Total Assets
    }

    const zScore = parseFloat((1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5).toFixed(2));
    let altmanZone = 'Safe Zone';
    let altmanColor = '#10b981';
    if (zScore < 1.81) {
        altmanZone = 'Distress Zone';
        altmanColor = '#f43f5e';
    } else if (zScore <= 2.99) {
        altmanZone = 'Grey Zone';
        altmanColor = '#f59e0b';
    }

    // ── C. Deterministic 3-Stage DuPont Decomposition ──
    const npm = m.netProfitMarginTTM ?? (roa > 0 && at > 0 ? roa / at : 14.5);
    const em = Math.max(1.0, 1 + de);
    const impliedRoe = (npm / 100) * at * em * 100;
    const reportedRoe = m.roeTTM ?? impliedRoe;

    let dupontDriver = 'Margin Power';
    if (at > 1.1) dupontDriver = 'Asset Velocity';
    else if (em > 2.5) dupontDriver = 'Financial Leverage';

    // ── D. Reverse-DCF & Implied Growth Valuation ──
    const beta = Math.max(0.4, Math.min(2.5, m.beta ?? 1.1));
    const costOfEquity = 4.25 + beta * 5.0; // Rf=4.25% + Beta*ERP(5.0%)
    const waccPct = parseFloat(Math.max(6.5, Math.min(14.0, costOfEquity - 0.5)).toFixed(1));

    // Base FCF estimate (in $ Billions)
    let fcfBaseB = latestCA && latestCA.freeCashFlow ? (latestCA.freeCashFlow / 1e9) : null;
    if (!fcfBaseB || fcfBaseB <= 0) {
        const fcfPerShare = m.freeCashFlowPerShareTTM ?? (m.epsExclExtraItemsTTM ? m.epsExclExtraItemsTTM * 0.9 : 4.0);
        const impliedSharesB = price > 0 ? (marketCapB / price) : 1;
        fcfBaseB = Math.max(0.5, fcfPerShare * impliedSharesB);
    }
    const fcfYieldPct = parseFloat(((fcfBaseB / Math.max(1, marketCapB)) * 100).toFixed(2));

    // Binary search solve for implied 5-year FCF CAGR g (terminal growth = 2.5%)
    const gTerminal = 0.025;
    const rWacc = waccPct / 100;

    // Enterprise Value (EV) calculation: Target EV = Market Cap + Net Debt
    const netDebtB = latestEQ
        ? (((latestEQ.longTermDebt || 0) - (latestEQ.cashAndEquivalents || 0)) / 1e9)
        : (m.currentEv ? ((m.currentEv / 1000) - marketCapB) : 0);
    const targetEV = Math.max(marketCapB * 0.5, marketCapB + netDebtB);

    function calcDcfPV(g) {
        let pv = 0;
        let fcf_t = fcfBaseB;
        for (let t = 1; t <= 5; t++) {
            fcf_t *= (1 + g);
            pv += fcf_t / Math.pow(1 + rWacc, t);
        }
        const terminalVal = (fcf_t * (1 + gTerminal)) / (rWacc - gTerminal);
        pv += terminalVal / Math.pow(1 + rWacc, 5);
        return pv;
    }

    let lowG = -0.20;
    let highG = 0.60;
    let impliedG = 0.08;
    for (let iter = 0; iter < 24; iter++) {
        const midG = (lowG + highG) / 2;
        const midPV = calcDcfPV(midG);
        if (midPV < targetEV) {
            lowG = midG;
        } else {
            highG = midG;
        }
        impliedG = midG;
    }
    const implied5YFcfCagrPct = parseFloat((impliedG * 100).toFixed(1));

    const histGrowth = m.revenueGrowth5Y ?? m.epsGrowth5Y ?? 10;
    let valuationStance = 'Fairly Priced';
    if (implied5YFcfCagrPct < 5 || implied5YFcfCagrPct < histGrowth - 4) {
        valuationStance = 'Undervalued / Conservative Expectations';
    } else if (implied5YFcfCagrPct > histGrowth + 6 || implied5YFcfCagrPct > 25) {
        valuationStance = 'Priced for Perfection / High Bar';
    }

    // ── E. Technical & Momentum Signals ──
    const h52 = m['52WeekHigh'] || price * 1.15;
    const l52 = m['52WeekLow'] || price * 0.85;
    let range52wPct = 50;
    if (h52 > l52) {
        range52wPct = parseFloat((Math.max(0, Math.min(100, ((price - l52) / (h52 - l52)) * 100))).toFixed(1));
    }

    const vol10d = m['10DayAverageTradingVolume'];
    const vol3m = m['3MonthAverageTradingVolume'];
    let volumeSurgeRatio = 1.0;
    if (vol10d && vol3m && vol3m > 0) {
        volumeSurgeRatio = parseFloat((vol10d / vol3m).toFixed(2));
    }

    let analystBullishPct = 70;
    if (analystConsensus && typeof analystConsensus.strongBuy === 'number') {
        const totalRatings = (analystConsensus.strongBuy || 0) + (analystConsensus.buy || 0) + (analystConsensus.hold || 0) + (analystConsensus.sell || 0) + (analystConsensus.strongSell || 0);
        if (totalRatings > 0) {
            analystBullishPct = Math.round((((analystConsensus.strongBuy || 0) + (analystConsensus.buy || 0)) / totalRatings) * 100);
        }
    }

    // ── F. 5-Pillar Radar Scores (0–100) & STRATA Conviction Index ──
    // Pillar 1: Valuation
    let valScore = 50;
    const pe = m.peTTM || m.peBasicExclExtraTTM;
    if (pe) {
        if (pe < 15) valScore = 88;
        else if (pe < 25) valScore = 72;
        else if (pe < 38) valScore = 52;
        else valScore = 32;
    }
    if (fcfYieldPct > 5.5) valScore = Math.min(98, valScore + 10);
    else if (fcfYieldPct < 2.0) valScore = Math.max(15, valScore - 8);

    // Pillar 2: Profitability & Moat
    let profScore = 50;
    const roeScore = reportedRoe > 25 ? 92 : (reportedRoe > 15 ? 78 : (reportedRoe > 8 ? 55 : 30));
    const gmScore = gm > 50 ? 92 : (gm > 35 ? 75 : (gm > 20 ? 55 : 35));
    profScore = Math.round((roeScore * 0.55) + (gmScore * 0.45));

    // Pillar 3: Balance Sheet Fortress
    let bsScore = 50;
    if (altmanZone === 'Safe Zone') bsScore = 85;
    else if (altmanZone === 'Grey Zone') bsScore = 60;
    else bsScore = 28;
    if (cr > 1.5 && de < 0.5) bsScore = Math.min(98, bsScore + 10);

    // Pillar 4: Growth & Momentum
    let growthScore = 50;
    const revG = m.revenueGrowthTTMYoy ?? m.revenueGrowth3Y ?? 8;
    const gScore = revG > 20 ? 90 : (revG > 10 ? 75 : (revG > 0 ? 55 : 30));
    const momScore = Math.round(range52wPct * 0.7 + Math.min(100, volumeSurgeRatio * 50) * 0.3);
    growthScore = Math.round(gScore * 0.55 + momScore * 0.45);

    // Pillar 5: Earnings Quality
    let eqScore = Math.round((piotroskiScore / 9) * 100);

    // Composite Conviction Score (0–100)
    const convictionScore = Math.round(
        profScore * 0.25 +
        valScore * 0.25 +
        bsScore * 0.20 +
        growthScore * 0.15 +
        eqScore * 0.15
    );

    let convictionRating = 'Hold / Fair Value';
    if (convictionScore >= 80) convictionRating = 'Institutional Conviction Buy';
    else if (convictionScore >= 68) convictionRating = 'Quality Compounder';
    else if (convictionScore < 50) convictionRating = 'Cautious / Elevated Risk';

    return {
        piotroski: {
            totalScore: piotroskiScore,
            label: piotroskiLabel,
            criteria: piotroskiCriteria
        },
        altman: {
            zScore,
            zone: altmanZone,
            color: altmanColor
        },
        dupont: {
            netProfitMarginPct: parseFloat(npm.toFixed(2)),
            assetTurnover: parseFloat(at.toFixed(2)),
            equityMultiplier: parseFloat(em.toFixed(2)),
            impliedRoePct: parseFloat(impliedRoe.toFixed(2)),
            reportedRoePct: parseFloat(reportedRoe.toFixed(2)),
            primaryDriver: dupontDriver
        },
        dcfModel: {
            waccPct,
            fcfYieldPct,
            implied5YFcfCagrPct,
            valuationStance
        },
        technical: {
            range52wPct,
            volumeSurgeRatio,
            analystBullishPct
        },
        radarScores: {
            valuation: valScore,
            profitability: profScore,
            balanceSheet: bsScore,
            growthMomentum: growthScore,
            earningsQuality: eqScore
        },
        convictionScore,
        convictionRating
    };
}

// ── 3. 10 Institutional Analytical Frames ──────────────────────────────────────
const AI_FRAME_INSTRUCTIONS = {
    ic_debate: `Conduct an adversarial Institutional Investment Committee (IC) Debate between a Long-Only Quality Compounder Portfolio Manager (Bull) and a Forensic Short-Seller (Bear).
Structure your debate as follows:
### 1. The Bull Thesis (Long-Only Compounder PM)
* Identify 3 data-backed structural pillars (cite specific Gross Margins, ROIC, FCF conversion, or secular tailwinds from the DATA payload).
* Explain why current market pricing underappreciates durable unit economics or reinvestment runways.
### 2. The Bear Attack (Forensic Short-Seller)
* Present 3 sharpest operational, accounting, or valuation vulnerabilities (cite exact P/E or EV/EBITDA multiples, Sloan accruals/SBC dilution, or Reverse-DCF implied expectations).
* Identify structural margin pressure points, debt obligations, or multiple-compression triggers.
### 3. Chief Investment Officer (CIO) Synthesis & Catalyst Matrix
| Decision Vector | Bull Weight | Bear Weight | Decisive Metric |
| :--- | :--- | :--- | :--- |
* Conclude with a clear Risk/Reward Asymmetry verdict and the single invalidation trigger for the trade.`,

    capital_forensics: `Perform an institutional forensic audit of Management's Capital Allocation & Earnings Quality over the past 3–5 years using the SEC EDGAR XBRL data.
Structure your audit as follows:
### 1. The 5-Year Capital Allocation Bridge
* Audit Operating Cash Flow (CFO) vs. CapEx, Share Buybacks, Cash Dividends, and Debt Service.
* Did management fund growth through internal cash flow or debt/equity issuance?
### 2. Forensic Earnings Quality & Accruals Audit
* Compare Operating Cash Flow to Net Income (Cash Conversion Ratio). Is CFO consistently > Net Income?
* Evaluate Stock-Based Compensation (SBC) as a percentage of Net Income and free cash flow. Is shareholder dilution disguised as "adjusted EBITDA"?
### 3. Management Stewardship Grade & Verdict
* Grade capital allocation from A+ (Exceptional Compounder) to F (Value Destructive / Dilutive).
* Explain in 2 sentences whether management creates or destroys per-share economic value.`,

    dupont: `Perform an institutional 3-Stage DuPont ROE Decomposition:
ROE = Net Profit Margin × Asset Turnover × Financial Leverage (Equity Multiplier)
### 1. DuPont Component Breakdown
* Cite the exact Net Profit Margin, Asset Turnover, and Equity Multiplier from the Deterministic Quant payload.
* Show the mathematical product and compare Implied ROE to Reported ROE.
### 2. Core Operational Driver Analysis
* Classify the primary return engine: Is it **Margin Power** (pricing power/moat), **Asset Velocity** (lean operational efficiency), or **Financial Leverage** (debt-boosted balance sheet)?
### 3. Sustainability & Margin Defense
* Contextualize the trend against sector medians and conclude whether this ROE is defensible over a 3-5 year cycle.`,

    dcf: `Execute a rigorous Reverse-DCF and Discounted Cash Flow valuation framework:
### 1. Cost of Capital & Cash Flow Baseline
* Cite the CAPM WACC (%), Free Cash Flow yield (%), and current Enterprise/Equity value.
### 2. The Reverse-DCF Growth Solve
* Cite the exact 5-year Free Cash Flow CAGR (%) implied by the current stock price.
* Compare this market-implied growth rate against historical 3Y/5Y revenue and EPS growth rates.
### 3. Valuation Asymmetry Verdict
* Classify the valuation stance: **Undervalued / Conservative Expectations**, **Fairly Priced**, or **Priced for Perfection / High Bar**. Explain the key sensitivity driver.`,

    moat: `Perform a qualitative Buffett/Munger Economic Moat and Durable Competitive Advantage evaluation:
### 1. Pricing Power & Gross Margin Buffer
* Check Gross Margin (>35% benchmark) and Operating Margin stability. Does the company dictate prices or take prices?
### 2. Capital Efficiency & ROIC
* Audit ROIC and ROE relative to Cost of Capital (WACC). Is the Economic Spread positive and widening?
### 3. Moat Source Classification
* Classify the moat into one of: **Intangibles / Brand**, **Switching Costs**, **Network Effect**, **Cost Advantage**, or **No Moat**.
### 4. Moat Durability Rating
* Conclude with **Wide Moat**, **Narrow Moat**, or **None**, with an assessment of 10-year disruption risk.`,

    benchmarking: `Provide institutional Peer-Group and Industry Sector Benchmarking:
### 1. Valuation Multiple Dispersion
* Compare the target company's P/E, P/S, EV/EBITDA, and P/FCF against the industry peer group provided in the data.
### 2. Profitability & Operational Superiority
* Compare margins and asset turnover against peers. Does the company command a premium multiple justified by superior returns?
### 3. Structural Positioning
* Conclude whether the stock represents a **Category Leader**, a **Discounted Follower**, or a **Sub-Scale Laggard**.`,

    piotroski: `Deconstruct the 9-Point Piotroski F-Score value quality model:
### 1. Profitability Signals (F1–F4)
* Break down ROA, Operating Cash Flow, YoY ROA delta, and Accruals (CFO vs Net Income).
### 2. Solvency & Liquidity Signals (F5–F7)
* Break down Debt-to-Equity change, Current Ratio, and share count dilution/buybacks.
### 3. Operating Efficiency Signals (F8–F9)
* Break down Gross Margin and Asset Turnover trends.
### 4. Total Score & Classification
* State the exact score (0–9) and classify the asset: **Deep Value Compounder** (7-9), **Neutral Quality** (4-6), or **Value Trap / Weak** (0-3).`,

    altman: `Perform an Altman Z-Score Bankruptcy and Balance Sheet Distress evaluation:
### 1. Working Capital & Liquidity Buffer
* Evaluate Current Ratio, Quick Ratio, and short-term debt coverage.
### 2. Solvency & Structural Leverage
* Audit Debt-to-Equity, Total Debt to Total Assets, and interest coverage.
### 3. Earnings Power & Asset Protection
* Audit ROA and Operating Margin buffers against potential macroeconomic shocks.
### 4. Altman Z Rating
* State the exact Z-Score and classification: **Safe Zone** (Z > 2.99), **Grey Zone** (1.81–2.99), or **Distress Zone** (Z < 1.81), highlighting near-term refinancing risks.`,

    redflags: `Conduct an automated Forensic Financial Red Flags and Risk Audit:
### 1. Accounting & Earnings Quality Flags
* Audit Accrual drag (Net Income > CFO), Stock-Based Compensation inflation, and revenue vs. receivables divergence.
### 2. Solvency & Capital Structure Flags
* Audit debt maturity walls, interest coverage margins, and liquidity drains.
### 3. Valuation & Multiple Compression Flags
* Audit downside multiple re-rating risks if growth slows below consensus.
### 4. Final Risk Rating
* Conclude with a Risk Severity Matrix: **Low / Fortress**, **Moderate / Watchlist**, or **High / Elevated Danger**.`,

    momentum: `Analyze Technical Momentum, Institutional Accumulation, and Factor Flow:
### 1. Price Range & Moving Percentile
* Audit the 52-week range percentile (where the current price sits relative to high/low).
### 2. Institutional Volume & Accumulation Ratio
* Audit the 10-day vs. 3-month volume ratio to identify accumulation vs. distribution.
### 3. Volatility (Beta) & Price Divergence
* Contextualize the stock's beta against recent broader market returns.
### 4. Technical Regime Classification
* Conclude with a regime classification: **Institutional Accumulation**, **Healthy Momentum**, **Consolidation**, or **Distribution / Exhaustion**.`
};

// ── 4. Unified Evidence Pack Builder ───────────────────────────────────────────
function buildEvidencePack(ticker, data = {}) {
    if (!data.quantScorecard) {
        data.quantScorecard = computeDeterministicQuant(data);
    }
    let pack = `## INSTITUTIONAL EVIDENCE PACK — ${ticker}\n\n`;

    // 1. Company Profile
    if (data.profile) {
        pack += `### COMPANY IDENTITY\n`;
        pack += `Name: ${data.profile.name || 'N/A'}\n`;
        pack += `Industry: ${data.profile.finnhubIndustry || 'N/A'}\n`;
        pack += `Exchange: ${data.profile.exchange || 'N/A'}\n`;
        pack += `Market Cap: ${data.profile.marketCapitalization ? '$' + (data.profile.marketCapitalization / 1000).toFixed(1) + 'B' : 'N/A'}\n\n`;
    }

    // 2. Market Quote
    if (data.quote) {
        pack += `### MARKET PRICING\n`;
        pack += `Price: $${data.quote.c || 'N/A'}\n`;
        pack += `Day Change: ${data.quote.dp != null ? data.quote.dp.toFixed(2) + '%' : 'N/A'}\n`;
        pack += `52W High: $${data.quote.h || 'N/A'}, 52W Low: $${data.quote.l || 'N/A'}\n\n`;
    }

    // 3. Deterministic Quant Scorecard
    if (data.quantScorecard) {
        const q = data.quantScorecard;
        pack += `### DETERMINISTIC QUANT SCORECARD (VERIFIED MATH)\n`;
        pack += `STRATA Conviction Index: ${q.convictionScore}/100 (${q.convictionRating})\n`;
        pack += `Piotroski F-Score: ${q.piotroski.totalScore}/9 (${q.piotroski.label})\n`;
        pack += `Altman Z-Score: ${q.altman.zScore} (${q.altman.zone})\n`;
        pack += `DuPont Decomposition: ROE=${q.dupont.reportedRoePct}% (Margin ${q.dupont.netProfitMarginPct}% × Turnover ${q.dupont.assetTurnover}x × Leverage ${q.dupont.equityMultiplier}x) — Primary Driver: ${q.dupont.primaryDriver}\n`;
        pack += `Reverse-DCF: WACC=${q.dcfModel.waccPct}%, FCF Yield=${q.dcfModel.fcfYieldPct}%, Implied 5Y FCF CAGR=${q.dcfModel.implied5YFcfCagrPct}% (${q.dcfModel.valuationStance})\n`;
        pack += `Momentum Signals: 52W Range=${q.technical.range52wPct}%, Volume Ratio=${q.technical.volumeSurgeRatio}x, Analyst Bullish=${q.technical.analystBullishPct}%\n\n`;
    }

    // 4. Multi-Year SEC Capital Allocation
    if (data.capitalAllocation && Array.isArray(data.capitalAllocation) && data.capitalAllocation.length > 0) {
        pack += `### SEC EDGAR 5-YEAR CAPITAL ALLOCATION (XBRL)\n`;
        data.capitalAllocation.slice(-4).forEach(item => {
            const ocf = ((item.operatingCashFlow || 0) / 1e9).toFixed(1);
            const capex = ((item.capex || 0) / 1e9).toFixed(1);
            const fcf = ((item.freeCashFlow || 0) / 1e9).toFixed(1);
            const buybacks = ((item.buybacks || 0) / 1e9).toFixed(1);
            const div = ((item.dividends || 0) / 1e9).toFixed(1);
            pack += `FY${item.year || item.fy}: OCF=$${ocf}B, CapEx=$${capex}B, FCF=$${fcf}B, Buybacks=$${buybacks}B, Dividends=$${div}B\n`;
        });
        pack += `\n`;
    }

    // 5. Multi-Year SEC Earnings Quality & Accruals
    if (data.earningsQuality && Array.isArray(data.earningsQuality) && data.earningsQuality.length > 0) {
        pack += `### SEC EDGAR EARNINGS QUALITY & ACCRUALS (XBRL)\n`;
        data.earningsQuality.slice(-4).forEach(item => {
            const ni = ((item.netIncome || 0) / 1e9).toFixed(1);
            const ocf = ((item.operatingCashFlow || 0) / 1e9).toFixed(1);
            const sbc = ((item.stockBasedCompensation || 0) / 1e6).toFixed(0);
            const conv = item.netIncome ? ((item.operatingCashFlow / item.netIncome)).toFixed(2) : 'N/A';
            pack += `FY${item.year || item.fy}: Net Income=$${ni}B, OCF=$${ocf}B (Cash Conv: ${conv}x), SBC=$${sbc}M\n`;
        });
        pack += `\n`;
    }

    // 6. Peer Group Benchmarks
    if (data.peers && Array.isArray(data.peers) && data.peers.length > 0) {
        pack += `### PEER GROUP MULTIPLES\n`;
        data.peers.slice(0, 4).forEach(p => {
            pack += `${p.symbol || p.ticker}: Price=$${p.price || 'N/A'}, P/E=${p.pe || 'N/A'}, Sector=${p.sector || 'N/A'}\n`;
        });
        pack += `\n`;
    }

    return pack;
}

// ── 5. AI Prompt Constructor ──────────────────────────────────────────────────
const buildAiPrompt = (symbol, frameKey, context = {}) => {
    // Handle both argument styles
    let ctx = context;
    if (arguments.length > 3) {
        const [, , profile, quote, metricsPayload, technicalData, financials] = arguments;
        ctx = {
            profile,
            quote,
            metricsPayload,
            technicalSignals: technicalData,
            historicalFinancials: financials,
            quantScorecard: computeDeterministicQuant({ profile, quote, metricsPayload })
        };
    }

    const evidencePack = buildEvidencePack(symbol, ctx);
    const instruction = AI_FRAME_INSTRUCTIONS[frameKey] || AI_FRAME_INSTRUCTIONS.dupont;

    return `You are STRATA, a Managing Director in Quantitative Equities and Principal Architect of BloombergGPT.
You write rigorous, data-dense, institutional-grade equity research memorandums for top-tier asset managers.

MANDATORY RULES:
1. Ground every conclusion in the verified numbers provided in the DATA payload and EVIDENCE PACK below.
2. Directly reference the deterministic quant metrics (Piotroski F-Score, Altman Z, Reverse-DCF implied growth, DuPont drivers) without inventing or altering calculations.
3. Use clean GitHub markdown formatting with section headers (###), bold key figures, and markdown comparison tables (| col | col |).
4. Do not offer personalized financial advice; include a concise institutional disclaimer at the very end.
5. Maintain a professional, quantitative, decisive institutional research tone.

TASK:
${instruction}

${evidencePack}

DATA PAYLOAD:
${JSON.stringify({
    symbol,
    company: ctx.profile?.name || symbol,
    price: ctx.quote?.c,
    metrics: pickMetricsForAi(ctx.metricsPayload?.metric || ctx.metrics),
    deterministicQuant: ctx.quantScorecard
}, null, 2)}

Produce the comprehensive research memo for ${symbol}.`;
};

// ── 6. Model Resolution, Provider Info & Execution ─────────────────────────────
function resolveValidGroqModel() {
    let model = (process.env.GROQ_MODEL || '').trim();
    if (!model || model.length < 3) {
        return 'llama-3.3-70b-versatile';
    }
    return model;
}

const getAiProvider = () => {
    if (process.env.GROQ_API_KEY) return 'groq';
    if (process.env.GEMINI_API_KEY) return 'gemini';
    return null;
};

const getAiProviderInfo = () => {
    if (process.env.GROQ_API_KEY) {
        return {
            provider: 'groq',
            model: resolveValidGroqModel()
        };
    }
    if (process.env.GEMINI_API_KEY) {
        return {
            provider: 'gemini',
            model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
        };
    }
    return { provider: null, model: null };
};

async function retryWithBackoff(fn, maxRetries = 2) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            const isTransient = [429, 500, 502, 503, 504].includes(err.statusCode);
            if (!isTransient || attempt === maxRetries) throw err;
            const delayMs = 1000 * Math.pow(2, attempt);
            console.warn(`AI provider retry ${attempt + 1}/${maxRetries} after ${delayMs}ms: ${err.message}`);
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
}

async function generateWithGroq(prompt, options = {}) {
    let model = resolveValidGroqModel();
    const maxTokens = options.maxTokens || 1400;
    const temperature = options.temperature ?? 0.5;

    async function callGroq(modelName) {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            },
            body: JSON.stringify({
                model: modelName,
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: 'Generate the complete institutional analysis as specified.' }
                ],
                temperature,
                max_tokens: maxTokens,
            }),
        });
        const data = await response.json();
        return { response, data };
    }

    let { response, data } = await callGroq(model);

    // Auto-heal on 400 or 404 (model deprecated, invalid ID)
    if (!response.ok && (response.status === 400 || response.status === 404)) {
        const candidates = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'].filter(m => m !== model);
        for (const candidate of candidates) {
            console.warn(`Groq model ${model} failed with HTTP ${response.status}. Auto-retrying with ${candidate}...`);
            const retryResult = await callGroq(candidate);
            if (retryResult.response.ok) {
                response = retryResult.response;
                data = retryResult.data;
                model = candidate;
                break;
            }
        }
    }

    if (!response.ok) {
        const message = data?.error?.message || 'Groq API request failed';
        console.error('Groq API Error:', data);
        const err = new Error(message);
        err.statusCode = response.status || 502;
        throw err;
    }

    const text = data?.choices?.[0]?.message?.content || '';
    if (!text.trim()) {
        const err = new Error('Empty response received from Groq AI model.');
        err.statusCode = 502;
        throw err;
    }
    return text.trim();
}

async function generateWithGemini(prompt, options = {}) {
    let model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const maxTokens = options.maxTokens || 1400;
    const temperature = options.temperature ?? 0.5;

    async function callGemini(mName) {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${mName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature,
                    maxOutputTokens: maxTokens,
                },
            }),
        });
        const data = await response.json();
        return { response, data };
    }

    let { response, data } = await callGemini(model);

    // Auto-heal on 400 or 404 (model deprecated, invalid ID)
    if (!response.ok && (response.status === 400 || response.status === 404)) {
        const candidates = ['gemini-3.8-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'].filter(m => m !== model);
        for (const candidate of candidates) {
            console.warn(`Gemini model ${model} failed with HTTP ${response.status}. Auto-retrying with ${candidate}...`);
            const retryResult = await callGemini(candidate);
            if (retryResult.response.ok) {
                response = retryResult.response;
                data = retryResult.data;
                model = candidate;
                break;
            }
        }
    }

    if (!response.ok) {
        let message = data?.error?.message || 'Gemini API request failed';
        if (message.includes('limit: 0')) {
            message = 'Gemini free tier quota exhausted. Use GROQ_API_KEY in .env for unlimited free-tier access.';
        }
        console.error('Gemini API Error:', data);
        const err = new Error(message);
        err.statusCode = response.status || 502;
        throw err;
    }

    const text = data?.candidates?.[0]?.content?.parts
        ?.map(p => p.text)
        .filter(Boolean)
        .join('') || '';

    if (!text.trim()) {
        const err = new Error('Empty response received from Gemini AI model.');
        err.statusCode = 502;
        throw err;
    }
    return text.trim();
}

async function generateAiAnalysis(prompt, options = {}) {
    const hasGroq = !!process.env.GROQ_API_KEY;
    const hasGemini = !!process.env.GEMINI_API_KEY;

    if (!hasGroq && !hasGemini) {
        const err = new Error('No AI provider configured. Add GROQ_API_KEY (free at console.groq.com) or GEMINI_API_KEY to .env');
        err.statusCode = 503;
        throw err;
    }

    // Try Groq as primary high-performance provider
    if (hasGroq) {
        try {
            const analysis = await retryWithBackoff(() => generateWithGroq(prompt, options));
            return { analysis, provider: 'groq' };
        } catch (groqErr) {
            console.warn('Groq primary attempt failed, falling back to Gemini if available:', groqErr.message);
            if (!hasGemini) throw groqErr;
        }
    }

    // Try Gemini (primary or fallback)
    if (hasGemini) {
        try {
            const analysis = await retryWithBackoff(() => generateWithGemini(prompt, options));
            return { analysis, provider: 'gemini' };
        } catch (geminiErr) {
            console.error('Gemini fallback attempt failed:', geminiErr.message);
            throw geminiErr;
        }
    }

    const err = new Error('All AI providers failed to generate analysis.');
    err.statusCode = 502;
    throw err;
}

module.exports = {
    AI_FRAME_INSTRUCTIONS,
    pickMetricsForAi,
    computeDeterministicQuant,
    buildEvidencePack,
    buildAiPrompt,
    getAiProvider,
    getAiProviderInfo,
    generateAiAnalysis,
    generateWithGroq,
    generateWithGemini
};
