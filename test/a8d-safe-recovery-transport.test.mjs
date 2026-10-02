import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {verifyModerationSafeSignature} from '../src/api/moderation-safe-recovery.js';

const safeAddress = `0x${'1'.repeat(40)}`;
const messageHash = `0x${'2'.repeat(64)}`;
const signature = `0x${'3'.repeat(130)}`;
const abiBytes4 = value => value.padEnd(66, '0');

async function rpc(options = {}) {
  const calls = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    if (options.unavailable) {response.writeHead(503); response.end('unavailable'); return;}
    const input = JSON.parse(body);
    const reply = item => {
      calls.push(item);
      let result;
      if (item.method === 'eth_chainId') result = options.chainId || '0x14a34';
      else if (item.method === 'eth_getCode') result = options.code ?? '0x6000';
      else if (item.method === 'eth_call') {
        const legacy = item.params[0].data.startsWith('0x20c13b0b');
        result = abiBytes4(options.invalid || (options.legacyOnly && !legacy) ? '0xffffffff' : legacy ? '0x20c13b0b' : '0x1626ba7e');
      } else throw new Error(`Unexpected RPC method: ${item.method}`);
      return {jsonrpc: '2.0', id: item.id, result};
    };
    response.writeHead(200, {'Content-Type': 'application/json'});
    response.end(JSON.stringify(Array.isArray(input) ? input.map(reply) : reply(input)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise(resolve => server.close(resolve))};
}

async function verify(t, firstOptions = {}, secondOptions = {}) {
  const first = await rpc(firstOptions), second = await rpc(secondOptions);
  t.after(async () => {await Promise.all([first.close(), second.close()]);});
  const config = {safeAddress, chainId: 84532, rpcUrls: [first.url, second.url]};
  // Exercise the real ethers provider and JSON-RPC wire; no providerFactory mock.
  const accepted = await verifyModerationSafeSignature({config, messageHash, signature}).catch(() => false);
  return {accepted, first, second};
}

test('Safe recovery checks the actual chain returned by both transports before accepting EIP-1271', async t => {
  const {accepted, first, second} = await verify(t);
  assert.equal(accepted, true);
  for (const endpoint of [first, second]) {
    assert.equal(endpoint.calls[0].method, 'eth_chainId');
    assert.ok(endpoint.calls.some(call => call.method === 'eth_getCode'));
    assert.ok(endpoint.calls.some(call => call.method === 'eth_call'));
  }
});

test('one wrong-chain RPC cannot authorize recovery even when it returns Safe code and valid magic', async t => {
  const {accepted, second} = await verify(t, {}, {chainId: '0x2105'});
  assert.equal(accepted, false);
  assert.deepEqual(second.calls.map(call => call.method), ['eth_chainId']);
});

test('two agreeing wrong-chain RPCs cannot be mistaken for the configured chain', async t => {
  const {accepted, first, second} = await verify(t, {chainId: '0x2105'}, {chainId: '0x2105'});
  assert.equal(accepted, false);
  assert.deepEqual(first.calls.map(call => call.method), ['eth_chainId']);
  assert.deepEqual(second.calls.map(call => call.method), ['eth_chainId']);
});

test('Safe recovery rejects missing deployed code from either transport', async t => {
  const {accepted, second} = await verify(t, {}, {code: '0x'});
  assert.equal(accepted, false);
  assert.ok(!second.calls.some(call => call.method === 'eth_call'));
});

test('Safe recovery retains the supported legacy EIP-1271 overload after chain verification', async t => {
  const {accepted, first, second} = await verify(t, {legacyOnly: true}, {legacyOnly: true});
  assert.equal(accepted, true);
  for (const endpoint of [first, second]) assert.equal(endpoint.calls.filter(call => call.method === 'eth_call').length, 2);
});

test('a disagreeing EIP-1271 transport denies recovery', async t => {
  const {accepted} = await verify(t, {}, {invalid: true});
  assert.equal(accepted, false);
});

test('an unavailable transport denies recovery', async t => {
  const {accepted} = await verify(t, {}, {unavailable: true});
  assert.equal(accepted, false);
});
