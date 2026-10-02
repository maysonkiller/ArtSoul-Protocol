import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createDonationOperationStore, donationIdentityKey } from '../src/features/artwork/donation-operation.js';

const address = digit => `0x${digit.repeat(40)}`;
const hash = `0x${'ab'.repeat(32)}`;
const identity = wallet => donationIdentityKey({chainId:84532, deployment:address('2'), artworkId:'28', creator:address('3'), wallet});
const a = identity(address('1')), b = identity(address('4'));
const storage = () => {
    const values = new Map();
    return {getItem:key => values.get(key) || null, setItem:(key,value) => values.set(key,value)};
};

test('support identity includes chain, deployment, artwork, creator and normalized wallet', () => {
    assert.equal(identity(address('A')), identity(address('a')));
    assert.notEqual(a, b);
    assert.equal(donationIdentityKey({chainId:1, deployment:address('2'), artworkId:'28', creator:address('3'), wallet:address('1')}), '');
    assert.equal(identity(''), '');
});

test('wallet A can return while pending without creating another payment or mixing B state', () => {
    const operations = createDonationOperationStore(storage());
    assert.equal(operations.begin(a), true);
    assert.equal(operations.read(b), null);
    assert.equal(operations.begin(b), true);
    assert.equal(operations.begin(a), false);
    operations.update(a, {status:'unverified', hash});
    assert.equal(operations.begin(a), false);
    assert.equal(operations.read(a).hash, hash);
    assert.equal(operations.read(b).hash, '');
});

test('a late A outcome updates only A subscribers while B remains pending', () => {
    const operations = createDonationOperationStore(storage()), observed = [];
    operations.begin(a); operations.begin(b);
    const stop = operations.subscribe(a, record => observed.push(record.status));
    operations.subscribe(b, () => assert.fail('A outcome must not notify B'));
    operations.update(a, {status:'pending', hash});
    operations.update(a, {status:'confirmed', hash});
    assert.deepEqual(observed, ['pending','confirmed']);
    assert.equal(operations.read(b).status, 'pending');
    stop();
    operations.clear(a);
    assert.equal(observed.length, 2);
});

test('a broadcast hash survives tab reload as unverified without auto-resubmission', () => {
    const tab = storage(), operations = createDonationOperationStore(tab);
    operations.begin(a); operations.update(a, {status:'pending', hash});
    const restored = createDonationOperationStore(tab);
    assert.deepEqual(restored.read(a), {status:'unverified', hash});
    assert.equal(restored.begin(a), false);
    assert.equal(restored.read(b), null);
});

test('known confirmation and explicit rejection clear reload locks', () => {
    const tab = storage(), operations = createDonationOperationStore(tab);
    operations.begin(a); operations.update(a, {status:'pending', hash});
    operations.update(a, {status:'confirmed', hash});
    assert.equal(createDonationOperationStore(tab).read(a), null);
    assert.equal(operations.begin(a), false, 'the confirmed form stays locked within the page');
    operations.begin(b); operations.update(b, {status:'pending', hash});
    operations.clear(b);
    assert.equal(operations.begin(b), true, 'a known rejected/reverted action can be reviewed again');
});

test('a recovered revert still requires explicit review before another payment', () => {
    const tab=storage(), operations=createDonationOperationStore(tab);
    operations.begin(a); operations.update(a,{status:'reverted',hash});
    assert.equal(operations.begin(a),false);
    assert.equal(createDonationOperationStore(tab).read(a).status,'unverified');
    operations.clear(a);
    assert.equal(operations.begin(a),true);
});

test('storage refusal does not remove an in-flight identity guard', () => {
    const operations = createDonationOperationStore({getItem(){throw new Error('Denied');}, setItem(){throw new Error('Denied');}});
    assert.equal(operations.begin(a), true);
    operations.update(a, {status:'unverified', hash});
    assert.equal(operations.begin(a), false);
    assert.equal(operations.read(a).hash, hash);
});

test('bounded storage cannot evict unresolved payments to make room for another', () => {
    const operations = createDonationOperationStore(storage());
    for(let index=1;index<=20;index++) {
        const wallet = `0x${index.toString(16).padStart(40,'0')}`;
        assert.equal(operations.begin(identity(wallet)), true);
    }
    assert.throws(() => operations.begin(identity(address('f'))), /unresolved support/);
    operations.update(identity(`0x${'1'.padStart(40,'0')}`), {status:'confirmed', hash});
    assert.equal(operations.begin(identity(address('f'))), true);
});

const component = fs.readFileSync('src/features/artwork/artist-support.jsx', 'utf8');
const recoverySource = component.slice(component.indexOf('async function checkTransaction()'), component.indexOf('async function submit(')).trim();
function recoveryHarness() {
    const operations = createDonationOperationStore(storage()), pending = [];
    operations.begin(a); operations.update(a, {status:'unverified', hash});
    const scope = {donationOperations:operations, identity:a, receipt:hash,
        connectedWallet:address('1'), deployment:{address:address('2')}, artworkId:'28', creator:address('3'),
        busyRef:{current:false}, generation:{current:0},
        setBusy() {}, setChecking() {}, setError() {},
        window:{ArtSoulContracts:{checkArtistDonation:() => new Promise(resolve => pending.push(resolve))}}};
    return {operations, pending, scope, check:vm.runInNewContext(`(${recoverySource})`, scope)};
}

test('an old receipt check cannot replace a newer payment after wallet changes and explicit retry', async () => {
    const h = recoveryHarness();
    const oldCheck = h.check();
    h.scope.generation.current++; h.scope.busyRef.current = false;
    const currentCheck = h.check();
    h.pending[1]({status:'reverted', hash}); await currentCheck;
    h.operations.clear(a); h.operations.begin(a);
    const nextHash = `0x${'cd'.repeat(32)}`;
    h.operations.update(a, {status:'pending', hash:nextHash});
    h.pending[0]({status:'reverted', hash}); await oldCheck;
    assert.deepEqual(h.operations.read(a), {status:'pending', hash:nextHash});
    assert.equal(h.operations.begin(a), false, 'the newer payment remains locked');
});

test('a late receipt check is retained for its original wallet when that operation is unchanged', async () => {
    const h = recoveryHarness();
    const check = h.check(); h.scope.generation.current++;
    h.pending[0]({status:'confirmed', hash}); await check;
    assert.deepEqual(h.operations.read(a), {status:'confirmed', hash});
    assert.equal(h.operations.read(b), null);
});
