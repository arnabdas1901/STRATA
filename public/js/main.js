function init() {
    setupMobileMenu();
    enhancePageShell();
    animateMetricValues();
    setupPageReveal();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

function setupMobileMenu() {
    const toggleBtn = document.getElementById('mobile-menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    if (!toggleBtn || !sidebar) return;

    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
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

function enhancePageShell() {
    const heroCards = document.querySelectorAll('.ticker-hero-card, .chart-container-card, .metric-card, .news-widget');
    heroCards.forEach((card, index) => {
        card.style.animationDelay = `${index * 70}ms`;
        card.classList.add('premium-card-enter');
    });
}

function animateMetricValues() {
    const metricValues = document.querySelectorAll('.metric-value, .index-price, .price-value, .kpi-value');
    metricValues.forEach((el) => {
        if (!el.textContent.trim() || el.textContent.includes('--')) return;
        el.classList.add('metric-value-animated');
    });
}

function setupPageReveal() {
    const content = document.querySelector('.main-content');
    if (!content) return;
    content.classList.add('page-revealed');
}

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then((reg) => {
                console.log('STRATA Service Worker registered successfully, scope:', reg.scope);
            })
            .catch((err) => {
                console.error('STRATA Service Worker registration failed:', err);
            });
    });
}

