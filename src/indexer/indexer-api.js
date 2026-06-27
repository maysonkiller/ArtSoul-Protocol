import express from 'express';

function createIndexerAPI(indexer, moderationService, authMiddleware = {}) {
    const router = express.Router();
    const requireOperator = authMiddleware.requireOperator || ((_req, res) => {
        res.status(403).json({
            error: 'Administrative access required',
            code: 'ADMIN_REQUIRED'
        });
    });

    // Get auction with full data (indexed + moderation)
    router.get('/auction/:artworkId', async (req, res) => {
        try {
            const { artworkId } = req.params;

            const [auction, bids, visibility] = await Promise.all([
                indexer.getAuction(artworkId),
                indexer.getBids(artworkId),
                moderationService
                    ? moderationService.getArtworkVisibility(artworkId)
                    : Promise.resolve({ hidden: false, featured: false, curated: false })
            ]);

            if (!auction) {
                return res.status(404).json({
                    error: 'Auction not found',
                    code: 'AUCTION_NOT_FOUND'
                });
            }

            res.json({
                success: true,
                data: {
                    auction,
                    bids,
                    moderation: visibility
                }
            });
        } catch (error) {
            console.error('[IndexerAPI] Get auction failed:', error);
            res.status(500).json({
                error: 'Failed to fetch auction',
                code: 'FETCH_FAILED'
            });
        }
    });

    // Get active auctions (filtered by moderation)
    router.get('/auctions/active', async (req, res) => {
        try {
            const auctions = await indexer.getActiveAuctions();

            // Filter out hidden artworks
            const filtered = [];
            for (const auction of auctions) {
                if (moderationService) {
                    const visibility = await moderationService.getArtworkVisibility(auction.artworkId);
                    if (!visibility.hidden) {
                        filtered.push({ ...auction, moderation: visibility });
                    }
                } else {
                    filtered.push(auction);
                }
            }

            res.json({
                success: true,
                data: filtered,
                count: filtered.length
            });
        } catch (error) {
            console.error('[IndexerAPI] Get active auctions failed:', error);
            res.status(500).json({
                error: 'Failed to fetch active auctions',
                code: 'FETCH_FAILED'
            });
        }
    });

    // Get ended auctions
    router.get('/auctions/ended', async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 100;
            const auctions = await indexer.getEndedAuctions(limit);

            res.json({
                success: true,
                data: auctions,
                count: auctions.length
            });
        } catch (error) {
            console.error('[IndexerAPI] Get ended auctions failed:', error);
            res.status(500).json({
                error: 'Failed to fetch ended auctions',
                code: 'FETCH_FAILED'
            });
        }
    });

    // Get user bids
    router.get('/user/:address/bids', async (req, res) => {
        try {
            const { address } = req.params;
            const bids = await indexer.getUserBids(address);

            res.json({
                success: true,
                data: bids,
                count: bids.length
            });
        } catch (error) {
            console.error('[IndexerAPI] Get user bids failed:', error);
            res.status(500).json({
                error: 'Failed to fetch user bids',
                code: 'FETCH_FAILED'
            });
        }
    });

    // Get user auctions
    router.get('/user/:address/auctions', async (req, res) => {
        try {
            const { address } = req.params;
            const auctions = await indexer.getUserAuctions(address);

            res.json({
                success: true,
                data: auctions,
                count: auctions.length
            });
        } catch (error) {
            console.error('[IndexerAPI] Get user auctions failed:', error);
            res.status(500).json({
                error: 'Failed to fetch user auctions',
                code: 'FETCH_FAILED'
            });
        }
    });

    // Get recent events
    router.get('/events/recent', async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 100;
            const events = await indexer.getRecentEvents(limit);

            res.json({
                success: true,
                data: events,
                count: events.length
            });
        } catch (error) {
            console.error('[IndexerAPI] Get recent events failed:', error);
            res.status(500).json({
                error: 'Failed to fetch recent events',
                code: 'FETCH_FAILED'
            });
        }
    });

    // Get indexer health
    router.get('/health', async (req, res) => {
        try {
            const health = await indexer.getIndexerHealth();

            res.json({
                success: true,
                data: health
            });
        } catch (error) {
            console.error('[IndexerAPI] Get health failed:', error);
            res.status(500).json({
                error: 'Failed to fetch indexer health',
                code: 'FETCH_FAILED'
            });
        }
    });

    // Rebuild from block (admin only)
    router.post('/rebuild', requireOperator, async (req, res) => {
        try {
            const { startBlock } = req.body;

            if (!startBlock) {
                return res.status(400).json({
                    error: 'startBlock is required',
                    code: 'MISSING_START_BLOCK'
                });
            }

            const result = await indexer.rebuildFromBlock(startBlock);

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('[IndexerAPI] Rebuild failed:', error);
            res.status(500).json({
                error: 'Failed to rebuild indexer',
                code: 'REBUILD_FAILED'
            });
        }
    });

    return router;
}

export default createIndexerAPI;
