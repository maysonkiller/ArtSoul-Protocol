/**
 * System Logger - Centralized Logging System for ArtSoul
 *
 * Features:
 * - Structured logging (INFO/WARN/ERROR)
 * - In-memory buffer for UI display
 * - Real-time event streaming
 * - Log filtering
 * - Export capability
 */

class SystemLogger {
    constructor(config = {}) {
        this.maxLogs = config.maxLogs || 1000;
        this.logs = [];
        this.listeners = [];
        this.filters = {
            level: null, // null = all, or 'INFO', 'WARN', 'ERROR'
            component: null,
            search: null
        };

        // Intercept console methods
        this.interceptConsole();

        console.log(' SystemLogger initialized');
    }

    /**
     * Intercept console.log/warn/error
     */
    interceptConsole() {
        const originalLog = console.log;
        const originalWarn = console.warn;
        const originalError = console.error;

        console.log = (...args) => {
            this.log('INFO', this.formatArgs(args));
            originalLog.apply(console, args);
        };

        console.warn = (...args) => {
            this.log('WARN', this.formatArgs(args));
            originalWarn.apply(console, args);
        };

        console.error = (...args) => {
            this.log('ERROR', this.formatArgs(args));
            originalError.apply(console, args);
        };
    }

    /**
     * Format console arguments
     */
    formatArgs(args) {
        return args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');
    }

    /**
     * Log message
     */
    log(level, message, metadata = {}) {
        const entry = {
            id: Date.now() + Math.random(),
            timestamp: new Date().toISOString(),
            level,
            message,
            component: metadata.component || this.detectComponent(message),
            metadata
        };

        this.logs.push(entry);

        // Trim logs if exceeds max
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }

        // Notify listeners
        this.notifyListeners(entry);

        return entry;
    }

    /**
     * Detect component from message
     */
    detectComponent(message) {
        if (message.includes('HybridQueue') || message.includes('queue')) return 'Queue';
        if (message.includes('WAL') || message.includes('wal')) return 'WAL';
        if (message.includes('Rate') || message.includes('rate')) return 'RateLimiter';
        if (message.includes('Backpressure') || message.includes('backpressure')) return 'Backpressure';
        if (message.includes('Theme') || message.includes('theme')) return 'Theme';
        if (message.includes('Navigation') || message.includes('nav')) return 'Navigation';
        if (message.includes('DB') || message.includes('PostgreSQL')) return 'Database';
        return 'System';
    }

    /**
     * Get logs with filters
     */
    getLogs(filters = {}) {
        let filtered = [...this.logs];

        // Apply level filter
        if (filters.level) {
            filtered = filtered.filter(log => log.level === filters.level);
        }

        // Apply component filter
        if (filters.component) {
            filtered = filtered.filter(log => log.component === filters.component);
        }

        // Apply search filter
        if (filters.search) {
            const search = filters.search.toLowerCase();
            filtered = filtered.filter(log =>
                log.message.toLowerCase().includes(search) ||
                log.component.toLowerCase().includes(search)
            );
        }

        return filtered;
    }

    /**
     * Get log statistics
     */
    getStats() {
        const stats = {
            total: this.logs.length,
            byLevel: {
                INFO: 0,
                WARN: 0,
                ERROR: 0
            },
            byComponent: {}
        };

        this.logs.forEach(log => {
            stats.byLevel[log.level]++;

            if (!stats.byComponent[log.component]) {
                stats.byComponent[log.component] = 0;
            }
            stats.byComponent[log.component]++;
        });

        return stats;
    }

    /**
     * Add listener for new logs
     */
    addListener(callback) {
        this.listeners.push(callback);
        return () => this.removeListener(callback);
    }

    /**
     * Remove listener
     */
    removeListener(callback) {
        const index = this.listeners.indexOf(callback);
        if (index > -1) {
            this.listeners.splice(index, 1);
        }
    }

    /**
     * Notify listeners
     */
    notifyListeners(entry) {
        this.listeners.forEach(callback => {
            try {
                callback(entry);
            } catch (error) {
                // Don't log to avoid infinite loop
            }
        });
    }

    /**
     * Clear logs
     */
    clear() {
        this.logs = [];
        console.log(' Logs cleared');
    }

    /**
     * Export logs
     */
    export(format = 'json') {
        if (format === 'json') {
            return JSON.stringify(this.logs, null, 2);
        } else if (format === 'csv') {
            const header = 'Timestamp,Level,Component,Message\n';
            const rows = this.logs.map(log =>
                `${log.timestamp},${log.level},${log.component},"${log.message.replace(/"/g, '""')}"`
            ).join('\n');
            return header + rows;
        } else if (format === 'text') {
            return this.logs.map(log =>
                `[${log.timestamp}] [${log.level}] [${log.component}] ${log.message}`
            ).join('\n');
        }
    }

    /**
     * Download logs
     */
    download(filename = 'artsoul-logs.json', format = 'json') {
        const content = this.export(format);
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
}

// Create global instance
const systemLogger = new SystemLogger();

// Export
window.SystemLogger = systemLogger;

console.log(' SystemLogger module loaded');
