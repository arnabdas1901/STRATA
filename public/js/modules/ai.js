import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast, escapeHtml } from '../utils.js';

let isAiRunning = false;

function formatAiOutput(text) {
    if (!text) return '';
    // Escape HTML first for safety
    let safe = String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    // Convert **bold** to <strong>
    safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Convert bullet points (lines starting with - or •)
    safe = safe.replace(/^[\-•]\s+(.+)$/gm, '<span class="terminal-bullet">• $1</span>');
    // Convert ### headings
    safe = safe.replace(/^###?\s+(.+)$/gm, '<strong class="terminal-heading">$1</strong>');
    // Convert double newlines to paragraph breaks, single to <br>
    safe = safe.replace(/\n\n/g, '</p><p>');
    safe = safe.replace(/\n/g, '<br>');
    return '<p>' + safe + '</p>';
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

    const frameLabel = frameSelect?.selectedOptions?.[0]?.textContent || frame;
    if (output) {
        output.innerHTML = `<span class="terminal-prompt terminal-accent">&gt; Running ${escapeHtml(frameLabel)} on ${escapeHtml(ticker)}…</span>`;
    }

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/ai/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker, frame }),
            timeout: 90000,
        });

        const data = await safeJsonParse(response);

        if (!response.ok) {
            throw new Error(data?.error || 'AI analysis failed.');
        }

        if (output) {
            const providerNote = data.provider
                ? ` [${escapeHtml(data.provider)}${data.model ? ` / ${escapeHtml(data.model)}` : ''}]`
                : '';
            output.innerHTML = `
                <span class="terminal-prompt terminal-success">&gt; Scan complete: ${escapeHtml(ticker)} — ${escapeHtml(frameLabel)}${providerNote}</span>
                <div class="ai-analysis-text">${formatAiOutput(data.analysis)}</div>
                <span class="terminal-prompt terminal-warn">&gt; Educational use only. Not financial advice.</span>
            `;
        }
        showToast(`AI analysis ready for ${ticker}.`);
    } catch (error) {
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
