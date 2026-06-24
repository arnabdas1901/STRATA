import { BACKEND_URL, fetchWithTimeout, safeJsonParse, formatLargeCurrency } from '../utils.js';

let commoditiesData = [];
let commodityChartInstance = null;

export function initCommoditiesDashboard() {
    setupUIListeners();
    loadCommodityDashboard();
}

function setupUIListeners() {
    const backBtn = document.getElementById('commodity-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            document.getElementById('commodity-results-container').classList.add('hidden-element');
            document.getElementById('commodity-landing-view').classList.remove('hidden-element');
        });
    }

    const searchBtn = document.getElementById('commodity-search-btn');
    const searchInput = document.getElementById('commodity-search-input');
    if (searchBtn && searchInput) {
        searchBtn.addEventListener('click', () => {
            const query = searchInput.value.trim();
            if (!query) return;
            performCommoditySearch(query);
        });
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchBtn.click();
        });
    }
}

async function loadCommodityDashboard() {
    const grid = document.getElementById('commodity-brackets-grid');
    if (!grid) return;

    grid.innerHTML = '<div class="commodity-note" style="padding: 20px; grid-column: 1/-1;">Fetching live macro data...</div>';

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/commodities`);
        const payload = await safeJsonParse(response);
        
        if (payload?.commodities && Array.isArray(payload.commodities)) {
            commoditiesData = payload.commodities;
            renderCommodityGrid(commoditiesData);
        } else {
            grid.innerHTML = '<div class="commodity-note" style="padding: 20px; grid-column: 1/-1; color: var(--error-red);">Failed to load commodity data.</div>';
        }
    } catch (error) {
        console.error('Failed to load commodities:', error);
        grid.innerHTML = '<div class="commodity-note" style="padding: 20px; grid-column: 1/-1; color: var(--error-red);">Error connecting to macro service. Please try again.</div>';
    }
}

function renderCommodityGrid(items) {
    const grid = document.getElementById('commodity-brackets-grid');
    if (!grid) return;

    if (items.length === 0) {
        grid.innerHTML = '<div class="commodity-note">No commodities tracked.</div>';
        return;
    }

    grid.innerHTML = items.map(item => {
        if (item.error) {
            return `
                <button class="crypto-bracket-card disabled" disabled>
                    <div class="crypto-bracket-header">
                        <span class="crypto-bracket-emoji">${item.emoji || '⚠️'}</span>
                        <div>
                            <div class="crypto-bracket-name">${item.name}</div>
                            <div class="crypto-bracket-symbol">${item.symbol}</div>
                        </div>
                    </div>
                    <div class="crypto-bracket-price" style="font-size: 0.9rem; margin-top: 10px;">Data Unavailable</div>
                </button>
            `;
        }

        const priceText = item.price != null ? formatLargeCurrency(item.price) : 'N/A';
        const changeVal = item.changePercent != null ? parseFloat(item.changePercent) : 0;
        const changeText = item.changePercent != null ? `${changeVal >= 0 ? '+' : ''}${changeVal.toFixed(2)}%` : '--%';
        const changeClass = changeVal >= 0 ? 'pos-change' : 'neg-change';

        return `
            <button class="crypto-bracket-card" data-id="${item.id}">
                <div class="crypto-bracket-header">
                    <span class="crypto-bracket-emoji">${item.emoji}</span>
                    <div>
                        <div class="crypto-bracket-name">${item.name}</div>
                        <div class="crypto-bracket-symbol">${item.symbol}</div>
                    </div>
                </div>
                <div class="crypto-bracket-price">${priceText}</div>
                <div class="crypto-bracket-change ${changeClass}">${changeText}</div>
            </button>
        `;
    }).join('');

    // Attach listeners
    grid.querySelectorAll('.crypto-bracket-card:not(.disabled)').forEach(card => {
        card.addEventListener('click', () => {
            selectCommodity(card.getAttribute('data-id'));
        });
    });
}

function selectCommodity(id) {
    const item = commoditiesData.find(c => c.id === id);
    if (!item) return;
    // For grid items, we can use their symbol or name to search and get the graph
    performCommoditySearch(item.name || item.symbol);
}

async function performCommoditySearch(query) {
    document.getElementById('commodity-landing-view').classList.add('hidden-element');
    document.getElementById('commodity-results-container').classList.remove('hidden-element');

    // Set loading states
    document.getElementById('commodity-icon-display').innerText = '⏳';
    document.getElementById('commodity-name-display').innerText = 'Searching...';
    document.getElementById('commodity-ticker-badge').innerText = '...';
    document.getElementById('commodity-live-price-display').innerText = 'N/A';
    document.getElementById('commodity-live-change-display').innerText = '--%';
    document.getElementById('commodity-live-change-display').className = 'price-change-percent';
    
    const descEl = document.getElementById('commodity-description-display');
    descEl.innerHTML = '<span class="pulse-text" style="color: var(--neon-cyan-vibrant);">Analyzing global macro data, fetching historical charts, and writing market profile...</span>';

    if (commodityChartInstance) {
        commodityChartInstance.destroy();
        commodityChartInstance = null;
    }

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/commodities/search?query=${encodeURIComponent(query)}`);
        const payload = await safeJsonParse(response);

        if (payload?.error) {
            descEl.innerHTML = `<span style="color: var(--error-red);">${payload.error}</span>`;
            document.getElementById('commodity-name-display').innerText = 'Search Failed';
            return;
        }

        if (payload) {
            // Populate Hero
            document.getElementById('commodity-icon-display').innerText = '🌐'; // Generic icon for searched commodity
            document.getElementById('commodity-name-display').innerText = payload.name;
            document.getElementById('commodity-ticker-badge').innerText = payload.symbol;
            
            const priceText = payload.price != null ? formatLargeCurrency(payload.price) : 'N/A';
            document.getElementById('commodity-live-price-display').innerText = priceText;
            
            const changeVal = payload.changePercent != null ? parseFloat(payload.changePercent) : 0;
            const changeText = payload.changePercent != null ? `${changeVal >= 0 ? '+' : ''}${changeVal.toFixed(2)}%` : '--%';
            const changeClass = changeVal >= 0 ? 'price-change-percent pos-change' : 'price-change-percent neg-change';
            
            const changeDisplay = document.getElementById('commodity-live-change-display');
            changeDisplay.innerText = changeText;
            changeDisplay.className = changeClass;

            // Populate Description
            descEl.innerText = payload.description || 'Description unavailable.';

            // Render Chart
            if (payload.chartData && payload.chartData.length > 0) {
                renderCommodityChart(payload.chartData, payload.name, changeVal >= 0);
            }
        }
    } catch (error) {
        console.error('Failed to perform commodity search:', error);
        descEl.innerHTML = '<span style="color: var(--error-red);">Failed to load commodity data due to a network error.</span>';
        document.getElementById('commodity-name-display').innerText = 'Error';
    }
}

