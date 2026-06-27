import EventListener from './event-listener.js';
import IndexerSyncEngine from './sync-engine.js';
import cacheService from '../services/cache-service.js';

class ArtSoulIndexer {
    constructor(config) {
        this.config = config;
        this.db = config.database;
        this.chainId = Number(config.chainId || 0);

        this.eventListener = new EventListener({
            rpcUrl: config.rpcUrl,
            contractAddress: config.contractAddress,
            chainId: this.chainId
        });

        this.syncEngine = new IndexerSyncEngine(this.db, this.eventListener);

        console.log('[ArtSoulIndexer] Initialized');
        console.log('  Contract:', config.contractAddress);
        console.log('  Chain:', this.chainId);
        console.log('  Start Block:', config.startBlock);
    }

    _chainIdString() {
        return this.chainId.toString();
    }

    _scopedCacheKey(type, id) {
        return `${this._chainIdString()}:${type}:${id}`;
    }

    _timeValue(value) {
        if (!value) {
            return null;
        }
        return value instanceof Date ? value.getTime() : Number(value);
    }

    async start() {
        console.log('[ArtSoulIndexer] Starting indexer...');

        await this.syncEngine.initialize(
            this.config.contractAddress,
            this.chainId,
            this.config.startBlock
        );

        const state = await this.syncEngine.getIndexerState();
        const currentBlock = await this.eventListener.getCurrentBlock();

        console.log(`[ArtSoulIndexer] Current state:`);
        console.log(`  Last indexed block: ${state.last_indexed_block}`);
        console.log(`  Current block: ${currentBlock}`);
        console.log(`  Blocks behind: ${currentBlock - state.last_indexed_block}`);

        if (currentBlock > state.last_indexed_block) {
            console.log('[ArtSoulIndexer] Syncing historical events...');
            const eventCount = await this.syncEngine.syncHistoricalEvents(
                state.last_indexed_block + 1,
                currentBlock
            );
            console.log(`[ArtSoulIndexer] Synced ${eventCount} historical events`);
        }

        await this.syncEngine.start();

        console.log('[ArtSoulIndexer] Indexer started and listening for new events');
    }

    async stop() {
        console.log('[ArtSoulIndexer] Stopping indexer...');
        await this.syncEngine.stop();
        console.log('[ArtSoulIndexer] Indexer stopped');
    }

    async getAuction(artworkId) {
        const cacheKey = cacheService.keys.auction(this._scopedCacheKey('artwork', artworkId));
        return cacheService.remember(cacheKey, 3600, async () => {
            const auction = await this.db.query(
                `SELECT a.*, art.metadata_uri, art.minted, art.canonical_floor
                 FROM v41_auctions a
                 LEFT JOIN v41_artworks art ON art.chain_id = a.chain_id AND art.artwork_id = a.artwork_id
                 WHERE a.chain_id = $1 AND a.artwork_id = $2
                 ORDER BY a.auction_id DESC
                 LIMIT 1`,
                [this._chainIdString(), artworkId]
            );

            if (auction.length === 0) {
                return null;
            }

            return {
                artworkId: auction[0].artwork_id,
                auctionId: auction[0].auction_id,
                creator: auction[0].creator,
                startingPrice: auction[0].start_price,
                duration: auction[0].duration,
                endTime: this._timeValue(auction[0].end_time),
                settlementDeadline: this._timeValue(auction[0].settlement_deadline),
                status: auction[0].status,
                settled: auction[0].status === 'settled',
                defaulted: auction[0].status === 'defaulted' || auction[0].status === 'defaulted_no_bids',
                currentBidder: auction[0].current_bidder,
                currentBid: auction[0].current_bid,
                winner: auction[0].winner,
                winningBid: auction[0].winning_bid,
                tokenId: auction[0].token_id,
                canonicalFloor: auction[0].canonical_floor,
                minted: auction[0].minted,
                blockNumber: auction[0].block_number,
                lastUpdatedBlock: auction[0].last_updated_block
            };
        });
    }

