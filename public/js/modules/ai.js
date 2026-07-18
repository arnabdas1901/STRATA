import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast, escapeHtml } from '../utils.js';

let isAiRunning = false;
let currentMultiFrameResults = {}; // { frameKey: { analysisHtml, frameLabel } }
let activeMultiFrameTab = null;

// ──────────────────────────────────────────
//  MARKDOWN → HTML FORMATTER
// ──────────────────────────────────────────

function formatAiOutput(text) {
    if (!text) return '';
    
    // 1. Extract fenced code blocks before any other processing
    const codeBlocks = [];
    let processed = String(text).replace(/```([\s\S]*?)```/g, (_, code) => {
        const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
        codeBlocks.push(code.trim());
        return placeholder;
    });

    // 2. Parse and extract tables to placeholders
    const tables = [];
    processed = parseMarkdownTables(processed, (tableHtml) => {
        const placeholder = `__TABLE_PLACEHOLDER_${tables.length}__`;
        tables.push(tableHtml);
        return placeholder;
    });

    // 3. Escape HTML for safety
    let safe = processed
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    // Convert **bold** to <strong>
    safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Convert numbered lists (1. Item)
    safe = safe.replace(/^(\d+)\.\s+(.+)$/gm, '<span class="terminal-bullet ordered"><span class="bullet-num">$1.</span> $2</span>');
    // Convert nested bullet points (indented with 2+ spaces)
    safe = safe.replace(/^\s{2,}[\-•*]\s+(.+)$/gm, '<span class="terminal-bullet nested">◦ $1</span>');
    // Convert top-level bullet points (lines starting with -, •, or *)
    safe = safe.replace(/^[\-•*]\s+(.+)$/gm, '<span class="terminal-bullet">• $1</span>');
    // Convert headings (#, ##, ###, etc.)
    safe = safe.replace(/^#{1,4}\s+(.+)$/gm, '<strong class="terminal-heading">$1</strong>');
    // Convert double newlines to paragraph breaks, single to <br>
    safe = safe.replace(/\n\n/g, '</p><p>');
    safe = safe.replace(/\n/g, '<br>');
    
    let finalHtml = '<p>' + safe + '</p>';

    // 4. Inject code blocks back
    codeBlocks.forEach((code, idx) => {
        const placeholder = `__CODE_BLOCK_${idx}__`;
        const escapedCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const codeHtml = `<div class="terminal-code-block"><pre><code>${escapedCode}</code></pre></div>`;
        const pRegex = new RegExp(`<p>\\s*${placeholder}\\s*</p>`, 'g');
        if (pRegex.test(finalHtml)) {
            finalHtml = finalHtml.replace(pRegex, codeHtml);
        } else {
            finalHtml = finalHtml.replace(new RegExp(placeholder, 'g'), codeHtml);
        }
    });

    // 5. Inject tables back, stripping any wrapping <p> tag
    tables.forEach((tableHtml, idx) => {
        const placeholder = `__TABLE_PLACEHOLDER_${idx}__`;
        const pRegex = new RegExp(`<p>\\s*${placeholder}\\s*</p>`, 'g');
        if (pRegex.test(finalHtml)) {
            finalHtml = finalHtml.replace(pRegex, tableHtml);
        } else {
            finalHtml = finalHtml.replace(new RegExp(placeholder, 'g'), tableHtml);
        }
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
        
        // A table row must start and end with | and have at least one separator inside
        const isTableRow = line.startsWith('|') && line.endsWith('|') && (line.match(/\|/g) || []).length > 1;

        if (isTableRow) {
            const isSeparator = /^\|[\s\-\:\|]+$/.test(line);
            if (isSeparator) {
                continue;
            }

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

// ──────────────────────────────────────────
//  FRAME LABELS MAP
// ──────────────────────────────────────────

const FRAME_LABELS = {
    dupont: '3-Stage DuPont Decomposition',
    redflags: 'Financial Red Flags Scan',
    dcf: 'DCF Intrinsic Value',
    benchmarking: 'Peer-Group Benchmarking',
    piotroski: 'Piotroski F-Score',
    altman: 'Altman Z-Score',
    momentum: 'Momentum & Price Action',
    moat: 'Buffett/Munger Economic Moat',
};

const ALL_FRAME_KEYS = Object.keys(FRAME_LABELS);

// ──────────────────────────────────────────
//  SETUP
// ──────────────────────────────────────────

export function setupAiAdvisor() {
    const btn = document.getElementById('execute-ai-btn');
    const input = document.getElementById('ai-ticker-input');
    if (!btn) return;

    btn.addEventListener('click', executeAiAnalysis);
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') executeAiAnalysis();
        });
    }
    
    const pdfBtn = document.getElementById('ai-pdf-btn');
    if (pdfBtn) {
        pdfBtn.addEventListener('click', exportAiPdf);
    }

    // Run All Frames button
    const runAllBtn = document.getElementById('run-all-frames-btn');
    if (runAllBtn) {
        runAllBtn.addEventListener('click', executeAllFrames);
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

    // Copy button
    const copyBtn = document.getElementById('ai-copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', copyAnalysisToClipboard);
    }

    // Follow-up bar
    const followupBtn = document.getElementById('ai-followup-btn');
    const followupInput = document.getElementById('ai-followup-input');
    if (followupBtn) {
        followupBtn.addEventListener('click', sendFollowup);
    }
    if (followupInput) {
        followupInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendFollowup();
        });
    }

    // Data context panel toggle
    const contextToggle = document.getElementById('ai-context-header-toggle');
    if (contextToggle) {
        contextToggle.addEventListener('click', () => {
            const body = document.getElementById('ai-context-body');
            const chevron = document.getElementById('ai-context-chevron');
            body?.classList.toggle('collapsed');
            chevron?.classList.toggle('collapsed');
        });
    }

    renderHistoryStrip();
}

