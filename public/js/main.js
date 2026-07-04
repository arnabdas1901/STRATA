document.addEventListener('DOMContentLoaded', () => {
    setupMobileMenu();
});

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
