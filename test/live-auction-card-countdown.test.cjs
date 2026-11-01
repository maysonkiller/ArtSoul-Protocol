const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'ui', 'components', 'artwork-card.js'), 'utf8');
const profile = fs.readFileSync(path.join(root, 'src', 'entries', 'profile.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'unified-styles.css'), 'utf8');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.className = '';
    this.isConnected = false;
    this.classList = {
      add: (...names) => {
        this.className = [this.className, ...names].filter(Boolean).join(' ');
      }
    };
  }

  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  remove() {}
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener() {}
}

function loadRuntime() {
  const intervals = [];
  const cleared = [];
  const clock = { now: Date.now() };
  class FakeDate extends Date {
    static now() { return clock.now; }
  }
  const document = {
    createElement: tag => new FakeElement(tag),
    querySelectorAll: () => []
  };
  const window = {
    ArtSoulSecurity: { isValidStorageUrl: () => true },
    addEventListener: () => {},
    setInterval: callback => {
      intervals.push(callback);
      return intervals.length;
    },
    clearInterval: id => cleared.push(id)
  };
  // The page loads the artwork URL owner before the card script; the harness
  // must do the same or the card builds a different URL shape than the product.
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'artwork-url.js'), 'utf8'),
    { window, document, Date: FakeDate }
  );
  vm.runInNewContext(source, { window, document, Date: FakeDate });
  return { api: window.ArtSoulArtworkCard, intervals, cleared, clock, window };
}

test('countdown formatting is compact, deterministic, and never negative', () => {
  const { api } = loadRuntime();
  const now = Date.UTC(2026, 6, 20, 12, 0, 0);

  assert.equal(api.formatAuctionCountdown(now + 2 * 86400000 + 3 * 3600000, now), '2d 03h');
  assert.equal(api.formatAuctionCountdown(now + 5 * 3600000 + 7 * 60000, now), '5h 07m');
  assert.equal(api.formatAuctionCountdown(now + 4 * 60000 + 9 * 1000, now), '4m 09s');
  assert.equal(api.formatAuctionCountdown(now, now), 'Ended');
  assert.equal(api.formatAuctionCountdown(now - 1000, now), 'Ended');
});

test('only an active unminted auction with a future end receives a countdown', () => {
  const { api, clock } = loadRuntime();
  const future = clock.now + 60000;

  assert.equal(api.countdownInfo({ auction_id: '1', auction_end_time: future }).label, '1m 00s');
  assert.equal(api.countdownInfo({ status: 'registered', auction_end_time: future }), null);
  assert.equal(api.countdownInfo({ auction_id: '1', auction_end_time: future, minted: true }), null);
  assert.equal(api.countdownInfo({ auction_id: '1', auction_end_time: clock.now - 1000 }), null);
  assert.equal(api.countdownInfo({ auction_id: '1' }), null);
});

test('DOM cards share one timer and keep their compact body structure', () => {
  const { api, intervals, cleared, clock } = loadRuntime();
  const future = clock.now + 60000;
  const artwork = {
    file_url: 'image.jpg',
    file_type: 'image',
    creator: '0x1111111111111111111111111111111111111111',
    auction_id: '7',
    auction_end_time: future
  };

  const first = api.createCardElement({ ...artwork, id: 'first' });
  const second = api.createCardElement({ ...artwork, id: 'second' });

  assert.equal(intervals.length, 1, 'all cards must reuse one interval');
  assert.equal(first.children[1].className, 'artsoul-card-body');
  assert.equal(first.children[1].children.length, 3);
  assert.equal(first.children[2].className, 'artsoul-card-menu');
  const firstTimer = first.children.find(child => child.className === 'artsoul-card-countdown');
  const secondTimer = second.children.find(child => child.className === 'artsoul-card-countdown');
  assert.equal(firstTimer.attributes.role, 'timer');
  assert.equal(firstTimer.attributes['aria-live'], 'off');
  assert.equal(firstTimer.textContent, '1m 00s', 'detached cards already contain their countdown before insertion');
  assert.equal(firstTimer.attributes['aria-label'], 'Auction ends in 1m 00s');
  assert.equal(secondTimer.textContent, '1m 00s');
  const openingChip = first.children.find(child => String(child.className).startsWith('artsoul-card-preview-badge'));
  assert.equal(openingChip.textContent, 'Auction open', 'open auction category uses the same live state');

  firstTimer.isConnected = true;
  secondTimer.isConnected = true;
  clock.now += 1000;
  intervals[0]();
  assert.equal(firstTimer.textContent, '0m 59s');

  clock.now = future + 1;
  intervals[0]();
  assert.equal(firstTimer.textContent, 'Ended');
  assert.equal(secondTimer.textContent, 'Ended');
  assert.match(firstTimer.className, /is-ended/);
  const firstBadge = first.children[1].children[2].children[0];
  assert.equal(firstBadge.textContent, 'No bids', 'expiry must update the status as well as the timer');
  assert.equal(firstBadge.className, 'artsoul-card-status artsoul-card-status-ended_no_bids');
  assert.equal(openingChip.textContent, 'No bids', 'expired category must never remain Auction open');
  const firstLink = first.children.find(child => child.className === 'artsoul-card-link');
  assert.match(firstLink.title, /Status: No bids/);
  assert.doesNotMatch(firstLink.attributes['aria-label'], /Live/);
  assert.deepEqual(cleared, [1]);
});

