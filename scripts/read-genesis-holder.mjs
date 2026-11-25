import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getAddress, isHexString, ZeroAddress, ZeroHash } from 'ethers';
import pg from 'pg';

// Return one positive witness for a wallet. An incomplete intake cannot prove ineligibility.
export async function readGenesisHolder(client, issuer, wallet) {
    const recipient = getAddress(wallet).toLowerCase();
    if (recipient === ZeroAddress) throw new Error('Invalid wallet');
    if (issuer == null) return { chainId: 8453, genesis: null, wallet: recipient, evidence: null };
    if (issuer?.chainId !== 8453 || !isHexString(issuer.genesisCodeHash, 32) || issuer.genesisCodeHash.toLowerCase() === ZeroHash) {
        throw new Error('Select the reviewed Base mainnet Genesis deployment');
    }
    const [genesis, safe, founder] = [issuer.genesis, issuer.safe, issuer.founder].map(value => getAddress(value).toLowerCase());
    if ([genesis, safe, founder].includes(ZeroAddress) || genesis === safe) throw new Error('Invalid Genesis designation');
    const { rows } = await client.query(`SELECT g.token_id, g.transaction_hash, g.grant_index, b.block_number, b.block_hash
        FROM artsoul_private.genesis_issuers i
        JOIN artsoul_private.genesis_grants g USING (chain_id, genesis_address)
        JOIN artsoul_private.genesis_grant_batches b USING (chain_id, genesis_address, transaction_hash)
        WHERE i.chain_id = 8453 AND i.genesis_address = $1 AND i.code_hash = $2 AND i.grant_authority = $3
            AND i.founder_recipient = $4 AND g.recipient = $5
        ORDER BY g.token_id LIMIT 1`, [genesis, issuer.genesisCodeHash.toLowerCase(), safe, founder, recipient]);
    return { chainId: 8453, genesis, wallet: recipient, evidence: rows[0] ?? null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [file, recipient, ...extra] = process.argv.slice(2);
    let pool;
    try {
        if (!file || !recipient || extra.length || !process.env.ARTSOUL_GENESIS_DATABASE_URL) throw new Error();
        const issuer = JSON.parse(await readFile(file, 'utf8'));
        pool = new pg.Pool({ connectionString: process.env.ARTSOUL_GENESIS_DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
        console.log(JSON.stringify(await readGenesisHolder(pool, issuer, recipient), null, 2));
    } catch {
        console.error('Usage: node scripts/read-genesis-holder.mjs reviewed-deployment.json WALLET. Check the deployment identity and ARTSOUL_GENESIS_DATABASE_URL.');
        process.exitCode = 1;
    } finally {
        await pool?.end();
    }
}
