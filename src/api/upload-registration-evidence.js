import { isDeepStrictEqual } from 'node:util';
import { Interface, keccak256, toQuantity } from 'ethers';
import { V41_CORE_ABI } from '../indexer/v4-1-event-schema.js';
import { MAX_METADATA_BYTES } from '../config/upload-policy.js';

const iface = new Interface(V41_CORE_ABI);
const event = iface.getEvent('ArtworkRegistered');
const HASH = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const DECIMAL = /^(?:0|[1-9]\d*)$/;
const MAX_RPC_BYTES = 1024 * 1024;
// Operational read bounds, not protocol parameters or a publication deadline.
const MAX_SCAN_BLOCKS = 2000n;
const MAX_LOGS = 128;
const MAX_MATCHES = 8;
const METHODS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getLogs', 'eth_getTransactionReceipt']);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const lower = value => typeof value === 'string' ? value.toLowerCase() : '';
const validAddress = value => ADDRESS.test(value || '') && !/^0x0{40}$/i.test(value);
const quantity = value => {
  if (typeof value !== 'string' || !QUANTITY.test(value) || value.length > 66) fail('INVALID_RPC_EVIDENCE');
  return BigInt(value);
};
const decimal = value => {
  if (typeof value !== 'string' || !DECIMAL.test(value) || value.length > 78) fail('INVALID_RECOVERY_SCOPE');
  return BigInt(value);
};

// URLs come from reviewed server deployment configuration, never a request body.
// Distinct origins avoid accidentally counting the same endpoint twice; operators
// must still select independent providers. No signing method is available here.
export function createRegistrationReaders(urls) {
  if (!Array.isArray(urls) || urls.length !== 2) fail('INVALID_RECOVERY_RPC_CONFIG');
  const parsed = urls.map(value => {
    let url;
    try { url = new URL(value); } catch { fail('INVALID_RECOVERY_RPC_CONFIG'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail('INVALID_RECOVERY_RPC_CONFIG');
    return url;
  });
  if (parsed[0].origin === parsed[1].origin) fail('INVALID_RECOVERY_RPC_CONFIG');
  return parsed.map(url => {
    let id = 0;
    return async (method, params = [], { signal } = {}) => {
      if (!METHODS.has(method)) fail('RECOVERY_METHOD_NOT_ALLOWED');
      const requestId = ++id;
      const timeout = AbortSignal.timeout(15000);
      let reader;
      try {
        const response = await fetch(url, {
          method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout
        });
        if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_RPC_BYTES) fail('RECOVERY_RPC_UNAVAILABLE');
        reader = response.body.getReader();
        const buffer = Buffer.alloc(MAX_RPC_BYTES);
        let size = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value.byteLength > MAX_RPC_BYTES - size) fail('RECOVERY_RPC_UNAVAILABLE');
          buffer.set(value, size); size += value.byteLength;
        }
        const body = JSON.parse(buffer.subarray(0, size).toString('utf8'));
        if (body?.jsonrpc !== '2.0' || body.id !== requestId || body.error || !Object.hasOwn(body, 'result')) fail('RECOVERY_RPC_UNAVAILABLE');
        return body.result;
      } catch { fail('RECOVERY_RPC_UNAVAILABLE'); }
      finally {
        if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      }
    };
  });
}

function blockIdentity(header) {
  if (!header || !HASH.test(header.hash || '')) fail('INVALID_RPC_EVIDENCE');
  return { number: quantity(header.number).toString(), hash: lower(header.hash) };
}

