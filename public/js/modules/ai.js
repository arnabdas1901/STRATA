import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast, escapeHtml } from '../utils.js';

let isAiRunning = false;

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

    renderHistoryStrip();
}

function getAnalysisHistory() {
    try {
        return JSON.parse(sessionStorage.getItem('strata_ai_history') || '[]');
    } catch { return []; }
}

function saveToHistory(entry) {
    const history = getAnalysisHistory();
    // Remove duplicate if exists
    const filtered = history.filter(h => !(h.ticker === entry.ticker && h.frame === entry.frame));
    filtered.unshift(entry);
    // Keep last 5
    sessionStorage.setItem('strata_ai_history', JSON.stringify(filtered.slice(0, 5)));
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
        <div class="history-strip-header"><i class="fa-solid fa-clock-rotate-left"></i> Recent Scans</div>
        <div class="history-pills">
            ${history.map((h, i) => `<button class="history-pill" data-index="${i}"><span class="pill-ticker">${h.ticker}</span><span class="pill-frame">${h.frameLabel}</span></button>`).join('')}
        </div>
    `;
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
        });
    });
}

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

    const frameLabel = frameSelect?.selectedOptions?.[0]?.textContent || frame;
    
    // Boot sequence simulated logs
    const logSteps = [
        `> Securing outbound connection protocol… OK`,
        `> Querying Finnhub sector ticker registries for ${escapeHtml(ticker)}… OK`,
        `> Constructing quant prompt payload matrix… OK`,
        `> Querying SEC financial statements & cash flows… OK`,
        `> Routing request to core LLM inference cluster… OK`,
        `> Streaming intelligence tokens…`
    ];

    if (output) {
        output.innerHTML = `<span class="terminal-prompt terminal-accent">&gt; Initializing STRATA Quant Engine v4.0.1 on ${escapeHtml(ticker)}…</span>`;
    }

    let currentStep = 0;
    let bootComplete = false;
    const logInterval = setInterval(() => {
        if (output && currentStep < logSteps.length) {
            output.innerHTML += `<br><span class="terminal-prompt">${logSteps[currentStep]}</span>`;
            output.scrollTop = output.scrollHeight;
            currentStep++;
        } else {
            bootComplete = true;
            clearInterval(logInterval);
        }
    }, 400);

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

        // Flush remaining boot steps instantly if API responded early
        clearInterval(logInterval);
        if (!bootComplete && output) {
            while (currentStep < logSteps.length) {
                output.innerHTML += `<br><span class="terminal-prompt">${logSteps[currentStep]}</span>`;
                currentStep++;
            }
        }

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

        if (output) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const providerNote = data.provider
                ? ` [${escapeHtml(data.provider)}${data.model ? ` / ${escapeHtml(data.model)}` : ''}]`
                : '';
            const cachedNote = data.cached ? ' <span class="terminal-accent">(cached)</span>' : '';
            const analysisHtml = formatAiOutput(data.analysis);
            output.innerHTML = `
                <span class="terminal-prompt terminal-success">&gt; Scan complete in ${elapsed}s: ${escapeHtml(ticker)} — ${escapeHtml(frameLabel)}${providerNote}${cachedNote}</span>
                <div class="ai-analysis-text">${analysisHtml}</div>
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
        }
        
        if (pdfBtn) pdfBtn.style.display = 'inline-flex';
        
        showToast(`AI analysis ready for ${ticker}.`);
    } catch (error) {
        clearInterval(logInterval);
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

async function exportAiPdf() {
    if (!window.html2pdf) {
        import('../utils.js').then(({ showToast }) => showToast('PDF library is still loading...'));
        return;
    }
    const report = window.currentAiReport;
    if (!report) {
        import('../utils.js').then(({ showToast }) => showToast('No report data found. Please run analysis first.'));
        return;
    }

    const opt = {
        margin:       10,
        filename:     `STRATA_AI_Analysis_${report.ticker}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, logging: false, windowWidth: 800 },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    const sourceHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937; padding: 40px; line-height: 1.6; background: #ffffff;">
            <style>
                .strata-pdf-body strong { color: #111827; }
                .strata-pdf-body h3, .strata-pdf-body strong.terminal-heading { display: block; font-size: 14px; color: #111827; margin: 18px 0 8px 0; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; font-weight: bold; }
                .strata-pdf-body p { margin: 8px 0; }
                .strata-pdf-body .terminal-bullet { display: block; margin: 4px 0 4px 12px; }
                .strata-pdf-body .terminal-table-wrapper { border: 1px solid #d1d5db; border-radius: 6px; margin: 16px 0; background: #fafafa; overflow: hidden; }
                .strata-pdf-body .terminal-parsed-table { width: 100%; border-collapse: collapse; font-size: 11px; color: #374151; font-family: monospace; }
                .strata-pdf-body .terminal-parsed-table th { background: #f3f4f6; color: #111827; font-weight: bold; padding: 8px; border-bottom: 1px solid #d1d5db; text-align: left; }
                .strata-pdf-body .terminal-parsed-table td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
                .strata-pdf-body .terminal-parsed-table tr:last-child td { border-bottom: none; }
            </style>

            <!-- Header -->
            <div style="border-bottom: 2px solid #111827; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end;">
                <div>
                    <h1 style="margin: 0; font-size: 28px; color: #111827; font-weight: 800; letter-spacing: 0.5px;">STRATA</h1>
                    <p style="margin: 4px 0 0 0; font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 1.5px;">Institutional Equity Intelligence</p>
                </div>
                <div style="text-align: right;">
                    <p style="margin: 0; font-size: 12px; font-weight: bold; color: #111827;">QUANT ANALYSIS REPORT</p>
                    <p style="margin: 4px 0 0 0; font-size: 10px; color: #6b7280;">Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
            </div>
            
            <!-- Metadata Grid -->
            <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin-bottom: 24px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; font-size: 12px; border-left: 4px solid #3b82f6;">
                <div><strong>Asset Ticker:</strong> <span style="font-family: monospace; font-size: 13px;">${report.ticker}</span></div>
                <div><strong>Analysis Frame:</strong> ${report.frameLabel}</div>
                <div><strong>Quant Model:</strong> ${report.modelName}</div>
            </div>

            <!-- Report Body -->
            <div class="strata-pdf-body" style="font-size: 13px; color: #374151;">
                ${report.analysisHtml}
            </div>

            <!-- Footer -->
            <div style="margin-top: 48px; border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 9px; color: #9ca3af; text-align: center; line-height: 1.4;">
                STRATA core_analysis_stream (v4.0.1). Educational use only. Not financial or investment advice.<br>
                All calculations represent mathematical approximations derived from public filings.
            </div>
        </div>
    `;

    const btn = document.getElementById('ai-pdf-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...';
    
    try {
        await window.html2pdf().set(opt).from(sourceHtml).save();
    } catch (err) {
        console.error("PDF generation failed:", err);
        import('../utils.js').then(({ showToast }) => showToast('PDF generation failed. Please try again.'));
    } finally {
        btn.innerHTML = originalText;
    }
}
