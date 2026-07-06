import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast, escapeHtml, formatLargeCurrency, setupTabs } from '../utils.js';

let cryptoChartInstance = null;
let activeCryptoId = null;
let currentCryptoPrice = 0; // for converter

// ─── Entry Point ────────────────────────────────────────────────────────────────

export function setupCryptoTracker() {
    const isDetailsPage = window.location.pathname.includes('crypto-details.html');

    if (isDetailsPage) {
        setupSearch();
        setupCryptoTimeframeSelectors();
        setupTabs('#dashboard-crypto');
        setupAboutToggle();
        setupConverter();

        const params = new URLSearchParams(window.location.search);
        const id = params.get('id');
        const symbol = params.get('symbol');
        const query = params.get('query');
        if (id) {
            displayCryptoDetails(id, symbol);
        } else if (query) {
            executeCryptoSearchWithQuery(query);
        } else {
            window.location.href = 'crypto.html';
        }
    } else {
        setupSearch();
        loadTopCryptos();
    }
}

// ─── Search (single consolidated function) ──────────────────────────────────────

function setupSearch() {
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

// ─── Search Execution ───────────────────────────────────────────────────────────

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
        window.location.href = `crypto-details.html?id=${topResult.id}&symbol=${topResult.symbol}`;
    } catch (error) {
        console.error('Search error:', error);
        showToast('Search failed. Please try again.');
        if (loader) loader.classList.add('hidden-element');
    }
}

// ─── Top Cryptos (Landing Page) ─────────────────────────────────────────────────

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
            bracket.setAttribute('tabindex', '0');

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
                window.location.href = `crypto-details.html?id=${crypto.id}&symbol=${crypto.symbol}`;
            });
            bracket.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    window.location.href = `crypto-details.html?id=${crypto.id}&symbol=${crypto.symbol}`;
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

// ─── Details Page ───────────────────────────────────────────────────────────────

