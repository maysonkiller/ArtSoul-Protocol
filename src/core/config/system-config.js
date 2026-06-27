// System Configuration
// Centralized configuration for all system components

export const SYSTEM_CONFIG = {
    // RPC Configuration
    RPC: {
        CONCURRENCY_LIMIT: 50, // Safe range: 25-75
        TIMEOUT_MS: 30000,
        RETRY_ATTEMPTS: 3,
        RETRY_DELAY_MS: 1000,
        CIRCUIT_BREAKER: {
            FAILURE_THRESHOLD: 5,
            RESET_TIMEOUT_MS: 10000,
            SUCCESS_THRESHOLD: 2
        }
    },

    // Cache Configuration
    CACHE: {
        TTL_SECONDS: 15,
        get TTL_MS() {
            return this.TTL_SECONDS * 1000;
        },
        MAX_SIZE: 10000,
        ENFORCE_MAX_SIZE: true
    },

    // Auction Configuration
    AUCTION: {
        ALLOWED_DURATIONS_HOURS: [24, 36, 48],
        SETTLEMENT_WINDOW_HOURS: 24
    },

    // Debug & Observability Configuration
    DEBUG: {
        ENABLED: false,         // Master debug switch (disable in production)
        LOG_LEVEL: 'INFO',      // ERROR, WARN, INFO, DEBUG
        LOG_RPC: false,         // Log RPC calls
        LOG_CACHE: false,       // Log cache operations
        LOG_EVENTS: false,      // Log events
        LOG_BATCH: false,       // Log batch execution
        METRICS_INTERVAL: 60000 // Metrics summary interval (ms)
    },

    // RPC Client Configuration
    RPC_CLIENT: {
        ENABLED: false,         // Feature flag: enable RPC client layer
        PRIMARY_RPC_URL: null,  // Set via environment or config
        BACKUP_RPC_URL: null    // Set via environment or config
    }
};

// Export individual configs for convenience
export const RPC_CONFIG = SYSTEM_CONFIG.RPC;
export const CACHE_CONFIG = SYSTEM_CONFIG.CACHE;
export const AUCTION_CONFIG = SYSTEM_CONFIG.AUCTION;
export const DEBUG_CONFIG = SYSTEM_CONFIG.DEBUG;
export const RPC_CLIENT_CONFIG = SYSTEM_CONFIG.RPC_CLIENT;

// Make available globally for HTML pages
if (typeof window !== 'undefined') {
    window.SYSTEM_CONFIG = SYSTEM_CONFIG;
    window.RPC_CONFIG = RPC_CONFIG;
    window.CACHE_CONFIG = CACHE_CONFIG;
    window.AUCTION_CONFIG = AUCTION_CONFIG;
    window.DEBUG_CONFIG = DEBUG_CONFIG;
    window.RPC_CLIENT_CONFIG = RPC_CLIENT_CONFIG;
}
