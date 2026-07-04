import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast, escapeHtml, formatLargeCurrency, setupTabs } from '../utils.js';

let cryptoChartInstance = null;
let activeCryptoId = null;

export function setupCryptoTracker() {
    const isDetailsPage = window.location.pathname.includes('crypto-details.html');

    if (isDetailsPage) {
        setupDetailsSearch();
        setupCryptoTimeframeSelectors();
        setupTabs('#dashboard-crypto');

        const params = new URLSearchParams(window.location.search);
        const id = params.get('id');
        const query = params.get('query');
        if (id) {
            displayCryptoDetails(id);
        } else if (query) {
            executeCryptoSearchWithQuery(query);
        } else {
            window.location.href = 'crypto.html';
        }
    } else {
        setupLandingSearch();
        loadTopCryptos();
    }
}

function setupLandingSearch() {
    const searchBtn = document.getElementById('crypto-search-btn');
    const searchInput = document.getElementById('crypto-search-input');

    const handleSearch = () => {
        if (!searchInput) return;
        const query = searchInput.value.trim();
        if (query) {
            window.location.href = `crypto-details.html?query=${encodeURIComponent(query)}`;
        } else {
            showToast('Enter a cryptocurrency ticker or name to search.');
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
    const searchBtn = document.getElementById('crypto-search-btn');
    const searchInput = document.getElementById('crypto-search-input');

    const handleSearch = () => {
        if (!searchInput) return;
        const query = searchInput.value.trim();
        if (query) {
            window.location.href = `crypto-details.html?query=${encodeURIComponent(query)}`;
        } else {
            showToast('Enter a cryptocurrency ticker or name to search.');
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

async function executeCryptoSearchWithQuery(query) {
    const loader = document.getElementById('crypto-loader');
    if (loader) loader.classList.remove('hidden-element');

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/crypto/search?query=${encodeURIComponent(query)}`, {
            timeout: 10000,
        });
        const data = await safeJsonParse(response);

        if (!response.ok) {
            throw new Error(data?.error || 'Search failed.');
        }

        if (!data.coins || data.coins.length === 0) {
            showToast('No cryptocurrencies found. Try another search.');
            if (loader) loader.classList.add('hidden-element');
            return;
        }

        const topResult = data.coins[0];
        displayCryptoDetails(topResult.id);
    } catch (error) {
        console.error('Search error:', error);
        showToast('Search failed. Please try again.');
        if (loader) loader.classList.add('hidden-element');
    }
}

async function loadTopCryptos() {
    const bracketsGrid = document.getElementById('crypto-brackets-grid');
    if (!bracketsGrid) return;

    bracketsGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #999;">Loading top cryptocurrencies...</p>';

    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/crypto/top?limit=6`, {
            timeout: 10000,
        });
        const data = await safeJsonParse(response);

        if (!response.ok) {
            throw new Error(data?.error || 'Failed to load cryptocurrencies.');
        }

        bracketsGrid.innerHTML = '';
        data.forEach((crypto) => {
            const bracket = document.createElement('div');
            bracket.className = 'crypto-bracket-card';
            bracket.role = 'button';
            bracket.tabindex = '0';
            
            const change24h = crypto.price_change_percentage_24h || 0;
            const changeColor = change24h >= 0 ? '#10b981' : '#ef4444';
            const changeIcon = change24h >= 0 ? '▲' : '▼';

            bracket.innerHTML = `
                <div class="bracket-icon">${crypto.image ? `<img src="${crypto.image}" alt="${crypto.name}">` : '💰'}</div>
                <div class="bracket-name">${escapeHtml(crypto.name)}</div>
                <div class="bracket-symbol">${escapeHtml(crypto.symbol.toUpperCase())}</div>
                <div class="bracket-price">$${crypto.current_price?.toLocaleString('en-US', { maximumFractionDigits: 2 }) || '0.00'}</div>
                <div class="bracket-change" style="color: ${changeColor};">${changeIcon} ${Math.abs(change24h).toFixed(2)}%</div>
            `;

            bracket.addEventListener('click', () => {
                window.location.href = `crypto-details.html?id=${crypto.id}`;
            });
            bracket.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    window.location.href = `crypto-details.html?id=${crypto.id}`;
                }
            });

            bracketsGrid.appendChild(bracket);
        });
    } catch (error) {
        console.error('Error loading top cryptos:', error);
        bracketsGrid.innerHTML = `<p style="grid-column: 1/-1; color: #ef4444; text-align: center;">Error loading cryptocurrencies. Try again.</p>`;
        showToast('Failed to load top cryptocurrencies.');
    }
}

