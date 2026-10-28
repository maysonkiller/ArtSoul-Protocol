import { allowMethods, sendError, supabaseRest, validateArtworkId } from '../../backend.js';
import { getModerationAccess } from '../../moderation-access.js';
import { allowedArtworkUrl, readArtworkMetadata } from '../../safe-artwork-fetch.js';
import { readAIValuation } from '../../../features/artwork/ai-valuation-values.js';

const PUBLIC_CHAIN_IDS = [84532, 11155111];
// The active product chain. Ethereum Sepolia rows stay readable but are never
// what a short, chainless public URL refers to.
const CANONICAL_PUBLIC_CHAIN_ID = 84532;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const TABLES = [
  'v41_artworks',
  'v41_auctions',
  'v41_bids',
  'v41_settlements',
  'v41_resale_listings',
  'v41_resale_history',
  'v41_floor_history',
  'v41_trust_signals',
  'artwork_social_signals',
  'artwork_moderation_visibility'
];

function normalizeText(value) {
  return String(value ?? '').trim();
}

function toNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addressOrNull(value) {
  const text = normalizeText(value);
  if (!text || text.toLowerCase() === ZERO_ADDRESS.toLowerCase()) return null;
  return text;
}

function protocolId(value) {
  const text = normalizeText(value);
  return text && text !== '0' ? text : '';
}

