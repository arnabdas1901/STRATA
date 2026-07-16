import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast } from '../utils.js';

let macroChartInstance = null;
let globalCountryMap = [];

// ── Country Metadata Registry ──────────────────────────────────────────────────
// Maps ISO 3166-1 alpha-2 codes to emoji flags and central bank names.
// Used by the search handler to resolve proper metadata for any country.
const COUNTRY_META = {
    US: { flag: '🇺🇸', bank: 'Federal Reserve' },
    GB: { flag: '🇬🇧', bank: 'Bank of England' },
    DE: { flag: '🇩🇪', bank: 'Bundesbank / ECB' },
    FR: { flag: '🇫🇷', bank: 'Banque de France / ECB' },
    JP: { flag: '🇯🇵', bank: 'Bank of Japan' },
    CN: { flag: '🇨🇳', bank: "People's Bank of China" },
    IN: { flag: '🇮🇳', bank: 'Reserve Bank of India' },
    BR: { flag: '🇧🇷', bank: 'Banco Central do Brasil' },
    CA: { flag: '🇨🇦', bank: 'Bank of Canada' },
    AU: { flag: '🇦🇺', bank: 'Reserve Bank of Australia' },
    KR: { flag: '🇰🇷', bank: 'Bank of Korea' },
    MX: { flag: '🇲🇽', bank: 'Banco de México' },
    ID: { flag: '🇮🇩', bank: 'Bank Indonesia' },
    TR: { flag: '🇹🇷', bank: 'Central Bank of Türkiye' },
    SA: { flag: '🇸🇦', bank: 'Saudi Central Bank' },
    CH: { flag: '🇨🇭', bank: 'Swiss National Bank' },
    AR: { flag: '🇦🇷', bank: 'Banco Central de Argentina' },
    ZA: { flag: '🇿🇦', bank: 'South African Reserve Bank' },
    RU: { flag: '🇷🇺', bank: 'Central Bank of Russia' },
    IT: { flag: '🇮🇹', bank: "Banca d'Italia / ECB" },
    ES: { flag: '🇪🇸', bank: 'Banco de España / ECB' },
    NG: { flag: '🇳🇬', bank: 'Central Bank of Nigeria' },
    EG: { flag: '🇪🇬', bank: 'Central Bank of Egypt' },
    PK: { flag: '🇵🇰', bank: 'State Bank of Pakistan' },
    BD: { flag: '🇧🇩', bank: 'Bangladesh Bank' },
    TH: { flag: '🇹🇭', bank: 'Bank of Thailand' },
    VN: { flag: '🇻🇳', bank: 'State Bank of Vietnam' },
    PH: { flag: '🇵🇭', bank: 'Bangko Sentral ng Pilipinas' },
    MY: { flag: '🇲🇾', bank: 'Bank Negara Malaysia' },
    SG: { flag: '🇸🇬', bank: 'Monetary Authority of Singapore' },
    NZ: { flag: '🇳🇿', bank: 'Reserve Bank of New Zealand' },
    SE: { flag: '🇸🇪', bank: 'Sveriges Riksbank' },
    NO: { flag: '🇳🇴', bank: 'Norges Bank' },
    DK: { flag: '🇩🇰', bank: 'Danmarks Nationalbank' },
    PL: { flag: '🇵🇱', bank: 'National Bank of Poland' },
    CL: { flag: '🇨🇱', bank: 'Banco Central de Chile' },
    CO: { flag: '🇨🇴', bank: 'Banco de la República' },
    PE: { flag: '🇵🇪', bank: 'Banco Central de Reserva del Perú' },
    IL: { flag: '🇮🇱', bank: 'Bank of Israel' },
    AE: { flag: '🇦🇪', bank: 'Central Bank of the UAE' },
    IE: { flag: '🇮🇪', bank: 'Central Bank of Ireland / ECB' },
    AT: { flag: '🇦🇹', bank: 'Oesterreichische Nationalbank / ECB' },
    BE: { flag: '🇧🇪', bank: 'National Bank of Belgium / ECB' },
    NL: { flag: '🇳🇱', bank: 'De Nederlandsche Bank / ECB' },
    PT: { flag: '🇵🇹', bank: 'Banco de Portugal / ECB' },
    GR: { flag: '🇬🇷', bank: 'Bank of Greece / ECB' },
    FI: { flag: '🇫🇮', bank: 'Bank of Finland / ECB' },
    CZ: { flag: '🇨🇿', bank: 'Czech National Bank' },
    HU: { flag: '🇭🇺', bank: 'Magyar Nemzeti Bank' },
    RO: { flag: '🇷🇴', bank: 'National Bank of Romania' },
    KE: { flag: '🇰🇪', bank: 'Central Bank of Kenya' },
    GH: { flag: '🇬🇭', bank: 'Bank of Ghana' },
    LK: { flag: '🇱🇰', bank: 'Central Bank of Sri Lanka' },
    TW: { flag: '🇹🇼', bank: 'Central Bank of the ROC' },
    CK: { flag: '🇨🇰', bank: 'Central Bank' },
};