async function displayCryptoDetails(cryptoId) {
    const loader = document.getElementById('crypto-loader');
    const resultsContainer = document.getElementById('crypto-results-container');

    if (loader) loader.classList.remove('hidden-element');
    if (resultsContainer) resultsContainer.classList.add('hidden-element');

    try {
        activeCryptoId = cryptoId;
        
        // Reset timeframe selectors to default (365)
        const tfBtns = document.querySelectorAll('#dashboard-crypto .tf-btn');
        tfBtns.forEach(btn => {
            if (btn.getAttribute('data-tf') === '365') btn.classList.add('active');
            else btn.classList.remove('active');
        });

        const [detailsResponse, historyResponse] = await Promise.all([
            fetchWithTimeout(`${BACKEND_URL}/api/crypto/details?id=${encodeURIComponent(cryptoId)}`, { timeout: 10000 }),
            fetchWithTimeout(`${BACKEND_URL}/api/crypto/history?id=${encodeURIComponent(cryptoId)}&days=365`, { timeout: 10000 }).catch(() => null),
        ]);

        const details = await safeJsonParse(detailsResponse);
        const history = await safeJsonParse(historyResponse);

        if (!detailsResponse || !detailsResponse.ok) throw new Error(details?.error || 'Failed to fetch details');

        populateCryptoDetails(details);
        renderCryptoChart(history);

        if (loader) loader.classList.add('hidden-element');
        if (resultsContainer) resultsContainer.classList.remove('hidden-element');
        showToast(`Loaded ${details.name} details.`);
    } catch (error) {
        console.error('Error displaying crypto:', error);
        if (loader) loader.classList.add('hidden-element');
        if (landing) landing.classList.remove('hidden-element');
        showToast('Failed to load cryptocurrency details.');
    }
}

