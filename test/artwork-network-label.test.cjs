// A-33: the artwork page printed the stored network key.
//
// Verified on production 2026-09-14 at 1440x900 and 375x812: the Artwork
// details list read "Network  sepolia" on one work and "Network  baseSepolia"
// on another. The first is a legacy Ethereum Sepolia record, which canon 13
// keeps readable but never active; a visitor reading "sepolia" has no way to
// know that, and "baseSepolia" is a database key rather than a network name.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'entries', 'artwork.jsx'), 'utf8');

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

const sandbox = vm.createContext({ exported: {} });
vm.runInContext(
  `${extractFunction('describeArtworkNetwork')}\nexported.describe = describeArtworkNetwork;`,
  sandbox,
  { filename: 'artwork.jsx (extracted)' }
);
const describe = sandbox.exported.describe;

test('the active testnet is named, not keyed', () => {
  assert.equal(describe({ chain_id: 84532, network: 'baseSepolia' }), 'Base Sepolia');
  assert.equal(describe({ chainId: 84532 }), 'Base Sepolia');
  // Older rows carry the key and no chain id.
  assert.equal(describe({ network: 'baseSepolia' }), 'Base Sepolia');
});

test('a legacy record says it is legacy and read-only', () => {
  // Canon 13: Ethereum Sepolia data stays readable and is never an active
  // write or selectable product network. Printing a bare "sepolia" told a
  // visitor the opposite of that by omission.
  for (const artwork of [{ chain_id: 11155111 }, { network: 'sepolia' }]) {
    const label = describe(artwork);
    assert.match(label, /Ethereum Sepolia/, JSON.stringify(artwork));
    assert.match(label, /legacy, read-only/, JSON.stringify(artwork));
  }
});

test('the chain id wins over a stale key', () => {
  // The projection and the stored key have disagreed before. Where the work
  // actually exists is the question the field answers.
  assert.equal(describe({ chain_id: 84532, network: 'sepolia' }), 'Base Sepolia');
  assert.equal(describe({ chain_id: 11155111, network: 'baseSepolia' }), 'Ethereum Sepolia (legacy, read-only)');
});

test('an unknown network is neither invented nor hidden behind a guess', () => {
  assert.equal(describe({ network: 'someFutureChain' }), 'someFutureChain');
  assert.equal(describe({}), '');
  assert.equal(describe(null), '');
});

test('the raw key no longer reaches the details list', () => {
  assert.doesNotMatch(source, /<dt>Network<\/dt><dd>\{artwork\.network\}<\/dd>/);
  assert.match(source, /\{describeArtworkNetwork\(artwork\)\}<\/dd>/);
});

test('the media type is capitalised by stylesheet, not by rewriting the value', () => {
  // The value is a record key used elsewhere for logic. Only its presentation
  // changes, and canon 16 keeps that in the stylesheet.
  assert.match(source, /className="artwork-detail-media-type"/);
  const css = fs.readFileSync(path.join(root, 'unified-styles.css'), 'utf8');
  assert.match(css, /\.artwork-detail-media-type \{\s*text-transform: capitalize;/);
});
