// STRATA Institutional Cross-Asset Correlation Engine

let selectedPeriod = '90';
const addCustomTickerBtn = document.getElementById('addCustomTickerBtn');
const customTickerInput = document.getElementById('customTickerInput');
const assetsSelection = document.getElementById('assetsSelection');
const periodToggleButtons = document.querySelectorAll('#periodToggle button');
const calculateBtn = document.getElementById('calculateBtn');
const heatmapTable = document.getElementById('heatmapTable');
const insightsList = document.getElementById('insightsList');
const loader = document.getElementById('loader');
const resultsContainer = document.getElementById('resultsContainer');
const errorMessage = document.getElementById('errorMessage');

// Setup event listeners
if (periodToggleButtons) {
    periodToggleButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            periodToggleButtons.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            selectedPeriod = e.currentTarget.getAttribute('data-period');
        });
    });
}

if (addCustomTickerBtn && customTickerInput) {
    addCustomTickerBtn.addEventListener('click', () => {
        const ticker = customTickerInput.value.trim().toUpperCase();
        if (ticker) {
            const existing = Array.from(assetsSelection.querySelectorAll('input')).find(input => input.value === ticker);
            if (!existing) {
                const label = document.createElement('label');
                label.className = 'checkbox-label';
                label.innerHTML = `<input type="checkbox" value="${ticker}" checked> ${ticker}`;
                assetsSelection.appendChild(label);
            }
            customTickerInput.value = '';
        }
    });

    customTickerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addCustomTickerBtn.click();
        }
    });
}

if (calculateBtn) {
    calculateBtn.addEventListener('click', fetchAndRenderMatrix);
}

function getColorForCorrelation(value) {
    if (value >= 0) {
        const opacity = Math.min(Math.abs(value), 1);
        return `rgba(16, 185, 129, ${opacity * 0.85})`;
    } else {
        const opacity = Math.min(Math.abs(value), 1);
        return `rgba(239, 68, 68, ${opacity * 0.85})`;
    }
}

function formatVal(val) {
    if (val == null || isNaN(val)) return '0.00';
    return Number(val).toFixed(2);
}

function showError(msg) {
    if (!errorMessage) return;
    errorMessage.textContent = msg;
    errorMessage.style.display = 'block';
}

function hideError() {
    if (!errorMessage) return;
    errorMessage.style.display = 'none';
}

async function fetchAndRenderMatrix() {
    const selectedAssets = Array.from(assetsSelection.querySelectorAll('input:checked')).map(cb => cb.value);
    
    if (selectedAssets.length < 2) {
        showError('Please select at least 2 assets to calculate correlation.');
        return;
    }

    hideError();
    if (resultsContainer) resultsContainer.style.display = 'none';
    if (loader) loader.style.display = 'block';

    try {
        const assetsParam = selectedAssets.join(',');
        const response = await fetch(`/api/correlations/matrix?assets=${assetsParam}&period=${selectedPeriod}`);
        
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `API Error: ${response.status}`);
        }
        
        const json = await response.json();
        const data = json.data || json;
        
        const matrix = data.matrix || [];
        const assets = data.assets || selectedAssets;
        const assetStats = data.assetStats || [];
        const diversification = data.diversification || null;
        
        renderHeatmap(assets, matrix);
        renderInsights(assets, matrix, diversification);
        renderAssetStats(assetStats);
        
        if (loader) loader.style.display = 'none';
        if (resultsContainer) resultsContainer.style.display = 'grid';
        
    } catch (err) {
        console.error('Correlation error:', err);
        if (loader) loader.style.display = 'none';
        showError(`Failed to fetch correlation matrix: ${err.message}`);
    }
}

function renderHeatmap(assets, matrix) {
    if (!heatmapTable) return;
    let html = '<thead><tr><th></th>';
    
    for (const asset of assets) {
        html += `<th>${asset}</th>`;
    }
    html += '</tr></thead><tbody>';

    for (let i = 0; i < assets.length; i++) {
        html += `<tr><th style="text-align: left; padding: 10px 14px;">${assets[i]}</th>`;
        for (let j = 0; j < assets.length; j++) {
            const val = matrix[i] ? matrix[i][j] : 0;
            if (i === j) {
                html += `<td class="heatmap-cell diagonal" style="background: rgba(37, 99, 235, 0.2); font-weight: 700; color: #fff;">1.00</td>`;
            } else {
                const color = getColorForCorrelation(val);
                html += `<td class="heatmap-cell" style="background-color: ${color}; color: ${Math.abs(val) > 0.4 ? '#fff' : '#cbd5e1'}; font-weight: 600; padding: 12px 10px;">${formatVal(val)}</td>`;
            }
        }
        html += '</tr>';
    }
    html += '</tbody>';
    heatmapTable.innerHTML = html;
}

