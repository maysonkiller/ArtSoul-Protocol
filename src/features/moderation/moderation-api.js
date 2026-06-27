import express from 'express';

function createModerationAPI(moderationService, authMiddleware) {
    const router = express.Router();

    router.post('/artwork/:artworkId/hide', authMiddleware.requireModerator, async (req, res) => {
        try {
            const { artworkId } = req.params;
            const { reason } = req.body;
            const moderatorId = req.user.id;

            if (!reason) {
                return res.status(400).json({
                    error: 'Reason is required',
                    code: 'MISSING_REASON'
                });
            }

            const result = await moderationService.hideArtwork(artworkId, reason, moderatorId);

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('[ModerationAPI] Hide artwork failed:', error);
            res.status(500).json({
                error: 'Failed to hide artwork',
                code: 'HIDE_FAILED'
            });
        }
    });

    router.post('/artwork/:artworkId/unhide', authMiddleware.requireModerator, async (req, res) => {
        try {
            const { artworkId } = req.params;
            const moderatorId = req.user.id;

            const result = await moderationService.unhideArtwork(artworkId, moderatorId);

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('[ModerationAPI] Unhide artwork failed:', error);
            res.status(500).json({
                error: 'Failed to unhide artwork',
                code: 'UNHIDE_FAILED'
            });
        }
    });

    router.post('/artwork/:artworkId/feature', authMiddleware.requireModerator, async (req, res) => {
        try {
            const { artworkId } = req.params;
            const { featured } = req.body;
            const moderatorId = req.user.id;

            const result = await moderationService.setFeatured(artworkId, featured, moderatorId);

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('[ModerationAPI] Set featured failed:', error);
            res.status(500).json({
                error: 'Failed to set featured status',
                code: 'FEATURE_FAILED'
            });
        }
    });

    router.post('/artwork/:artworkId/curate', authMiddleware.requireModerator, async (req, res) => {
        try {
            const { artworkId } = req.params;
            const { curated } = req.body;
            const moderatorId = req.user.id;

            const result = await moderationService.setCurated(artworkId, curated, moderatorId);

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('[ModerationAPI] Set curated failed:', error);
            res.status(500).json({
                error: 'Failed to set curated status',
                code: 'CURATE_FAILED'
            });
        }
    });

    router.get('/artwork/:artworkId/visibility', async (req, res) => {
        try {
            const { artworkId } = req.params;

            const visibility = await moderationService.getArtworkVisibility(artworkId);

            res.json({
                success: true,
                data: visibility
            });
        } catch (error) {
            console.error('[ModerationAPI] Get visibility failed:', error);
            res.status(500).json({
                error: 'Failed to get visibility',
                code: 'GET_VISIBILITY_FAILED'
            });
        }
    });

    router.get('/artwork/:artworkId/history', authMiddleware.requireModerator, async (req, res) => {
        try {
            const { artworkId } = req.params;

            const history = await moderationService.getModerationHistory(artworkId);

            res.json({
                success: true,
                data: history
            });
        } catch (error) {
            console.error('[ModerationAPI] Get history failed:', error);
            res.status(500).json({
                error: 'Failed to get moderation history',
                code: 'GET_HISTORY_FAILED'
            });
        }
    });

    router.get('/hidden-artworks', authMiddleware.requireModerator, async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 100;
            const offset = parseInt(req.query.offset) || 0;

            const artworks = await moderationService.getHiddenArtworks(limit, offset);

            res.json({
                success: true,
                data: artworks,
                pagination: {
                    limit,
                    offset,
                    count: artworks.length
                }
            });
        } catch (error) {
            console.error('[ModerationAPI] Get hidden artworks failed:', error);
            res.status(500).json({
                error: 'Failed to get hidden artworks',
                code: 'GET_HIDDEN_FAILED'
            });
        }
    });

    return router;
}

export default createModerationAPI;
