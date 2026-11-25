#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { keccak256 } = require('ethers');

const rootDir = path.resolve(__dirname, '..');
function pairTargets(coreName) {
  assert(['OrdinaryMarket', 'OrdinaryPayoutMarket'].includes(coreName), 'Unrecognized ordinary Core');
  return [coreName, 'SettledArtworkNFT'];
}
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const textDigest = file => sha256(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));

function readSource(root, file) {
  assert(/^(?:contracts\/replacement\/|@openzeppelin\/contracts\/)(?:[\w.-]+\/)*[\w.-]+\.sol$/.test(file)
    && !file.split('/').includes('..'), `Unexpected source path: ${file}`);
  return fs.readFileSync(path.join(root, file.startsWith('@') ? 'node_modules' : '', file));
}

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
}

function bytecodeRecord(compiled, artifactHex, name) {
  assert(typeof compiled.object === 'string' && /^(?:[\da-f]{2})+$/i.test(compiled.object),
    `Invalid or unlinked ${name}`);
  assert.deepEqual(compiled.linkReferences, {}, `Unexpected linked libraries in ${name}`);
  assert(artifactHex === '0x' + compiled.object, `Artifact differs from compiler output: ${name}`);
  return { bytes: compiled.object.length / 2, keccak256: keccak256(artifactHex) };
}

function buildOrdinaryAuditManifest(root = rootDir, coreName = 'OrdinaryMarket') {
  const configPath = path.join(root, 'hardhat.local.config.cjs');
  const config = require(configPath).solidity;
  const lockPath = path.join(root, 'package-lock.json');
  const packages = readJSON(lockPath).packages;
  const builds = new Map();
  const sources = {};
  const contracts = {};
  let compiler;
  let settings;

  for (const name of pairTargets(coreName)) {
    const source = `contracts/replacement/${name}.sol`;
    const dir = path.join(root, 'artifacts', source);
    const artifact = readJSON(path.join(dir, name + '.json'));
    assert(artifact._format === 'hh-sol-artifact-1' && artifact.sourceName === source && artifact.contractName === name,
      `Expected exact Hardhat artifact for ${name}`);
    const debug = readJSON(path.join(dir, name + '.dbg.json'));
    assert.equal(debug._format, 'hh-sol-dbg-1');
    const buildFile = path.resolve(dir, debug.buildInfo.replaceAll('\\', '/'));
    assert(path.dirname(buildFile) === path.join(root, 'artifacts', 'build-info') &&
      /^[\da-f]{32}\.json$/i.test(path.basename(buildFile)), 'Invalid Hardhat build-info reference');
    if (!builds.has(buildFile)) builds.set(buildFile, readJSON(buildFile));
    const build = builds.get(buildFile);
    assert.equal(build._format, 'hh-sol-build-info-1');
    assert.equal(build.input.language, 'Solidity');
    assert.equal(build.solcVersion, config.version, 'Build compiler differs from local configuration');
    const result = build.output.contracts[source][name];
    const metadata = JSON.parse(result.metadata);
    assert.equal(metadata.compiler.version, build.solcLongVersion);
    assert.deepEqual(metadata.settings.compilationTarget, { [source]: name });
    if (compiler) assert.equal(build.solcLongVersion, compiler, 'Pair was built with different compilers');
    if (settings) assert.deepEqual(build.input.settings, settings, 'Pair was built with different settings');
    compiler = build.solcLongVersion;
    settings = build.input.settings;
    for (const [key, value] of Object.entries(config.settings)) {
      assert.deepEqual(settings[key], value, `Local compiler setting differs from build: ${key}`);
    }

    // Metadata identifies the transitive sources solc used for this contract,
    // excluding unrelated targets in the same Hardhat compilation.
    const files = Object.keys(metadata.sources).sort();
    assert(files.includes(source), `Missing metadata source for ${name}`);
    for (const file of files) {
      const bytes = readSource(root, file);
      const inputText = build.input.sources[file]?.content;
      assert(typeof inputText === 'string' && bytes.equals(Buffer.from(inputText)), `Stale compiler input: ${file}`);
      assert.equal(keccak256(bytes), metadata.sources[file].keccak256, `Metadata source differs: ${file}`);
      sources[file] = sha256(bytes);
    }

    assert.deepEqual(artifact.abi, result.abi, `Artifact ABI differs for ${name}`);
    assert.deepEqual(result.abi, metadata.output.abi, `Metadata ABI differs for ${name}`);
    assert.deepEqual(artifact.linkReferences, result.evm.bytecode.linkReferences);
    assert.deepEqual(artifact.deployedLinkReferences, result.evm.deployedBytecode.linkReferences);
    const creation = bytecodeRecord(result.evm.bytecode, artifact.bytecode, name + ' creation');
    const runtimeTemplate = bytecodeRecord(result.evm.deployedBytecode, artifact.deployedBytecode, name + ' runtime');
    const immutableOffsets = Object.values(result.evm.deployedBytecode.immutableReferences).flat()
      .map(({ start, length }) => ({ start, length })).sort((a, b) => a.start - b.start);
    assert(immutableOffsets.length && immutableOffsets.every(({start, length}, index) => Number.isSafeInteger(start)
      && Number.isSafeInteger(length) && start >= (index ? immutableOffsets[index - 1].start + immutableOffsets[index - 1].length : 0)
      && length > 0 && start + length <= runtimeTemplate.bytes), `Invalid immutable offsets for ${name}`);
    contracts[`${source}:${name}`] = { sources: files, compilerMetadataSha256: sha256(result.metadata),
      abiSha256: sha256(JSON.stringify(ordered(result.abi))), creation, runtimeTemplate, immutableOffsets };
  }
  return ordered({ schemaVersion: 1, compiler, settings, sourceSha256: sources, contracts,
    toolchain: { localConfigLfSha256: textDigest(configPath), packageLockLfSha256: textDigest(lockPath),
      hardhat: packages['node_modules/hardhat'].version, openZeppelinContracts: packages['node_modules/@openzeppelin/contracts'].version } });
}

