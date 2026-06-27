// ErrorHandler - Centralized error handling
// Provides user-friendly error messages and logging

class ErrorHandler {
    /**
     * Handle error with user-friendly message
     */
    static handle(error, context = 'Operation') {
        console.error(`Error in ${context}:`, error);

        // Get user-friendly message
        const message = this.getUserMessage(error, context);

        // Show toast notification
        this.showToast(message, 'error');

        // Optional: Send to monitoring service
        // this.logToMonitoring(error, context);

        return message;
    }

    /**
     * Get user-friendly error message
     */
    static getUserMessage(error, context) {
        // Wallet/Transaction errors
        if (error.code === 'ACTION_REJECTED' || error.message?.includes('user rejected')) {
            return 'Transaction cancelled';
        }

        if (error.code === 'INSUFFICIENT_FUNDS') {
            return 'Insufficient funds for this transaction';
        }

        if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
            return 'Unable to estimate gas. Transaction may fail.';
        }

        if (error.message?.includes('gas required exceeds')) {
            return 'Transaction requires too much gas';
        }

        // Network errors
        if (error.message?.includes('network') || error.message?.includes('connection')) {
            return 'Network error. Please check your connection.';
        }

        if (error.message?.includes('timeout')) {
            return 'Request timed out. Please try again.';
        }

        // Contract errors
        if (error.message?.includes('execution reverted')) {
            return 'Transaction failed. Please check the requirements.';
        }

        if (error.message?.includes('nonce')) {
            return 'Transaction nonce error. Please refresh and try again.';
        }

        // Supabase errors
        if (error.code === '23505') {
            return 'This item already exists';
        }

        if (error.code === '23503') {
            return 'Referenced item not found';
        }

        if (error.message?.includes('JWT')) {
            return 'Session expired. Please reconnect your wallet.';
        }

        // File upload errors
        if (error.message?.includes('file size')) {
            return 'File is too large. Maximum size is 100MB.';
        }

        if (error.message?.includes('file type')) {
            return 'File type not supported';
        }

        // Auction errors
        if (error.message?.includes('auction ended')) {
            return 'Auction has already ended';
        }

        if (error.message?.includes('bid too low')) {
            return 'Bid amount is too low';
        }

        if (error.message?.includes('creator cannot bid')) {
            return 'Creators cannot bid on their own artworks';
        }

        // Generic fallback
        if (error.message) {
            // Clean up technical error messages
            const cleaned = error.message
                .replace(/Error: /g, '')
                .replace(/execution reverted: /g, '')
                .trim();

            if (cleaned.length < 100) {
                return cleaned;
            }
        }

        return `${context} failed. Please try again.`;
    }

    /**
     * Show toast notification
     */
    static showToast(message, type = 'error') {
        // Check if toast container exists
        let container = document.getElementById('toast-container');

        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-width: 400px;
            `;
            document.body.appendChild(container);
        }

        // Create toast element
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const colors = {
            error: '#ef4444',
            success: '#10b981',
            warning: '#f59e0b',
            info: '#3b82f6'
        };

        const icons = {
            error: 'X',
            success: 'OK',
            warning: '!',
            info: 'i'
        };

        toast.style.cssText = `
            background: ${colors[type] || colors.error};
            color: white;
            padding: 16px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            display: flex;
            align-items: center;
            gap: 12px;
            animation: slideIn 0.3s ease-out;
            cursor: pointer;
        `;

        toast.innerHTML = `
            <span style="font-size: 20px;">${icons[type]}</span>
            <span style="flex: 1;">${message}</span>
        `;

        // Add animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(400px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(400px);
                    opacity: 0;
                }
            }
        `;
        if (!document.getElementById('toast-styles')) {
            style.id = 'toast-styles';
            document.head.appendChild(style);
        }

        // Click to dismiss
        toast.onclick = () => {
            toast.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => toast.remove(), 300);
        };

        // Auto dismiss after 5 seconds
        setTimeout(() => {
            if (toast.parentElement) {
                toast.style.animation = 'slideOut 0.3s ease-out';
                setTimeout(() => toast.remove(), 300);
            }
        }, 5000);

        container.appendChild(toast);
    }

    /**
     * Show success message
     */
    static success(message) {
        this.showToast(message, 'success');
    }

    /**
     * Show warning message
     */
    static warning(message) {
        this.showToast(message, 'warning');
    }

    /**
     * Show info message
     */
    static info(message) {
        this.showToast(message, 'info');
    }
}

// Export for use in other modules
export default ErrorHandler;

// Also make available globally for HTML pages
if (typeof window !== 'undefined') {
    window.ErrorHandler = ErrorHandler;
}
