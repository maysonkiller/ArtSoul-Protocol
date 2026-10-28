import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stageCommandDraft, consumeCommandDraft, validateCommandDraft } from '../src/features/artwork/command-draft.js';

const wallet = '0x' + 'a'.repeat(40);
const id = '12345678-1234-1234-1234-123456789012';
function environment(overrides = {}) {
    const data = new Map(), paths = [];
    return { data, paths, pathname: '/gallery', wallet, now: () => 10000, randomId: () => id,
        storage: { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) },
        openPath: path => paths.push(path), clearHash() { this.hash = ''; }, ...overrides };
}

test('handoff is bounded, one-use, tab-local and keeps artwork text out of URLs', () => {
    const env = environment();
    const input = { title: '夜 🌙', description: '<img src=x> a description', start_price_eth: '0,0001' };
    assert.equal(stageCommandDraft(input, env).prepared, true);
    assert.deepEqual(env.paths, [`/upload#command-draft=${id}`]);
    env.hash = `#command-draft=${id}`;
    assert.deepEqual(consumeCommandDraft(env), { draft: { ...input, start_price_eth: '0.0001' }, wallet });
    assert.equal(env.hash, '');
    env.hash = `#command-draft=${id}`;
    assert.equal(consumeCommandDraft(env), null);
    assert.equal(env.data.size, 0);
});

test('malformed, expired, mismatched and unreadable handoffs never become form content', () => {
    for (const mutate of [
        env => { env.now = () => 310001; }, env => { env.now = () => 9999; },
        env => { env.hash = '#command-draft=bad'; },
        env => { env.data.set('artsoul.command.publication-draft', '{'); },
        env => { env.data.set('artsoul.command.publication-draft', 'x'.repeat(12001)); },
        env => { env.storage.getItem = () => { throw new Error('Blocked'); }; }
    ]) {
        const env = environment();
        stageCommandDraft({ title: 'A' }, env);
        env.hash = `#command-draft=${id}`;
        mutate(env);
        assert.equal(consumeCommandDraft(env), null);
    }
    const env = environment({ storage: { setItem() { throw new Error('Blocked'); } } });
    assert.equal(stageCommandDraft({ title: 'A' }, env).prepared, false);
    assert.deepEqual(env.paths, []);
});

test('Publish receives drafts in place and never reloads a file when its entry is not ready', () => {
    for (const pathname of ['/upload', '/upload.html', '/upload/']) {
        const env = environment({ pathname });
        assert.equal(stageCommandDraft({ title: 'A' }, env).prepared, false);
        env.showDraft = draft => ({ prepared: true, draft });
        assert.equal(stageCommandDraft({ title: 'A' }, env).prepared, true);
        assert.deepEqual(env.paths, []);
        assert.equal(env.data.size, 0);
    }
});

test('draft validation accepts Unicode and exact amounts but not hidden abilities or malformed fields', () => {
    assert.deepEqual(validateCommandDraft({ title: '  夜   🌙 ', start_price_eth: '0.000000000000000001' }), { title: '夜 🌙', start_price_eth: '0.000000000000000001' });
    for (const input of [null, [], { title: '' }, { title: {} }, { title: 'a'.repeat(301) },
        { title: 'A', description: 'x'.repeat(1001) }, { title: 'A', description: {} },
        ...['file', 'url', 'wallet', 'chain_id', 'duration_hours', 'sign', 'submit', 'admin'].map(key => ({ title: 'A', [key]: true })),
        ...['-1', '0', '1e-5', '1.1 ETH', '0.0000000000000000001'].map(start_price_eth => ({ title: 'A', start_price_eth }))]) {
        assert.throws(() => validateCommandDraft(input));
        assert.equal(stageCommandDraft(input, environment()).prepared, false);
    }
});

function uploadClient() {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, { value: '', hidden: true, textContent: '', style: {},
            events: [], scrollIntoView() {}, focus() {}, dispatchEvent(event) { this.events.push(event.type); } });
        return elements.get(id);
    };
    const script = fs.readFileSync('src/entries/upload.js', 'utf8').replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^\s*bindUploadFlow\(\);\s*$/m, '');
    const journal = { snapshot: 'unchanged', attempts: [] };
    const context = vm.createContext({ console, Event, validateCommandDraft, consumeCommandDraft,
        ALLOWED_ARTWORK_MIME_TYPES: [], document: { getElementById: element },
        readBrowserPublications: () => journal.attempts,
        window: { getCurrentWalletAddress: () => wallet, ARTSOUL_CONTRACTS: { baseSepolia: { core: wallet } } } });
    vm.runInContext(script, context);
    return { context, element, journal, run: source => vm.runInContext(source, context) };
}

test('reviewed application preserves the selected file and only fills blank fields without sending', () => {
    const c = uploadClient();
    c.run('selectedFile = { name: "original.png" };');
    const original = c.run('selectedFile');
    c.context.showCommandDraft({ title: 'Moon 🌙', description: '<script>text only</script>', start_price_eth: '0,001' });
    assert.equal(c.element('artTitle').value, '');
    assert.equal(c.context.applyCommandDraft(), true);
    assert.equal(c.element('artTitle').value, 'Moon 🌙');
    assert.equal(c.element('artPrice').value, '0.001');
    assert.deepEqual(c.element('artTitle').events, ['input', 'change']);
    assert.equal(c.run('selectedFile'), original);
    assert.equal(c.journal.snapshot, 'unchanged');
    assert.equal(c.context.applyCommandDraft(), false);
    c.context.showCommandDraft({ title: 'Moon 🌙' });
    assert.equal(c.context.applyCommandDraft(), true);
    assert.deepEqual(c.element('artTitle').events, ['input', 'change'], 'identical retries do not invalidate AI or the form');
});

