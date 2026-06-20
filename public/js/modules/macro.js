import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast } from '../utils.js';

let macroChartInstance = null;
let globalCountryMap = [];

export async function setupInflationTracker() {
    const searchBtn = document.getElementById('inflation-search-btn');
    const searchInput = document.getElementById('inflation-search-input');
    const backBtn = document.getElementById('inflation-back-btn');
    
    if (searchBtn) {
        searchBtn.addEventListener('click', executeInflationSearch);
    }
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') executeInflationSearch();
        });
    }
    if (backBtn) {
        backBtn.addEventListener('click', clearInflationResults);
    }

    try {
        const res = await fetch('https://api.worldbank.org/v2/country?format=json&per_page=300');
        const data = await safeJsonParse(res);
        if (data && data[1]) {
            globalCountryMap = data[1].filter(c => c.region.id !== 'NA'); 
        }
    } catch (e) {
        console.warn('Could not load WB country map', e);
    }

    loadMajorEconomies();
}

function clearInflationResults() {
    const results = document.getElementById('inflation-results-container');
    const landing = document.getElementById('macro-landing-view');
    const searchInput = document.getElementById('inflation-search-input');
    
    if (results) results.classList.add('hidden-element');
    if (landing) landing.classList.remove('hidden-element');
    if (searchInput) searchInput.value = '';
}

async function fetchWorldBankIndicator(countryCode, indicator) {
    const url = `https://api.worldbank.org/v2/country/${countryCode}/indicator/${indicator}?format=json&per_page=20`;
    const res = await fetch(url);
    const data = await safeJsonParse(res);
    if (!data || !data[1] || !Array.isArray(data[1])) return null;
    return data[1];
}

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
        bracket.tabindex = '0';
        bracket.innerHTML = `
            <div class="bracket-icon"><span style="font-size: 32px;">${eco.flag}</span></div>
            <div class="bracket-name">${eco.name}</div>
            <div class="bracket-symbol">${eco.bank}</div>
            <div class="bracket-price">--%</div>
            <div class="bracket-change">CPI (YoY)</div>
        `;
        grid.appendChild(bracket);
        
        bracket.addEventListener('click', () => displayMacroDetails(eco.code, eco.name, eco.flag, eco.bank));
        bracket.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' || e.key === ' ') displayMacroDetails(eco.code, eco.name, eco.flag, eco.bank);
        });

        fetchWorldBankIndicator(eco.code, 'FP.CPI.TOTL.ZG').then(data => {
            if (data) {
                const latest = data.find(d => d.value !== null);
                if (latest) {
                    const priceEl = bracket.querySelector('.bracket-price');
                    const changeEl = bracket.querySelector('.bracket-change');
                    priceEl.innerText = `${latest.value.toFixed(2)}%`;
                    changeEl.style.color = latest.value > 3.0 ? '#ef4444' : '#10b981';
                    changeEl.innerText = `CPI (YoY, ${latest.date})`;
                }
            }
        });
    }
}

async function executeInflationSearch() {
    const input = document.getElementById('inflation-search-input');
    const query = input?.value.trim().toLowerCase();
    
    if (!query) {
        showToast("Enter a country name (e.g., Brazil, Canada).");
        return;
    }

    let country = globalCountryMap.find(c => 
        c.name.toLowerCase().includes(query) || 
        c.id.toLowerCase() === query || 
        c.iso2Code.toLowerCase() === query
    );

    if (!country) {
        showToast("Country not found in database. Try another name.");
        return;
    }

    displayMacroDetails(country.id, country.name, '🌍', 'Central Bank');
    showToast(`Connecting to World Bank data for ${country.name}`);
}

async function displayMacroDetails(code, name, flag, bank) {
    const loader = document.getElementById('inflation-loader');
    const results = document.getElementById('inflation-results-container');
    const landing = document.getElementById('macro-landing-view');

    if(loader) loader.classList.remove('hidden-element');
    if(results) results.classList.add('hidden-element');
    if(landing) landing.classList.add('hidden-element');

    document.getElementById('country-name-display').innerText = name;
    document.getElementById('country-flag-display').innerText = flag;
    document.getElementById('central-bank-badge').innerText = bank || 'Central Bank';

    try {
        const [cpiData, rateData] = await Promise.all([
            fetchWorldBankIndicator(code, 'FP.CPI.TOTL.ZG'),
            fetchWorldBankIndicator(code, 'FR.INR.LEND')
        ]);

        if (!cpiData || cpiData.length === 0) {
            throw new Error("No macroeconomic data available for this country.");
        }

        const validCpi = cpiData.filter(d => d.value !== null).sort((a,b) => parseInt(a.date) - parseInt(b.date));
        const latestCpi = validCpi.length > 0 ? validCpi[validCpi.length - 1] : null;
        const validRates = rateData ? rateData.filter(d => d.value !== null) : [];
        const latestRate = validRates.length > 0 ? validRates[0] : null;

        if (latestCpi) {
            document.getElementById('inflation-live-display').innerText = `${latestCpi.value.toFixed(2)}%`;
            document.getElementById('inflation-change-display').innerText = `Reported CPI (YoY, ${latestCpi.date})`;
            document.getElementById('metric-inflation-date').innerText = latestCpi.date;
            document.getElementById('metric-core-inflation').innerText = `${latestCpi.value.toFixed(2)}%`;
        }

        document.getElementById('metric-interest-rate').innerText = latestRate ? `${latestRate.value.toFixed(2)}%` : 'N/A';
        
        const countryObj = globalCountryMap.find(c => c.id === code || c.iso2Code === code);
        document.getElementById('currency-badge').innerText = countryObj && countryObj.capitalCity ? `Capital: ${countryObj.capitalCity}` : 'Sovereign Macro';

        const labels = validCpi.map(d => d.date);
        const values = validCpi.map(d => d.value);
        renderMacroChart(labels, values);

        if(loader) loader.classList.add('hidden-element');
        if(results) results.classList.remove('hidden-element');
    } catch (err) {
        console.error("Macro Fetch Error:", err);
        showToast(err.message || "Failed to load macro data.");
        if(loader) loader.classList.add('hidden-element');
        if(landing) landing.classList.remove('hidden-element');
    }
}

function renderMacroChart(labels, data) {
    const canvas = document.getElementById('inflationHistoricalChart');
    if (!canvas) return;

    const latestValue = data.length > 0 ? data[data.length - 1] : 0;
    const isRunningHot = latestValue > 2.5;
    const lineColor = isRunningHot ? '#ef4444' : '#10b981';
    const fillColor = isRunningHot ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)';

    if (macroChartInstance) {
        macroChartInstance.data.labels = labels;
        macroChartInstance.data.datasets[0].data = data;
        macroChartInstance.data.datasets[0].borderColor = lineColor;
        macroChartInstance.data.datasets[0].backgroundColor = fillColor;
        macroChartInstance.update();
    } else {
        macroChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Annual Inflation Rate (%)',
                    data: data,
                    borderColor: lineColor,
                    backgroundColor: fillColor,
                    tension: 0.3,
                    fill: true,
                    pointRadius: 4,
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 8, right: 10, left: 6, bottom: 8 } },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ${ctx.parsed.y.toFixed(2)}%`
                        }
                    }
                },
                scales: {
                    y: {
                        ticks: { callback: (val) => val + '%' }
                    }
                }
            }
        });
    }
}
