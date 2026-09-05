// Pure JavaScript implementations of Technical Indicators
// No external dependencies required.

export function calculateSMA(data, period) {
    const result = [];
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += data[i].value;
        if (i >= period) {
            sum -= data[i - period].value;
        }
        if (i >= period - 1) {
            result.push({ time: data[i].time, value: sum / period });
        }
    }
    return result;
}

export function calculateEMA(data, period) {
    const result = [];
    const k = 2 / (period + 1);
    let ema = 0;
    
    // First SMA
    let sum = 0;
    for (let i = 0; i < period && i < data.length; i++) {
        sum += data[i].value;
        if (i === period - 1) {
            ema = sum / period;
            result.push({ time: data[i].time, value: ema });
        }
    }

    for (let i = period; i < data.length; i++) {
        ema = (data[i].value - ema) * k + ema;
        result.push({ time: data[i].time, value: ema });
    }
    return result;
}

export function calculateBollingerBands(data, period, stdDevMultiplier) {
    const result = [];
    const smaData = calculateSMA(data, period);
    
    for (let i = period - 1; i < data.length; i++) {
        const slice = data.slice(i - period + 1, i + 1);
        const currentSma = smaData[i - period + 1].value;
        
        let varianceSum = 0;
        for (let j = 0; j < slice.length; j++) {
            varianceSum += Math.pow(slice[j].value - currentSma, 2);
        }
        
        const stdDev = Math.sqrt(varianceSum / period);
        result.push({
            time: data[i].time,
            upper: currentSma + stdDev * stdDevMultiplier,
            middle: currentSma,
            lower: currentSma - stdDev * stdDevMultiplier
        });
    }
    return result;
}

