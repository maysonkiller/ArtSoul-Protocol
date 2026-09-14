// B-10: a creator who bought their work back was shown as not owning it.
//
// Found 2026-09-14 on production while checking the resale step of the B-02
// journey. Artwork 1: settled to a first collector, then resold to its own
// creator. The provenance timeline said "Resale completed - Owner" the creator.
// The Ownership panel above it said Creator and First Collector, with no Owner
// row, which reads as though the collector still holds the work. Two parts of
// one page disagreed about who owns it.
//
// The Owner row was suppressed whenever the owner was the creator. That is right
// before mint, when the creator holds the work by definition, and wrong after
// it, when the only way back to the creator is a completed resale.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'entries', 'artwork.jsx'), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  let depth = 0;
  let index = source.indexOf('{', source.indexOf(')', start));
  for (; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(start, index + 1);
}

const sandbox = vm.createContext({ exported: {}, String, Boolean });
vm.runInContext([
  "const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';",
  extractFunction('isZeroAddress'),
  extractFunction('isSameAddress'),
  extractFunction('shouldShowOwnerRole'),
  'exported.show = shouldShowOwnerRole;'
].join('\n'), sandbox, { filename: 'artwork.jsx (extracted)' });
const show = sandbox.exported.show;

const CREATOR = '0xE6d6000000000000000000000000000000Eb215';
const COLLECTOR = '0x2C5e000000000000000000000000000000004591';
const BUYER = '0x7777000000000000000000000000000000007777';
const ZERO = '0x0000000000000000000000000000000000000000';

const minted = (ownerAddress) => ({
  ownerAddress,
  creatorAddress: CREATOR,
  firstCollectorAddress: COLLECTOR,
  winnerAddress: COLLECTOR,
  minted: true,
  awaitingPayment: false
});

test('a creator who bought the work back is shown as its owner', () => {
  // Artwork 1 on the public testnet. The row that was missing.
  assert.equal(show(minted(CREATOR)), true);
  // Address case must not decide it.
  assert.equal(show(minted(CREATOR.toLowerCase())), true);
});

test('an owner who is still the first collector is not listed twice', () => {
  // Artworks 13, 18, 19 and 32. "First Collector" already says who holds it.
  assert.equal(show(minted(COLLECTOR)), false);
});

test('a later buyer who is neither is shown', () => {
  assert.equal(show(minted(BUYER)), true);
});

test('before mint the creator holds the work and needs no second row', () => {
  assert.equal(show({ ...minted(CREATOR), minted: false }), false);
});

test('a winner awaiting payment is not yet an owner', () => {
  assert.equal(show({ ...minted(COLLECTOR), minted: false, awaitingPayment: true }), false);
});

test('no owner, or the zero address, shows nothing', () => {
  assert.equal(show(minted(null)), false);
  assert.equal(show(minted('')), false);
  assert.equal(show(minted(ZERO)), false);
});

test('the panel uses the predicate, and a buyback reads the same name twice', () => {
  assert.match(source, /\{shouldShowOwnerRole\(\{/);
  // The old inline rule that caused it must not come back.
  assert.doesNotMatch(source, /!isSameAddress\(ownerAddress, creatorAddress\) &&\s*\n\s*\(!mintedArtwork/);
  assert.match(source, /currentOwnerProfile \|\| \(isSameAddress\(ownerAddress, creatorAddress\) \? creatorProfile : null\)/);
});

test('the provenance timeline and the panel use the same word for the role', () => {
  // Canon 11 labels. The timeline already said Owner; the panel now can too.
  assert.match(source, /resale_completed: \{\s*title: 'Resale completed',\s*role: 'Owner'/);
  assert.match(source, /label: 'Owner',/);
});