function logIdentity(log) {
  if (!log || log.removed === true || !validAddress(log.address) ||
      !HASH.test(log.transactionHash || '') || !HASH.test(log.blockHash || '') ||
      !Array.isArray(log.topics) || log.topics.length > 4 || !log.topics.every(t => HASH.test(t)) ||
      typeof log.data !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(log.data) ||
      log.data.length > (MAX_METADATA_BYTES + 128) * 2 + 2) fail('INVALID_RPC_EVIDENCE');
  return { address: lower(log.address), transaction_hash: lower(log.transactionHash),
    block_number: quantity(log.blockNumber).toString(), block_hash: lower(log.blockHash),
    transaction_index: quantity(log.transactionIndex).toString(), log_index: quantity(log.logIndex).toString(),
    topics: log.topics.map(lower), data: lower(log.data) };
}

function registration(log, core, creator, metadataUri) {
  if (log.address !== core || log.topics[0] !== lower(event.topicHash)) return null;
  let parsed;
  try { parsed = iface.parseLog(log); } catch { fail('INVALID_RPC_EVIDENCE'); }
  if (!parsed || parsed.args.artworkId <= 0n) fail('INVALID_RPC_EVIDENCE');
  if (lower(parsed.args.creator) !== creator || parsed.args.metadataURI !== metadataUri) return null;
  return { artwork_id: parsed.args.artworkId.toString(), creator_wallet: creator, metadata_uri: metadataUri,
    transaction_hash: log.transaction_hash, block_number: log.block_number, block_hash: log.block_hash,
    log_index: log.log_index };
}

