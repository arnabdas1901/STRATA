import { BACKEND_URL, fetchWithTimeout, safeJsonParse, showToast, formatLargeCurrency, setupTabs, setupChartFullscreen, escapeHtml } from '../utils.js';
import { IndicatorManager, setupIndicatorsUI } from './indicators.js';

let cryptoChartInstance = null;
window.cryptoIndicatorManager = null;
let activeCryptoId = null;
let currentCryptoPrice = 0; // for converter
let cryptoChartMode = 'price'; // 'price' or 'mcap'
let lastCryptoHistory = null; // cache for chart mode toggle

// ─── Entry Point ────────────────────────────────────────────────────────────────

export function setupCryptoTracker() {
    const isDetailsPage = window.location.pathname.includes('crypto-details.html');

    if (isDetailsPage) {
        setupSearch();
        setupCryptoTimeframeSelectors();
        setupCryptoChartModeToggle();
        setupIndicatorsUI('crypto', () => window.currentCryptoChartData || [], () => window.cryptoIndicatorManager);
        setupTabs('#dashboard-crypto');
        setupAboutToggle();
        setupConverter();
        setupChartFullscreen();

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

            const rank = crypto.market_cap_rank;
            bracket.innerHTML = `
                ${rank ? `<div class="bracket-rank-badge">#${rank}</div>` : ''}
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
        lastCryptoHistory = history; // cache for chart mode toggle

        if (!detailsResponse || !detailsResponse.ok) throw new Error(details?.error || 'Failed to fetch details');

        populateCryptoDetails(details);

        // Fire Fear & Greed fetch non-blocking (free API, no key needed)
        fetchCryptoFearGreed();

        if (loader) loader.classList.add('hidden-element');
        if (resultsContainer) resultsContainer.classList.remove('hidden-element');

        // Render chart AFTER container is visible so clientWidth/clientHeight are non-zero
        if (history) {
            requestAnimationFrame(() => renderCryptoChart(history));
        }

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

    // Helper for dynamic price formatting
    function formatCryptoPrice(price) {
        if (price == null || isNaN(price) || price === '') return '--';
        const num = Number(price);
        if (num === 0) return '$0.00';
        if (num < 0.01) {
            return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 8 });
        }
        if (num < 1) {
            return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
        }
        return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

    if (priceDisplay) priceDisplay.textContent = formatCryptoPrice(currentPrice);
    if (changeDisplay) {
        const absChange = marketData.price_change_24h || 0;
        const absStr = absChange !== 0 ? ` (${absChange >= 0 ? '+' : ''}${formatCryptoPrice(Math.abs(absChange))})` : '';
        changeDisplay.textContent = `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%${absStr} (24h)`;
        changeDisplay.style.color = change24h >= 0 ? '#10b981' : '#ef4444';
    }

    // BTC / ETH Price Pairs
    const btcEthEl = document.getElementById('crypto-btc-eth-prices');
    if (btcEthEl) {
        const btcPrice = marketData.current_price?.btc;
        const ethPrice = marketData.current_price?.eth;
        let pairs = [];
        if (btcPrice != null && btcPrice > 0) pairs.push(`<span class="pair-label">BTC</span> ${btcPrice < 0.0001 ? btcPrice.toExponential(2) : btcPrice.toFixed(btcPrice < 1 ? 6 : 2)}`);
        if (ethPrice != null && ethPrice > 0) pairs.push(`<span class="pair-label">ETH</span> ${ethPrice < 0.0001 ? ethPrice.toExponential(2) : ethPrice.toFixed(ethPrice < 1 ? 6 : 2)}`);
        btcEthEl.innerHTML = pairs.length > 0 ? pairs.join('<span class="pair-sep">·</span>') : '';
        btcEthEl.style.display = pairs.length > 0 ? '' : 'none';
    }

    // Last Updated Badge
    const lastUpdatedEl = document.getElementById('crypto-last-updated');
    if (lastUpdatedEl && marketData.last_updated) {
        const updatedDate = new Date(marketData.last_updated);
        const diffMs = Date.now() - updatedDate.getTime();
        const diffMin = Math.round(diffMs / 60000);
        lastUpdatedEl.textContent = diffMin < 1 ? 'Just now' : diffMin < 60 ? `${diffMin}m ago` : `${Math.round(diffMin / 60)}h ago`;
        lastUpdatedEl.style.display = '';
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
        const telegram = crypto.links?.telegram_channel_identifier || '';
        if (telegram) {
            socialHtml += `<a href="https://t.me/${escapeHtml(telegram)}" class="crypto-social-link" target="_blank" rel="noopener"><i class="fa-brands fa-telegram"></i></a>`;
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
    if (metricHigh) metricHigh.textContent = formatCryptoPrice(high24h);

    const metricLow = document.getElementById('crypto-metric-24h-low');
    if (metricLow) metricLow.textContent = formatCryptoPrice(low24h);

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
    if (athPriceEl) athPriceEl.textContent = formatCryptoPrice(ath);

    const athDateEl = document.getElementById('crypto-ath-date-val');
    if (athDateEl) athDateEl.textContent = athDate ? new Date(athDate).toLocaleDateString() : '--';

    const athDistanceEl = document.getElementById('crypto-ath-distance');
    if (athDistanceEl) athDistanceEl.textContent = `${athChangePct.toFixed(2)}%`;

    const athBarEl = document.getElementById('crypto-ath-bar');
    if (athBarEl) athBarEl.style.width = `${Math.max(0, 100 + athChangePct)}%`;

    const atlPriceEl = document.getElementById('crypto-atl-price');
    if (atlPriceEl) atlPriceEl.textContent = formatCryptoPrice(atl);

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
            <tr><td>Current Price</td><td>${formatCryptoPrice(currentPrice)}</td></tr>
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
            <tr><td>All-Time High</td><td>${formatCryptoPrice(ath)}</td></tr>
            <tr><td>ATH Date</td><td>${athDateStr}</td></tr>
            <tr><td>ATH Change</td><td>${coloredPct(athChangePct)}</td></tr>
            <tr><td>All-Time Low</td><td>${formatCryptoPrice(atl)}</td></tr>
            <tr><td>ATL Date</td><td>${atlDateStr}</td></tr>
            <tr><td>ATL Change</td><td>${coloredPct(atlChangePct)}</td></tr>
            <tr><td>24h High</td><td>${formatCryptoPrice(high24h)}</td></tr>
            <tr><td>24h Low</td><td>${formatCryptoPrice(low24h)}</td></tr>
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

    // ── Project Health Scores ────────────────────────────────────────────────────
    const healthPanel = document.getElementById('crypto-health-panel');
    if (healthPanel) {
        const scores = [
            { label: 'Overall', value: crypto.coingecko_score, icon: 'fa-star' },
            { label: 'Developer', value: crypto.developer_score, icon: 'fa-code' },
            { label: 'Community', value: crypto.community_score, icon: 'fa-users' },
            { label: 'Liquidity', value: crypto.liquidity_score, icon: 'fa-droplet' },
            { label: 'Public Interest', value: crypto.public_interest_score, icon: 'fa-eye' },
        ];
        const hasScores = scores.some(s => s.value != null && s.value > 0);
        if (hasScores) {
            healthPanel.innerHTML = scores.map(s => {
                const val = s.value != null ? parseFloat(s.value).toFixed(1) : '--';
                const pct = s.value != null ? Math.min(100, s.value) : 0;
                const hue = pct > 60 ? 160 : pct > 30 ? 45 : 0; // green > yellow > red
                return `
                    <div class="health-score-item">
                        <div class="health-score-header">
                            <i class="fa-solid ${s.icon}"></i>
                            <span class="health-score-label">${s.label}</span>
                            <span class="health-score-val font-mono">${val}</span>
                        </div>
                        <div class="health-score-bar-track">
                            <div class="health-score-bar-fill" style="width:${pct}%;background:hsl(${hue},70%,50%)"></div>
                        </div>
                    </div>
                `;
            }).join('');
            healthPanel.style.display = '';
        }
    }

    // ── Smart Contract Address ───────────────────────────────────────────────────
    const contractCard = document.getElementById('crypto-contract-card');
    if (contractCard) {
        const platforms = crypto.platforms || {};
        const platformId = crypto.asset_platform_id || '';
        const entries = Object.entries(platforms).filter(([, addr]) => addr && addr.length > 5);
        if (entries.length > 0) {
            const [chain, address] = entries[0];
            const chainLabel = chain.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const shortAddr = address.length > 16 ? address.slice(0, 8) + '...' + address.slice(-6) : address;
            contractCard.innerHTML = `
                <div class="contract-chain-badge"><i class="fa-solid fa-link-simple"></i> ${escapeHtml(chainLabel)}</div>
                <div class="contract-address-row">
                    <code class="contract-addr font-mono">${escapeHtml(shortAddr)}</code>
                    <button class="contract-copy-btn" title="Copy full address" data-addr="${escapeHtml(address)}">
                        <i class="fa-regular fa-copy"></i>
                    </button>
                </div>
            `;
            contractCard.style.display = '';
            contractCard.querySelector('.contract-copy-btn')?.addEventListener('click', (e) => {
                const addr = e.currentTarget.getAttribute('data-addr');
                navigator.clipboard.writeText(addr).then(() => showToast('Contract address copied!')).catch(() => {});
            });
        }
    }

    // ── 24h High / Low Range Bar ─────────────────────────────────────────────────
    if (high24h > 0 && low24h > 0 && currentPrice > 0) {
        const rangePct = Math.min(100, Math.max(0, ((currentPrice - low24h) / (high24h - low24h)) * 100));

        const fillEl   = document.getElementById('crypto-range-fill');
        const thumbEl  = document.getElementById('crypto-range-thumb');
        const lowPrEl  = document.getElementById('crypto-range-low-price');
        const highPrEl = document.getElementById('crypto-range-high-price');
        const curPrEl  = document.getElementById('crypto-range-current-price');
        const pctEl    = document.getElementById('crypto-range-position-pct');

        if (fillEl)   fillEl.style.width  = `${rangePct}%`;
        if (thumbEl)  thumbEl.style.left  = `${rangePct}%`;
        if (lowPrEl)  lowPrEl.textContent  = formatCryptoPrice(low24h);
        if (highPrEl) highPrEl.textContent = formatCryptoPrice(high24h);
        if (curPrEl)  curPrEl.textContent  = formatCryptoPrice(currentPrice);
        if (pctEl)    pctEl.textContent    = `${rangePct.toFixed(1)}%`;
    }

    // ── About Section ─────────────────────────────────────────────────────────────
    const aboutText = document.getElementById('crypto-about-text');
    if (aboutText) aboutText.innerHTML = description || 'No description available.';

    // ── Converter ─────────────────────────────────────────────────────────────────
    const converterSymbol = document.getElementById('crypto-converter-symbol');
    if (converterSymbol) converterSymbol.textContent = (crypto.symbol || '').toUpperCase();

    const converterUsd  = document.getElementById('crypto-converter-usd');
    const converterCoin = document.getElementById('crypto-converter-coin');
    if (converterCoin) {
        converterCoin.value = currentPrice > 0 ? (1000 / currentPrice).toFixed(8) : '0';
        converterCoin.readOnly = false;
    }
    if (converterUsd) converterUsd.readOnly = false;
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

// ─── Crypto Fear & Greed Index (alternative.me — completely free, no key) ───────

async function fetchCryptoFearGreed() {
    const needle    = document.getElementById('crypto-fng-needle');
    const valueEl   = document.getElementById('crypto-fng-value');
    const labelEl   = document.getElementById('crypto-fng-label');
    const todayEl   = document.getElementById('crypto-fng-today');
    const yestEl    = document.getElementById('crypto-fng-yesterday');
    const weekEl    = document.getElementById('crypto-fng-lastweek');

    if (!needle || !valueEl || !labelEl) return;

    const fngClass = (val) => {
        if (val <= 20) return { label: 'Extreme Fear', cls: 'extreme-fear' };
        if (val <= 40) return { label: 'Fear',         cls: 'fear' };
        if (val <= 60) return { label: 'Neutral',      cls: 'neutral' };
        if (val <= 80) return { label: 'Greed',        cls: 'greed' };
        return             { label: 'Extreme Greed',   cls: 'extreme-greed' };
    };

    const fngRow = (val, classification) =>
        `${val} — ${classification.label}`;

    try {
        // Fetch today + yesterday + last week (limit=8 gives us enough history)
        const res = await fetch('https://api.alternative.me/fng/?limit=8&format=json');
        if (!res.ok) throw new Error('FNG API error');
        const json = await res.json();
        const entries = json.data || [];

        if (!entries.length) throw new Error('No data');

        const today     = parseInt(entries[0]?.value, 10);
        const yesterday = parseInt(entries[1]?.value, 10);
        const lastWeek  = parseInt(entries[6]?.value, 10);

        const todayCls = fngClass(today);

        // Animate needle
        const angle = -90 + (today / 100) * 180;
        needle.setAttribute('transform', `rotate(${angle}, 100, 100)`);

        valueEl.textContent = today;
        labelEl.textContent = todayCls.label;
        labelEl.className   = `sentiment-score-label ${todayCls.cls}`;

        if (todayEl)  { todayEl.textContent = fngRow(today, todayCls); todayEl.className = `sf-value sf-${today >= 50 ? 'positive' : 'negative'}`; }
        if (yestEl  && !isNaN(yesterday)) { const c = fngClass(yesterday); yestEl.textContent = fngRow(yesterday, c); yestEl.className = `sf-value sf-${yesterday >= 50 ? 'positive' : 'negative'}`; }
        if (weekEl  && !isNaN(lastWeek))  { const c = fngClass(lastWeek);  weekEl.textContent = fngRow(lastWeek,  c); weekEl.className = `sf-value sf-${lastWeek  >= 50 ? 'positive' : 'negative'}`; }

    } catch (err) {
        console.warn('Crypto Fear & Greed fetch failed:', err);
        if (valueEl) valueEl.textContent = '--';
        if (labelEl) { labelEl.textContent = 'Unavailable'; labelEl.className = 'sentiment-score-label neutral'; }
    }
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
    const isMcapMode = cryptoChartMode === 'mcap';
    const rawPrices = isMcapMode ? (history?.market_caps || history?.prices || []) : (history?.prices || []);
    const rawVolumes = history?.total_volumes || [];

    if (!rawPrices || rawPrices.length === 0) return;

    const container = document.getElementById('cryptoHistoricalChart');
    if (!container) return;

    // Clean up previous chart instance
    if (cryptoChartInstance) {
        if (cryptoChartInstance._resizeObserver) {
            cryptoChartInstance._resizeObserver.disconnect();
        }
        cryptoChartInstance.remove();
        cryptoChartInstance = null;
    }
    container.innerHTML = '';

    const dataPoints = rawPrices.map(([, price]) => price);
    const isPositive = dataPoints[dataPoints.length - 1] >= dataPoints[0];
    const accentColor = isPositive ? '#10b981' : '#ef4444';

    // Guarantee chart gets correct dimensions (safety net for any edge-case timing)
    const containerW = container.clientWidth || container.offsetWidth || 800;
    const containerH = container.clientHeight || container.offsetHeight || 420;

    // Create chart
    const chart = LightweightCharts.createChart(container, {
        width: containerW,
        height: containerH,
        layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: '#9ca3af',
            fontFamily: "'JetBrains Mono', 'Inter', monospace",
            fontSize: 11,
        },
        grid: {
            vertLines: { visible: false },
            horzLines: { visible: false },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: {
                color: 'rgba(99, 179, 237, 0.6)',
                width: 1,
                style: LightweightCharts.LineStyle.Solid,
                labelBackgroundColor: '#1e40af',
            },
            horzLine: {
                color: 'rgba(99, 179, 237, 0.6)',
                width: 1,
                style: LightweightCharts.LineStyle.Solid,
                labelBackgroundColor: '#1e40af',
            },
        },
        rightPriceScale: {
            borderVisible: false,
            scaleMargins: { top: 0.1, bottom: 0.25 },
            textColor: '#6b7280',
        },
        timeScale: {
            borderVisible: false,
            timeVisible: true,
            secondsVisible: false,
            fixLeftEdge: true,
            fixRightEdge: true,
            tickMarkFormatter: (time) => {
                const d = typeof time === 'string' ? new Date(time) : new Date(time * 1000);
                return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
            },
        },
        handleScroll: { vertTouchDrag: false, mouseWheel: true, pressedMouseMove: true },
        handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });

    // Price/MCap area series
    const mainSeries = chart.addSeries(LightweightCharts.AreaSeries, {
        topColor: isPositive ? 'rgba(0, 208, 156, 0.6)' : 'rgba(255, 107, 107, 0.6)',
        bottomColor: isPositive ? 'rgba(0, 208, 156, 0.01)' : 'rgba(255, 107, 107, 0.01)',
        lineColor: isPositive ? '#00d09c' : '#ff6b6b',
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: '#ffffff',
        crosshairMarkerBorderWidth: 1.5,
        crosshairMarkerBackgroundColor: isPositive ? '#00d09c' : '#ff6b6b',
        priceFormat: isMcapMode
            ? { type: 'custom', formatter: (val) => val >= 1e12 ? '$' + (val/1e12).toFixed(2) + 'T' : val >= 1e9 ? '$' + (val/1e9).toFixed(2) + 'B' : val >= 1e6 ? '$' + (val/1e6).toFixed(1) + 'M' : '$' + val.toLocaleString() }
            : { type: 'custom', formatter: (val) => '$' + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
    });

    // Convert CoinGecko timestamps to YYYY-MM-DD format for lightweight-charts
    const priceData = rawPrices.map(([timestamp, price]) => {
        const d = new Date(timestamp);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return { time: `${yyyy}-${mm}-${dd}`, value: price };
    });

    // Deduplicate by time (CoinGecko can return multiple points per day)
    const uniquePriceData = [];
    const seenDates = new Set();
    for (const item of priceData) {
        if (!seenDates.has(item.time)) {
            seenDates.add(item.time);
            uniquePriceData.push(item);
        }
    }
    mainSeries.setData(uniquePriceData);

    // Current price line
    const lastPrice = dataPoints[dataPoints.length - 1];
    mainSeries.createPriceLine({
        price: lastPrice,
        color: accentColor,
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: '',
    });

    // Volume histogram series
    const volumeData = rawVolumes.map(([timestamp, volume], i) => {
        const d = new Date(timestamp);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const currPrice = i < rawPrices.length ? rawPrices[i][1] : 0;
        const prevPrice = i > 0 && i - 1 < rawPrices.length ? rawPrices[i - 1][1] : currPrice;
        return {
            time: `${yyyy}-${mm}-${dd}`,
            value: volume || 0,
            color: currPrice >= prevPrice ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)',
        };
    });

    // Deduplicate volume data too
    const uniqueVolumeData = [];
    const seenVolDates = new Set();
    for (const item of volumeData) {
        if (!seenVolDates.has(item.time)) {
            seenVolDates.add(item.time);
            uniqueVolumeData.push(item);
        }
    }

    const volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
    });
    volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeries.setData(uniqueVolumeData);

    // ── % Return Label ────────────────────────────────────────────────────────
    const firstVal = dataPoints[0];
    const lastVal = dataPoints[dataPoints.length - 1];
    const retPct = ((lastVal - firstVal) / firstVal * 100);
    const retStr = `${retPct >= 0 ? '▲ +' : '▼ '}${retPct.toFixed(2)}%`;
    let retLabel = container.querySelector('.chart-return-label');
    if (!retLabel) {
        retLabel = document.createElement('div');
        container.appendChild(retLabel);
    }
    retLabel.className = `chart-return-label ${isPositive ? 'positive' : 'negative'}`;
    retLabel.textContent = retStr;

    // ── STRATA Watermark ──────────────────────────────────────────────────────
    try {
        LightweightCharts.createTextWatermark(chart.panes()[0], {
            horzAlign: 'center', vertAlign: 'center',
            lines: [{ text: 'STRATA', color: 'rgba(255,255,255,0.022)', fontSize: 56, fontStyle: 'bold', fontFamily: "'Inter', sans-serif" }],
        });
    } catch (e) { /* optional */ }

    // Floating tooltip (Zerodha-style)
    const toolTipEl = document.createElement('div');
    toolTipEl.className = 'lw-chart-tooltip';
    container.appendChild(toolTipEl);

    chart.subscribeCrosshairMove(param => {
        if (!param || !param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
            toolTipEl.style.display = 'none';
            return;
        }

        const pricePoint = param.seriesData.get(mainSeries);
        const volPoint = param.seriesData.get(volumeSeries);
        if (!pricePoint) { toolTipEl.style.display = 'none'; return; }

        const d = typeof param.time === 'string' ? new Date(param.time) : new Date(param.time * 1000);
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const val = pricePoint.value;
        const volStr = volPoint ? '$' + volPoint.value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—';

        let priceStr;
        if (isMcapMode) {
            priceStr = val >= 1e12 ? '$' + (val/1e12).toFixed(2) + 'T' : val >= 1e9 ? '$' + (val/1e9).toFixed(2) + 'B' : val >= 1e6 ? '$' + (val/1e6).toFixed(1) + 'M' : '$' + val.toLocaleString();
        } else {
            priceStr = '$' + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        let tooltipHtml = `
            <div class="tt-date">${dateStr}</div>
            <div class="tt-row"><span class="tt-label">${isMcapMode ? 'MCap' : 'Price'}</span><span class="tt-val">${priceStr}</span></div>
            <div class="tt-row tt-vol"><span class="tt-label">Vol</span><span class="tt-val">${volStr}</span></div>
        `;
        
        if (window.cryptoIndicatorManager) {
            tooltipHtml += window.cryptoIndicatorManager.getTooltipData(param);
        }
        toolTipEl.innerHTML = tooltipHtml;
        toolTipEl.style.display = 'block';

        const chartRect = container.getBoundingClientRect();
        const tooltipWidth = 160;
        const tooltipHeight = toolTipEl.offsetHeight || 80;
        let left = param.point.x + 16;
        let top = param.point.y - tooltipHeight / 2;

        if (left + tooltipWidth > chartRect.width) left = param.point.x - tooltipWidth - 16;
        if (top < 0) top = 4;
        if (top + tooltipHeight > chartRect.height) top = chartRect.height - tooltipHeight - 4;

        toolTipEl.style.left = left + 'px';
        toolTipEl.style.top = top + 'px';
    });

    // Fit content
    chart.timeScale().fitContent();

    // Responsive resize — immediate size sync
    const resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) {
                chart.applyOptions({ width, height });
                chart.timeScale().fitContent();
            }
        }
    });
    resizeObserver.observe(container);

    // Double-safety: force explicit size after next two frames
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const w = container.clientWidth;
            const h = container.clientHeight;
            if (w > 0 && h > 0) {
                chart.applyOptions({ width: w, height: h });
                chart.timeScale().fitContent();
            }
        });
    });

    cryptoChartInstance = chart;
    cryptoChartInstance._resizeObserver = resizeObserver;

    window.currentCryptoChartData = uniquePriceData;
    window.cryptoIndicatorManager = new IndicatorManager(chart, mainSeries, volumeSeries);
    const menu = document.getElementById('crypto-indicator-menu');
    if (menu) {
        menu.querySelectorAll('input').forEach(input => {
            if (input.checked) {
                window.cryptoIndicatorManager.active[input.value] = false;
                window.cryptoIndicatorManager.toggle(input.value, uniquePriceData);
            }
        });
    }
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
        lastCryptoHistory = history; // update cache
        renderCryptoChart(history);
    } catch (error) {
        console.warn('Failed to load crypto history:', error);
    }
}

// ─── Chart Mode Toggle (Price ↔ Market Cap) ─────────────────────────────────────

function setupCryptoChartModeToggle() {
    const toggle = document.getElementById('crypto-chart-mode-toggle');
    if (!toggle) return;

    toggle.querySelectorAll('.chart-mode-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const mode = btn.getAttribute('data-mode');
            if (mode === cryptoChartMode) return;

            cryptoChartMode = mode;
            toggle.querySelectorAll('.chart-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (lastCryptoHistory) {
                renderCryptoChart(lastCryptoHistory);
            }
        });
    });
}
