import { ethers } from 'https://esm.sh/ethers@6.7.0';
import { RPC_CONFIG, CACHE_CONFIG, DEBUG_CONFIG, RPC_CLIENT_CONFIG } from '../../core/config/system-config.js';
import AuctionMetrics from '../../core/metrics/auction-metrics.js';
import RPCClient from '../../core/rpc/rpc-client.js';
import CoreMarketplaceEngine from '../../core/engine/index.js';

class AuctionService {
    constructor(contractsIntegration) {
        this.contracts = contractsIntegration;

        this.cache = new Map();
        this.lastInvalidations = new Map();

        this.eventListeners = {
            auctionCreated: null,
            bidPlaced: null,
            auctionEnded: null,
            settlementCompleted: null,
            settlementDefaulted: null
        };

        if (DEBUG_CONFIG.ENABLED) {
            this.metrics = new AuctionMetrics();
            this.startMetricsReporting();
        }

        this.circuitBreaker = {
            state: 'CLOSED',
            failures: 0,
            successes: 0,
            lastFailureTime: null,
            openedAt: null
        };

        this.rpcClient = null;
        if (RPC_CLIENT_CONFIG.ENABLED) {
            this.rpcClient = new RPCClient(RPC_CLIENT_CONFIG);
            console.log('[RPC CLIENT] Enabled with primary/backup fallback');
        }

        this.engine = new CoreMarketplaceEngine();

        if (this.contracts.marketplaceContract) {
            this.setupEventListeners();
        }
    }

    setupEventListeners() {
        if (!this.contracts.marketplaceContract) {
            console.warn('Cannot setup event listeners: contract not initialized');
            return;
        }

        if (this.eventListeners.auctionCreated !== null) {
            console.warn('Event listeners already setup - skipping duplicate registration');
            return;
        }

        const contract = this.contracts.marketplaceContract;

        this.eventListeners.auctionCreated = contract.on('AuctionCreated', (auctionId, artworkId) => {
            if (DEBUG_CONFIG.LOG_EVENTS) {
                console.log('[EVENT] AuctionCreated', { auctionId: auctionId.toString(), artworkId: artworkId.toString() });
            }
            this.metrics?.recordEvent('auctionCreated');
            this.invalidateCache(artworkId.toString());
        });

        this.eventListeners.bidPlaced = contract.on('BidPlaced', (auctionId, bidder, bidAmount, depositAmount) => {
            if (DEBUG_CONFIG.LOG_EVENTS) {
                console.log('[EVENT] BidPlaced', { auctionId: auctionId.toString(), bidder, bidAmount: ethers.formatEther(bidAmount), depositAmount: ethers.formatEther(depositAmount) });
            }
            this.metrics?.recordEvent('bidPlaced');
            this.invalidateCache(auctionId.toString());
        });

        this.eventListeners.auctionEnded = contract.on('AuctionEnded', (auctionId, winner, winningBid, settlementDeadline) => {
            if (DEBUG_CONFIG.LOG_EVENTS) {
                console.log('[EVENT] AuctionEnded', { auctionId: auctionId.toString(), winner, winningBid: ethers.formatEther(winningBid), settlementDeadline: Number(settlementDeadline) });
            }
            this.metrics?.recordEvent('auctionEnded');
            this.invalidateCache(auctionId.toString());
        });

        this.eventListeners.settlementCompleted = contract.on('SettlementCompleted', (auctionId, artworkId, winner, finalPrice, tokenId) => {
            if (DEBUG_CONFIG.LOG_EVENTS) {
                console.log('[EVENT] SettlementCompleted', { auctionId: auctionId.toString(), artworkId: artworkId.toString(), winner, finalPrice: ethers.formatEther(finalPrice), tokenId: tokenId.toString() });
            }
            this.metrics?.recordEvent('settlementCompleted');
            this.invalidateCache(artworkId.toString());
        });

        this.eventListeners.settlementDefaulted = contract.on('SettlementDefaulted', (auctionId, winner) => {
            if (DEBUG_CONFIG.LOG_EVENTS) {
                console.log('[EVENT] SettlementDefaulted', { auctionId: auctionId.toString(), winner });
            }
            this.metrics?.recordEvent('settlementDefaulted');
            this.invalidateCache(auctionId.toString());
        });

        console.log('Event listeners setup complete');
    }

