export const EVENT_PROCESSING_LEASE_TIMEOUT_MS = 120000;

function identityParams(lease) {
    return [
        lease.chainId,
        lease.transactionHash,
        lease.logIndex,
        lease.eventHash,
        lease.workerId,
        lease.processingStartedAt
    ];
}

export class EventProcessingLeaseLostError extends Error {
    constructor(eventHash) {
        super(`Event processing lease lost for ${eventHash}`);
        this.name = 'EventProcessingLeaseLostError';
        this.code = 'INDEXER_EVENT_LEASE_LOST';
        this.eventHash = eventHash;
    }
}

export class EventProcessingLeaseUnavailableError extends Error {
    constructor(eventHash, status) {
        super(`Event processing lease unavailable for ${eventHash} (status: ${status})`);
        this.name = 'EventProcessingLeaseUnavailableError';
        this.code = 'INDEXER_EVENT_LEASE_UNAVAILABLE';
        this.eventHash = eventHash;
        this.status = status;
    }
}

export async function claimEventProcessingLease(database, {
    eventHash,
    chainId,
    transactionHash,
    logIndex,
    eventName,
    blockNumber,
    workerId,
    correlationId,
    leaseTimeoutMs = EVENT_PROCESSING_LEASE_TIMEOUT_MS
}) {
    const rows = await database.query(
        `INSERT INTO event_processing_registry (
            event_hash, chain_id, transaction_hash, log_index, event_name, block_number,
            processing_status, processing_started_at, processing_completed_at,
            processing_error, retry_count, owner_worker_id,
            last_heartbeat_at, correlation_id
        ) VALUES (
            $1, $2, $3, $4, $5, $6,
            'processing', clock_timestamp(), NULL,
            NULL, 0, $7,
            clock_timestamp(), $8
        )
        ON CONFLICT (chain_id, transaction_hash, log_index) DO UPDATE SET
            event_hash = EXCLUDED.event_hash,
            event_name = EXCLUDED.event_name,
            block_number = EXCLUDED.block_number,
            processing_status = 'processing',
            processing_started_at = clock_timestamp(),
            processing_completed_at = NULL,
            processing_error = NULL,
            retry_count = event_processing_registry.retry_count + 1,
            owner_worker_id = EXCLUDED.owner_worker_id,
            last_heartbeat_at = clock_timestamp(),
            correlation_id = EXCLUDED.correlation_id
        WHERE event_processing_registry.processing_status <> 'completed'
          AND (
              event_processing_registry.processing_status <> 'processing'
              OR event_processing_registry.last_heartbeat_at IS NULL
              OR event_processing_registry.last_heartbeat_at
                    <= clock_timestamp() - ($9::BIGINT * INTERVAL '1 millisecond')
          )
        RETURNING
            event_hash,
            chain_id,
            transaction_hash,
            log_index,
            processing_status,
            retry_count,
            owner_worker_id,
            processing_started_at::TEXT AS processing_started_at`,
        [
            eventHash,
            chainId,
            transactionHash,
            logIndex,
            eventName,
            blockNumber,
            workerId,
            correlationId,
            leaseTimeoutMs
        ]
    );

    if (rows?.[0]) {
        return {
            acquired: true,
            eventHash: rows[0].event_hash,
            chainId: rows[0].chain_id?.toString?.() || String(chainId),
            transactionHash: rows[0].transaction_hash,
            logIndex: Number(rows[0].log_index),
            status: rows[0].processing_status,
            retryCount: Number(rows[0].retry_count || 0),
            workerId: rows[0].owner_worker_id,
            processingStartedAt: rows[0].processing_started_at
        };
    }

    const existing = await database.query(
        `SELECT
            processing_status,
            retry_count,
            owner_worker_id,
            processing_started_at::TEXT AS processing_started_at
         FROM event_processing_registry
         WHERE chain_id = $1
           AND transaction_hash = $2
           AND log_index = $3`,
        [chainId, transactionHash, logIndex]
    );

    return {
        acquired: false,
        eventHash,
        chainId: String(chainId),
        transactionHash,
        logIndex: Number(logIndex),
        status: existing?.[0]?.processing_status || 'unknown',
        retryCount: Number(existing?.[0]?.retry_count || 0),
        workerId: existing?.[0]?.owner_worker_id || null,
        processingStartedAt: existing?.[0]?.processing_started_at || null
    };
}

export async function refreshEventProcessingLease(database, lease) {
    const rows = await database.query(
        `UPDATE event_processing_registry
         SET last_heartbeat_at = clock_timestamp()
         WHERE chain_id = $1
           AND transaction_hash = $2
           AND log_index = $3
           AND event_hash = $4
           AND owner_worker_id = $5
           AND processing_started_at = $6::TIMESTAMPTZ
           AND processing_status = 'processing'
         RETURNING event_hash`,
        identityParams(lease)
    );

    return Boolean(rows?.length);
}

export async function completeEventProcessingLease(client, lease) {
    const result = await client.query(
        `UPDATE event_processing_registry
         SET processing_status = 'completed',
             processing_completed_at = clock_timestamp(),
             processing_error = NULL
         WHERE chain_id = $1
           AND transaction_hash = $2
           AND log_index = $3
           AND event_hash = $4
           AND owner_worker_id = $5
           AND processing_started_at = $6::TIMESTAMPTZ
           AND processing_status = 'processing'
         RETURNING event_hash`,
        identityParams(lease)
    );

    if (!result.rows?.length) {
        throw new EventProcessingLeaseLostError(lease.eventHash);
    }
}

export async function recordEventProcessingFailure(database, lease, {
    status,
    error
}) {
    const rows = await database.query(
        `UPDATE event_processing_registry
         SET processing_status = $7,
             processing_error = $8,
             last_heartbeat_at = clock_timestamp()
         WHERE chain_id = $1
           AND transaction_hash = $2
           AND log_index = $3
           AND event_hash = $4
           AND owner_worker_id = $5
           AND processing_started_at = $6::TIMESTAMPTZ
           AND processing_status = 'processing'
         RETURNING processing_status, retry_count`,
        [
            ...identityParams(lease),
            status,
            String(error?.message || 'Unknown event processing error').slice(0, 2000)
        ]
    );

    return rows?.[0] || null;
}

export async function reapStaleEventProcessingLeases(database, {
    chainId,
    leaseTimeoutMs = EVENT_PROCESSING_LEASE_TIMEOUT_MS
}) {
    return database.query(
        `WITH stale AS MATERIALIZED (
            SELECT
                event_hash,
                owner_worker_id AS previous_owner,
                EXTRACT(EPOCH FROM (clock_timestamp() - last_heartbeat_at)) AS stale_seconds
            FROM event_processing_registry
            WHERE chain_id = $1
              AND processing_status = 'processing'
              AND (
                  last_heartbeat_at IS NULL
                  OR last_heartbeat_at
                        <= clock_timestamp() - ($2::BIGINT * INTERVAL '1 millisecond')
              )
            FOR UPDATE SKIP LOCKED
        )
        UPDATE event_processing_registry AS registry
        SET processing_status = 'failed',
            processing_started_at = NULL,
            owner_worker_id = NULL,
            last_heartbeat_at = NULL,
            processing_error = 'Event processing lease expired before completion'
        FROM stale
        WHERE registry.event_hash = stale.event_hash
        RETURNING
            registry.event_hash,
            registry.event_name,
            registry.retry_count,
            stale.previous_owner,
            stale.stale_seconds`,
        [chainId, leaseTimeoutMs]
    );
}
