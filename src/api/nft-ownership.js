import { normalizeWallet, supabaseRest } from './backend.js';

const ZERO = `0x${'0'.repeat(40)}`;
const uint256 = value => typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value) && BigInt(value) < 2n ** 256n;
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0{64}$/.test(value);
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value);
const unavailable = () => Object.assign(new Error('Ownership information is temporarily unavailable.'), {
  code: 'NFT_OWNERSHIP_UNAVAILABLE', statusCode: 503
});
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

class OwnershipBoundaryMoved extends Error {
  constructor(config) {
    super('Ownership information is temporarily unavailable.');
    this.code = 'NFT_OWNERSHIP_BOUNDARY_MOVED'; this.statusCode = 503; this.config = config;
  }
}
const ownershipError = error => error instanceof OwnershipBoundaryMoved ? error : unavailable();

function requireSameBoundary(initial, snapshots) {
  let moved = false;
  for (const snapshot of snapshots) {
    const fresh = boundary(snapshot, initial.config);
    if (fresh.marker === initial.marker) continue;
    // Only a forward, fully confirmed publication can justify another read.
    // Recovery, same-height rewrites and malformed evidence remain unavailable.
    if (BigInt(fresh.indexed_through) <= BigInt(initial.indexed_through) ||
        fresh.confirmed_through !== fresh.indexed_through || fresh.covered_hash === initial.covered_hash ||
        fresh.state_revision === initial.state_revision) throw unavailable();
    moved = true;
  }
  if (moved) throw new OwnershipBoundaryMoved(initial.config);
}

// Entry points own the single retry. Projection/proof helpers never restart a
// partial read, and the second attempt cannot switch deployment or gate state.
export async function readWithNftOwnershipRetry(operation) {
  try { return await operation(); }
  catch (error) {
    if (!(error instanceof OwnershipBoundaryMoved)) throw error;
    requireCurrent(error.config);
    try {
      const result = await operation();
      requireCurrent(error.config);
      return result;
    } catch (retryError) {
      throw retryError instanceof OwnershipBoundaryMoved ? unavailable() : retryError;
    }
  }
}

export function readNftOwnershipConfig() {
  const flag = process.env.ARTSOUL_NFT_OWNERSHIP_ENABLED;
  if (flag === undefined || flag === 'false') return null;
  const config = {
    chainId: 84532,
    coreAddress: normalizeWallet(process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA),
    nftAddress: normalizeWallet(process.env.ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA),
    coreCodeHash: String(process.env.ARTSOUL_NFT_OWNERSHIP_CORE_CODE_HASH || '').toLowerCase(),
    nftCodeHash: String(process.env.ARTSOUL_NFT_OWNERSHIP_NFT_CODE_HASH || '').toLowerCase()
  };
  if (flag !== 'true' || !config.coreAddress || !config.nftAddress ||
      config.coreAddress === ZERO || config.nftAddress === ZERO || config.coreAddress === config.nftAddress ||
      !hash(config.coreCodeHash) || !hash(config.nftCodeHash)) throw unavailable();
  return Object.freeze(config);
}

function block(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)) return value;
  throw unavailable();
}

function boundary(row, config) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw unavailable();
  const indexed = block(row.indexed_through), confirmed = block(row.confirmed_through);
  if (BigInt(confirmed) > BigInt(indexed) || !hash(row.covered_hash) ||
      typeof row.state_revision !== 'string' || !/^[1-9][0-9]{0,9}$/.test(row.state_revision) ||
      BigInt(row.state_revision) > 4294967295n) throw unavailable();
  return Object.freeze({ config, indexed_through: indexed, confirmed_through: confirmed,
    covered_hash: row.covered_hash, state_revision: row.state_revision,
    marker: JSON.stringify([config, indexed, confirmed, row.covered_hash, row.state_revision]) });
}

function requireCurrent(config) {
  if (!same(readNftOwnershipConfig(), config)) throw unavailable();
}

async function rpc(name, config, extra = {}) {
  requireCurrent(config);
  const result = await supabaseRest(`rpc/${name}`, { method: 'POST', signal: AbortSignal.timeout(5000), body: {
    p_core_address: config.coreAddress, p_nft_address: config.nftAddress,
    p_core_code_hash: config.coreCodeHash, p_nft_code_hash: config.nftCodeHash, ...extra
  } });
  requireCurrent(config);
  return result;
}