function populateCryptoDetails(crypto) {
    const marketData = crypto.market_data || {};
    const currentPrice = marketData.current_price?.usd || 0;
    const change24h = marketData.price_change_percentage_24h || 0;
    const change7d = marketData.price_change_percentage_7d || 0;
    const change30d = marketData.price_change_percentage_30d || 0;
    const marketCap = marketData.market_cap?.usd || 0;
    const volume24h = marketData.total_volume?.usd || 0;
    const high24h = marketData.high_24h?.usd || 0;
    const low24h = marketData.low_24h?.usd || 0;
    const ath = marketData.ath?.usd || 0;
    const atl = marketData.atl?.usd || 0;
    const circulatingSupply = crypto.market_data?.circulating_supply || 0;
    const totalSupply = crypto.market_data?.total_supply || 0;
    const maxSupply = crypto.market_data?.max_supply || 0;
    const volumeToMarketCap = marketCap > 0 ? volume24h / marketCap : 0;
    const rangePercent = currentPrice > 0 && high24h && low24h ? ((high24h - low24h) / currentPrice) * 100 : 0;
    const athGapPercent = currentPrice > 0 && ath > 0 ? ((ath - currentPrice) / ath) * 100 : 0;
    const atlGapPercent = currentPrice > 0 && atl > 0 ? ((currentPrice - atl) / atl) * 100 : 0;
    
    const nameDisplay = document.getElementById('crypto-name-display');
    const tickerBadge = document.getElementById('crypto-ticker-badge');
    const rankBadge = document.getElementById('crypto-rank-badge');
    const iconDisplay = document.getElementById('crypto-icon-display');
    const priceDisplay = document.getElementById('crypto-live-price-display');
    const changeDisplay = document.getElementById('crypto-live-change-display');

    if (nameDisplay) nameDisplay.textContent = crypto.name;
    if (tickerBadge) tickerBadge.textContent = (crypto.symbol || '').toUpperCase();
    if (rankBadge) rankBadge.textContent = `#${crypto.market_cap_rank || '--'}`;
    if (iconDisplay) {
        const iconUrl = crypto.image?.thumb || crypto.image?.small || crypto.image?.large || crypto.image;
        iconDisplay.innerHTML = iconUrl
            ? `<img src="${iconUrl}" alt="${crypto.name}">`
            : '💰';
    }
    
    if (priceDisplay) priceDisplay.textContent = `$${currentPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    if (changeDisplay) {
        changeDisplay.textContent = `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}% (24h)`;
        changeDisplay.style.color = change24h >= 0 ? '#10b981' : '#ef4444';
    }

    const metrics = {
        'crypto-metric-24h-high': marketData.high_24h?.usd,
        'crypto-metric-24h-low': marketData.low_24h?.usd,
        'crypto-metric-market-cap': marketData.market_cap?.usd,
        'crypto-metric-volume': marketData.total_volume?.usd,
        'crypto-metric-supply': crypto.market_data?.circulating_supply,
        'crypto-metric-total-supply': crypto.market_data?.total_supply,
        'crypto-metric-ath': marketData.ath?.usd,
        'crypto-metric-ath-date': marketData.ath_date?.usd,
    };

    Object.entries(metrics).forEach(([id, value]) => {
        const elem = document.getElementById(id);
        if (elem) {
            if (id.includes('supply')) {
                elem.textContent = value ? value.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '--';
            } else if (id.includes('market-cap') || id.includes('volume')) {
                elem.textContent = formatLargeCurrency(value);
            } else if (id.includes('ath-date')) {
                elem.textContent = value ? new Date(value).toLocaleDateString() : '--';
            } else {
                elem.textContent = value ? `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '--';
            }
        }
    });

    const signalValue = document.getElementById('crypto-signal-value');
    const signalDetail = document.getElementById('crypto-signal-detail');
    const liquidityValue = document.getElementById('crypto-liquidity-value');
    const liquidityDetail = document.getElementById('crypto-liquidity-detail');
    const supplyValue = document.getElementById('crypto-supply-value');
    const supplyDetail = document.getElementById('crypto-supply-detail');
    const rangeValue = document.getElementById('crypto-range-value');
    const rangeDetail = document.getElementById('crypto-range-detail');
    const briefingBadge = document.getElementById('crypto-briefing-badge');
    const briefingText = document.getElementById('crypto-briefing-text');

    const signalLabel = change24h > 2.5 || (change7d > 3 && change30d > 1.5)
        ? 'Momentum Acceleration'
        : change24h > 0 || change7d > 0
            ? 'Bullish Structure'
            : change24h < -2.5 || (change7d < -3 && change30d < -1.5)
                ? 'Risk Off'
                : 'Balanced';
    const signalDetailText = `${change24h >= 0 ? '+' : ''}${change24h.toFixed(1)}% 24h • ${change7d >= 0 ? '+' : ''}${change7d.toFixed(1)}% 7d`;

    const liquidityLabel = volumeToMarketCap > 0.18 ? 'Deep Liquidity' : volumeToMarketCap > 0.08 ? 'Healthy' : 'Selective';
    const liquidityDetailText = `${formatLargeCurrency(volume24h)} traded vs ${formatLargeCurrency(marketCap)} cap`;

    const supplyPercent = totalSupply > 0 ? Math.min(100, (circulatingSupply / totalSupply) * 100) : 0;
    const supplyLabel = maxSupply > 0 ? 'Capped Supply' : supplyPercent > 90 ? 'Near Full Circulation' : 'Moderate Float';
    const supplyDetailText = totalSupply > 0 ? `${supplyPercent.toFixed(1)}% in circulation` : 'Supply data pending';

    const rangeLabel = rangePercent > 6 ? 'Expanded Range' : rangePercent > 3 ? 'Balanced Range' : 'Compressed Range';
    const rangeDetailText = high24h && low24h ? `${formatLargeCurrency(high24h - low24h)} intraday swing` : 'Range data pending';

    if (signalValue) signalValue.textContent = signalLabel;
    if (signalDetail) signalDetail.textContent = signalDetailText;
    if (liquidityValue) liquidityValue.textContent = liquidityLabel;
    if (liquidityDetail) liquidityDetail.textContent = liquidityDetailText;
    if (supplyValue) supplyValue.textContent = supplyLabel;
    if (supplyDetail) supplyDetail.textContent = supplyDetailText;
    if (rangeValue) rangeValue.textContent = rangeLabel;
    if (rangeDetail) rangeDetail.textContent = rangeDetailText;
    if (briefingBadge) briefingBadge.textContent = signalLabel;
    if (briefingText) {
        const briefDirection = change24h >= 0 ? 'maintaining upward traction' : 'facing pressure';
        const athStatus = ath > 0 ? `${athGapPercent.toFixed(1)}% below ATH` : 'ATH data pending';
        const atlStatus = atl > 0 ? `${atlGapPercent.toFixed(1)}% above ATL` : 'ATL data pending';
        briefingText.textContent = `${crypto.name} is ${briefDirection} with ${signalDetailText} and ${liquidityDetailText.toLowerCase()}. Current price is ${athStatus} and ${atlStatus}.`;
    }

    const overviewBody = document.getElementById('crypto-overview-table-body');
    if (overviewBody) {
        overviewBody.innerHTML = `
            <tr><td>Market Cap Rank</td><td>#${crypto.market_cap_rank || '--'}</td></tr>
            <tr><td>Current Price (USD)</td><td>$${currentPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td></tr>
            <tr><td>24h Change</td><td style="color: ${change24h >= 0 ? '#10b981' : '#ef4444'}">${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%</td></tr>
            <tr><td>7d Change</td><td style="color: ${change7d >= 0 ? '#10b981' : '#ef4444'}">${change7d >= 0 ? '+' : ''}${change7d.toFixed(2)}%</td></tr>
            <tr><td>30d Change</td><td style="color: ${change30d >= 0 ? '#10b981' : '#ef4444'}">${change30d >= 0 ? '+' : ''}${change30d.toFixed(2)}%</td></tr>
            <tr><td>Market Cap</td><td>${formatLargeCurrency(marketCap)}</td></tr>
            <tr><td>24h Trading Volume</td><td>${formatLargeCurrency(volume24h)}</td></tr>
            <tr><td>Volume / Market Cap</td><td>${volumeToMarketCap.toFixed(3)}</td></tr>
            <tr><td>Fully Diluted Valuation</td><td>${formatLargeCurrency(marketData.fully_diluted_valuation?.usd)}</td></tr>
        `;
    }

    const statsBody = document.getElementById('crypto-stats-table-body');
    if (statsBody) {
        const athDate = marketData.ath_date?.usd ? new Date(marketData.ath_date.usd).toLocaleDateString() : '--';
        const atlDate = marketData.atl_date?.usd ? new Date(marketData.atl_date.usd).toLocaleDateString() : '--';
        
        statsBody.innerHTML = `
            <tr><td>All-Time High (USD)</td><td>$${(marketData.ath?.usd || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</td></tr>
            <tr><td>ATH Date</td><td>${athDate}</td></tr>
            <tr><td>All-Time Low (USD)</td><td>$${(marketData.atl?.usd || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</td></tr>
            <tr><td>ATL Date</td><td>${atlDate}</td></tr>
            <tr><td>Circulating Supply</td><td>${(crypto.market_data?.circulating_supply || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</td></tr>
            <tr><td>Total Supply</td><td>${(crypto.market_data?.total_supply || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</td></tr>
            <tr><td>Max Supply</td><td>${crypto.market_data?.max_supply ? crypto.market_data.max_supply.toLocaleString('en-US', { maximumFractionDigits: 0 }) : 'Unlimited'}</td></tr>
            <tr><td>Market Cap / Fully Diluted</td><td>${((marketData.market_cap?.usd / marketData.fully_diluted_valuation?.usd) * 100 || 0).toFixed(2)}%</td></tr>
        `;
    }
}