// ──────────────────────────────────────────
//  HISTORY (localStorage, 10 entries)
// ──────────────────────────────────────────

function getAnalysisHistory() {
    try {
        return JSON.parse(localStorage.getItem('strata_ai_history') || '[]');
    } catch { return []; }
}

function saveToHistory(entry) {
    const history = getAnalysisHistory();
    // Remove duplicate if exists
    const filtered = history.filter(h => !(h.ticker === entry.ticker && h.frame === entry.frame));
    filtered.unshift(entry);
    // Keep last 10
    localStorage.setItem('strata_ai_history', JSON.stringify(filtered.slice(0, 10)));
    renderHistoryStrip();
}

function renderHistoryStrip() {
    let strip = document.getElementById('ai-history-strip');
    if (!strip) {
        strip = document.createElement('div');
        strip.id = 'ai-history-strip';
        strip.className = 'ai-history-strip';
        const controlPanel = document.querySelector('.ai-control-panel-card');
        if (controlPanel) controlPanel.after(strip);
        else return;
    }
    const history = getAnalysisHistory();
    if (history.length === 0) { strip.style.display = 'none'; return; }
    strip.style.display = '';
    strip.innerHTML = `
        <div class="history-strip-header">
            <i class="fa-solid fa-clock-rotate-left"></i> Recent Scans
            <button id="ai-clear-history-btn" style="margin-left:auto; background:none; border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:3px 10px; font-size:0.7rem; color:#6b7280; cursor:pointer; font-family:var(--font-mono); transition:all 0.2s;" title="Clear history"><i class="fa-solid fa-trash-can"></i></button>
        </div>
        <div class="history-pills">
            ${history.map((h, i) => `<button class="history-pill" data-index="${i}"><span class="pill-ticker">${h.ticker}</span><span class="pill-frame">${h.frameLabel}</span></button>`).join('')}
        </div>
    `;

    // Clear history button
    const clearBtn = document.getElementById('ai-clear-history-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            localStorage.removeItem('strata_ai_history');
            renderHistoryStrip();
            showToast('Analysis history cleared.');
        });
    }

    strip.querySelectorAll('.history-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            const idx = parseInt(pill.dataset.index);
            const entry = history[idx];
            if (!entry) return;
            const output = document.getElementById('ai-terminal-output');
            if (output) {
                output.innerHTML = `
                    <span class="terminal-prompt terminal-success">&gt; Cached scan: ${entry.ticker} — ${entry.frameLabel} [${entry.modelName}]</span>
                    <div class="ai-analysis-text">${entry.analysisHtml}</div>
                    <span class="terminal-prompt terminal-warn">&gt; Educational use only. Not financial advice.</span>
                `;
            }
            window.currentAiReport = { ticker: entry.ticker, frameLabel: entry.frameLabel, modelName: entry.modelName, analysisHtml: entry.analysisHtml };
            const pdfBtn = document.getElementById('ai-pdf-btn');
            if (pdfBtn) pdfBtn.style.display = 'inline-flex';
            showFollowupBar();
            updateWordCount(entry.analysisHtml);
            // Hide multi-frame tabs
            hideTabBar();
        });
    });
}

