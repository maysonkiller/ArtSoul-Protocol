import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseUserEthAmount } from '../src/features/auction/eth-amount.js';
import { inspectAuctionCreation } from '../src/features/auction/auction-creation.js';

const CREATOR = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const artworkSource = fs.readFileSync('src/entries/artwork.jsx', 'utf8');
const profileSource = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const slice = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length));

for (const [input, eth, wei] of [
    ['0.001', '0.001', 1000000000000000n], ['0,001', '0.001', 1000000000000000n],
    ['  000.00100  ', '0.001', 1000000000000000n], ['1', '1', 10n ** 18n],
    ['0.000000000000000001', '0.000000000000000001', 1n],
    ['1234567890123456', '1234567890123456', 1234567890123456n * 10n ** 18n]
]) test(`user ETH amount ${JSON.stringify(input)} converts exactly`, () => {
    assert.deepEqual(parseUserEthAmount(input), { eth, wei });
});

for (const input of ['', ' ', null, '0', '-1', '1e-3', '.001', '1.', '1,2.3', '0,,001', '1_000', '1 000', 'NaN', 'Infinity', '0.0000000000000000001', '9'.repeat(61)]) {
    test(`invalid user amount ${JSON.stringify(input)} is rejected without rounding`, () => assert.throws(() => parseUserEthAmount(input)));
}

function environment({ account = CREATOR, chain = '0x14a34', minted = false, tokenId = '0', activeAuctionId = '0', creator = CREATOR, getArtworkError } = {}) {
    const calls = { reads: 0, init: 0, rpc: [] };
    const state = { account, chain };
    const provider = { request: async ({ method }) => {
        calls.rpc.push(method);
        if (method === 'eth_accounts') return state.account ? [state.account] : [];
        if (method === 'eth_chainId') return state.chain;
        throw new Error(`Unexpected wallet request ${method}`);
    } };
    const contracts = {
        init: async () => { calls.init++; },
        getArtwork: async id => {
            assert.equal(id, '28');
            calls.reads++;
            if (getArtworkError) throw getArtworkError;
            return { creator, minted, tokenId, activeAuctionId };
        }
    };
    return { calls, state, provider, contracts, options: { artworkId: '28', chainId: 84532, provider, contracts } };
}

test('preflight uses current artwork, not a historical auction or rendered identity', async () => {
    const h = environment();
    assert.equal((await inspectAuctionCreation(h.options)).walletAddress, CREATOR);
    assert.equal(h.calls.reads, 1);
    assert.equal(h.calls.rpc.every(method => ['eth_accounts', 'eth_chainId'].includes(method)), true);
});

for (const [name, input, error] of [
    ['a stale card with an active auction', { activeAuctionId: '63' }, /active auction/],
    ['an already minted artwork', { minted: true }, /already minted/],
    ['a token id despite a stale minted flag', { tokenId: '7' }, /already minted/],
    ['the wrong creator address', { creator: OTHER }, /Only the artwork creator/],
    ['a changed connected account', { account: OTHER }, /Only the artwork creator/],
    ['a disconnected wallet', { account: '' }, /Connect your wallet/],
    ['the wrong provider chain', { chain: '0x1' }, /Base Sepolia/],
    ['an unavailable RPC', { getArtworkError: new Error('RPC unavailable') }, /RPC unavailable/]
]) test(`preflight blocks ${name}`, async () => {
    const h = environment(input);
    await assert.rejects(() => inspectAuctionCreation(h.options), error);
});

test('an explicit legacy or unsupported artwork chain fails before wallet access', async () => {
    const h = environment();
    for (const chainId of [11155111, 8453, 0, undefined]) {
        await assert.rejects(() => inspectAuctionCreation({ ...h.options, chainId }), /Base Sepolia/);
    }
    assert.equal(h.calls.rpc.length, 0);
});

test('a wallet switch during the artwork read fails closed and can recover', async () => {
    const h = environment();
    const read = h.contracts.getArtwork;
    h.contracts.getArtwork = async id => { const artwork = await read(id); h.state.account = OTHER; return artwork; };
    await assert.rejects(() => inspectAuctionCreation(h.options), /wallet changed/);
    h.state.account = CREATOR;
    h.contracts.getArtwork = read;
    assert.equal((await inspectAuctionCreation(h.options)).walletAddress, CREATOR);
});

test('a form opened by one account cannot authorize another account', async () => {
    const h = environment({ account: OTHER, creator: OTHER });
    await assert.rejects(() => inspectAuctionCreation({ ...h.options, expectedWallet: CREATOR }), /account changed/);
    assert.equal(h.calls.init, 0);
});

function profileHarness(input = {}) {
    const h = environment(input);
    const busy = new Set();
    const notices = [], destinations = [];
    const scope = {
        inspectAuctionCreation, URL,
        beginTransactionAction: key => { if (busy.has(key)) return ''; busy.add(key); return key; },
        finishTransactionAction: key => busy.delete(key),
        isBaseSepoliaArtwork: artwork => Number(artwork.chain_id) === 84532,
        getProfileArtworkHref: () => '/artwork/28',
        getTransactionErrorMessage: error => error.message,
        alert: message => notices.push(message),
        window: { web3Modal: { getWalletProvider: async () => h.provider }, ArtSoulContracts: h.contracts,
            location: { origin: 'https://example.test', assign: value => destinations.push(value) } }
    };
    const handler = slice(profileSource, 'async function handleStartAuction(', 'async function handleDeleteArtwork(');
    vm.runInNewContext(handler + '\nthis.start = handleStartAuction;', scope);
    return { ...h, scope, busy, notices, destinations, run: () => scope.start({ blockchain_id: '28', chain_id: 84532 }) };
}

