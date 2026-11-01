import { syncNftTransferRange } from './nft-transfer-sync.js';
import { captureWriteContext, requireWriteAuthority } from './write-fence.js';

const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value);
const block = value => {
    if ((typeof value !== 'string' && typeof value !== 'number') ||
        !/^(0|[1-9][0-9]*)$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
        throw new Error('Invalid NFT coverage block');
    }
    return Number(value);
};

// One deployment only, bounded by the Core cursor. Missing coverage is never
// replaced with a guessed recent block, including after restart or recovery.
export async function readNftTransferProgress(engine, config, state) {
    if (String(state?.chain_id) !== String(config.chainId) ||
        state.contract_address?.toLowerCase() !== config.coreAddress) {
        throw new Error('NFT coverage deployment changed');
    }
    const indexedThrough = block(state.last_indexed_block);
    const rows = await engine.db.query(`SELECT c.from_block,c.origin_block_hash,c.covered_through,c.covered_hash,
        c.core_code_hash,c.nft_code_hash,b.block_hash AS retained_hash,
        s.last_indexed_block AS state_block,s.xmin::text AS state_revision,s.recovery_cache_token AS state_cache_token
        FROM public.indexer_state s LEFT JOIN public.nft_transfer_coverage c
        ON c.chain_id=s.chain_id AND c.core_address=$2 AND c.nft_address=$3
        LEFT JOIN public.block_hashes b ON b.chain_id=c.chain_id AND b.block_number=c.covered_through
        WHERE s.chain_id=$1 AND lower(s.contract_address)=$2`,
    [String(config.chainId), config.coreAddress, config.nftAddress]);
    if (rows.length !== 1 || typeof state.revision !== 'string' || !/^[1-9][0-9]*$/.test(state.revision) ||
        rows[0].state_revision !== state.revision || block(rows[0].state_block) !== indexedThrough ||
        rows[0].state_cache_token !== state.recovery_cache_token) throw new Error('NFT coverage state changed');
    const coverage = rows[0].covered_through === null ? null : rows[0];
    const coveredThrough = coverage ? block(coverage.covered_through) : null;
    if (coverage && (block(coverage.from_block) !== config.fromBlock ||
        coverage.origin_block_hash !== config.previousBlockHash || !hash(coverage.covered_hash) ||
        coverage.core_code_hash !== config.expectedCoreCodeHash || coverage.nft_code_hash !== config.expectedNftCodeHash ||
        coveredThrough < config.fromBlock || coveredThrough > indexedThrough ||
        (coveredThrough === indexedThrough && coverage.retained_hash !== coverage.covered_hash))) {
        throw new Error('NFT coverage differs from reviewed deployment or Core progress');
    }
    if (state.recovery_cache_token === undefined) throw new Error('NFT recovery schema unavailable');
    return Object.freeze({ fromBlock: config.fromBlock, indexedThrough, coveredThrough,
        previousBlockHash: coverage?.covered_hash || config.previousBlockHash,
        blocksBehind: Math.max(0, indexedThrough - (coveredThrough ?? config.fromBlock - 1)),
        cacheReady: state.recovery_cache_token === null,
        ready: coveredThrough !== null && coveredThrough === indexedThrough && state.recovery_cache_token === null });
}

export async function syncNftTransferCheckpoint(engine, config, writeRange = syncNftTransferRange) {
    const context = await captureWriteContext(engine);
    const progress = await readNftTransferProgress(engine, config, {
        chain_id: context.chainId, contract_address: context.contractAddress,
        last_indexed_block: context.lastIndexedBlock, recovery_cache_token: context.recoveryCacheToken, revision: context.revision
    });
    requireWriteAuthority(context.authority);
    const fromBlock = progress.coveredThrough === null ? config.fromBlock : progress.coveredThrough + 1;
    if (fromBlock > context.lastIndexedBlock) return Object.freeze({ advanced: false, progress });
    const blockNumber = Math.min(context.lastIndexedBlock, fromBlock + config.maxBlocks - 1);
    const header = await engine.eventListener.getBlock(blockNumber);
    requireWriteAuthority(context.authority);
    if (block(header?.number) !== blockNumber || !hash(header?.hash)) {
        throw new Error('NFT range endpoint unavailable');
    }
    // The writer takes a fresh state fence and independently rechecks the
    // canonical header, range predecessor, code hashes and retained Core hash.
    const result = await writeRange(engine, { ...config, fromBlock, blockNumber,
        blockHash: header.hash, previousBlockHash: progress.previousBlockHash,
        bootstrap: progress.coveredThrough === null });
    requireWriteAuthority(context.authority);
    await engine._purgeRecoveryCache(context.authority);
    return Object.freeze({ advanced: true, result });
}
