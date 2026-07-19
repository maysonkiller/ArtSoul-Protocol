// Phase A6 (issue #121, canon doc 05): compact preview cards stay
// creator-focused — Creator attribution only, preferring the creator's
// public nickname and falling back to the shortened wallet address.
// First Collector / Owner and the full timeline live on the artwork
// detail page, where each role stays an individually clickable profile
// link. Cards make no per-card profile/data requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'ui', 'components', 'artwork-card.js'), 'utf8');
const profile = fs.readFileSync(path.join(root, 'src', 'entries', 'profile.jsx'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'src', 'entries', 'artwork.jsx'), 'utf8');

const context = vm.createContext({ window: { addEventListener: () => {} } });
vm.runInContext(source, context, { filename: 'src/ui/components/artwork-card.js' });
const { creatorLabel } = context.window.ArtSoulArtworkCard;

const CREATOR = '0x1111111111111111111111111111111111111111';
const COLLECTOR = '0x2222222222222222222222222222222222222222';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.classList = { add: (...names) => { this.className = [this.className, ...names].filter(Boolean).join(' '); } };
  }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  remove() {}
  setAttribute() {}
  addEventListener() {}
}

function loadDomCardRuntime() {
  const document = { createElement: tag => new FakeElement(tag), querySelectorAll: () => [] };
  const window = { ArtSoulSecurity: { isValidStorageUrl: () => true }, addEventListener: () => {} };
  vm.runInNewContext(source, { window, document });
  return window.ArtSoulArtworkCard;
}

test('creator nickname from the projection is preferred over the address', () => {
  assert.equal(creatorLabel({ creator: CREATOR, creator_name: 'soulpainter' }), 'soulpainter');
});

test('a missing nickname falls back to the shortened wallet address', () => {
  assert.equal(creatorLabel({ creator: CREATOR }), '0x111111...111111');
  assert.equal(creatorLabel({ creator: CREATOR, creator_name: null }), '0x111111...111111');
});

test('a valid creator address never renders as Unknown creator', () => {
  assert.notEqual(creatorLabel({ creator: CREATOR }), 'Unknown creator');
  assert.notEqual(creatorLabel({ creator_id: CREATOR }), 'Unknown creator');
});

test('compact cards render Creator only — no First Collector or Owner lines', () => {
  const api = loadDomCardRuntime();
  const card = api.createCardElement({
    id: 'v41:84532:7',
    title: 'Minted',
    file_url: 'image.jpg',
    file_type: 'image',
    creator: CREATOR,
    minted: true,
    token_id: '7',
    auction_winner_address: COLLECTOR,
    current_owner_address: COLLECTOR
  });
  const body = card.children[1];
  const texts = body.children.map(child => child.textContent || '');
  assert.equal(texts.some(text => /First Collector|Owner/.test(text)), false);
  assert.equal(body.children[1].textContent, `Creator: 0x111111...111111`);
  // The shared component itself carries no First Collector / Owner labels.
  assert.doesNotMatch(source, /First Collector|'Owner'|"Owner"|Owner: /);
});

test('pre-mint and minted cards keep identical compact body structure', () => {
  const api = loadDomCardRuntime();
  const base = { file_url: 'image.jpg', file_type: 'image', creator: CREATOR };
  const preMint = api.createCardElement({ ...base, id: 'a', title: 'A', status: 'registered' });
  const minted = api.createCardElement({
    ...base, id: 'b', title: 'B', minted: true, token_id: '7',
    auction_winner_address: COLLECTOR, current_owner_address: COLLECTOR
  });
  // Same rows (title, creator, meta) in both states — no state-dependent
  // extra lines, so compact card dimensions stay consistent.
  assert.equal(preMint.children[1].children.length, 3);
  assert.equal(minted.children[1].children.length, 3);
  assert.deepEqual(
    preMint.children[1].children.map(child => child.className),
    minted.children[1].children.map(child => child.className)
  );
});

test('the card component makes no profile, storage, or network requests', () => {
  assert.doesNotMatch(source, /connectedWallet|localStorage|sessionStorage|ArtSoulDB|fetch\(|XMLHttpRequest/);
});

test('cards stay single-link: no nested creator anchor inside the clickable card', () => {
  // The whole card is the anchor (or click target); the creator line is a
  // plain paragraph in both renderers.
  assert.match(source, /creator\.className = 'artsoul-card-creator'/);
  assert.match(source, /h\('p', \{ className: 'artsoul-card-creator' \}/);
  assert.doesNotMatch(source, /createElement\('a'[^)]*creator|profile\.html/i);
});

test('profile cards reuse the shared creator attribution without new requests', () => {
  assert.match(profile, /creatorLabel = sharedCards\?\.creatorLabel/);
  assert.match(profile, /Creator: \{creatorLabel\(artwork\)\}/);
});

test('detail page keeps the three roles as individually clickable profile links', () => {
  const role = detail.slice(
    detail.indexOf('function renderOwnershipRole'),
    detail.indexOf('artwork-ownership-row') + 2000
  );
  assert.match(role, /href=\{`profile\.html\?address=\$\{encodeURIComponent\(address\)\}`\}/);
  const panel = detail.slice(
    detail.indexOf('{/* Ownership Info - Three Roles */}'),
    detail.indexOf('artwork-ownership-actions')
  );
  assert.match(panel, /label: 'Creator'/);
  assert.match(panel, /label: 'First Collector'/);
  assert.match(panel, /label: 'Owner'/);
  // Owner is not duplicated when it equals the First Collector.
  assert.match(panel, /!isSameAddress\(ownerAddress, artwork\.auction_winner_address\)/);
});