// Read-only evidence, deliberately not wired to the upload route or catalog.
// A caller must persist canonical block/finality anchors atomically with catalog
// reconciliation before using this result for durable publication recovery.
export async function verifyArtworkRegistration({ deployment, creator, metadataUri, transactionHash = null, scan = null }, { rpcs }) {
  const core = lower(deployment?.core);
  if (deployment?.chainId !== 84532 || !validAddress(core) || !HASH.test(deployment?.coreCodeHash || '') ||
      !validAddress(creator) || typeof metadataUri !== 'string' || !metadataUri.trim() ||
      Buffer.byteLength(metadataUri) > MAX_METADATA_BYTES || !Array.isArray(rpcs) || rpcs.length !== 2 ||
      rpcs.some(rpc => typeof rpc !== 'function') || rpcs[0] === rpcs[1]) fail('INVALID_RECOVERY_SCOPE');
  const start = decimal(deployment.startBlock);
  if (transactionHash !== null && (!HASH.test(transactionHash) || scan !== null)) fail('INVALID_RECOVERY_SCOPE');
  let from, to;
  if (scan !== null) {
    from = decimal(scan.fromBlock); to = decimal(scan.toBlock);
    if (from < start || to < from || to - from >= MAX_SCAN_BLOCKS) fail('INVALID_RECOVERY_SCOPE');
  }
  const result = (state, extra = {}) => ({ state, can_submit: false, registrations: [], ...extra });
  if (!transactionHash && !scan) return result('unresolved', { reason: 'NO_TRANSACTION_OR_SCAN' });
  creator = lower(creator);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const both = (method, params = []) => Promise.all(rpcs.map(rpc => rpc(method, params, { signal: controller.signal })));
    const chains = await both('eth_chainId');
    if (chains.some(chain => quantity(chain) !== 84532n)) fail('RECOVERY_CHAIN_MISMATCH');
    const heads = (await both('eth_getBlockByNumber', ['finalized', false])).map(blockIdentity);
    const ownHeads = await Promise.all(rpcs.map(async (rpc, index) => blockIdentity(
      await rpc('eth_getBlockByNumber', [toQuantity(BigInt(heads[index].number)), false], { signal: controller.signal })
    )));
    if (heads.some((head, index) => !isDeepStrictEqual(head, ownHeads[index]))) fail('RECOVERY_BLOCK_DISAGREEMENT');
    const anchorHeight = heads.map(b => BigInt(b.number)).reduce((a, b) => a < b ? a : b);
    async function agreedBlock(height) {
      const blocks = (await both('eth_getBlockByNumber', [toQuantity(height), false])).map(blockIdentity);
      if (blocks.some(b => BigInt(b.number) !== height) || !isDeepStrictEqual(blocks[0], blocks[1])) fail('RECOVERY_BLOCK_DISAGREEMENT');
      return blocks[0];
    }
    const anchor = await agreedBlock(anchorHeight);
    if (heads.some(h => h.number === anchor.number && h.hash !== anchor.hash)) fail('RECOVERY_BLOCK_DISAGREEMENT');
    if (anchorHeight < start) return result('unresolved', { reason: 'DEPLOYMENT_NOT_FINALIZED' });
    async function pinnedCode(height) {
      const codes = await both('eth_getCode', [core, toQuantity(height)]);
      if (codes.some(code => typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(code) ||
          keccak256(code) !== lower(deployment.coreCodeHash))) fail('RECOVERY_CODE_MISMATCH');
    }
    await pinnedCode(anchorHeight);

    async function receiptEvidence(hash) {
      const receipts = await both('eth_getTransactionReceipt', [hash]);
      if (receipts.some(r => r === null)) return { state: 'unresolved', reason: 'RECEIPT_UNAVAILABLE' };
      const normalized = receipts.map(receipt => {
        if (!receipt || lower(receipt.transactionHash) !== hash || !HASH.test(receipt.blockHash || '') ||
            !['0x0', '0x1'].includes(receipt.status) || !Array.isArray(receipt.logs) || receipt.logs.length > MAX_LOGS) fail('INVALID_RPC_EVIDENCE');
        const logs = receipt.logs.map(logIdentity);
        const block = quantity(receipt.blockNumber).toString(), txIndex = quantity(receipt.transactionIndex).toString();
        if (logs.some(log => log.transaction_hash !== hash || log.block_number !== block ||
            log.block_hash !== lower(receipt.blockHash) || log.transaction_index !== txIndex) ||
            new Set(logs.map(log => log.log_index)).size !== logs.length) fail('INVALID_RPC_EVIDENCE');
        logs.sort((a, b) => BigInt(a.log_index) < BigInt(b.log_index) ? -1 : 1);
        return { status: receipt.status, block, blockHash: lower(receipt.blockHash), transactionIndex: txIndex, logs };
      });
      if (!isDeepStrictEqual(normalized[0], normalized[1])) fail('RECOVERY_RECEIPT_DISAGREEMENT');
      const receipt = normalized[0], height = BigInt(receipt.block);
      if (height < start) fail('RECOVERY_BEFORE_DEPLOYMENT');
      if (height > anchorHeight) return { state: 'unresolved', reason: 'RECEIPT_NOT_FINALIZED' };
      const block = await agreedBlock(height);
      if (block.hash !== receipt.blockHash) fail('RECOVERY_BLOCK_DISAGREEMENT');
      await pinnedCode(height);
      if (receipt.status === '0x0') {
        if (receipt.logs.length) fail('INVALID_RPC_EVIDENCE');
        // Even a reverted reported transaction cannot release a file claim:
        // another unknown or replacement transaction may still register it.
        return { state: 'reverted', reason: 'REPORTED_TRANSACTION_REVERTED' };
      }
      const registrations = receipt.logs.map(log => registration(log, core, creator, metadataUri)).filter(Boolean);
      if (registrations.length > MAX_MATCHES) fail('RECOVERY_RESULT_LIMIT');
      return registrations.length ? { state: 'verified', registrations } : { state: 'unresolved', reason: 'NO_MATCHING_REGISTRATION' };
    }

    let outcome;
    if (transactionHash) {
      outcome = await receiptEvidence(lower(transactionHash));
    } else {
      // The trusted caller supplies a deployment cursor, never a guessed time
      // window. This page proves only positive matches in its explicit range.
      if (from > anchorHeight) return result('unresolved', { reason: 'SCAN_NOT_FINALIZED' });
      const upper = to < anchorHeight ? to : anchorHeight;
      const filter = { address: core, fromBlock: toQuantity(from), toBlock: toQuantity(upper),
        topics: iface.encodeFilterTopics(event, [null, creator]) };
      const pages = (await both('eth_getLogs', [filter])).map(logs => {
        if (!Array.isArray(logs) || logs.length > MAX_LOGS) fail('RECOVERY_RESULT_LIMIT');
        const normalized = logs.map(logIdentity);
        if (normalized.some(log => log.address !== core || log.topics[0] !== lower(event.topicHash) ||
            log.topics[2] !== lower(filter.topics[2]) || BigInt(log.block_number) < from || BigInt(log.block_number) > upper)) fail('INVALID_RPC_EVIDENCE');
        const keys = normalized.map(log => `${log.block_number}:${log.log_index}`);
        if (new Set(keys).size !== keys.length) fail('INVALID_RPC_EVIDENCE');
        return normalized.sort((a, b) => BigInt(a.block_number) === BigInt(b.block_number)
          ? (BigInt(a.log_index) < BigInt(b.log_index) ? -1 : 1)
          : (BigInt(a.block_number) < BigInt(b.block_number) ? -1 : 1));
      });
      if (!isDeepStrictEqual(pages[0], pages[1])) fail('RECOVERY_LOG_DISAGREEMENT');
      const matches = pages[0].map(log => registration(log, core, creator, metadataUri)).filter(Boolean);
      if (matches.length > MAX_MATCHES) fail('RECOVERY_RESULT_LIMIT');
      const registrations = [];
      for (const hash of new Set(matches.map(m => m.transaction_hash))) {
        const checked = await receiptEvidence(hash);
        if (checked.state !== 'verified') fail('RECOVERY_SCAN_RECEIPT_MISMATCH');
        const expected = matches.filter(m => m.transaction_hash === hash);
        if (!isDeepStrictEqual(checked.registrations, expected)) fail('RECOVERY_SCAN_RECEIPT_MISMATCH');
        registrations.push(...checked.registrations);
      }
      outcome = { state: registrations.length ? 'verified' : 'unresolved', registrations,
        ...(!registrations.length ? { reason: 'NO_MATCH_IN_SCANNED_RANGE' } : {}),
        coverage: { from_block: from.toString(), to_block: upper.toString(), next_block: (upper + 1n).toString(),
          requested_range_complete: upper === to, proves_absence: false } };
    }
    // Detect a changed finalized anchor or receipt block during these reads.
    if (!isDeepStrictEqual(anchor, await agreedBlock(anchorHeight))) fail('RECOVERY_BLOCK_DISAGREEMENT');
    for (const entry of outcome.registrations || []) {
      if ((await agreedBlock(BigInt(entry.block_number))).hash !== entry.block_hash) fail('RECOVERY_BLOCK_DISAGREEMENT');
    }
    return result(outcome.state, { ...outcome, chain_id: 84532, core_address: core,
      core_code_hash: lower(deployment.coreCodeHash), finalized_anchor: anchor });
  } catch (error) {
    // Errors from transports can contain credentials/endpoints. Only our finite
    // evidence codes may leave this read-only boundary.
    const codes = new Set(['INVALID_RPC_EVIDENCE', 'RECOVERY_CHAIN_MISMATCH', 'RECOVERY_BLOCK_DISAGREEMENT',
      'RECOVERY_CODE_MISMATCH', 'RECOVERY_RECEIPT_DISAGREEMENT', 'RECOVERY_BEFORE_DEPLOYMENT',
      'RECOVERY_RESULT_LIMIT', 'RECOVERY_LOG_DISAGREEMENT', 'RECOVERY_SCAN_RECEIPT_MISMATCH']);
    return result('unresolved', { reason: codes.has(error?.code) ? error.code : 'RECOVERY_RPC_UNAVAILABLE' });
  } finally { clearTimeout(timeout); controller.abort(); }
}