test('expiry with a bid changes the card status and a replacement round starts live', () => {
  const { api, intervals, clock } = loadRuntime();
  const artwork = { id: '34', file_url: 'image.jpg', file_type: 'image', auction_id: '66',
    auction_end_time: clock.now + 1000, current_bid: '0.011', current_bidder: `0x${'1'.repeat(40)}` };
  const previous = api.createCardElement(artwork);
  const timer = previous.children.find(child => child.className === 'artsoul-card-countdown');
  timer.isConnected = true;
  clock.now += 1000;
  intervals[0]();
  assert.equal(timer.textContent, 'Ended');
  assert.equal(previous.children[1].children[2].children[0].textContent, 'Awaiting payment');
  assert.equal(previous.children.find(child => String(child.className).startsWith('artsoul-card-preview-badge')).textContent, 'Awaiting payment');

  const replacement = api.createCardElement({ ...artwork, auction_id: '67', auction_end_time: clock.now + 86400000,
    current_bid: '0', current_bidder: '' });
  assert.equal(replacement.children[1].children[2].children[0].textContent, 'Live');
  assert.equal(replacement.children.find(child => child.className === 'artsoul-card-countdown').textContent, '1d 00h');
});

test('removed DOM countdowns stop updating and release their shared interval', () => {
  const { api, intervals, cleared, clock } = loadRuntime();
  const card = api.createCardElement({
    id: 'removed', file_url: 'image.jpg', file_type: 'image',
    auction_id: '7', auction_end_time: clock.now + 60000
  });
  const timer = card.children.find(child => child.className === 'artsoul-card-countdown');
  timer.isConnected = true;
  intervals[0]();
  timer.isConnected = false;
  clock.now += 1000;
  intervals[0]();
  assert.equal(timer.textContent, '1m 00s', 'detachment still prevents background writes');
  assert.deepEqual(cleared, [1]);
});

test('shared React countdown is used by both common and profile cards', () => {
  assert.match(source, /function ReactCountdown\(\{ artwork = \{\}, onEnd = null \}\)/);
  assert.match(source, /h\(ReactCountdown, \{ artwork, onEnd: refreshAuctionState \}\)/);
  assert.match(source, /ReactCountdown,/);
  assert.match(profile, /SharedCard = window.ArtSoulArtworkCard\?\.ReactCard/);
  assert.match(profile, /<SharedCard\s+artwork=\{artwork\}/);
});

test('status and countdown use the same supplied clock at the deadline boundary', () => {
  const { api, clock } = loadRuntime();
  const artwork = { auction_id: '66', auction_end_time: clock.now + 1000 };
  assert.equal(api.statusInfo(artwork, clock.now).label, 'Live');
  assert.equal(api.countdownInfo(artwork, clock.now).label, '0m 01s');
  assert.equal(api.statusInfo(artwork, clock.now + 1000).label, 'No bids');
  assert.equal(api.countdownInfo(artwork, clock.now + 1000), null);
});

test('React countdown retires the previous round and refreshes its card once at the new expiry', () => {
  const { api, window, intervals, cleared, clock } = loadRuntime();
  let initialized = false, value, dependencies, cleanup, effect;
  window.React = {
    createElement: (tag, props, text) => ({ tag, props, text }),
    useState(initial) {
      if (!initialized) { value = initial(); initialized = true; }
      return [value, next => { value = next; }];
    },
    useEffect(callback, next) {
      if (!dependencies || next.some((item, index) => item !== dependencies[index])) {
        dependencies = next; effect = callback;
      }
    }
  };
  const endedAt = [];
  const onEnd = now => endedAt.push(now);
  const render = artwork => {
    const result = api.ReactCountdown({ artwork, onEnd });
    if (effect) { cleanup?.(); cleanup = effect(); effect = undefined; }
    return result;
  };
  const previous = { auction_id: '66', auction_end_time: clock.now + 1000 };
  assert.equal(render(previous).text, '0m 01s');
  clock.now += 500;
  const replacement = { auction_id: '67', auction_end_time: clock.now + 10000 };
  assert.equal(render(replacement), null, 'an old timer must not paint during a round change');
  assert.equal(render(replacement).text, '0m 10s');
  clock.now += 1000;
  intervals.at(-1)();
  assert.deepEqual(endedAt, [], 'the superseded round must not expire the replacement');
  assert.equal(render(replacement).text, '0m 09s');
  clock.now = replacement.auction_end_time;
  intervals.at(-1)();
  assert.equal(render(replacement).text, 'Ended');
  assert.deepEqual(endedAt, [clock.now]);
  intervals.at(-1)();
  assert.deepEqual(endedAt, [clock.now], 'the expiry callback runs once');
  cleanup?.();
  assert.deepEqual(cleared, [1, 2]);
});

test('countdown is a height-neutral theme-safe media overlay', () => {
  const cardRule = css.match(/\.artsoul-artwork-card\s*\{[\s\S]*?\n\}/)?.[0] || '';
  const countdownRule = css.match(/\.artsoul-card-countdown\s*\{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(cardRule, /position:\s*relative/);
  assert.match(countdownRule, /position:\s*absolute/);
  assert.match(countdownRule, /top:\s*10px/);
  assert.match(countdownRule, /right:\s*10px/);
  assert.match(countdownRule, /font-variant-numeric:\s*tabular-nums/);
  assert.match(countdownRule, /var\(--c-/);
  assert.doesNotMatch(countdownRule, /animation|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(countdownRule, /fetch|XMLHttpRequest|rpc/i);
});

test('countdown implementation performs no API or RPC request', () => {
  const countdownSource = source.slice(
    source.indexOf('function auctionEndTimestamp'),
    source.indexOf('function discoveryStatusInfo')
  );
  assert.doesNotMatch(countdownSource, /fetch\(|XMLHttpRequest|eth_|request\(|ArtSoulDB/i);
  assert.equal((countdownSource.match(/countdownTimerId = window\.setInterval/g) || []).length, 1);
});
