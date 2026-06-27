import crypto from 'crypto';

class CryptographicAuditLog {
    constructor(database) {
        this.db = database;
        this.previousHash = null;
        console.log('[CryptographicAuditLog] Initialized');
    }

    async initialize() {
        const lastEntry = await this.db.query(
            'SELECT hash FROM moderation_log ORDER BY id DESC LIMIT 1'
        );

        if (lastEntry.length > 0) {
            this.previousHash = lastEntry[0].hash;
            console.log('[CryptographicAuditLog] Loaded previous hash:', this.previousHash);
        } else {
            this.previousHash = '0'.repeat(64);
            console.log('[CryptographicAuditLog] Genesis hash initialized');
        }
    }

    calculateHash(artworkId, action, reason, moderatorId, timestamp, previousHash) {
        const data = [
            artworkId,
            action,
            reason || '',
            moderatorId,
            timestamp.toString(),
            previousHash
        ].join('|');

        return crypto.createHash('sha256').update(data).digest('hex');
    }

    async appendLog(artworkId, action, reason, moderatorId, timestamp) {
        if (this.previousHash === null) {
            await this.initialize();
        }

        const hash = this.calculateHash(
            artworkId,
            action,
            reason,
            moderatorId,
            timestamp,
            this.previousHash
        );

        await this.db.query(
            `INSERT INTO moderation_log (artwork_id, action, reason, moderator_id, timestamp, previous_hash, hash)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [artworkId, action, reason, moderatorId, timestamp, this.previousHash, hash]
        );

        console.log(`[CryptographicAuditLog] Entry logged: ${action} on ${artworkId} by ${moderatorId}`);
        console.log(`  Previous hash: ${this.previousHash}`);
        console.log(`  New hash: ${hash}`);

        this.previousHash = hash;

        return {
            hash,
            previousHash: this.previousHash,
            timestamp
        };
    }

    async verifyChain(startId = null, endId = null) {
        let query = 'SELECT * FROM moderation_log';
        const params = [];

        if (startId !== null && endId !== null) {
            query += ' WHERE id BETWEEN ? AND ?';
            params.push(startId, endId);
        } else if (startId !== null) {
            query += ' WHERE id >= ?';
            params.push(startId);
        }

        query += ' ORDER BY id ASC';

        const entries = await this.db.query(query, params);

        if (entries.length === 0) {
            return {
                valid: true,
                message: 'No entries to verify'
            };
        }

        let expectedPreviousHash = entries[0].previous_hash;

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];

            if (entry.previous_hash !== expectedPreviousHash) {
                return {
                    valid: false,
                    message: `Chain broken at entry ${entry.id}`,
                    entryId: entry.id,
                    expected: expectedPreviousHash,
                    actual: entry.previous_hash
                };
            }

            const calculatedHash = this.calculateHash(
                entry.artwork_id,
                entry.action,
                entry.reason,
                entry.moderator_id,
                entry.timestamp,
                entry.previous_hash
            );

            if (calculatedHash !== entry.hash) {
                return {
                    valid: false,
                    message: `Hash mismatch at entry ${entry.id} - entry has been tampered with`,
                    entryId: entry.id,
                    expected: calculatedHash,
                    actual: entry.hash
                };
            }

            expectedPreviousHash = entry.hash;
        }

        return {
            valid: true,
            message: `Chain verified: ${entries.length} entries`,
            entriesVerified: entries.length,
            firstEntry: entries[0].id,
            lastEntry: entries[entries.length - 1].id
        };
    }

    async getChainProof(artworkId) {
        const entries = await this.db.query(
            `SELECT id, action, reason, moderator_id, timestamp, previous_hash, hash
             FROM moderation_log
             WHERE artwork_id = ?
             ORDER BY id ASC`,
            [artworkId]
        );

        return {
            artworkId,
            entries: entries.map(e => ({
                id: e.id,
                action: e.action,
                reason: e.reason,
                moderator: e.moderator_id,
                timestamp: e.timestamp,
                previousHash: e.previous_hash,
                hash: e.hash
            })),
            chainValid: await this._verifyArtworkChain(entries)
        };
    }

    async _verifyArtworkChain(entries) {
        if (entries.length === 0) return true;

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];

            const calculatedHash = this.calculateHash(
                entry.artwork_id,
                entry.action,
                entry.reason,
                entry.moderator_id,
                entry.timestamp,
                entry.previous_hash
            );

            if (calculatedHash !== entry.hash) {
                return false;
            }

            if (i > 0 && entry.previous_hash !== entries[i - 1].hash) {
                return false;
            }
        }

        return true;
    }

    async exportChainSnapshot() {
        const entries = await this.db.query(
            'SELECT * FROM moderation_log ORDER BY id ASC'
        );

        const snapshot = {
            exportedAt: Date.now(),
            totalEntries: entries.length,
            entries: entries,
            chainValid: (await this.verifyChain()).valid
        };

        const snapshotHash = crypto
            .createHash('sha256')
            .update(JSON.stringify(snapshot))
            .digest('hex');

        return {
            ...snapshot,
            snapshotHash
        };
    }
}

export default CryptographicAuditLog;

if (typeof window !== 'undefined') {
    window.CryptographicAuditLog = CryptographicAuditLog;
}
