// STRATA Institutional Equity Screener Module

let currentResults = [];
let currentSort = { column: 'marketCap', direction: 'desc' };
let currentPreset = null;

// UI Elements
const scanBtn = document.getElementById('scanBtn');
const resetBtn = document.getElementById('resetBtn');
const saveScreenBtn = document.getElementById('saveScreenBtn');
const savedScreensSelect = document.getElementById('savedScreens');
const resultsBody = document.getElementById('resultsBody');
const resultsCountBadge = document.getElementById('resultsCountBadge');
const loadingState = document.getElementById('loadingState');
const emptyState = document.getElementById('emptyState');
const resultsTable = document.getElementById('resultsTable');

// Formatters
const formatMoney = (val) => {
    if (val === null || val === undefined) return '-';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
};

const formatCompactNumber = (num) => {
    if (num === null || num === undefined) return '-';
    if (num >= 1e12) return '$' + (num / 1e12).toFixed(2) + 'T';
    if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return '$' + (num / 1e3).toFixed(2) + 'K';
    return '$' + num;
};

const formatVolume = (num) => {
    if (num === null || num === undefined) return '-';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toLocaleString();
};

const formatPercent = (val) => {
    if (val === null || val === undefined) return '-';
    return val.toFixed(2) + '%';
};

// Map DOM inputs to backend filter specifications
const getPayload = () => {
    const mcapMinVal = document.getElementById('mcapMin')?.value;
    const mcapMaxVal = document.getElementById('mcapMax')?.value;
    const priceMinVal = document.getElementById('priceMin')?.value;
    const volumeMinVal = document.getElementById('volumeMin')?.value;
    const dividendMinVal = document.getElementById('dividendMin')?.value;
    const betaMinVal = document.getElementById('betaMin')?.value;
    const betaMaxVal = document.getElementById('betaMax')?.value;
    const sectorVal = document.getElementById('sectorSelect')?.value;
    const countryVal = document.getElementById('countrySelect')?.value;
    const sortByVal = document.getElementById('sortBy')?.value || 'marketCap';
    const sortOrderVal = document.getElementById('sortOrder')?.value || 'desc';

    return {
        filters: {
            marketCapMoreThan: mcapMinVal ? Number(mcapMinVal) : null,
            marketCapLowerThan: mcapMaxVal ? Number(mcapMaxVal) : null,
            priceMoreThan: priceMinVal ? Number(priceMinVal) : null,
            volumeMoreThan: volumeMinVal ? Number(volumeMinVal) : null,
            dividendMoreThan: dividendMinVal ? Number(dividendMinVal) : null,
            betaMoreThan: betaMinVal ? Number(betaMinVal) : null,
            betaLowerThan: betaMaxVal ? Number(betaMaxVal) : null,
            sector: sectorVal || null,
            country: countryVal || 'US',
            preset: currentPreset || null
        },
        sort: sortByVal,
        order: sortOrderVal,
        limit: 50
    };
};

// Preset filters
export function applyPreset(presetName) {
    currentPreset = presetName;
    resetFilters(false);
    
    if (presetName === 'compounders') {
        if (document.getElementById('mcapMin')) document.getElementById('mcapMin').value = '100000000000';
        if (document.getElementById('betaMax')) document.getElementById('betaMax').value = '1.15';
        if (document.getElementById('dividendMin')) document.getElementById('dividendMin').value = '0.5';
    } else if (presetName === 'defensive') {
        if (document.getElementById('betaMax')) document.getElementById('betaMax').value = '0.90';
        if (document.getElementById('sectorSelect')) document.getElementById('sectorSelect').value = 'Consumer Defensive';
    } else if (presetName === 'dividend') {
        if (document.getElementById('dividendMin')) document.getElementById('dividendMin').value = '2.5';
        if (document.getElementById('sortBy')) document.getElementById('sortBy').value = 'dividend';
    } else if (presetName === 'momentum') {
        if (document.getElementById('betaMin')) document.getElementById('betaMin').value = '1.1';
        if (document.getElementById('sortBy')) document.getElementById('sortBy').value = 'changesPercentage';
    }

    scanMarket();
}

// Reset filters
function resetFilters(clearTable = true) {
    document.querySelectorAll('.filter-input').forEach(el => {
        if (el.tagName === 'SELECT') {
            el.selectedIndex = 0;
        } else {
            el.value = '';
        }
    });
    
    if (document.getElementById('countrySelect')) document.getElementById('countrySelect').value = 'US';
    if (document.getElementById('sortBy')) document.getElementById('sortBy').value = 'marketCap';
    if (document.getElementById('sortOrder')) document.getElementById('sortOrder').value = 'desc';
    if (savedScreensSelect) savedScreensSelect.value = '';
    
    if (clearTable) {
        currentPreset = null;
        currentResults = [];
        renderTable();
        if (resultsCountBadge) resultsCountBadge.textContent = 'Ready to scan';
    }
}

