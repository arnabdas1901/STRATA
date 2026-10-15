const express = require('express');
const router = express.Router();
const { MemoryCache } = require('../utils/cache');
const { wrapWithProvenance, DATA_QUALITY, FRESHNESS } = require('../utils/provenance');
const { fetchYahooChart } = require('../utils/equityProviders');

const cache = new MemoryCache('correlations', 6 * 60 * 60 * 1000, 50);

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

function mean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
    if (arr.length === 0) return 0;
    const avg = mean(arr);
    const varSum = arr.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0);
    return Math.sqrt(varSum / arr.length);
}

async function handleMatrix(req, res) {
    try {
        const params = { ...req.query, ...req.body };
        let assets = params.assets || params.symbols;
        if (typeof assets === 'string') {
            assets = assets.split(',').map(s => s.trim().toUpperCase());
        } else if (Array.isArray(assets)) {
            assets = assets.map(s => String(s).trim().toUpperCase());
        } else {
            assets = DEFAULT_ASSETS;
        }

        let labels = params.labels;
        if (typeof labels === 'string') {
            labels = labels.split(',').map(s => s.trim());
        } else if (Array.isArray(labels)) {
            labels = labels.map(s => String(s).trim());
        } else {
            labels = (params.assets || params.symbols) ? assets : DEFAULT_LABELS;
        }

        let period = params.period;
        if (period === '1mo' || period === '30') period = 30;
        else if (period === '3mo' || period === '90') period = 90;
        else if (period === '1y' || period === '365' || period === '1Y') period = 365;
        else period = parseInt(period) || 90;

        const range = RANGE_MAP[period] || '3mo';

        const cacheKey = `${assets.join(',')}_${period}`;
        const cached = cache.getData(cacheKey);
        if (cached) {
            return res.json(wrapWithProvenance(cached, {
                provider: 'Yahoo Finance',
                freshness: FRESHNESS.CACHED,
                dataQuality: DATA_QUALITY.PROVIDER,
                endpoint: 'correlations_matrix'
            }));
        }

        // Parallelize fetching charts across all selected assets
        const chartResponses = await Promise.all(
            assets.map(asset => fetchYahooChart(asset, range, '1d').catch(err => ({ error: err.message })))
        );

        const charts = [];
        const rawChartMetas = [];
        for (let idx = 0; idx < assets.length; idx++) {
            const chartData = chartResponses[idx];
            if (chartData.error || !chartData.chartData || chartData.chartData.length === 0) {
                return res.status(400).json({ error: `No market data available for asset ${assets[idx]}` });
            }
            charts.push(chartData.chartData);
            rawChartMetas.push(chartData);
        }

        // Build date-keyed maps
        const dateMaps = charts.map(cd => {
            const map = {};
            cd.forEach(point => {
                const dateStr = new Date(point.time * 1000).toISOString().split('T')[0];
                map[dateStr] = point.close;
            });
            return map;
        });

        // Find common intersecting trading dates across all assets
        const allDateSets = dateMaps.map(m => new Set(Object.keys(m)));
        const firstDates = Object.keys(dateMaps[0]);
        let commonDates = firstDates.filter(date => allDateSets.every(set => set.has(date)));
        commonDates.sort();

        if (commonDates.length < 5) {
            return res.status(400).json({ error: 'Not enough overlapping date points across chosen assets' });
        }

        // Extract aligned prices
        const prices = dateMaps.map(map => commonDates.map(date => map[date]));

        // Compute returns for correlation and per-asset statistics
        const returns = prices.map(p => computeReturns(p));
        const riskFreeRate = 0.045;

        const assetStats = assets.map((sym, idx) => {
            const r = returns[idx];
            const p = prices[idx];
            const startPrice = p[0];
            const endPrice = p[p.length - 1];
            const periodChangePct = startPrice > 0 ? Number((((endPrice - startPrice) / startPrice) * 100).toFixed(2)) : 0;
            const annReturn = Number((mean(r) * 252 * 100).toFixed(2));
            const annVol = Number((stddev(r) * Math.sqrt(252) * 100).toFixed(2));
            const sharpe = annVol > 0 ? Number(((annReturn / 100 - riskFreeRate) / (annVol / 100)).toFixed(2)) : 0;

            return {
                symbol: sym,
                label: labels[idx] || sym,
                currentPrice: Number(endPrice.toFixed(2)),
                periodChangePct,
                annualizedReturnPct: annReturn,
                annualizedVolPct: annVol,
                sharpeRatio: sharpe
            };
        });

        // Compute Pearson correlation matrix
        const matrix = [];
        const offDiagonalCorrelations = [];

        for (let i = 0; i < assets.length; i++) {
            const row = [];
            for (let j = 0; j < assets.length; j++) {
                if (i === j) {
                    row.push(1.0);
                } else if (j < i) {
                    row.push(matrix[j][i]);
                } else {
                    const corr = parseFloat(computePearson(returns[i], returns[j]).toFixed(4));
                    row.push(corr);
                    offDiagonalCorrelations.push(corr);
                }
            }
            matrix.push(row);
        }

        // Compute Institutional Diversification Score
        const avgCorr = offDiagonalCorrelations.length > 0 
            ? mean(offDiagonalCorrelations) 
            : 0;
        const diversificationScore = Math.max(0, Math.min(100, Math.round((1 - avgCorr) * 50 + 50)));
        const diversificationRating = diversificationScore >= 70 ? 'High Diversification' : (diversificationScore >= 45 ? 'Moderate Diversification' : 'Concentrated / High Co-Movement');

        const result = {
            assets,
            labels,
            period,
            matrix,
            assetStats,
            diversification: {
                score: diversificationScore,
                rating: diversificationRating,
                avgCorrelation: Number(avgCorr.toFixed(3))
            }
        };

        const finalResult = wrapWithProvenance(result, {
            provider: 'Yahoo Finance',
            freshness: FRESHNESS.LIVE,
            dataQuality: DATA_QUALITY.PROVIDER,
            endpoint: 'correlations_matrix'
        });

        cache.set(cacheKey, result);
        res.json(finalResult);
    } catch (error) {
        console.error('Error in /correlations/matrix:', error);
        res.status(500).json({ error: 'Failed to generate correlation matrix', details: error.message });
    }
}

router.get('/matrix', handleMatrix);
router.post('/matrix', handleMatrix);

module.exports = router;
