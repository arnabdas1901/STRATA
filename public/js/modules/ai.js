import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast, escapeHtml } from '../utils.js';

let isAiRunning = false;
let currentMultiFrameResults = {}; // { frameKey: { analysisHtml, frameLabel, modelName, provider } }
let activeMultiFrameTab = null;
let quantRadarChartInstance = null;

// ── 1. Frame Definitions & Follow-Up Prompts ──────────────────────────────────
const FRAME_LABELS = {
    ic_debate: 'Bull vs. Bear IC Debate',
    capital_forensics: 'SEC 10-K Capital & Earnings Forensics',
    dupont: '3-Stage DuPont ROE Decomposition',
    dcf: 'Discounted Cash Flow & Reverse-DCF',
    moat: 'Buffett/Munger Economic Moat',
    benchmarking: 'Peer-Group Sector Benchmarking',
    piotroski: 'Piotroski 9-Point F-Score',
    altman: 'Altman Z-Score Distress Model',
    redflags: 'Automated Financial Red Flags Scan',
    momentum: 'Technical Momentum & Institutional Flow'
};

const ALL_FRAME_KEYS = Object.keys(FRAME_LABELS);

const FRAME_FOLLOWUP_CHIPS = {
    ic_debate: [
        'What is the single biggest downside risk to this stock?',
        'How does the Bull case justify the current multiple?',
        'What key metric would invalidate the investment thesis?',
        'Compare historical drawdown risk vs broader market corrections'
    ],
    capital_forensics: [
        'How does Stock-Based Compensation compare to Free Cash Flow?',
        'Is management funding share buybacks using internal cash or debt?',
        'What is the 3-year trend in Cash Conversion (OCF / Net Income)?',
        'Are accounts receivable growing faster than total revenue?'
    ],
    dcf: [
        'What exact FCF growth rate is priced into the current stock price?',
        'How sensitive is intrinsic value to a 100 bps rise in WACC?',
        'How does FCF yield compare to the 10-Year US Treasury yield?',
        'What terminal growth rate is assumed in the model?'
    ],
    dupont: [
        'Is ROE primarily driven by margin power or balance sheet leverage?',
        'How does Asset Turnover compare to historical sector averages?',
        'What happens to ROE if Net Profit Margins contract by 200 bps?',
        'Is the equity multiplier expanding due to debt issuance?'
    ],
    piotroski: [
        'Which specific Piotroski criteria failed and why?',
        'Has cash flow quality improved or deteriorated YoY?',
        'Is the company issuing dilutive shares or retiring equity?',
        'How does the 9-point score compare to sector leaders?'
    ],
    altman: [
        'What are the primary drivers keeping this in the Safe or Grey Zone?',
        'How soon are the company’s largest debt obligations maturing?',
        'Could a 20% drop in revenue push the company into distress?',
        'How does current working capital compare to total debt?'
    ],
    default: [
        'What is the most vulnerable assumption in this valuation?',
        'How does ROIC compare to the Weighted Average Cost of Capital?',
        'What are the biggest balance sheet and refinancing risks?',
        'How would a macroeconomic shock impact their gross margins?'
    ]
};

// ── 2. Markdown → HTML Institutional Parser ───────────────────────────────────
function formatAiOutput(text) {
    if (!text) return '';

    // 1. Extract fenced code blocks
    const codeBlocks = [];
    let processed = String(text).replace(/```([\s\S]*?)```/g, (_, code) => {
        const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
        codeBlocks.push(code.trim());
        return placeholder;
    });

    // 2. Parse and extract markdown tables
    const tables = [];
    processed = parseMarkdownTables(processed, (tableHtml) => {
        const placeholder = `__TABLE_PLACEHOLDER_${tables.length}__`;
        tables.push(tableHtml);
        return placeholder;
    });

    // 3. Escape HTML
    let safe = processed
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    // Markdown styling transforms
    safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    safe = safe.replace(/^(\d+)\.\s+(.+)$/gm, '<span class="terminal-bullet ordered"><span class="bullet-num">$1.</span> $2</span>');
    safe = safe.replace(/^\s{2,}[\-•*]\s+(.+)$/gm, '<span class="terminal-bullet nested">◦ $1</span>');
    safe = safe.replace(/^[\-•*]\s+(.+)$/gm, '<span class="terminal-bullet">• $1</span>');
    safe = safe.replace(/^#{1,4}\s+(.+)$/gm, '<strong class="terminal-heading">$1</strong>');
    safe = safe.replace(/^>\s*(.+)$/gm, '<blockquote class="terminal-quote">$1</blockquote>');
    safe = safe.replace(/\n\n/g, '</p><p>');
    safe = safe.replace(/\n/g, '<br>');

    let finalHtml = '<p>' + safe + '</p>';

    // Inject code blocks
    codeBlocks.forEach((code, idx) => {
        const placeholder = `__CODE_BLOCK_${idx}__`;
        const escapedCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const codeHtml = `<div class="terminal-code-block"><pre><code>${escapedCode}</code></pre></div>`;
        finalHtml = finalHtml.replace(new RegExp(`(<p>\\s*)?${placeholder}(\\s*</p>)?`, 'g'), codeHtml);
    });

    // Inject tables
    tables.forEach((tableHtml, idx) => {
        const placeholder = `__TABLE_PLACEHOLDER_${idx}__`;
        finalHtml = finalHtml.replace(new RegExp(`(<p>\\s*)?${placeholder}(\\s*</p>)?`, 'g'), tableHtml);
    });

    return finalHtml;
}

function parseMarkdownTables(text, registerTable) {
    const lines = text.split('\n');
    const processedLines = [];
    let inTable = false;
    let tableHeaders = null;
    let tableRows = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const isTableRow = line.startsWith('|') && line.endsWith('|') && (line.match(/\|/g) || []).length > 1;

        if (isTableRow) {
            const isSeparator = /^\|[\s\-\:\|]+$/.test(line);
            if (isSeparator) continue;

            const cells = line.split('|')
                .map(c => c.trim())
                .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

            if (!inTable) {
                inTable = true;
                tableHeaders = cells;
                tableRows = [];
            } else {
                tableRows.push(cells);
            }
        } else {
            if (inTable) {
                const tableHtml = compileHtmlTable(tableHeaders, tableRows);
                processedLines.push(registerTable(tableHtml));
                inTable = false;
                tableHeaders = null;
                tableRows = [];
            }
            processedLines.push(lines[i]);
        }
    }

    if (inTable) {
        const tableHtml = compileHtmlTable(tableHeaders, tableRows);
        processedLines.push(registerTable(tableHtml));
    }

    return processedLines.join('\n');
}

