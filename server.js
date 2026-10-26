require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

if (!process.execArgv.includes('--use-system-ca')) {
    console.warn(
        '⚠️  Outbound API calls may fail on Windows. Start with: npm start  (uses --use-system-ca)'
    );
}

const app = express();
app.set('trust proxy', 1);

const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (same-origin, server-to-server, curl, etc.)
        if (!origin) {
            return callback(null, true);
        }
        // Allow explicitly configured origins
        if (CORS_ORIGINS.length > 0 && CORS_ORIGINS.includes(origin)) {
            return callback(null, true);
        }
        // Allow any port on localhost / 127.0.0.1 for local development
        try {
            const url = new URL(origin);
            if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
                return callback(null, true);
            }
        } catch (e) {
            // invalid origin URL
        }
        // If no CORS_ORIGINS are configured (pure local dev mode), allow all
        if (CORS_ORIGINS.length === 0) {
            return callback(null, true);
        }
        callback({ message: 'CORS origin not allowed', statusCode: 403 });
    },
}));
app.use(express.json());

// Prevent browser caching of JS/CSS so changes are always reflected
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        if (req.path.endsWith('.js') || req.path.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
        next();
    });
}

app.use(express.static(path.join(__dirname, 'public')));

// Import Routes — Original
const equityRoutes = require('./routes/equity');
const cryptoRoutes = require('./routes/crypto');
const macroRoutes = require('./routes/macro');
const aiRoutes = require('./routes/ai');
const commoditiesRoutes = require('./routes/commodities');
const forexRoutes = require('./routes/forex');
const stressRoutes = require('./routes/stress');
const yieldsRoutes = require('./routes/yields');

// Import Routes — Phase 1: Data Integrity
const secRoutes = require('./routes/sec');

// Import Routes — Phase 2: Analytics
const analyticsRoutes = require('./routes/analytics');
const correlationsRoutes = require('./routes/correlations');
const riskRoutes = require('./routes/risk');

// Import Routes — Phase 3: Terminal Features
const screenerRoutes = require('./routes/screener');

// Import Routes — Phase 4: Product
const reportRoutes = require('./routes/report');

// Mount Routes — Original
app.use('/api', equityRoutes); // contains /finnhub/* and /twelvedata/*
app.use('/api/crypto', cryptoRoutes);
app.use('/api', macroRoutes); // contains /indices
app.use('/api/commodities', commoditiesRoutes);
app.use('/api/forex', forexRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/stress', stressRoutes);
app.use('/api/yields', yieldsRoutes);

// Mount Routes — Phase 1: Data Integrity
app.use('/api/sec', secRoutes);

// Mount Routes — Phase 2: Analytics
app.use('/api/analytics', analyticsRoutes);
app.use('/api/correlations', correlationsRoutes);
app.use('/api/risk', riskRoutes);

// Mount Routes — Phase 3: Terminal Features
app.use('/api/screener', screenerRoutes);

// Mount Routes — Phase 4: Product
app.use('/api/report', reportRoutes);

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'forex-api', timestamp: new Date().toISOString() });
});

app.get('/api/cache-stats', (req, res) => {
    const { getAllCacheStats } = require('./utils/cache');
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        caches: getAllCacheStats()
    });
});

// Error Handling Middleware
app.use((error, req, res, next) => {
    if (error?.message === 'CORS origin not allowed') {
        return res.status(error.statusCode || 403).json({ error: error.message });
    }
    console.error('Unhandled error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Internal Server Error' });
});

// Start the server on port 3000
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        const { getAiProviderInfo } = require('./utils/aiProviders');
        const aiInfo = getAiProviderInfo();
        console.log(`==================================================`);
        console.log(`🚀 STRATA Research Terminal Active!`);
        console.log(`🔗 Open the app: http://localhost:${PORT}`);
        console.log(`📡 API Modules: 14 (equity, crypto, macro, commodities, forex, ai, stress, yields, sec, analytics, correlations, risk, screener, report)`);
        if (aiInfo.provider) {
            console.log(`🤖 AI Advisor: ${aiInfo.provider.toUpperCase()} (${aiInfo.model})`);
        } else {
            console.log(`⚠️  AI Advisor: no API key (add GROQ_API_KEY to .env)`);
        }
        console.log(`==================================================`);
    });
}

module.exports = app;
