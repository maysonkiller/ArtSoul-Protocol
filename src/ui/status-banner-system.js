/**
 * Status Banner System - Visual System Indicators
 *
 * Features:
 * - SYSTEM HEALTH indicator (green/yellow/red)
 * - WAL status badge
 * - Queue status badge
 * - Auto-update based on metrics
 */

class StatusBannerSystem {
    constructor() {
        this.banners = {
            systemHealth: null,
            walStatus: null,
            queueStatus: null
        };

        this.healthStatus = 'green'; // green, yellow, red
        this.walStatus = 'OK'; // OK, DEGRADED, FULL
        this.queueStatus = 'NORMAL'; // NORMAL, BACKPRESSURE, CRITICAL

        this.init();
    }

    /**
     * Check if current user is admin
     */
    isAdmin() {
        // Frontend wallet allowlists are intentionally disabled. Administrative
        // access must come from an authenticated server-side role registry.
        return false;
    }

    /**
     * Initialize banner system
     */
    init() {
        // Only show system status indicators for admin
        if (this.isAdmin()) {
            this.createSystemHealthIndicator();
            this.createWALStatusBadge();
            this.createQueueStatusBadge();
            this.startMonitoring();
            console.log('🚦 StatusBannerSystem initialized (admin mode)');
        } else {
            console.log('🚦 StatusBannerSystem: Not admin, skipping system indicators');
        }
    }

    /**
     * Create system health indicator
     */
    createSystemHealthIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'systemHealthIndicator';
        indicator.className = 'system-health-indicator';
        indicator.style.cssText = `
            position: fixed;
            top: 50px;
            left: 20px;
            padding: 10px 15px;
            background: rgba(0, 0, 0, 0.9);
            border: 2px solid #0f0;
            border-radius: 8px;
            color: #0f0;
            font-weight: bold;
            font-size: 12px;
            z-index: 9995;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
            transition: all 0.3s ease;
        `;

        const statusDot = document.createElement('div');
        statusDot.id = 'healthStatusDot';
        statusDot.style.cssText = `
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #0f0;
            box-shadow: 0 0 10px #0f0;
            animation: blink 1.5s ease-in-out infinite;
        `;

        const statusText = document.createElement('span');
        statusText.id = 'healthStatusText';
        statusText.textContent = 'SYSTEM HEALTHY';

        indicator.appendChild(statusDot);
        indicator.appendChild(statusText);

