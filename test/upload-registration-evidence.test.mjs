import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, keccak256 } from 'ethers';
import { V41_CORE_ABI } from '../src/indexer/v4-1-event-schema.js';
import { createRegistrationReaders, verifyArtworkRegistration } from '../src/api/upload-registration-evidence.js';

const iface = new Interface(V41_CORE_ABI);
const core = '0x' + 'aa'.repeat(20), creator = '0x' + '11'.repeat(20), other = '0x' + '22'.repeat(20);
const hash = '0x' + 'dd'.repeat(32), blockHash = '0x' + 'bb'.repeat(32), anchorHash = '0x' + 'cc'.repeat(32);
const code = '0x6001600055';
const uri = 'https://storage.example/metadata/issued.json';
const deployment = { chainId: 84532, core, coreCodeHash: keccak256(code), startBlock: '50' };

function fixture() {
  const encoded = iface.encodeEventLog(iface.getEvent('ArtworkRegistered'), [36n, creator, uri]);
  const log = { ...encoded, address: core, blockNumber: '0x64', blockHash, transactionHash: hash,
    transactionIndex: '0x0', logIndex: '0x3', removed: false };
  const receipt = { transactionHash: hash, blockNumber: '0x64', blockHash, transactionIndex: '0x0',
    status: '0x1', from: other, to: other, logs: [log] };
  const node = () => ({ chain: '0x14a34', code, receipt: structuredClone(receipt), logs: [structuredClone(log)],
    finalized: { number: '0xc8', hash: anchorHash }, blocks: {
      '0x64': { number: '0x64', hash: blockHash }, '0xc8': { number: '0xc8', hash: anchorHash }
    } });
  const nodes = [node(), node()], calls = [];
  const rpcs = nodes.map((state, index) => async (method, params = []) => {
    calls.push({ index, method, params });
    const custom = state.override?.(method, params, calls);
    if (custom !== undefined) return custom;
    switch (method) {
      case 'eth_chainId': return state.chain;
      case 'eth_getCode': return state.code;
      case 'eth_getBlockByNumber': return params[0] === 'finalized' ? state.finalized : state.blocks[params[0]] || null;
      case 'eth_getTransactionReceipt': return state.receipt;
      case 'eth_getLogs': return state.logs;
      default: assert.fail(`Unexpected method ${method}`);
    }
  });
  return { nodes, calls, rpcs, input: { deployment, creator, metadataUri: uri, transactionHash: hash },
    run(overrides = {}) { return verifyArtworkRegistration({ ...this.input, ...overrides }, { rpcs }); } };
}

const deny = async (fixture, reason) => {
  const result = await fixture.run();
  assert.equal(result.can_submit, false);
  assert.equal(result.state, 'unresolved');
  assert.deepEqual(result.registrations, []);
  if (reason) assert.equal(result.reason, reason);
  return result;
};

test('two independent reads verify the exact finalized Core event, including relayed wallets', async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.state, 'verified'); assert.equal(result.can_submit, false);
  assert.deepEqual(result.registrations, [{ artwork_id: '36', creator_wallet: creator, metadata_uri: uri,
    transaction_hash: hash, block_number: '100', block_hash: blockHash, log_index: '3' }]);
  assert.deepEqual(result.finalized_anchor, { number: '200', hash: anchorHash });
  assert.equal(result.core_code_hash, keccak256(code));
  assert(f.calls.every(call => !/send|sign|estimate/i.test(call.method)));
});

test('finalized providers may have different head heights; verification uses their common height', async () => {
  const f = fixture(); f.nodes[1].finalized = { number: '0xc9', hash: '0x' + 'ee'.repeat(32) };
  f.nodes[1].blocks['0xc9'] = { ...f.nodes[1].finalized };
  assert.equal((await f.run()).state, 'verified');
});

test('a higher finalized head must match that endpoint\'s own canonical header', async t => {
  for (const header of [null, { number: '0xc9', hash: blockHash }]) await t.test(String(header?.hash), async () => {
    const f = fixture(); f.nodes[1].finalized = { number: '0xc9', hash: '0x' + 'ee'.repeat(32) };
    f.nodes[1].blocks['0xc9'] = header;
    await deny(f, header ? 'RECOVERY_BLOCK_DISAGREEMENT' : 'INVALID_RPC_EVIDENCE');
  });
});

test('missing and recent receipts remain unresolved, without releasing a publication', async t => {
  for (const missing of [null, 'recent']) await t.test(String(missing), async () => {
    const f = fixture();
    if (missing === null) f.nodes[1].receipt = null;
    else for (const node of f.nodes) {
      node.receipt.blockNumber = '0xc9'; node.receipt.logs[0].blockNumber = '0xc9';
    }
    await deny(f, missing === null ? 'RECEIPT_UNAVAILABLE' : 'RECEIPT_NOT_FINALIZED');
  });
});