// Export Results to CSV
export function exportToCSV() {
    if (!currentResults || currentResults.length === 0) {
        alert('No screener results available to export.');
        return;
    }

    const headers = ['Symbol', 'Company Name', 'Sector', 'Industry', 'Price', 'Change %', 'Market Cap', 'Volume', 'Beta', 'Dividend Yield'];
    const rows = currentResults.map(r => [
        `"${r.symbol || ''}"`,
        `"${(r.companyName || '').replace(/"/g, '""')}"`,
        `"${r.sector || ''}"`,
        `"${r.industry || ''}"`,
        r.price != null ? r.price : '',
        r.changesPercentage != null ? r.changesPercentage : '',
        r.marketCap != null ? r.marketCap : '',
        r.volume != null ? r.volume : '',
        r.beta != null ? r.beta : '',
        r.lastAnnualDividend != null ? r.lastAnnualDividend : ''
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `STRATA_Screener_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Scan Market
export async function scanMarket() {
    const payload = getPayload();
    
    if (resultsTable) resultsTable.classList.add('hidden');
    if (emptyState) emptyState.classList.add('hidden');
    if (loadingState) loadingState.classList.remove('hidden');
    if (resultsCountBadge) resultsCountBadge.textContent = 'Scanning institutional universe...';
    
    try {
        const res = await fetch('/api/screener/scan', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) throw new Error(`API Error: ${res.status}`);
        const data = await res.json();
        
        const responseData = data.data || data;
        currentResults = Array.isArray(responseData) ? responseData : (responseData.results || []);
        
        currentSort.column = payload.sort;
        currentSort.direction = payload.order;
        
        renderTable();
        
    } catch (error) {
        console.error('Scan error:', error);
        if (loadingState) loadingState.classList.add('hidden');
        if (emptyState) emptyState.classList.remove('hidden');
        if (resultsCountBadge) resultsCountBadge.textContent = '0 results found';
    }
}

// Sorting logic
const sortData = (data, column, direction) => {
    return [...data].sort((a, b) => {
        let valA = a[column];
        let valB = b[column];
        
        if (valA === undefined || valA === null) valA = '';
        if (valB === undefined || valB === null) valB = '';
        
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        
        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });
};

// Render Table
const renderTable = () => {
    if (loadingState) loadingState.classList.add('hidden');
    
    if (currentResults.length === 0) {
        if (resultsTable) resultsTable.classList.add('hidden');
        if (emptyState) emptyState.classList.remove('hidden');
        if (resultsCountBadge) resultsCountBadge.textContent = '0 companies found';
        return;
    }
    
    const sorted = sortData(currentResults, currentSort.column, currentSort.direction);
    
    if (resultsBody) {
        resultsBody.innerHTML = sorted.map(row => {
            const chg = row.changesPercentage !== undefined ? row.changesPercentage : (row.changePercent || 0);
            const divVal = row.lastAnnualDividend !== undefined ? row.lastAnnualDividend : null;
            const changeClass = chg >= 0 ? 'text-green' : 'text-red';
            const changeSign = chg >= 0 ? '+' : '';
            
            return `
                <tr onclick="window.location.href='equity-details.html?symbol=${row.symbol}'" style="cursor: pointer;" title="Click to view deep dive fundamentals for ${row.symbol}">
                    <td class="mono-text symbol-cell" style="font-weight: 700; color: #38bdf8;">${row.symbol}</td>
                    <td class="company-cell" title="${row.companyName}">${row.companyName || '-'}</td>
                    <td><span class="badge" style="background: rgba(255,255,255,0.05); font-size: 0.75rem; border-radius: 4px; padding: 2px 6px;">${row.sector || '-'}</span></td>
                    <td class="mono-text" style="font-weight: 600;">${formatMoney(row.price)}</td>
                    <td class="mono-text ${changeClass}" style="font-weight: 600;">${changeSign}${formatPercent(chg)}</td>
                    <td class="mono-text">${formatCompactNumber(row.marketCap)}</td>
                    <td class="mono-text">${formatVolume(row.volume)}</td>
                    <td class="mono-text">${row.beta ? row.beta.toFixed(2) : '-'}</td>
                    <td class="mono-text">${divVal !== null && divVal !== undefined ? divVal.toFixed(2) + '%' : '-'}</td>
                </tr>
            `;
        }).join('');
    }
    
    if (resultsTable) resultsTable.classList.remove('hidden');
    if (emptyState) emptyState.classList.add('hidden');
    if (resultsCountBadge) resultsCountBadge.textContent = `${currentResults.length} companies found`;
    
    document.querySelectorAll('.data-table th i').forEach(i => {
        i.className = 'fa-solid fa-sort';
    });
    
    const activeTh = document.querySelector(`th[data-sort="${currentSort.column}"]`);
    if (activeTh) {
        const icon = activeTh.querySelector('i');
        if (icon) icon.className = currentSort.direction === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
    }
};

// Event Listeners Initialization
function initScreener() {
    if (scanBtn) scanBtn.addEventListener('click', () => { currentPreset = null; scanMarket(); });
    if (resetBtn) resetBtn.addEventListener('click', () => resetFilters(true));

    // Preset Buttons
    document.querySelectorAll('[data-preset]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const p = e.currentTarget.getAttribute('data-preset');
            applyPreset(p);
        });
    });

    // CSV Export Button
    const exportBtn = document.getElementById('exportCsvBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportToCSV);

    // Header Clicks for Sorting
    document.querySelectorAll('.data-table th').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.getAttribute('data-sort');
            if (!column) return;
            
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'desc';
            }
            
            renderTable();
        });
    });

    // Enter Key
    document.querySelectorAll('.filter-input').forEach(el => {
        el.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                currentPreset = null;
                scanMarket();
            }
        });
    });

    // Run initial scan automatically so the user immediately sees the universe
    scanMarket();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScreener);
} else {
    initScreener();
}