async function displayCryptoDetails(cryptoId, cryptoSymbol = null) {
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

        const params = new URLSearchParams();
        if (cryptoId) params.set('id', cryptoId);
        if (cryptoSymbol) params.set('symbol', cryptoSymbol);

        const [detailsResponse, historyResponse] = await Promise.all([
            fetchWithTimeout(`${BACKEND_URL}/api/crypto/details?${params}`, { timeout: 10000 }),
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
        showToast('Failed to load cryptocurrency details.');
    }
}

// ─── Populate All Details ───────────────────────────────────────────────────────

function populateCryptoDetails(crypto) {
    // ── Data extraction ─────────────────────────────────────────────────────────
    const marketData = crypto.market_data || {};
    const currentPrice = marketData.current_price?.usd || 0;
    currentCryptoPrice = currentPrice; // store for converter

    // Price changes
    const change1h = marketData.price_change_percentage_1h_in_currency?.usd || 0;
    const change24h = marketData.price_change_percentage_24h || 0;
    const change7d = marketData.price_change_percentage_7d || 0;
    const change14d = marketData.price_change_percentage_14d || 0;
    const change30d = marketData.price_change_percentage_30d || 0;
    const change60d = marketData.price_change_percentage_60d || 0;
    const change200d = marketData.price_change_percentage_200d || 0;
    const change1y = marketData.price_change_percentage_1y || 0;

    // Market data
    const marketCap = marketData.market_cap?.usd || 0;
    const volume24h = marketData.total_volume?.usd || 0;
    const high24h = marketData.high_24h?.usd || 0;
    const low24h = marketData.low_24h?.usd || 0;
    const fdv = marketData.fully_diluted_valuation?.usd || 0;
    const mcapFdvRatio = marketData.market_cap_fdv_ratio || (fdv > 0 ? marketCap / fdv : 0);
    const mcapChange24h = marketData.market_cap_change_percentage_24h || 0;
    const volumeToMarketCap = marketCap > 0 ? volume24h / marketCap : 0;

    // ATH / ATL
    const ath = marketData.ath?.usd || 0;
    const athDate = marketData.ath_date?.usd;
    const athChangePct = marketData.ath_change_percentage?.usd || 0;
    const atl = marketData.atl?.usd || 0;
    const atlDate = marketData.atl_date?.usd;
    const atlChangePct = marketData.atl_change_percentage?.usd || 0;

    // Supply
    const circulatingSupply = marketData.circulating_supply || 0;
    const totalSupply = marketData.total_supply || 0;
    const maxSupply = marketData.max_supply || 0;
    const supplyPercent = totalSupply > 0 ? Math.min(100, (circulatingSupply / totalSupply) * 100) : 0;

    // Coin metadata
    const description = crypto.description?.en || '';
    const homepage = crypto.links?.homepage?.[0] || '';
    const twitter = crypto.links?.twitter_screen_name || '';
    const reddit = crypto.links?.subreddit_url || '';
    const github = crypto.links?.repos_url?.github?.[0] || '';
    const categories = crypto.categories || [];
    const genesisDate = crypto.genesis_date || null;
    const hashingAlgorithm = crypto.hashing_algorithm || null;
    const sentimentUp = crypto.sentiment_votes_up_percentage || 0;
    const sentimentDown = crypto.sentiment_votes_down_percentage || 0;
    const watchlistUsers = crypto.watchlist_portfolio_users || 0;

    // Derived values for intel cards
    const rangePercent = currentPrice > 0 && high24h && low24h ? ((high24h - low24h) / currentPrice) * 100 : 0;
    const athGapPercent = currentPrice > 0 && ath > 0 ? ((ath - currentPrice) / ath) * 100 : 0;
    const atlGapPercent = currentPrice > 0 && atl > 0 ? ((currentPrice - atl) / atl) * 100 : 0;

    // Helper for colored percentages in tables
    function coloredPct(val) {
        const color = val >= 0 ? '#10b981' : '#ef4444';
        const prefix = val >= 0 ? '+' : '';
        return `<span style="color: ${color}; font-family: 'JetBrains Mono', monospace;">${prefix}${val.toFixed(2)}%</span>`;
    }

    // ── Hero Card ───────────────────────────────────────────────────────────────
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

    // ── Category Tags ───────────────────────────────────────────────────────────
    const categoryContainer = document.getElementById('crypto-category-tags');
    if (categoryContainer) {
        const visibleCategories = categories.filter(c => c).slice(0, 5);
        categoryContainer.innerHTML = visibleCategories
            .map(cat => `<span class="crypto-category-tag">${escapeHtml(cat)}</span>`)
            .join('');
    }

    // ── Social Links ────────────────────────────────────────────────────────────
    const socialContainer = document.getElementById('crypto-social-links');
    if (socialContainer) {
        let socialHtml = '';
        if (homepage) {
            socialHtml += `<a href="${escapeHtml(homepage)}" class="crypto-social-link" target="_blank" rel="noopener"><i class="fa-solid fa-globe"></i></a>`;
        }
        if (twitter) {
            socialHtml += `<a href="https://twitter.com/${escapeHtml(twitter)}" class="crypto-social-link" target="_blank" rel="noopener"><i class="fa-brands fa-x-twitter"></i></a>`;
        }
        if (reddit) {
            socialHtml += `<a href="${escapeHtml(reddit)}" class="crypto-social-link" target="_blank" rel="noopener"><i class="fa-brands fa-reddit-alien"></i></a>`;
        }
        if (github) {
            socialHtml += `<a href="${escapeHtml(github)}" class="crypto-social-link" target="_blank" rel="noopener"><i class="fa-brands fa-github"></i></a>`;
        }
        socialContainer.innerHTML = socialHtml;
    }

    // ── Timeframe Strip (8 pills) ──────────────────────────────────────────────
    const timeframeStrip = document.getElementById('crypto-timeframe-strip');
    if (timeframeStrip) {
        const timeframes = [
            { label: '1H', value: change1h },
            { label: '24H', value: change24h },
            { label: '7D', value: change7d },
            { label: '14D', value: change14d },
            { label: '30D', value: change30d },
            { label: '60D', value: change60d },
            { label: '200D', value: change200d },
            { label: '1Y', value: change1y },
        ];
        timeframeStrip.innerHTML = timeframes.map(tf => {
            const cls = tf.value > 0 ? 'positive' : tf.value < 0 ? 'negative' : 'neutral';
            const prefix = tf.value > 0 ? '+' : tf.value < 0 ? '-' : '';
            return `<div class="crypto-tf-pill"><span class="tf-label">${tf.label}</span><span class="tf-value ${cls}">${prefix}${Math.abs(tf.value).toFixed(2)}%</span></div>`;
        }).join('');
    }

    // ── KPI Grid ────────────────────────────────────────────────────────────────
    const metricMarketCap = document.getElementById('crypto-metric-market-cap');
    if (metricMarketCap) metricMarketCap.textContent = formatLargeCurrency(marketCap);

    const metricVolume = document.getElementById('crypto-metric-volume');
    if (metricVolume) metricVolume.textContent = formatLargeCurrency(volume24h);

    const metricHigh = document.getElementById('crypto-metric-24h-high');
    if (metricHigh) metricHigh.textContent = high24h ? `$${high24h.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '--';

    const metricLow = document.getElementById('crypto-metric-24h-low');
    if (metricLow) metricLow.textContent = low24h ? `$${low24h.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '--';

    const metricFdv = document.getElementById('crypto-metric-fdv');
    if (metricFdv) metricFdv.textContent = formatLargeCurrency(fdv);

    const metricVolMcap = document.getElementById('crypto-metric-vol-mcap');
    if (metricVolMcap) metricVolMcap.textContent = volumeToMarketCap.toFixed(4);

    const metricMcapChange = document.getElementById('crypto-metric-mcap-change');
    if (metricMcapChange) {
        metricMcapChange.textContent = `${mcapChange24h >= 0 ? '+' : ''}${mcapChange24h.toFixed(2)}%`;
        metricMcapChange.style.color = mcapChange24h >= 0 ? '#10b981' : '#ef4444';
    }

    const metricMcapDominance = document.getElementById('crypto-metric-mcap-dominance');
    if (metricMcapDominance) metricMcapDominance.textContent = `${(mcapFdvRatio * 100).toFixed(2)}%`;

    // ── ATH / ATL Distance Cards ────────────────────────────────────────────────
    const athPriceEl = document.getElementById('crypto-ath-price');
    if (athPriceEl) athPriceEl.textContent = ath ? `$${ath.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '--';

    const athDateEl = document.getElementById('crypto-ath-date-val');
    if (athDateEl) athDateEl.textContent = athDate ? new Date(athDate).toLocaleDateString() : '--';

    const athDistanceEl = document.getElementById('crypto-ath-distance');
    if (athDistanceEl) athDistanceEl.textContent = `${athChangePct.toFixed(2)}%`;

    const athBarEl = document.getElementById('crypto-ath-bar');
    if (athBarEl) athBarEl.style.width = `${Math.max(0, 100 + athChangePct)}%`;

    const atlPriceEl = document.getElementById('crypto-atl-price');
    if (atlPriceEl) atlPriceEl.textContent = atl ? `$${atl.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '--';

    const atlDateEl = document.getElementById('crypto-atl-date-val');
    if (atlDateEl) atlDateEl.textContent = atlDate ? new Date(atlDate).toLocaleDateString() : '--';

    const atlDistanceEl = document.getElementById('crypto-atl-distance');
    if (atlDistanceEl) atlDistanceEl.textContent = `+${atlChangePct.toFixed(2)}%`;

    const atlBarEl = document.getElementById('crypto-atl-bar');
    if (atlBarEl) atlBarEl.style.width = `${Math.min(100, Math.max(5, 100 - Math.min(atlChangePct, 100)))}%`;

    // ── Supply Card ─────────────────────────────────────────────────────────────
    const supplyBarEl = document.getElementById('crypto-supply-bar');
    if (supplyBarEl) supplyBarEl.style.width = `${supplyPercent.toFixed(1)}%`;

    const supplyCircEl = document.getElementById('crypto-supply-circ-val');
    if (supplyCircEl) supplyCircEl.textContent = circulatingSupply ? circulatingSupply.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '--';

    const supplyTotalEl = document.getElementById('crypto-supply-total-val');
    if (supplyTotalEl) supplyTotalEl.textContent = totalSupply ? totalSupply.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '∞';

    const supplyMaxEl = document.getElementById('crypto-supply-max-val');
    if (supplyMaxEl) supplyMaxEl.textContent = maxSupply ? maxSupply.toLocaleString('en-US', { maximumFractionDigits: 0 }) : 'Unlimited';

    const supplyPctEl = document.getElementById('crypto-supply-pct');
    if (supplyPctEl) supplyPctEl.textContent = `${supplyPercent.toFixed(1)}% in circulation`;

    // ── Sentiment Card ──────────────────────────────────────────────────────────
    const sentBullBar = document.getElementById('crypto-sentiment-bull');
    if (sentBullBar) sentBullBar.style.width = `${sentimentUp}%`;

    const sentBullPct = document.getElementById('crypto-sentiment-bull-pct');
    if (sentBullPct) sentBullPct.textContent = `${sentimentUp.toFixed(0)}% Bullish`;

    const sentBearPct = document.getElementById('crypto-sentiment-bear-pct');
    if (sentBearPct) sentBearPct.textContent = `${sentimentDown.toFixed(0)}% Bearish`;

    const watchlistEl = document.getElementById('crypto-watchlist-count');
    if (watchlistEl) {
        if (watchlistUsers > 0) {
            watchlistEl.textContent = `${watchlistUsers.toLocaleString('en-US')} users watching`;
            watchlistEl.style.display = '';
        } else {
            watchlistEl.style.display = 'none';
        }
    }

    // ── Intel Cards ─────────────────────────────────────────────────────────────
    const signalValue = document.getElementById('crypto-signal-value');
    const signalDetail = document.getElementById('crypto-signal-detail');
    const liquidityValue = document.getElementById('crypto-liquidity-value');
    const liquidityDetail = document.getElementById('crypto-liquidity-detail');
    const supplyValue = document.getElementById('crypto-supply-value');
    const supplyDetail = document.getElementById('crypto-supply-detail');
    const rangeValue = document.getElementById('crypto-range-value');
    const rangeDetail = document.getElementById('crypto-range-detail');

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

    // ── Briefing ────────────────────────────────────────────────────────────────
    const briefingBadge = document.getElementById('crypto-briefing-badge');
    const briefingText = document.getElementById('crypto-briefing-text');

    if (briefingBadge) briefingBadge.textContent = signalLabel;
    if (briefingText) {
        const briefDirection = change24h >= 0 ? 'maintaining upward traction' : 'facing pressure';
        const athStatus = ath > 0 ? `${athGapPercent.toFixed(1)}% below ATH` : 'ATH data pending';
        const atlStatus = atl > 0 ? `${atlGapPercent.toFixed(1)}% above ATL` : 'ATL data pending';
        const shortTermCtx = `Short-term (1h): ${change1h >= 0 ? '+' : ''}${change1h.toFixed(1)}%.`;
        const annualCtx = change1y !== 0 ? ` Annual performance: ${change1y >= 0 ? '+' : ''}${change1y.toFixed(1)}%.` : '';
        briefingText.textContent = `${crypto.name} is ${briefDirection} with ${signalDetailText} and ${liquidityDetailText.toLowerCase()}. Current price is ${athStatus} and ${atlStatus}. ${shortTermCtx}${annualCtx}`;
    }

    // ── Overview Table ──────────────────────────────────────────────────────────
    const overviewBody = document.getElementById('crypto-overview-table-body');
    if (overviewBody) {
        overviewBody.innerHTML = `
            <tr><td>Market Cap Rank</td><td>#${crypto.market_cap_rank || '--'}</td></tr>
            <tr><td>Current Price</td><td>$${currentPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td></tr>
            <tr><td>1h Change</td><td>${coloredPct(change1h)}</td></tr>
            <tr><td>24h Change</td><td>${coloredPct(change24h)}</td></tr>
            <tr><td>7d Change</td><td>${coloredPct(change7d)}</td></tr>
            <tr><td>14d Change</td><td>${coloredPct(change14d)}</td></tr>
            <tr><td>30d Change</td><td>${coloredPct(change30d)}</td></tr>
            <tr><td>60d Change</td><td>${coloredPct(change60d)}</td></tr>
            <tr><td>200d Change</td><td>${coloredPct(change200d)}</td></tr>
            <tr><td>1y Change</td><td>${coloredPct(change1y)}</td></tr>
            <tr><td>Market Cap</td><td>${formatLargeCurrency(marketCap)}</td></tr>
            <tr><td>24h Volume</td><td>${formatLargeCurrency(volume24h)}</td></tr>
            <tr><td>Volume / Market Cap</td><td>${volumeToMarketCap.toFixed(4)}</td></tr>
            <tr><td>Fully Diluted Valuation</td><td>${formatLargeCurrency(fdv)}</td></tr>
            <tr><td>Market Cap Change 24h</td><td>${coloredPct(mcapChange24h)}</td></tr>
        `;
    }

    // ── Supply Table ────────────────────────────────────────────────────────────
    const supplyBody = document.getElementById('crypto-supply-table-body');
    if (supplyBody) {
        supplyBody.innerHTML = `
            <tr><td>Circulating Supply</td><td>${circulatingSupply ? circulatingSupply.toLocaleString('en-US', { maximumFractionDigits: 0 }) : 'N/A'}</td></tr>
            <tr><td>Total Supply</td><td>${totalSupply ? totalSupply.toLocaleString('en-US', { maximumFractionDigits: 0 }) : 'N/A'}</td></tr>
            <tr><td>Max Supply</td><td>${maxSupply ? maxSupply.toLocaleString('en-US', { maximumFractionDigits: 0 }) : 'Unlimited'}</td></tr>
            <tr><td>Supply in Circulation</td><td>${supplyPercent.toFixed(2)}%</td></tr>
            <tr><td>Market Cap / FDV</td><td>${(mcapFdvRatio * 100).toFixed(2)}%</td></tr>
            <tr><td>Fully Diluted Valuation</td><td>${formatLargeCurrency(fdv)}</td></tr>
        `;
    }

    // ── Records Table ───────────────────────────────────────────────────────────
    const recordsBody = document.getElementById('crypto-records-table-body');
    if (recordsBody) {
        const athDateStr = athDate ? new Date(athDate).toLocaleDateString() : '--';
        const atlDateStr = atlDate ? new Date(atlDate).toLocaleDateString() : '--';
        const rangeDiff = high24h && low24h ? high24h - low24h : 0;

        recordsBody.innerHTML = `
            <tr><td>All-Time High</td><td>${ath ? `$${ath.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '--'}</td></tr>
            <tr><td>ATH Date</td><td>${athDateStr}</td></tr>
            <tr><td>ATH Change</td><td>${coloredPct(athChangePct)}</td></tr>
            <tr><td>All-Time Low</td><td>${atl ? `$${atl.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '--'}</td></tr>
            <tr><td>ATL Date</td><td>${atlDateStr}</td></tr>
            <tr><td>ATL Change</td><td>${coloredPct(atlChangePct)}</td></tr>
            <tr><td>24h High</td><td>${high24h ? `$${high24h.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '--'}</td></tr>
            <tr><td>24h Low</td><td>${low24h ? `$${low24h.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '--'}</td></tr>
            <tr><td>24h Range</td><td>${rangeDiff ? formatLargeCurrency(rangeDiff) : '--'}</td></tr>
        `;
    }

    // ── Profile Table ───────────────────────────────────────────────────────────
    const profileBody = document.getElementById('crypto-profile-table-body');
    if (profileBody) {
        profileBody.innerHTML = `
            <tr><td>Genesis Date</td><td>${genesisDate || '--'}</td></tr>
            <tr><td>Hashing Algorithm</td><td>${hashingAlgorithm || '--'}</td></tr>
            <tr><td>Categories</td><td>${categories.length > 0 ? escapeHtml(categories.join(', ')) : '--'}</td></tr>
            <tr><td>Watchlist Users</td><td>${watchlistUsers ? watchlistUsers.toLocaleString('en-US') : '--'}</td></tr>
            <tr><td>Community Sentiment</td><td>${sentimentUp.toFixed(0)}% bullish</td></tr>
        `;
    }

    // ── About Section ───────────────────────────────────────────────────────────
    const aboutText = document.getElementById('crypto-about-text');
    if (aboutText) aboutText.innerHTML = description || 'No description available.';

    // ── Converter ───────────────────────────────────────────────────────────────
    const converterSymbol = document.getElementById('crypto-converter-symbol');
    if (converterSymbol) converterSymbol.textContent = (crypto.symbol || '').toUpperCase();

    const converterUsd = document.getElementById('crypto-converter-usd');
    const converterCoin = document.getElementById('crypto-converter-coin');
    if (converterCoin) {
        converterCoin.value = currentPrice > 0 ? (1000 / currentPrice).toFixed(8) : '0';
        converterCoin.readOnly = false;
    }
    if (converterUsd) {
        converterUsd.readOnly = false;
    }
}

// ─── About Toggle ───────────────────────────────────────────────────────────────

function setupAboutToggle() {
    const btn = document.getElementById('crypto-about-toggle');
    const content = document.getElementById('crypto-about-text');
    if (!btn || !content) return;
    btn.addEventListener('click', () => {
        const isCollapsed = content.classList.contains('collapsed');
        content.classList.toggle('collapsed', !isCollapsed);
        content.classList.toggle('expanded', isCollapsed);
        btn.classList.toggle('expanded', isCollapsed);
    });
}

// ─── Converter ──────────────────────────────────────────────────────────────────

function setupConverter() {
    const usdInput = document.getElementById('crypto-converter-usd');
    const coinInput = document.getElementById('crypto-converter-coin');
    if (!usdInput || !coinInput) return;
    
    usdInput.addEventListener('input', () => {
        const usd = parseFloat(usdInput.value) || 0;
        coinInput.value = currentCryptoPrice > 0 ? (usd / currentCryptoPrice).toFixed(8) : '0';
    });

    coinInput.addEventListener('input', () => {
        const coin = parseFloat(coinInput.value) || 0;
        usdInput.value = currentCryptoPrice > 0 ? (coin * currentCryptoPrice).toFixed(2) : '0';
    });
}

// ─── Chart Rendering (verbatim from original) ──────────────────────────────────

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

// ─── Timeframe Selectors (verbatim from original) ──────────────────────────────

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

// ─── History Loader (verbatim from original) ───────────────────────────────────

async function loadCryptoHistoryOnly(cryptoId, days = 365) {
    try {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/crypto/history?id=${encodeURIComponent(cryptoId)}&days=${days}`, { timeout: 10000 });
        const history = await safeJsonParse(response);
        renderCryptoChart(history);
    } catch (error) {
        console.warn('Failed to load crypto history:', error);
    }
}
