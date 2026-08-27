// A-77: an auction that ends with no bids must release the artwork.
//
// Reproduced on production. Artwork 31 ran an auction, nobody bid, the creator
// finalized it, and the public projection then answered:
//
//   status "defaulted", active_auction_id "31", minted false, winner null
//
// On chain `ArtSoulCore.endAuction` had already set Artwork.activeAuctionId
// back to 0 for that path, and `createAuction` asks only for an unminted work
// with `activeAuctionId == 0` - so the contract was ready to auction it again
// while every surface reading the projection believed an auction was still
// running. Twelve artworks were in that state.
//
// The cause: AuctionEnded is the terminal event for a no-bid auction. No
// settlement and no default follow it, and those two handlers were the only
// ones that ever cleared active_auction_id.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const CHAIN_ID = 84532;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const WINNER = '0x2222222222222222222222222222222222222222';

const syncEngineModule = import(pathToFileURL(path.join(ROOT, 'src/indexer/sync-engine.js')).href);

// Records every statement the handler issues, and answers the one SELECT it
// makes. Nothing else about the engine is stubbed: the statements asserted
// below are the statements production runs.
function createClient({ artworkId = '31' } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/SELECT artwork_id FROM v41_auctions/.test(sql)) {
        return { rows: artworkId === null ? [] : [{ artwork_id: artworkId }] };
      }
      return { rows: [], rowCount: 0 };
    },
    artworkUpdates() {
      return queries.filter(entry => /UPDATE v41_artworks/.test(entry.sql));
    }
  };
}

async function endAuction({ winner, auctionId = '31', artworkId = '31' }) {
  const { default: IndexerSyncEngine } = await syncEngineModule;
  const engine = new IndexerSyncEngine(null, { chainId: CHAIN_ID }, null);
  const client = createClient({ artworkId });
  const event = {
    eventName: 'AuctionEnded',
    eventData: { auctionId, winner, winningBid: '0', settlementDeadline: 0 },
    blockNumber: 43812345,
    transactionHash: '0xabc',
    logIndex: 4,
    timestamp: 1787846260000
  };

  await engine._handleAuctionEndedTx(event, client);
  return client;
}

test('a no-bid ending clears the artwork projection so it can be auctioned again', async () => {
  const client = await endAuction({ winner: ZERO_ADDRESS });

  const updates = client.artworkUpdates();
  assert.equal(updates.length, 1, 'the artwork must be released exactly once');
  assert.match(updates[0].sql, /active_auction_id = NULL/);
  assert.equal(updates[0].params.includes('31'), true, 'the artwork id must be bound');

  // The auction row still records the ending itself.
  const auctionUpdate = client.queries.find(entry => /UPDATE v41_auctions/.test(entry.sql));
  assert.ok(auctionUpdate, 'the auction status must still be written');
  assert.equal(auctionUpdate.params[0], 'defaulted_no_bids');
});

test('the release is scoped to this auction so a replay cannot erase a newer one', async () => {
  // Events are reprocessed by design. By the time an old AuctionEnded is
  // replayed the creator may already have started a fresh auction, and an
  // unconditional clear would delete that live auction from the projection.
  const client = await endAuction({ winner: ZERO_ADDRESS });
  const update = client.artworkUpdates()[0];

  assert.match(update.sql, /AND active_auction_id = \$5/);
  assert.equal(update.params[4], '31', 'the guard must bind the auction being ended');
});

test('an ending with a winner leaves the artwork alone', async () => {
  // Here settlement or a winner default follows and owns the release. Clearing
  // it now would show the work as free while its winner can still settle.
  const client = await endAuction({ winner: WINNER });

  assert.deepEqual(client.artworkUpdates(), []);
  const auctionUpdate = client.queries.find(entry => /UPDATE v41_auctions/.test(entry.sql));
  assert.equal(auctionUpdate.params[0], 'settlement_pending');
  assert.equal(auctionUpdate.params[1], WINNER);
});

test('an auction with no projection row releases nothing instead of throwing', async () => {
  const client = await endAuction({ winner: ZERO_ADDRESS, artworkId: null });
  assert.deepEqual(client.artworkUpdates(), []);
});

test('the ending is still recorded before the artwork is released', async () => {
  // Order matters for a reader that observes the transaction mid-flight: the
  // auction must never look finished while the artwork still looks occupied by
  // it, which is exactly the state this defect left behind permanently.
  const client = await endAuction({ winner: ZERO_ADDRESS });
  const statements = client.queries.map(entry => entry.sql);
  const auctionIndex = statements.findIndex(sql => /UPDATE v41_auctions/.test(sql));
  const artworkIndex = statements.findIndex(sql => /UPDATE v41_artworks/.test(sql));

  assert.ok(auctionIndex >= 0 && artworkIndex >= 0);
  assert.ok(auctionIndex < artworkIndex, 'the auction ending is written first');
});
