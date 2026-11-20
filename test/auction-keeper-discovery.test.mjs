import assert from 'node:assert/strict';
import { mkdtempSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Interface, ZeroAddress, id } from 'ethers';
import { openKeeperStore } from '../scripts/auction-keeper-discovery.mjs';

const engine = '0x0000000000000000000000000000000000000100';
const bidder = '0x0000000000000000000000000000000000000200';
const manifest = { chainId: 31337, engine, codeHash: id('fixture runtime'), startBlock: 10 };
const abi = new Interface([
    'event AuctionOpened(uint256 indexed a,uint256 indexed w,uint256 start,uint256 end)',
    'event BidAccepted(uint256 indexed a,address indexed b,uint256 price,uint256 deposit)',
    'event AuctionExtended(uint256 indexed a,uint256 oldEnd,uint256 newEnd)',
    'event AuctionClosed(uint256 indexed a,address indexed winner,uint256 deadline)',
    'event AuctionSettled(uint256 indexed a,uint256 indexed w,uint256 token,uint256 price)',
    'event AuctionDefaulted(uint256 indexed a,address indexed winner,uint256 deposit)',
    'event RunnerUpOfferOpened(uint256 indexed a,address indexed b,uint256 price,uint256 deadline)',
    'event RunnerUpOfferDeclined(uint256 indexed a,address indexed b)',
    'event RunnerUpOfferExpired(uint256 indexed a,address indexed b)'
]);
const hash = n => id('block' + n);
function log(blockNumber, index, name, values) {
    return { blockNumber, blockHash: hash(blockNumber), index, address: engine, removed: false,
        ...abi.encodeEventLog(abi.getEvent(name), values) };
}
function source(logs = []) {
    return {
        logs, ranges: [],
        async getBlock(number) { return { number, hash: hash(number), timestamp: number * 10 }; },
        async getLogs({ address, fromBlock, toBlock, topics }) {
            assert.equal(address, engine);
            assert.deepEqual([...topics[0]].sort(), abi.fragments.map(event => event.topicHash).sort());
            this.ranges.push([fromBlock, toBlock]);
            return this.logs.filter(entry => entry.blockNumber >= fromBlock && entry.blockNumber <= toBlock).reverse();
        }
    };
}
function fileFor(t) {
    const dir = mkdtempSync(join(tmpdir(), 'artsoul-keeper-discovery-'));
    const file = join(dir, 'rounds.sqlite');
    t.after(() => { unlinkSync(file); rmdirSync(dir); });
    return file;
}
const opening = (height, index, round, end) => log(height, index, 'AuctionOpened', [round, round, 1n, end]);
const bid = (height, index, round) => log(height, index, 'BidAccepted', [round, bidder, 20n, 2n]);
const due = (id, action, dueAt) => ({ id: BigInt(id), action, dueAt });

