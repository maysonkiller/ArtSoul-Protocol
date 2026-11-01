import { allowMethods, sendError, supabaseRest, validateArtworkId } from '../../backend.js';
import { getModerationAccess } from '../../moderation-access.js';
import { readNftOwnershipBoundary, readNftHistory, recheckNftOwnership, readWithNftOwnershipRetry } from '../../nft-ownership.js';

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

function buildTimeline({ artwork, auctions, endings, settlements, resaleHistory, listingEvents, transfers = [] }) {
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

  // Current listing rows are mutable state, including eventless cancellation
  // reconciliation. Only immutable logs can describe historical price changes.
  for (const listing of listingEvents) {
    const data = listing.event_data || {};
    events.push({
      ...eventBase('resale_listed', listing),
      token_id: protocolId(data.tokenId),
      owner_address: addressOrNull(data.seller),
      price: weiToEth(data.price)
    });
  }

  for (const transfer of transfers) {
    events.push({ ...transfer, type: 'nft_transferred' });
  }
  return events.sort(projectionOrder);
}

function latestCompletedSettlement(settlements) {
  return settlements
    .filter(row => normalizeText(row.settlement_status).toLowerCase() === 'completed')
    .sort(projectionOrder)[0] || null;
}

function verifiedTimeline(history) {
  const rows = name => history.lifecycle.filter(row => row.event_name === name);
  const registration = history.lifecycle[0];
  return buildTimeline({
    artwork: { ...registration, creator: registration.event_data.creator },
    auctions: rows('AuctionCreated').map(row => ({ ...row, auction_id: row.event_data.auctionId,
      creator: row.event_data.creator, start_price: row.event_data.startPrice, duration: row.event_data.duration })),
    endings: rows('AuctionEnded').map(row => ({ ...row, auction_id: row.event_data.auctionId,
      winner: row.event_data.winner, winning_bid: row.event_data.winningBid,
      settlement_deadline: toNumber(row.event_data.settlementDeadline) > 0
        ? new Date(toNumber(row.event_data.settlementDeadline) * 1000).toISOString() : null })),
    settlements: history.lifecycle.filter(row => ['SettlementCompleted', 'SettlementDefaulted'].includes(row.event_name))
      .map(row => ({ ...row, auction_id: row.event_data.auctionId, winner: row.event_data.winner,
        token_id: row.event_data.tokenId, final_price: row.event_data.finalPrice,
        settlement_status: row.event_name === 'SettlementCompleted' ? 'completed' : 'defaulted' })),
    resaleHistory: rows('ResaleCompleted').map(row => ({ ...row, token_id: row.event_data.tokenId,
      seller: row.event_data.seller, buyer: row.event_data.buyer, price: row.event_data.price })),
    listingEvents: rows('ResaleListed'),
    transfers: history.transfers
  });
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
    const response = await readWithNftOwnershipRetry(async () => {
    const chainId = Number(req.query?.chain_id);
    const artworkId = protocolId(validateArtworkId(req.query?.artwork_id));
    if (!PUBLIC_CHAIN_IDS.has(chainId) || !artworkId) {
      return { statusCode: 400, body: { error: 'INVALID_ARTWORK_LOOKUP' } };
    }

    const chainFilter = `eq.${chainId}`;
    const artworkFilter = `eq.${artworkId}`;
    const ownershipBoundary = chainId === 84532 ? await readNftOwnershipBoundary() : null;
    const [artworkRows, moderationRows] = await Promise.all([
      readRows(
        'v41_artworks?select=chain_id,artwork_id::text,creator,minted,token_id::text,block_number,transaction_hash,log_index,indexed_at' +
        `&chain_id=${chainFilter}&artwork_id=${artworkFilter}&limit=1`
      ),
      readRows(
        'artwork_moderation_visibility?select=hidden&' +
        `chain_id=${chainFilter}&artwork_id=${artworkFilter}&limit=1`
      )
    ]);

    const artwork = artworkRows[0] || null;
    if (!artwork) {
      return { statusCode: 404, body: { error: 'ARTWORK_NOT_FOUND' } };
    }

    const hidden = moderationRows[0]?.hidden === true;
    if (hidden) {
      const access = await getModerationAccess(req);
      if (!access.canModerate) {
        return { statusCode: 404, body: { error: 'ARTWORK_UNAVAILABLE' } };
      }
    }

    const history = ownershipBoundary ? await readNftHistory(artwork, ownershipBoundary) : null;
    const proof = history?.rows[0];
    if (history && (!history.lifecycle_available || (artwork.minted && !proof?.verified))) {
      throw Object.assign(new Error('Ownership history is temporarily unavailable. Please retry.'), { code: 'NFT_OWNERSHIP_UNAVAILABLE', statusCode: 503 });
    }
    if (history) {
      const truncatedSources = [];
      if (!history.lifecycle_complete) truncatedSources.push('lifecycle');
      if (artwork.minted && !history.complete) truncatedSources.push('transfers');
      await recheckNftOwnership(history);
      return { statusCode: 200, cacheControl: 'private, no-store', body: {
        success: true, source: 'v41_provenance_projection', chain_id: chainId, artwork_id: artworkId,
        roles: { creator_address: addressOrNull(history.lifecycle[0].event_data.creator),
          first_collector_address: proof.first_collector_address, current_owner_address: proof.current_owner_address },
        events: verifiedTimeline(history), complete: truncatedSources.length === 0, truncated_sources: truncatedSources
      } };
    }
    const tokenId = protocolId(artwork.token_id);
    const auctionsPromise = readRows(
      'v41_auctions?select=chain_id,auction_id::text,artwork_id::text,creator,start_price,duration,block_number,transaction_hash,log_index,indexed_at' +
      `&chain_id=${chainFilter}&artwork_id=${artworkFilter}` +
      `&order=block_number.asc,log_index.asc&limit=${MAX_ROWS_PER_SOURCE}`
    );
    const endingsPromise = auctionsPromise.then(auctions => {
      const auctionIds = auctions.map(row => protocolId(row.auction_id)).filter(Boolean);
      return auctionIds.length > 0
        ? readRows(
            'v41_auction_endings?select=chain_id,auction_id::text,winner,winning_bid,settlement_deadline,block_number,transaction_hash,log_index,indexed_at' +
            `&chain_id=${chainFilter}&auction_id=in.(${auctionIds.join(',')})` +
            `&order=block_number.asc,log_index.asc&limit=${MAX_ROWS_PER_SOURCE}`
          )
        : [];
    });
    const [auctions, settlements, resaleHistory, listingRows, endings, listingEvents] = await Promise.all([
      auctionsPromise,
      readRows(
        'v41_settlements?select=chain_id,auction_id::text,artwork_id::text,winner,final_price,token_id::text,settlement_status,block_number,transaction_hash,log_index,indexed_at' +
        `&chain_id=${chainFilter}&artwork_id=${artworkFilter}` +
        `&order=block_number.asc,log_index.asc&limit=${MAX_ROWS_PER_SOURCE}`
      ),
      tokenId
        ? readRows(
            'v41_resale_history?select=chain_id,token_id::text,seller,buyer,price,block_number,transaction_hash,log_index,indexed_at' +
            `&chain_id=${chainFilter}&token_id=eq.${tokenId}` +
            `&order=block_number.asc,log_index.asc&limit=${MAX_ROWS_PER_SOURCE}`
          )
        : [],
      tokenId
        ? readRows(
            'v41_resale_listings?select=chain_id,token_id::text,seller,price,active,block_number,transaction_hash,log_index,indexed_at' +
            `&chain_id=${chainFilter}&token_id=eq.${tokenId}&active=eq.true&limit=1`
          )
        : [],
      endingsPromise,
      tokenId
        ? readRows(
            'contract_events?select=chain_id,event_name,event_data,block_number,transaction_hash,log_index,indexed_at' +
            `&chain_id=${chainFilter}&event_name=eq.ResaleListed&event_data->>tokenId=eq.${tokenId}` +
            `&order=block_number.asc,log_index.asc&limit=${MAX_ROWS_PER_SOURCE}`
          )
        : []
    ]);

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
      resales: resaleHistory.length,
      listings: listingEvents.length
    };
    const truncatedSources = Object.entries(sourceCounts)
      .filter(([, count]) => count >= MAX_ROWS_PER_SOURCE)
      .map(([source]) => source);
    if (chainId === 84532) await recheckNftOwnership(ownershipBoundary);

    const cacheControl = hidden
      ? 'private, no-store'
      : `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 4}`;
    return { statusCode: 200, cacheControl, body: {
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
        listingEvents
      }),
      complete: truncatedSources.length === 0,
      truncated_sources: truncatedSources
    } };
    });
    if (response.cacheControl) res.setHeader('Cache-Control', response.cacheControl);
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    res.setHeader('Cache-Control', 'private, no-store');
    sendError(res, error);
  }
}
