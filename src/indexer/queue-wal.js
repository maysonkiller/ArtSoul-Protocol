/**
 * Production-Grade WAL (Write-Ahead Log)
 *
 * Features:
 * - Durability: fsync after every write
 * - Segmentation: multiple files with rotation
 * - Size limits: hard limit with rejection
 * - Checkpoint: track recovery position
 * - Compaction: remove old segments
 *
 * Architecture:
 * - Segments: queue-wal-0000.log, queue-wal-0001.log, ...
 * - Checkpoint: checkpoint.json (last recovered offset)
 * - Active segment: current write target
 * - Rotation: when segment reaches maxSegmentSize
 */

import fs from 'fs/promises';
import { existsSync, openSync, fsyncSync, writeSync, closeSync } from 'fs';
import path from 'path';

export default class QueueWAL {
    constructor(config = {}) {
        this.walPath = config.walPath || './.queue-wal';
        this.maxSegmentSize = config.maxSegmentSize || 10 * 1024 * 1024; // 10MB per segment
        this.maxTotalSize = config.maxTotalSize || 100 * 1024 * 1024; // 100MB total
        this.retentionSegments = config.retentionSegments || 10; // Keep last 10 segments

        this.currentSegmentId = 0;
        this.currentSegmentSize = 0;
        this.currentSegmentFd = null;
        this.totalSize = 0;

        this.checkpointFile = path.join(this.walPath, 'checkpoint.json');

        this.metrics = {
            written: 0,
            recovered: 0,
            errors: 0,
            fsyncs: 0,
            rotations: 0
        };
    }

    /**
     * Initialize WAL
     */
    async init() {
        try {
            // Create WAL directory
            if (!existsSync(this.walPath)) {
                await fs.mkdir(this.walPath, { recursive: true });
            }

            // Find existing segments
            const files = await fs.readdir(this.walPath);
            const segments = files
                .filter(f => f.startsWith('queue-wal-') && f.endsWith('.log'))
                .map(f => parseInt(f.match(/queue-wal-(\d+)\.log/)[1]))
                .sort((a, b) => a - b);

            if (segments.length > 0) {
                this.currentSegmentId = segments[segments.length - 1];
            }

            // Calculate total size
            this.totalSize = await this.calculateTotalSize();

            // Open current segment for append
            await this.openCurrentSegment();

            console.log('[QueueWAL] Initialized', {
                walPath: this.walPath,
                currentSegmentId: this.currentSegmentId,
                totalSize: this.totalSize,
                maxTotalSize: this.maxTotalSize
            });
        } catch (error) {
            console.error('[QueueWAL] Init failed:', error.message);
            throw error;
        }
    }

    /**
     * Open current segment for writing
     */
    async openCurrentSegment() {
        const segmentFile = this.getSegmentPath(this.currentSegmentId);

        // Open with append flag
        this.currentSegmentFd = openSync(segmentFile, 'a');

        // Get current segment size
        if (existsSync(segmentFile)) {
            const stats = await fs.stat(segmentFile);
            this.currentSegmentSize = stats.size;
        } else {
            this.currentSegmentSize = 0;
        }
    }

