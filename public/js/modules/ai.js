import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast, escapeHtml } from '../utils.js';

let isAiRunning = false;

function formatAiOutput(text) {
    if (!text) return '';
    
    // 1. Parse and extract tables to placeholders
    const tables = [];
    let textWithPlaceholders = parseMarkdownTables(String(text), (tableHtml) => {
        const placeholder = `__TABLE_PLACEHOLDER_${tables.length}__`;
        tables.push(tableHtml);
        return placeholder;
    });

    // 2. Escape HTML for safety (ignoring placeholders since they contain no HTML symbols)
    let safe = textWithPlaceholders
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    // Convert **bold** to <strong>
    safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Convert bullet points (lines starting with -, •, or *)
    safe = safe.replace(/^[\-•*]\s+(.+)$/gm, '<span class="terminal-bullet">• $1</span>');
    // Convert headings (#, ##, ###, etc.)
    safe = safe.replace(/^#{1,4}\s+(.+)$/gm, '<strong class="terminal-heading">$1</strong>');
    // Convert double newlines to paragraph breaks, single to <br>
    safe = safe.replace(/\n\n/g, '</p><p>');
    safe = safe.replace(/\n/g, '<br>');
    
    let finalHtml = '<p>' + safe + '</p>';

    // 3. Inject tables back, stripping any wrapping <p> tag
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
    let html = '<div class="terminal-table-wrapper"><table class="terminal-parsed-table"><thead><tr>';
    headers.forEach(h => {
        html += `<th>${h}</th>`;
    });
    html += '</tr></thead><tbody>';
    rows.forEach(row => {
        html += '<tr>';
        row.forEach(cell => {
            html += `<td>${cell}</td>`;
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
    const logInterval = setInterval(() => {
        if (output && currentStep < logSteps.length) {
            output.innerHTML += `<br><span class="terminal-prompt">${logSteps[currentStep]}</span>`;
            output.scrollTop = output.scrollHeight;
            currentStep++;
        } else {
            clearInterval(logInterval);
        }
    }, 400);

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/ai/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker, frame }),
            timeout: 90000,
        });

        clearInterval(logInterval);

        const data = await safeJsonParse(response);

        if (!response.ok) {
            throw new Error(data?.error || 'AI analysis failed.');
        }

        if (output) {
            const providerNote = data.provider
                ? ` [${escapeHtml(data.provider)}${data.model ? ` / ${escapeHtml(data.model)}` : ''}]`
                : '';
            const analysisHtml = formatAiOutput(data.analysis);
            output.innerHTML = `
                <span class="terminal-prompt terminal-success">&gt; Scan complete: ${escapeHtml(ticker)} — ${escapeHtml(frameLabel)}${providerNote}</span>
                <div class="ai-analysis-text">${analysisHtml}</div>
                <span class="terminal-prompt terminal-warn">&gt; Educational use only. Not financial advice.</span>
            `;

            // Cache data for clean branded PDF report
            window.currentAiReport = {
                ticker: escapeHtml(ticker),
                frameLabel: escapeHtml(frameLabel),
                modelName: escapeHtml(data.model || data.provider || 'STRATA Engine'),
                analysisHtml: analysisHtml
            };
        }
        
        if (pdfBtn) pdfBtn.style.display = 'inline-flex';
        
        showToast(`AI analysis ready for ${ticker}.`);
    } catch (error) {
        clearInterval(logInterval);
        console.error(error);
        const message =
            error.name === 'AbortError'
                ? 'AI request timed out. Try again in a moment.'
                : error.message || 'AI analysis failed.';
        if (output) {
            output.innerHTML = `<span class="terminal-prompt terminal-warn">&gt; ${escapeHtml(message)}</span>`;
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

    // Programmatic white-background branded memo container
    const element = document.createElement('div');
    element.style.position = 'absolute';
    element.style.left = '-9999px';
    element.style.top = '-9999px';
    element.style.width = '700px';
    element.style.background = '#ffffff';

    element.innerHTML = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937; padding: 40px; line-height: 1.6;">
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

    // Strict style sheet to layout markdown parser HTML neatly on white background
    const styleTag = document.createElement('style');
    styleTag.innerHTML = `
        .strata-pdf-body strong { color: #111827; }
        .strata-pdf-body h3, .strata-pdf-body strong.terminal-heading { display: block; font-size: 14px; color: #111827; margin: 18px 0 8px 0; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; font-weight: bold; }
        .strata-pdf-body p { margin: 8px 0; }
        .strata-pdf-body .terminal-bullet { display: block; margin: 4px 0 4px 12px; }
        .strata-pdf-body .terminal-table-wrapper { border: 1px solid #d1d5db; border-radius: 6px; margin: 16px 0; background: #fafafa; overflow: hidden; }
        .strata-pdf-body .terminal-parsed-table { width: 100%; border-collapse: collapse; font-size: 11px; color: #374151; font-family: monospace; }
        .strata-pdf-body .terminal-parsed-table th { background: #f3f4f6; color: #111827; font-weight: bold; padding: 8px; border-bottom: 1px solid #d1d5db; text-align: left; }
        .strata-pdf-body .terminal-parsed-table td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
        .strata-pdf-body .terminal-parsed-table tr:last-child td { border-bottom: none; }
    `;
    element.appendChild(styleTag);
    document.body.appendChild(element);

    const opt = {
        margin:       10,
        filename:     `STRATA_AI_Analysis_${report.ticker}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, logging: false },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    
    const btn = document.getElementById('ai-pdf-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...';
    
    try {
        await window.html2pdf().set(opt).from(element).save();
    } catch (err) {
        console.error("PDF generation failed:", err);
    } finally {
        document.body.removeChild(element);
        btn.innerHTML = originalText;
    }
}