export async function readNftOwnershipBoundary() {
  try {
    const config = readNftOwnershipConfig();
    if (!config) return null;
    const rows = await rpc('read_verified_nft_boundary', config);
    if (!Array.isArray(rows) || rows.length !== 1) throw unavailable();
    return boundary(rows[0], config);
  } catch { throw unavailable(); }
}

function captureArtworks(artworks) {
  if (!Array.isArray(artworks) || artworks.length > 200) throw unavailable();
  const seen = new Set(), requested = [];
  for (const artwork of artworks) {
    if (!artwork || typeof artwork !== 'object') throw unavailable();
    if (artwork.chain_id !== 84532 && artwork.chain_id !== '84532') continue;
    const { artwork_id: id, token_id: token, minted } = artwork;
    if (!uint256(id) || seen.has(id) || typeof minted !== 'boolean' ||
        (minted ? !uint256(token) : token != null && token !== '' && !uint256(token))) throw unavailable();
    seen.add(id);
    requested.push(Object.freeze({ chain_id: 84532, artwork_id: id, token_id: token || null, minted }));
  }
  return Object.freeze(requested);
}

function transferRow(event, initial, allowMint = true) {
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
      !address(event.from_address) || (!allowMint && event.from_address === ZERO) ||
      !address(event.to_address) || event.to_address === ZERO ||
      !hash(event.transaction_hash) || !Number.isSafeInteger(event.log_index) || event.log_index < 0 || event.log_index > 2147483647 ||
      typeof event.recorded_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(event.recorded_at) || !Number.isFinite(Date.parse(event.recorded_at))) throw unavailable();
  const number = block(event.block_number);
  if (number === '0' || BigInt(number) > BigInt(initial.indexed_through)) throw unavailable();
  return Object.freeze({ block_number: Number(number), log_index: event.log_index,
    transaction_hash: event.transaction_hash, recorded_at: event.recorded_at,
    from_address: event.from_address, to_address: event.to_address });
}

function ownerRow(row, artwork, initial) {
  // A token/mint identity disagreement remains unavailable even if the boundary advanced.
  if (!row || row.artwork_id !== artwork.artwork_id || typeof row.verified !== 'boolean' ||
      (row.token_id !== null && !uint256(row.token_id)) ||
      (row.token_id !== null && row.token_id !== artwork.token_id)) throw unavailable();
  initial = boundary(row, initial.config);
  let transfer = null;
  if (row.verified) {
    if (!artwork.minted || row.token_id !== artwork.token_id ||
        !address(row.first_collector_address) || row.first_collector_address === ZERO ||
        !address(row.current_owner_address) || row.current_owner_address === ZERO) throw unavailable();
    transfer = transferRow(row.latest_transfer, initial);
    if (transfer.to_address !== row.current_owner_address) throw unavailable();
  } else if (row.first_collector_address !== null || row.current_owner_address !== null || row.latest_transfer !== null) {
    throw unavailable();
  }
  let listing = null;
  if (row.active_listing != null) {
    const value = row.active_listing, updated = block(value.last_updated_block);
    if (!row.verified || value.token_id !== row.token_id || value.seller !== row.current_owner_address ||
        !uint256(value.price) || BigInt(updated) > BigInt(initial.indexed_through) ||
        BigInt(updated) < BigInt(transfer.block_number)) throw unavailable();
    listing = Object.freeze({ token_id: value.token_id, seller: value.seller, price: value.price,
      last_updated_block: Number(updated) });
  }
  return Object.freeze({ artwork_id: row.artwork_id, token_id: row.token_id, verified: row.verified,
    first_collector_address: row.first_collector_address, current_owner_address: row.current_owner_address,
    latest_transfer: transfer, active_listing: listing, indexed_through: initial.indexed_through, confirmed_through: initial.confirmed_through,
    covered_hash: initial.covered_hash, state_revision: initial.state_revision });
}

