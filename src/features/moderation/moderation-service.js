class ModerationService {
    constructor(database, rbacService, auditLog) {
        this.db = database;
        this.rbac = rbacService;
        this.auditLog = auditLog;
        console.log('[ModerationService] Initialized');
        console.log('  RBAC:', rbacService ? 'Enabled' : 'Disabled');
        console.log('  Cryptographic Audit:', auditLog ? 'Enabled' : 'Disabled');
    }

    async getArtworkVisibility(artworkId) {
        const visibility = await this.db.query(
            'SELECT hidden, featured, curated, hidden_reason, hidden_at, hidden_by FROM artwork_visibility WHERE artwork_id = ?',
            [artworkId]
        );

        if (!visibility || visibility.length === 0) {
            return {
                hidden: false,
                featured: false,
                curated: false,
                hiddenReason: null,
                hiddenAt: null,
                hiddenBy: null
            };
        }

        return {
            hidden: visibility[0].hidden,
            featured: visibility[0].featured,
            curated: visibility[0].curated,
            hiddenReason: visibility[0].hidden_reason,
            hiddenAt: visibility[0].hidden_at,
            hiddenBy: visibility[0].hidden_by
        };
    }

    async hideArtwork(artworkId, reason, moderatorId) {
        if (this.rbac) {
            const canHide = await this.rbac.canPerformAction(moderatorId, 'artwork', 'hide', { reason });

            if (!canHide.allowed) {
                throw new Error(`Permission denied: ${canHide.reason}`);
            }
        }

        const now = Date.now();

        await this.db.query(
            `INSERT INTO artwork_visibility (artwork_id, hidden, hidden_reason, hidden_at, hidden_by, updated_at)
             VALUES (?, true, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
             hidden = true,
             hidden_reason = VALUES(hidden_reason),
             hidden_at = VALUES(hidden_at),
             hidden_by = VALUES(hidden_by),
             updated_at = VALUES(updated_at)`,
            [artworkId, reason, now, moderatorId, now]
        );

        await this._logModerationAction(artworkId, 'HIDE', reason, moderatorId, now);

        console.log(`[ModerationService] Artwork ${artworkId} hidden by ${moderatorId}: ${reason}`);

        return {
            success: true,
            artworkId,
            action: 'HIDE',
            reason,
            timestamp: now
        };
    }

    async unhideArtwork(artworkId, moderatorId) {
        if (this.rbac) {
            const canUnhide = await this.rbac.canPerformAction(moderatorId, 'artwork', 'unhide');

            if (!canUnhide.allowed) {
                throw new Error(`Permission denied: ${canUnhide.reason}`);
            }
        }

        const now = Date.now();

        await this.db.query(
            `UPDATE artwork_visibility
             SET hidden = false,
                 hidden_reason = NULL,
                 hidden_at = NULL,
                 hidden_by = NULL,
                 updated_at = ?
             WHERE artwork_id = ?`,
            [now, artworkId]
        );

        await this._logModerationAction(artworkId, 'UNHIDE', null, moderatorId, now);

        console.log(`[ModerationService] Artwork ${artworkId} unhidden by ${moderatorId}`);

        return {
            success: true,
            artworkId,
            action: 'UNHIDE',
            timestamp: now
        };
    }

    async setFeatured(artworkId, featured, moderatorId) {
        if (this.rbac) {
            const canFeature = await this.rbac.canPerformAction(moderatorId, 'artwork', 'feature');

            if (!canFeature.allowed) {
                throw new Error(`Permission denied: ${canFeature.reason}`);
            }
        }

        const now = Date.now();

        await this.db.query(
            `INSERT INTO artwork_visibility (artwork_id, featured, updated_at)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
             featured = VALUES(featured),
             updated_at = VALUES(updated_at)`,
            [artworkId, featured, now]
        );

        await this._logModerationAction(
            artworkId,
            featured ? 'FEATURE' : 'UNFEATURE',
            null,
            moderatorId,
            now
        );

        console.log(`[ModerationService] Artwork ${artworkId} ${featured ? 'featured' : 'unfeatured'} by ${moderatorId}`);

        return {
            success: true,
            artworkId,
            action: featured ? 'FEATURE' : 'UNFEATURE',
            timestamp: now
        };
    }

    async setCurated(artworkId, curated, moderatorId) {
        if (this.rbac) {
            const canCurate = await this.rbac.canPerformAction(moderatorId, 'artwork', 'curate');

            if (!canCurate.allowed) {
                throw new Error(`Permission denied: ${canCurate.reason}`);
            }
        }

        const now = Date.now();

        await this.db.query(
            `INSERT INTO artwork_visibility (artwork_id, curated, updated_at)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
             curated = VALUES(curated),
             updated_at = VALUES(updated_at)`,
            [artworkId, curated, now]
        );

        await this._logModerationAction(
            artworkId,
            curated ? 'CURATE' : 'UNCURATE',
            null,
            moderatorId,
            now
        );

        console.log(`[ModerationService] Artwork ${artworkId} ${curated ? 'curated' : 'uncurated'} by ${moderatorId}`);

        return {
            success: true,
            artworkId,
            action: curated ? 'CURATE' : 'UNCURATE',
            timestamp: now
        };
    }

    async getModerationHistory(artworkId) {
        const history = await this.db.query(
            `SELECT action, reason, moderator_id, timestamp
             FROM moderation_log
             WHERE artwork_id = ?
             ORDER BY timestamp DESC`,
            [artworkId]
        );

        return history;
    }

    async getHiddenArtworks(limit = 100, offset = 0) {
        const artworks = await this.db.query(
            `SELECT artwork_id, hidden_reason, hidden_at, hidden_by
             FROM artwork_visibility
             WHERE hidden = true
             ORDER BY hidden_at DESC
             LIMIT ? OFFSET ?`,
            [limit, offset]
        );

        return artworks;
    }

    async _logModerationAction(artworkId, action, reason, moderatorId, timestamp) {
        if (this.auditLog) {
            await this.auditLog.appendLog(artworkId, action, reason, moderatorId, timestamp);
        } else {
            await this.db.query(
                `INSERT INTO moderation_log (artwork_id, action, reason, moderator_id, timestamp)
                 VALUES (?, ?, ?, ?, ?)`,
                [artworkId, action, reason, moderatorId, timestamp]
            );
        }
    }
}

export default ModerationService;

if (typeof window !== 'undefined') {
    window.ModerationService = ModerationService;
}