/**
 * Resolves the flag emoji and central bank name for a World Bank country object.
 * Falls back to a generic globe emoji and "Central Bank" label.
 */
function resolveCountryMeta(countryObj) {
    const iso2 = countryObj?.iso2Code || '';
    const meta = COUNTRY_META[iso2];
    return {
        flag: meta?.flag || '🌍',
        bank: meta?.bank || 'Central Bank',
    };
}

// ── Entry Point ────────────────────────────────────────────────────────────────
export function setupInflationTracker() {
    const init = async () => {
        const isDetailsPage = window.location.pathname.includes('macro-details.html');

        try {
            const res = await fetch('https://api.worldbank.org/v2/country?format=json&per_page=300');
            const data = await safeJsonParse(res);
            if (data && data[1]) {
                globalCountryMap = data[1].filter(c => c.region.id !== 'NA');
            }
        } catch (e) {
            console.warn('Could not load World Bank country map', e);
        }

        setupSearch();

        if (isDetailsPage) {
            const params = new URLSearchParams(window.location.search);
            const code = params.get('code');
            const name = params.get('name');
            const flag = params.get('flag') || '🌍';
            const bank = params.get('bank') || 'Central Bank';

            if (code && name) {
                displayMacroDetails(code, name, flag, bank);
            } else {
                window.location.href = 'macro.html';
            }
        } else {
            loadMajorEconomies();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}

// ── Unified Search Handler ─────────────────────────────────────────────────────
// Shared by both the landing page and details page.
function setupSearch() {
    const searchBtn = document.getElementById('inflation-search-btn');
    const searchInput = document.getElementById('inflation-search-input');

    const handleSearch = () => {
        if (!searchInput) return;
        const query = searchInput.value.trim().toLowerCase();
        if (!query) {
            showToast('Enter a country name (e.g., Brazil, Canada).');
            return;
        }

        const country = globalCountryMap.find(c =>
            c.name.toLowerCase().includes(query) ||
            c.id.toLowerCase() === query ||
            c.iso2Code.toLowerCase() === query
        );

        if (!country) {
            showToast('Country not found in database. Try another name.');
            return;
        }

        const meta = resolveCountryMeta(country);
        window.location.href = `macro-details.html?code=${country.id}&name=${encodeURIComponent(country.name)}&flag=${encodeURIComponent(meta.flag)}&bank=${encodeURIComponent(meta.bank)}`;
    };

    if (searchBtn) searchBtn.addEventListener('click', handleSearch);
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSearch();
        });
    }
}

// ── World Bank Data Fetcher ────────────────────────────────────────────────────
async function fetchWorldBankIndicator(countryCode, indicator) {
    const url = `https://api.worldbank.org/v2/country/${countryCode}/indicator/${indicator}?format=json&per_page=20`;
    const res = await fetch(url);
    const data = await safeJsonParse(res);
    if (!data || !data[1] || !Array.isArray(data[1])) return null;
    return data[1];
}

