import assert from 'node:assert/strict';
import test from 'node:test';
import { ethers } from 'ethers';
import EventListener from '../src/indexer/event-listener.js';
import { DONATION_ABI } from '../src/indexer/donation-events.js';
import { V41_CORE_ABI } from '../src/indexer/v4-1-event-schema.js';

const CORE = `0x${'1'.repeat(40)}`, SUPPORT = `0x${'2'.repeat(40)}`;
const DONOR = `0x${'3'.repeat(40)}`, CREATOR = `0x${'4'.repeat(40)}`, FOREIGN = `0x${'5'.repeat(40)}`;
const coreInterface = new ethers.Interface(V41_CORE_ABI);
const donationInterface = new ethers.Interface(DONATION_ABI);
const hash = value => `0x${value.toString(16).padStart(64, '0')}`;

function log(iface, name, values, address, blockNumber, index) {
  return {...iface.encodeEventLog(iface.getEvent(name), values), address, blockNumber, index,
    transactionHash: hash(blockNumber), blockHash: hash(blockNumber + 1000)};
}
function donation(message, overrides = {}) {
  return {...log(donationInterface, 'Donation', [DONOR, CREATOR, 28, 500000000000000n, message, true],
    SUPPORT, 102, 2), ...overrides};
}
function listener(logs, enabled = true) {
  const queries = [];
  const instance = Object.create(EventListener.prototype);
  Object.assign(instance, {
    contractAddress: CORE, contract: {interface: coreInterface}, chainId: 84532,
    donationAddress: enabled ? SUPPORT : '', donationInterface: enabled ? donationInterface : null,
    maxBlockRange: 1000, maxBlockRangeLimit: 1000,
    provider: {async getLogs(filter) { queries.push(filter); return logs; }},
    _retryRpcCall: operation => operation()
  });
  return {instance, queries};
}

test('one bounded log query parses Core and support events with their own ABI and stable ordering', async () => {
  const coreLog = log(coreInterface, 'ArtworkRegistered', [28, CREATOR, 'ipfs://work'], CORE, 101, 1);
  const {instance, queries} = listener([donation('Later', {index: 3}), coreLog,
    {address: SUPPORT, topics: [], data: '0x', blockNumber: 102, index: 0}, donation('Earlier')]);
  const parsed = await instance._queryLogsChunk(100, 110);
  assert.deepEqual(queries, [{address: [CORE, SUPPORT], fromBlock: 100, toBlock: 110}]);
  assert.deepEqual(parsed.map(event => [event.eventName, event.blockNumber, event.logIndex]),
    [['ArtworkRegistered', 101, 1], ['Donation', 102, 2], ['Donation', 102, 3]]);
  assert.equal(parsed[0].eventData.metadataURI, 'ipfs://work');
  assert.equal(parsed[1].eventData.anonymous, true);
  assert.equal(parsed[1].eventData.amount, 500000000000000n);
  assert.equal(parsed[1].contractAddress, SUPPORT);
});

test('dormant support retains the existing single Core filter and never accepts donation logs', async () => {
  const coreLog = log(coreInterface, 'ArtworkRegistered', [28, CREATOR, 'ipfs://work'], CORE, 101, 1);
  const {instance, queries} = listener([donation('Not configured'), coreLog], false);
  const parsed = await instance._queryLogsChunk(100, 110);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].address, CORE);
  assert.deepEqual(parsed.map(event => event.eventName), ['ArtworkRegistered']);
});

test('donation ABI is accepted only from the configured support contract, never Core or another address', async () => {
  const {instance} = listener([donation('Core spoof', {address: CORE}),
    donation('Foreign spoof', {address: FOREIGN}), donation('Valid')]);
  const parsed = await instance._queryLogsChunk(100, 110);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].eventData.message, 'Valid');
  assert.equal(parsed[0].contractAddress, SUPPORT);
});