// Capture the boundary before route lifecycle reads. Supplying it here binds
// every batch to that snapshot; unavailable proof never supplies a fallback owner.
export async function readNftOwnership(artworks, initialBoundary) {
  try {
    const config = readNftOwnershipConfig();
    if (!config) {
      if (initialBoundary) throw unavailable();
      return null;
    }
    if (initialBoundary === null) throw unavailable();
    const requested = captureArtworks(artworks);
    const supplied = initialBoundary === undefined ? await readNftOwnershipBoundary() : initialBoundary;
    if (!supplied || !same(supplied.config, config)) throw unavailable();
    const initial = boundary(supplied, config);
    if (initial.marker !== supplied.marker) throw unavailable();
    requireCurrent(config);
    const pages = await Promise.all(Array.from({ length: Math.ceil(requested.length / 20) }, async (_, page) => {
      const batch = requested.slice(page * 20, page * 20 + 20);
      const rows = await rpc('read_verified_nft_cards', config, { p_artwork_ids: batch.map(item => item.artwork_id) });
      if (!Array.isArray(rows) || rows.length !== batch.length) throw unavailable();
      const byId = new Map();
      for (const row of rows) {
        if (!row || !uint256(row.artwork_id) || byId.has(row.artwork_id) || !batch.some(item => item.artwork_id === row.artwork_id)) throw unavailable();
        byId.set(row.artwork_id, row);
      }
      return batch.map(item => ownerRow(byId.get(item.artwork_id), item, initial));
    }));
    requireCurrent(config);
    const rows = Object.freeze(pages.flat());
    requireSameBoundary(initial, rows);
    return Object.freeze({ ...initial, artworks: requested, rows });
  } catch (error) { throw ownershipError(error); }
}

export async function recheckNftOwnershipBoundary(initial) {
  try {
    if (!initial) {
      if (readNftOwnershipConfig()) throw unavailable();
      return null;
    }
    const fresh = await readNftOwnershipBoundary();
    if (!fresh || !same(fresh.config, initial.config)) throw unavailable();
    requireSameBoundary(initial, [fresh]);
    return initial;
  } catch (error) { throw ownershipError(error); }
}

export async function recheckNftOwnership(snapshot) {
  try {
    if (!snapshot || snapshot.artworks?.length === 0) return await recheckNftOwnershipBoundary(snapshot);
    const history = Object.hasOwn(snapshot, 'transfers');
    const fresh = history ? await readNftHistory(snapshot.artworks[0], snapshot) : await readNftOwnership(snapshot.artworks, snapshot);
    if (!fresh || !same(fresh.rows, snapshot.rows) || (history &&
        (!same(fresh.transfers, snapshot.transfers) || fresh.complete !== snapshot.complete ||
         !same(fresh.lifecycle, snapshot.lifecycle) || fresh.lifecycle_available !== snapshot.lifecycle_available ||
         fresh.lifecycle_complete !== snapshot.lifecycle_complete))) throw unavailable();
    return snapshot;
  } catch (error) { throw ownershipError(error); }
}

