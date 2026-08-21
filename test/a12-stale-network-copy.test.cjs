const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');

test('public and preview footers identify only the active testnet and canonical production chain', () => {
  for (const path of ['index.html', 'visual-lab.html']) {
    const source = read(path);
    assert.match(source, /Base Sepolia \(active testnet\)/, path);
    assert.match(source, /Base \(production chain\)/, path);
    assert.doesNotMatch(source, /Ethereum Sepolia \(testnet\)/, path);
    assert.doesNotMatch(source, /Future production networks/i, path);
  }

  assert.doesNotMatch(read('visual-lab.html'), /Rialo Future Network/i);
});

test('public documentation matches the Base-only network and Genesis trust canon', () => {
  const readme = read('README.md');
  const protocolDocs = read('src/entries/docs-protocol.jsx');

  assert.match(readme, /Base Sepolia is the only active product testnet/);
  assert.match(readme, /Base is the canonical production chain/);
  assert.doesNotMatch(readme, /Base Sepolia and Ethereum Sepolia may be used during testnet/);

  assert.match(protocolDocs, /Genesis 1\.3x/);
  assert.doesNotMatch(protocolDocs, /Genesis 2x/);
});

test('wallet-facing copy offers Base Sepolia only while legacy records remain read-only', () => {
  const accountMenu = read('avatar-dropdown.js');
  const contracts = read('contracts-integration.js');
  const checklist = read('docs/testnet/WALLET_QA_CHECKLIST.md');

  assert.match(accountMenu, /window\.AvatarDropdown\.selectNetwork\(84532, event\)/);
  assert.doesNotMatch(accountMenu, /<span class="network-option-name">ETH Sepolia<\/span>/);
  assert.doesNotMatch(accountMenu, /name: 'Rialo'/);
  assert.match(accountMenu, /if \(alreadyOnBaseSepolia\) return '';/);
  assert.match(accountMenu, /else if \(networkInfo\) \{[\s\S]*?role="status"/);

  assert.match(contracts, /Please switch to Base Sepolia/);
  assert.doesNotMatch(contracts, /Please switch to Base Sepolia[^`\n]*or Ethereum Sepolia/);

  assert.match(checklist, /Base Sepolia is the only active product testnet/);
  assert.match(checklist, /Historical Ethereum Sepolia artwork must remain readable while all write actions stay disabled/);
  assert.doesNotMatch(checklist, /Switch to Ethereum Sepolia from site/);
  assert.doesNotMatch(checklist, /Site-driven switch to Ethereum Sepolia works/);
});

test('all consumers receive the updated shared runtime assets', () => {
  const accountMenuPages = [
    'index.html',
    'gallery.html',
    'artwork.html',
    'profile.html',
    'upload.html',
    'admin.html',
    'docs-protocol.html'
  ];
  const contractPages = [
    'index.html',
    'gallery.html',
    'artwork.html',
    'profile.html',
    'upload.html'
  ];

  for (const path of accountMenuPages) {
    const source = read(path);
    assert.match(source, /header-prepaint\.js\?v=4/, path);
    assert.match(source, /avatar-dropdown\.js\?v=53/, path);
  }
  for (const path of contractPages) {
    assert.match(read(path), /contracts-integration\.js\?v=7/, path);
  }
});

test('A12 production acceptance is durable and reconciled across handoff and backlogs', () => {
  const acceptance = read('docs/testnet/A12_NETWORK_COPY_ACCEPTANCE.md');
  const canonBacklog = read('docs/canon/12_IMPLEMENTATION_BACKLOG.md');
  const durableBacklog = read('docs/BACKLOG.md');
  const handoff = read('docs/HANDOFF.md');

  assert.match(acceptance, /Accepted: 2026-07-28/);
  assert.match(acceptance, /a351d7da27d1f05679446f15bc2955dea61aa8f6/);
  assert.match(acceptance, /c1590016cdf983e82504f954c217febb97b43806/);
  assert.match(acceptance, /required no Supabase schema or data migration, no database backup, and no Hetzner restart/);

  assert.match(canonBacklog, /- \[x\] \*\*A12 — Remove stale network copy\.\*\* Accepted 2026-07-28/);
  assert.match(durableBacklog, /\| A-28 \|[^|]+\|[^|]+\| done \| A \|/);
  assert.match(durableBacklog, /\| A-44 \|[^|]+\|[^|]+\| done \| A \|/);
  assert.match(handoff, /Production code baseline: `main` includes `f4297ce`/);
  assert.match(handoff, /A1-A6, A9, A11, and A12 are accepted/);
});
