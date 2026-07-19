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
  vm.runInNewContext(source, { window, document, Date: FakeDate });
  return { api: window.ArtSoulArtworkCard, intervals, cleared, clock };
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
  assert.equal(first.children[2].className, 'artsoul-card-countdown');
  assert.equal(first.children[2].attributes.role, 'timer');
  assert.equal(first.children[2].attributes['aria-live'], 'off');

  clock.now = future + 1;
  intervals[0]();
  assert.equal(first.children[2].textContent, 'Ended');
  assert.equal(second.children[2].textContent, 'Ended');
  assert.match(first.children[2].className, /is-ended/);
  assert.deepEqual(cleared, [1]);
});

test('shared React countdown is used by both common and profile cards', () => {
  assert.match(source, /function ReactCountdown\(\{ artwork = \{\} \}\)/);
  assert.match(source, /h\(ReactCountdown, \{ artwork \}\)/);
  assert.match(source, /ReactCountdown,/);
  assert.match(profile, /SharedCountdown = sharedCards\?\.ReactCountdown/);
  assert.match(profile, /<SharedCountdown artwork=\{artwork\} \/>/);
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
