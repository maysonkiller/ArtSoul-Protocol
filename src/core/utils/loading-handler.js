// LoadingHandler - Centralized loading state management
// Provides global loading overlay and spinner

class LoadingHandler {
    constructor() {
        this.loadingCount = 0;
        this.overlay = null;
    }

    /**
     * Show loading overlay
     */
    show(message = 'Loading...') {
        this.loadingCount++;

        // Create overlay if it doesn't exist
        if (!this.overlay) {
            this.createOverlay();
        }

        // Update message
        const messageEl = this.overlay.querySelector('.loading-message');
        if (messageEl) {
            messageEl.textContent = message;
        }

        // Show overlay
        this.overlay.style.display = 'flex';
    }

    /**
     * Hide loading overlay
     */
    hide() {
        this.loadingCount = Math.max(0, this.loadingCount - 1);

        // Only hide if no more loading operations
        if (this.loadingCount === 0 && this.overlay) {
            this.overlay.style.display = 'none';
        }
    }

    /**
     * Force hide (reset counter)
     */
    forceHide() {
        this.loadingCount = 0;
        if (this.overlay) {
            this.overlay.style.display = 'none';
        }
    }

    /**
     * Create loading overlay element
     */
    createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'global-loading-overlay';
        this.overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(4px);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 9999;
            flex-direction: column;
            gap: 20px;
        `;

        // Spinner
        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner';
        spinner.style.cssText = `
            width: 60px;
            height: 60px;
            border: 4px solid rgba(169, 221, 211, 0.3);
            border-top-color: #a9ddd3;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        `;

        // Message
        const message = document.createElement('div');
        message.className = 'loading-message';
        message.textContent = 'Loading...';
        message.style.cssText = `
            color: #a9ddd3;
            font-size: 18px;
            font-weight: 500;
        `;

        // Add animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        `;
        if (!document.getElementById('loading-styles')) {
            style.id = 'loading-styles';
            document.head.appendChild(style);
        }

        this.overlay.appendChild(spinner);
        this.overlay.appendChild(message);
        document.body.appendChild(this.overlay);
    }

    /**
     * Wrap async function with loading state
     */
    async wrap(fn, message = 'Loading...') {
        this.show(message);
        try {
            const result = await fn();
            return result;
        } finally {
            this.hide();
        }
    }
}

// Create singleton instance
const loadingHandler = new LoadingHandler();

// Export for use in other modules
export default loadingHandler;

// Also make available globally for HTML pages
if (typeof window !== 'undefined') {
    window.LoadingHandler = loadingHandler;
}
