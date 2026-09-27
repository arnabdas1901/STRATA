import fs from 'fs';
import jsdom from 'jsdom';
const { JSDOM } = jsdom;

const html = fs.readFileSync('public/index.html', 'utf-8');
const dom = new JSDOM(html, { url: "http://localhost/" });
global.window = dom.window;
global.document = dom.window.document;
global.fetch = async (url) => {
    console.log("Fetching: " + url);
    return { ok: true, json: async () => ({}) };
};

// Mock dependencies
global.BACKEND_URL = 'http://localhost:3000';
global.fetchWithTimeout = async (url) => {
    const res = await fetch(url);
    return await res.json();
};
global.safeJsonParse = async (payload) => payload;

// Expose elements
console.log("Gainers Tbody:", document.querySelector('.gainers-card tbody') ? 'Found' : 'Missing');
console.log("Losers Tbody:", document.querySelector('.losers-card tbody') ? 'Found' : 'Missing');
console.log("Sector Grid:", document.getElementById('sector-heatmap-grid') ? 'Found' : 'Missing');