// History is a separate bounded RPC so association, owner and every returned
// movement share the database snapshot. The 201st row is a truncation sentinel.
export async function readNftHistory(artwork, initialBoundary) {
  try {
    const config = readNftOwnershipConfig();
    if (!config) {
      if (initialBoundary) throw unavailable();
      return null;
    }
    if (initialBoundary === null) throw unavailable();
    const requested = captureArtworks([artwork]);
    if (requested.length !== 1) throw unavailable();
    const supplied = initialBoundary === undefined ? await readNftOwnershipBoundary() : initialBoundary;
    if (!supplied || !same(supplied.config, config)) throw unavailable();
    const initial = boundary(supplied, config);
    if (initial.marker !== supplied.marker) throw unavailable();
    const data = await rpc('read_verified_nft_history', config, { p_artwork_id: requested[0].artwork_id });
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.transfers) ||
        data.transfers.length > 201 || typeof data.complete !== 'boolean') throw unavailable();
    const current = boundary(data.ownership, config);
    const proof = ownerRow(data.ownership, requested[0], current);
    if (data.complete !== (proof.verified && data.transfers.length <= 200) ||
        (!proof.verified && data.transfers.length)) throw unavailable();
    const transfers = data.transfers.map(event => transferRow(event, current, false));
    if (proof.verified && proof.latest_transfer.from_address === ZERO && transfers.length) throw unavailable();
    const order = (a, b) => a.block_number - b.block_number || a.log_index - b.log_index;
    const identities = new Set(), transactions = new Map();
    let holder = proof.first_collector_address;
    for (let index = 0; index < transfers.length; index++) {
      const event = transfers[index], key = `${event.transaction_hash}:${event.log_index}`;
      if (event.from_address !== holder || identities.has(key) || (index > 0 && order(transfers[index - 1], event) >= 0) ||
          (transactions.has(event.transaction_hash) && transactions.get(event.transaction_hash) !== event.block_number) ||
          order(event, proof.latest_transfer) > 0) throw unavailable();
      identities.add(key); transactions.set(event.transaction_hash, event.block_number);
      holder = event.to_address;
    }
    if (proof.verified && data.complete && (proof.latest_transfer.from_address === ZERO
      ? transfers.length !== 0 : !same(transfers.at(-1), proof.latest_transfer))) throw unavailable();
    if (!Array.isArray(data.lifecycle) || data.lifecycle.length > 201 || typeof data.lifecycle_available !== 'boolean' ||
        data.lifecycle_complete !== (data.lifecycle_available && data.lifecycle.length <= 200) ||
        (!data.lifecycle_available && data.lifecycle.length)) throw unavailable();
    const allowed = new Set(['ArtworkRegistered', 'AuctionCreated', 'AuctionEnded', 'SettlementCompleted',
      'SettlementDefaulted', 'ResaleListed', 'ResaleCompleted']);
    const auctionIds = new Set(), lifecycleIds = new Set(), lifecycleTransactions = new Map();
    const lifecycle = data.lifecycle.map((event, index) => {
      if (!event || !allowed.has(event.event_name) || String(event.chain_id) !== '84532' ||
          event.contract_address !== config.coreAddress || !event.event_data || typeof event.event_data !== 'object' ||
          Array.isArray(event.event_data) || Object.values(event.event_data).some(value =>
            value !== null && typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value)))) throw unavailable();
      const identity = transferRow({ ...event, recorded_at: event.indexed_at, from_address: ZERO, to_address: config.coreAddress }, current);
      const key = `${identity.transaction_hash}:${identity.log_index}`, payload = { ...event.event_data }, name = event.event_name;
      if (lifecycleIds.has(key) || (index > 0 && order(data.lifecycle[index - 1], identity) >= 0) ||
          (lifecycleTransactions.has(identity.transaction_hash) && lifecycleTransactions.get(identity.transaction_hash) !== identity.block_number) ||
          (index === 0 ? name !== 'ArtworkRegistered' : name === 'ArtworkRegistered')) throw unavailable();
      if (['ArtworkRegistered', 'AuctionCreated', 'SettlementCompleted'].includes(name) &&
          String(payload.artworkId) !== requested[0].artwork_id) throw unavailable();
      if (name === 'AuctionCreated') {
        const id = String(payload.auctionId);
        if (!uint256(id) || auctionIds.has(id)) throw unavailable();
        auctionIds.add(id);
      } else if (['AuctionEnded', 'SettlementCompleted', 'SettlementDefaulted'].includes(name) &&
          !auctionIds.has(String(payload.auctionId))) throw unavailable();
      if (name.startsWith('Resale') && (!proof.verified || String(payload.tokenId) !== proof.token_id)) throw unavailable();
      lifecycleIds.add(key); lifecycleTransactions.set(identity.transaction_hash, identity.block_number);
      return Object.freeze({ chain_id: 84532, contract_address: config.coreAddress, event_name: name,
        event_data: Object.freeze(payload), block_number: identity.block_number, log_index: identity.log_index,
        transaction_hash: identity.transaction_hash, indexed_at: identity.recorded_at });
    });
    if (data.lifecycle_available && lifecycle.length === 0) throw unavailable();
    requireCurrent(config);
    requireSameBoundary(initial, [current]);
    return Object.freeze({ ...initial, artworks: requested, rows: Object.freeze([proof]),
      transfers: Object.freeze(transfers.slice(0, 200)), complete: data.complete,
      lifecycle: Object.freeze(lifecycle.slice(0, 200)), lifecycle_available: data.lifecycle_available,
      lifecycle_complete: data.lifecycle_complete });
  } catch (error) { throw ownershipError(error); }
}
