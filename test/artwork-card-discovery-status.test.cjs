const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({ window: {} });
vm.runInContext(
  fs.readFileSync('src/ui/components/artwork-card.js', 'utf8'),
  context,
  { filename: 'src/ui/components/artwork-card.js' }
);

const { discoveryStatusInfo } = context.window.ArtSoulArtworkCard;

test('discovery cards collapse lifecycle states into one minimal badge', () => {
  assert.deepEqual(
    { ...discoveryStatusInfo({ status: 'registered' }) },
    { key: 'art', label: 'Art' }
  );
  assert.deepEqual(
    { ...discoveryStatusInfo({ status: 'auction', active_auction_id: '1', auction_end_time: '2099-01-01T00:00:00Z' }) },
    { key: 'live', label: 'Live Auction' }
  );
  assert.deepEqual(
    { ...discoveryStatusInfo({ status: 'sold', minted: true, token_id: '1' }) },
    { key: 'minted', label: 'NFT' }
  );
  assert.deepEqual(
    { ...discoveryStatusInfo({ status: 'defaulted_no_bids' }) },
    { key: 'ended', label: 'Ended' }
  );
});