    removeEventListeners() {
        if (!this.contracts.marketplaceContract) {
            return;
        }

        const contract = this.contracts.marketplaceContract;

        if (this.eventListeners.auctionCreated) {
            contract.off('AuctionCreated', this.eventListeners.auctionCreated);
        }
        if (this.eventListeners.bidPlaced) {
            contract.off('BidPlaced', this.eventListeners.bidPlaced);
        }
        if (this.eventListeners.auctionEnded) {
            contract.off('AuctionEnded', this.eventListeners.auctionEnded);
        }
        if (this.eventListeners.settlementCompleted) {
            contract.off('SettlementCompleted', this.eventListeners.settlementCompleted);
        }
        if (this.eventListeners.settlementDefaulted) {
            contract.off('SettlementDefaulted', this.eventListeners.settlementDefaulted);
        }

        this.eventListeners = {
            auctionCreated: null,
            bidPlaced: null,
            auctionEnded: null,
            settlementCompleted: null,
            settlementDefaulted: null
        };

        this.cache.clear();
        this.lastInvalidations.clear();

        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
            this.metricsInterval = null;
        }

        console.log('Event listeners removed and cache cleared');
    }

    startMetricsReporting() {
        if (!DEBUG_CONFIG.ENABLED) return;

        this.metricsInterval = setInterval(() => {
            const summary = this.metrics.getSummary();
            console.log('[METRICS] Summary', summary);
        }, DEBUG_CONFIG.METRICS_INTERVAL);

        console.log('[METRICS] Reporting started (interval:', DEBUG_CONFIG.METRICS_INTERVAL, 'ms)');
    }

    _checkCircuitBreaker() {
        const cb = this.circuitBreaker;

        if (cb.state === 'CLOSED') {
            return true;
        }

        if (cb.state === 'OPEN') {
            const now = Date.now();
            const timeSinceOpen = now - cb.openedAt;

            if (timeSinceOpen >= RPC_CONFIG.CIRCUIT_BREAKER.RESET_TIMEOUT_MS) {
                cb.state = 'HALF_OPEN';
                cb.successes = 0;
                this.metrics?.recordCircuitBreakerHalfOpen();
                console.log('[CIRCUIT BREAKER] Entering HALF_OPEN state');
                return true;
            }

            this.metrics?.recordCircuitBreakerRejection();
            return false;
        }

        if (cb.state === 'HALF_OPEN') {
            return true;
        }
    }

    _recordCircuitBreakerSuccess() {
        const cb = this.circuitBreaker;

        if (cb.state === 'CLOSED') {
            cb.failures = 0;
            return;
        }

        if (cb.state === 'HALF_OPEN') {
            cb.successes++;
            if (cb.successes >= RPC_CONFIG.CIRCUIT_BREAKER.SUCCESS_THRESHOLD) {
                cb.state = 'CLOSED';
                cb.failures = 0;
                cb.successes = 0;
                this.metrics?.recordCircuitBreakerClose();
                console.log('[CIRCUIT BREAKER] Closed - service recovered');
            }
        }
    }

    _recordCircuitBreakerFailure() {
        const cb = this.circuitBreaker;

        if (cb.state === 'CLOSED') {
            cb.failures++;
            cb.lastFailureTime = Date.now();

            if (cb.failures >= RPC_CONFIG.CIRCUIT_BREAKER.FAILURE_THRESHOLD) {
                cb.state = 'OPEN';
                cb.openedAt = Date.now();
                this.metrics?.recordCircuitBreakerOpen();
                console.error('[CIRCUIT BREAKER] Opened - too many failures');
            }
        }

        if (cb.state === 'HALF_OPEN') {
            cb.state = 'OPEN';
            cb.openedAt = Date.now();
            cb.successes = 0;
            this.metrics?.recordCircuitBreakerOpen();
            console.error('[CIRCUIT BREAKER] Reopened - test failed');
        }
    }

    async _callWithRetry(fn, artworkId, attempt = 1) {
        const timeout = new Promise((_, reject) =>
            setTimeout(() => {
                this.metrics?.recordTimeout();
                reject(new Error('RPC timeout'));
            }, RPC_CONFIG.TIMEOUT_MS)
        );

        try {
            const result = await Promise.race([fn(), timeout]);

            if (attempt > 1) {
                this.metrics?.recordRetryAttempt(true);
            }

            return result;
        } catch (error) {
            if (attempt < RPC_CONFIG.RETRY_ATTEMPTS) {
                this.metrics?.recordRetryAttempt(false);
                console.warn(`[RETRY] Attempt ${attempt}/${RPC_CONFIG.RETRY_ATTEMPTS} for ${artworkId}:`, error.message);
                await new Promise(resolve => setTimeout(resolve, RPC_CONFIG.RETRY_DELAY_MS));
                return this._callWithRetry(fn, artworkId, attempt + 1);
            }
            throw error;
        }
    }

    _getCacheKey(artworkId) {
        return `auction_${artworkId}`;
    }

    _getFromCache(artworkId) {
        const key = this._getCacheKey(artworkId);
        const cached = this.cache.get(key);

        if (!cached) {
            this.metrics?.recordCacheMiss();
            if (DEBUG_CONFIG.LOG_CACHE) {
                console.log('[CACHE] Miss', { artworkId });
            }
            return null;
        }

        const now = Date.now();
        if (now > cached.expiresAt) {
            this.cache.delete(key);
            this.metrics?.recordCacheMiss();
            if (DEBUG_CONFIG.LOG_CACHE) {
                console.log('[CACHE] Expired', { artworkId });
            }
            return null;
        }

        this.metrics?.recordCacheHit();
        if (DEBUG_CONFIG.LOG_CACHE) {
            console.log('[CACHE] Hit', { artworkId });
        }
        return cached.data;
    }

    _getStaleCache(artworkId) {
        const key = this._getCacheKey(artworkId);
        const cached = this.cache.get(key);

        if (!cached) {
            return null;
        }

        this.metrics?.recordStaleCacheHit();
        return cached.data;
    }

    _setCache(artworkId, data) {
        const key = this._getCacheKey(artworkId);

        const lastInvalidation = this.lastInvalidations.get(key);
        if (lastInvalidation && Date.now() - lastInvalidation < 1000) {
            this.metrics?.recordCacheWrite(true);
            if (DEBUG_CONFIG.LOG_CACHE) {
                console.warn('[CACHE] Write skipped - recently invalidated', { artworkId });
            }
            return;
        }

        if (CACHE_CONFIG.ENFORCE_MAX_SIZE && this.cache.size >= CACHE_CONFIG.MAX_SIZE) {
            let oldestKey = null;
            let oldestTime = Infinity;

            for (const [k, v] of this.cache.entries()) {
                if (v.expiresAt < oldestTime) {
                    oldestTime = v.expiresAt;
                    oldestKey = k;
                }
            }

            if (oldestKey) {
                this.cache.delete(oldestKey);
                this.metrics?.recordCacheEviction();
                if (DEBUG_CONFIG.LOG_CACHE) {
                    console.log('[CACHE] Evicted oldest entry (LRU):', oldestKey);
                }
            }
        }

        this.cache.set(key, {
            data: data,
            expiresAt: Date.now() + CACHE_CONFIG.TTL_MS
        });

        this.metrics?.recordCacheWrite(false);
        this.metrics?.updateCacheSize(this.cache.size);

        if (DEBUG_CONFIG.LOG_CACHE) {
            console.log('[CACHE] Write', { artworkId, cacheSize: this.cache.size });
        }
    }

    invalidateCache(artworkId) {
        const key = this._getCacheKey(artworkId);
        this.cache.delete(key);

        this.lastInvalidations.set(key, Date.now());

        if (this.lastInvalidations.size > 100) {
            const entries = Array.from(this.lastInvalidations.entries());
            entries.sort((a, b) => a[1] - b[1]);
            const toDelete = entries.slice(0, entries.length - 100);
            toDelete.forEach(([k]) => this.lastInvalidations.delete(k));
        }

        this.metrics?.recordInvalidation();
        this.metrics?.updateCacheSize(this.cache.size);

        if (DEBUG_CONFIG.LOG_CACHE) {
            console.log('[CACHE] Invalidated', { artworkId, cacheSize: this.cache.size });
        }
    }

    clearCache() {
        this.cache.clear();
        this.lastInvalidations.clear();
    }

    async getAuctionStatesBatch(artworkIds, offchainDataMap = {}) {
        if (!artworkIds || artworkIds.length === 0) {
            return [];
        }

        const startTime = Date.now();
        const CONCURRENCY_LIMIT = RPC_CONFIG.CONCURRENCY_LIMIT;
        const results = [];

        for (let i = 0; i < artworkIds.length; i += CONCURRENCY_LIMIT) {
            const batch = artworkIds.slice(i, i + CONCURRENCY_LIMIT);

            const batchPromises = batch.map(artworkId =>
                this.getAuctionState(artworkId)
                    .catch(error => {
                        console.error(`[BATCH ERROR] Failed to get auction state for ${artworkId}:`, {
                            error: error.message,
                            stack: error.stack,
                            circuitBreakerState: this.circuitBreaker.state,
                            cacheAvailable: this.cache.has(this._getCacheKey(artworkId)),
                            timestamp: new Date().toISOString()
                        });
                        return null;
                    })
            );

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
        }

        const filtered = results.filter(result => result !== null);

        const totalTime = Date.now() - startTime;
        this.metrics?.recordBatchExecution(artworkIds.length, totalTime);
        this.metrics?.recordBatchSize(artworkIds.length);

        if (DEBUG_CONFIG.LOG_BATCH) {
            const numBatches = Math.ceil(artworkIds.length / CONCURRENCY_LIMIT);
            console.log('[BATCH] Execution completed', {
                artworks: artworkIds.length,
                batches: numBatches,
                time: totalTime,
                avgPerArtwork: Math.round(totalTime / artworkIds.length),
                successRate: ((filtered.length / artworkIds.length) * 100).toFixed(2) + '%'
            });
        }

        return filtered;
    }

    async getAuctionState(artworkId) {
        if (!this.contracts.marketplaceContract) {
            throw new Error('Contracts not initialized');
        }

        const cached = this._getFromCache(artworkId);
        if (cached) {
            return cached;
        }

        if (!this._checkCircuitBreaker()) {
            console.warn('[CIRCUIT BREAKER] Open - attempting stale cache for', artworkId);
            const staleCache = this._getStaleCache(artworkId);
            if (staleCache) {
                console.warn('[FALLBACK] Using stale cache for', artworkId);
                return staleCache;
            }
            throw new Error('Circuit breaker open and no cache available');
        }

        const startTime = Date.now();

        try {
            const auction = await this._callWithRetry(
                () => this.contracts.getAuction(artworkId),
                artworkId
            );

            const startTimeRaw = Number(auction.startTime);
            const endTimeRaw = Number(auction.endTime);

            console.log('[TIMESTAMP DEBUG]', {
                artworkId,
                startTimeRaw,
                endTimeRaw,
                startTimeMs: startTimeRaw > 1000000000000 ? startTimeRaw : startTimeRaw * 1000,
                endTimeMs: endTimeRaw > 1000000000000 ? endTimeRaw : endTimeRaw * 1000
            });

            const startTimeMs = startTimeRaw > 1000000000000 ? startTimeRaw : startTimeRaw * 1000;
            const endTimeMs = endTimeRaw > 1000000000000 ? endTimeRaw : endTimeRaw * 1000;

            const artworkData = {
                id: artworkId.toString(),
                floorPrice: auction.startingPrice,
                sold: auction.settled,
                listed: auction.status === 'active' || auction.status === 'settlement_pending'
            };

            const bids = auction.highestBidder && auction.highestBidder !== ethers.ZeroAddress
                ? [{ bidder: auction.highestBidder, amount: auction.highestBid }]
                : [];

            const auctionData = {
                startTime: startTimeMs,
                endTime: endTimeMs,
                highestBidder: auction.highestBidder,
                highestBid: auction.highestBid,
                sold: auction.settled,
                finalized: auction.ended,
                bids: bids
            };

            const state = this.engine.getArtworkState(
                artworkData,
                auctionData,
                null,
                null,
                Date.now()
            );

            const engineCapabilities = {
                extensionWorking: this.engine.auctionEngine.canCalculateExtensions(auctionData),
                settlementWindowWorking: auction.status === 'settlement_pending',
                pullWithdrawalsWorking: true,
                realBidHistory: bids.length > 0 && bids.some(bid => bid.timestamp !== undefined)
            };

            console.log('[ENGINE STATE]', {
                artworkId,
                resolvedState: state.state,
                metadata: state.metadata
            });

            console.log('[VALIDATION]', {
                artworkId,
                hasBids: auctionData.bids.length,
                endTime: auctionData.endTime,
                state: state.state,
                engineCapabilities
            });

            const result = {
                artworkId: artworkId.toString(),
                state: state.state,
                metadata: state.metadata,
                visibility: state.visibility,
                engineCapabilities,
                startTime: startTimeRaw,
                endTime: endTimeRaw,
                startingPrice: auction.startingPrice,
                highestBid: auction.highestBid,
                highestBidder: auction.highestBidder,
                auctionWinner: auction.auctionWinner,
                winnerDeadline: Number(auction.winnerDeadline),
                ended: auction.ended,
                settlementPending: auction.settlementPending,
                defaulted: auction.defaulted,
                status: auction.status,
                minimumBid: auction.minimumBid,
                requiredNextBid: auction.requiredNextBid,
                depositLocked: auction.depositLocked
            };

            this._setCache(artworkId, result);

            const latency = Date.now() - startTime;
            this.metrics?.recordRPCCall(true, latency);
            this._recordCircuitBreakerSuccess();

            if (DEBUG_CONFIG.LOG_RPC) {
                console.log('[RPC] Success', { artworkId, latency });
            }

            return result;
        } catch (error) {
            const latency = Date.now() - startTime;
            this.metrics?.recordRPCCall(false, latency);
            this._recordCircuitBreakerFailure();

            if (DEBUG_CONFIG.LOG_RPC) {
                console.error('[RPC] Failed', { artworkId, latency, error: error.message });
            }

            const staleCache = this._getStaleCache(artworkId);
            if (staleCache) {
                console.warn('[FALLBACK] RPC failed, using stale cache for', artworkId);
                return staleCache;
            }

            console.error('Failed to get auction state:', error);
            throw error;
        }
    }

    async canPlaceBid(artworkId, userAddress, artworkCreator) {
        try {
            const result = await this.getAuctionState(artworkId);

            if (result.state !== 'AUCTION') {
                return { canBid: false, reason: 'Auction is not active' };
            }

            if (userAddress && artworkCreator &&
                userAddress.toLowerCase() === artworkCreator.toLowerCase()) {
                return { canBid: false, reason: 'Creator cannot bid on own artwork' };
            }

            return { canBid: true };
        } catch (error) {
            console.error('Failed to check bid eligibility:', error);
            return { canBid: false, reason: 'Failed to check auction state' };
        }
    }

    _normalizeTimestamp(value) {
        const timestamp = Number(value || 0);
        if (!Number.isFinite(timestamp) || timestamp <= 0) {
            return 0;
        }

        return timestamp > 1000000000000 ? timestamp : timestamp * 1000;
    }

    shouldEndAuction(auction) {
        if (!auction) {
            return false;
        }

        if (auction.ended || auction.finalized || auction.settled || auction.defaulted) {
            return false;
        }

        const status = String(auction.status || '').toLowerCase();
        if (status && status !== 'active') {
            return false;
        }

        const state = String(auction.state || '').toUpperCase();
        if (state && state !== 'PRIMARY_ACTIVE' && state !== 'AUCTION') {
            return false;
        }

        const endTime = this._normalizeTimestamp(auction.endTime);
        return endTime > 0 && Date.now() >= endTime;
    }

    formatTimeRemaining(endTime) {
        const endTimeMs = this._normalizeTimestamp(endTime);
        if (!endTimeMs) {
            return 'Unknown';
        }

        const remaining = Math.max(0, endTimeMs - Date.now());
        if (remaining <= 0) {
            return 'Ended';
        }

        const days = Math.floor(remaining / 86400000);
        const hours = Math.floor((remaining % 86400000) / 3600000);
        const minutes = Math.floor((remaining % 3600000) / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);

        if (days > 0) {
            return `${days}d ${hours}h ${minutes}m`;
        }
        if (hours > 0) {
            return `${hours}h ${minutes}m ${seconds}s`;
        }
        if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        }
        return `${seconds}s`;
    }

    calculateMinimumBid(currentHighestBid, startingPrice) {
        const current = parseFloat(currentHighestBid);
        const starting = parseFloat(startingPrice);

        if (current === 0 || isNaN(current)) {
            return starting;
        }

        return current + Math.max(0.01, current * 0.025);
    }

    validateBidAmount(bidAmount, minimumBid) {
        const bid = parseFloat(bidAmount);
        const min = parseFloat(minimumBid);

        if (isNaN(bid) || bid <= 0) {
            return { valid: false, error: 'Invalid bid amount' };
        }

        if (bid < min) {
            return { valid: false, error: `Bid must be at least ${min.toFixed(4)} ETH` };
        }

        return { valid: true };
    }
}

export default AuctionService;

if (typeof window !== 'undefined') {
    window.AuctionService = AuctionService;
}
