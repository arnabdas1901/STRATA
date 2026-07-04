import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast } from '../utils.js';

let macroChartInstance = null;
let globalCountryMap = [];

export async function setupInflationTracker() {
    const isDetailsPage = window.location.pathname.includes('macro-details.html');

    try {
        const res = await fetch('https://api.worldbank.org/v2/country?format=json&per_page=300');
        const data = await safeJsonParse(res);
        if (data && data[1]) {
            globalCountryMap = data[1].filter(c => c.region.id !== 'NA'); 
        }
    } catch (e) {
        console.warn('Could not load WB country map', e);
    }

    if (isDetailsPage) {
        setupDetailsSearch();
        
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
        setupLandingSearch();
        loadMajorEconomies();
    }
}

function setupLandingSearch() {
    const searchBtn = document.getElementById('inflation-search-btn');
    const searchInput = document.getElementById('inflation-search-input');
    
    const handleSearch = () => {
        if (!searchInput) return;
        const query = searchInput.value.trim().toLowerCase();
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

        window.location.href = `macro-details.html?code=${country.id}&name=${encodeURIComponent(country.name)}&flag=🌍&bank=Central%20Bank`;
    };

    if (searchBtn) {
        searchBtn.addEventListener('click', handleSearch);
    }
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSearch();
        });
    }
}

function setupDetailsSearch() {
    const searchBtn = document.getElementById('inflation-search-btn');
    const searchInput = document.getElementById('inflation-search-input');
    
    const handleSearch = () => {
        if (!searchInput) return;
        const query = searchInput.value.trim().toLowerCase();
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

        window.location.href = `macro-details.html?code=${country.id}&name=${encodeURIComponent(country.name)}&flag=🌍&bank=Central%20Bank`;
    };

    if (searchBtn) {
        searchBtn.addEventListener('click', handleSearch);
    }
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSearch();
        });
    }
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
        
        bracket.addEventListener('click', () => {
            window.location.href = `macro-details.html?code=${eco.code}&name=${encodeURIComponent(eco.name)}&flag=${encodeURIComponent(eco.flag)}&bank=${encodeURIComponent(eco.bank)}`;
        });
        bracket.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                window.location.href = `macro-details.html?code=${eco.code}&name=${encodeURIComponent(eco.name)}&flag=${encodeURIComponent(eco.flag)}&bank=${encodeURIComponent(eco.bank)}`;
            }
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

async function displayMacroDetails(code, name, flag, bank) {
    const loader = document.getElementById('inflation-loader');
    const results = document.getElementById('inflation-results-container');

    if(loader) loader.classList.remove('hidden-element');
    if(results) results.classList.add('hidden-element');

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

        const validCpi = cpiData.filter(d => d.value !== null).sort((a,b) => parseInt(a.date) - parseInt(b.date));
        const latestCpi = validCpi.length > 0 ? validCpi[validCpi.length - 1] : null;
        
        const extractLatest = (arr) => {
            if (!arr) return null;
            const valid = arr.filter(d => d.value !== null).sort((a,b) => parseInt(b.date) - parseInt(a.date));
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

        // Prepare chart data (Align to CPI dates)
        const labels = validCpi.map(d => d.date);
        const cpiValues = validCpi.map(d => d.value);
        
        const rateMap = {};
        if (rateData) {
            rateData.forEach(d => { if (d.value !== null) rateMap[d.date] = d.value; });
        }
        const rateValues = labels.map(date => rateMap[date] !== undefined ? rateMap[date] : null);

        renderMacroChart(labels, cpiValues, rateValues);

        if(loader) loader.classList.add('hidden-element');
        if(results) results.classList.remove('hidden-element');

        // Fetch AI Analysis asynchronously
        const analysisDisplay = document.getElementById('macro-analysis-display');
        analysisDisplay.innerHTML = '<span class="pulse-text" style="color: var(--neon-cyan-vibrant);">Generating macroeconomic insights...</span>';
        
        fetch(`${BACKEND_URL}/api/macro/analysis?country=${encodeURIComponent(name)}&cpi=${latestCpi?.value?.toFixed(2) || ''}&rate=${latestRate?.value?.toFixed(2) || ''}&gdp=${latestGdp?.value?.toFixed(2) || ''}&unemployment=${latestUnemploy?.value?.toFixed(2) || ''}`)
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
        if(loader) loader.classList.add('hidden-element');
        if(landing) landing.classList.remove('hidden-element');
    }
}

function renderMacroChart(labels, cpiData, rateData) {
    const canvas = document.getElementById('inflationHistoricalChart');
    if (!canvas) return;

    const latestValue = cpiData.length > 0 ? cpiData[cpiData.length - 1] : 0;
    const isRunningHot = latestValue > 2.5;
    const cpiLineColor = isRunningHot ? '#ef4444' : '#10b981'; // Red or Green
    const cpiFillColor = isRunningHot ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)';

    const rateLineColor = '#3b82f6'; // Blue for Interest Rate
    const rateFillColor = 'rgba(59, 130, 246, 0.1)';

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
                    borderWidth: 2,
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
                    labels: { color: '#8f9bb3' }
                },
                tooltip: {
                    backgroundColor: '#1a1f2e',
                    titleColor: '#8f9bb3',
                    bodyColor: '#ffffff',
                    borderColor: '#2e3852',
                    borderWidth: 1,
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}%`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#8f9bb3' }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: { display: true, text: 'Inflation (%)', color: '#8f9bb3' },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#8f9bb3', callback: (val) => val + '%' }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: { display: true, text: 'Interest Rate (%)', color: '#8f9bb3' },
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#8f9bb3', callback: (val) => val + '%' }
                }
            }
        }
    });
}
