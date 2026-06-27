// BackButton Component
// Global back button for navigation

class BackButton {
    constructor() {
        this.history = [];
        this.currentPage = window.location.pathname;
    }

    /**
     * Render back button in specified container
     */
    render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.warn('BackButton: Container not found:', containerId);
            return;
        }

        const button = document.createElement('button');
        button.className = 'btn-secondary flex items-center gap-2';
        button.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            <span>Back</span>
        `;

        button.onclick = () => this.goBack();
        container.appendChild(button);
    }

    /**
     * Navigate back
     */
    goBack() {
        // Check if there's history
        if (window.history.length > 1) {
            window.history.back();
        } else {
            // Fallback to home
            window.location.href = 'index.html';
        }
    }

    /**
     * Add to history
     */
    addToHistory(page) {
        this.history.push(page);
    }
}

// Export for use in other modules
export default BackButton;

// Also make available globally for HTML pages
if (typeof window !== 'undefined') {
    window.BackButton = BackButton;
}
