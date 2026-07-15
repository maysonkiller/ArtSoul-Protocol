const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({ window: { addEventListener: () => {} } });
vm.runInContext(
  fs.readFileSync('src/ui/components/artwork-card.js', 'utf8'),
  context,
  { filename: 'src/ui/components/artwork-card.js' }
);

const { discoveryStatusInfo } = context.window.ArtSoulArtworkCard;

test('artwork detail uses the shared card status resolver', () => {
  const detail = fs.readFileSync('artwork.html', 'utf8') + fs.readFileSync('src/entries/artwork.jsx', 'utf8');
  assert.match(detail, /ArtSoulArtworkCard\?\.statusInfo\?\.\(auction \? \{/);
  assert.match(detail, /\{statusForState\.label\}/);
});

test('cards use one consistent human-readable label per lifecycle state', () => {
  assert.deepEqual(
    { ...discoveryStatusInfo({ status: 'registered' }) },
    { key: 'not_minted', label: 'Not yet minted' }
  );
  assert.deepEqual(
    { ...discoveryStatusInfo({ status: 'auction', active_auction_id: '1', auction_end_time: '2099-01-01T00:00:00Z' }) },
    { key: 'live', label: 'Live' }
  );
  assert.deepEqual(
    { ...discoveryStatusInfo({ status: 'sold', minted: true, token_id: '1' }) },
    { key: 'sold', label: 'Sold' }
  );
  assert.deepEqual(
    { ...discoveryStatusInfo({ status: 'defaulted_no_bids' }) },
    { key: 'ended_no_bids', label: 'No bids' }
  );
  assert.deepEqual(
    { ...discoveryStatusInfo({ status: 'awaiting_end', current_bid: '0' }) },
    { key: 'ended_no_bids', label: 'No bids' }
  );
  assert.deepEqual(
    { ...discoveryStatusInfo({ status: 'awaiting_end', current_bid: '1' }) },
    { key: 'awaiting_settlement', label: 'Awaiting payment' }
  );
  assert.deepEqual(
    { ...discoveryStatusInfo({ status: 'settlement_pending', current_bid: '1' }) },
    { key: 'awaiting_settlement', label: 'Awaiting payment' }
  );
  assert.deepEqual(
    { ...discoveryStatusInfo({ status: 'settlement_defaulted', current_bid: '1' }) },
    { key: 'unsettled', label: 'Unsettled' }
  );
  assert.deepEqual(
    { ...discoveryStatusInfo({
      status: 'for_sale',
      minted: true,
      token_id: '1',
      sale_price: '1.5'
    }) },
    { key: 'listed', label: 'For sale' }
  );
});
