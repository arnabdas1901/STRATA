export const BACKEND_URL = window.location.origin.includes('localhost') 
    ? 'http://localhost:3000' 
    : window.location.origin;

export function setupTabs(containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    const tabBtns = container.querySelectorAll('.panel-tab-btn');
    const tabPanels = container.querySelectorAll('.tab-panel');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active-panel'));

            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            container.querySelector(`#${targetId}`)?.classList.add('active-panel');
        });
    });
}

export async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 8000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(resource, {
        ...options,
        signal: controller.signal  
    });
    clearTimeout(id);
    return response;
}

export async function safeJsonParse(response) {
    if (!response) return null;
    try {
        const text = await response.text();
        return text ? JSON.parse(text) : null;
    } catch (e) {
        return { error: 'Invalid server response' };
    }
}

export function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function formatLargeCurrency(value) {
    if (value == null) return 'N/A';
    const num = Number(value);
    if (isNaN(num)) return 'N/A';
    const absNum = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    if (absNum >= 1e12) return `${sign}$${(absNum / 1e12).toFixed(2)}T`;
    if (absNum >= 1e9) return `${sign}$${(absNum / 1e9).toFixed(2)}B`;
    if (absNum >= 1e6) return `${sign}$${(absNum / 1e6).toFixed(2)}M`;
    return `${sign}$${absNum.toLocaleString('en-US')}`;
}

export function showToast(message) {
    const toast = document.getElementById('global-toast-notification');
    if (!toast) return;
    toast.innerText = message;
    toast.classList.remove('hidden-toast');
    setTimeout(() => { toast.classList.add('hidden-toast'); }, 3000);
}