function rebuildOrdinaryAuditManifest(manifest, executable, root = rootDir, coreName = 'OrdinaryMarket') {
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(Object.keys(manifest.contracts).sort(), pairTargets(coreName).map(n => `contracts/replacement/${n}.sol:${n}`));
  assert.equal(textDigest(path.join(root, 'package-lock.json')), manifest.toolchain.packageLockLfSha256, 'Dependency lock differs');
  assert.equal(textDigest(path.join(root, 'hardhat.local.config.cjs')), manifest.toolchain.localConfigLfSha256, 'Compiler config differs');
  const sources = {};
  for (const [file, digest] of Object.entries(manifest.sourceSha256)) {
    const content = readSource(root, file);
    assert.equal(sha256(content), digest, `Source differs: ${file}`);
    sources[file] = { content: content.toString('utf8') };
  }
  const command = path.resolve(executable);
  const version = execFileSync(command, ['--version'], { encoding: 'utf8', timeout: 10_000 });
  assert(version.split(/\r?\n/).some(line => line === 'Version: ' + manifest.compiler ||
    line.startsWith('Version: ' + manifest.compiler + '.')), 'Compiler version differs from manifest');
  const result = JSON.parse(execFileSync(command, ['--standard-json'], { encoding: 'utf8', timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024, input: JSON.stringify({ language: 'Solidity', sources, settings: manifest.settings }) }));
  const errors = (result.errors || []).filter(error => error.severity === 'error');
  assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'));
  for (const [qualified, expected] of Object.entries(manifest.contracts)) {
    const [source, name] = qualified.split(':');
    const compiled = result.contracts[source][name];
    assert.equal(sha256(compiled.metadata), expected.compilerMetadataSha256, `Rebuilt metadata differs: ${name}`);
    assert.deepEqual(Object.keys(JSON.parse(compiled.metadata).sources).sort(), expected.sources);
    assert.equal(sha256(JSON.stringify(ordered(compiled.abi))), expected.abiSha256);
    for (const [kind, output] of [['creation', compiled.evm.bytecode], ['runtimeTemplate', compiled.evm.deployedBytecode]]) {
      assert.equal(keccak256('0x' + output.object), expected[kind].keccak256, `Rebuilt ${kind} differs: ${name}`);
      assert.equal(output.object.length / 2, expected[kind].bytes);
    }
    const offsets = Object.values(compiled.evm.deployedBytecode.immutableReferences).flat().sort((a, b) => a.start - b.start);
    assert.deepEqual(offsets, expected.immutableOffsets, `Rebuilt immutable offsets differ: ${name}`);
  }
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const payout = args[0] === '--payout';
    if (payout) args.shift();
    const coreName = payout ? 'OrdinaryPayoutMarket' : 'OrdinaryMarket';
    const rebuild = args[0] === '--rebuild' && args.length === 3;
    assert(args.length === 0 || rebuild || (args.length === 2 && ['--write', '--check'].includes(args[0])),
      'Usage: node scripts/ordinary-audit-manifest.cjs [--payout] [--write <new-file.json> | --check <manifest.json> | --rebuild <manifest.json> <trusted-solc>]');
    const manifest = rebuild ? readJSON(args[1]) : buildOrdinaryAuditManifest(rootDir, coreName);
    const serialized = JSON.stringify(manifest, null, 2) + '\n';
    if (!args.length) process.stdout.write(serialized);
    else {
      if (rebuild) rebuildOrdinaryAuditManifest(manifest, args[2], rootDir, coreName);
      else if (args[0] === '--write') fs.writeFileSync(args[1], serialized, { flag: 'wx' });
      else assert.deepEqual(readJSON(args[1]), manifest, 'Audit manifest differs from current sources, build or dependency lock');
      console.log(`${args[0]} ${Object.keys(manifest.sourceSha256).length} sources, ${Object.keys(manifest.contracts).length} contracts, sha256 ${sha256(serialized)}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildOrdinaryAuditManifest };
