const express = require('express');
const router = express.Router();
const { MemoryCache } = require('../utils/cache');
const { wrapWithProvenance, DATA_QUALITY } = require('../utils/provenance');
const { fetchYahooChart } = require('../utils/equityProviders');

const cache = new MemoryCache();

const DEFAULT_ASSETS = ['SPY', 'QQQ', 'GLD', 'USO', 'BTC-USD', 'DX-Y.NYB', 'TLT'];
const DEFAULT_LABELS = ['S&P 500', 'NASDAQ', 'Gold', 'Oil', 'Bitcoin', 'US Dollar', '20Y Treasury'];
const RANGE_MAP = { 30: '1mo', 90: '3mo', 365: '1y' };

function computeReturns(prices) {
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
        returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    return returns;
}

function computePearson(x, y) {
    const n = Math.min(x.length, y.length);
    if (n === 0) return 0;
    const xMean = x.reduce((a, b) => a + b, 0) / n;
    const yMean = y.reduce((a, b) => a + b, 0) / n;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
        const dx = x[i] - xMean;
        const dy = y[i] - yMean;
        num += dx * dy;
        denX += dx * dx;
        denY += dy * dy;
    }
    if (denX === 0 || denY === 0) return 0;
    return num / Math.sqrt(denX * denY);
}

router.get('/matrix', async (req, res) => {
    try {
        let assets = req.query.assets ? req.query.assets.split(',').map(s => s.trim()) : DEFAULT_ASSETS;
        let labels = req.query.labels ? req.query.labels.split(',').map(s => s.trim()) : DEFAULT_LABELS;
        const period = parseInt(req.query.period) || 90;
        const range = RANGE_MAP[period] || '3mo';
        
        // If custom assets, we don't have predefined labels for all, just use tickers as labels
        if (req.query.assets && !req.query.labels) {
            labels = assets;
        }

        const cacheKey = `${assets.join(',')}_${period}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const charts = [];
        for (const asset of assets) {
            try {
                const chartData = await fetchYahooChart(asset, range, '1d');
                if (chartData.error || !chartData.chartData || chartData.chartData.length === 0) {
                    return res.status(400).json({ error: `No data available for ${asset}` });
                }
                charts.push(chartData.chartData); // [{time (unix), close}]
            } catch (err) {
                return res.status(400).json({ error: `Failed to fetch data for ${asset}: ${err.message}` });
            }
        }

        // Convert unix timestamps to date strings and build date-keyed maps
        const dateMaps = charts.map(cd => {
            const map = {};
            cd.forEach(point => {
                const dateStr = new Date(point.time * 1000).toISOString().split('T')[0];
                map[dateStr] = point.close;
            });
            return map;
        });

        // Find common dates across all assets
        const allDateSets = dateMaps.map(m => new Set(Object.keys(m)));
        const firstDates = Object.keys(dateMaps[0]);
        let commonDates = firstDates.filter(date => allDateSets.every(set => set.has(date)));
        commonDates.sort();

        if (commonDates.length < 5) {
            return res.status(400).json({ error: 'Not enough overlapping data points across assets' });
        }

        // Extract aligned prices
        const prices = dateMaps.map(map => commonDates.map(date => map[date]));

        // Compute returns
        const returns = prices.map(p => computeReturns(p));

        // Compute correlation matrix
        const matrix = [];
        for (let i = 0; i < assets.length; i++) {
            const row = [];
            for (let j = 0; j < assets.length; j++) {
                if (i === j) {
                    row.push(1.0);
                } else if (j < i) {
                    row.push(matrix[j][i]);
                } else {
                    row.push(parseFloat(computePearson(returns[i], returns[j]).toFixed(4)));
                }
            }
            matrix.push(row);
        }

        const result = {
            assets,
            labels,
            period,
            matrix
        };

        const finalResult = wrapWithProvenance(result, {
            provider: 'yahoo',
            dataQuality: DATA_QUALITY.PROVIDER
        });

        cache.set(cacheKey, finalResult, 6 * 60 * 60 * 1000); // 6 hours
        res.json(finalResult);
    } catch (error) {
        console.error('Error in /correlations/matrix:', error);
        res.status(500).json({ error: 'Failed to generate correlation matrix' });
    }
});

module.exports = router;