test('a reverted reported transaction is an observation, not permission to submit another', async () => {
  const f = fixture();
  for (const node of f.nodes) { node.receipt.status = '0x0'; node.receipt.logs = []; }
  const result = await f.run();
  assert.equal(result.state, 'reverted'); assert.equal(result.can_submit, false);
  assert.deepEqual(result.registrations, []);
});

test('identity, deployment, malformed evidence and provider disagreements fail closed', async t => {
  const cases = [
    ['wrong chain', n => { n.chain = '0x1'; }],
    ['wrong code', n => { n.code = '0x6000'; }],
    ['wrong receipt hash', n => { n.receipt.transactionHash = anchorHash; }],
    ['wrong receipt status', n => { n.receipt.status = '0x2'; }],
    ['wrong receipt block', n => { n.receipt.blockHash = anchorHash; }],
    ['wrong receipt transaction index', n => { n.receipt.transactionIndex = '0x1'; }],
    ['removed log', n => { n.receipt.logs[0].removed = true; }],
    ['bad log quantity', n => { n.receipt.logs[0].logIndex = '-1'; }],
    ['duplicated log', n => { n.receipt.logs.push(structuredClone(n.receipt.logs[0])); }],
    ['missing block', n => { delete n.blocks['0x64']; }],
    ['noncanonical receipt', n => { n.blocks['0x64'].hash = anchorHash; }],
    ['wrong block number', n => { n.blocks['0x64'].number = '0x65'; }],
    ['different finalized block', n => { n.blocks['0xc8'].hash = blockHash; }],
    ['inconsistent finalized tag', n => { n.finalized.hash = blockHash; }],
    ['malformed ABI', n => { n.receipt.logs[0].data = '0x12'; }],
    ['RPC failure', n => { n.override = () => { throw Error('secret endpoint must never escape'); }; }]
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const f = fixture(); mutate(f.nodes[1]);
    const result = await deny(f);
    assert.doesNotMatch(JSON.stringify(result), /secret endpoint/);
  });
});

test('matching metadata is byte-exact and comes from the correct creator and emitter', async t => {
  for (const [name, args, emitter] of [
    ['other creator', [36n, other, uri], core],
    ['similar metadata URI', [36n, creator, uri + '/'], core],
    ['other emitter', [36n, creator, uri], other]
  ]) await t.test(name, async () => {
    const f = fixture();
    for (const node of f.nodes) Object.assign(node.receipt.logs[0],
      iface.encodeEventLog(iface.getEvent('ArtworkRegistered'), args), { address: emitter });
    await deny(f, 'NO_MATCHING_REGISTRATION');
  });
});

test('code must match at both the finalized anchor and the actual registration block', async () => {
  const f = fixture();
  f.nodes[0].override = (method, params) => method === 'eth_getCode' && params[1] === '0x64' ? '0x1234' : undefined;
  await deny(f, 'RECOVERY_CODE_MISMATCH');
});

test('changed anchor or registration block during a read discards all positive evidence', async t => {
  for (const height of ['0xc8', '0x64']) await t.test(height, async () => {
    const f = fixture(); let count = 0;
    f.nodes[0].override = (method, params) => {
      if (method === 'eth_getBlockByNumber' && params[0] === height && ++count === (height === '0xc8' ? 3 : 2)) {
        return { number: height, hash: '0x' + 'ee'.repeat(32) };
      }
    };
    await deny(f, 'RECOVERY_BLOCK_DISAGREEMENT');
  });
});

test('bounded no-hash scan cross-checks logs against actual receipts and returns coverage', async () => {
  const f = fixture();
  const result = await f.run({ transactionHash: null, scan: { fromBlock: '50', toBlock: '250' } });
  assert.equal(result.state, 'verified'); assert.equal(result.can_submit, false);
  assert.equal(result.registrations[0].artwork_id, '36');
  assert.deepEqual(result.coverage, { from_block: '50', to_block: '200', next_block: '201',
    requested_range_complete: false, proves_absence: false });
  const filter = f.calls.find(c => c.method === 'eth_getLogs').params[0];
  assert.equal(filter.address, core);
  assert.deepEqual(filter.topics, iface.encodeFilterTopics('ArtworkRegistered', [null, creator]));
});