test('keeper discovers funded rounds across bounded ranges and restarts, updating extensions and strict settlement deadlines', async t => {
    const file = fileFor(t);
    const node = source([
        opening(10, 0, 1, 140), opening(10, 1, 2, 110), bid(11, 0, 1),
        log(12, 0, 'AuctionExtended', [1, 140, 160]),
        log(16, 0, 'AuctionClosed', [1, bidder, 200]),
        log(21, 0, 'AuctionDefaulted', [1, bidder, 2]),
        log(21, 1, 'RunnerUpOfferOpened', [1, bidder, 10, 250]),
        log(26, 0, 'RunnerUpOfferExpired', [1, bidder])
    ]);
    let store = openKeeperStore(file, manifest);
    try {
        assert.deepEqual(await store.sync(node, 21, { blockRange: 2, maxRanges: 2 }), { through: 13, caughtUp: false });
        assert.deepEqual(node.ranges, [[10, 11], [12, 13]]);
        assert.deepEqual(store.ready(159, 3), []);
        assert.deepEqual(store.ready(160, 3), [due(1, 'closeAuction', 160)]);
    } finally { store.close(); }
    store = openKeeperStore(file, manifest);
    try {
        await store.sync(node, 16);
        assert.deepEqual(node.ranges.at(-1), [14, 16]);
        assert.deepEqual(store.ready(200, 3), []);
        assert.deepEqual(store.ready(201, 3), [due(1, 'finalizeDefault', 201)]);
        await store.sync(node, 21);
        assert.deepEqual(store.ready(250, 3), []);
        assert.deepEqual(store.ready(251, 3), [due(1, 'expireRunnerUpOffer', 251)]);
        const offerBlock = await node.getBlock(21);
        assert.deepEqual(store.offerCandidates(offerBlock, '0', 16), {ids:['1'], nextAfterAuction:null});
        assert.throws(() => store.offerCandidates({...offerBlock, hash:hash(19)}, '0', 16), /checkpoint/);
        await store.sync(node, 26);
        assert.deepEqual(store.offerCandidates(await node.getBlock(26), '0', 16).ids, []);
        assert.deepEqual(store.ready(1000, 3), []);
    } finally { store.close(); }
});

test('the offer monitor pages known IDs in numeric order across restarts and includes the exact last second', async t => {
    const file = fileFor(t);
    const hugeId = 2n ** 255n + 3n;
    const rounds = [10n, 2n, hugeId];
    const logs = rounds.flatMap((round, i) => [
        opening(10, i * 2, round, 110), bid(10, i * 2 + 1, round),
        log(11,i,'AuctionClosed',[round,bidder,115]), log(12,i*2,'AuctionDefaulted',[round,bidder,2]),
        log(12,i*2+1,'RunnerUpOfferOpened',[round,bidder,7,140])
    ]);
    const node = source(logs);
    let store = openKeeperStore(file, manifest);
    try { await store.sync(node, 12); } finally { store.close(); }
    store = openKeeperStore(file, manifest);
    try {
        await store.sync(node, 14);
        const tip = await node.getBlock(14);
        assert.deepEqual(store.offerCandidates(tip, '0', 2), {ids:['2','10'],nextAfterAuction:'10'});
        assert.deepEqual(store.offerCandidates(tip, '10', 2), {ids:[String(hugeId)],nextAfterAuction:null});
        for (const cursor of ['01', '-1', String(2n**256n)]) assert.throws(() => store.offerCandidates(tip, cursor, 2), /cursor/);
        await store.sync(node, 15);
        assert.deepEqual(store.offerCandidates(await node.getBlock(15), '0', 2), {ids:[],nextAfterAuction:null});
    } finally { store.close(); }
});

test('bidless entries expire cheaply and scans at an idle tip cause no SQLite writes', async t => {
    const file = fileFor(t);
    const node = source([opening(10, 0, 1, 110), log(14, 0, 'AuctionClosed', [1, ZeroAddress, 0])]);
    const store = openKeeperStore(file, manifest);
    const reader = new DatabaseSync(file, { readOnly: true });
    try {
        const version = () => reader.prepare('PRAGMA data_version').get().data_version;
        const count = () => reader.prepare('SELECT count(*) AS n FROM rounds').get().n;
        await store.sync(node, 10);
        assert.equal(count(), 1);
        await store.sync(node, 11);
        assert.equal(count(), 0);
        const cleanVersion = version();
        await store.sync(node, 12);
        await store.sync(node, 12);
        assert.deepEqual(store.ready(10000, 20), []);
        assert.equal(version(), cleanVersion);
        assert.deepEqual(node.ranges, [[10, 10], [11, 11], [12, 12]]);
        await store.sync(node, 14);
        assert.equal(count(), 0);
    } finally { reader.close(); store.close(); }
});

