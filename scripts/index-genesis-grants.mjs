import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { appendExact, withEvidenceTransaction } from '../src/indexer/finalized-evidence.js';
import { readRpc } from './verify-treasury-safes.mjs';
import { verifyGenesisGrants } from './verify-genesis-grants.mjs';

export async function ingestGenesisGrants(pool, review, txHash, providers) {
    const proof = await verifyGenesisGrants(review, txHash, providers);
    const issuer = { chain_id: proof.chainId, genesis_address: proof.genesis.toLowerCase() };
    return withEvidenceTransaction(pool, async client => {
        await appendExact(client, 'genesis_issuers', { ...issuer, code_hash: proof.genesisCodeHash,
            grant_authority: proof.safe.toLowerCase(), founder_recipient: proof.founder });
        const inserted = await appendExact(client, 'genesis_grant_batches', { ...issuer, transaction_hash: proof.transactionHash,
            block_number: BigInt(proof.block.number).toString(), block_hash: proof.block.hash, transaction_index: proof.transactionIndex,
            policy_hash: proof.policyHash, calldata_hash: proof.calldataHash, grant_count: proof.grants.length });
        for (const grant of proof.grants) {
            await appendExact(client, 'genesis_grants', { ...issuer, token_id: grant.tokenId, category: grant.category,
                recipient: grant.recipient.toLowerCase(), decision_hash: grant.decisionHash, transaction_hash: proof.transactionHash,
                mint_index: grant.mintIndex, lock_index: grant.lockIndex, grant_index: grant.grantIndex });
        }
        return { inserted, chainId: proof.chainId, genesis: proof.genesis, transactionHash: proof.transactionHash,
            block: proof.block, grants: proof.grants.length };
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [file, hash, flag, ...extra] = process.argv.slice(2);
    if (!file || !hash || flag !== '--persist' || extra.length || !process.env.ARTSOUL_GENESIS_DATABASE_URL) {
        console.error('Usage: node scripts/index-genesis-grants.mjs reviewed-grants.json TX_HASH --persist. Set ARTSOUL_GENESIS_DATABASE_URL.');
        process.exitCode = 1;
    } else {
        let pool;
        try {
            const review = JSON.parse(await readFile(file, 'utf8'));
            const providers = [process.env.ARTSOUL_CUSTODY_RPC_URL, process.env.ARTSOUL_CUSTODY_RPC_CHECK_URL].map(readRpc);
            pool = new pg.Pool({ connectionString: process.env.ARTSOUL_GENESIS_DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
            console.log(JSON.stringify(await ingestGenesisGrants(pool, review, hash, providers), null, 2));
        } catch (error) {
            const conflict = /^Conflicting finalized evidence in genesis_(?:issuers|grant_batches|grants)$/.test(error.message);
            console.error(conflict ? error.message : 'Could not verify or record the Genesis batch. Check the reviewed release, receipt, two RPC providers and database.');
            process.exitCode = 1;
        } finally {
            await pool?.end();
        }
    }
}