function compileHtmlTable(headers, rows) {
    const boldify = (text) => text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    let html = '<div class="terminal-table-wrapper"><table class="terminal-parsed-table"><thead><tr>';
    headers.forEach(h => {
        html += `<th>${boldify(h)}</th>`;
    });
    html += '</tr></thead><tbody>';
    rows.forEach(row => {
        html += '<tr>';
        row.forEach(cell => {
            html += `<td>${boldify(cell)}</td>`;
        });
        html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
}

// ── 3. Setup Workstation Entrypoint ────────────────────────────────────────────
export function setupAiAdvisor() {
    const btn = document.getElementById('execute-ai-btn');
    const input = document.getElementById('ai-ticker-input');
    const compareInput = document.getElementById('ai-compare-ticker-input');
    const compareBtn = document.getElementById('execute-compare-btn');
    const runAllBtn = document.getElementById('run-all-frames-btn');

    if (!btn) return;

    btn.addEventListener('click', () => executeAiAnalysis());
    if (runAllBtn) runAllBtn.addEventListener('click', () => executeAllFrames());
    if (compareBtn) compareBtn.addEventListener('click', () => executeCompareAnalysis());

    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                if (compareInput && compareInput.value.trim()) {
                    executeCompareAnalysis();
                } else {
                    executeAiAnalysis();
                }
            }
        });
    }

    if (compareInput) {
        compareInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') executeCompareAnalysis();
        });
    }

    // Quick ticker badges
    document.querySelectorAll('.qt-badge').forEach(badge => {
        badge.addEventListener('click', () => {
            const ticker = badge.dataset.ticker;
            if (input) {
                input.value = ticker;
                input.focus();
            }
        });
    });

    // Copy & Export & Clear Actions
    document.getElementById('ai-copy-btn')?.addEventListener('click', copyAnalysisToClipboard);
    document.getElementById('ai-export-btn')?.addEventListener('click', exportDossierMemo);
    document.getElementById('ai-clear-terminal-btn')?.addEventListener('click', clearTerminalScreen);

    // Follow-up submission
    const followupBtn = document.getElementById('ai-followup-btn');
    const followupInput = document.getElementById('ai-followup-input');
    if (followupBtn) followupBtn.addEventListener('click', sendFollowup);
    if (followupInput) {
        followupInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendFollowup();
        });
    }

    // Toggle Collapsible Data Context Panel
    const contextToggle = document.getElementById('ai-context-header-toggle');
    if (contextToggle) {
        contextToggle.addEventListener('click', () => {
            const body = document.getElementById('ai-context-body');
            const chevron = document.getElementById('ai-context-chevron');
            body?.classList.toggle('collapsed');
            chevron?.classList.toggle('collapsed');
        });
    }

    // Clear Vault Button
    document.getElementById('ai-clear-vault-btn')?.addEventListener('click', () => {
        localStorage.removeItem('strata_ai_vault');
        renderScanVault();
        showToast('Recent Scans Vault cleared.');
    });

    // Initial Vault Render
    renderScanVault();

    // Query params auto-run support (from Equity Analysis, Screener, or URL)
    const urlParams = new URLSearchParams(window.location.search);
    const queryTicker = urlParams.get('symbol') || urlParams.get('ticker');
    const compareTicker = urlParams.get('vs') || urlParams.get('compare');
    const autoRun = urlParams.get('autoRun');

    if (queryTicker && input) {
        input.value = queryTicker.trim().toUpperCase();
        if (compareTicker && compareInput) {
            compareInput.value = compareTicker.trim().toUpperCase();
        }
        setTimeout(() => {
            if (compareTicker) {
                executeCompareAnalysis();
            } else if (autoRun === 'all' || autoRun === 'true') {
                executeAllFrames();
            } else {
                executeAiAnalysis();
            }
        }, 250);
    }
}

// ── 4. Recent Scans Vault (localStorage, 15 items, 0ms Instant Reload) ────────
function getScanVault() {
    try {
        return JSON.parse(localStorage.getItem('strata_ai_vault') || '[]');
    } catch {
        return [];
    }
}

function saveScanToVault(entry) {
    try {
        const vault = getScanVault();
        const filtered = vault.filter(v => !(v.ticker === entry.ticker && v.frame === entry.frame));
        filtered.unshift(entry);
        localStorage.setItem('strata_ai_vault', JSON.stringify(filtered.slice(0, 15)));
        renderScanVault();
    } catch (e) {
        console.warn('Vault save failed:', e);
    }
}