// ──────────────────────────────────────────
//  DATA CONTEXT PANEL
// ──────────────────────────────────────────

function renderDataContext(data) {
    const card = document.getElementById('ai-data-context-card');
    if (!card) return;

    // Show the card
    card.classList.remove('hidden-element');

    // Company header
    const companyHeader = document.getElementById('ai-company-header');
    if (companyHeader && data.companyName) {
        const initials = (data.companyName || '').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
        companyHeader.innerHTML = `
            <div class="ai-company-info">
                <div class="ai-company-icon">${escapeHtml(initials)}</div>
                <span class="ai-company-name">${escapeHtml(data.companyName)}</span>
                <div class="ai-company-tags">
                    <span class="ai-tag ticker-tag">${escapeHtml(data.symbol)}</span>
                    ${data.industry ? `<span class="ai-tag">${escapeHtml(data.industry)}</span>` : ''}
                    ${data.exchange ? `<span class="ai-tag">${escapeHtml(data.exchange)}</span>` : ''}
                </div>
            </div>
        `;
    }

    // Price row
    const priceRow = document.getElementById('ai-price-row');
    if (priceRow && data.price != null) {
        const changeDir = data.change >= 0 ? 'positive' : 'negative';
        const changeSign = data.change >= 0 ? '+' : '';
        const high52 = data.high52w;
        const low52 = data.low52w;
        let distFrom52H = '';
        if (high52 && data.price) {
            const pct = ((data.price - high52) / high52 * 100).toFixed(1);
            distFrom52H = `<span class="label-52w">(${pct}% from 52W H)</span>`;
        }
        priceRow.innerHTML = `
            <span class="ai-price-main">$${Number(data.price).toFixed(2)}</span>
            <span class="ai-price-change ${changeDir}">
                <i class="fa-solid fa-caret-${data.change >= 0 ? 'up' : 'down'}"></i>
                ${changeSign}${Number(data.change || 0).toFixed(2)} (${changeSign}${Number(data.changePercent || 0).toFixed(2)}%)
            </span>
            <span class="ai-price-range">
                <span class="label-52w">52W:</span> ${low52 ? '$' + Number(low52).toFixed(2) : '–'} — ${high52 ? '$' + Number(high52).toFixed(2) : '–'}
                ${distFrom52H}
            </span>
        `;
    }

    // Metrics grid
    const metricsGrid = document.getElementById('ai-metrics-grid');
    if (metricsGrid && data.metrics) {
        const m = data.metrics;
        const metricDefs = [
            { label: 'P/E (TTM)', value: m.peTTM, good: [0, 25], warn: [25, 40] },
            { label: 'P/B', value: m.pbAnnual, good: [0, 3], warn: [3, 6] },
            { label: 'P/S', value: m.psTTM, good: [0, 5], warn: [5, 10] },
            { label: 'ROE (TTM)', value: m.roeTTM, suffix: '%', good: [15, 999], warn: [8, 15] },
            { label: 'ROA (TTM)', value: m.roaTTM, suffix: '%', good: [7, 999], warn: [3, 7] },
            { label: 'Gross Margin', value: m.grossMarginTTM, suffix: '%', good: [40, 999], warn: [20, 40] },
            { label: 'D/E Ratio', value: m.debtToEquityAnnual, good: [0, 0.5], warn: [0.5, 2], invert: true },
            { label: 'Beta', value: m.beta, good: [0.8, 1.3], warn: [0.5, 1.8] },
        ];

        metricsGrid.innerHTML = metricDefs.map(def => {
            const val = def.value;
            let displayVal = val != null ? Number(val).toFixed(2) : '—';
            if (val != null && def.suffix) displayVal += def.suffix;
            let colorClass = 'val-neutral';
            if (val != null && def.good && def.warn) {
                if (def.invert) {
                    if (val >= def.good[0] && val <= def.good[1]) colorClass = 'val-good';
                    else if (val > def.warn[1]) colorClass = 'val-bad';
                    else colorClass = 'val-warn';
                } else {
                    if (val >= def.good[0] && val <= def.good[1]) colorClass = 'val-good';
                    else if (val >= def.warn[0] && val <= def.warn[1]) colorClass = 'val-warn';
                    else colorClass = val < def.good[0] ? 'val-bad' : 'val-bad';
                }
            }
            return `<div class="ai-metric-mini">
                <span class="metric-label">${def.label}</span>
                <span class="metric-value ${colorClass}">${displayVal}</span>
            </div>`;
        }).join('');
    }
}

