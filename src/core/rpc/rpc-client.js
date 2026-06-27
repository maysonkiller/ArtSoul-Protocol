// RPC Client - Minimal stability layer
// Provides: Primary/Backup fallback + Request deduplication
// Does NOT: Retry storms, health scoring, parallel execution

import { ethers } from 'https://esm.sh/ethers@6.7.0';

class RPCClient {
    constructor(config) {
        this.config = config;

        // Request deduplication: track in-flight requests
        this.inFlightRequests = new Map(); // key → Promise

        // RPC providers
        this.providers = {
            primary: this._createProvider(config.PRIMARY_RPC_URL),
            backup: this._createProvider(config.BACKUP_RPC_URL)
        };

        // Simple metrics
        this.metrics = {
            primaryCalls: 0,
            primaryFailures: 0,
            backupCalls: 0,
            backupFailures: 0,
            deduplicatedRequests: 0
        };
    }

    /**
     * Create ethers provider
     */
    _createProvider(rpcUrl) {
        if (!rpcUrl) return null;
        return new ethers.JsonRpcProvider(rpcUrl);
    }

    /**
     * Generate cache key for request deduplication
     */
    _getRequestKey(contractAddress, method, params) {
        return `${contractAddress}:${method}:${JSON.stringify(params)}`;
    }

    /**
     * Execute contract call with primary/backup fallback
     * Deduplicates concurrent requests for same data
     */
    async call(contractAddress, abi, method, params = []) {
        const key = this._getRequestKey(contractAddress, method, params);

        // Check if request already in flight
        if (this.inFlightRequests.has(key)) {
            this.metrics.deduplicatedRequests++;
            return await this.inFlightRequests.get(key);
        }

        // Create new request
        const promise = this._executeCall(contractAddress, abi, method, params)
            .finally(() => {
                // Cleanup after request completes
                this.inFlightRequests.delete(key);
            });

        this.inFlightRequests.set(key, promise);
        return await promise;
    }

    /**
     * Execute call with primary/backup fallback
     */
    async _executeCall(contractAddress, abi, method, params) {
        // Try primary
        if (this.providers.primary) {
            try {
                this.metrics.primaryCalls++;
                const result = await this._callProvider(
                    this.providers.primary,
                    contractAddress,
                    abi,
                    method,
                    params
                );
                return result;
            } catch (error) {
                this.metrics.primaryFailures++;
                console.warn('[RPC] Primary failed:', error.message);
                // Fall through to backup
            }
        }

        // Try backup
        if (this.providers.backup) {
            try {
                this.metrics.backupCalls++;
                const result = await this._callProvider(
                    this.providers.backup,
                    contractAddress,
                    abi,
                    method,
                    params
                );
                console.log('[RPC] Backup succeeded');
                return result;
            } catch (error) {
                this.metrics.backupFailures++;
                console.error('[RPC] Backup failed:', error.message);
                throw error;
            }
        }

        // No backup configured
        throw new Error('Primary RPC failed and no backup configured');
    }

    /**
     * Call specific provider
     */
    async _callProvider(provider, contractAddress, abi, method, params) {
        const contract = new ethers.Contract(contractAddress, abi, provider);
        return await contract[method](...params);
    }

    /**
     * Get metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            primarySuccessRate: this.metrics.primaryCalls > 0
                ? ((this.metrics.primaryCalls - this.metrics.primaryFailures) / this.metrics.primaryCalls * 100).toFixed(2)
                : 0,
            backupSuccessRate: this.metrics.backupCalls > 0
                ? ((this.metrics.backupCalls - this.metrics.backupFailures) / this.metrics.backupCalls * 100).toFixed(2)
                : 0
        };
    }

    /**
     * Reset metrics
     */
    resetMetrics() {
        this.metrics = {
            primaryCalls: 0,
            primaryFailures: 0,
            backupCalls: 0,
            backupFailures: 0,
            deduplicatedRequests: 0
        };
    }
}

// Export for use in other modules
export default RPCClient;

// Make available globally for HTML pages
if (typeof window !== 'undefined') {
    window.RPCClient = RPCClient;
}