// ── Landing Page: Major Economy Cards ──────────────────────────────────────────
async function loadMajorEconomies() {
    const grid = document.getElementById('macro-brackets-grid');
    if (!grid) return;

    const economies = [
        { code: 'US', name: 'United States', flag: '🇺🇸', bank: 'Federal Reserve' },
        { code: 'DE', name: 'Germany', flag: '🇩🇪', bank: 'Bundesbank / ECB' },
        { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', bank: 'Bank of England' },
        { code: 'JP', name: 'Japan', flag: '🇯🇵', bank: 'Bank of Japan' },
        { code: 'IN', name: 'India', flag: '🇮🇳', bank: 'Reserve Bank of India' },
        { code: 'CN', name: 'China', flag: '🇨🇳', bank: 'PBOC' }
    ];

    grid.innerHTML = '';
    for (const eco of economies) {
        const bracket = document.createElement('div');
        bracket.className = 'crypto-bracket-card';
        bracket.role = 'button';
        bracket.tabIndex = 0;
        bracket.innerHTML = `
            <div class="bracket-icon"><span style="font-size: 32px;">${eco.flag}</span></div>
            <div class="bracket-name">${eco.name}</div>
            <div class="bracket-symbol">${eco.bank}</div>
            <div class="bracket-price"><span class="pulse-text" style="color: var(--text-secondary-muted); font-size: 0.85rem;">Loading…</span></div>
            <div class="bracket-change">CPI (YoY)</div>
        `;
        grid.appendChild(bracket);

        const navigateToDetails = () => {
            window.location.href = `macro-details.html?code=${eco.code}&name=${encodeURIComponent(eco.name)}&flag=${encodeURIComponent(eco.flag)}&bank=${encodeURIComponent(eco.bank)}`;
        };
        bracket.addEventListener('click', navigateToDetails);
        bracket.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' || e.key === ' ') navigateToDetails();
        });

        fetchWorldBankIndicator(eco.code, 'FP.CPI.TOTL.ZG')
            .then(data => {
                const priceEl = bracket.querySelector('.bracket-price');
                const changeEl = bracket.querySelector('.bracket-change');
                if (data) {
                    const latest = data.find(d => d.value !== null);
                    if (latest) {
                        priceEl.innerText = `${latest.value.toFixed(2)}%`;
                        changeEl.style.color = latest.value > 3.0 ? '#ef4444' : '#10b981';
                        changeEl.innerText = `CPI (YoY, ${latest.date})`;
                        return;
                    }
                }
                priceEl.innerText = 'N/A';
                changeEl.innerText = 'Data unavailable';
                changeEl.style.color = 'var(--text-secondary-muted)';
            })
            .catch(err => {
                console.warn(`Failed to fetch CPI for ${eco.name}:`, err.message);
                const priceEl = bracket.querySelector('.bracket-price');
                const changeEl = bracket.querySelector('.bracket-change');
                priceEl.innerText = '—';
                changeEl.innerText = 'Fetch failed';
                changeEl.style.color = '#ef4444';
            });
    }
}

// ── Details Page: Full Macro Dashboard ─────────────────────────────────────────
async function displayMacroDetails(code, name, flag, bank) {
    const loader = document.getElementById('inflation-loader');
    const results = document.getElementById('inflation-results-container');

    if (loader) loader.classList.remove('hidden-element');
    if (results) results.classList.add('hidden-element');

    document.getElementById('country-name-display').innerText = name;
    document.getElementById('country-flag-display').innerText = flag;
    document.getElementById('central-bank-badge').innerText = bank || 'Central Bank';

    try {
        const [cpiData, rateData, gdpData, unemployData, currentAcctData] = await Promise.all([
            fetchWorldBankIndicator(code, 'FP.CPI.TOTL.ZG'),
            fetchWorldBankIndicator(code, 'FR.INR.LEND'),
            fetchWorldBankIndicator(code, 'NY.GDP.MKTP.KD.ZG'),
            fetchWorldBankIndicator(code, 'SL.UEM.TOTL.ZS'),
            fetchWorldBankIndicator(code, 'BN.CAB.XOKA.GD.ZS')
        ]);

        if (!cpiData || cpiData.length === 0) {
            throw new Error("No macroeconomic data available for this country.");
        }

        const validCpi = cpiData.filter(d => d.value !== null).sort((a, b) => parseInt(a.date) - parseInt(b.date));
        const latestCpi = validCpi.length > 0 ? validCpi[validCpi.length - 1] : null;

        const extractLatest = (arr) => {
            if (!arr) return null;
            const valid = arr.filter(d => d.value !== null).sort((a, b) => parseInt(b.date) - parseInt(a.date));
            return valid.length > 0 ? valid[0] : null;
        };

        const latestRate = extractLatest(rateData);
        const latestGdp = extractLatest(gdpData);
        const latestUnemploy = extractLatest(unemployData);
        const latestCurrentAcct = extractLatest(currentAcctData);

        if (latestCpi) {
            document.getElementById('inflation-live-display').innerText = `${latestCpi.value.toFixed(2)}%`;
            document.getElementById('inflation-change-display').innerText = `Reported CPI (YoY, ${latestCpi.date})`;
            document.getElementById('metric-inflation-date').innerText = latestCpi.date;
            document.getElementById('metric-core-inflation').innerText = `${latestCpi.value.toFixed(2)}%`;
        }

        document.getElementById('metric-interest-rate').innerText = latestRate ? `${latestRate.value.toFixed(2)}%` : 'N/A';
        document.getElementById('metric-gdp-growth').innerText = latestGdp ? `${latestGdp.value.toFixed(2)}%` : 'N/A';
        document.getElementById('metric-unemployment').innerText = latestUnemploy ? `${latestUnemploy.value.toFixed(2)}%` : 'N/A';
        document.getElementById('metric-current-account').innerText = latestCurrentAcct ? `${latestCurrentAcct.value.toFixed(2)}%` : 'N/A';

        const countryObj = globalCountryMap.find(c => c.id === code || c.iso2Code === code);
        document.getElementById('currency-badge').innerText = countryObj && countryObj.capitalCity ? `Capital: ${countryObj.capitalCity}` : 'Sovereign Macro';

        // Prepare chart data (Align interest rate series to CPI date labels)
        const labels = validCpi.map(d => d.date);
        const cpiValues = validCpi.map(d => d.value);

        const rateMap = {};
        if (rateData) {
            rateData.forEach(d => { if (d.value !== null) rateMap[d.date] = d.value; });
        }
        const rateValues = labels.map(date => rateMap[date] !== undefined ? rateMap[date] : null);

        renderMacroChart(labels, cpiValues, rateValues);

        if (loader) loader.classList.add('hidden-element');
        if (results) results.classList.remove('hidden-element');

        // Fetch AI Analysis asynchronously (non-blocking)
        const analysisDisplay = document.getElementById('macro-analysis-display');
        analysisDisplay.innerHTML = '<span class="pulse-text" style="color: var(--neon-cyan-vibrant);">Generating macroeconomic insights...</span>';

        fetch(`${BACKEND_URL}/api/analysis?country=${encodeURIComponent(name)}&cpi=${latestCpi?.value?.toFixed(2) || ''}&rate=${latestRate?.value?.toFixed(2) || ''}&gdp=${latestGdp?.value?.toFixed(2) || ''}&unemployment=${latestUnemploy?.value?.toFixed(2) || ''}`)
            .then(res => res.json())
            .then(data => {
                if (data.analysis) {
                    analysisDisplay.innerText = data.analysis;
                } else {
                    analysisDisplay.innerText = 'Analysis unavailable.';
                }
            })
            .catch(err => {
                analysisDisplay.innerText = 'Failed to load macro analysis due to a network error.';
            });

    } catch (err) {
        console.error("Macro Fetch Error:", err);
        showToast(err.message || "Failed to load macro data.");
        if (loader) loader.classList.add('hidden-element');
        const landing = document.getElementById('macro-landing-view');
        if (landing) landing.classList.remove('hidden-element');
    }
}