// ──────────────────────────────────────────
//  SHIMMER LOADING
// ──────────────────────────────────────────

function showShimmer(output) {
    if (!output) return;
    output.innerHTML = `
        <span class="terminal-prompt terminal-accent">&gt; Initiating deep scan… querying market data feeds…</span>
        <div class="ai-shimmer-block">
            <div class="ai-shimmer-heading"></div>
            <div class="ai-shimmer-line"></div>
            <div class="ai-shimmer-line"></div>
            <div class="ai-shimmer-line"></div>
            <div class="ai-shimmer-heading"></div>
            <div class="ai-shimmer-line"></div>
            <div class="ai-shimmer-line"></div>
            <div class="ai-shimmer-line"></div>
            <div class="ai-shimmer-line"></div>
        </div>
        <div class="ai-typing-indicator"><span></span><span></span><span></span></div>
    `;
}

// ──────────────────────────────────────────
//  UTILITIES
// ──────────────────────────────────────────

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
    if (tabBar) { tabBar.classList.add('hidden-element'); tabBar.innerHTML = ''; }
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

// ──────────────────────────────────────────
//  SINGLE-FRAME ANALYSIS
// ──────────────────────────────────────────

async function executeAiAnalysis() {
    if (isAiRunning) return;

    const tickerInput = document.getElementById('ai-ticker-input');
    const frameSelect = document.getElementById('ai-model-select');
    const output = document.getElementById('ai-terminal-output');
    const btn = document.getElementById('execute-ai-btn');

    const ticker = tickerInput?.value.trim().toUpperCase();
    const frame = frameSelect?.value || 'dupont';

    if (!ticker) {
        showToast('Enter a ticker symbol for AI analysis.');
        return;
    }

    isAiRunning = true;
    if (btn) btn.disabled = true;
    
    const pdfBtn = document.getElementById('ai-pdf-btn');
    if (pdfBtn) pdfBtn.style.display = 'none';
    hideFollowupBar();
    hideTabBar();

    const frameLabel = frameSelect?.selectedOptions?.[0]?.textContent || frame;

    // Show shimmer loading
    showShimmer(output);

    // Elapsed time counter
    const startTime = Date.now();
    const timerEl = document.querySelector('.terminal-title');
    const originalTitle = timerEl?.textContent || '';
    const timerInterval = setInterval(() => {
        if (timerEl) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            timerEl.textContent = `${originalTitle}  ⏱ ${elapsed}s`;
        }
    }, 100);

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/ai/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker, frame }),
            timeout: 90000,
        });

        clearInterval(timerInterval);
        if (timerEl) timerEl.textContent = originalTitle;

        const data = await safeJsonParse(response);

        if (!response.ok) {
            const errorType = data?.errorType || '';
            let message = data?.error || 'AI analysis failed.';
            if (errorType === 'TICKER_NOT_FOUND') message = `Ticker "${ticker}" not found. Check the symbol and try again.`;
            else if (errorType === 'RATE_LIMITED') message = 'Rate limit reached. Please wait a moment before running another scan.';
            else if (errorType === 'AI_PROVIDER_ERROR') message = 'AI engine temporarily unavailable. Please try again in a few seconds.';
            throw new Error(message);
        }

        // Render data context panel
        renderDataContext(data);

        if (output) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const providerNote = data.provider
                ? ` [${escapeHtml(data.provider)}${data.model ? ` / ${escapeHtml(data.model)}` : ''}]`
                : '';
            const cachedNote = data.cached ? ' <span class="terminal-accent">(cached)</span>' : '';
            const analysisHtml = formatAiOutput(data.analysis);
            output.innerHTML = `
                <span class="terminal-prompt terminal-success">&gt; Scan complete in ${elapsed}s: ${escapeHtml(ticker)} — ${escapeHtml(frameLabel)}${providerNote}${cachedNote}</span>
                <div class="ai-analysis-text fade-in">${analysisHtml}</div>
                <span class="terminal-prompt terminal-warn">&gt; Educational use only. Not financial advice.</span>
            `;

            const reportData = {
                ticker: escapeHtml(ticker),
                frameLabel: escapeHtml(frameLabel),
                modelName: escapeHtml(data.model || data.provider || 'STRATA Engine'),
                analysisHtml: analysisHtml
            };

            // Cache data for PDF
            window.currentAiReport = reportData;

            // Save to history
            saveToHistory({ ...reportData, frame });

            updateWordCount(analysisHtml);
            updateTimestamp();
        }
        
        if (pdfBtn) pdfBtn.style.display = 'inline-flex';
        showFollowupBar();
        
        showToast(`AI analysis ready for ${ticker}.`);
    } catch (error) {
        clearInterval(timerInterval);
        if (timerEl) timerEl.textContent = originalTitle;
        console.error(error);
        const message =
            error.name === 'AbortError'
                ? 'AI request timed out. Try again in a moment.'
                : error.message || 'AI analysis failed.';
        if (output) {
            output.innerHTML = `
                <span class="terminal-prompt terminal-warn">&gt; ${escapeHtml(message)}</span>
                <br>
                <button class="retry-btn" onclick="document.getElementById('execute-ai-btn').click()"><i class="fa-solid fa-rotate-right"></i> Retry Analysis</button>
            `;
        }
        showToast(message);
    } finally {
        isAiRunning = false;
        if (btn) btn.disabled = false;
    }
}

