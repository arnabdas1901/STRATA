const normalizeTicker = (value) => {
    const ticker = String(value || '').trim().toUpperCase();
    return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) ? ticker : null;
};

const normalizeCryptoQuery = (value) => {
    const query = String(value || '').trim();
    return /^[A-Za-z0-9 ._-]{1,64}$/.test(query) ? query : null;
};

const normalizeForexPair = (value) => {
    const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!raw) return null;
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
};

const requireTicker = (req, res) => {
    const symbol = normalizeTicker(req.query.symbol ?? req.body?.ticker ?? req.body?.symbol);
    if (!symbol) {
        res.status(400).json({ error: 'Valid ticker symbol is required' });
        return null;
    }
    return symbol;
};

const parseMarketNumber = (value) => {
    if (value == null || value === '') return null;
    const parsed = Number(String(value).replace(/[%,$]/g, '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
};

async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.text();
    try {
        return { response, data: JSON.parse(data) };
    } catch (error) {
        return { response, data: null };
    }
}

module.exports = {
    normalizeTicker,
    normalizeCryptoQuery,
    normalizeForexPair,
    requireTicker,
    parseMarketNumber,
    fetchJson
}