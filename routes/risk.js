const express = require('express');
const router = express.Router();
const { normalizeTicker } = require('../utils/api');
const { MemoryCache } = require('../utils/cache');
const { wrapWithProvenance, DATA_QUALITY } = require('../utils/provenance');
const { fetchYahooChart } = require('../utils/equityProviders');

const cache = new MemoryCache();

function computeReturns(prices) {
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
        returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    return returns;
}

function mean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr, m) {
    if (arr.length === 0) return 0;
    const avg = m !== undefined ? m : mean(arr);
    const varSum = arr.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0);
    return Math.sqrt(varSum / arr.length);
}

function covariance(x, y) {
    const n = Math.min(x.length, y.length);
    if (n === 0) return 0;
    const xMean = mean(x);
    const yMean = mean(y);
    let cov = 0;
    for (let i = 0; i < n; i++) {
        cov += (x[i] - xMean) * (y[i] - yMean);
    }
    return cov / n;
}

function percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = lower + 1;
    const weight = index - lower;
    if (upper >= sorted.length) return sorted[lower];
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

router.get('/profile/:ticker', async (req, res) => {
    try {
        const ticker = normalizeTicker(req.params.ticker);
        const period = req.query.period || '1y';
        const cacheKey = `risk_profile_${ticker}_${period}`;
        
        const cached = cache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const chartResult = await fetchYahooChart(ticker, period, '1d');
        const spyResult = await fetchYahooChart('SPY', period, '1d');

        if (chartResult.error || !chartResult.chartData || chartResult.chartData.length === 0) {
            return res.status(400).json({ error: `No data available for ${ticker}` });
        }
        if (spyResult.error || !spyResult.chartData || spyResult.chartData.length === 0) {
            return res.status(400).json({ error: 'No SPY benchmark data available' });
        }

        // Convert chartData [{time (unix), close}] to [{date, close}]
        const toDateSeries = (cd) => cd.map(p => ({
            date: new Date(p.time * 1000).toISOString().split('T')[0],
            close: p.close
        }));
        const assetQuotes = toDateSeries(chartResult.chartData);
        const spyQuotes = toDateSeries(spyResult.chartData);

        // Align dates for Beta computation
        const datesMap = new Map();
        assetQuotes.forEach(q => datesMap.set(q.date, { asset: q.close }));
        spyQuotes.forEach(q => {
            if (datesMap.has(q.date)) datesMap.get(q.date).spy = q.close;
        });

        const alignedDates = Array.from(datesMap.keys()).filter(d => datesMap.get(d).asset && datesMap.get(d).spy).sort();
        const assetPrices = alignedDates.map(d => datesMap.get(d).asset);
        const spyPrices = alignedDates.map(d => datesMap.get(d).spy);

        const assetReturns = computeReturns(assetPrices);
        const spyReturns = computeReturns(spyPrices);

        const annualMeanReturn = mean(assetReturns) * 252;
        const annualizedVol = stddev(assetReturns) * Math.sqrt(252);
        const riskFreeRate = 0.045; // 4.5%

        // Rolling 30D Volatility
        const rollingVol = [];
        for (let i = 29; i < assetReturns.length; i++) {
            const windowReturns = assetReturns.slice(i - 29, i + 1);
            rollingVol.push({
                date: alignedDates[i + 1],
                value: stddev(windowReturns) * Math.sqrt(252)
            });
        }

        // Rolling 60D Beta
        const rollingBeta = [];
        for (let i = 59; i < assetReturns.length; i++) {
            const windowAsset = assetReturns.slice(i - 59, i + 1);
            const windowSpy = spyReturns.slice(i - 59, i + 1);
            const cov = covariance(windowAsset, windowSpy);
            const varSpy = stddev(windowSpy) ** 2;
            rollingBeta.push({
                date: alignedDates[i + 1],
                value: varSpy === 0 ? 1 : cov / varSpy
            });
        }

        // Beta
        const overallCov = covariance(assetReturns, spyReturns);
        const overallSpyVar = stddev(spyReturns) ** 2;
        const beta = overallSpyVar === 0 ? 1 : overallCov / overallSpyVar;

        // Max Drawdown & Recovery
        let maxDrawdown = 0;
        let mdStart = alignedDates[0], mdEnd = alignedDates[0];
        let recoveryDays = 0;
        let recovered = true;
        let currentPeak = assetPrices[0];
        let currentPeakDate = alignedDates[0];
        
        for (let i = 1; i < assetPrices.length; i++) {
            if (assetPrices[i] > currentPeak) {
                currentPeak = assetPrices[i];
                currentPeakDate = alignedDates[i];
            }
            
            const dd = (assetPrices[i] - currentPeak) / currentPeak;
            if (dd < maxDrawdown) {
                maxDrawdown = dd;
                mdStart = currentPeakDate;
                mdEnd = alignedDates[i];
                recovered = false;
            } else if (!recovered && assetPrices[i] >= currentPeak && currentPeakDate === mdStart) {
                recovered = true;
                const msPerDay = 1000 * 60 * 60 * 24;
                recoveryDays = Math.max(recoveryDays, Math.ceil((new Date(alignedDates[i]) - new Date(mdEnd)) / msPerDay));
            }
        }
        
        if (!recovered) {
            recoveryDays = 'ongoing';
        }

        const sharpe = annualizedVol === 0 ? 0 : (annualMeanReturn - riskFreeRate) / annualizedVol;

        const negativeReturns = assetReturns.filter(r => r < 0);
        const downsideDev = stddev(negativeReturns, 0) * Math.sqrt(252);
        const sortino = downsideDev === 0 ? 0 : (annualMeanReturn - riskFreeRate) / downsideDev;

        const calmar = maxDrawdown === 0 ? 0 : annualMeanReturn / Math.abs(maxDrawdown);

        const var95 = percentile(assetReturns, 5) * Math.sqrt(21); // Monthly VaR
        const var95Daily = percentile(assetReturns, 5);
        const cvarReturns = assetReturns.filter(r => r <= var95Daily);
        const cvar = cvarReturns.length > 0 ? mean(cvarReturns) * Math.sqrt(21) : var95; // scaling cvar roughly

        const summary = {
            annualizedVol,
            beta,
            maxDrawdown,
            maxDrawdownStart: mdStart,
            maxDrawdownEnd: mdEnd,
            recoveryDays,
            sharpe,
            sortino,
            calmar,
            var95,
            cvar,
            downsideDev
        };

        const result = {
            ticker,
            period,
            summary,
            rollingVol,
            rollingBeta
        };

        const finalResult = wrapWithProvenance(result, {
            provider: 'yahoo',
            dataQuality: DATA_QUALITY.PROVIDER
        });

        cache.set(cacheKey, finalResult, 12 * 60 * 60 * 1000); // 12 hours
        res.json(finalResult);

    } catch (error) {
        console.error('Error in /risk/profile:', error);
        res.status(500).json({ error: 'Failed to compute risk profile' });
    }
});