    async getBids(artworkId) {
        const cacheKey = cacheService.keys.bids(this._scopedCacheKey('artwork', artworkId));
        return cacheService.remember(cacheKey, 3600, async () => {
            const bids = await this.db.query(
                `SELECT * FROM v41_bids
                 WHERE chain_id = $1 AND artwork_id = $2
                 ORDER BY block_number ASC, log_index ASC`,
                [this._chainIdString(), artworkId]
            );

            return bids.map(bid => ({
                auctionId: bid.auction_id,
                bidder: bid.bidder,
                amount: bid.bid_amount,
                depositAmount: bid.deposit_amount,
                timestamp: this._timeValue(bid.indexed_at),
                blockNumber: bid.block_number,
                transactionHash: bid.transaction_hash
            }));
        });
    }

    async getActiveAuctions() {
        const now = Date.now();

        const auctions = await this.db.query(
            `SELECT * FROM v41_auctions
             WHERE chain_id = $1
             AND status = 'active'
             AND end_time > to_timestamp($2 / 1000.0)
             ORDER BY end_time ASC`,
            [this._chainIdString(), now]
        );

        return auctions.map(a => ({
            auctionId: a.auction_id,
            artworkId: a.artwork_id,
            creator: a.creator,
            startingPrice: a.start_price,
            endTime: this._timeValue(a.end_time),
            currentBidder: a.current_bidder,
            currentBid: a.current_bid
        }));
    }

    async getEndedAuctions(limit = 100) {
        const auctions = await this.db.query(
            `SELECT * FROM v41_auctions
             WHERE chain_id = $1
             AND status IN ('settlement_pending', 'settled', 'defaulted', 'defaulted_no_bids')
             ORDER BY end_time DESC
             LIMIT $2`,
            [this._chainIdString(), limit]
        );

        return auctions.map(a => ({
            auctionId: a.auction_id,
            artworkId: a.artwork_id,
            creator: a.creator,
            winner: a.winner,
            winningBid: a.winning_bid,
            endTime: this._timeValue(a.end_time),
            status: a.status,
            settled: a.status === 'settled'
        }));
    }

    async getUserBids(userAddress) {
        const bids = await this.db.query(
            `SELECT b.*, a.creator, a.status
             FROM v41_bids b
             JOIN v41_auctions a ON a.chain_id = b.chain_id AND b.auction_id = a.auction_id
             WHERE b.chain_id = $1 AND b.bidder = $2
             ORDER BY b.block_number DESC, b.log_index DESC`,
            [this._chainIdString(), userAddress]
        );

        return bids.map(bid => ({
            auctionId: bid.auction_id,
            artworkId: bid.artwork_id,
            amount: bid.bid_amount,
            depositAmount: bid.deposit_amount,
            timestamp: this._timeValue(bid.indexed_at),
            creator: bid.creator,
            auctionStatus: bid.status,
            settled: bid.status === 'settled'
        }));
    }

    async getUserAuctions(userAddress) {
        const auctions = await this.db.query(
            `SELECT * FROM v41_auctions
             WHERE chain_id = $1 AND creator = $2
             ORDER BY auction_id DESC`,
            [this._chainIdString(), userAddress]
        );

        return auctions.map(a => ({
            auctionId: a.auction_id,
            artworkId: a.artwork_id,
            startingPrice: a.start_price,
            endTime: this._timeValue(a.end_time),
            status: a.status,
            currentBid: a.current_bid,
            settled: a.status === 'settled'
        }));
    }

    async getRecentEvents(limit = 100) {
        const events = await this.db.query(
            `SELECT * FROM contract_events
             WHERE chain_id = $1
             ORDER BY block_number DESC, log_index DESC
             LIMIT $2`,
            [this._chainIdString(), limit]
        );

        return events.map(e => ({
            eventName: e.event_name,
            artworkId: e.artwork_id,
            blockNumber: e.block_number,
            transactionHash: e.transaction_hash,
            eventData: JSON.parse(e.event_data),
            indexedAt: e.indexed_at
        }));
    }