function renderScanVault() {
    const vaultEl = document.getElementById('ai-scan-vault');
    const pillsWrap = document.getElementById('ai-vault-pills');
    if (!vaultEl || !pillsWrap) return;

    const vault = getScanVault();
    if (vault.length === 0) {
        vaultEl.classList.add('hidden-element');
        return;
    }

    vaultEl.classList.remove('hidden-element');
    pillsWrap.innerHTML = vault.map((item, idx) => `
        <button class="ai-vault-pill font-mono" data-idx="${idx}" title="${escapeHtml(item.frameLabel)} (${item.modelName})">
            <span class="vault-sym">${escapeHtml(item.ticker)}</span>
            <span class="vault-frm">${escapeHtml(item.frameLabel.slice(0, 18))}…</span>
        </button>
    `).join('');

    pillsWrap.querySelectorAll('.ai-vault-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            const idx = parseInt(pill.dataset.idx);
            const entry = vault[idx];
            if (!entry) return;

            // Load context & analysis from vault in 0ms!
            if (entry.data) {
                renderDataContext(entry.data);
            }

            const output = document.getElementById('ai-terminal-output');
            if (output) {
                output.innerHTML = `
                    <span class="terminal-prompt terminal-success">&gt; Vault Cache Loaded: ${escapeHtml(entry.ticker)} — ${escapeHtml(entry.frameLabel)} [${escapeHtml(entry.modelName)}] (0ms)</span>
                    <div class="ai-analysis-text fade-in">${entry.analysisHtml}</div>
                    <span class="terminal-prompt terminal-warn">&gt; Educational use only. Not financial advice.</span>
                `;
            }

            window.currentAiReport = {
                ticker: entry.ticker,
                frameLabel: entry.frameLabel,
                modelName: entry.modelName,
                analysisHtml: entry.analysisHtml,
                rawMarkdown: entry.rawMarkdown
            };

            updateModelIndicator(entry.provider, entry.modelName, true);
            renderFollowupChips(entry.frame);
            showFollowupBar();
            updateWordCount(entry.analysisHtml);
            updateTimestamp();
            hideTabBar();
            showToast(`Loaded ${entry.ticker} (${entry.frameLabel}) from vault.`);
        });
    });
}

