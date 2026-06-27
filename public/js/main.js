import { loadDashboard } from './modules/equity.js';
import { setupCryptoTracker } from './modules/crypto.js';
import { setupInflationTracker } from './modules/macro.js';
import { setupAiAdvisor } from './modules/ai.js';
import { setupCalculators } from './modules/calculators.js';
import { setupPortfolioBuilder } from './modules/portfolio.js';
import { initCommoditiesDashboard } from './modules/commodities.js';
import { setupForexTracker } from './modules/forex.js';
import { setupStressTester } from './modules/stress.js';

document.addEventListener('DOMContentLoaded', () => {
    // Core UI Navigation
    setupNavigation();
    setupMobileMenu();

    // 1. Core Equity Dashboard
    loadDashboard();

    // 2. Crypto Tracker
    setupCryptoTracker();

    // 2.5 Commodities Tracker
    initCommoditiesDashboard();

    // 3. Macro & Inflation
    setupInflationTracker();

    // 4. AI Advisor
    setupAiAdvisor();

    // 4.5 Forex Tracker
    setupForexTracker();

    // 5. Calculators
    setupCalculators();

    // 6. Portfolio
    setupPortfolioBuilder();

    // 7. Stress Tester
    setupStressTester();
});

function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const viewports = document.querySelectorAll('.dashboard-viewport');
    const sidebar = document.querySelector('.sidebar');
    const toggleBtn = document.getElementById('mobile-menu-toggle');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(n => n.classList.remove('active'));
            viewports.forEach(v => v.classList.remove('active'));
            
            item.classList.add('active');
            const targetId = item.getAttribute('data-target');
            document.getElementById(targetId)?.classList.add('active');

            sidebar?.classList.remove('mobile-open');
            document.body.classList.remove('mobile-nav-open');
            toggleBtn?.setAttribute('aria-expanded', 'false');

            // Save state so page reloads remember the current dashboard
            sessionStorage.setItem('strata_active_dashboard', targetId);
        });
    });

    // Restore saved dashboard state on page load
    const savedDashboard = sessionStorage.getItem('strata_active_dashboard');
    if (savedDashboard) {
        const savedNavItem = Array.from(navItems).find(n => n.getAttribute('data-target') === savedDashboard);
        if (savedNavItem) {
            savedNavItem.click();
        }
    }
}

function setupMobileMenu() {
    const toggleBtn = document.getElementById('mobile-menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    if (!toggleBtn || !sidebar) return;

    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.addEventListener('click', () => {
        const isOpen = sidebar.classList.toggle('mobile-open');
        document.body.classList.toggle('mobile-nav-open', isOpen);
        toggleBtn.setAttribute('aria-expanded', String(isOpen));
    });

    document.addEventListener('click', (event) => {
        if (!sidebar.classList.contains('mobile-open')) return;
        const clickedInsideSidebar = sidebar.contains(event.target);
        const clickedToggle = toggleBtn.contains(event.target);
        if (!clickedInsideSidebar && !clickedToggle) {
            sidebar.classList.remove('mobile-open');
            document.body.classList.remove('mobile-nav-open');
            toggleBtn.setAttribute('aria-expanded', 'false');
        }
    });
}