    /**
     * Write event to WAL with fsync
     */
    async write(event, idempotencyKey) {
        try {
            // Check total size limit (hard limit)
            if (this.totalSize >= this.maxTotalSize) {
                this.metrics.errors++;
                throw new Error(`WAL full: ${this.totalSize} >= ${this.maxTotalSize} bytes`);
            }

            const entry = {
                event,
                idempotencyKey,
                timestamp: Date.now(),
                segmentId: this.currentSegmentId,
                offset: this.currentSegmentSize
            };

            const line = JSON.stringify(entry) + '\n';
            const buffer = Buffer.from(line, 'utf8');

            // Write to file descriptor
            writeSync(this.currentSegmentFd, buffer);

            // CRITICAL: fsync to ensure durability
            fsyncSync(this.currentSegmentFd);
            this.metrics.fsyncs++;

            // Update sizes
            this.currentSegmentSize += buffer.length;
            this.totalSize += buffer.length;
            this.metrics.written++;

            // Check if rotation needed
            if (this.currentSegmentSize >= this.maxSegmentSize) {
                await this.rotateSegment();
            }

            return true;
        } catch (error) {
            this.metrics.errors++;
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                component: 'QueueWAL',
                phase: 'write_error',
                error: error.message
            }));
            throw error;
        }
    }

    /**
     * Rotate to new segment
     */
    async rotateSegment() {
        try {
            // Close current segment
            if (this.currentSegmentFd !== null) {
                closeSync(this.currentSegmentFd);
                this.currentSegmentFd = null;
            }

            // Increment segment ID
            this.currentSegmentId++;
            this.currentSegmentSize = 0;
            this.metrics.rotations++;

            // Open new segment
            await this.openCurrentSegment();

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                component: 'QueueWAL',
                phase: 'segment_rotated',
                new_segment_id: this.currentSegmentId
            }));

            // Cleanup old segments
            await this.cleanupOldSegments();
        } catch (error) {
            console.error('[QueueWAL] Rotation failed:', error.message);
            throw error;
        }
    }

    /**
     * Cleanup old segments (retention policy)
     */
    async cleanupOldSegments() {
        try {
            const files = await fs.readdir(this.walPath);
            const segments = files
                .filter(f => f.startsWith('queue-wal-') && f.endsWith('.log'))
                .map(f => {
                    const id = parseInt(f.match(/queue-wal-(\d+)\.log/)[1]);
                    return { id, file: f };
                })
                .sort((a, b) => a.id - b.id);

            // Keep only last N segments
            const toDelete = segments.slice(0, Math.max(0, segments.length - this.retentionSegments));

            for (const segment of toDelete) {
                const segmentPath = path.join(this.walPath, segment.file);
                const stats = await fs.stat(segmentPath);
                await fs.unlink(segmentPath);
                this.totalSize -= stats.size;

                console.log(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    component: 'QueueWAL',
                    phase: 'segment_deleted',
                    segment_id: segment.id,
                    freed_bytes: stats.size
                }));
            }
        } catch (error) {
            console.error('[QueueWAL] Cleanup failed:', error.message);
        }
    }

    /**
     * Recover events from WAL with checkpoint
     */
    async recover(queue) {
        try {
            // Read checkpoint
            const checkpoint = await this.readCheckpoint();

            console.log('[QueueWAL] Starting recovery from checkpoint:', checkpoint);

            const files = await fs.readdir(this.walPath);
            const segments = files
                .filter(f => f.startsWith('queue-wal-') && f.endsWith('.log'))
                .map(f => {
                    const id = parseInt(f.match(/queue-wal-(\d+)\.log/)[1]);
                    return { id, file: f };
                })
                .sort((a, b) => a.id - b.id);

            if (segments.length === 0) {
                console.log('[QueueWAL] No segments found, nothing to recover');
                return { recovered: 0, failed: 0, skipped: 0 };
            }

            let recovered = 0;
            let failed = 0;
            let skipped = 0;

            for (const segment of segments) {
                // Skip segments before checkpoint
                if (segment.id < checkpoint.segmentId) {
                    skipped++;
                    continue;
                }

                const segmentPath = path.join(this.walPath, segment.file);
                const content = await fs.readFile(segmentPath, 'utf8');
                const lines = content.trim().split('\n').filter(line => line.length > 0);

                for (let i = 0; i < lines.length; i++) {
                    try {
                        const entry = JSON.parse(lines[i]);

                        // Skip entries before checkpoint offset
                        if (segment.id === checkpoint.segmentId && entry.offset < checkpoint.offset) {
                            skipped++;
                            continue;
                        }

                        // Replay to queue
                        const result = await queue.enqueue(entry.event);

                        if (result.enqueued) {
                            recovered++;
                        } else if (result.reason === 'duplicate') {
                            // Already in DB, count as recovered
                            recovered++;
                        } else {
                            failed++;
                        }

                        // Update checkpoint every 100 events
                        if ((recovered + failed) % 100 === 0) {
                            await this.writeCheckpoint({
                                segmentId: segment.id,
                                offset: entry.offset,
                                timestamp: Date.now()
                            });
                        }
                    } catch (error) {
                        failed++;
                        console.error('[QueueWAL] Failed to recover entry:', error.message);
                    }
                }
            }

            this.metrics.recovered = recovered;

            // Write final checkpoint
            await this.writeCheckpoint({
                segmentId: this.currentSegmentId,
                offset: this.currentSegmentSize,
                timestamp: Date.now()
            });

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                component: 'QueueWAL',
                phase: 'recovery_complete',
                recovered,
                failed,
                skipped,
                total_segments: segments.length
            }));

            // Archive recovered segments
            await this.archiveRecoveredSegments(segments);

            return { recovered, failed, skipped };
        } catch (error) {
            console.error('[QueueWAL] Recovery failed:', error.message);
            throw error;
        }
    }

    /**
     * Read checkpoint
     */
    async readCheckpoint() {
        try {
            if (!existsSync(this.checkpointFile)) {
                return { segmentId: 0, offset: 0, timestamp: 0 };
            }

            const content = await fs.readFile(this.checkpointFile, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            console.warn('[QueueWAL] Failed to read checkpoint:', error.message);
            return { segmentId: 0, offset: 0, timestamp: 0 };
        }
    }

    /**
     * Write checkpoint
     */
    async writeCheckpoint(checkpoint) {
        try {
            await fs.writeFile(
                this.checkpointFile,
                JSON.stringify(checkpoint, null, 2),
                'utf8'
            );
        } catch (error) {
            console.error('[QueueWAL] Failed to write checkpoint:', error.message);
        }
    }

    /**
     * Archive recovered segments
     */
    async archiveRecoveredSegments(segments) {
        try {
            const archiveDir = path.join(this.walPath, 'archive');
            if (!existsSync(archiveDir)) {
                await fs.mkdir(archiveDir, { recursive: true });
            }

            for (const segment of segments) {
                const sourcePath = path.join(this.walPath, segment.file);
                const archivePath = path.join(archiveDir, `${segment.file}.${Date.now()}.recovered`);

                if (existsSync(sourcePath)) {
                    await fs.rename(sourcePath, archivePath);
                }
            }

            console.log('[QueueWAL] Segments archived to:', archiveDir);
        } catch (error) {
            console.error('[QueueWAL] Archive failed:', error.message);
        }
    }

    /**
     * Calculate total WAL size
     */
    async calculateTotalSize() {
        try {
            const files = await fs.readdir(this.walPath);
            const segments = files.filter(f => f.startsWith('queue-wal-') && f.endsWith('.log'));

            let total = 0;
            for (const file of segments) {
                const filePath = path.join(this.walPath, file);
                const stats = await fs.stat(filePath);
                total += stats.size;
            }

            return total;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Get segment file path
     */
    getSegmentPath(segmentId) {
        const paddedId = segmentId.toString().padStart(4, '0');
        return path.join(this.walPath, `queue-wal-${paddedId}.log`);
    }

    /**
     * Get WAL metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            currentSegmentId: this.currentSegmentId,
            currentSegmentSize: this.currentSegmentSize,
            totalSize: this.totalSize,
            maxTotalSize: this.maxTotalSize
        };
    }

    /**
     * Clear WAL (for testing)
     */
    async clear() {
        try {
            // Close current segment
            if (this.currentSegmentFd !== null) {
                closeSync(this.currentSegmentFd);
                this.currentSegmentFd = null;
            }

            // Delete all segments
            const files = await fs.readdir(this.walPath);
            const segments = files.filter(f => f.startsWith('queue-wal-') && f.endsWith('.log'));

            for (const file of segments) {
                await fs.unlink(path.join(this.walPath, file));
            }

            // Delete checkpoint
            if (existsSync(this.checkpointFile)) {
                await fs.unlink(this.checkpointFile);
            }

            // Reset state
            this.currentSegmentId = 0;
            this.currentSegmentSize = 0;
            this.totalSize = 0;

            // Reopen
            await this.openCurrentSegment();
        } catch (error) {
            console.error('[QueueWAL] Clear failed:', error.message);
        }
    }

    /**
     * Close WAL
     */
    async close() {
        if (this.currentSegmentFd !== null) {
            closeSync(this.currentSegmentFd);
            this.currentSegmentFd = null;
        }
    }
}
