/**
 * Navigation Manager - Universal Navigation System for ArtSoul
 *
 * Features:
 * - History stack (frontend routing state)
 * - goBack() / goHome() functions
 * - "← Back" button always available
 * - Protection: empty stack → goHome()
 * - Theme-aware navigation
 */

const ARTSOUL_NAVIGATION_LABELS = {
    home: 'ArtSoul Home',
    explore: 'Explore Art',
    publish: 'Publish Artwork',
    auctions: 'Auctions',
    marketplace: 'Marketplace',
    collections: 'Collections',
    docs: 'Protocol Docs',
    profile: 'Profile'
};

window.ArtSoulNavigationLabels = window.ArtSoulNavigationLabels || ARTSOUL_NAVIGATION_LABELS;

class NavigationManager {
    constructor() {
        this.history = [];
        this.currentPage = null;
        this.homePage = 'index.html';

        // Pages configuration
        this.pages = {
            'index.html': { name: ARTSOUL_NAVIGATION_LABELS.explore, icon: '' },
            'gallery.html': { name: ARTSOUL_NAVIGATION_LABELS.marketplace, icon: '' },
            'upload.html': { name: ARTSOUL_NAVIGATION_LABELS.publish, icon: '' },
            'docs-protocol.html': { name: ARTSOUL_NAVIGATION_LABELS.docs, icon: '' },
            'profile.html': { name: ARTSOUL_NAVIGATION_LABELS.profile, icon: '' },
            'artwork.html': { name: ARTSOUL_NAVIGATION_LABELS.explore, icon: '' }
        };

        this.init();
    }

    /**
     * Initialize navigation system
     */
    init() {
        // Detect current page
        this.currentPage = this.getCurrentPage();

        // Load history from sessionStorage
        this.loadHistory();

        // Add current page to history if not already there
        if (this.history.length === 0 || this.history[this.history.length - 1] !== this.currentPage) {
            this.pushHistory(this.currentPage);
        }

        // Setup global functions
        window.goBack = () => this.goBack();
        window.goHome = () => this.goHome();
        window.navigateTo = (page) => this.navigateTo(page);

        // Setup back button if exists
        this.setupBackButton();

        console.log('🧭 NavigationManager initialized', {
            currentPage: this.currentPage,
            historyLength: this.history.length
        });
    }

    /**
     * Get current page from URL
     */
    getCurrentPage() {
        const path = window.location.pathname;
        const page = path.split('/').pop() || 'index.html';
        return page || 'index.html';
    }

    /**
     * Load history from sessionStorage
     */
    loadHistory() {
        try {
            const saved = sessionStorage.getItem('artsoul_nav_history');
            if (saved) {
                this.history = JSON.parse(saved);
            }
        } catch (error) {
            console.warn('🧭 Failed to load navigation history:', error);
            this.history = [];
        }
    }

    /**
     * Save history to sessionStorage
     */
    saveHistory() {
        try {
            sessionStorage.setItem('artsoul_nav_history', JSON.stringify(this.history));
        } catch (error) {
            console.warn('🧭 Failed to save navigation history:', error);
        }
    }

    /**
     * Push page to history
     */
    pushHistory(page) {
        // Don't add duplicate if it's the same as last entry
        if (this.history.length > 0 && this.history[this.history.length - 1] === page) {
            return;
        }

        this.history.push(page);

        // Limit history to 50 entries
        if (this.history.length > 50) {
            this.history.shift();
        }

        this.saveHistory();
        this.updateBackButton();
    }

    /**
     * Navigate to page
     */
    navigateTo(page, options = {}) {
        if (!options.skipHistory) {
            this.pushHistory(this.currentPage);
        }

        console.log(`🧭 Navigating to: ${page}`);
        window.location.href = page;
    }