function renderCommodityChart(chartData, name, isPositive) {
    const ctx = document.getElementById('commodity-chart');
    if (!ctx) return;

    if (commodityChartInstance) {
        commodityChartInstance.destroy();
    }

    const labels = chartData.map(d => {
        const date = new Date(d.time * 1000);
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
    });
    const dataPoints = chartData.map(d => d.close);

    const lineColor = isPositive ? '#00e6b8' : '#ff4d4d'; // neon cyan or neon red
    const gradientColorStart = isPositive ? 'rgba(0, 230, 184, 0.2)' : 'rgba(255, 77, 77, 0.2)';
    const gradientColorEnd = isPositive ? 'rgba(0, 230, 184, 0)' : 'rgba(255, 77, 77, 0)';

    const chartCtx = ctx.getContext('2d');
    const gradient = chartCtx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, gradientColorStart);
    gradient.addColorStop(1, gradientColorEnd);

    commodityChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `${name} Price`,
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
                intersect: false,
                mode: 'index',
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1a1f2e',
                    titleColor: '#8f9bb3',
                    bodyColor: '#ffffff',
                    borderColor: '#2e3852',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            return formatLargeCurrency(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: false,
                },
                y: {
                    display: true,
                    position: 'right',
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false,
                    },
                    ticks: {
                        color: '#8f9bb3',
                        callback: function(value) {
                            return '$' + value;
                        }
                    }
                }
            }
        }
    });
}