// ── 5. Quantitative Intelligence Deck Rendering ────────────────────────────────
function renderDataContext(data) {
    const card = document.getElementById('ai-data-context-card');
    if (!card) return;
    card.classList.remove('hidden-element');

    // 1. Radar Chart & Conviction Score
    renderQuantRadarChart(data.quantScorecard, data.compareScorecard, data.symbol, data.compareSymbol);

    // 2. Scorecard Badges & Progress
    if (data.quantScorecard) {
        const q = data.quantScorecard;

        // Conviction Score & Rating Pill
        const scoreBadge = document.getElementById('ai-conviction-score-badge');
        const ratingPill = document.getElementById('ai-conviction-rating-pill');
        if (scoreBadge) scoreBadge.textContent = `${q.convictionScore}/100`;
        if (ratingPill) {
            ratingPill.textContent = q.convictionRating;
            ratingPill.className = `ai-conviction-pill ${q.convictionScore >= 75 ? 'bull' : (q.convictionScore >= 55 ? 'neutral' : 'bear')}`;
        }

        // Piotroski Progress Bar & Chips
        const pScoreEl = document.getElementById('ai-piotroski-score-badge');
        const pFillEl = document.getElementById('ai-piotroski-progress-fill');
        const pChipsWrap = document.getElementById('ai-piotroski-chips-grid');

        if (pScoreEl) pScoreEl.textContent = `${q.piotroski.totalScore} / 9`;
        if (pFillEl) pFillEl.style.width = `${(q.piotroski.totalScore / 9) * 100}%`;
        if (pChipsWrap && q.piotroski.criteria) {
            pChipsWrap.innerHTML = q.piotroski.criteria.map(c => `
                <div class="piotroski-chip ${c.passed ? 'pass' : 'fail'}" title="${escapeHtml(c.name)}: ${escapeHtml(c.valueStr)}">
                    <span class="chip-id">${c.id}</span>
                    <i class="fa-solid fa-${c.passed ? 'check' : 'xmark'}"></i>
                </div>
            `).join('');
        }

        // Altman Z-Score
        const zValEl = document.getElementById('ai-altman-zscore');
        const zBadge = document.getElementById('ai-altman-badge');
        if (zValEl) zValEl.textContent = q.altman.zScore;
        if (zBadge) {
            zBadge.textContent = q.altman.zone;
            zBadge.className = `zone-badge ${q.altman.zone === 'Safe Zone' ? 'safe' : (q.altman.zone === 'Grey Zone' ? 'grey' : 'distress')}`;
        }

        // Reverse-DCF Implied CAGR
        const dcfCagrEl = document.getElementById('ai-dcf-implied-cagr');
        const dcfBadge = document.getElementById('ai-dcf-stance-badge');
        const dcfSub = document.getElementById('ai-dcf-metrics-sub');
        if (dcfCagrEl) {
            dcfCagrEl.textContent = `${q.dcfModel.implied5YFcfCagrPct >= 0 ? '+' : ''}${q.dcfModel.implied5YFcfCagrPct}%`;
        }
        if (dcfBadge) {
            dcfBadge.textContent = q.dcfModel.valuationStance;
            dcfBadge.className = `zone-badge ${q.dcfModel.valuationStance.includes('Under') ? 'safe' : (q.dcfModel.valuationStance.includes('Fair') ? 'grey' : 'distress')}`;
        }
        if (dcfSub) {
            dcfSub.textContent = `WACC: ${q.dcfModel.waccPct}% · FCF Yield: ${q.dcfModel.fcfYieldPct}%`;
        }

        // 52-Week Range Percentile Bar
        const range52wVal = document.getElementById('ai-52w-pct-val');
        const fillBar = document.getElementById('ai-52w-fill-bar');
        const dot = document.getElementById('ai-52w-indicator-dot');
        const volSurgeVal = document.getElementById('ai-volume-surge-val');
        if (range52wVal) range52wVal.textContent = `${q.technical.range52wPct}%`;
        if (fillBar) fillBar.style.width = `${q.technical.range52wPct}%`;
        if (dot) dot.style.left = `${q.technical.range52wPct}%`;
        if (volSurgeVal) volSurgeVal.textContent = `${q.technical.volumeSurgeRatio}x`;
    }

    // 3. Wall Street Analyst Consensus Stacked Bar
    const barWrap = document.getElementById('ai-analyst-stacked-bar');
    const countsEl = document.getElementById('ai-analyst-counts');
    const bullishBadge = document.getElementById('ai-analyst-bullish-badge');

    if (data.analystConsensus) {
        const c = data.analystConsensus;
        const buy = (c.strongBuy || 0) + (c.buy || 0);
        const hold = (c.hold || 0);
        const sell = (c.sell || 0) + (c.strongSell || 0);
        const total = buy + hold + sell;

        if (total > 0 && barWrap) {
            const buyPct = (buy / total) * 100;
            const holdPct = (hold / total) * 100;
            const sellPct = (sell / total) * 100;
            barWrap.innerHTML = `
                <div class="bar-seg buy" style="width: ${buyPct}%;" title="Buy: ${buy}"></div>
                <div class="bar-seg hold" style="width: ${holdPct}%;" title="Hold: ${hold}"></div>
                <div class="bar-seg sell" style="width: ${sellPct}%;" title="Sell: ${sell}"></div>
            `;
            if (countsEl) countsEl.textContent = `Buy: ${buy} · Hold: ${hold} · Sell: ${sell}`;
            if (bullishBadge) bullishBadge.textContent = `${Math.round(buyPct)}% Bullish`;
        }
    }

    // 4. Company Header & Price Row
    const companyHeader = document.getElementById('ai-company-header');
    if (companyHeader && data.companyName) {
        const initials = (data.companyName || '').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
        companyHeader.innerHTML = `
            <div class="ai-company-info">
                <div class="ai-company-icon">${escapeHtml(initials)}</div>
                <div>
                    <span class="ai-company-name">${escapeHtml(data.companyName)}</span>
                    <div class="ai-company-tags">
                        <span class="ai-tag ticker-tag font-mono">${escapeHtml(data.symbol)}</span>
                        ${data.industry ? `<span class="ai-tag">${escapeHtml(data.industry)}</span>` : ''}
                        ${data.exchange ? `<span class="ai-tag">${escapeHtml(data.exchange)}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    const priceRow = document.getElementById('ai-price-row');
    if (priceRow && data.price != null) {
        const changeSign = data.change >= 0 ? '+' : '';
        const changeClass = data.change >= 0 ? 'text-emerald' : 'text-rose';
        priceRow.innerHTML = `
            <span class="ai-price-main font-mono tabular-nums">$${Number(data.price).toFixed(2)}</span>
            <span class="ai-price-change font-mono ${changeClass}">
                <i class="fa-solid fa-caret-${data.change >= 0 ? 'up' : 'down'}"></i>
                ${changeSign}${Number(data.change || 0).toFixed(2)} (${changeSign}${Number(data.changePercent || 0).toFixed(2)}%)
            </span>
        `;
    }

    const low52Lbl = document.getElementById('ai-52w-low-lbl');
    const high52Lbl = document.getElementById('ai-52w-high-lbl');
    if (low52Lbl && data.low52w) low52Lbl.textContent = `$${Number(data.low52w).toFixed(0)}`;
    if (high52Lbl && data.high52w) high52Lbl.textContent = `$${Number(data.high52w).toFixed(0)}`;

    // 5. Grid of Core Multiples
    const metricsGrid = document.getElementById('ai-metrics-grid');
    if (metricsGrid && data.metrics) {
        const m = data.metrics;
        const deVal = m.debtToEquityAnnual ?? m.totalDebtToEquity;
        const metricDefs = [
            { label: 'P/E (TTM)', value: m.peTTM },
            { label: 'P/B', value: m.pbAnnual },
            { label: 'P/S', value: m.psTTM },
            { label: 'EV/EBITDA', value: m.evEbitdaTTM },
            { label: 'ROE', value: m.roeTTM, suffix: '%' },
            { label: 'ROIC', value: m.roicTTM, suffix: '%' },
            { label: 'Gross Margin', value: m.grossMarginTTM, suffix: '%' },
            { label: 'Operating Margin', value: m.operatingMarginTTM, suffix: '%' },
            { label: 'Net Margin', value: m.netProfitMarginTTM, suffix: '%' },
            { label: 'FCF Margin', value: m.fcfMarginTTM, suffix: '%' },
            { label: 'Debt/Equity', value: deVal },
            { label: 'Current Ratio', value: m.currentRatioAnnual },
            { label: 'Asset Turnover', value: m.assetTurnoverTTM },
            { label: 'Beta', value: m.beta },
            { label: 'Div Yield', value: m.dividendYieldIndicatedAnnual, suffix: '%' },
            { label: 'Payout Ratio', value: m.payoutRatioAnnual, suffix: '%' },
        ];

        metricsGrid.innerHTML = metricDefs.map(def => {
            const val = def.value;
            let displayVal = val != null ? Number(val).toFixed(2) : '—';
            if (val != null && def.suffix) displayVal += def.suffix;
            return `
                <div class="ai-metric-mini">
                    <span class="metric-label">${def.label}</span>
                    <span class="metric-value font-mono tabular-nums">${displayVal}</span>
                </div>
            `;
        }).join('');
    }
}

// ── 6. 5-Pillar Radar Chart (Target vs Peer Overlay) ───────────────────────────
function renderQuantRadarChart(scorecardA, scorecardB = null, symA = '', symB = '') {
    const canvas = document.getElementById('ai-quant-radar-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    const rA = scorecardA?.radarScores || { valuation: 50, profitability: 50, balanceSheet: 50, growthMomentum: 50, earningsQuality: 50 };
    const labels = ['Valuation', 'Profitability & Moat', 'Balance Sheet Fortress', 'Growth & Momentum', 'Earnings Quality'];

    const datasets = [
        {
            label: symA || 'Target Instrument',
            data: [rA.valuation, rA.profitability, rA.balanceSheet, rA.growthMomentum, rA.earningsQuality],
            backgroundColor: 'rgba(56, 189, 248, 0.25)',
            borderColor: '#38bdf8',
            pointBackgroundColor: '#38bdf8',
            pointBorderColor: '#0f172a',
            pointHoverBackgroundColor: '#ffffff',
            borderWidth: 2
        }
    ];

    const legendTarget = document.getElementById('radar-legend-target');
    const legendPeerWrap = document.getElementById('radar-legend-compare-wrap');
    const legendPeer = document.getElementById('radar-legend-peer');

    if (legendTarget) legendTarget.textContent = symA || 'Target';

    if (scorecardB) {
        const rB = scorecardB?.radarScores || { valuation: 50, profitability: 50, balanceSheet: 50, growthMomentum: 50, earningsQuality: 50 };
        datasets.push({
            label: symB || 'Peer',
            data: [rB.valuation, rB.profitability, rB.balanceSheet, rB.growthMomentum, rB.earningsQuality],
            backgroundColor: 'rgba(168, 85, 247, 0.25)',
            borderColor: '#a855f7',
            pointBackgroundColor: '#a855f7',
            pointBorderColor: '#0f172a',
            pointHoverBackgroundColor: '#ffffff',
            borderWidth: 2
        });

        if (legendPeerWrap && legendPeer) {
            legendPeerWrap.style.display = 'inline';
            legendPeer.textContent = symB;
        }
    } else if (legendPeerWrap) {
        legendPeerWrap.style.display = 'none';
    }

    if (quantRadarChartInstance) {
        quantRadarChartInstance.destroy();
        quantRadarChartInstance = null;
    }

    const ctx = canvas.getContext('2d');
    quantRadarChartInstance = new Chart(ctx, {
        type: 'radar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw}/100`
                    }
                }
            },
            scales: {
                r: {
                    angleLines: { color: 'rgba(255, 255, 255, 0.08)' },
                    grid: { color: 'rgba(255, 255, 255, 0.08)' },
                    pointLabels: {
                        color: '#94a3b8',
                        font: { family: 'Inter', size: 10, weight: '500' }
                    },
                    ticks: {
                        display: false,
                        stepSize: 20
                    },
                    suggestedMin: 0,
                    suggestedMax: 100
                }
            }
        }
    });
}