function renderCryptoChart(history) {
    const prices = history?.prices || [];
    const volumes = history?.total_volumes || [];
    
    const labels = prices.map(([timestamp]) => {
        const date = new Date(timestamp);
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    });

    const dataPoints = prices.map(([, price]) => price);
    const volumePoints = volumes.map(([, volume]) => volume || 0);

    const canvas = document.getElementById('cryptoHistoricalChart');
    if (!canvas) return;

    const isPositive = dataPoints[dataPoints.length - 1] >= dataPoints[0];
    const color = isPositive ? '#10b981' : '#ef4444';
    
    const ctx = canvas.getContext('2d');
    const priceGradient = ctx.createLinearGradient(0, 0, 0, 300);
    if (isPositive) {
        priceGradient.addColorStop(0, 'rgba(16, 185, 129, 0.25)');
        priceGradient.addColorStop(1, 'rgba(16, 185, 129, 0)');
    } else {
        priceGradient.addColorStop(0, 'rgba(239, 68, 68, 0.25)');
        priceGradient.addColorStop(1, 'rgba(239, 68, 68, 0)');
    }

    const volumeColors = prices.map((p, i) => {
        if (i === 0) return 'rgba(16, 185, 129, 0.2)';
        const prevClose = prices[i - 1][1];
        const currClose = p[1];
        return currClose >= prevClose ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)';
    });

    if (cryptoChartInstance) {
        cryptoChartInstance.destroy();
    }

    cryptoChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Close Price',
                    data: dataPoints,
                    borderColor: color,
                    backgroundColor: priceGradient,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    fill: true,
                    tension: 0.15,
                    yAxisID: 'y'
                },
                {
                    label: 'Volume',
                    data: volumePoints,
                    type: 'bar',
                    backgroundColor: volumeColors,
                    hoverBackgroundColor: volumeColors.map(c => c.replace('0.3', '0.6').replace('0.2', '0.5')),
                    barPercentage: 0.7,
                    categoryPercentage: 0.8,
                    yAxisID: 'yVolume'
                }
            ]
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
                    backgroundColor: 'rgba(10, 14, 23, 0.95)',
                    titleColor: 'rgba(255, 255, 255, 0.7)',
                    bodyColor: '#ffffff',
                    bodyFont: { family: "'JetBrains Mono', monospace", size: 13 },
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label: function(context) {
                            const val = context.parsed.y;
                            if (context.dataset.label === 'Close Price') {
                                return `Price: $${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
                            } else if (context.dataset.label === 'Volume') {
                                return `Volume: $${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
                            }
                            return `${context.dataset.label}: ${val}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.4)',
                        maxTicksLimit: 8
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.6)',
                        font: { family: "'JetBrains Mono', monospace" },
                        callback: (val) => '$' + val.toLocaleString(undefined, { maximumFractionDigits: 2 })
                    }
                },
                yVolume: {
                    type: 'linear',
                    display: false,
                    position: 'left',
                    grid: {
                        drawOnChartArea: false
                    },
                    min: 0,
                    max: volumePoints.length > 0 ? Math.max(...volumePoints) * 4 : 100
                }
            }
        }
    });
}

function setupCryptoTimeframeSelectors() {
    const tfBtns = document.querySelectorAll('#dashboard-crypto .tf-btn');
    tfBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            tfBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (activeCryptoId) {
                const days = btn.getAttribute('data-tf');
                await loadCryptoHistoryOnly(activeCryptoId, days);
            }
        });
    });
}

async function loadCryptoHistoryOnly(cryptoId, days = 365) {
    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/crypto/history?id=${encodeURIComponent(cryptoId)}&days=${days}`, { timeout: 10000 });
        const history = await safeJsonParse(response);
        renderCryptoChart(history);
    } catch (error) {
        console.warn('Failed to load crypto history:', error);
    }
}
