import { allowMethods, sendError, supabaseRest } from '../../backend.js';

const PUBLIC_CHAIN_IDS = [84532, 11155111];
const CHAIN_FILTER = `in.(${PUBLIC_CHAIN_IDS.join(',')})`;
const TABLES = [
  'contract_events',
  'v41_artworks',
  'v41_auctions',
  'v41_bids',
  'v41_settlements',
  'v41_resale_listings'
];

function toNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function chainKey(value) {
  return String(toNumber(value));
}

async function query(path, warnings) {
  try {
    return await supabaseRest(path) || [];
  } catch (error) {
    warnings.push({
      source: path.split('?')[0],
      code: error.code || 'QUERY_FAILED'
    });
    return [];
  }
}

function countByChain(rows = []) {
  return rows.reduce((counts, row) => {
    const key = chainKey(row.chain_id);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function latestByChain(rows = []) {
  const latest = {};
  for (const row of rows) {
    const key = chainKey(row.chain_id);
    const current = latest[key];
    if (!current || toNumber(row.block_number) > toNumber(current.block_number)) {
      latest[key] = row;
    }
  }
  return latest;
}

// B-03: `lag_to_observed_block` measures the projection against its own newest
// row, so it reads 0 exactly when the indexer has stopped writing - nothing new
// arrives, nothing is behind anything, and a dead indexer looks perfectly
// healthy. The legacy chain has reported `lag: 0, stale_projection: false`
// since it was stopped in June.
//
// Liveness has to be measured against the clock instead. `last_indexed_at`
// advances on every processed block range rather than only when events are
// found, so a quiet chain still keeps it fresh; the poll interval is 15s.
const LIVENESS = Object.freeze({
  // Eight missed poll cycles, which also absorbs the 60s edge cache on this
  // response. Anything inside this is a normal indexer.
  HEALTHY_MAX_SECONDS: 120,
  // Ten minutes with no processed range is not a slow block. Something is
  // wrong and somebody should look.
  DEGRADED_MAX_SECONDS: 600
});

// A chain the project stopped on purpose is not an incident. Ethereum Sepolia
// is read-only legacy under canon 13 and its indexer is meant to be off.
function describeLiveness(state, nowMs) {
  const stoppedByDesign = String(state.status || '') === 'stopped';
  const lastIndexedAt = state.last_indexed_at ? Date.parse(state.last_indexed_at) : NaN;
  const ageSeconds = Number.isFinite(lastIndexedAt)
    ? Math.max(0, Math.round((nowMs - lastIndexedAt) / 1000))
    : null;

  let liveness;
  if (stoppedByDesign) liveness = 'stopped_by_design';
  else if (ageSeconds === null) liveness = 'unknown';
  else if (ageSeconds <= LIVENESS.HEALTHY_MAX_SECONDS) liveness = 'healthy';
  else if (ageSeconds <= LIVENESS.DEGRADED_MAX_SECONDS) liveness = 'degraded';
  else liveness = 'stalled';

  return {
    liveness,
    seconds_since_last_indexed: ageSeconds,
    // Stated in the response so a reader is not comparing against a number they
    // had to find in the source, and so the runbook cannot drift from the code.
    healthy_within_seconds: LIVENESS.HEALTHY_MAX_SECONDS,
    degraded_within_seconds: LIVENESS.DEGRADED_MAX_SECONDS,
    // This response is edge-cached, so an age can be up to this much older than
    // the truth.
    response_max_age_seconds: 60
  };
}

function summarizeLatest(row) {
  if (!row) return null;
  return {
    block_number: toNumber(row.block_number),
    event_name: row.event_name || null,
    artwork_id: row.artwork_id || null,
    auction_id: row.auction_id || null,
    transaction_hash: row.transaction_hash || null,
    indexed_at: row.indexed_at || row.last_updated_at || null
  };
}

function buildChainStatus(stateRows, tableRows, nowMs = Date.now()) {
  const stateByChain = Object.fromEntries(
    stateRows.map(row => [chainKey(row.chain_id), row])
  );
  const latestRows = Object.fromEntries(
    Object.entries(tableRows).map(([table, rows]) => [table, latestByChain(rows)])
  );
  const counts = Object.fromEntries(
    Object.entries(tableRows).map(([table, rows]) => [table, countByChain(rows)])
  );

  return PUBLIC_CHAIN_IDS.map(chainId => {
    const key = String(chainId);
    const state = stateByChain[key] || {};
    const latestObservedBlock = Math.max(
      toNumber(state.last_indexed_block),
      ...TABLES.map(table => toNumber(latestRows[table]?.[key]?.block_number))
    );
    const lastIndexedBlock = toNumber(state.last_indexed_block);
    const staleProjection = latestObservedBlock > lastIndexedBlock;

    return {
      chain_id: chainId,
      contract_address: state.contract_address || null,
      status: state.status || 'unknown',
      last_indexed_block: lastIndexedBlock,
      last_confirmed_block: toNumber(state.last_confirmed_block),
      confirmation_depth: toNumber(state.confirmation_depth),
      total_events_indexed: toNumber(state.total_events_indexed),
      last_indexed_at: state.last_indexed_at || null,
      ...describeLiveness(state, nowMs),
      latest_observed_block: latestObservedBlock,
      lag_to_observed_block: Math.max(0, latestObservedBlock - lastIndexedBlock),
      stale_projection: staleProjection,
      rows: TABLES.reduce((acc, table) => {
        acc[table] = counts[table]?.[key] || 0;
        return acc;
      }, {}),
      latest: TABLES.reduce((acc, table) => {
        acc[table] = summarizeLatest(latestRows[table]?.[key]);
        return acc;
      }, {})
    };
  });
}

export { LIVENESS, describeLiveness, buildChainStatus };

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const warnings = [];
    const stateRows = await query(
      `indexer_state?select=chain_id,contract_address,last_indexed_block,last_confirmed_block,confirmation_depth,total_events_indexed,last_indexed_at,status&chain_id=${CHAIN_FILTER}&order=chain_id.asc`,
      warnings
    );
    const tableRows = {
      contract_events: await query(
        `contract_events?select=chain_id,block_number,event_name,transaction_hash,indexed_at&chain_id=${CHAIN_FILTER}&order=block_number.desc&limit=200`,
        warnings
      ),
      v41_artworks: await query(
        `v41_artworks?select=chain_id,artwork_id,block_number,transaction_hash,indexed_at,last_updated_at&chain_id=${CHAIN_FILTER}&order=block_number.desc&limit=200`,
        warnings
      ),
      v41_auctions: await query(
        `v41_auctions?select=chain_id,auction_id,artwork_id,block_number,transaction_hash,indexed_at,last_updated_at&chain_id=${CHAIN_FILTER}&order=block_number.desc&limit=200`,
        warnings
      ),
      v41_bids: await query(
        `v41_bids?select=chain_id,block_number,transaction_hash,indexed_at&chain_id=${CHAIN_FILTER}&order=block_number.desc&limit=200`,
        warnings
      ),
      v41_settlements: await query(
        `v41_settlements?select=chain_id,auction_id,artwork_id,block_number,transaction_hash,indexed_at&chain_id=${CHAIN_FILTER}&order=block_number.desc&limit=200`,
        warnings
      ),
      v41_resale_listings: await query(
        `v41_resale_listings?select=chain_id,token_id,block_number,transaction_hash,indexed_at&chain_id=${CHAIN_FILTER}&order=block_number.desc&limit=200`,
        warnings
      )
    };

    const chains = buildChainStatus(stateRows, tableRows);
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=240');
    res.status(200).json({
      success: true,
      source: 'indexer_projection_status',
      chains,
      warnings
    });
  } catch (error) {
    sendError(res, error);
  }
}