// ── 7. Single-Frame Analysis Execution ─────────────────────────────────────────
async function executeAiAnalysis() {
    if (isAiRunning) return;

    const tickerInput = document.getElementById('ai-ticker-input');
    const frameSelect = document.getElementById('ai-model-select');
    const output = document.getElementById('ai-terminal-output');
    const btn = document.getElementById('execute-ai-btn');

    const ticker = tickerInput?.value.trim().toUpperCase();
    const frame = frameSelect?.value || 'ic_debate';

    if (!ticker) {
        showToast('Please enter a target equity ticker symbol.');
        return;
    }

    isAiRunning = true;
    if (btn) btn.disabled = true;

    hideFollowupBar();
    hideTabBar();

    const frameLabel = FRAME_LABELS[frame] || frame;
    showShimmer(output);

    const startTime = Date.now();
    const timerInterval = startTimerDisplay();

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/ai/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker, frame }),
            timeout: 90000,
        });

        clearInterval(timerInterval);
        resetTimerDisplay();

        const data = await safeJsonParse(response);

        if (!response.ok) {
            const errorType = data?.errorType || '';
            let message = data?.error || 'AI analysis failed.';
            if (errorType === 'TICKER_NOT_FOUND') message = `Ticker "${ticker}" not found. Check the symbol and retry.`;
            else if (errorType === 'RATE_LIMITED') message = 'Rate limit reached (30/min). Please wait a moment before running another scan.';
            throw new Error(message);
        }

        renderDataContext(data);

        if (output) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const providerNote = data.provider
                ? ` [${escapeHtml(data.provider)}${data.model ? ` / ${escapeHtml(data.model)}` : ''}]`
                : '';
            const cachedNote = data.cached ? ' <span class="terminal-accent">(cached)</span>' : '';
            const analysisHtml = formatAiOutput(data.analysis);

            output.innerHTML = `
                <span class="terminal-prompt terminal-success">&gt; Institutional Scan Complete in ${elapsed}s: ${escapeHtml(ticker)} — ${escapeHtml(frameLabel)}${providerNote}${cachedNote}</span>
                <div class="ai-analysis-text fade-in">${analysisHtml}</div>
                <span class="terminal-prompt terminal-warn">&gt; Educational use only. Not financial advice.</span>
            `;

            const reportData = {
                ticker: escapeHtml(ticker),
                frame,
                frameLabel: escapeHtml(frameLabel),
                modelName: escapeHtml(data.model || data.provider || 'STRATA Engine'),
                provider: data.provider,
                analysisHtml,
                rawMarkdown: data.analysis,
                data
            };

            window.currentAiReport = reportData;
            saveScanToVault(reportData);

            updateModelIndicator(data.provider, data.model, data.cached);
            renderFollowupChips(frame);
            showFollowupBar();
            updateWordCount(analysisHtml);
            updateTimestamp();
        }

        showToast(`AI analysis ready for ${ticker}.`);
    } catch (error) {
        clearInterval(timerInterval);
        resetTimerDisplay();
        console.error(error);
        const message = error.name === 'AbortError'
            ? 'AI request timed out. Please retry.'
            : error.message || 'AI analysis failed.';
        if (output) {
            output.innerHTML = `
                <span class="terminal-prompt terminal-warn">&gt; ${escapeHtml(message)}</span>
                <br>
                <button class="retry-btn" onclick="document.getElementById('execute-ai-btn').click()"><i class="fa-solid fa-rotate-right"></i> Retry Scan</button>
            `;
        }
        showToast(message);
    } finally {
        isAiRunning = false;
        if (btn) btn.disabled = false;
    }
}

