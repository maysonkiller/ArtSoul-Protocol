/**
 * Theme Manager - Single Source of Truth for ArtSoul Theme System
 *
 * Features:
 * - Global theme application (html, body, all components)
 * - localStorage persistence
 * - Auto-restore on reload
 * - Fallback handling
 * - Event system for theme changes
 * - Component registration
 */

class ThemeManager {
    constructor() {
        this.THEME_KEY = 'artsoul_theme';
        this.DEFAULT_THEME = 'classic';
        this.VALID_THEMES = ['classic', 'future'];

        this.currentTheme = null;
        this.listeners = [];
        this.components = new Map();

        console.log(' ThemeManager initialized');
    }

    /**
     * Initialize theme system
     */
    init() {
        try {
            // Load saved theme
            const savedTheme = this.loadTheme();

            // Validate and apply
            const theme = this.validateTheme(savedTheme);
            this.applyTheme(theme, { skipSave: true });

            // Setup global function for backward compatibility
            window.setTheme = (theme) => this.setTheme(theme);

            console.log(` Theme system ready: ${theme}`);
        } catch (error) {
            console.error(' Theme init failed, using fallback:', error);
            this.applyTheme(this.DEFAULT_THEME);
        }
    }

    /**
     * Load theme from localStorage
     */
    loadTheme() {
        try {
            return localStorage.getItem(this.THEME_KEY) || this.DEFAULT_THEME;
        } catch (error) {
            console.warn(' localStorage unavailable, using default theme');
            return this.DEFAULT_THEME;
        }
    }

    /**
     * Save theme to localStorage
     */
    saveTheme(theme) {
        try {
            localStorage.setItem(this.THEME_KEY, theme);
            console.log(` Theme saved: ${theme}`);
            return true;
        } catch (error) {
            console.error(' Failed to save theme:', error);
            return false;
        }
    }

    /**
     * Validate theme name
     */
    validateTheme(theme) {
        if (this.VALID_THEMES.includes(theme)) {
            return theme;
        }
        console.warn(` Invalid theme "${theme}", using default`);
        return this.DEFAULT_THEME;
    }

    /**
     * Set theme (public API)
     */
    setTheme(theme, options = {}) {
        const validTheme = this.validateTheme(theme);

        if (validTheme === this.currentTheme && !options.force) {
            console.log(` Theme already set: ${validTheme}`);
            return;
        }

        this.applyTheme(validTheme, options);
    }

    /**
     * Apply theme globally
     */
    applyTheme(theme, options = {}) {
        const previousTheme = this.currentTheme;
        this.currentTheme = theme;

        // 1. Apply to html and body
        this.applyThemeClass(document.documentElement, theme);
        if (document.body) {
            this.applyThemeClass(document.body, theme);
        }

        // 2. Update all registered components
        this.updateComponents(theme);

        // 3. Update theme toggle buttons
        this.updateThemeButtons(theme);

        // 4. Save to localStorage
        if (!options.skipSave) {
            this.saveTheme(theme);
        }

        // 5. Notify listeners
        this.notifyListeners(theme, previousTheme);

        console.log(` Theme applied globally: ${theme}`);
    }

    /**
     * Apply only the theme class without removing unrelated page classes.
     */
    applyThemeClass(element, theme) {
        if (!element) return;
        element.classList.remove('classic', 'future');
        element.classList.add(theme);
    }

    /**
     * Update theme toggle buttons
     */
    updateThemeButtons(theme) {
        const classicBtn = document.getElementById('classicBtn');
        const futureBtn = document.getElementById('futureBtn');

        if (classicBtn && futureBtn) {
            // Remove all active states
            classicBtn.classList.remove('active-classic', 'active-future');
            futureBtn.classList.remove('active-classic', 'active-future');

            // Add correct active state
            if (theme === 'classic') {
                classicBtn.classList.add('active-classic');
            } else {
                futureBtn.classList.add('active-future');
            }
        }
    }

    /**
     * Register component for theme updates
     */
    registerComponent(name, updateFn) {
        this.components.set(name, updateFn);

        // Immediately update with current theme
        if (this.currentTheme) {
            try {
                updateFn(this.currentTheme);
            } catch (error) {
                console.error(` Failed to update component "${name}":`, error);
            }
        }

        console.log(` Component registered: ${name}`);
    }

    /**
     * Unregister component
     */
    unregisterComponent(name) {
        this.components.delete(name);
        console.log(` Component unregistered: ${name}`);
    }

    /**
     * Update all registered components
     */
    updateComponents(theme) {
        this.components.forEach((updateFn, name) => {
            try {
                updateFn(theme);
            } catch (error) {
                console.error(` Failed to update component "${name}":`, error);
            }
        });
    }

    /**
     * Add theme change listener
     */
    addListener(callback) {
        this.listeners.push(callback);
        return () => this.removeListener(callback);
    }

    /**
     * Remove theme change listener
     */
    removeListener(callback) {
        const index = this.listeners.indexOf(callback);
        if (index > -1) {
            this.listeners.splice(index, 1);
        }
    }

    /**
     * Notify all listeners
     */
    notifyListeners(newTheme, oldTheme) {
        this.listeners.forEach(callback => {
            try {
                callback(newTheme, oldTheme);
            } catch (error) {
                console.error(' Listener error:', error);
            }
        });
    }

    /**
     * Get current theme
     */
    getTheme() {
        return this.currentTheme || this.DEFAULT_THEME;
    }

    /**
     * Toggle between themes
     */
    toggleTheme() {
        const newTheme = this.currentTheme === 'classic' ? 'future' : 'classic';
        this.setTheme(newTheme);
    }

    /**
     * Check if theme is active
     */
    isTheme(theme) {
        return this.currentTheme === theme;
    }

    /**
     * Get theme class for element
     */
    getThemeClass(baseClass) {
        return `${baseClass} ${baseClass}-${this.currentTheme}`;
    }
}

// Bootstrap the html class as soon as this script loads; body is handled in init().
try {
    const savedTheme = localStorage.getItem('artsoul_theme') || 'classic';
    const initialTheme = ['classic', 'future'].includes(savedTheme) ? savedTheme : 'classic';
    document.documentElement.classList.remove('classic', 'future');
    document.documentElement.classList.add(initialTheme);
} catch (error) {
    document.documentElement.classList.remove('classic', 'future');
    document.documentElement.classList.add('classic');
}

// Create global instance
const themeManager = new ThemeManager();

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        themeManager.init();
    });
} else {
    themeManager.init();
}

// Export for global use
window.ThemeManager = themeManager;

// Backward compatibility
window.ThemeSync = {
    getTheme: () => themeManager.getTheme(),
    saveTheme: (theme) => themeManager.saveTheme(theme),
    applyTheme: (theme) => themeManager.setTheme(theme),
    initTheme: () => themeManager.init()
};

console.log(' ThemeManager module loaded');