// ──────────────────────────────────────────
//  MULTI-FRAME (RUN ALL FRAMES)
// ──────────────────────────────────────────

async function executeAllFrames() {
    if (isAiRunning) return;

    const tickerInput = document.getElementById('ai-ticker-input');
    const output = document.getElementById('ai-terminal-output');
    const btn = document.getElementById('execute-ai-btn');
    const runAllBtn = document.getElementById('run-all-frames-btn');

    const ticker = tickerInput?.value.trim().toUpperCase();
    if (!ticker) {
        showToast('Enter a ticker symbol to run all frames.');
        return;
    }

    isAiRunning = true;
    if (btn) btn.disabled = true;
    if (runAllBtn) runAllBtn.disabled = true;
    hideFollowupBar();
    
    const pdfBtn = document.getElementById('ai-pdf-btn');
    if (pdfBtn) pdfBtn.style.display = 'none';

    // Initialize multi-frame state
    currentMultiFrameResults = {};
    activeMultiFrameTab = null;

    // Show tab bar
    const tabBar = document.getElementById('ai-tab-bar');
    if (tabBar) {
        tabBar.classList.remove('hidden-element');
        tabBar.innerHTML = ALL_FRAME_KEYS.map(key => 
            `<button class="ai-tab-btn loading" data-frame="${key}">${FRAME_LABELS[key]}</button>`
        ).join('');

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

    const startTime = Date.now();
    const timerEl = document.querySelector('.terminal-title');
    const originalTitle = timerEl?.textContent || '';
    const timerInterval = setInterval(() => {
        if (timerEl) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            timerEl.textContent = `${originalTitle}  ⏱ ${elapsed}s`;
        }
    }, 100);

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
                    frameLabel: FRAME_LABELS[frameKey],
                    modelName: data.model || data.provider || 'STRATA Engine',
                    provider: data.provider,
                    model: data.model,
                };

                // Render data context from first successful response
                if (!firstContextRendered) {
                    renderDataContext(data);
                    firstContextRendered = true;
                }

                // Update tab state
                const tab = tabBar?.querySelector(`[data-frame="${frameKey}"]`);
                if (tab) {
                    tab.classList.remove('loading');
                    tab.classList.add('done');
                }

                completedCount++;

                // Auto-select first completed tab
                if (completedCount === 1) {
                    switchTab(frameKey);
                }
            }
        } catch (err) {
            console.warn(`Frame ${frameKey} failed:`, err.message);
            const tab = tabBar?.querySelector(`[data-frame="${frameKey}"]`);
            if (tab) {
                tab.classList.remove('loading');
                tab.style.color = '#ef4444';
                tab.title = 'Failed';
            }
        }
    }

    clearInterval(timerInterval);
    if (timerEl) timerEl.textContent = originalTitle;

    if (completedCount > 0) {
        showFollowupBar();
        showToast(`Completed ${completedCount}/${ALL_FRAME_KEYS.length} frames for ${ticker}.`);
        updateTimestamp();

        // Set up PDF with current active tab
        const activeResult = currentMultiFrameResults[activeMultiFrameTab];
        if (activeResult) {
            window.currentAiReport = {
                ticker: escapeHtml(ticker),
                frameLabel: escapeHtml(activeResult.frameLabel),
                modelName: escapeHtml(activeResult.modelName),
                analysisHtml: activeResult.analysisHtml,
            };
            if (pdfBtn) pdfBtn.style.display = 'inline-flex';
        }
    } else {
        if (output) {
            output.innerHTML = `<span class="terminal-prompt terminal-warn">&gt; All frames failed for ${escapeHtml(ticker)}. Check your connection and try again.</span>`;
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

    // Update tab active state
    tabBar.querySelectorAll('.ai-tab-btn').forEach(t => t.classList.remove('active'));
    const activeTab = tabBar.querySelector(`[data-frame="${frameKey}"]`);
    if (activeTab) activeTab.classList.add('active');

    // Render content
    output.innerHTML = `
        <span class="terminal-prompt terminal-success">&gt; ${escapeHtml(result.frameLabel)}${result.provider ? ` [${escapeHtml(result.provider)}]` : ''}</span>
        <div class="ai-analysis-text fade-in">${result.analysisHtml}</div>
        <span class="terminal-prompt terminal-warn">&gt; Educational use only. Not financial advice.</span>
    `;

    updateWordCount(result.analysisHtml);

    // Update PDF report data
    const tickerInput = document.getElementById('ai-ticker-input');
    const ticker = tickerInput?.value.trim().toUpperCase() || '';
    window.currentAiReport = {
        ticker: escapeHtml(ticker),
        frameLabel: escapeHtml(result.frameLabel),
        modelName: escapeHtml(result.modelName),
        analysisHtml: result.analysisHtml,
    };
}

// ──────────────────────────────────────────
//  FOLLOW-UP QUESTIONS
// ──────────────────────────────────────────

async function sendFollowup() {
    if (isAiRunning) return;

    const followupInput = document.getElementById('ai-followup-input');
    const question = followupInput?.value.trim();
    if (!question) return;

    const report = window.currentAiReport;
    if (!report) {
        showToast('Run an analysis first before asking a follow-up.');
        return;
    }

    isAiRunning = true;
    const followupBtn = document.getElementById('ai-followup-btn');
    if (followupBtn) followupBtn.disabled = true;

    const output = document.getElementById('ai-terminal-output');

    // Append question to terminal
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
        // Strip HTML tags from previous analysis for context
        const plainAnalysis = report.analysisHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

        const response = await fetchWithTimeout(`${BACKEND_URL}/api/ai/followup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ticker: report.ticker,
                previousAnalysis: plainAnalysis.substring(0, 3000), // Limit context size
                question,
            }),
            timeout: 60000,
        });

        const data = await safeJsonParse(response);

        if (!response.ok) {
            throw new Error(data?.error || 'Follow-up failed.');
        }

        const answerHtml = formatAiOutput(data.analysis);

        // Replace the typing indicator with the answer
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

// ──────────────────────────────────────────
//  PDF EXPORT
// ──────────────────────────────────────────

async function exportAiPdf() {
    const btn = document.getElementById('ai-pdf-btn');

    if (!window.html2pdf) {
        showToast('PDF library is still loading...');
        return;
    }
    const report = window.currentAiReport;
    if (!report) {
        showToast('No report data found. Please run analysis first.');
        return;
    }

    const reportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const reportTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const reportId = `STR-${report.ticker}-${Date.now().toString(36).toUpperCase()}`;

    const opt = {
        margin:       [12, 10, 18, 10],
        filename:     `STRATA_${report.ticker}_${report.frameLabel.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, logging: false, windowWidth: 800 },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
    };

    const sourceHtml = `
        <div style="font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.65; background: #ffffff;">
            <style>
                * { box-sizing: border-box; }

                /* ── HEADER BAR ── */
                .sr-header {
                    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
                    color: #ffffff;
                    padding: 28px 36px 24px;
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-end;
                    border-bottom: 3px solid #3b82f6;
                }
                .sr-brand h1 {
                    margin: 0;
                    font-size: 32px;
                    font-weight: 800;
                    letter-spacing: 3px;
                    color: #ffffff;
                }
                .sr-brand p {
                    margin: 4px 0 0;
                    font-size: 9px;
                    text-transform: uppercase;
                    letter-spacing: 2px;
                    color: #94a3b8;
                }
                .sr-header-right {
                    text-align: right;
                }
                .sr-header-right .sr-doc-type {
                    margin: 0;
                    font-size: 11px;
                    font-weight: 700;
                    letter-spacing: 1.5px;
                    text-transform: uppercase;
                    color: #60a5fa;
                }
                .sr-header-right .sr-doc-date {
                    margin: 4px 0 0;
                    font-size: 9px;
                    color: #94a3b8;
                }

                /* ── CLASSIFICATION BADGE ── */
                .sr-classification {
                    background: #eff6ff;
                    border: 1px solid #bfdbfe;
                    padding: 6px 16px;
                    text-align: center;
                    font-size: 8px;
                    font-weight: 700;
                    letter-spacing: 2px;
                    text-transform: uppercase;
                    color: #3b82f6;
                }

                /* ── CONTENT WRAPPER ── */
                .sr-content { padding: 28px 36px; }

                /* ── METADATA STRIP ── */
                .sr-meta-strip {
                    display: flex;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    overflow: hidden;
                    margin-bottom: 24px;
                }
                .sr-meta-item {
                    flex: 1;
                    padding: 14px 16px;
                    border-right: 1px solid #e2e8f0;
                }
                .sr-meta-item:last-child { border-right: none; }
                .sr-meta-label {
                    font-size: 8px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 1.5px;
                    color: #64748b;
                    margin: 0 0 4px;
                }
                .sr-meta-value {
                    font-size: 13px;
                    font-weight: 600;
                    color: #0f172a;
                    margin: 0;
                    font-family: 'Segoe UI', monospace;
                }

                /* ── EXECUTIVE SUMMARY BAR ── */
                .sr-exec-bar {
                    background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
                    border-left: 4px solid #3b82f6;
                    border-radius: 0 8px 8px 0;
                    padding: 14px 20px;
                    margin-bottom: 28px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .sr-exec-bar .badge {
                    background: #3b82f6;
                    color: white;
                    font-size: 8px;
                    font-weight: 700;
                    letter-spacing: 1px;
                    padding: 3px 10px;
                    border-radius: 4px;
                    text-transform: uppercase;
                    white-space: nowrap;
                }
                .sr-exec-bar .text {
                    font-size: 11px;
                    color: #334155;
                    line-height: 1.4;
                }

                /* ── SECTION DIVIDER ── */
                .sr-section-divider {
                    border: none;
                    border-top: 1px solid #e2e8f0;
                    margin: 24px 0;
                }

                /* ── ANALYSIS BODY ── */
                .sr-body {
                    font-size: 12px;
                    color: #334155;
                    line-height: 1.75;
                }
                .sr-body strong { color: #0f172a; }
                .sr-body strong.terminal-heading {
                    display: block;
                    font-size: 14px;
                    font-weight: 700;
                    color: #0f172a;
                    margin: 22px 0 10px;
                    padding: 8px 0 6px;
                    border-bottom: 2px solid #3b82f6;
                    letter-spacing: 0.3px;
                }
                .sr-body p { margin: 8px 0; }
                .sr-body .terminal-bullet {
                    display: block;
                    margin: 5px 0 5px 16px;
                    padding-left: 4px;
                    position: relative;
                }
                .sr-body .terminal-bullet.nested {
                    margin-left: 32px;
                    color: #64748b;
                }
                .sr-body .terminal-bullet .bullet-num {
                    color: #3b82f6;
                    font-weight: 700;
                }

                /* Tables */
                .sr-body .terminal-table-wrapper {
                    border: 1px solid #cbd5e1;
                    border-radius: 8px;
                    margin: 18px 0;
                    overflow: hidden;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                }
                .sr-body .terminal-parsed-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 11px;
                    color: #334155;
                    font-family: 'Segoe UI', sans-serif;
                }
                .sr-body .terminal-parsed-table th {
                    background: linear-gradient(180deg, #f8fafc, #f1f5f9);
                    color: #0f172a;
                    font-weight: 700;
                    padding: 10px 14px;
                    border-bottom: 2px solid #cbd5e1;
                    text-align: left;
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .sr-body .terminal-parsed-table td {
                    padding: 9px 14px;
                    border-bottom: 1px solid #e2e8f0;
                }
                .sr-body .terminal-parsed-table tr:last-child td { border-bottom: none; }
                .sr-body .terminal-parsed-table tr:nth-child(even) { background: #f8fafc; }

                /* Code blocks */
                .sr-body .terminal-code-block {
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 6px;
                    margin: 12px 0;
                }
                .sr-body .terminal-code-block pre {
                    margin: 0;
                    padding: 12px 16px;
                    font-family: 'Consolas', 'Courier New', monospace;
                    font-size: 10px;
                    color: #334155;
                    white-space: pre-wrap;
                }

                /* ── FOOTER ── */
                .sr-footer {
                    background: #f8fafc;
                    border-top: 2px solid #e2e8f0;
                    padding: 20px 36px;
                    margin-top: 40px;
                }
                .sr-footer-grid {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 14px;
                }
                .sr-footer-brand {
                    font-size: 14px;
                    font-weight: 800;
                    letter-spacing: 2px;
                    color: #94a3b8;
                }
                .sr-footer-id {
                    font-size: 8px;
                    color: #94a3b8;
                    font-family: monospace;
                    text-align: right;
                }
                .sr-disclaimer {
                    font-size: 7.5px;
                    color: #94a3b8;
                    line-height: 1.5;
                    text-align: justify;
                    border-top: 1px solid #e2e8f0;
                    padding-top: 12px;
                }
            </style>

            <!-- ▌ HEADER BAR ▌ -->
            <div class="sr-header">
                <div class="sr-brand">
                    <h1>STRATA</h1>
                    <p>Algorithmic Equity Research Platform</p>
                </div>
                <div class="sr-header-right">
                    <p class="sr-doc-type">Quantitative Analysis Report</p>
                    <p class="sr-doc-date">${reportDate} · ${reportTime}</p>
                </div>
            </div>

            <!-- ▌ CLASSIFICATION ▌ -->
            <div class="sr-classification">
                For Educational &amp; Informational Purposes Only — Not Investment Advice
            </div>

            <!-- ▌ CONTENT ▌ -->
            <div class="sr-content">

                <!-- Metadata Strip -->
                <div class="sr-meta-strip">
                    <div class="sr-meta-item">
                        <p class="sr-meta-label">Asset Ticker</p>
                        <p class="sr-meta-value">${report.ticker}</p>
                    </div>
                    <div class="sr-meta-item">
                        <p class="sr-meta-label">Analytical Frame</p>
                        <p class="sr-meta-value">${report.frameLabel}</p>
                    </div>
                    <div class="sr-meta-item">
                        <p class="sr-meta-label">Quant Model</p>
                        <p class="sr-meta-value">${report.modelName}</p>
                    </div>
                    <div class="sr-meta-item">
                        <p class="sr-meta-label">Report ID</p>
                        <p class="sr-meta-value" style="font-family: monospace; font-size: 10px;">${reportId}</p>
                    </div>
                </div>

                <!-- Executive Summary Bar -->
                <div class="sr-exec-bar">
                    <span class="badge">Analysis</span>
                    <span class="text">This report was generated by STRATA's quantitative engine using the <strong>${report.frameLabel}</strong> framework applied to <strong>${report.ticker}</strong>. All metrics are derived from publicly available financial data feeds.</span>
                </div>

                <hr class="sr-section-divider">

                <!-- Analysis Body -->
                <div class="sr-body">
                    ${report.analysisHtml}
                </div>

            </div>

            <!-- ▌ FOOTER ▌ -->
            <div class="sr-footer">
                <div class="sr-footer-grid">
                    <span class="sr-footer-brand">STRATA</span>
                    <span class="sr-footer-id">Report ID: ${reportId}<br>Generated: ${reportDate} ${reportTime}</span>
                </div>
                <div class="sr-disclaimer">
                    <strong>DISCLAIMER:</strong> This report is generated by the STRATA Algorithmic Equity Research Platform for educational and informational purposes only. It does not constitute financial advice, investment recommendation, or an offer to buy or sell securities. All quantitative analyses, scores, and projections are mathematical approximations derived from publicly available financial data and should not be relied upon for investment decisions. Past performance does not guarantee future results. Users should consult with a qualified financial advisor before making any investment decisions. STRATA, its developers, and affiliates assume no liability for any financial losses incurred from use of this report. Data sources include Finnhub, TwelveData, and Financial Modeling Prep. Model outputs are generated via third-party AI inference providers and may contain inaccuracies.
                </div>
            </div>
        </div>
    `;

    let originalText = '';
    if (btn) {
        originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...';
        btn.disabled = true;
    }
    
    try {
        await window.html2pdf().set(opt).from(sourceHtml).save();
        showToast('PDF downloaded successfully.');
    } catch (err) {
        console.error("PDF generation failed:", err);
        showToast('PDF generation failed. Please try again.');
    } finally {
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}