// ── 8. Head-to-Head Peer Compare Showdown ──────────────────────────────────────
async function executeCompareAnalysis() {
    if (isAiRunning) return;

    const tickerInput = document.getElementById('ai-ticker-input');
    const compareInput = document.getElementById('ai-compare-ticker-input');
    const output = document.getElementById('ai-terminal-output');
    const compareBtn = document.getElementById('execute-compare-btn');

    const symbolA = tickerInput?.value.trim().toUpperCase();
    const symbolB = compareInput?.value.trim().toUpperCase();

    if (!symbolA || !symbolB) {
        showToast('Please enter both a Target Ticker and a Peer Ticker for comparison.');
        return;
    }

    if (symbolA === symbolB) {
        showToast('Enter two distinct tickers for a head-to-head showdown.');
        return;
    }

    isAiRunning = true;
    if (compareBtn) compareBtn.disabled = true;

    hideFollowupBar();
    hideTabBar();

    showShimmer(output);
    const startTime = Date.now();
    const timerInterval = startTimerDisplay();

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/ai/compare`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbolA, symbolB }),
            timeout: 90000,
        });

        clearInterval(timerInterval);
        resetTimerDisplay();

        const data = await safeJsonParse(response);
        if (!response.ok) {
            throw new Error(data?.error || 'Head-to-head comparison failed.');
        }

        // Render combined context with dual radar chart!
        renderDataContext({
            ...data.contextA,
            compareSymbol: symbolB,
            compareScorecard: data.contextB.quantScorecard
        });

        if (output) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const analysisHtml = formatAiOutput(data.analysis);
            output.innerHTML = `
                <span class="terminal-prompt terminal-success">&gt; Head-to-Head Showdown Complete in ${elapsed}s: ${escapeHtml(symbolA)} vs. ${escapeHtml(symbolB)}</span>
                <div class="ai-analysis-text fade-in">${analysisHtml}</div>
                <span class="terminal-prompt terminal-warn">&gt; Educational use only. Not financial advice.</span>
            `;

            window.currentAiReport = {
                ticker: `${symbolA}_vs_${symbolB}`,
                frame: 'compare',
                frameLabel: `Head-to-Head: ${symbolA} vs ${symbolB}`,
                modelName: data.model || data.provider || 'STRATA Engine',
                provider: data.provider,
                analysisHtml,
                rawMarkdown: data.analysis
            };

            updateModelIndicator(data.provider, data.model, data.cached);
            renderFollowupChips('ic_debate');
            showFollowupBar();
            updateWordCount(analysisHtml);
            updateTimestamp();
        }

        showToast(`Head-to-Head comparison ready: ${symbolA} vs ${symbolB}`);
    } catch (error) {
        clearInterval(timerInterval);
        resetTimerDisplay();
        console.error(error);
        if (output) {
            output.innerHTML = `<span class="terminal-prompt terminal-warn">&gt; ${escapeHtml(error.message)}</span>`;
        }
        showToast(error.message);
    } finally {
        isAiRunning = false;
        if (compareBtn) compareBtn.disabled = false;
    }
}

// ── 9. Multi-Frame (Run All 10 Frames Sequentially with Context Cache) ─────────
async function executeAllFrames() {
    if (isAiRunning) return;

    const tickerInput = document.getElementById('ai-ticker-input');
    const output = document.getElementById('ai-terminal-output');
    const btn = document.getElementById('execute-ai-btn');
    const runAllBtn = document.getElementById('run-all-frames-btn');

    const ticker = tickerInput?.value.trim().toUpperCase();
    if (!ticker) {
        showToast('Please enter a ticker symbol to run all 10 analytical frames.');
        return;
    }

    isAiRunning = true;
    if (btn) btn.disabled = true;
    if (runAllBtn) runAllBtn.disabled = true;
    hideFollowupBar();

    currentMultiFrameResults = {};
    activeMultiFrameTab = null;

    const tabBar = document.getElementById('ai-tab-bar');
    if (tabBar) {
        tabBar.classList.remove('hidden-element');
        tabBar.innerHTML = ALL_FRAME_KEYS.map(key => `
            <button class="ai-tab-btn loading font-mono" data-frame="${key}">
                ${FRAME_LABELS[key]}
            </button>
        `).join('');

        tabBar.querySelectorAll('.ai-tab-btn').forEach(tab => {
            tab.addEventListener('click', () => {
                const frameKey = tab.dataset.frame;
                if (currentMultiFrameResults[frameKey]) {
                    switchTab(frameKey);
                }
            });
        });
    }

    showShimmer(output);
    const timerInterval = startTimerDisplay();

    let completedCount = 0;
    let firstContextRendered = false;

    for (const frameKey of ALL_FRAME_KEYS) {
        try {
            const response = await fetchWithTimeout(`${BACKEND_URL}/api/ai/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticker, frame: frameKey }),
                timeout: 90000,
            });

            const data = await safeJsonParse(response);
            if (response.ok) {
                const analysisHtml = formatAiOutput(data.analysis);
                currentMultiFrameResults[frameKey] = {
                    analysisHtml,
                    rawMarkdown: data.analysis,
                    frameLabel: FRAME_LABELS[frameKey],
                    modelName: data.model || data.provider || 'STRATA Engine',
                    provider: data.provider,
                    model: data.model,
                };

                if (!firstContextRendered) {
                    renderDataContext(data);
                    firstContextRendered = true;
                }

                const tab = tabBar?.querySelector(`[data-frame="${frameKey}"]`);
                if (tab) {
                    tab.classList.remove('loading');
                    tab.classList.add('done');
                }

                completedCount++;
                if (completedCount === 1) {
                    switchTab(frameKey);
                }
            }
        } catch (err) {
            console.warn(`Frame ${frameKey} failed:`, err.message);
            const tab = tabBar?.querySelector(`[data-frame="${frameKey}"]`);
            if (tab) {
                tab.classList.remove('loading');
                tab.classList.add('fail');
            }
        }
    }

    clearInterval(timerInterval);
    resetTimerDisplay();

    if (completedCount > 0) {
        showFollowupBar();
        renderFollowupChips(activeMultiFrameTab || 'ic_debate');
        showToast(`Completed ${completedCount}/${ALL_FRAME_KEYS.length} frames for ${ticker}.`);
        updateTimestamp();
    } else {
        if (output) {
            output.innerHTML = `<span class="terminal-prompt terminal-warn">&gt; All frames failed for ${escapeHtml(ticker)}. Check server connection.</span>`;
        }
    }

    isAiRunning = false;
    if (btn) btn.disabled = false;
    if (runAllBtn) runAllBtn.disabled = false;
}