export function calculateRSI(data, period) {
    const result = [];
    if (data.length <= period) return result;

    let gains = 0, losses = 0;
    
    for (let i = 1; i <= period; i++) {
        const diff = data[i].value - data[i - 1].value;
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    const calculateRS = (ag, al) => al === 0 ? 100 : 100 - (100 / (1 + (ag / al)));
    
    result.push({ time: data[period].time, value: calculateRS(avgGain, avgLoss) });
    
    for (let i = period + 1; i < data.length; i++) {
        const diff = data[i].value - data[i - 1].value;
        const gain = diff >= 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        
        result.push({ time: data[i].time, value: calculateRS(avgGain, avgLoss) });
    }
    return result;
}

export function calculateMACD(data, fast, slow, signal) {
    const fastEma = calculateEMA(data, fast);
    const slowEma = calculateEMA(data, slow);
    const result = [];
    
    const macdLine = [];
    // Align fast and slow EMA
    for (let i = 0; i < slowEma.length; i++) {
        const time = slowEma[i].time;
        const fastPoint = fastEma.find(p => p.time === time);
        if (fastPoint) {
            macdLine.push({ time: time, value: fastPoint.value - slowEma[i].value });
        }
    }
    
    const signalLine = calculateEMA(macdLine, signal);
    
    for (let i = 0; i < signalLine.length; i++) {
        const time = signalLine[i].time;
        const macdPoint = macdLine.find(p => p.time === time);
        if (macdPoint) {
            result.push({
                time: time,
                macd: macdPoint.value,
                signal: signalLine[i].value,
                hist: macdPoint.value - signalLine[i].value
            });
        }
    }
    return result;
}

// Indicator Manager for Lightweight Charts
export class IndicatorManager {
    constructor(chart, mainSeries, volumeSeries) {
        this.chart = chart;
        this.mainSeries = mainSeries;
        this.volumeSeries = volumeSeries;
        
        this.active = { sma: false, ema: false, bb: false, rsi: false, macd: false };
        this.series = {};
        
        // Colors
        this.colors = {
            sma: '#f59e0b', // Amber
            ema: '#3b82f6', // Blue
            bbUpper: 'rgba(6, 182, 212, 0.5)',
            bbMiddle: 'rgba(6, 182, 212, 0.8)',
            bbLower: 'rgba(6, 182, 212, 0.5)',
            bbArea: 'rgba(6, 182, 212, 0.05)',
            rsi: '#a855f7', // Purple
            macdLine: '#3b82f6',
            macdSignal: '#f59e0b',
        };
    }

    getTooltipData(param) {
        if (!param || !param.time) return '';
        let html = '';
        
        if (this.active.sma && this.series.sma) {
            const pt = param.seriesData.get(this.series.sma);
            if (pt) html += `<div class="tt-row"><span class="tt-label" style="color:${this.colors.sma}">SMA(20)</span><span class="tt-val">${pt.value.toFixed(2)}</span></div>`;
        }
        if (this.active.ema && this.series.ema) {
            const pt = param.seriesData.get(this.series.ema);
            if (pt) html += `<div class="tt-row"><span class="tt-label" style="color:${this.colors.ema}">EMA(20)</span><span class="tt-val">${pt.value.toFixed(2)}</span></div>`;
        }
        if (this.active.bb && this.series.bbMiddle) {
            const pMid = param.seriesData.get(this.series.bbMiddle);
            const pUp = param.seriesData.get(this.series.bbUpper);
            const pLow = param.seriesData.get(this.series.bbLower);
            if (pMid && pUp && pLow) {
                html += `<div class="tt-row"><span class="tt-label" style="color:${this.colors.bbMiddle}">BB(20)</span><span class="tt-val">${pUp.value.toFixed(2)} | ${pLow.value.toFixed(2)}</span></div>`;
            }
        }
        if (this.active.rsi && this.series.rsi) {
            const pt = param.seriesData.get(this.series.rsi);
            if (pt) html += `<div class="tt-row"><span class="tt-label" style="color:${this.colors.rsi}">RSI(14)</span><span class="tt-val">${pt.value.toFixed(2)}</span></div>`;
        }
        if (this.active.macd && this.series.macdLine) {
            const pMacd = param.seriesData.get(this.series.macdLine);
            const pSig = param.seriesData.get(this.series.macdSignal);
            const pHist = param.seriesData.get(this.series.macdHist);
            if (pMacd && pSig) {
                html += `<div class="tt-row"><span class="tt-label" style="color:${this.colors.macdLine}">MACD</span><span class="tt-val">${pMacd.value.toFixed(2)} | <span style="color:${this.colors.macdSignal}">${pSig.value.toFixed(2)}</span></span></div>`;
            }
        }
        
        return html;
    }

    toggle(indicator, dataObjArr) {
        this.active[indicator] = !this.active[indicator];
        
        // Remove existing if turning off
        if (!this.active[indicator]) {
            this._removeIndicatorSeries(indicator);
            this._updateMargins();
            return;
        }

        // Map data specifically for indicator formulas
        const closeData = dataObjArr.map(d => ({ 
            time: d.time || d.datetime, 
            value: d.close !== undefined ? parseFloat(d.close) : parseFloat(d.value) 
        })).filter(d => !isNaN(d.value) && d.time !== undefined);

        // Add Series
        if (indicator === 'sma') {
            const smaData = calculateSMA(closeData, 20);
            this.series.sma = this.chart.addSeries(LightweightCharts.LineSeries, {
                color: this.colors.sma,
                lineWidth: 1,
                crosshairMarkerVisible: false,
                lastValueVisible: false,
                priceLineVisible: false
            });
            this.series.sma.setData(smaData);
        }
        else if (indicator === 'ema') {
            const emaData = calculateEMA(closeData, 20);
            this.series.ema = this.chart.addSeries(LightweightCharts.LineSeries, {
                color: this.colors.ema,
                lineWidth: 1,
                crosshairMarkerVisible: false,
                lastValueVisible: false,
                priceLineVisible: false
            });
            this.series.ema.setData(emaData);
        }
        else if (indicator === 'bb') {
            const bbData = calculateBollingerBands(closeData, 20, 2);
            
            this.series.bbUpper = this.chart.addSeries(LightweightCharts.LineSeries, { color: this.colors.bbUpper, lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
            this.series.bbMiddle = this.chart.addSeries(LightweightCharts.LineSeries, { color: this.colors.bbMiddle, lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
            this.series.bbLower = this.chart.addSeries(LightweightCharts.LineSeries, { color: this.colors.bbLower, lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
            
            this.series.bbUpper.setData(bbData.map(d => ({ time: d.time, value: d.upper })));
            this.series.bbMiddle.setData(bbData.map(d => ({ time: d.time, value: d.middle })));
            this.series.bbLower.setData(bbData.map(d => ({ time: d.time, value: d.lower })));
        }
        else if (indicator === 'rsi') {
            const rsiData = calculateRSI(closeData, 14);
            this.series.rsi = this.chart.addSeries(LightweightCharts.LineSeries, {
                color: this.colors.rsi,
                lineWidth: 1.5,
                priceScaleId: 'rsi',
                lastValueVisible: true,
                priceLineVisible: false
            });
            this.series.rsi.priceScale().applyOptions({
                scaleMargins: { top: 0.8, bottom: 0 },
            });
            this.series.rsi.setData(rsiData);
            
            // 70 / 30 lines
            this.series.rsi.createPriceLine({ price: 70, color: 'rgba(255, 255, 255, 0.2)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
            this.series.rsi.createPriceLine({ price: 30, color: 'rgba(255, 255, 255, 0.2)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        }
        else if (indicator === 'macd') {
            const macdData = calculateMACD(closeData, 12, 26, 9);
            
            this.series.macdHist = this.chart.addSeries(LightweightCharts.HistogramSeries, { priceScaleId: 'macd', priceFormat: { type: 'volume' }});
            this.series.macdLine = this.chart.addSeries(LightweightCharts.LineSeries, { color: this.colors.macdLine, lineWidth: 1.5, priceScaleId: 'macd', lastValueVisible: false, priceLineVisible: false });
            this.series.macdSignal = this.chart.addSeries(LightweightCharts.LineSeries, { color: this.colors.macdSignal, lineWidth: 1.5, priceScaleId: 'macd', lastValueVisible: false, priceLineVisible: false });
            
            this.series.macdHist.setData(macdData.map(d => ({ time: d.time, value: d.hist, color: d.hist >= 0 ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)' })));
            this.series.macdLine.setData(macdData.map(d => ({ time: d.time, value: d.macd })));
            this.series.macdSignal.setData(macdData.map(d => ({ time: d.time, value: d.signal })));
        }

        this._updateMargins();
    }

    _removeIndicatorSeries(indicator) {
        if (indicator === 'sma' && this.series.sma) {
            this.chart.removeSeries(this.series.sma);
            delete this.series.sma;
        } else if (indicator === 'ema' && this.series.ema) {
            this.chart.removeSeries(this.series.ema);
            delete this.series.ema;
        } else if (indicator === 'bb' && this.series.bbMiddle) {
            this.chart.removeSeries(this.series.bbUpper);
            this.chart.removeSeries(this.series.bbMiddle);
            this.chart.removeSeries(this.series.bbLower);
            delete this.series.bbUpper;
            delete this.series.bbMiddle;
            delete this.series.bbLower;
        } else if (indicator === 'rsi' && this.series.rsi) {
            this.chart.removeSeries(this.series.rsi);
            delete this.series.rsi;
        } else if (indicator === 'macd' && this.series.macdLine) {
            this.chart.removeSeries(this.series.macdHist);
            this.chart.removeSeries(this.series.macdLine);
            this.chart.removeSeries(this.series.macdSignal);
            delete this.series.macdHist;
            delete this.series.macdLine;
            delete this.series.macdSignal;
        }
    }

    _updateMargins() {
        const hasRSI = this.active.rsi;
        const hasMACD = this.active.macd;
        
        let priceBottom = 0.25;
        let volTop = 0.8;
        let volBottom = 0;
        
        if (hasRSI && hasMACD) {
            priceBottom = 0.5;
            volTop = 0.5;
            volBottom = 0.4;
            this.series.rsi.priceScale().applyOptions({ scaleMargins: { top: 0.6, bottom: 0.2 } });
            this.series.macdLine.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        } else if (hasRSI) {
            priceBottom = 0.4;
            volTop = 0.6;
            volBottom = 0.25;
            this.series.rsi.priceScale().applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });
        } else if (hasMACD) {
            priceBottom = 0.4;
            volTop = 0.6;
            volBottom = 0.25;
            this.series.macdLine.priceScale().applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });
        }

        this.chart.priceScale('right').applyOptions({
            scaleMargins: { top: 0.1, bottom: priceBottom },
        });
        
        if (this.volumeSeries) {
            this.volumeSeries.priceScale().applyOptions({
                scaleMargins: { top: volTop, bottom: volBottom },
            });
        }
    }
}

export function setupIndicatorsUI(pagePrefix, dataGetter, getManager) {
    const btn = document.getElementById(`${pagePrefix}-indicator-btn`);
    const menu = document.getElementById(`${pagePrefix}-indicator-menu`);
    if (!btn || !menu) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
        if (!btn.contains(e.target) && !menu.contains(e.target)) {
            menu.classList.remove('show');
        }
    });

    menu.querySelectorAll('input').forEach(input => {
        input.addEventListener('change', () => {
            const data = dataGetter();
            if (!data || data.length === 0) return;
            
            const manager = getManager();
            if (manager) {
                manager.toggle(input.value, data);
            }
        });
    });
}