function chainId(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function keyFor(chain, id) {
  return `${chain}:${id}`;
}

function weiToEth(value) {
  const text = normalizeText(value);
  if (!text || text === '0') return '0';

  try {
    const wei = BigInt(text);
    const base = 10n ** 18n;
    const whole = wei / base;
    const fraction = (wei % base).toString().padStart(18, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? String(parsed) : '0';
  }
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value === 'number') {
    return value > 1000000000000 ? value : value * 1000;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1000000000000 ? numeric : numeric * 1000;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestampSeconds(value) {
  const ms = timestampMs(value);
  return ms > 0 ? Math.floor(ms / 1000) : null;
}

function isAuctionAwaitingEnd(auction) {
  return auction?.status === 'active' &&
    timestampMs(auction.end_time) > 0 &&
    timestampMs(auction.end_time) <= Date.now();
}

function statusFromProjection(artwork, auction, resaleListing) {
  if (resaleListing?.active) return 'for_sale';
  if (isAuctionAwaitingEnd(auction)) return 'awaiting_end';
  if (auction?.status === 'active') return 'auction';
  if (auction?.status === 'settlement_pending') return 'settlement_pending';
  if (auction?.status === 'defaulted' || auction?.status === 'defaulted_no_bids') return 'defaulted';
  if (auction?.status === 'settled' || artwork?.minted) return 'sold';
  return 'registered';
}

function toHttpUri(uri) {
  const text = normalizeText(uri);
  if (!text) return '';
  if (text.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${text.slice('ipfs://'.length)}`;
  }
  if (text.startsWith('https://') || text.startsWith('http://')) {
    return text;
  }
  return '';
}

async function loadMetadata(metadataUri) {
  return readArtworkMetadata(metadataUri);
}

// Metadata files are immutable (uploads use unique timestamped names), so a
// successful read stays valid for the lifetime of the instance.
const metadataCache = new Map();
const METADATA_CACHE_MAX = 500;

async function loadMetadataCached(metadataUri) {
  const key = normalizeText(metadataUri);
  if (key && metadataCache.has(key)) return metadataCache.get(key);

  const metadata = await loadMetadata(metadataUri);
  if (key && metadata && Object.keys(metadata).length > 0) {
    if (metadataCache.size >= METADATA_CACHE_MAX) {
      metadataCache.delete(metadataCache.keys().next().value);
    }
    metadataCache.set(key, metadata);
  }
  return metadata;
}

async function loadFeedMetadata(artworks) {
  const core = normalizeText(process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA).toLowerCase();
  const storagePrefix = normalizeText(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/$/, '') +
    '/storage/v1/object/public/artworks/';
  const candidates = artworks.filter(artwork => chainId(artwork.chain_id) === CANONICAL_PUBLIC_CHAIN_ID &&
    /^[1-9][0-9]{0,77}$/.test(String(artwork.artwork_id)) && BigInt(artwork.artwork_id) < 2n ** 256n &&
    /^0x[0-9a-f]{64}$/i.test(String(artwork.transaction_hash)) &&
    String(artwork.metadata_uri).startsWith(storagePrefix) && allowedArtworkUrl(artwork.metadata_uri));
  const indexed = new Map();
  if (process.env.ARTSOUL_SEARCH_ENABLED === 'true' && /^0x[0-9a-f]{40}$/.test(core) && core !== ZERO_ADDRESS) {
    // The existing read-only RPC checks the configured core, confirmed cursor,
    // current registration URI/transaction, and moderation visibility in one
    // database snapshot. Reuse that proof instead of fetching every original
    // metadata file again whenever a list's server instance starts cold. Only
    // this project's non-upsert upload store qualifies; external originals
    // retain their existing read behavior.
    await Promise.all(Array.from({ length: Math.ceil(candidates.length / 20) }, async (_, page) => {
      const batch = candidates.slice(page * 20, page * 20 + 20);
      const originals = new Map(batch.map(artwork => [String(artwork.artwork_id), artwork]));
      try {
        const data = await supabaseRest('rpc/read_public_search_cards', {
          method: 'POST', body: { p_artwork_ids: [...originals.keys()], p_core_address: core },
          signal: AbortSignal.timeout(1500)
        });
        if (!Array.isArray(data?.artworks) || !Array.isArray(data?.metadata) ||
            data.artworks.length !== data.metadata.length || data.artworks.length > originals.size ||
            new Set(data.artworks.map(row => row?.artwork_id)).size !== data.artworks.length) return;
        data.artworks.forEach((row, index) => {
          const original = originals.get(row?.artwork_id), metadata = data.metadata[index];
          if (!original || chainId(row.chain_id) !== CANONICAL_PUBLIC_CHAIN_ID ||
              row.metadata_uri !== original.metadata_uri || row.transaction_hash !== original.transaction_hash ||
              String(row.block_number) !== String(original.block_number) ||
              !metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !Object.keys(metadata).length) return;
          indexed.set(original, metadata);
        });
      } catch { /* Optional enrichment must not make older deployments unavailable. */ }
    }));
  }
  return Promise.all(artworks.map(artwork => indexed.get(artwork) ?? loadMetadataCached(artwork.metadata_uri)));
}

export function getMediaType(metadata = {}, mediaUrl = '') {
  const explicitTypes = [
    metadata.media_type,
    metadata.file_type,
    metadata.mime_type,
    metadata.properties?.media_type,
    metadata.properties?.mime_type
  ].map(value => normalizeText(value).toLowerCase()).filter(Boolean);
  const urls = [
    mediaUrl,
    metadata.animation_url,
    metadata.media_url,
    metadata.file_url,
    metadata.image,
    metadata.image_url,
    metadata.properties?.animation_url,
    metadata.properties?.media_url,
    metadata.properties?.image
  ].map(value => normalizeText(value).toLowerCase()).filter(Boolean);

  if (explicitTypes.some(type => type.includes('video')) || urls.some(url => /\.(mp4|webm|mov)(\?|$)/.test(url))) return 'video';
  if (explicitTypes.some(type => type.includes('audio') || type.includes('music')) || urls.some(url => /\.(mp3|wav|ogg|aac|m4a)(\?|$)/.test(url))) return 'audio';
  if (explicitTypes.some(type => type.includes('gif')) || urls.some(url => /\.gif(\?|$)/.test(url))) return 'gif';
  if (explicitTypes.some(type => type.includes('image')) || metadata.image || metadata.image_url || metadata.properties?.image) return 'image';
  return 'unknown';
}

function getMediaTypeFromUrl(value = '') {
  const url = normalizeText(value).toLowerCase();
  if (/\.(mp4|webm|mov)(\?|$)/.test(url)) return 'video';
  if (/\.(mp3|wav|ogg|aac|m4a)(\?|$)/.test(url)) return 'audio';
  if (/\.gif(\?|$)/.test(url)) return 'gif';
  if (/\.(jpg|jpeg|png|webp|avif|svg)(\?|$)/.test(url)) return 'image';
  return 'unknown';
}

export function getMediaUrl(metadata = {}, mediaType = getMediaType(metadata)) {
  if (mediaType === 'video' || mediaType === 'audio') {
    const playbackCandidates = [
      metadata.animation_url,
      metadata.media_url,
      metadata.file_url,
      metadata.properties?.animation_url,
      metadata.properties?.media_url
    ].map(normalizeText).filter(Boolean);
    return playbackCandidates.find(url => getMediaTypeFromUrl(url) === mediaType) ||
      playbackCandidates.find(url => getMediaTypeFromUrl(url) === 'unknown') || '';
  }

  return normalizeText(
    metadata.image ||
    metadata.image_url ||
    metadata.file_url ||
    metadata.media_url ||
    metadata.properties?.image ||
    metadata.properties?.media_url ||
    metadata.animation_url ||
    metadata.properties?.animation_url
  );
}

export function getPosterUrl(metadata = {}, mediaUrl = '') {
  const poster = normalizeText(
    metadata.image ||
    metadata.image_url ||
    metadata.poster_url ||
    metadata.thumbnail_url ||
    metadata.properties?.image ||
    metadata.properties?.poster_url
  );
  return poster && poster !== mediaUrl ? poster : '';
}

function getAIValueGuidance(metadata = {}) {
  const guidance = readAIValuation(metadata.ai_value_guidance || metadata.properties?.ai_value_guidance);
  if (!guidance) return null;

  const confidence = normalizeText(guidance.confidence).toLowerCase();
  return {
    estimated_value_min_eth: guidance.estimated_value_min_eth,
    estimated_value_max_eth: guidance.estimated_value_max_eth,
    suggested_start_price_eth: guidance.suggested_start_price_eth,
    confidence: ['low', 'medium', 'high'].includes(confidence) ? confidence : 'medium',
    rationale: normalizeText(guidance.rationale).slice(0, 500),
    factors: Array.isArray(guidance.factors)
      ? guidance.factors.map(item => normalizeText(item).slice(0, 120)).filter(Boolean).slice(0, 6)
      : [],
    risk_flags: Array.isArray(guidance.risk_flags)
      ? guidance.risk_flags.map(item => normalizeText(item).slice(0, 120)).filter(Boolean).slice(0, 6)
      : [],
    used_media: Boolean(guidance.used_media),
    model: normalizeText(guidance.model).slice(0, 80) || null,
    guidance_only: true
  };
}

// When a projection table is missing (migration not applied yet), remember the
// 404 instead of re-issuing the failing query on every projection rebuild.
const MISSING_TABLE_RETRY_MS = 10 * 60 * 1000;
const missingTables = new Map();

function isMissingTableError(error) {
  const text = `${error?.message || ''} ${JSON.stringify(error?.details || {})}`;
  return /PGRST205|42P01|could not find the table|does not exist/i.test(text);
}

async function queryTable(table, query, warnings) {
  const missingUntil = missingTables.get(table);
  if (missingUntil) {
    if (Date.now() < missingUntil) {
      warnings.push({ table, code: 'TABLE_MISSING_SKIPPED' });
      return [];
    }
    missingTables.delete(table);
  }

  try {
    return await supabaseRest(`${table}?${query}`) || [];
  } catch (error) {
    if (isMissingTableError(error)) {
      missingTables.set(table, Date.now() + MISSING_TABLE_RETRY_MS);
    }
    warnings.push({ table, code: error.code || 'QUERY_FAILED' });
    return [];
  }
}

function countByChain(rows = []) {
  return rows.reduce((counts, row) => {
    const id = String(row.chain_id || 'unknown');
    counts[id] = (counts[id] || 0) + 1;
    return counts;
  }, {});
}

function normalizePublicMetrics(rows = []) {
  const row = rows.find(candidate => chainId(candidate.chain_id) === 84532);
  if (!row) return null;

  return {
    chain_id: 84532,
    artists_onboarded: toNumber(row.artists_onboarded),
    auctions_completed: toNumber(row.auctions_completed),
    unique_collectors: toNumber(row.unique_collectors),
    settled_volume_eth: weiToEth(row.settled_volume_wei),
    as_of_block: toNumber(row.last_updated_block) || null,
    updated_at: row.updated_at || null
  };
}

function latestAuctionByArtwork(auctions = []) {
  const map = new Map();
  for (const auction of auctions) {
    const key = keyFor(auction.chain_id, auction.artwork_id);
    const current = map.get(key);
    if (!current || toNumber(auction.auction_id) > toNumber(current.auction_id)) {
      map.set(key, auction);
    }
  }
  return map;
}

function compareProjectionOrder(left = {}, right = {}) {
  const leftBlock = toNumber(left.block_number);
  const rightBlock = toNumber(right.block_number);
  if (leftBlock !== rightBlock) return leftBlock - rightBlock;

  const leftLog = toNumber(left.log_index);
  const rightLog = toNumber(right.log_index);
  if (leftLog !== rightLog) return leftLog - rightLog;

  return timestampMs(left.indexed_at) - timestampMs(right.indexed_at);
}

function latestCompletedSettlementByArtwork(settlements = []) {
  const map = new Map();
  for (const settlement of settlements) {
    if (normalizeText(settlement.settlement_status).toLowerCase() !== 'completed') continue;

    const artworkId = protocolId(settlement.artwork_id);
    const winner = addressOrNull(settlement.winner);
    if (!artworkId || !winner) continue;

    const key = keyFor(chainId(settlement.chain_id), artworkId);
    const current = map.get(key);
    if (!current || compareProjectionOrder(settlement, current) > 0) {
      map.set(key, settlement);
    }
  }
  return map;
}

function resaleByToken(listings = []) {
  const map = new Map();
  for (const listing of listings) {
    map.set(keyFor(listing.chain_id, listing.token_id), listing);
  }
  return map;
}

function latestResaleByToken(resales = []) {
  const map = new Map();
  for (const resale of resales) {
    const tokenId = protocolId(resale.token_id);
    const buyer = addressOrNull(resale.buyer);
    if (!tokenId || !buyer) continue;

    const key = keyFor(chainId(resale.chain_id), tokenId);
    const current = map.get(key);
    if (!current || compareProjectionOrder(resale, current) > 0) {
      map.set(key, resale);
    }
  }
  return map;
}

function floorByArtwork(floors = []) {
  const map = new Map();
  for (const floor of floors) {
    const key = keyFor(floor.chain_id, floor.artwork_id);
    const current = map.get(key);
    if (!current || toNumber(floor.block_number) > toNumber(current.block_number)) {
      map.set(key, floor);
    }
  }
  return map;
}

function socialSignalsByArtwork(signals = []) {
  const map = new Map();
  const seen = new Set();

  for (const signal of signals) {
    const key = keyFor(signal.chain_id, signal.artwork_id);
    const signalType = normalizeText(signal.signal_type).toLowerCase();
    const wallet = normalizeText(signal.wallet_address).toLowerCase();
    const uniqueKey = `${key}:${wallet}:${signalType}`;

    if (!wallet || seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);

    const counts = map.get(key) || { like: 0, would_buy: 0, watching: 0 };
    if (Object.prototype.hasOwnProperty.call(counts, signalType)) {
      counts[signalType] += 1;
    }
    map.set(key, counts);
  }
  return map;
}

function moderationVisibilityByArtwork(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const artworkId = protocolId(row.artwork_id);
    if (!artworkId) continue;
    map.set(keyFor(chainId(row.chain_id), artworkId), row);
  }
  return map;
}

// Mirrors the client-side ArtSoulProfileDisplay rule: auto-generated
// "User1a2b"-style usernames are not public nicknames, so cards fall back
// to the shortened wallet address.
const GENERATED_PROFILE_USERNAME = /^User[0-9a-fA-F]{4,6}$/;

// Lists need creator nicknames only; exact reads batch all displayed ownership
// roles with public avatars. A failed read must remain distinguishable from a
// confirmed missing profile so clients can retry rather than cache absence.
async function publicIdentitiesByAddress(wallets = [], warnings, { includeAvatar = false } = {}) {
  const addresses = [...new Set(
    wallets
      .map(wallet => normalizeText(wallet).toLowerCase())
      .filter(address => address && address !== ZERO_ADDRESS)
  )];
  if (!addresses.length) return new Map();

  const profileWarnings = [];
  const rows = await queryTable(
    'profiles',
    `select=wallet_address,username${includeAvatar ? ',avatar_url' : ''}&wallet_address=in.(${addresses.map(encodeURIComponent).join(',')})&limit=${addresses.length}`,
    profileWarnings
  );
  warnings.push(...profileWarnings);
  if (profileWarnings.length) return null;

  const map = new Map(addresses.map(address => [address, null]));
  for (const row of rows) {
    const wallet = normalizeText(row.wallet_address).toLowerCase();
    const username = normalizeText(row.username);
    if (!map.has(wallet)) continue;
    map.set(wallet, {
      wallet_address: wallet,
      username: username && !GENERATED_PROFILE_USERNAME.test(username) ? username : null,
      avatar_url: includeAvatar ? normalizeText(row.avatar_url) || null : null
    });
  }
  return map;
}

function bidsByAuction(bids = []) {
  const map = new Map();

  for (const bid of bids) {
    const chain = chainId(bid.chain_id);
    const auctionId = protocolId(bid.auction_id);
    const bidder = addressOrNull(bid.bidder);
    if (!chain || !auctionId || !bidder) continue;

    const key = keyFor(chain, auctionId);
    const auctionBids = map.get(key) || [];
    auctionBids.push({
      auction_id: auctionId,
      artwork_id: protocolId(bid.artwork_id),
      bidder,
      bid_amount: weiToEth(bid.bid_amount),
      bid_amount_wei: normalizeText(bid.bid_amount),
      block_number: toNumber(bid.block_number),
      log_index: toNumber(bid.log_index),
      transaction_hash: normalizeText(bid.transaction_hash),
      indexed_at: bid.indexed_at || null
    });
    map.set(key, auctionBids);
  }

  for (const auctionBids of map.values()) {
    auctionBids.sort((left, right) => compareProjectionOrder(right, left));
  }

  return map;
}

function ownershipProjection(artwork, maps) {
  const chain = chainId(artwork.chain_id);
  const artworkId = protocolId(artwork.artwork_id);
  const auction = maps.auctions.get(keyFor(chain, artworkId));
  const settlement = maps.settlements.get(keyFor(chain, artworkId));
  const tokenId = protocolId(artwork.token_id || settlement?.token_id || auction?.token_id);
  const resale = tokenId
    ? maps.resales.get(keyFor(chain, tokenId))
    : null;
  const latestResale = tokenId
    ? maps.resaleHistory.get(keyFor(chain, tokenId))
    : null;
  const auctionWinnerAddress = addressOrNull(settlement?.winner);
  const currentOwnerAddress = Boolean(artwork.minted)
    ? (addressOrNull(latestResale?.buyer) || addressOrNull(resale?.seller) || auctionWinnerAddress)
    : null;
  const ownershipAddresses = [...new Set([
    artwork.creator,
    auctionWinnerAddress,
    currentOwnerAddress,
    auction?.status === 'settlement_pending' ? addressOrNull(auction.current_bidder) : null
  ].map(address => normalizeText(address).toLowerCase()).filter(address => address && address !== ZERO_ADDRESS))];
  return { chain, artworkId, auction, tokenId, resale, auctionWinnerAddress, currentOwnerAddress, ownershipAddresses };
}

async function toPublicCard(artwork, maps, preloadedMetadata) {
  const { chain, artworkId, auction, tokenId, resale, auctionWinnerAddress, currentOwnerAddress, ownershipAddresses } = ownershipProjection(artwork, maps);
  const floor = maps.floors.get(keyFor(chain, artworkId));
  const signals = maps.socialSignals.get(keyFor(chain, artworkId)) || {
    like: 0,
    would_buy: 0,
    watching: 0
  };
  const moderation = maps.moderation.get(keyFor(chain, artworkId));
  const metadata = preloadedMetadata === undefined
    ? await loadMetadataCached(artwork.metadata_uri)
    : preloadedMetadata;
  const mediaType = getMediaType(metadata);
  const rawMediaUrl = getMediaUrl(metadata, mediaType);
  const mediaUrl = toHttpUri(rawMediaUrl) || rawMediaUrl;
  const rawPosterUrl = getPosterUrl(metadata, rawMediaUrl);
  const posterUrl = toHttpUri(rawPosterUrl) || rawPosterUrl;
  const status = statusFromProjection(artwork, auction, resale);
  const title = normalizeText(metadata.name || metadata.title) || `Artwork #${artworkId}`;
  const description = normalizeText(metadata.description) || 'Protocol-backed ArtSoul testnet artwork.';
  const canonicalFloor = floor?.floor_price || artwork.canonical_floor || auction?.final_price || 0;
  const currentBid = auction?.current_bid || auction?.winning_bid || 0;
  const salePrice = resale?.active ? resale.price : 0;
  const creatorIdentity = maps.publicIdentities?.get(normalizeText(artwork.creator).toLowerCase());

  return {
    id: `v41:${chain}:${artworkId}`,
    source: 'v41_projection',
    chain_id: chain,
    network: chain === 11155111 ? 'sepolia' : 'baseSepolia',
    artwork_id: artworkId,
    blockchain_id: artworkId,
    auction_id: protocolId(auction?.auction_id || artwork.active_auction_id),
    token_id: tokenId,
    title,
    description,
    creator: artwork.creator,
    creator_id: artwork.creator,
    creator_name: creatorIdentity?.username || null,
    ...(maps.includeOwnershipProfiles ? {
      creator_avatar_url: creatorIdentity?.avatar_url || null,
      ...(maps.publicIdentities ? {
        ownership_profiles: Object.fromEntries(ownershipAddresses.map(address => [address, maps.publicIdentities.get(address) ?? null]))
      } : {})
    } : {}),
    media_url: mediaUrl,
    file_url: mediaUrl,
    animation_url: ['video', 'audio'].includes(mediaType) ? mediaUrl : null,
    image: posterUrl || (['image', 'gif'].includes(mediaType) ? mediaUrl : null),
    image_url: posterUrl || null,
    poster_url: posterUrl || null,
    media_type: mediaType,
    file_type: mediaType,
    ai_guidance: getAIValueGuidance(metadata),
    metadata_uri: artwork.metadata_uri,
    status,
    current_bid: weiToEth(currentBid),
    highest_bid: weiToEth(currentBid),
    creator_value: weiToEth(auction?.start_price || canonicalFloor),
    start_price: weiToEth(auction?.start_price),
    sale_price: weiToEth(salePrice),
    resale_seller: addressOrNull(resale?.seller),
    resale_updated_block: Number(resale?.last_updated_block || resale?.block_number || 0),
    canonical_floor: weiToEth(canonicalFloor),
    floor_price: weiToEth(canonicalFloor),
    minted: Boolean(artwork.minted),
    active_auction_id: protocolId(artwork.active_auction_id),
    auction_end_time: auction?.end_time || null,
    settlement_deadline: timestampSeconds(auction?.settlement_deadline),
    current_bidder: auction?.current_bidder || ZERO_ADDRESS,
    winner: auction?.winner || null,
    auction_winner_address: auctionWinnerAddress,
    current_owner_address: currentOwnerAddress,
    vote_count: signals.like,
    like_count: signals.like,
    would_buy_count: signals.would_buy,
    watching_count: signals.watching,
    created_at: artwork.indexed_at,
    updated_at: artwork.last_updated_at,
    block_number: artwork.block_number,
    transaction_hash: artwork.transaction_hash,
    moderation_hidden: moderation?.hidden === true
  };
}

function filterCards(cards, query) {
  const id = validateArtworkId(query.id);
  const view = normalizeText(query.view).toLowerCase();
  let result = cards;

  if (id) {
    // A short public URL carries only the artwork number, so widen it to the
    // composite the cards are keyed by before comparing.
    const compositeId = /^\d{1,78}$/.test(id) ? `v41:${CANONICAL_PUBLIC_CHAIN_ID}:${id}` : id;
    result = result.filter(card =>
      card.id === compositeId || `${card.chain_id}:${card.artwork_id}` === compositeId
    );
  }

  if (query.chain_id) {
    const chain = chainId(query.chain_id);
    result = result.filter(card => card.chain_id === chain);
  }

  if (query.artwork_id) {
    const artworkId = protocolId(query.artwork_id);
    result = result.filter(card => card.artwork_id === artworkId);
  }

  if (query.creator || query.creator_id) {
    const creator = normalizeText(query.creator || query.creator_id).toLowerCase();
    result = result.filter(card => normalizeText(card.creator || card.creator_id).toLowerCase() === creator);
  }

  if (query.owner) {
    const owner = normalizeText(query.owner).toLowerCase();
    result = result.filter(card => normalizeText(card.current_owner_address).toLowerCase() === owner);
  }

  if (view === 'auctions') {
    result = result.filter(card => card.status === 'auction');
  } else if (view === 'marketplace') {
    result = result.filter(card =>
      card.status === 'for_sale' &&
      card.minted === true &&
      toNumber(card.sale_price) > 0
    );
  } else if (view === 'collections') {
    result = [];
  }

  const limit = Math.min(Math.max(toNumber(query.limit) || 100, 1), 200);
  return result.slice(0, limit);
}

function parseDirectLookup(query = {}) {
  const rawId = validateArtworkId(query.id) || '';
  const compositeMatch = rawId.match(/^v41:(84532|11155111):(\d{1,78})$/);
  if (compositeMatch) {
    return { chain: Number(compositeMatch[1]), artworkId: compositeMatch[2] };
  }

  // Short public URLs (/artwork/27) carry only the artwork number. A bare id
  // always means the product chain; legacy Ethereum Sepolia rows keep the
  // explicit composite so nothing here is ambiguous.
  if (/^\d{1,78}$/.test(rawId)) {
    return { chain: CANONICAL_PUBLIC_CHAIN_ID, artworkId: rawId };
  }

  const chain = chainId(query.chain_id);
  const artworkId = protocolId(query.artwork_id);
  if (PUBLIC_CHAIN_IDS.includes(chain) && /^\d{1,78}$/.test(artworkId)) {
    return { chain, artworkId };
  }

  return null;
}

async function projectTableData(tableData, warnings, publicMetrics = null, preload = {}) {
  // Creator names and immutable metadata are independent reads. Starting them
  // together removes one serial network round trip from a cold projection.
  const [publicIdentities, metadataRows] = await Promise.all([
    preload.publicIdentities ?? publicIdentitiesByAddress(tableData.v41_artworks.map(artwork => artwork.creator), warnings),
    preload.metadataRows ?? Promise.all(
      tableData.v41_artworks.map(artwork => loadMetadataCached(artwork.metadata_uri))
    )
  ]);
  const maps = {
    publicIdentities,
    includeOwnershipProfiles: preload.includeOwnershipProfiles === true,
    auctions: latestAuctionByArtwork(tableData.v41_auctions),
    settlements: latestCompletedSettlementByArtwork(tableData.v41_settlements),
    resales: resaleByToken(tableData.v41_resale_listings),
    resaleHistory: latestResaleByToken(tableData.v41_resale_history),
    floors: floorByArtwork(tableData.v41_floor_history),
    socialSignals: preload.socialSignals ?? socialSignalsByArtwork(tableData.artwork_social_signals),
    moderation: moderationVisibilityByArtwork(tableData.artwork_moderation_visibility),
    bids: bidsByAuction(tableData.v41_bids)
  };

  const cards = await Promise.all(
    tableData.v41_artworks.map((artwork, index) => toPublicCard(artwork, maps, metadataRows[index]))
  );
  const diagnostics = TABLES.reduce((acc, table) => {
    acc[table] = {
      rowsByChain: countByChain(tableData[table] || []),
      sampledRows: (tableData[table] || []).length
    };
    return acc;
  }, {});

  return { cards, bids: maps.bids, diagnostics, warnings, publicMetrics };
}

async function buildDirectProjectionSnapshot({ chain, artworkId }) {
  const warnings = [];
  const chainFilter = `eq.${chain}`;
  const artworkFilter = `eq.${artworkId}`;
  const v41ArtworksPromise = queryTable(
    'v41_artworks',
    'select=chain_id,artwork_id,creator,metadata_uri,minted,token_id,canonical_floor,active_auction_id,block_number,transaction_hash,indexed_at,last_updated_at' +
      `&chain_id=${chainFilter}&artwork_id=${artworkFilter}&limit=1`,
    warnings
  );
  const v41AuctionsPromise = queryTable(
      'v41_auctions',
      'select=chain_id,auction_id,artwork_id,status,start_price,end_time,current_bid,current_bidder,winner,winning_bid,settlement_deadline,final_price,token_id' +
        `&chain_id=${chainFilter}&artwork_id=${artworkFilter}&order=last_updated_block.desc&limit=100`,
      warnings
    );
  const v41BidsPromise = queryTable(
      'v41_bids',
      'select=chain_id,auction_id,artwork_id,bidder,bid_amount,block_number,log_index,transaction_hash,indexed_at' +
        `&chain_id=${chainFilter}&artwork_id=${artworkFilter}&order=block_number.desc,log_index.desc&limit=100`,
      warnings
    );
  const v41SettlementsPromise = queryTable(
      'v41_settlements',
      'select=chain_id,artwork_id,settlement_status,winner,token_id,block_number,log_index,indexed_at' +
        `&chain_id=${chainFilter}&artwork_id=${artworkFilter}&order=block_number.desc,log_index.desc&limit=100`,
      warnings
    );
  const v41FloorHistoryPromise = queryTable(
      'v41_floor_history',
      'select=chain_id,artwork_id,floor_price,block_number' +
        `&chain_id=${chainFilter}&artwork_id=${artworkFilter}&order=block_number.desc&limit=1`,
      warnings
    );
  const artworkSocialSignalsPromise = queryTable(
      'artwork_social_signals',
      'select=chain_id,artwork_id,wallet_address,signal_type' +
        `&chain_id=${chainFilter}&artwork_id=${artworkFilter}&limit=5000`,
      warnings
    );
  const artworkModerationVisibilityPromise = queryTable(
      'artwork_moderation_visibility',
      `select=chain_id,artwork_id,hidden&chain_id=${chainFilter}&artwork_id=${artworkFilter}&limit=1`,
      warnings
    );

  // Only resale tables depend on token_id. Everything else above begins with
  // the request instead of waiting for the artwork row to return first.
  const v41Artworks = await v41ArtworksPromise;
  const tokenId = protocolId(v41Artworks[0]?.token_id);
  const preload = {
    includeOwnershipProfiles: true,
    metadataRows: Promise.all(
      v41Artworks.map(artwork => loadMetadataCached(artwork.metadata_uri))
    )
  };
  const v41ResaleListingsPromise =
    tokenId
      ? queryTable(
          'v41_resale_listings',
          `select=chain_id,token_id,active,price,seller,last_updated_block&chain_id=${chainFilter}&token_id=eq.${tokenId}&limit=1`,
          warnings
        )
      : Promise.resolve([]);
  const v41ResaleHistoryPromise =
    tokenId
      ? queryTable(
          'v41_resale_history',
          'select=chain_id,token_id,buyer,seller,block_number,log_index,indexed_at' +
            `&chain_id=${chainFilter}&token_id=eq.${tokenId}&order=block_number.desc,log_index.desc&limit=1`,
          warnings
        )
      : Promise.resolve([]);

  // Ownership reads can finish while bids, signals and metadata are still in
  // flight. Use the same role projection as the response, including the
  // pending highest bidder without assigning an unearned First Collector.
  preload.publicIdentities = Promise.all([
    v41AuctionsPromise, v41SettlementsPromise, v41ResaleListingsPromise, v41ResaleHistoryPromise
  ]).then(([auctions, settlements, listings, history]) => {
    const ownershipMaps = {
      auctions: latestAuctionByArtwork(auctions),
      settlements: latestCompletedSettlementByArtwork(settlements),
      resales: resaleByToken(listings),
      resaleHistory: latestResaleByToken(history)
    };
    const addresses = v41Artworks.flatMap(artwork => ownershipProjection(artwork, ownershipMaps).ownershipAddresses);
    return publicIdentitiesByAddress(addresses, warnings, { includeAvatar: true });
  });

  const [
    v41Auctions,
    v41Bids,
    v41Settlements,
    v41ResaleListings,
    v41ResaleHistory,
    v41FloorHistory,
    artworkSocialSignals,
    artworkModerationVisibility
  ] = await Promise.all([
    v41AuctionsPromise,
    v41BidsPromise,
    v41SettlementsPromise,
    v41ResaleListingsPromise,
    v41ResaleHistoryPromise,
    v41FloorHistoryPromise,
    artworkSocialSignalsPromise,
    artworkModerationVisibilityPromise
  ]);

  return projectTableData({
    v41_artworks: v41Artworks,
    v41_auctions: v41Auctions,
    v41_bids: v41Bids,
    v41_settlements: v41Settlements,
    v41_resale_listings: v41ResaleListings,
    v41_resale_history: v41ResaleHistory,
    v41_floor_history: v41FloorHistory,
    v41_trust_signals: [],
    artwork_social_signals: artworkSocialSignals,
    artwork_moderation_visibility: artworkModerationVisibility
  }, warnings, null, preload);
}

async function buildProjectionSnapshot() {
  const warnings = [];
  const chainFilter = `in.(${PUBLIC_CHAIN_IDS.join(',')})`;
  const artworksPromise = queryTable(
    'v41_artworks',
    'select=chain_id,artwork_id,creator,metadata_uri,minted,token_id,canonical_floor,active_auction_id,block_number,transaction_hash,indexed_at,last_updated_at' +
      `&chain_id=${chainFilter}&order=last_updated_block.desc&limit=200`,
    warnings
  );
  // Metadata and public creator profiles only depend on the artwork rows, not
  // on bids, settlements or metrics. Keep all lifecycle reads in the final gate.
  const preload = {
    metadataRows: artworksPromise.then(loadFeedMetadata),
    publicIdentities: artworksPromise.then(rows => publicIdentitiesByAddress(rows.map(artwork => artwork.creator), warnings))
  };
  // Consume possible early rejections while the lifecycle queries are pending;
  // projectTableData still receives the original promises and their failures.
  preload.metadataRows.catch(() => {});
  preload.publicIdentities.catch(() => {});
  const [
    v41Artworks,
    v41Auctions,
    v41Bids,
    v41Settlements,
    v41ResaleListings,
    v41ResaleHistory,
    v41FloorHistory,
    v41TrustSignals,
    artworkSocialSignals,
    artworkModerationVisibility,
    publicMetricRows
  ] = await Promise.all([
    artworksPromise,
    queryTable(
      'v41_auctions',
      'select=chain_id,auction_id,artwork_id,status,start_price,end_time,current_bid,current_bidder,winner,winning_bid,settlement_deadline,final_price,token_id' +
        `&chain_id=${chainFilter}&order=last_updated_block.desc&limit=200`,
      warnings
    ),
    queryTable(
      'v41_bids',
      `select=chain_id,auction_id,artwork_id,bidder,bid_amount,block_number,log_index,transaction_hash,indexed_at&chain_id=${chainFilter}&limit=1000`,
      warnings
    ),
    queryTable(
      'v41_settlements',
      `select=chain_id,artwork_id,settlement_status,winner,token_id,block_number,log_index,indexed_at&chain_id=${chainFilter}&limit=200`,
      warnings
    ),
    queryTable(
      'v41_resale_listings',
      `select=chain_id,token_id,active,price,seller,last_updated_block&chain_id=${chainFilter}&limit=200`,
      warnings
    ),
    queryTable(
      'v41_resale_history',
      `select=chain_id,token_id,buyer,seller,block_number,log_index,indexed_at&chain_id=${chainFilter}&limit=1000`,
      warnings
    ),
    queryTable(
      'v41_floor_history',
      `select=chain_id,artwork_id,floor_price,block_number&chain_id=${chainFilter}&limit=200`,
      warnings
    ),
    queryTable('v41_trust_signals', `select=chain_id&chain_id=${chainFilter}&limit=1000`, warnings),
    queryTable(
      'artwork_social_signals',
      `select=chain_id,artwork_id,wallet_address,signal_type&chain_id=${chainFilter}&limit=5000`,
      warnings
    ),
    queryTable(
      'artwork_moderation_visibility',
      `select=chain_id,artwork_id,hidden&chain_id=${chainFilter}&limit=1000`,
      warnings
    ),
    queryTable(
      'v41_public_metrics',
      'select=chain_id,artists_onboarded,auctions_completed,unique_collectors,settled_volume_wei,last_updated_block,updated_at' +
        '&chain_id=eq.84532&limit=1',
      warnings
    )
  ]);
  const tableData = {
    v41_artworks: v41Artworks,
    v41_auctions: v41Auctions,
    v41_bids: v41Bids,
    v41_settlements: v41Settlements,
    v41_resale_listings: v41ResaleListings,
    v41_resale_history: v41ResaleHistory,
    v41_floor_history: v41FloorHistory,
    v41_trust_signals: v41TrustSignals,
    artwork_social_signals: artworkSocialSignals,
    artwork_moderation_visibility: artworkModerationVisibility
  };

  return projectTableData(tableData, warnings, normalizePublicMetrics(publicMetricRows), preload);
}

// One projection rebuild per instance per TTL window; every request inside the
// window is served from memory without touching Supabase.
const PROJECTION_CACHE_MS = Math.max(1000, Number(process.env.PUBLIC_PROJECTION_CACHE_MS) || 30000);
let projectionSnapshotPromise = null;
let projectionSnapshotAt = 0;
const directProjectionCache = new Map();

function getProjectionSnapshot() {
  const now = Date.now();
  if (!projectionSnapshotPromise || now - projectionSnapshotAt >= PROJECTION_CACHE_MS) {
    projectionSnapshotAt = now;
    const promise = buildProjectionSnapshot();
    projectionSnapshotPromise = promise;
    promise.catch(() => {
      if (projectionSnapshotPromise === promise) projectionSnapshotPromise = null;
    });
  }
  return projectionSnapshotPromise;
}

function getDirectProjectionSnapshot(lookup, fresh = false) {
  const now = Date.now();
  const key = keyFor(lookup.chain, lookup.artworkId);
  const cached = directProjectionCache.get(key);
  // A receipt-triggered lookup refreshes only one artwork. Coalesce repeated
  // requests for one second; never rebuild the full public corpus on refresh.
  if (cached && now - cached.createdAt < (fresh ? 1000 : PROJECTION_CACHE_MS)) return cached.promise;

  const cacheEntry = { createdAt: now, promise: null };
  const promise = buildDirectProjectionSnapshot(lookup).then(snapshot => {
    // A just-published artwork can legitimately miss the projection for a few
    // seconds. Share the in-flight read, but never retain that negative result
    // for the full projection TTL or the exact-artwork page cannot recover.
    if (snapshot?.cards?.length === 0 && directProjectionCache.get(key) === cacheEntry) {
      directProjectionCache.delete(key);
    }
    return snapshot;
  }, error => {
    if (directProjectionCache.get(key) === cacheEntry) directProjectionCache.delete(key);
    throw error;
  });
  cacheEntry.promise = promise;
  directProjectionCache.set(key, cacheEntry);
  if (directProjectionCache.size > 100) {
    directProjectionCache.delete(directProjectionCache.keys().next().value);
  }
  return promise;
}

// Reuse the exact public projection for bounded private bookmark hydration.
// This helper never takes a staff session and never bypasses hidden visibility.
export async function readVisibleArtworkCard(chain, artworkId) {
  const snapshot = await getDirectProjectionSnapshot({ chain, artworkId });
  if (snapshot.warnings.length) throw new Error('Artwork projection is unavailable');
  const card = snapshot.cards.find(row => Number(row.chain_id) === chain && String(row.artwork_id) === artworkId);
  return card && card.moderation_hidden !== true ? card : null;
}

// Bounded search hydration reuses the public serializer once. The RPC returns
// per-work latest lifecycle rows and indexed metadata, not the latest-200 feed.
export async function readVisibleArtworkCards(chain, artworkIds, coreAddress) {
  if (chain !== 84532 || !Array.isArray(artworkIds) || !artworkIds.length || artworkIds.length > 20 ||
      artworkIds.some(id => typeof id !== 'string' || !/^[1-9][0-9]{0,77}$/.test(id) || BigInt(id) >= 2n ** 256n) ||
      !/^0x[0-9a-f]{40}$/.test(coreAddress) || /^0x0{40}$/.test(coreAddress)) throw new Error('Invalid search page');
  const ids = [...new Set(artworkIds)];
  const data = await supabaseRest('rpc/read_public_search_cards', {
    method: 'POST', body: { p_artwork_ids: ids, p_core_address: coreAddress }
  });
  if (!data || ['artworks','metadata','auctions','settlements','listings','resales','signals'].some(key => !Array.isArray(data[key])) ||
      data.artworks.length > ids.length || data.metadata.length !== data.artworks.length || data.signals.length !== data.artworks.length ||
      data.artworks.some(row => Number(row.chain_id) !== chain || !ids.includes(row.artwork_id))) throw new Error('Invalid search projection');
  const warnings = [];
  const snapshot = await projectTableData({
    v41_artworks: data.artworks, v41_auctions: data.auctions, v41_settlements: data.settlements,
    v41_resale_listings: data.listings, v41_resale_history: data.resales, v41_floor_history: [],
    v41_bids: [], v41_trust_signals: [], artwork_social_signals: [], artwork_moderation_visibility: []
  }, warnings, null, {
    metadataRows: data.metadata,
    socialSignals: new Map(data.artworks.map((row, index) => [keyFor(chain, row.artwork_id), data.signals[index]]))
  });
  if (warnings.length) throw new Error('Search profiles are unavailable');
  // A hide/reorg/URI replacement during hydration must not return stale media.
  const filter = `chain_id=eq.${chain}&artwork_id=in.(${ids.join(',')})&limit=${ids.length}`;
  const [visibility, existing] = await Promise.all([
    supabaseRest(`artwork_moderation_visibility?select=artwork_id::text,hidden&${filter}`),
    supabaseRest(`v41_artworks?select=artwork_id::text,metadata_uri,transaction_hash&${filter}`)
  ]);
  if (!Array.isArray(visibility) || !Array.isArray(existing) ||
      visibility.some(row => !ids.includes(row.artwork_id) || typeof row.hidden !== 'boolean') ||
      existing.some(row => !ids.includes(row.artwork_id))) throw new Error('Search visibility is unavailable');
  const hidden = new Set(visibility.filter(row => row.hidden).map(row => row.artwork_id));
  const current = new Map(existing.map(row => [row.artwork_id, row]));
  const cards = new Map(snapshot.cards.filter(card => !hidden.has(card.artwork_id) &&
    current.get(card.artwork_id)?.metadata_uri === card.metadata_uri &&
    current.get(card.artwork_id)?.transaction_hash === card.transaction_hash).map(card => [card.artwork_id, card]));
  return ids.map(id => cards.get(id)).filter(Boolean);
}

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const requestQuery = req.query || {};
    const directLookup = parseDirectLookup(requestQuery);
    const { cards, bids, diagnostics, warnings, publicMetrics } = directLookup
      ? await getDirectProjectionSnapshot(directLookup, requestQuery.fresh === '1')
      : await getProjectionSnapshot();
    // A failed source read is not an empty catalogue. In particular, quota
    // restrictions must not become CDN-cacheable successful empty responses.
    if (warnings.some(warning => warning.table === 'v41_artworks')) {
      res.setHeader('Cache-Control', 'private, no-store');
      return sendError(res, Object.assign(new Error('Artworks are temporarily unavailable. Please try again later.'), {
        code: 'ARTWORKS_UNAVAILABLE', statusCode: 503
      }));
    }
    const suppressedArtworkIds = cards
      .filter(card => card.moderation_hidden === true)
      .map(card => card.id);
    const isDirectArtworkLookup = Boolean(validateArtworkId(requestQuery.id)) ||
      Boolean(protocolId(requestQuery.artwork_id));
    const moderationAccess = isDirectArtworkLookup && suppressedArtworkIds.length > 0
      ? await getModerationAccess(req)
      : { canModerate: false };
    const visibleCards = cards.filter(card =>
      card.moderation_hidden !== true || (isDirectArtworkLookup && moderationAccess.canModerate)
    );
    const filteredCards = filterCards(visibleCards, requestQuery);
    const data = isDirectArtworkLookup
      ? filteredCards.map(card => ({
          ...card,
          bids: bids.get(keyFor(card.chain_id, card.auction_id)) || []
        }))
      : filteredCards;

    // Direct lookups can differ per viewer (staff see hidden works), so only
    // list responses are CDN-cacheable.
    const cacheSeconds = Math.max(1, Math.round(PROJECTION_CACHE_MS / 1000));
    res.setHeader('Cache-Control', isDirectArtworkLookup
      ? 'private, no-store'
      : `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 4}`);

    res.status(200).json({
      success: true,
      source: 'v41_projection',
      data,
      count: data.length,
      suppressed_artwork_ids: suppressedArtworkIds,
      public_metrics: isDirectArtworkLookup ? null : publicMetrics,
      diagnostics,
      warnings
    });
  } catch (error) {
    sendError(res, error);
  }
}