function switchTab(frameKey) {
    const output = document.getElementById('ai-terminal-output');
    const tabBar = document.getElementById('ai-tab-bar');
    if (!output || !tabBar) return;

    const result = currentMultiFrameResults[frameKey];
    if (!result) return;

    activeMultiFrameTab = frameKey;

    tabBar.querySelectorAll('.ai-tab-btn').forEach(t => t.classList.remove('active'));
    const activeTab = tabBar.querySelector(`[data-frame="${frameKey}"]`);
    if (activeTab) activeTab.classList.add('active');

    output.innerHTML = `
        <span class="terminal-prompt terminal-success">&gt; ${escapeHtml(result.frameLabel)}${result.provider ? ` [${escapeHtml(result.provider)}]` : ''}</span>
        <div class="ai-analysis-text fade-in">${result.analysisHtml}</div>
        <span class="terminal-prompt terminal-warn">&gt; Educational use only. Not financial advice.</span>
    `;

    updateWordCount(result.analysisHtml);
    renderFollowupChips(frameKey);

    const tickerInput = document.getElementById('ai-ticker-input');
    const ticker = tickerInput?.value.trim().toUpperCase() || '';
    window.currentAiReport = {
        ticker: escapeHtml(ticker),
        frame: frameKey,
        frameLabel: escapeHtml(result.frameLabel),
        modelName: escapeHtml(result.modelName),
        analysisHtml: result.analysisHtml,
        rawMarkdown: result.rawMarkdown
    };
}

// ── 10. Follow-Up Inquiries & Tailored Chips ──────────────────────────────────
function renderFollowupChips(frameKey) {
    const chipsList = document.getElementById('ai-followup-chips-list');
    if (!chipsList) return;

    const questions = FRAME_FOLLOWUP_CHIPS[frameKey] || FRAME_FOLLOWUP_CHIPS.default;
    chipsList.innerHTML = questions.map(q => `
        <button type="button" class="ai-chip-prompt" data-question="${escapeHtml(q)}">
            ${escapeHtml(q)}
        </button>
    `).join('');

    chipsList.querySelectorAll('.ai-chip-prompt').forEach(btn => {
        btn.addEventListener('click', () => {
            const q = btn.getAttribute('data-question');
            const input = document.getElementById('ai-followup-input');
            if (input) {
                input.value = q;
                sendFollowup();
            }
        });
    });
}

