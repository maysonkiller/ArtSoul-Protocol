import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleAuctionExpiry } from '../src/features/auction/use-auction-expiry.js';

test('list expiry schedules only the next boundary and replaces timers when the corpus changes', t => {
    const now = Date.UTC(2026, 10, 19);
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
    const clock = [];
    const artwork = offset => ({status: 'auction', end: now + offset});
    const corpus = [artwork(1500), artwork(1000), artwork(1000), {status: 'sold', end: now + 200}];
    globalThis.window = { ArtSoulArtworkCard: { auctionEndTimestamp: row => row.end }, setTimeout, clearTimeout };
    t.after(() => { delete globalThis.window; });

    const cancel = scheduleAuctionExpiry(corpus, now, value => clock.push(value));
    t.mock.timers.tick(999);
    assert.deepEqual(clock, []);
    t.mock.timers.tick(1);
    assert.deepEqual(clock, [now + 1000]);
    cancel();

    const replaced = scheduleAuctionExpiry(corpus, clock[0], value => clock.push(value));
    replaced();
    const extended = [artwork(2000)];
    scheduleAuctionExpiry(extended, clock[0], value => clock.push(value));
    t.mock.timers.tick(500);
    assert.deepEqual(clock, [now + 1000]);
    t.mock.timers.tick(500);
    assert.deepEqual(clock, [now + 1000, now + 2000]);
    assert.equal(scheduleAuctionExpiry(extended, clock.at(-1), () => assert.fail()), undefined);
});