test('delayed items release queue capacity, and user settlement or decline clears the pending lifecycle action', async () => {
    const node = source([
        opening(10, 0, 1, 110), bid(10, 1, 1), opening(10, 2, 2, 110), bid(10, 3, 2),
        log(12, 0, 'AuctionClosed', [1, bidder, 150]), log(12, 1, 'AuctionSettled', [1, 1, 1, 20]),
        log(12, 2, 'AuctionClosed', [2, bidder, 150]), log(16, 0, 'AuctionDefaulted', [2, bidder, 2]),
        log(16, 1, 'RunnerUpOfferOpened', [2, bidder, 10, 200]), log(17, 0, 'RunnerUpOfferDeclined', [2, bidder])
    ]);
    const store = openKeeperStore(':memory:', manifest);
    try {
        await store.sync(node, 11);
        assert.deepEqual(store.ready(111, 1), [due(1, 'closeAuction', 110)]);
        store.postpone(1n, 200);
        assert.deepEqual(store.ready(111, 1), [due(2, 'closeAuction', 110)]);
        await store.sync(node, 17);
        assert.deepEqual(store.ready(1000, 10), []);
    } finally { store.close(); }
});

test('a bad log or incomplete range leaves the cursor and all derived rows unmodified', async () => {
    const node = source([opening(10, 0, 1, 130), bid(10, 1, 1)]);
    const store = openKeeperStore(':memory:', manifest);
    try {
        await store.sync(node, 10);
        const correct = opening(11, 0, 2, 150);
        node.logs.push(correct, bid(11, 1, 9));
        await assert.rejects(store.sync(node, 11), /Missing auction for bid/);
        node.logs.pop();
        node.logs.push({ ...bid(11, 1, 2), blockHash: hash(500) });
        await assert.rejects(store.sync(node, 11), /noncanonical/);
        node.logs.pop();
        node.logs.push({ ...bid(11, 1, 2), removed: true });
        await assert.rejects(store.sync(node, 11), /origin/);
        node.logs.pop();
        node.logs.push(correct);
        await assert.rejects(store.sync(node, 11), /Duplicate/);
        assert.deepEqual(store.ready(200, 4), [due(1, 'closeAuction', 130)]);
        node.logs.pop();
        node.logs.push(bid(11, 1, 2));
        await store.sync(node, 11);
        assert.deepEqual(store.ready(200, 4), [due(1, 'closeAuction', 130), due(2, 'closeAuction', 150)]);
    } finally { store.close(); }
});

test('keeper fails closed on deployment mismatch and a confirmed cursor whose canonical hash changed', async t => {
    const file = fileFor(t);
    const node = source();
    let store = openKeeperStore(file, manifest);
    await store.sync(node, 15);
    store.close();
    for (const field of [{ chainId: 84532 }, { startBlock: 11 }, { codeHash: id('other') }, { engine: bidder }]) {
        assert.throws(() => openKeeperStore(file, { ...manifest, ...field }), /different deployment/);
    }
    store = openKeeperStore(file, manifest);
    try {
        await assert.rejects(store.sync(node, 14), /behind keeper checkpoint/);
        const fork = { ...node, async getBlock(number) { return { number, hash: id('fork'), timestamp: 150 }; } };
        await assert.rejects(store.sync(fork, 16), /rebuild from reviewed deployment/);
        assert.deepEqual(await store.sync(node, 16), { through: 16, caughtUp: true });
    } finally { store.close(); }
});

test('a changed empty range is discarded before closing the store', async t => {
    const file = fileFor(t);
    const node = source([opening(10, 0, 1, 500)]);
    let store = openKeeperStore(file, manifest);
    try {
        await store.sync(node, 10);
        await store.sync(node, 13);
        const fork = { ...node, async getBlock(number) { return { number, hash: id('fork'), timestamp: 130 }; } };
        await assert.rejects(store.sync(fork, 14), /checkpoint changed/);
    } finally { store.close(); }
    store = openKeeperStore(file, manifest);
    try {
        await store.sync(node, 15);
        assert.deepEqual(node.ranges.at(-1), [11, 15]);
    } finally { store.close(); }
});