async function sendFollowup() {
    if (isAiRunning) return;

    const followupInput = document.getElementById('ai-followup-input');
    const question = followupInput?.value.trim();
    if (!question) return;

    const report = window.currentAiReport;
    if (!report) {
        showToast('Run an analysis first before asking a follow-up question.');
        return;
    }

    isAiRunning = true;
    const followupBtn = document.getElementById('ai-followup-btn');
    if (followupBtn) followupBtn.disabled = true;

    const output = document.getElementById('ai-terminal-output');
    if (output) {
        output.innerHTML += `
            <div class="ai-followup-thread">
                <div class="ai-followup-q"><i class="fa-solid fa-user"></i> <span>${escapeHtml(question)}</span></div>
                <div class="ai-followup-a"><div class="ai-typing-indicator"><span></span><span></span><span></span></div></div>
            </div>
        `;
        output.scrollTop = output.scrollHeight;
    }

    followupInput.value = '';

    try {
        const plainAnalysis = (report.rawMarkdown || report.analysisHtml.replace(/<[^>]*>/g, ' ')).substring(0, 3000);

        const response = await fetchWithTimeout(`${BACKEND_URL}/api/ai/followup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ticker: report.ticker,
                previousAnalysis: plainAnalysis,
                question,
            }),
            timeout: 60000,
        });

        const data = await safeJsonParse(response);
        if (!response.ok) {
            throw new Error(data?.error || 'Follow-up failed.');
        }

        const answerHtml = formatAiOutput(data.analysis);
        const threads = output?.querySelectorAll('.ai-followup-thread');
        if (threads && threads.length > 0) {
            const lastThread = threads[threads.length - 1];
            const answerEl = lastThread.querySelector('.ai-followup-a');
            if (answerEl) {
                answerEl.innerHTML = `<div class="ai-analysis-text fade-in">${answerHtml}</div>`;
            }
        }

        output.scrollTop = output.scrollHeight;
    } catch (error) {
        console.error('Follow-up error:', error);
        const threads = output?.querySelectorAll('.ai-followup-thread');
        if (threads && threads.length > 0) {
            const lastThread = threads[threads.length - 1];
            const answerEl = lastThread.querySelector('.ai-followup-a');
            if (answerEl) {
                answerEl.innerHTML = `<span class="terminal-warn">${escapeHtml(error.message)}</span>`;
            }
        }
        showToast(error.message);
    } finally {
        isAiRunning = false;
        if (followupBtn) followupBtn.disabled = false;
        followupInput?.focus();
    }
}

// ── 11. UI Helpers, Shimmer & Export Actions ──────────────────────────────────
function showShimmer(output) {
    if (!output) return;
    output.innerHTML = `
        <span class="terminal-prompt terminal-accent">&gt; Resolving multi-source feeds &amp; computing verified quantitative scorecards…</span>
        <div class="ai-shimmer-block">
            <div class="ai-shimmer-heading"></div>
            <div class="ai-shimmer-line"></div>
            <div class="ai-shimmer-line"></div>
            <div class="ai-shimmer-line"></div>
            <div class="ai-shimmer-heading"></div>
            <div class="ai-shimmer-line"></div>
            <div class="ai-shimmer-line"></div>
            <div class="ai-shimmer-line"></div>
        </div>
        <div class="ai-typing-indicator"><span></span><span></span><span></span></div>
    `;
}

function updateModelIndicator(provider, model, cached = false) {
    const modelPill = document.getElementById('ai-model-indicator');
    const cachedPill = document.getElementById('ai-cached-pill');
    if (modelPill && provider) {
        modelPill.innerHTML = `<i class="fa-solid fa-microchip"></i> ${escapeHtml(provider.toUpperCase())} // ${escapeHtml(model || '')}`;
    }
    if (cachedPill) {
        if (cached) cachedPill.classList.remove('hidden-element');
        else cachedPill.classList.add('hidden-element');
    }
}

function showFollowupBar() {
    const bar = document.getElementById('ai-followup-bar');
    if (bar) bar.classList.remove('hidden-element');
}

function hideFollowupBar() {
    const bar = document.getElementById('ai-followup-bar');
    if (bar) bar.classList.add('hidden-element');
    const input = document.getElementById('ai-followup-input');
    if (input) input.value = '';
}

function hideTabBar() {
    const tabBar = document.getElementById('ai-tab-bar');
    if (tabBar) {
        tabBar.classList.add('hidden-element');
        tabBar.innerHTML = '';
    }
    currentMultiFrameResults = {};
    activeMultiFrameTab = null;
}

function updateWordCount(html) {
    const el = document.getElementById('ai-word-count');
    if (!el) return;
    const text = html ? html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const words = text ? text.split(' ').length : 0;
    el.textContent = words > 0 ? `${words} words` : '';
}

function updateTimestamp() {
    const el = document.getElementById('ai-scan-timestamp');
    if (!el) return;
    el.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

let timerRef = null;
let originalTitleText = '';
function startTimerDisplay() {
    const timerEl = document.getElementById('ai-terminal-title-text');
    originalTitleText = timerEl?.textContent || 'quant-engine-v4.2 // bloomberggpt_stream';
    const startTime = Date.now();
    return setInterval(() => {
        if (timerEl) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            timerEl.textContent = `${originalTitleText}  ⏱ ${elapsed}s`;
        }
    }, 100);
}

function resetTimerDisplay() {
    const timerEl = document.getElementById('ai-terminal-title-text');
    if (timerEl && originalTitleText) {
        timerEl.textContent = originalTitleText;
    }
}

async function copyAnalysisToClipboard() {
    const output = document.getElementById('ai-terminal-output');
    const btn = document.getElementById('ai-copy-btn');
    if (!output) return;
    const text = output.innerText || output.textContent || '';
    try {
        await navigator.clipboard.writeText(text);
        if (btn) {
            btn.classList.add('copied');
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
            setTimeout(() => {
                btn.classList.remove('copied');
                btn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
            }, 2000);
        }
    } catch {
        showToast('Failed to copy. Try selecting text manually.');
    }
}

function exportDossierMemo() {
    const report = window.currentAiReport;
    if (!report) {
        showToast('Run an analysis first before exporting a dossier.');
        return;
    }

    const textToExport = report.rawMarkdown || report.analysisHtml.replace(/<[^>]*>/g, '');
    const header = `# STRATA INSTITUTIONAL EQUITY RESEARCH DOSSIER
**Ticker:** ${report.ticker} | **Frame:** ${report.frameLabel}
**Engine:** ${report.modelName} | **Date:** ${new Date().toISOString().slice(0, 10)}
========================================================================

`;
    const blob = new Blob([header + textToExport], { type: 'text/markdown;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `STRATA_AI_${report.ticker}_${(report.frame || 'dossier').toLowerCase()}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported research dossier for ${report.ticker}.`);
}

function clearTerminalScreen() {
    const output = document.getElementById('ai-terminal-output');
    if (output) {
        output.innerHTML = '<span class="terminal-prompt">&gt; STRATA Algorithmic Quant Terminal Online. Enter a ticker to initiate a deep institutional scan.</span>';
    }
    hideFollowupBar();
    hideTabBar();
    window.currentAiReport = null;
    showToast('Terminal screen cleared.');
}