test('existing edits, pending publication, AI and account changes cannot be overwritten', () => {
    for (const setup of ['uploading = true', 'authorizationInProgress = true', 'aiValuationController = {}',
        'pendingPublicationAttempt = {}', 'publishNavigationLocked = true', "submittedRegisterTxHash = '0xhash'"]) {
        const c = uploadClient();
        c.context.showCommandDraft({ title: 'New' });
        c.run(setup);
        assert.equal(c.context.applyCommandDraft(), false, setup);
        assert.equal(c.element('artTitle').value, '');
    }
    const c = uploadClient();
    c.element('artTitle').value = 'Manual edit';
    c.context.showCommandDraft({ title: 'New', description: 'New description' });
    assert.equal(c.context.applyCommandDraft(), false);
    assert.equal(c.element('artDescription').value, '', 'conflicts apply no partial fields');
    assert.equal(c.context.showCommandDraft({ title: 'Another' }).prepared, false);
    c.context.window.getCurrentWalletAddress = () => '0x' + 'b'.repeat(40);
    assert.equal(c.context.applyCommandDraft(), false);
    assert.equal(c.element('commandDraftPanel').hidden, true);
});

test('a selected file with saved recovery records is not edited by commands', () => {
    const c = uploadClient();
    c.run('selectedFile = { name: "original.png" };');
    c.journal.attempts = [{ publicationId: id }];
    c.context.showCommandDraft({ title: 'New' });
    assert.equal(c.context.applyCommandDraft(), false);
    assert.equal(c.element('artTitle').value, '');
    assert.equal(c.journal.attempts[0].publicationId, id);
});

test('deferred wallet restoration retains an incoming draft only for its original identity', () => {
    for (const state of [{ isConnected: true, address: wallet }, { isConnected: true, address: '0x' + 'b'.repeat(40) }, { isConnected: false, address: null }]) {
        const c = uploadClient();
        delete c.context.window.getCurrentWalletAddress;
        c.run(`incomingCommandDraft = { wallet: '${wallet}', draft: { title: 'Restored' } };`);
        c.context.restoreCommandDraft(null);
        assert.ok(c.run('incomingCommandDraft'), 'the page must wait for wallet restoration');
        assert.equal(c.element('commandDraftPanel').hidden, true);
        c.context.restoreCommandDraft(state);
        assert.equal(c.run('incomingCommandDraft'), null);
        assert.equal(c.element('commandDraftPanel').hidden, state.address !== wallet);
        c.context.restoreCommandDraft({ isConnected: true, address: wallet });
        assert.equal(c.element('commandDraftPanel').hidden, state.address !== wallet, 'wrong-account handoffs cannot replay');
    }
    const guest = uploadClient();
    guest.run("incomingCommandDraft = { wallet: '', draft: { title: 'Guest draft' } };");
    guest.context.restoreCommandDraft(null);
    assert.equal(guest.element('commandDraftPanel').hidden, false);
});

test('actual form binding consumes the transfer once and shows it after the settled wallet event', () => {
    const c = uploadClient(), env = environment(), handlers = new Map();
    stageCommandDraft({ title: 'Waiting for wallet' }, env);
    delete c.context.window.getCurrentWalletAddress;
    Object.assign(c.context.window, {
        location: { hash: `#command-draft=${id}`, pathname: '/upload', search: '' },
        sessionStorage: env.storage, history: { state: null, replaceState() {} },
        addEventListener: (name, handler) => handlers.set(name, handler)
    });
    // UI refresh functions are irrelevant to this ordering check; keep the
    // real binder, handoff consumer and wallet event handler under execution.
    c.run('bindDescriptionCounter = updateAIValuationRetryState = refreshSavedPublications = updatePublishReadiness = cancelAIValuation = setAIValuationState = () => {};');
    for (const field of ['applyCommandDraft','discardCommandDraft','artTitle','artDescription','artPrice','originalWorkConfirm']) c.element(field).addEventListener = () => {};
    // A fixed clock is only for this transfer's five-minute validity window.
    c.context.Date = { now: env.now };
    c.context.bindUploadFlow();
    assert.equal(env.data.size, 0);
    assert.equal(c.element('commandDraftPanel').hidden, true);
    c.context.window.getCurrentWalletAddress = () => wallet;
    handlers.get('artsoul:wallet-state-changed')({ detail: { isConnected: true, address: wallet } });
    assert.equal(c.element('commandDraftPanel').hidden, false);
    assert.match(c.element('commandDraftDetails').textContent, /Waiting for wallet/);
    assert.equal(c.element('artTitle').value, '');
    handlers.get('artsoul:wallet-state-changed')({ detail: { isConnected: false, address: '' } });
    assert.equal(c.element('commandDraftPanel').hidden, true);
});