test('a Core-shaped event from an address outside the bounded deployment filter is rejected', async () => {
  const foreignCoreLog = log(coreInterface, 'ArtworkRegistered', [29, CREATOR, 'ipfs://foreign'], FOREIGN, 101, 1);
  const realCoreLog = log(coreInterface, 'ArtworkRegistered', [28, CREATOR, 'ipfs://work'], CORE, 101, 2);
  const {instance} = listener([foreignCoreLog, realCoreLog, donation('Valid')]);
  const parsed = await instance._queryLogsChunk(100, 110);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].eventData.artworkId, 28n);
  assert.deepEqual(parsed.map(event => event.contractAddress), [CORE, SUPPORT]);
});

test('valid on-chain NUL is preserved as exact bytes before JSONB or queue persistence and hidden on site', async () => {
  const raw = 'before\0after';
  const {instance} = listener([donation(raw)]);
  const [parsed] = await instance._queryLogsChunk(100, 110);
  assert.equal(parsed.eventData.message, null);
  assert.equal(parsed.eventData.message_utf8_hex, Buffer.from(raw, 'utf8').toString('hex'));
  const serialized = JSON.stringify(parsed.eventData, (_, value) => typeof value === 'bigint' ? String(value) : value);
  assert.equal(serialized.includes('\\u0000'), false);
  assert.equal(Buffer.from(parsed.eventData.message_utf8_hex, 'hex').toString('utf8'), raw);
});

test('raw over-display-limit events remain attributable while 140 multi-scalar graphemes remain visible', async () => {
  const visible = 'e\u0301'.repeat(140), hidden = 'a'.repeat(141);
  const {instance} = listener([donation(visible), donation(hidden, {index: 3})]);
  const parsed = await instance._queryLogsChunk(100, 110);
  assert.equal(parsed[0].eventData.message, visible);
  assert.equal(parsed[1].eventData.message, null);
  assert.equal(Buffer.from(parsed[1].eventData.message_utf8_hex, 'hex').toString('utf8'), hidden);
  for (const event of parsed) {
    assert.equal(event.eventData.donor, DONOR);
    assert.equal(event.eventData.creator, CREATOR);
    assert.equal(event.eventData.artworkId, 28n);
    assert.equal(event.eventData.amount, 500000000000000n);
  }
});

test('support log volume does not add per-event RPC requests', async () => {
  const {instance, queries} = listener(Array.from({length: 100}, (_, index) => donation('', {index})));
  const parsed = await instance._queryLogsChunk(100, 110);
  assert.equal(parsed.length, 100);
  assert.equal(queries.length, 1);
});

test('verified ranges preserve canonical log metadata and reject malformed known events', async () => {
  const valid = {...log(coreInterface, 'ArtworkRegistered', [28, CREATOR, 'ipfs://work'], CORE, 101, 1),
    transactionIndex: 3, removed: false};
  const {instance} = listener([valid]);
  const [event] = await instance.queryAllHistoricalEvents(100, 110, {strict: true});
  assert.equal(event.blockHash, valid.blockHash);
  assert.equal(event.transactionIndex, 3); assert.equal(event.removed, false);
  for (const broken of [{...valid, data: '0x'}, {...valid, address: FOREIGN}, {...donation('valid'), data: '0x'}]) {
    const {instance: bad} = listener([valid, broken]);
    await assert.rejects(bad.queryAllHistoricalEvents(100, 110, {strict: true}), /invalid event/);
  }
});

test('verified chunked reads keep strict parsing on every chunk and allow unknown valid topics', async () => {
  const unknown = {address: CORE, topics: [hash(998)], data: '0x', blockNumber: 100, index: 0};
  const {instance} = listener([unknown]);
  instance.maxBlockRange = 5;
  let count = 0;
  instance.provider.getLogs = async () => ++count === 1 ? [unknown] : [{...donation('broken'), data: '0x'}];
  await assert.rejects(instance.queryAllHistoricalEvents(100, 110, {strict: true}), /invalid event/);
  assert.equal(count, 2);
  const {instance: valid} = listener([unknown]);
  assert.deepEqual(await valid.queryAllHistoricalEvents(100, 110, {strict: true}), []);
});
