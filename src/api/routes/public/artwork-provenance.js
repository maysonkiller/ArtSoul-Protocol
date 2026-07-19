import { allowMethods, sendError, supabaseRest, validateArtworkId } from '../../backend.js';
import { getModerationAccess } from '../../moderation-access.js';

const PUBLIC_CHAIN_IDS = new Set([84532, 11155111]);
const MAX_ROWS_PER_SOURCE = 200;
const CACHE_SECONDS = 30;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function protocolId(value) {
  const text = normalizeText(value);
  return /^\d{1,78}$/.test(text) && text !== '0' ? text : '';
}

function addressOrNull(value) {
  const text = normalizeText(value);
  return /^0x[a-fA-F0-9]{40}$/.test(text) && !/^0x0{40}$/i.test(text) ? text : null;
}

function toNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
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
    return '0';
  }
}

function projectionOrder(left = {}, right = {}) {
  const blockDelta = toNumber(left.block_number) - toNumber(right.block_number);
  if (blockDelta !== 0) return blockDelta;
  const logDelta = toNumber(left.log_index) - toNumber(right.log_index);
  if (logDelta !== 0) return logDelta;
  return new Date(left.indexed_at || 0).getTime() - new Date(right.indexed_at || 0).getTime();
}

function eventBase(type, row = {}) {
  return {
    type,
    block_number: toNumber(row.block_number),
    log_index: toNumber(row.log_index),
    transaction_hash: normalizeText(row.transaction_hash) || null,
    recorded_at: row.indexed_at || null
  };
}

function buildTimeline({ artwork, auctions, endings, settlements, resaleHistory, activeListing }) {
  const events = [];
  const creatorAddress = addressOrNull(artwork.creator);

  events.push({
    ...eventBase('artwork_registered', artwork),
    creator_address: creatorAddress
  });

  for (const auction of auctions) {
    events.push({
      ...eventBase('auction_started', auction),
      auction_id: protocolId(auction.auction_id),
      creator_address: addressOrNull(auction.creator) || creatorAddress,
      start_price: weiToEth(auction.start_price),
      duration_seconds: toNumber(auction.duration)
    });
  }

  for (const ending of endings) {
    events.push({
      ...eventBase('auction_ended', ending),
      auction_id: protocolId(ending.auction_id),
      highest_bidder_address: addressOrNull(ending.winner),
      winning_bid: weiToEth(ending.winning_bid),
      settlement_deadline: ending.settlement_deadline || null
    });
  }

  for (const settlement of settlements) {
    const status = normalizeText(settlement.settlement_status).toLowerCase();
    const type = status === 'completed'
      ? 'settlement_completed'
      : status === 'defaulted'
        ? 'settlement_defaulted'
        : 'settlement_pending';
    events.push({
      ...eventBase(type, settlement),
      auction_id: protocolId(settlement.auction_id),
      first_collector_address: status === 'completed' ? addressOrNull(settlement.winner) : null,
      highest_bidder_address: status === 'completed' ? null : addressOrNull(settlement.winner),
      final_price: weiToEth(settlement.final_price),
      token_id: protocolId(settlement.token_id)
    });
  }

  for (const resale of resaleHistory) {
    events.push({
      ...eventBase('resale_completed', resale),
      token_id: protocolId(resale.token_id),
      seller_address: addressOrNull(resale.seller),
      owner_address: addressOrNull(resale.buyer),
      price: weiToEth(resale.price)
    });
  }

  if (activeListing?.active) {
    events.push({
      ...eventBase('resale_listed', activeListing),
      token_id: protocolId(activeListing.token_id),
      owner_address: addressOrNull(activeListing.seller),
      price: weiToEth(activeListing.price)
    });
  }

  return events.sort(projectionOrder);
}

function latestCompletedSettlement(settlements) {
  return settlements
    .filter(row => normalizeText(row.settlement_status).toLowerCase() === 'completed')
    .sort(projectionOrder)[0] || null;
}

function latestResale(resales) {
  return [...resales].sort((left, right) => projectionOrder(right, left))[0] || null;
}