// ── Chart Rendering ────────────────────────────────────────────────────────────
function renderMacroChart(labels, cpiData, rateData) {
    const canvas = document.getElementById('inflationHistoricalChart');
    if (!canvas) return;

    const latestValue = cpiData.length > 0 ? cpiData[cpiData.length - 1] : 0;
    const isRunningHot = latestValue > 2.5;
    const cpiLineColor = isRunningHot ? '#ef4444' : '#10b981';
    const cpiFillColor = isRunningHot ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)';

    const rateLineColor = '#3b82f6';

    if (macroChartInstance) {
        macroChartInstance.destroy();
    }

    macroChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Inflation Rate (CPI %)',
                    data: cpiData,
                    borderColor: cpiLineColor,
                    backgroundColor: cpiFillColor,
                    yAxisID: 'y',
                    tension: 0.3,
                    fill: true,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    borderWidth: 2.5,
                },
                {
                    label: 'Lending Interest Rate (%)',
                    data: rateData,
                    borderColor: rateLineColor,
                    backgroundColor: 'transparent',
                    yAxisID: 'y1',
                    tension: 0.3,
                    fill: false,
                    borderDash: [5, 5],
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    borderWidth: 2,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 8, right: 10, left: 6, bottom: 8 } },
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#8f9bb3', usePointStyle: true, pointStyle: 'circle', padding: 16 }
                },
                tooltip: {
                    backgroundColor: 'rgba(13, 19, 38, 0.95)',
                    titleColor: '#94a3b8',
                    bodyColor: '#f8fafc',
                    borderColor: 'rgba(37, 99, 235, 0.3)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: true,
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + '%' : 'N/A'}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#64748b', font: { size: 11 } }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: { display: true, text: 'Inflation (%)', color: '#64748b', font: { weight: '500' } },
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#64748b', callback: (val) => val + '%' }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: { display: true, text: 'Interest Rate (%)', color: '#64748b', font: { weight: '500' } },
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#64748b', callback: (val) => val + '%' }
                }
            }
        }
    });
}