router.get('/drawdown/:ticker', async (req, res) => {
    try {
        const ticker = normalizeTicker(req.params.ticker);
        const period = req.query.period || '1y';
        const cacheKey = `risk_drawdown_${ticker}_${period}`;

        const cached = cache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const chartResult = await fetchYahooChart(ticker, period, '1d');

        if (chartResult.error || !chartResult.chartData || chartResult.chartData.length === 0) {
            return res.status(400).json({ error: `No data available for ${ticker}` });
        }

        const quotes = chartResult.chartData.map(p => ({
            date: new Date(p.time * 1000).toISOString().split('T')[0],
            close: p.close
        }));

        const drawdownSeries = [];
        if (quotes.length > 0) {
            let runningMax = quotes[0].close;
            for (let i = 0; i < quotes.length; i++) {
                if (quotes[i].close > runningMax) {
                    runningMax = quotes[i].close;
                }
                drawdownSeries.push({
                    date: quotes[i].date,
                    drawdown: parseFloat(((quotes[i].close - runningMax) / runningMax).toFixed(6)),
                    price: quotes[i].close,
                    peak: runningMax
                });
            }
        }

        const result = {
            ticker,
            period,
            drawdownSeries
        };

        const finalResult = wrapWithProvenance(result, {
            provider: 'yahoo',
            dataQuality: DATA_QUALITY.PROVIDER
        });

        cache.set(cacheKey, finalResult, 12 * 60 * 60 * 1000); // 12 hours
        res.json(finalResult);

    } catch (error) {
        console.error('Error in /risk/drawdown:', error);
        res.status(500).json({ error: 'Failed to compute drawdown series' });
    }
});

module.exports = router;