        // Add blink animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes blink {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
        `;
        document.head.appendChild(style);

        document.body.appendChild(indicator);
        this.banners.systemHealth = indicator;
    }

    /**
     * Create WAL status badge
     */
    createWALStatusBadge() {
        const badge = document.createElement('div');
        badge.id = 'walStatusBadge';
        badge.className = 'wal-status-badge';
        badge.style.cssText = `
            position: fixed;
            top: 100px;
            left: 20px;
            padding: 8px 12px;
            background: rgba(0, 0, 0, 0.9);
            border: 1px solid #0f0;
            border-radius: 6px;
            color: #0f0;
            font-size: 11px;
            z-index: 9995;
            display: flex;
            align-items: center;
            gap: 6px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        `;

        const icon = document.createElement('span');
        icon.textContent = '';

        const text = document.createElement('span');
        text.id = 'walStatusText';
        text.textContent = 'WAL: OK';

        badge.appendChild(icon);
        badge.appendChild(text);

        document.body.appendChild(badge);
        this.banners.walStatus = badge;
    }

    /**
     * Create queue status badge
     */
    createQueueStatusBadge() {
        const badge = document.createElement('div');
        badge.id = 'queueStatusBadge';
        badge.className = 'queue-status-badge';
        badge.style.cssText = `
            position: fixed;
            top: 140px;
            left: 20px;
            padding: 8px 12px;
            background: rgba(0, 0, 0, 0.9);
            border: 1px solid #0f0;
            border-radius: 6px;
            color: #0f0;
            font-size: 11px;
            z-index: 9995;
            display: flex;
            align-items: center;
            gap: 6px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        `;

        const icon = document.createElement('span');
        icon.textContent = '';

        const text = document.createElement('span');
        text.id = 'queueStatusText';
        text.textContent = 'Queue: NORMAL';

        badge.appendChild(icon);
        badge.appendChild(text);

        document.body.appendChild(badge);
        this.banners.queueStatus = badge;
    }

    /**
     * Start monitoring system status
     */
    startMonitoring() {
        // Update status every 3 seconds
        setInterval(() => {
            this.updateSystemHealth();
            this.updateWALStatus();
            this.updateQueueStatus();
        }, 3000);
    }

    /**
     * Update system health indicator
     */
    updateSystemHealth() {
        // Simulate health check (in real app, check actual metrics)
        const random = Math.random();
        let newStatus;

        if (random > 0.9) {
            newStatus = 'red';
        } else if (random > 0.7) {
            newStatus = 'yellow';
        } else {
            newStatus = 'green';
        }

        if (newStatus !== this.healthStatus) {
            this.healthStatus = newStatus;
            this.applyHealthStatus(newStatus);
        }
    }

    /**
     * Apply health status to indicator
     */
    applyHealthStatus(status) {
        const indicator = this.banners.systemHealth;
        const dot = document.getElementById('healthStatusDot');
        const text = document.getElementById('healthStatusText');

        switch (status) {
            case 'green':
                indicator.style.borderColor = '#0f0';
                indicator.style.color = '#0f0';
                dot.style.background = '#0f0';
                dot.style.boxShadow = '0 0 10px #0f0';
                text.textContent = 'SYSTEM HEALTHY';
                break;

            case 'yellow':
                indicator.style.borderColor = '#ff0';
                indicator.style.color = '#ff0';
                dot.style.background = '#ff0';
                dot.style.boxShadow = '0 0 10px #ff0';
                text.textContent = 'SYSTEM DEGRADED';
                break;

            case 'red':
                indicator.style.borderColor = '#f00';
                indicator.style.color = '#f00';
                dot.style.background = '#f00';
                dot.style.boxShadow = '0 0 10px #f00';
                text.textContent = 'SYSTEM CRITICAL';
                break;
        }
    }

    /**
     * Update WAL status badge
     */
    updateWALStatus() {
        // Simulate WAL status (in real app, fetch from metrics)
        const random = Math.random();
        let newStatus;

        if (random > 0.95) {
            newStatus = 'FULL';
        } else if (random > 0.85) {
            newStatus = 'DEGRADED';
        } else {
            newStatus = 'OK';
        }

        if (newStatus !== this.walStatus) {
            this.walStatus = newStatus;
            this.applyWALStatus(newStatus);
        }
    }

    /**
     * Apply WAL status to badge
     */
    applyWALStatus(status) {
        const badge = this.banners.walStatus;
        const text = document.getElementById('walStatusText');

        switch (status) {
            case 'OK':
                badge.style.borderColor = '#0f0';
                badge.style.color = '#0f0';
                text.textContent = 'WAL: OK';
                break;

            case 'DEGRADED':
                badge.style.borderColor = '#ff0';
                badge.style.color = '#ff0';
                text.textContent = 'WAL: DEGRADED';
                break;

            case 'FULL':
                badge.style.borderColor = '#f00';
                badge.style.color = '#f00';
                text.textContent = 'WAL: FULL';
                break;
        }
    }

    /**
     * Update queue status badge
     */
    updateQueueStatus() {
        // Simulate queue status (in real app, fetch from metrics)
        const random = Math.random();
        let newStatus;

        if (random > 0.95) {
            newStatus = 'CRITICAL';
        } else if (random > 0.85) {
            newStatus = 'BACKPRESSURE';
        } else {
            newStatus = 'NORMAL';
        }

        if (newStatus !== this.queueStatus) {
            this.queueStatus = newStatus;
            this.applyQueueStatus(newStatus);
        }
    }

    /**
     * Apply queue status to badge
     */
    applyQueueStatus(status) {
        const badge = this.banners.queueStatus;
        const text = document.getElementById('queueStatusText');

        switch (status) {
            case 'NORMAL':
                badge.style.borderColor = '#0f0';
                badge.style.color = '#0f0';
                text.textContent = 'Queue: NORMAL';
                break;

            case 'BACKPRESSURE':
                badge.style.borderColor = '#ff0';
                badge.style.color = '#ff0';
                text.textContent = 'Queue: BACKPRESSURE';
                break;

            case 'CRITICAL':
                badge.style.borderColor = '#f00';
                badge.style.color = '#f00';
                text.textContent = 'Queue: CRITICAL';
                break;
        }
    }

    /**
     * Hide all banners
     */
    hideAll() {
        Object.values(this.banners).forEach(banner => {
            if (banner) {
                banner.style.display = 'none';
            }
        });
    }

    /**
     * Show all banners
     */
    showAll() {
        Object.values(this.banners).forEach(banner => {
            if (banner) {
                banner.style.display = 'flex';
            }
        });
    }

    /**
     * Toggle banners visibility
     */
    toggle() {
        const reference = Object.values(this.banners).find(Boolean);
        if (!reference) return;
        const isVisible = reference.style.display !== 'none';
        if (isVisible) {
            this.hideAll();
        } else {
            this.showAll();
        }
    }
}

// Export
window.StatusBannerSystem = StatusBannerSystem;

console.log('🚦 StatusBannerSystem module loaded');
