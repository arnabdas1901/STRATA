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

app.use(cors({
    origin: '*', // Allow all origins for Vercel/Render preview environments
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Import Routes
const equityRoutes = require('./routes/equity');
const cryptoRoutes = require('./routes/crypto');
const macroRoutes = require('./routes/macro');
const aiRoutes = require('./routes/ai');
const commoditiesRoutes = require('./routes/commodities');
const forexRoutes = require('./routes/forex');
const stressRoutes = require('./routes/stress');

// Mount Routes
app.use('/api', equityRoutes); // contains /finnhub/* and /twelvedata/*
app.use('/api/crypto', cryptoRoutes);
app.use('/api', macroRoutes); // contains /indices
app.use('/api/commodities', commoditiesRoutes);
app.use('/api/forex', forexRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/stress', stressRoutes);

// Error Handling Middleware
app.use((error, req, res, next) => {
    if (error?.message === 'CORS origin not allowed') {
        return res.status(error.statusCode || 403).json({ error: error.message });
    }
    return next(error);
});

// Start the server on port 3000
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        const { getAiProvider } = require('./utils/aiProviders');
        const aiProvider = getAiProvider();
        console.log(`==================================================`);
        console.log(`🚀 STRATA Secure Backend Engine Active!`);
        console.log(`🔗 Open the app: http://localhost:${PORT}`);
        if (aiProvider === 'groq') {
            console.log(`🤖 AI Advisor: Groq (${process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'})`);
        } else if (aiProvider === 'gemini') {
            console.log(`🤖 AI Advisor: Gemini (${process.env.GEMINI_MODEL || 'gemini-2.5-flash'})`);
        } else {
            console.log(`⚠️  AI Advisor: no API key (add GROQ_API_KEY to .env)`);
        }
        console.log(`==================================================`);
    });
}

module.exports = app;
