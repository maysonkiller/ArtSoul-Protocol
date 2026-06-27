// Theme Synchronization Module for ArtSoul
// Syncs theme (classic/future) across all pages using localStorage

(function() {
    'use strict';

    const THEME_KEY = 'artsoul_theme';
    const DEFAULT_THEME = 'classic';

    /**
     * Get current theme from localStorage
     */
    function getTheme() {
        return localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
    }

    /**
     * Save theme to localStorage
     */
    function saveTheme(theme) {
        localStorage.setItem(THEME_KEY, theme);
        console.log(` Theme saved: ${theme}`);
    }

    /**
     * Apply theme to body and html
     */
    function applyTheme(theme) {
        document.documentElement.className = theme;
        document.body.className = theme;
        console.log(` Theme applied: ${theme}`);
    }

    /**
     * Update theme toggle buttons state (old style with active-classic/active-future)
     */
    function updateThemeButtons(theme) {
        const classicBtn = document.getElementById('classicBtn');
        const futureBtn = document.getElementById('futureBtn');

        if (classicBtn && futureBtn) {
            classicBtn.classList.remove('active-classic', 'active-future');
            futureBtn.classList.remove('active-classic', 'active-future');

            if (theme === 'classic') {
                classicBtn.classList.add('active-classic');
            } else {
                futureBtn.classList.add('active-future');
            }
        }
    }

    /**
     * Initialize theme on page load
     */
    function initTheme() {
        const savedTheme = getTheme();

        // Only apply theme if body doesn't already have it (inline script may have set it)
        if (!document.body.className || document.body.className !== savedTheme) {
            applyTheme(savedTheme);
        }

        updateThemeButtons(savedTheme);
    }

    /**
     * Set up theme toggle listeners (old onclick style)
     */
    function setupThemeToggle() {
        // Make setTheme function available globally
        window.setTheme = function(theme) {
            saveTheme(theme);
            applyTheme(theme);
            updateThemeButtons(theme);

            // Sync with React component if exists
            if (window.setThemeReact) {
                window.setThemeReact(theme);
            }
        };
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initTheme();
            setupThemeToggle();
        });
    } else {
        initTheme();
        setupThemeToggle();
    }

    // Export functions for external use
    window.ThemeSync = {
        getTheme,
        saveTheme,
        applyTheme,
        initTheme
    };

    console.log(' Theme Sync module loaded');
})();
