import { BACKEND_URL, safeJsonParse, showToast } from '../utils.js';

let forexChartInstance = null;

export async function setupForexTracker() {
    const isDetailsPage = window.location.pathname.includes('forex-details.html');

    if (isDetailsPage) {
        setupDetailsSearch();
        
        const aiGenBtn = document.getElementById('forex-ai-generate-btn');
        if (aiGenBtn) {
            aiGenBtn.addEventListener('click', generateAiForexProfile);
        }

        const params = new URLSearchParams(window.location.search);
        const symbol = params.get('symbol');
        if (symbol) {
            executeForexSearch(symbol);
        } else {
            window.location.href = 'forex.html';
        }
    } else {
        setupLandingSearch();
        setupLandingGridClicks();
        loadLatestForexRates();
    }
}

function setupLandingSearch() {
    const searchBtn = document.getElementById('forex-search-btn');
    const searchInput = document.getElementById('forex-search-input');

    const handleSearch = () => {
        if (!searchInput) return;
        const query = searchInput.value.trim();
        if (query) {
            window.location.href = `forex-details.html?symbol=${encodeURIComponent(query)}`;
        } else {
            showToast('Please enter a currency pair (e.g. GBP/USD)');
        }
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
    const searchBtn = document.getElementById('forex-search-btn');
    const searchInput = document.getElementById('forex-search-input');

    const handleSearch = () => {
        if (!searchInput) return;
        const query = searchInput.value.trim();
        if (query) {
            window.location.href = `forex-details.html?symbol=${encodeURIComponent(query)}`;
        } else {
            showToast('Please enter a currency pair (e.g. GBP/USD)');
        }
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

function setupLandingGridClicks() {
    const cards = document.querySelectorAll('#forex-brackets-grid .forex-table-row');
    cards.forEach(card => {
        const getSymbolAndRedirect = () => {
            const symbol = card.querySelector('.bracket-symbol').innerText;
            if (symbol) {
                window.location.href = `forex-details.html?symbol=${encodeURIComponent(symbol)}`;
            }
        };
        card.addEventListener('click', getSymbolAndRedirect);
        card.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                getSymbolAndRedirect();
            }
        });
    });
}

async function loadLatestForexRates() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/forex/latest`);
        const data = await safeJsonParse(res);
        if (!data || !data.rates) return;

        const cards = document.querySelectorAll('#forex-brackets-grid .forex-table-row');
        cards.forEach(card => {
            const symbol = card.querySelector('.bracket-symbol').innerText;
            let toCurrency;
            if (symbol.includes('/')) {
                toCurrency = symbol.split('/')[1];
                if (symbol.split('/')[0] !== 'USD') {
                    toCurrency = symbol.split('/')[0];
                    if (data.rates[toCurrency]) {
                        const price = 1 / data.rates[toCurrency];
                        card.querySelector('.bracket-price').innerText = price.toFixed(4);
                    }
                } else {
                    if (data.rates[toCurrency]) {
                        card.querySelector('.bracket-price').innerText = data.rates[toCurrency].toFixed(4);
                    }
                }
            }
        });
    } catch (err) {
        console.warn('Could not load latest forex rates', err);
    }
}

async function executeForexSearch(pairQuery) {
    const loader = document.getElementById('forex-loader');
    const results = document.getElementById('forex-results-container');

    if (loader) loader.classList.remove('hidden-element');
    if (results) results.classList.add('hidden-element');

    try {
        const res = await fetch(`${BACKEND_URL}/api/forex/search?pair=${encodeURIComponent(pairQuery)}`);
        const data = await safeJsonParse(res);

        if (data.error) {
            throw new Error(data.error);
        }

        const isPositive = data.change >= 0;
        const colorClass = isPositive ? 'positive' : 'negative';
        const sign = isPositive ? '+' : '';

        document.getElementById('forex-name-display').innerText = `${data.fromSymbol} / ${data.toSymbol}`;
        document.getElementById('forex-symbol-badge').innerText = `${data.fromSymbol}${data.toSymbol}`;
        document.getElementById('forex-live-price').innerText = data.price.toFixed(4);
        
        const changeEl = document.getElementById('forex-change-display');
        changeEl.innerText = `${sign}${data.change.toFixed(4)} (${sign}${data.changePercent.toFixed(2)}%)`;
        changeEl.className = `price-change-percent ${colorClass}`;

        document.getElementById('forex-description-display').innerText = 'Click "Generate Profile" to run on-demand AI macroeconomic analysis.';
        
        const btn = document.getElementById('forex-ai-generate-btn');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-robot"></i> Generate Profile';
        }
        



        window.currentForexPair = {
            fromSymbol: data.fromSymbol,
            toSymbol: data.toSymbol,
            price: data.price
        };

        if (data.chartData && data.chartData.length > 0) {
            renderForexChart(data.chartData, `${data.fromSymbol}/${data.toSymbol}`, isPositive);
        }

        if (loader) loader.classList.add('hidden-element');
        if (results) results.classList.remove('hidden-element');

    } catch (err) {
        console.error("Forex Search Error:", err);
        showToast(err.message || "Failed to load forex data.");
        if (loader) loader.classList.add('hidden-element');
    }
}

function renderForexChart(chartData, pairName, isPositive) {
    const canvas = document.getElementById('forexHistoricalChart');
    if (!canvas) return;

    if (forexChartInstance) {
        forexChartInstance.destroy();
    }

    const labels = chartData.map(d => {
        const date = new Date(d.time * 1000);
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    });
    const dataPoints = chartData.map(d => d.close);

    const gradient = canvas.getContext('2d').createLinearGradient(0, 0, 0, 400);
    if (isPositive) {
        gradient.addColorStop(0, 'rgba(0, 255, 255, 0.2)');
        gradient.addColorStop(1, 'rgba(0, 255, 255, 0)');
    } else {
        gradient.addColorStop(0, 'rgba(255, 0, 85, 0.2)');
        gradient.addColorStop(1, 'rgba(255, 0, 85, 0)');
    }

    const lineColor = isPositive ? '#00ffff' : '#ff0055';

    forexChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `${pairName} Close Price`,
                data: dataPoints,
                borderColor: lineColor,
                backgroundColor: gradient,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(10, 14, 23, 0.9)',
                    titleColor: 'rgba(255, 255, 255, 0.7)',
                    bodyColor: '#00f0ff',
                    bodyFont: { family: "'JetBrains Mono', monospace", size: 14, weight: 'bold' },
                    borderColor: 'rgba(0, 240, 255, 0.3)',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label: (ctx) => `Price: ${ctx.parsed.y.toFixed(4)}`
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.4)',
                        maxTicksLimit: 6
                    }
                },
                y: {
                    display: true,
                    position: 'right',
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.4)',
                        font: { family: "'JetBrains Mono', monospace" },
                        callback: (val) => val.toFixed(4)
                    }
                }
            }
        }
    });
}

async function generateAiForexProfile() {
    if (!window.currentForexPair) return;
    
    const btn = document.getElementById('forex-ai-generate-btn');
    const display = document.getElementById('forex-description-display');
    
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';
    }
    display.innerText = 'Consulting AI Strategist...';

    try {
        const res = await fetch(`${BACKEND_URL}/api/forex/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(window.currentForexPair)
        });
        const data = await safeJsonParse(res);
        
        if (data.error) throw new Error(data.error);
        
        display.innerText = data.analysis || 'Analysis unavailable.';
        
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Analysis Complete';
        }
        

    } catch (err) {
        console.error('Forex AI Gen Error:', err);
        display.innerText = 'Failed to generate profile.';
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-robot"></i> Retry Profile';
        }
    }
}

