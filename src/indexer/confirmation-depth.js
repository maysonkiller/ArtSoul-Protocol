/**
 * Reconcile the persisted confirmation depth with the active configured depth.
 *
 * The indexer_state.confirmation_depth column is only written on the initial
 * INSERT, so a row created under an older config (or the migration default of
 * 12) keeps reporting the stale value through /api/public/indexer-status even
 * after INDEXER_CONFIRMATION_DEPTH changes. /health reads the live in-memory
 * value, so the two endpoints drift apart. This brings the stored value back in
 * line with the configured value.
 *
 * Metadata-only and safe by construction:
 *  - updates ONLY confirmation_depth; never last_indexed_block,
 *    last_confirmed_block, state_hash, or any event data;
 *  - chain-scoped via WHERE chain_id;
 *  - restart-idempotent and free of write churn (no UPDATE when already
 *    correct; the IS DISTINCT FROM guard also no-ops concurrent startups);
 *  - never throws — on failure it reports precise evidence via onError and
 *    leaves the cursor untouched.
 *
 * Kept in its own dependency-free module so it can be unit-tested without
 * loading the full production runner (RPC, DB pool, metrics) graph.
 *
 * @returns {Promise<{updated: boolean, storedDepth?: number, configuredDepth: number, reason?: string, error?: Error}>}
 */
export async function reconcileConfirmationDepth(db, chainId, configuredDepth, { onError } = {}) {
    const chainKey = chainId.toString();

    try {
        const rows = await db.query(
            'SELECT confirmation_depth FROM indexer_state WHERE chain_id = $1',
            [chainKey]
        );

        if (!rows || rows.length === 0) {
            return { updated: false, configuredDepth, reason: 'no_state_row' };
        }

        const storedDepth = parseInt(rows[0].confirmation_depth, 10);
        if (storedDepth === configuredDepth) {
            return { updated: false, storedDepth, configuredDepth };
        }

        await db.query(
            `UPDATE indexer_state
             SET confirmation_depth = $1
             WHERE chain_id = $2 AND confirmation_depth IS DISTINCT FROM $1`,
            [configuredDepth, chainKey]
        );

        console.log(JSON.stringify({
            phase: 'confirmation_depth_reconcile',
            action: 'updated',
            chainId: chainKey,
            previousDepth: storedDepth,
            configuredDepth
        }));

        return { updated: true, storedDepth, configuredDepth };
    } catch (error) {
        if (onError) onError(error);
        return { updated: false, configuredDepth, error };
    }
}

export default reconcileConfirmationDepth;
