#!/usr/bin/env node
'use strict';

// Source-only C1 evidence. This does not compare upgrades or read chain state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const legacyTargets = [
  ['contracts/ArtSoulCore.sol', 'ArtSoulCore'],
  ['contracts/ArtSoulNFT.sol', 'ArtSoulNFT'],
  ['contracts/ArtSoulProjectNFT.sol', 'ArtSoulProjectNFT'],
  ['contracts/ArtSoulDonations.sol', 'ArtSoulDonations'],
  ['contracts/launch/CollectionLaunch.sol', 'CollectionLaunch'],
  ['contracts/launch/CollectionForge.sol', 'CollectionForge'],
];
const replacementTargets = ['SettledArtworkNFT', 'OrdinaryArtAuctions', 'OutbidRefunds', 'OrdinaryArtResales', 'TreasuryBoundOrdinaryArt']
  .map(name => [`contracts/replacement/${name}.sol`, name]);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function verifyBuild(build) {
  assert.equal(build._format, 'hh-sol-build-info-1');
  assert.equal(build.solcVersion, '0.8.24');
  assert.equal(build.solcLongVersion, '0.8.24+commit.e11b9ed9');
  assert.equal(build.input.language, 'Solidity');
}

// Hardhat can combine unrelated sources in one build or produce several incremental builds.
// Resolve exactly each candidate and its imports from the compiler's own AST.
function replacementBuild(root, targets) {
  const sources = {};
  let settings;
  for (const [source, name] of targets) {
    const dir = path.join(root, 'artifacts', source);
    const debugFile = path.join(dir, name + '.dbg.json');
    const { buildInfo } = JSON.parse(fs.readFileSync(debugFile, 'utf8'));
    const build = JSON.parse(fs.readFileSync(path.resolve(dir, buildInfo), 'utf8'));
    verifyBuild(build);
    const { outputSelection, ...contractSettings } = build.input.settings;
    if (settings) assert.deepEqual(contractSettings, settings, 'Replacement compiler settings differ');
    settings = contractSettings;
    const pending = [source];
    const visited = new Set();
    while (pending.length) {
      const file = pending.pop();
      if (visited.has(file)) continue;
      visited.add(file);
      const content = build.input.sources[file].content.replace(/\r\n/g, '\n');
      if (sources[file]) assert.equal(sources[file].content, content, `Conflicting builds: ${file}`);
      sources[file] = { content };
      for (const node of build.output.sources[file].ast.nodes) {
        if (node.nodeType === 'ImportDirective') pending.push(node.absolutePath);
      }
    }
  }
  return { solcLongVersion: '0.8.24+commit.e11b9ed9', input: { language: 'Solidity', sources, settings } };
}

function main() {
  const [buildFile, compilerFile, outputFile, mode, ...extra] = process.argv.slice(2);
  assert(buildFile && compilerFile && outputFile && !extra.length && (!mode || mode === '--check'),
    'Usage: node scripts/export-contract-storage.cjs <build-info.json|--replacement|--ordinary|--ordinary-payout> <trusted-solc-executable> <output.json> [--check]');
  const root = path.resolve(__dirname, '..');
  const ordinary = ['--ordinary', '--ordinary-payout'].includes(buildFile);
  const coreName = buildFile === '--ordinary-payout' ? 'OrdinaryPayoutMarket' : 'OrdinaryMarket';
  const replacement = ordinary || buildFile === '--replacement';
  const targets = ordinary ? [[`contracts/replacement/${coreName}.sol`, coreName], replacementTargets[0]]
    : replacement ? replacementTargets : legacyTargets;
  const build = replacement ? replacementBuild(root, targets) : JSON.parse(fs.readFileSync(buildFile, 'utf8'));
  if (!replacement) verifyBuild(build);

  // Reject stale artifacts instead of presenting an older build as current source.
  const sources = {};
  const normalizedSources = {};
  for (const name of Object.keys(build.input.sources).sort()) {
    assert(!name.includes('\\') && !name.split('/').includes('..'), 'Invalid source path');
    assert(name.startsWith('contracts/') || name.startsWith('@openzeppelin/contracts/'),
      `Unexpected source: ${name}`);
    const local = path.join(root, name.startsWith('@') ? 'node_modules' : '', name);
    const content = fs.readFileSync(local, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(build.input.sources[name].content.replace(/\r\n/g, '\n'), content, `Stale source: ${name}`);
    sources[name] = { sha256: sha256(content) };
    normalizedSources[name] = { content };
  }
  const compiler = path.resolve(compilerFile);
  const version = execFileSync(compiler, ['--version'], { encoding: 'utf8', timeout: 10_000 });
  assert.match(version, /Version: 0\.8\.24\+commit\.e11b9ed9(?:\.|\s|$)/,
    'The executable must match the build-info compiler');

  const input = structuredClone(build.input);
  input.sources = normalizedSources;
  input.settings.outputSelection = { '*': { '': ['ast'] } };
  for (const [source, name] of targets) {
    input.settings.outputSelection[source] = {
      '': ['ast'],
      [name]: ['storageLayout', 'evm.deployedBytecode.immutableReferences'],
    };
  }
  const output = JSON.parse(execFileSync(compiler, ['--standard-json'], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024,
  }));
  const errors = (output.errors || []).filter(error => error.severity === 'error');
  assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'));
  const definitions = new Map();
  for (const [source, result] of Object.entries(output.sources)) {
    for (const node of result.ast.nodes) {
      if (node.nodeType === 'ContractDefinition') definitions.set(node.id, { source, node });
    }
  }
  const contracts = {};
  for (const [source, name] of targets) {
    const result = output.contracts[source][name];
    assert(result.storageLayout.storage.length > 0, `Missing layout: ${name}`);
    const definition = [...definitions.values()].find(item => item.source === source && item.node.name === name);
    const immutables = definition.node.linearizedBaseContracts.flatMap(id => {
      const base = definitions.get(id);
      return base.node.nodes.filter(node => node.nodeType === 'VariableDeclaration'
        && node.stateVariable && node.mutability === 'immutable').map(node => ({
          name: node.name, declaredIn: `${base.source}:${base.node.name}`,
          type: node.typeDescriptions.typeString, astId: node.id,
          bytecodeReferences: result.evm.deployedBytecode.immutableReferences[String(node.id)] || [],
        }));
    });
    contracts[`${source}:${name}`] = { ...result.storageLayout, immutables };
  }
  const { outputSelection, ...settings } = build.input.settings;
  const artifact = {
    schemaVersion: 1,
    scope: ordinary ? 'Concrete ordinary market and its paired NFT. Fresh deployments with no in-place storage migration.'
      : replacement ? 'Fresh-deployment candidates; abstract layouts are partial. No deployed state or in-place upgrade.'
      : 'Current constructor-based source; not deployed state or upgrade compatibility',
    sourceNormalization: 'CRLF to LF; no other source transformations',
    compiler: build.solcLongVersion,
    settings, sources,
    compilerInputSha256: sha256(JSON.stringify(input)),
    contracts,
  };
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  if (mode === '--check') {
    assert.equal(fs.readFileSync(outputFile, 'utf8').replace(/\r\n/g, '\n'), serialized, 'Storage baseline differs');
  } else {
    fs.writeFileSync(outputFile, serialized, { flag: 'wx' });
  }
  console.log(JSON.stringify({ mode: mode || 'export', contracts: targets.length,
    sources: Object.keys(sources).length, sha256: sha256(serialized) }));
}

try { main(); } catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