async function readRows(path) {
  const rows = await supabaseRest(path);
  return Array.isArray(rows) ? rows : [];
}

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const chainId = Number(req.query?.chain_id);
    const artworkId = protocolId(validateArtworkId(req.query?.artwork_id));
    if (!PUBLIC_CHAIN_IDS.has(chainId) || !artworkId) {
      return res.status(400).json({ error: 'INVALID_ARTWORK_LOOKUP' });
    }

    const chainFilter = `eq.${chainId}`;
    const artworkFilter = `eq.${artworkId}`;
    const [artworkRows, moderationRows] = await Promise.all([
      readRows(
        'v41_artworks?select=chain_id,artwork_id,creator,minted,token_id,block_number,transaction_hash,log_index,indexed_at' +
        `&chain_id=${chainFilter}&artwork_id=${artworkFilter}&limit=1`
      ),
      readRows(
        'artwork_moderation_visibility?select=hidden&' +
        `chain_id=${chainFilter}&artwork_id=${artworkFilter}&limit=1`
      )
    ]);

    const artwork = artworkRows[0] || null;
    if (!artwork) {
      return res.status(404).json({ error: 'ARTWORK_NOT_FOUND' });
    }

    const hidden = moderationRows[0]?.hidden === true;
    if (hidden) {
      const access = await getModerationAccess(req);
      if (!access.canModerate) {
        return res.status(404).json({ error: 'ARTWORK_UNAVAILABLE' });
      }
    }

    const tokenId = protocolId(artwork.token_id);
    const [auctions, settlements, resaleHistory, listingRows] = await Promise.all([
      readRows(
        'v41_auctions?select=chain_id,auction_id,artwork_id,creator,start_price,duration,block_number,transaction_hash,log_index,indexed_at' +
        `&chain_id=${chainFilter}&artwork_id=${artworkFilter}` +
        `&order=block_number.asc,log_index.asc&limit=${MAX_ROWS_PER_SOURCE}`
      ),
      readRows(
        'v41_settlements?select=chain_id,auction_id,artwork_id,winner,final_price,token_id,settlement_status,block_number,transaction_hash,log_index,indexed_at' +
        `&chain_id=${chainFilter}&artwork_id=${artworkFilter}` +
        `&order=block_number.asc,log_index.asc&limit=${MAX_ROWS_PER_SOURCE}`
      ),
      tokenId
        ? readRows(
            'v41_resale_history?select=chain_id,token_id,seller,buyer,price,block_number,transaction_hash,log_index,indexed_at' +
            `&chain_id=${chainFilter}&token_id=eq.${tokenId}` +
            `&order=block_number.asc,log_index.asc&limit=${MAX_ROWS_PER_SOURCE}`
          )
        : [],
      tokenId
        ? readRows(
            'v41_resale_listings?select=chain_id,token_id,seller,price,active,block_number,transaction_hash,log_index,indexed_at' +
            `&chain_id=${chainFilter}&token_id=eq.${tokenId}&active=eq.true&limit=1`
          )
        : []
    ]);

    const auctionIds = auctions.map(row => protocolId(row.auction_id)).filter(Boolean);
    const endings = auctionIds.length > 0
      ? await readRows(
          'v41_auction_endings?select=chain_id,auction_id,winner,winning_bid,settlement_deadline,block_number,transaction_hash,log_index,indexed_at' +
          `&chain_id=${chainFilter}&auction_id=in.(${auctionIds.join(',')})` +
          `&order=block_number.asc,log_index.asc&limit=${MAX_ROWS_PER_SOURCE}`
        )
      : [];

    const completedSettlement = latestCompletedSettlement(settlements);
    const latestResaleRow = latestResale(resaleHistory);
    const activeListing = listingRows[0] || null;
    const firstCollectorAddress = addressOrNull(completedSettlement?.winner);
    const currentOwnerAddress = artwork.minted === true
      ? (addressOrNull(latestResaleRow?.buyer) || addressOrNull(activeListing?.seller) || firstCollectorAddress)
      : null;
    const sourceCounts = {
      auctions: auctions.length,
      endings: endings.length,
      settlements: settlements.length,
      resales: resaleHistory.length
    };
    const truncatedSources = Object.entries(sourceCounts)
      .filter(([, count]) => count >= MAX_ROWS_PER_SOURCE)
      .map(([source]) => source);

    res.setHeader('Cache-Control', hidden
      ? 'private, no-store'
      : `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 4}`);
    res.status(200).json({
      success: true,
      source: 'v41_provenance_projection',
      chain_id: chainId,
      artwork_id: artworkId,
      roles: {
        creator_address: addressOrNull(artwork.creator),
        first_collector_address: firstCollectorAddress,
        current_owner_address: currentOwnerAddress
      },
      events: buildTimeline({
        artwork,
        auctions,
        endings,
        settlements,
        resaleHistory,
        activeListing
      }),
      complete: truncatedSources.length === 0,
      truncated_sources: truncatedSources
    });
  } catch (error) {
    sendError(res, error);
  }
}