test('profile Start uses the same detail form without prompts or a transaction', async () => {
    const h = profileHarness();
    await h.run();
    assert.deepEqual(h.destinations, ['/artwork/28?action=create-auction']);
    assert.deepEqual(h.notices, []);
    assert.equal(h.busy.size, 0);
});

test('a stale profile Start is blocked before navigation or input', async () => {
    const h = profileHarness({ activeAuctionId: '63' });
    await h.run();
    assert.equal(h.destinations.length, 0);
    assert.match(h.notices[0], /active auction/);
    assert.equal(h.busy.size, 0);
});

test('double clicking the profile action performs one preflight and one navigation', async () => {
    const h = profileHarness();
    await Promise.all([h.run(), h.run()]);
    assert.equal(h.calls.reads, 1);
    assert.equal(h.destinations.length, 1);
});

function confirmationHarness(input = {}, { price = '0,001', duration = 24, createError, createWait } = {}) {
    const h = environment(input);
    const busy = new Set();
    const errors = [], writes = [], destinations = [];
    h.contracts.createAuction = async (...args) => {
        writes.push(args);
        if (createError) throw createError;
        if (createWait) await createWait;
        return '0xconfirmed';
    };
    const scope = {
        console: { log() {}, error() {} }, parseUserEthAmount, inspectAuctionCreation,
        ensureArtworkWriteEnabled: () => true, getArtworkWriteChainId: () => 84532,
        beginTransactionAction: key => { if (busy.has(key)) return false; busy.add(key); return true; },
        finishTransactionAction: key => busy.delete(key),
        setAuctionCreationError: error => errors.push(error),
        newAuctionPrice: price, newAuctionDuration: duration,
        auctionCreationCheckRef: { current: { context: { walletAddress: CREATOR, chainId: 84532 } } },
        artwork: { blockchain_id: '28', chain_id: 84532 },
        getTransactionErrorMessage: error => error.message, alert: async () => {},
        window: { web3Modal: { getWalletProvider: async () => h.provider }, ArtSoulContracts: h.contracts,
            location: { assign: value => destinations.push(value) } }
    };
    vm.runInNewContext(slice(artworkSource, 'async function handleConfirmNewAuction()', 'async function handleEndAuction()') + '\nthis.confirm = handleConfirmNewAuction;', scope);
    return { ...h, scope, errors, writes, destinations, busy, run: scope.confirm };
}

test('confirmation normalizes a comma once, preserves exact value, and passes a wallet guard', async () => {
    const h = confirmationHarness();
    await h.run();
    assert.equal(h.writes.length, 1);
    assert.deepEqual(h.writes[0].slice(0, 3), ['28', '0.001', 24]);
    assert.equal(h.writes[0][3].expectedWallet, CREATOR);
    assert.equal(h.writes[0][3].expectedChainId, 84532);
    assert.deepEqual(h.destinations, ['/gallery#auctions']);
    assert.equal(h.busy.size, 0);
});

for (const price of ['', '0', '-1', '0,,001', '0.0000000000000000001']) {
    test(`invalid form input ${JSON.stringify(price)} remains editable and never requests a wallet`, async () => {
        const h = confirmationHarness({}, { price });
        await h.run();
        assert.equal(h.writes.length, 0);
        assert.equal(h.calls.rpc.length, 0);
        assert.equal(h.scope.newAuctionPrice, price);
        assert.ok(h.errors.at(-1));
        assert.equal(h.busy.size, 0);
    });
}

test('a new auction in another tab blocks a previously opened form', async () => {
    const h = confirmationHarness({ activeAuctionId: '63' });
    await h.run();
    assert.equal(h.writes.length, 0);
    assert.match(h.errors.at(-1), /active auction/);
    assert.equal(h.scope.newAuctionPrice, '0,001');
});

test('account or chain changes in an open form block submission', async () => {
    for (const input of [{ account: OTHER }, { chain: '0x1' }]) {
        const h = confirmationHarness(input);
        await h.run();
        assert.equal(h.writes.length, 0);
        assert.ok(h.errors.at(-1));
    }
});

test('rejected wallet requests and reverted transactions preserve the form without success', async () => {
    for (const message of ['User rejected the request', 'AuctionAlreadyActive', 'RPC unavailable']) {
        const h = confirmationHarness({}, { createError: new Error(message) });
        await h.run();
        assert.equal(h.destinations.length, 0);
        assert.equal(h.errors.at(-1), message);
        assert.equal(h.scope.newAuctionPrice, '0,001');
        assert.equal(h.busy.size, 0);
    }
});

test('double confirmation sends once and does not navigate before confirmation', async () => {
    let confirm;
    const createWait = new Promise(resolve => { confirm = resolve; });
    const h = confirmationHarness({}, { createWait });
    const first = h.run();
    await h.run();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.writes.length, 1);
    assert.equal(h.destinations.length, 0);
    confirm();
    await first;
    assert.equal(h.destinations.length, 1);
});

test('closing the form cancels guidance and never submits a transaction', () => {
    let closed = false, aborted = false;
    const scope = {
        isTransactionActionPending: () => false,
        reauctionValuationControllerRef: { current: { abort: () => { aborted = true; } } },
        auctionCreationCheckRef: { current: { context: {} } },
        setAuctionCreationError() {}, setIsNewAuctionModalOpen: value => { closed = value === false; }
    };
    vm.runInNewContext(slice(artworkSource, 'function closeNewAuctionModal()', 'async function handleConfirmNewAuction()') + '\ncloseNewAuctionModal();', scope);
    assert.equal(closed, true);
    assert.equal(aborted, true);
    assert.equal(scope.auctionCreationCheckRef.current.context, null);
});
