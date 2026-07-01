import { allowMethods, sendError, supabaseRest, validateArtworkId } from '../../backend.js';
import { getModerationAccess } from '../../moderation-access.js';

const PUBLIC_CHAIN_IDS = [84532, 11155111];
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
    return fraction ? `${whole}.${fraction.slice(0, 6)}` : whole.toString();
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

function parseMetadataLiteral(uri) {
  if (!uri) return null;
  const trimmed = uri.trim();

  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed);
  }

  if (trimmed.startsWith('data:application/json;base64,')) {
    return JSON.parse(Buffer.from(trimmed.split(',')[1], 'base64').toString('utf8'));
  }

  if (trimmed.startsWith('data:application/json,')) {
    return JSON.parse(decodeURIComponent(trimmed.split(',')[1] || ''));
  }

  return null;
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
  try {
    const literal = parseMetadataLiteral(metadataUri);
    if (literal) return literal;
  } catch {
    return {};
  }

  const url = toHttpUri(metadataUri);
  if (!url) return {};

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return {};
    return await response.json();
  } catch {
    return {};
  }
}

function getMediaType(metadata = {}, mediaUrl = '') {
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

function getMediaUrl(metadata = {}, mediaType = getMediaType(metadata)) {
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

function getPosterUrl(metadata = {}, mediaUrl = '') {
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
  const guidance = metadata.ai_value_guidance || metadata.properties?.ai_value_guidance;
  if (!guidance || typeof guidance !== 'object' || Array.isArray(guidance)) return null;

  const minimum = Number(guidance.estimated_value_min_eth);
  const maximum = Number(guidance.estimated_value_max_eth);
  const suggested = Number(guidance.suggested_start_price_eth);
  if (![minimum, maximum, suggested].every(Number.isFinite)) return null;

  const confidence = normalizeText(guidance.confidence).toLowerCase();
  return {
    estimated_value_min_eth: Math.max(0, minimum),
    estimated_value_max_eth: Math.max(Math.max(0, minimum), maximum),
    suggested_start_price_eth: Math.max(0, suggested),
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

async function queryTable(table, query, warnings) {
  try {
    return await supabaseRest(`${table}?${query}`) || [];
  } catch (error) {
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
    if (!listing.active) continue;
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

async function toPublicCard(artwork, maps) {
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
  const floor = maps.floors.get(keyFor(chain, artworkId));
  const signals = maps.socialSignals.get(keyFor(chain, artworkId)) || {
    like: 0,
    would_buy: 0,
    watching: 0
  };
  const moderation = maps.moderation.get(keyFor(chain, artworkId));
  const metadata = await loadMetadata(artwork.metadata_uri);
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
  const salePrice = resale?.price || 0;
  const auctionWinnerAddress = addressOrNull(settlement?.winner);
  const currentOwnerAddress = Boolean(artwork.minted)
    ? (addressOrNull(latestResale?.buyer) || addressOrNull(resale?.seller) || auctionWinnerAddress)
    : null;

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
    result = result.filter(card => card.id === id || `${card.chain_id}:${card.artwork_id}` === id);
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

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const warnings = [];
    const chainFilter = `in.(${PUBLIC_CHAIN_IDS.join(',')})`;
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
      artworkModerationVisibility
    ] = await Promise.all([
      queryTable(
        'v41_artworks',
        `select=*&chain_id=${chainFilter}&order=last_updated_block.desc&limit=200`,
        warnings
      ),
      queryTable(
        'v41_auctions',
        `select=*&chain_id=${chainFilter}&order=last_updated_block.desc&limit=200`,
        warnings
      ),
      queryTable(
        'v41_bids',
        `select=chain_id,auction_id,artwork_id,bidder,bid_amount,block_number,log_index,transaction_hash,indexed_at&chain_id=${chainFilter}&limit=1000`,
        warnings
      ),
      queryTable('v41_settlements', `select=*&chain_id=${chainFilter}&limit=200`, warnings),
      queryTable('v41_resale_listings', `select=*&chain_id=${chainFilter}&limit=200`, warnings),
      queryTable(
        'v41_resale_history',
        `select=chain_id,token_id,buyer,seller,block_number,log_index,indexed_at&chain_id=${chainFilter}&limit=1000`,
        warnings
      ),
      queryTable('v41_floor_history', `select=*&chain_id=${chainFilter}&limit=200`, warnings),
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

    const maps = {
      auctions: latestAuctionByArtwork(tableData.v41_auctions),
      settlements: latestCompletedSettlementByArtwork(tableData.v41_settlements),
      resales: resaleByToken(tableData.v41_resale_listings),
      resaleHistory: latestResaleByToken(tableData.v41_resale_history),
      floors: floorByArtwork(tableData.v41_floor_history),
      socialSignals: socialSignalsByArtwork(tableData.artwork_social_signals),
      moderation: moderationVisibilityByArtwork(tableData.artwork_moderation_visibility),
      bids: bidsByAuction(tableData.v41_bids)
    };

    const cards = await Promise.all(tableData.v41_artworks.map(artwork => toPublicCard(artwork, maps)));
    const requestQuery = req.query || {};
    const suppressedArtworkIds = cards
      .filter(card => card.moderation_hidden === true)
      .map(card => card.id);
    const isDirectArtworkLookup = Boolean(validateArtworkId(requestQuery.id)) ||
      Boolean(protocolId(requestQuery.artwork_id));
    const moderationAccess = isDirectArtworkLookup
      ? await getModerationAccess(req)
      : { canModerate: false };
    const visibleCards = cards.filter(card =>
      card.moderation_hidden !== true || (isDirectArtworkLookup && moderationAccess.canModerate)
    );
    const filteredCards = filterCards(visibleCards, requestQuery);
    const includeBidActivity = Boolean(validateArtworkId(requestQuery.id)) ||
      Boolean(protocolId(requestQuery.artwork_id));
    const data = includeBidActivity
      ? filteredCards.map(card => ({
          ...card,
          bids: maps.bids.get(keyFor(card.chain_id, card.auction_id)) || []
        }))
      : filteredCards;
    const diagnostics = TABLES.reduce((acc, table) => {
      acc[table] = {
        rowsByChain: countByChain(tableData[table] || []),
        sampledRows: (tableData[table] || []).length
      };
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      source: 'v41_projection',
      data,
      count: data.length,
      suppressed_artwork_ids: suppressedArtworkIds,
      diagnostics,
      warnings
    });
  } catch (error) {
    sendError(res, error);
  }
}
