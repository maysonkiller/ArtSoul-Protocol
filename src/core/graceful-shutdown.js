/**
 * Graceful Shutdown Manager
 *
 * Features:
 * - Close WAL properly
 * - Flush queue
 * - Save checkpoint
 * - Clean up resources
 * - Signal handlers (SIGINT, SIGTERM)
 */

class GracefulShutdown {
    constructor() {
        this.isShuttingDown = false;
        this.shutdownHandlers = [];
        this.timeout = 30000; // 30 seconds max shutdown time

        this.init();
    }

    /**
     * Initialize shutdown handlers
     */
    init() {
        // Browser: beforeunload event
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', (e) => {
                if (this.isShuttingDown) return;

                // Trigger shutdown
                this.shutdown();

                // Show confirmation dialog
                e.preventDefault();
                e.returnValue = '';
            });
        }

        // Node.js: process signals
        if (typeof process !== 'undefined') {
            process.on('SIGINT', () => this.handleSignal('SIGINT'));
            process.on('SIGTERM', () => this.handleSignal('SIGTERM'));
            process.on('uncaughtException', (error) => this.handleError(error));
            process.on('unhandledRejection', (reason) => this.handleError(reason));
        }

        console.log('🛡️ GracefulShutdown initialized');
    }

    /**
     * Register shutdown handler
     */
    register(name, handler, priority = 0) {
        this.shutdownHandlers.push({
            name,
            handler,
            priority
        });

        // Sort by priority (higher first)
        this.shutdownHandlers.sort((a, b) => b.priority - a.priority);

        console.log(`🛡️ Registered shutdown handler: ${name} (priority: ${priority})`);
    }

    /**
     * Handle process signal
     */
    async handleSignal(signal) {
        console.log(`🛡️ Received ${signal}, starting graceful shutdown...`);
        await this.shutdown();
        process.exit(0);
    }

    /**
     * Handle uncaught error
     */
    async handleError(error) {
        console.error('🛡️ Uncaught error:', error);
        await this.shutdown();
        process.exit(1);
    }

    /**
     * Perform graceful shutdown
     */
    async shutdown() {
        if (this.isShuttingDown) {
            console.log('🛡️ Shutdown already in progress...');
            return;
        }

        this.isShuttingDown = true;
        console.log('🛡️ Starting graceful shutdown...');

        const startTime = Date.now();

        // Set timeout
        const timeoutId = setTimeout(() => {
            console.error('🛡️ Shutdown timeout exceeded, forcing exit');
            if (typeof process !== 'undefined') {
                process.exit(1);
            }
        }, this.timeout);

        try {
            // Execute handlers in priority order
            for (const { name, handler } of this.shutdownHandlers) {
                try {
                    console.log(`🛡️ Executing shutdown handler: ${name}`);
                    await handler();
                    console.log(`🛡️  ${name} completed`);
                } catch (error) {
                    console.error(`🛡️  ${name} failed:`, error);
                }
            }

            const elapsed = Date.now() - startTime;
            console.log(`🛡️ Graceful shutdown completed in ${elapsed}ms`);

        } catch (error) {
            console.error('🛡️ Shutdown error:', error);
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Get shutdown status
     */
    isShutdown() {
        return this.isShuttingDown;
    }
}

// Create global instance
const gracefulShutdown = new GracefulShutdown();

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = gracefulShutdown;
}
if (typeof window !== 'undefined') {
    window.GracefulShutdown = gracefulShutdown;
}

console.log('🛡️ GracefulShutdown module loaded');
