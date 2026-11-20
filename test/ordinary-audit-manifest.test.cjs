const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const { keccak256 } = require('ethers');
const { buildOrdinaryAuditManifest } = require('../scripts/ordinary-audit-manifest.cjs');
const recorded = require('../docs/security/C12_ORDINARY_AUDIT_MANIFEST.json');

const names = ['OrdinaryMarket', 'SettledArtworkNFT'];
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fixtureDependency = '@openzeppelin/contracts/test/Imported.sol';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artsoul-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function write(file, data) {
    const dest = path.join(root, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, typeof data === 'string' ? data : JSON.stringify(data));
  }
  const version = '0.8.24+commit.e11b9ed9';
  const buildFile = 'artifacts/build-info/' + '1'.repeat(32) + '.json';
  const input = { language: 'Solidity', settings: { optimizer: { enabled: true, runs: 200 } }, sources: {} };
  const build = { _format: 'hh-sol-build-info-1', solcVersion: '0.8.24', solcLongVersion: version, input, output: { contracts: {} } };
  write('hardhat.local.config.cjs', 'module.exports = ' + JSON.stringify({solidity: {version: '0.8.24', settings: input.settings}}));
  write('package-lock.json', {packages: {'node_modules/hardhat':{version:'2'}, 'node_modules/@openzeppelin/contracts':{version:'5'}}});
  const shared = 'abstract contract Imported {}\n';
  input.sources[fixtureDependency] = { content: shared };
  write('node_modules/' + fixtureDependency, shared);
  for (const name of names) {
    const file = `contracts/replacement/${name}.sol`;
    const content = `contract ${name} {}\n`;
    const src = { [file]: { keccak256: keccak256(Buffer.from(content)) },
      [fixtureDependency]: { keccak256: keccak256(Buffer.from(shared)) } };
    const abi = [];
    const runtime = '00'.repeat(32);
    input.sources[file] = { content };
    build.output.contracts[file] = { [name]: { abi, metadata: JSON.stringify({
      compiler: {version}, output: {abi}, settings: {compilationTarget: {[file]:name}}, sources: src }),
      evm: {bytecode: {object:'a0',linkReferences:{}},
        deployedBytecode: {object:runtime,linkReferences:{},immutableReferences:{'42':[{start:0,length:32}]}}} } };
    write(file, content);
    write(`artifacts/${file}/${name}.dbg.json`, { _format:'hh-sol-dbg-1', buildInfo:'../../../build-info/' + '1'.repeat(32) + '.json' });
    write(`artifacts/${file}/${name}.json`, { _format:'hh-sol-artifact-1',sourceName:file,contractName:name,
      abi,bytecode:'0xa0',deployedBytecode:'0x' + runtime,linkReferences:{},deployedLinkReferences:{} });
  }
  write(buildFile, build);
  return {root, build, buildFile, write};
}

test('the recorded handoff binds the workspace including the dependency lock before Hardhat runs', () => {
  const root = path.resolve(__dirname, '..');
  const lfHash = file => sha256(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'));
  assert.equal(lfHash('package-lock.json'), recorded.toolchain.packageLockLfSha256);
  assert.equal(lfHash('hardhat.local.config.cjs'), recorded.toolchain.localConfigLfSha256);
  const files = new Set();
  for (const name of names) {
    const file = `contracts/replacement/${name}.sol`;
    const entry = recorded.contracts[file + ':' + name];
    assert.ok(entry.sources.includes(file));
    entry.sources.forEach(source => files.add(source));
    assert.ok(entry.immutableOffsets.length);
    for (const key of ['creation', 'runtimeTemplate']) {
      assert.match(entry[key].keccak256, /^0x[\da-f]{64}$/);
      assert.ok(entry[key].bytes > 0);
    }
  }
  assert.deepEqual([...files].sort(), Object.keys(recorded.sourceSha256).sort());
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(root, file.startsWith('@') ? 'node_modules' : '', file));
    assert.equal(sha256(bytes), recorded.sourceSha256[file], file);
  }
});

test('manifest uses transitive inputs and rejects a stale dependency even if only its line endings differ', t => {
  const {root, write} = fixture(t);
  const ok = buildOrdinaryAuditManifest(root);
  assert.equal(Object.keys(ok.sourceSha256).length, 3);
  assert.equal(ok.contracts['contracts/replacement/OrdinaryMarket.sol:OrdinaryMarket'].creation.keccak256, keccak256('0xa0'));
  write('node_modules/' + fixtureDependency, 'abstract contract Imported {}\r\n');
  assert.throws(() => buildOrdinaryAuditManifest(root), /Stale compiler input/);
});

test('manifest rejects altered local creation or runtime artifacts and a stale compiler metadata hash', t => {
  const {root, build, buildFile, write} = fixture(t);
  const file = 'contracts/replacement/OrdinaryMarket.sol';
  const target = 'artifacts/' + file + '/OrdinaryMarket.json';
  const original = JSON.parse(fs.readFileSync(path.join(root,target)));
  for (const key of ['bytecode', 'deployedBytecode']) {
    write(target, {...original, [key]:'0x99'});
    assert.throws(() => buildOrdinaryAuditManifest(root), /Artifact differs from compiler output/);
  }
  write(target, original);
  const result = build.output.contracts[file].OrdinaryMarket;
  const metadata = JSON.parse(result.metadata);
  metadata.sources[file].keccak256 = '0x' + '0'.repeat(64);
  result.metadata = JSON.stringify(metadata);
  write(buildFile, build);
  assert.throws(() => buildOrdinaryAuditManifest(root), /Metadata source differs/);
});