test('empty scans and missing cursors never establish cancellation or authorize replay', async () => {
  const f = fixture(); for (const node of f.nodes) node.logs = [];
  const result = await f.run({ transactionHash: null, scan: { fromBlock: '50', toBlock: '100' } });
  assert.equal(result.reason, 'NO_MATCH_IN_SCANNED_RANGE'); assert.equal(result.can_submit, false);
  assert.equal(result.coverage.requested_range_complete, true); assert.equal(result.coverage.proves_absence, false);
  const unknown = await f.run({ transactionHash: null });
  assert.equal(unknown.reason, 'NO_TRANSACTION_OR_SCAN'); assert.equal(unknown.can_submit, false);
});

test('scan disagreements, removed/foreign/out-of-range logs and receipt mismatches remain unresolved', async t => {
  const cases = [
    ['different logs', n => { n.logs = []; }],
    ['removed log', n => { n.logs[0].removed = true; }],
    ['foreign emitter', n => { n.logs[0].address = other; }],
    ['outside scanned range', n => { n.logs[0].blockNumber = '0x31'; }],
    ['duplicate log', n => { n.logs.push(structuredClone(n.logs[0])); }],
    ['missing receipt', n => { n.receipt = null; }],
    ['different receipt event', n => { n.receipt.logs[0].data = iface.encodeEventLog('ArtworkRegistered', [36n, creator, uri + 'other']).data; }],
    ['too many logs', n => { n.logs = Array(129).fill(n.logs[0]); }]
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const f = fixture(); f.input.transactionHash = null; f.input.scan = { fromBlock: '50', toBlock: '200' };
    mutate(f.nodes[1]); await deny(f);
  });
});

test('multiple exact registrations are retained instead of silently choosing the first artwork', async () => {
  const f = fixture();
  for (const node of f.nodes) {
    const second = { ...node.receipt.logs[0], ...iface.encodeEventLog('ArtworkRegistered', [37n, creator, uri]), logIndex: '0x4' };
    node.receipt.logs.push(second); node.logs.push(structuredClone(second));
  }
  for (const input of [{}, { transactionHash: null, scan: { fromBlock: '50', toBlock: '200' } }]) {
    const result = await f.run(input);
    assert.equal(result.state, 'verified'); assert.equal(result.can_submit, false);
    assert.deepEqual(result.registrations.map(r => r.artwork_id), ['36', '37']);
  }
});

test('invalid scopes are rejected before any read, including oversized or guessed negative windows', async t => {
  for (const input of [
    { deployment: { ...deployment, chainId: 1 } }, { deployment: { ...deployment, coreCodeHash: '' } },
    { deployment: { ...deployment, startBlock: '-1' } }, { transactionHash: '0x123' },
    { creator: 'invalid' }, { metadataUri: '' },
    { transactionHash: null, scan: { fromBlock: '49', toBlock: '50' } },
    { transactionHash: null, scan: { fromBlock: '50', toBlock: '2050' } },
    { transactionHash: null, scan: { fromBlock: '50', toBlock: '40' } },
    { scan: { fromBlock: '50', toBlock: '100' } }
  ]) await t.test(JSON.stringify(input), async () => {
    const f = fixture(); await assert.rejects(f.run(input), /INVALID_RECOVERY_SCOPE/);
    assert.equal(f.calls.length, 0);
  });
});

test('RPC reader validates endpoint independence and excludes every mutation method', async () => {
  for (const urls of [[], ['https://one.example'], ['https://same.example/a', 'https://same.example/b'],
    ['http://one.example', 'https://two.example'], ['https://user:secret@one.example', 'https://two.example']]) {
    assert.throws(() => createRegistrationReaders(urls), /INVALID_RECOVERY_RPC_CONFIG/);
  }
  const [read] = createRegistrationReaders(['https://one.example', 'https://two.example']);
  for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4']) {
    await assert.rejects(read(method), /RECOVERY_METHOD_NOT_ALLOWED/);
  }
});

test('RPC transport checks response IDs, caps streamed bytes and redacts response errors', async t => {
  const originalFetch = global.fetch; t.after(() => { global.fetch = originalFetch; });
  const [read] = createRegistrationReaders(['https://one.example', 'https://two.example']);
  global.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(options.redirect, 'error'); assert(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: '0x14a34' }));
  };
  assert.equal(await read('eth_chainId'), '0x14a34');
  for (const response of [
    () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 999, result: '0x14a34' })),
    () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 3, error: { message: 'private upstream data' } })),
    () => new Response('x'.repeat(1024 * 1024 + 1)),
    () => new Response('secret body', { status: 500 })
  ]) {
    global.fetch = async () => response();
    await assert.rejects(read('eth_chainId'), error => error.message === 'RECOVERY_RPC_UNAVAILABLE');
  }
});