    /**
     * Go back to previous page
     */
    goBack() {
        // Remove current page from history
        if (this.history.length > 0 && this.history[this.history.length - 1] === this.currentPage) {
            this.history.pop();
        }

        // Get previous page
        const previousPage = this.history.pop();

        if (previousPage && previousPage !== this.currentPage) {
            console.log(`🧭 Going back to: ${previousPage}`);
            this.saveHistory();
            window.location.href = previousPage;
        } else {
            // No history → go home
            console.log('🧭 No history, going home');
            this.goHome();
        }
    }

    /**
     * Go to home page
     */
    goHome() {
        console.log('🧭 Going home');
        this.history = [];
        this.saveHistory();
        window.location.href = this.homePage;
    }

    /**
     * Setup back button
     */
    setupBackButton() {
        // Create back button if it doesn't exist
        let backBtn = document.getElementById('backButton');

        if (!backBtn) {
            backBtn = this.createBackButton();
        }

        if (backBtn) {
            backBtn.onclick = () => this.goBack();
            this.updateBackButton();
        }
    }

    /**
     * Create back button element
     */
    createBackButton() {
        // Find navigation container
        const nav = document.querySelector('nav, .navigation, .nav-container');

        if (!nav) {
            console.debug('🧭 No navigation container found for back button');
            return null;
        }

        const backBtn = document.createElement('button');
        backBtn.id = 'backButton';
        backBtn.className = 'back-button';
        backBtn.innerHTML = '← Back';
        backBtn.style.cssText = `
            position: fixed;
            top: 20px;
            left: 20px;
            z-index: 1000;
            padding: 8px 16px;
            border-radius: 8px;
            border: none;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.3s ease;
        `;

        // Apply theme-aware styles
        this.applyBackButtonTheme(backBtn);

        // Insert at beginning of nav
        nav.insertBefore(backBtn, nav.firstChild);

        return backBtn;
    }

    /**
     * Apply theme to back button
     */
    applyBackButtonTheme(btn) {
        if (!btn) return;

        const theme = window.ThemeManager ? window.ThemeManager.getTheme() : 'classic';

        if (theme === 'classic') {
            btn.style.background = '#a9ddd3';
            btn.style.color = '#010101';
        } else {
            btn.style.background = 'linear-gradient(135deg, #bf00ff, #00f5ff)';
            btn.style.color = '#ffffff';
        }

        // Register for theme changes
        if (window.ThemeManager) {
            window.ThemeManager.registerComponent('backButton', (newTheme) => {
                this.applyBackButtonTheme(btn);
            });
        }
    }

    /**
     * Update back button visibility
     */
    updateBackButton() {
        const backBtn = document.getElementById('backButton');

        if (!backBtn) return;

        // Show/hide based on history
        const canGoBack = this.history.length > 1 ||
                         (this.history.length === 1 && this.history[0] !== this.currentPage);

        if (canGoBack) {
            backBtn.style.display = 'block';
            backBtn.style.opacity = '1';
        } else {
            // Always show but go home if clicked
            backBtn.style.display = 'block';
            backBtn.style.opacity = '0.5';
        }
    }

    /**
     * Get navigation breadcrumb
     */
    getBreadcrumb() {
        return this.history.map(page => {
            const config = this.pages[page] || { name: page, icon: '📄' };
            return {
                page,
                name: config.name,
                icon: config.icon
            };
        });
    }

    /**
     * Clear history
     */
    clearHistory() {
        this.history = [];
        this.saveHistory();
        this.updateBackButton();
        console.log('🧭 Navigation history cleared');
    }

    /**
     * Get history length
     */
    getHistoryLength() {
        return this.history.length;
    }

    /**
     * Can go back?
     */
    canGoBack() {
        return this.history.length > 1 ||
               (this.history.length === 1 && this.history[0] !== this.currentPage);
    }
}

// Create global instance
const navigationManager = new NavigationManager();

// Export for global use
window.NavigationManager = navigationManager;

console.log('🧭 NavigationManager module loaded');
