// Shared two-mode appearance control. This is a tiny presentation adapter to
// the existing ThemeManager; it never creates another theme/storage authority.
(function () {
    'use strict';

    const SELECTOR = '[data-artsoul-theme-toggle]';
    function bind() {
        const manager = window.ThemeManager;
        if (typeof manager?.toggleTheme !== 'function' ||
            typeof manager?.addListener !== 'function') return;
        const buttons = [...document.querySelectorAll(SELECTOR)];
        if (!buttons.length) return;

        for (const button of buttons) {
            if (button.dataset.themeBound === 'true') continue;
            button.dataset.themeBound = 'true';
            button.addEventListener('click', () => manager.toggleTheme());
        }

        const sync = theme => {
            const future = theme === 'future';
            for (const button of buttons) {
                button.dataset.currentTheme = future ? 'future' : 'classic';
                // A constant toggle-button name, with aria-pressed carrying
                // the mode, avoids announcements that change meaning mid-click.
                button.setAttribute('aria-label', 'Future appearance');
                button.setAttribute('aria-pressed', String(future));
                button.title = future ? 'Switch to Classic appearance' : 'Switch to Future appearance';
                button.dataset.themeReady = 'true';
            }
        };
        manager.addListener(sync);
        sync(manager.getTheme());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind, { once: true });
    } else {
        bind();
    }
})();
