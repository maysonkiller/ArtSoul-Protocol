import { allowMethods, sendError, supabaseRest } from '../../backend.js';

const PUBLIC_CHAIN_IDS = new Set([84532, 11155111]);
const AUCTION_COLUMNS = 'chain_id,auction_id,artwork_id,status,start_price,end_time,current_bid,current_bidder,winner,winning_bid,settlement_deadline';
const BID_COLUMNS = 'chain_id,auction_id,artwork_id,bidder,bid_amount,block_number,log_index,transaction_hash,indexed_at';
const MAX_BIDS = 100;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function toNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function protocolId(value) {
  const text = normalizeText(value);
  return text && text !== '0' ? text : '';
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

function projectionStatus(auction) {
  const status = normalizeText(auction?.status).toLowerCase();
  if (status === 'active') {
    const endTimeMs = timestampMs(auction.end_time);
    return endTimeMs > 0 && endTimeMs <= Date.now() ? 'awaiting_end' : 'auction';
  }
  if (status === 'settlement_pending') return 'settlement_pending';
  if (status === 'defaulted' || status === 'defaulted_no_bids') return 'defaulted';
  if (status === 'settled') return 'sold';
  return status || 'registered';
}

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const query = req.query || {};
    const chainId = Number(query.chain_id);
    const auctionId = protocolId(query.auction_id);
    if (!PUBLIC_CHAIN_IDS.has(chainId) || !/^\d{1,78}$/.test(auctionId)) {
      return res.status(400).json({ error: 'INVALID_AUCTION_LOOKUP' });
    }

    const afterBlock = Number(query.after_block);
    const afterLog = Number(query.after_log);
    const hasCursor = Number.isSafeInteger(afterBlock) && afterBlock >= 0;
    const cursorLog = Number.isSafeInteger(afterLog) && afterLog >= 0 ? afterLog : 0;

    let bidQuery = `v41_bids?select=${BID_COLUMNS}&chain_id=eq.${chainId}&auction_id=eq.${auctionId}` +
      `&order=block_number.desc,log_index.desc&limit=${MAX_BIDS}`;
    if (hasCursor) {
      bidQuery += `&or=(block_number.gt.${afterBlock},and(block_number.eq.${afterBlock},log_index.gt.${cursorLog}))`;
    }

    const [auctionRows, bidRows] = await Promise.all([
      supabaseRest(`v41_auctions?select=${AUCTION_COLUMNS}&chain_id=eq.${chainId}&auction_id=eq.${auctionId}&limit=1`),
      supabaseRest(bidQuery)
    ]);

    const auctionRow = auctionRows?.[0] || null;
    const currentBid = auctionRow?.current_bid || auctionRow?.winning_bid || 0;
    const auction = auctionRow
      ? {
          auction_id: protocolId(auctionRow.auction_id),
          artwork_id: protocolId(auctionRow.artwork_id),
          chain_id: chainId,
          status: projectionStatus(auctionRow),
          auction_end_time: auctionRow.end_time || null,
          settlement_deadline: timestampSeconds(auctionRow.settlement_deadline),
          current_bid: weiToEth(currentBid),
          highest_bid: weiToEth(currentBid),
          start_price: weiToEth(auctionRow.start_price),
          current_bidder: auctionRow.current_bidder || null,
          winner: auctionRow.winner || null
        }
      : null;

    const bids = (Array.isArray(bidRows) ? bidRows : []).map(bid => ({
      auction_id: protocolId(bid.auction_id),
      artwork_id: protocolId(bid.artwork_id),
      bidder: bid.bidder,
      bid_amount: weiToEth(bid.bid_amount),
      bid_amount_wei: normalizeText(bid.bid_amount),
      block_number: toNumber(bid.block_number),
      log_index: toNumber(bid.log_index),
      transaction_hash: normalizeText(bid.transaction_hash),
      indexed_at: bid.indexed_at || null
    }));

    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json({
      success: true,
      source: 'v41_auction_live',
      auction,
      bids,
      count: bids.length
    });
  } catch (error) {
    sendError(res, error);
  }
}
