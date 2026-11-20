import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Wallet, ZeroAddress } from 'ethers';

const exec = promisify(execFile);
const deployScript = fileURLToPath(new URL('../scripts/deploy.js', import.meta.url));

test('prototype deployment checks its local artifacts and Base Sepolia boundary before writing', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'artsoul-deploy-test-'));
  t.after(async () => {
    assert.equal(dirname(dir), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith('artsoul-deploy-test-'));
    await rm(dir, { recursive: true, force: true });
  });
  const methods = [];
  let chainId = '0x2105'; // Base mainnet on the test RPC.
  const rpc = createServer(async (request, response) => {
    let body = '';
    for await (const part of request) body += part;
    const payload = JSON.parse(body);
    const respond = ({ method, id }) => {
      methods.push(method);
      return method === 'eth_chainId'
        ? { jsonrpc: '2.0', id, result: chainId }
        : { jsonrpc: '2.0', id, error: { code: -32601, message: 'Unsupported fixture call' } };
    };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(Array.isArray(payload) ? payload.map(respond) : respond(payload)));
  });
  await new Promise(resolve => rpc.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => rpc.close(resolve)));

  const url = `http://127.0.0.1:${rpc.address().port}`;
  const config = join(dir, 'hardhat.config.cjs');
  const networks = { 'base-sepolia': { url }, 'eth-sepolia': { url } };
  await writeFile(config, `module.exports = ${JSON.stringify({ solidity: '0.8.24', networks })};`);
  const signer = Wallet.createRandom();
  const env = { SystemRoot: process.env.SystemRoot || '', HARDHAT_CONFIG: config, HARDHAT_NETWORK: 'base-sepolia',
    PRIVATE_KEY: signer.privateKey, TREASURY_ADDRESS: signer.address, DEPLOY_DRY_RUN: '0' };
  const run = overrides => exec(process.execPath, [deployScript], {
    cwd: dir, env: { ...env, ...overrides }, timeout: 15_000, windowsHide: true
  });

  await assert.rejects(run({ HARDHAT_NETWORK: 'eth-sepolia' }), /restricted to Base Sepolia/);
  await assert.rejects(run({ TREASURY_ADDRESS: ZeroAddress }), /nonzero address/);
  assert.deepEqual(methods, []);

  await assert.rejects(run({}), /RPC did not confirm Base Sepolia/);
  assert.deepEqual(methods, ['eth_chainId']);
  chainId = '0x14a34';
  // The first two valid artifacts cannot start a partial deploy if Core is missing.
  async function addArtifact(contractName) {
    const sourceName = `contracts/${contractName}.sol`;
    const path = join(dir, 'artifacts', sourceName);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, `${contractName}.json`), JSON.stringify({
      contractName, sourceName, abi: [{ type: 'constructor', inputs: [] }], bytecode: '0x6000'
    }));
  }
  await addArtifact('ArtSoulNFT');
  await addArtifact('ArtSoulProjectNFT');
  await assert.rejects(run({}), /ArtSoulCore.*not found/);
  assert.deepEqual(methods, ['eth_chainId', 'eth_chainId']);

  await addArtifact('ArtSoulCore');
  const { stdout } = await run({ DEPLOY_DRY_RUN: '1' });
  assert.match(stdout, /Dry deploy validation passed \(offline\)/);
  assert.deepEqual(methods, ['eth_chainId', 'eth_chainId']);
});
