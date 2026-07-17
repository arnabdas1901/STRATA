export const BACKEND_URL = (() => {
    const origin = window.location.origin;
    // If opened via file:// protocol, always target localhost:3000
    if (window.location.protocol === 'file:' || origin === 'null') {
        return 'http://localhost:3000';
    }
    // If on localhost/127.0.0.1 but NOT on the backend port, redirect API calls to port 3000
    const host = window.location.hostname;
    if ((host === 'localhost' || host === '127.0.0.1') && window.location.port !== '3000') {
        return 'http://localhost:3000';
    }
    // Production or same-port: use the current origin
    return origin;
})();

const requestCache = new Map();
const inFlightRequests = new Map();

function getCacheKey(resource, options = {}) {
    const url = typeof resource === 'string' ? resource : resource.url;
    const method = (options.method || 'GET').toUpperCase();
    return `${method}:${url}`;
}

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
    const { timeout = 8000, cache = false, cacheTtl = 30000 } = options;
    const key = getCacheKey(resource, options);

    if (cache && requestCache.has(key)) {
        return requestCache.get(key);
    }

    if (cache && inFlightRequests.has(key)) {
        return inFlightRequests.get(key);
    }

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const requestPromise = fetch(resource, {
        ...options,
        signal: controller.signal
    }).then((response) => {
        clearTimeout(id);
        if (cache) {
            requestCache.set(key, response);
            setTimeout(() => {
                requestCache.delete(key);
            }, cacheTtl);
        }
        return response;
    }).catch((error) => {
        clearTimeout(id);
        throw error;
    }).finally(() => {
        inFlightRequests.delete(key);
    });

    inFlightRequests.set(key, requestPromise);
    return requestPromise;
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

export function normalizeForexPair(value) {
    const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
    const slashMatch = raw.match(/^([A-Z]{3})\/([A-Z]{3})$/);
    if (slashMatch) {
        const [_, from, to] = slashMatch;
        if (from === to) return null;
        return `${from}/${to}`;
    }
    if (/^[A-Z]{6}$/.test(raw)) {
        const from = raw.slice(0, 3);
        const to = raw.slice(3, 6);
        if (from === to) return null;
        return `${from}/${to}`;
    }
    return null;
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