    async getIndexerHealth() {
        const cacheKey = cacheService.keys.stats(`health:${this._chainIdString()}`);
        return cacheService.remember(cacheKey, 30, async () => {
            const state = await this.syncEngine.getIndexerState();
            const currentBlock = await this.eventListener.getCurrentBlock();
            const errors = await this.syncEngine.getUnresolvedErrors();

            return {
                status: state.status,
                lastIndexedBlock: state.last_indexed_block,
                currentBlock: currentBlock,
                blocksBehind: currentBlock - state.last_indexed_block,
                totalEventsIndexed: state.total_events_indexed,
                unresolvedErrors: errors.length,
                lastIndexedAt: state.last_indexed_at,
                uptime: Date.now() - state.started_at
            };
        });
    }

    async rebuildFromBlock(startBlock) {
        console.log(`[ArtSoulIndexer] Rebuilding from block ${startBlock}...`);
        await cacheService.purge();

        await this.db.query('DELETE FROM v41_genesis_holders WHERE chain_id = $1 AND block_number >= $2', [this._chainIdString(), startBlock]);
        await this.db.query('DELETE FROM v41_project_eligibility WHERE chain_id = $1 AND block_number >= $2', [this._chainIdString(), startBlock]);
        await this.db.query('DELETE FROM v41_resale_history WHERE chain_id = $1 AND block_number >= $2', [this._chainIdString(), startBlock]);
        await this.db.query('DELETE FROM v41_resale_listings WHERE chain_id = $1 AND block_number >= $2', [this._chainIdString(), startBlock]);
        await this.db.query('DELETE FROM v41_floor_history WHERE chain_id = $1 AND block_number >= $2', [this._chainIdString(), startBlock]);
        await this.db.query('DELETE FROM v41_settlements WHERE chain_id = $1 AND block_number >= $2', [this._chainIdString(), startBlock]);
        await this.db.query('DELETE FROM v41_auction_endings WHERE chain_id = $1 AND block_number >= $2', [this._chainIdString(), startBlock]);
        await this.db.query('DELETE FROM v41_auction_extensions WHERE chain_id = $1 AND block_number >= $2', [this._chainIdString(), startBlock]);
        await this.db.query('DELETE FROM v41_bid_withdrawals WHERE chain_id = $1 AND block_number >= $2', [this._chainIdString(), startBlock]);
        await this.db.query('DELETE FROM v41_bids WHERE chain_id = $1 AND block_number >= $2', [this._chainIdString(), startBlock]);
        await this.db.query('DELETE FROM v41_auctions WHERE chain_id = $1 AND block_number >= $2', [this._chainIdString(), startBlock]);
        await this.db.query('DELETE FROM v41_artworks WHERE chain_id = $1 AND block_number >= $2', [this._chainIdString(), startBlock]);
        await this.db.query('DELETE FROM contract_events WHERE chain_id = $1 AND block_number >= $2', [this._chainIdString(), startBlock]);

        await this.db.query(
            'UPDATE indexer_state SET last_indexed_block = $1 WHERE chain_id = $2',
            [startBlock - 1, this._chainIdString()]
        );

        const currentBlock = await this.eventListener.getCurrentBlock();
        const eventCount = await this.syncEngine.syncHistoricalEvents(startBlock, currentBlock);

        console.log(`[ArtSoulIndexer] Rebuild complete: ${eventCount} events reindexed`);

        return {
            startBlock,
            endBlock: currentBlock,
            eventsReindexed: eventCount
        };
    }
}

export default ArtSoulIndexer;

if (typeof window !== 'undefined') {
    window.ArtSoulIndexer = ArtSoulIndexer;
}