function renderInsights(assets, matrix, diversification) {
    if (!insightsList) return;
    let maxPos = { val: -1.1, pair: [] };
    let maxNeg = { val: 1.1, pair: [] };
    let minCorr = { val: 1.1, pair: [] };

    for (let i = 0; i < assets.length; i++) {
        for (let j = i + 1; j < assets.length; j++) {
            const val = matrix[i] ? matrix[i][j] : 0;
            
            if (val > maxPos.val) {
                maxPos = { val, pair: [assets[i], assets[j]] };
            }
            if (val < maxNeg.val) {
                maxNeg = { val, pair: [assets[i], assets[j]] };
            }
            if (Math.abs(val) < Math.abs(minCorr.val)) {
                minCorr = { val, pair: [assets[i], assets[j]] };
            }
        }
    }

    let html = '';

    if (diversification) {
        const scoreColor = diversification.score >= 70 ? '#10b981' : (diversification.score >= 45 ? '#3b82f6' : '#ef4444');
        html += `
            <li style="border-left: 3px solid ${scoreColor}; padding-left: 10px; margin-bottom: 12px; background: rgba(255,255,255,0.02); padding: 8px 10px; border-radius: 4px;">
                <span class="insight-label" style="display: block; font-size: 0.76rem; text-transform: uppercase; color: #94a3b8;">Diversification Score</span>
                <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 4px;">
                    <span style="font-size: 1.4rem; font-weight: 700; color: ${scoreColor}; font-family: monospace;">${diversification.score}/100</span>
                    <span style="font-size: 0.8rem; color: #e2e8f0; font-weight: 500;">${diversification.rating}</span>
                </div>
                <div style="font-size: 0.72rem; color: #64748b; margin-top: 2px;">Avg Pairwise Correlation: ${diversification.avgCorrelation}</div>
            </li>
        `;
    }
    
    if (maxPos.pair.length > 0) {
        html += `
            <li style="margin-bottom: 10px;">
                <span class="insight-label" style="font-size: 0.76rem; color: #94a3b8; display: block;">Highest Positive Co-Movement</span>
                <span class="insight-value positive" style="color: #10b981; font-weight: 600; font-family: monospace;">${maxPos.pair[0]} / ${maxPos.pair[1]} (+${formatVal(maxPos.val)})</span>
            </li>
        `;
    }
    
    if (maxNeg.pair.length > 0 && maxNeg.val < 0) {
        html += `
            <li style="margin-bottom: 10px;">
                <span class="insight-label" style="font-size: 0.76rem; color: #94a3b8; display: block;">Strongest Natural Hedge</span>
                <span class="insight-value negative" style="color: #ef4444; font-weight: 600; font-family: monospace;">${maxNeg.pair[0]} / ${maxNeg.pair[1]} (${formatVal(maxNeg.val)})</span>
            </li>
        `;
    }
    
    if (minCorr.pair.length > 0) {
        html += `
            <li style="margin-bottom: 10px;">
                <span class="insight-label" style="font-size: 0.76rem; color: #94a3b8; display: block;">Most Uncorrelated Pair</span>
                <span class="insight-value neutral" style="color: #38bdf8; font-weight: 600; font-family: monospace;">${minCorr.pair[0]} / ${minCorr.pair[1]} (${formatVal(minCorr.val)})</span>
            </li>
        `;
    }

    insightsList.innerHTML = html;
}

function renderAssetStats(stats) {
    let statsContainer = document.getElementById('correlationAssetStatsContainer');
    if (!statsContainer && resultsContainer) {
        statsContainer = document.createElement('div');
        statsContainer.id = 'correlationAssetStatsContainer';
        statsContainer.style.gridColumn = '1 / -1';
        statsContainer.style.marginTop = '24px';
        statsContainer.style.background = 'var(--card-bg, #0f1629)';
        statsContainer.style.borderRadius = '12px';
        statsContainer.style.padding = '20px';
        statsContainer.style.border = '1px solid rgba(255, 255, 255, 0.05)';
        resultsContainer.appendChild(statsContainer);
    }

    if (!statsContainer || !stats || stats.length === 0) return;

    let rowsHtml = '';
    for (const s of stats) {
        const changeColor = s.periodChangePct >= 0 ? '#10b981' : '#ef4444';
        const changeSign = s.periodChangePct >= 0 ? '+' : '';
        rowsHtml += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                <td style="padding: 10px 14px; font-weight: 600; color: #38bdf8; font-family: monospace;">${s.symbol}</td>
                <td style="padding: 10px 14px; color: #94a3b8;">${s.label}</td>
                <td style="padding: 10px 14px; text-align: right; font-family: monospace;">$${s.currentPrice.toFixed(2)}</td>
                <td style="padding: 10px 14px; text-align: right; color: ${changeColor}; font-weight: 600; font-family: monospace;">${changeSign}${s.periodChangePct.toFixed(2)}%</td>
                <td style="padding: 10px 14px; text-align: right; font-family: monospace;">${s.annualizedVolPct.toFixed(1)}%</td>
                <td style="padding: 10px 14px; text-align: right; font-family: monospace; font-weight: 600; color: ${s.sharpeRatio >= 1 ? '#10b981' : (s.sharpeRatio >= 0 ? '#e2e8f0' : '#ef4444')};">${s.sharpeRatio.toFixed(2)}</td>
            </tr>
        `;
    }

    statsContainer.innerHTML = `
        <h3 style="font-size: 1.05rem; font-weight: 600; margin-bottom: 14px; display: flex; align-items: center; gap: 8px;">
            <i class="fa-solid fa-chart-simple" style="color: #3b82f6;"></i> Asset Volatility & Risk-Adjusted Return Profile
        </h3>
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.88rem;">
                <thead>
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.1); color: #64748b; font-size: 0.78rem; text-transform: uppercase;">
                        <th style="text-align: left; padding: 8px 14px;">Symbol</th>
                        <th style="text-align: left; padding: 8px 14px;">Name</th>
                        <th style="text-align: right; padding: 8px 14px;">Price</th>
                        <th style="text-align: right; padding: 8px 14px;">Period Return</th>
                        <th style="text-align: right; padding: 8px 14px;">Annualized Vol</th>
                        <th style="text-align: right; padding: 8px 14px;">Sharpe Ratio</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        </div>
    `;
}

// Initial auto-load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fetchAndRenderMatrix);
} else {
    fetchAndRenderMatrix();
}
