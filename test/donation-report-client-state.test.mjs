import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/entries/artwork.jsx', 'utf8');
const submitSource = source.slice(source.indexOf('async function submitArtworkReport'), source.indexOf('async function passkeyApi')).trim();
const wallet = `0x${'11'.repeat(20)}`;
const target = {transaction_hash: `0x${'55'.repeat(32)}`, log_index: 1};
function setup({donation = target, authenticate = async () => true} = {}) {
    const state = {wallet, errors: [], receipts: [], writes: [], busy: false};
    const reportSubmissionRef = {current: false};
    const submit = vm.runInNewContext(`(${submitSource})`, {
        artwork: {chain_id: 84532, artwork_id: '28'}, v41CompositeId: null,
        artworkReport: {category: 'spam', details: 'Please review this message.', referenceUrl: '', goodFaithConfirmed: true},
        reportDonationTarget: donation, reportSubmissionRef,
        window: {getCurrentWalletAddress: () => state.wallet, ensureAuthenticated: authenticate},
        setReportError: value => state.errors.push(value),
        setReportBusy: value => {state.busy = value;},
        setReportReceipt: value => state.receipts.push(value),
        fetch: async (path, options) => {
            state.writes.push({path, body: JSON.parse(options.body)});
            return {ok: true, json: async () => ({report: {reference: 'local-report'}})};
        }
    });
    return {state, reportSubmissionRef, submit: () => submit({preventDefault() {}})};
}
function deferred() {let resolve; return {promise: new Promise(done => {resolve = done;}), resolve: value => resolve(value)};}

test('reporting a donation sends only its exact event identity plus the artwork context', async () => {
    const {state, submit} = setup(); await submit();
    assert.equal(state.writes.length, 1);
    assert.equal(state.writes[0].body.target_type, 'donation_message');
    assert.equal(state.writes[0].body.donation_transaction_hash, target.transaction_hash);
    assert.equal(state.writes[0].body.donation_log_index, 1);
    assert.equal(state.writes[0].body.artwork_id, '28');
    assert.equal(state.writes[0].body.donor, undefined);
    assert.equal(state.receipts[0].reference, 'local-report');
});

test('deferred authentication admits one submission and wallet changes prevent its write', async () => {
    const auth = deferred(); const {state, submit, reportSubmissionRef} = setup({authenticate: () => auth.promise});
    const first = submit(); await submit();
    assert.equal(state.busy, true); assert.equal(state.writes.length, 0);
    state.wallet = `0x${'22'.repeat(20)}`;
    auth.resolve(true); await first;
    assert.equal(state.writes.length, 0);
    assert.match(state.errors.at(-1), /wallet changed/);
    assert.equal(reportSubmissionRef.current, false); assert.equal(state.busy, false);
});

test('repeated submit events during sign-in produce one report', async () => {
    const auth = deferred(); const {state, submit} = setup({authenticate: () => auth.promise});
    const first = submit(); const second = submit(); auth.resolve(true);
    await Promise.all([first, second]); assert.equal(state.writes.length, 1);
});

test('ordinary reports retain the old API shape and failed sign-in can be retried', async () => {
    let signedIn = false;
    const {state, submit} = setup({donation: null, authenticate: async () => signedIn});
    await submit(); assert.equal(state.writes.length, 0); assert.equal(state.busy, false);
    signedIn = true; await submit(); assert.equal(state.writes.length, 1);
    assert.equal(state.writes[0].body.target_type, undefined);
    assert.equal(state.writes[0].body.donation_transaction_hash, undefined);
});
