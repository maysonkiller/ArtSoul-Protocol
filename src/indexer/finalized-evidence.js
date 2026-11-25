// Table and column identifiers come from the indexer's fixed row definitions. Bind all values.
export async function appendExact(client, table, row) {
    const columns = Object.keys(row);
    const values = Object.values(row);
    const params = columns.map((_, i) => '$' + (i + 1));
    const inserted = await client.query(
        `INSERT INTO artsoul_private.${table} (${columns.join(', ')}) VALUES (${params.join(', ')}) ON CONFLICT DO NOTHING`, values
    );
    if (inserted.rowCount === 1) return true;
    // READ COMMITTED takes a new snapshot after the competing insert commits.
    const matching = await client.query(
        `SELECT 1 FROM artsoul_private.${table} WHERE ${columns.map((name, i) => name + ' = ' + params[i]).join(' AND ')}`, values
    );
    if (!matching.rowCount) throw new Error('Conflicting finalized evidence in ' + table);
    return false;
}

export async function withEvidenceTransaction(pool, write, beforeCommit) {
    const client = await pool.connect();
    let discard;
    try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const result = await write(client);
        beforeCommit?.();
        await client.query('COMMIT');
        return result;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (rollbackError) { discard = rollbackError; }
        throw error;
    } finally {
        client.release(discard);
    }
}
