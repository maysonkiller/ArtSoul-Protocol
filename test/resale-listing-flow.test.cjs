const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const ethers = require('ethers');

const source = fs.readFileSync('contracts-integration.js', 'utf8').replace(/^import .*;\r?\n/gm, '');
const CORE = `0x${'1'.repeat(40)}`;
const NFT = `0x${'2'.repeat(40)}`;
const SELLER = `0x${'3'.repeat(40)}`;
const OTHER = `0x${'4'.repeat(40)}`;
const HASH = `0x${'a'.repeat(64)}`;
const REPLACEMENT_HASH = `0x${'b'.repeat(64)}`;
const FLOOR = ethers.parseEther('0.001000000000000001');
const REVIEW = { expectedWallet: SELLER, expectedChainId: 84532 };

// Exercise the shipped adapter and its real Ether parser/receipt guards.
// Network setup, EIP-1193 account reads and contract transports are local
// fixtures only: these tests never connect to a wallet, RPC or live contract.
function fixture({ needsApproval = false, owner = SELLER, listingSeller = SELLER, active = true, waits = {} } = {}) {
    const writes = [], reads = [], records = [], steps = [];
    const state = { account: SELLER, signer: SELLER, chain: '0x14a34', owner,
        approved: needsApproval ? ethers.ZeroAddress : CORE,
        listing: { seller: listingSeller, price: FLOOR, active },
        artworks: {
            4: { minted: true, tokenId: 8n, canonicalFloor: FLOOR },
            19: { minted: true, tokenId: 4n, canonicalFloor: FLOOR + 1n },
            9: { minted: false, tokenId: 0n, canonicalFloor: 0n }
        }, tokenArtwork: { 4: 19n, 8: 4n } };
    const provider = { async request({ method }) {
        if (method === 'eth_accounts') return [state.account];
        if (method === 'eth_chainId') return state.chain;
        throw new Error(`Unexpected wallet method ${method}`);
    } };
    const window = { web3Modal: { getWalletProvider: async () => provider },
        ArtSoulDB: { recordConfirmedResale(record) { records.push(record); } } };
    vm.runInNewContext(`${source}\nwindow.resaleCoreABI = CORE_ABI;`, {
        window, ethers, console: { log() {}, warn() {}, error() {} }
    });
    const api = window.ArtSoulContracts;
    const iface = new ethers.Interface(window.resaleCoreABI);
    const nftInterface = new ethers.Interface(['function approve(address,uint256)']);
    const receipt = { status: 1, hash: HASH, blockNumber: 100, index: 2, logs: [] };
    const transaction = (method, args) => {
        writes.push({ method, args });
        const tx = { hash: HASH, to: method === 'approve' ? NFT : CORE, value: 0n,
            data: (method === 'approve' ? nftInterface : iface).encodeFunctionData(method, args) };
        tx.wait = async () => {
            const result = waits[method] ? await waits[method]({ tx, state, receipt }) : receipt;
            if (Number(result?.status) === 1) {
                if (method === 'approve') state.approved = CORE;
                if (method === 'listResale') state.listing = { seller: state.signer, price: args[1], active: true };
                if (method === 'cancelResale') state.listing.active = false;
            }
            return result;
        };
        return tx;
    };
    api.ensureBaseSepoliaWrite = async () => { reads.push(['network-gate']); };
    api.signer = { getAddress: async () => state.signer };
    api.coreContract = {
        getAddress: async () => CORE,
        tokenToArtwork: async id => { reads.push(['tokenToArtwork', String(id)]); return state.tokenArtwork[String(id)] || 0n; },
        artworks: async id => { reads.push(['artworks', String(id)]); return state.artworks[String(id)]; },
        resaleListings: async id => { reads.push(['resaleListings', String(id)]); return state.listing; },
        listResale: async (...args) => transaction('listResale', args),
        cancelResale: async (...args) => transaction('cancelResale', args)
    };
    api.nftContract = {
        getAddress: async () => NFT,
        ownerOf: async id => { reads.push(['ownerOf', String(id)]); return state.owner; },
        getApproved: async () => state.approved,
        isApprovedForAll: async () => false,
        approve: async (...args) => transaction('approve', args)
    };
    const onStep = value => steps.push({ step: value.step, totalSteps: value.totalSteps });
    return { api, state, writes, reads, records, steps, onStep, receipt, window };
}

test('listing resolves explicit artwork and token namespaces even when their numbers collide', async () => {
    const f = fixture();
    await f.api.listResale(4, '0.002', undefined, { ...REVIEW, idType: 'artwork' });
    await f.api.listResale(4, '0.002', undefined, REVIEW);
    assert.deepEqual(f.writes.map(write => [write.method, String(write.args[0])]), [['listResale', '8'], ['listResale', '4']]);
    assert.deepEqual(f.records.map(record => [record.artwork_id, record.token_id]), [['4', '8'], ['19', '4']]);
    assert.equal((await f.api.getResaleListing(4, { idType: 'artwork' })).tokenId, '8');
    assert.equal((await f.api.getResaleListing(4)).tokenId, '4');
});

test('unminted artwork and invalid namespaces cannot fall back to another NFT', async () => {
    const f = fixture();
    await assert.rejects(f.api.listResale(9, '1', undefined, { ...REVIEW, idType: 'artwork' }), /not minted/);
    await assert.rejects(f.api.cancelResale(4, { ...REVIEW, idType: 'guess' }), /id type/);
    assert.equal(f.writes.length, 0); assert.equal(f.records.length, 0);
});

test('initial listing and repricing accept the exact floor without rounding a wei', async () => {
    const f = fixture({ active: false });
    const options = { ...REVIEW, idType: 'artwork' };
    await f.api.listResale(4, ethers.formatEther(FLOOR), f.onStep, options);
    await f.api.listResale(4, ethers.formatEther(FLOOR + 1n), f.onStep, options);
    await f.api.listResale(4, ethers.formatEther(FLOOR), f.onStep, options);
    assert.deepEqual(f.writes.map(write => write.args[1]), [FLOOR, FLOOR + 1n, FLOOR]);
    assert.equal(f.state.artworks[4].canonicalFloor, FLOOR);
    assert.equal(f.records.at(-1).price, '0.001000000000000001');
    assert.deepEqual(f.steps, [{ step: 1, totalSteps: 1 }, { step: 1, totalSteps: 1 }, { step: 1, totalSteps: 1 }]);
});

test('below-floor and invalid prices fail before approval or listing writes', async () => {
    for (const active of [true, false]) {
        for (const price of [ethers.formatEther(FLOOR - 1n), '0', '-1', '', 'NaN', '0.0010000000000000001']) {
            const f = fixture({ needsApproval: true, active });
            await assert.rejects(f.api.listResale(4, price, undefined, { ...REVIEW, idType: 'artwork' }));
            assert.equal(f.writes.length, 0, `${active}:${price}`);
            assert.equal(f.records.length, 0);
        }
    }
    const f = fixture();
    await assert.rejects(f.api.listResale(4, ethers.formatEther(FLOOR), undefined, REVIEW), /canonical floor/);
    assert.equal(f.writes.length, 0, 'token namespace must use artwork19 floor, not artwork4 floor');
});

test('only the current NFT owner can create or reprice a listing', async () => {
    for (const active of [true, false]) {
        const f = fixture({ owner: OTHER, needsApproval: true, active });
        await assert.rejects(f.api.listResale(4, '0.002', undefined, { ...REVIEW, idType: 'artwork' }), /current NFT owner/);
        assert.equal(f.writes.length, 0); assert.equal(f.records.length, 0);
    }
});

test('the original seller can cancel after ownership moves, using either explicit namespace', async () => {
    for (const idType of ['artwork', 'token']) {
        const f = fixture({ owner: OTHER });
        const hash = await f.api.cancelResale(4, { ...REVIEW, idType });
        assert.equal(hash, HASH);
        assert.equal(f.writes[0].args[0], idType === 'artwork' ? 8n : 4n);
        assert.equal(f.records[0].active, false); assert.equal(f.records[0].seller, SELLER);
        assert.equal(f.records[0].block_number, 100); assert.equal(f.records[0].transaction_index, 2);
    }
});

test('cancellation rejects a foreign seller or an inactive listing without wallet writes', async () => {
    for (const input of [{ listingSeller: OTHER }, { active: false }]) {
        const f = fixture(input);
        await assert.rejects(f.api.cancelResale(4, { ...REVIEW, idType: 'artwork' }), /seller|no longer listed/);
        assert.equal(f.writes.length, 0); assert.equal(f.records.length, 0);
    }
});

test('approval is confirmed before listing and never publishes a listing receipt itself', async () => {
    let release, entered;
    const waiting = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    const f = fixture({ needsApproval: true, waits: { approve: async ({ receipt }) => { entered(); await waiting; return receipt; } } });
    const action = f.api.listResale(4, '0.002', f.onStep, { ...REVIEW, idType: 'artwork' });
    await started;
    assert.deepEqual(f.writes.map(write => write.method), ['approve']); assert.equal(f.records.length, 0);
    release(); await action;
    assert.deepEqual(f.writes.map(write => write.method), ['approve', 'listResale']);
    assert.equal(f.records.length, 1);
    assert.deepEqual(f.steps, [{ step: 1, totalSteps: 2 }, { step: 2, totalSteps: 2 }]);
});

test('account, signer and chain changes after approval cannot send the listing transaction', async () => {
    for (const mutate of [state => { state.account = OTHER; }, state => { state.signer = OTHER; }, state => { state.chain = '0x1'; }]) {
        const f = fixture({ needsApproval: true, waits: { approve: async ({ state, receipt }) => { mutate(state); return receipt; } } });
        await assert.rejects(f.api.listResale(4, '0.002', undefined, { ...REVIEW, idType: 'artwork' }), /wallet changed|network changed/);
        assert.deepEqual(f.writes.map(write => write.method), ['approve']); assert.equal(f.records.length, 0);
    }
});

test('wallet changes during cancellation preflight are rejected before submission', async () => {
    const f = fixture();
    f.api.coreContract.resaleListings = async () => { f.state.account = OTHER; return f.state.listing; };
    await assert.rejects(f.api.cancelResale(4, { ...REVIEW, idType: 'artwork' }), /wallet changed/);
    assert.equal(f.writes.length, 0); assert.equal(f.records.length, 0);
});

test('missing, reverted and rejected approval or sale confirmations never publish receipt state', async () => {
    const failures = [async () => null, async () => ({ status: 0 }), async () => { throw Object.assign(new Error('Rejected'), { code: 'ACTION_REJECTED' }); }];
    for (const method of ['approve', 'listResale', 'cancelResale']) {
        for (const wait of failures) {
            const f = fixture({ needsApproval: method === 'approve', waits: { [method]: wait } });
            const action = method === 'cancelResale'
                ? f.api.cancelResale(4, { ...REVIEW, idType: 'artwork' })
                : f.api.listResale(4, '0.002', undefined, { ...REVIEW, idType: 'artwork' });
            await assert.rejects(action);
            assert.equal(f.records.length, 0);
            if (method === 'approve') assert.deepEqual(f.writes.map(write => write.method), ['approve']);
        }
    }
});

test('pending listing and cancellation transactions do not publish state before confirmation', async () => {
    for (const method of ['listResale', 'cancelResale']) {
        let release, entered;
        const pending = new Promise(resolve => { release = resolve; });
        const started = new Promise(resolve => { entered = resolve; });
        const f = fixture({ waits: { [method]: async ({ receipt }) => { entered(); await pending; return receipt; } } });
        const action = method === 'cancelResale'
            ? f.api.cancelResale(4, { ...REVIEW, idType: 'artwork' })
            : f.api.listResale(4, '0.002', undefined, { ...REVIEW, idType: 'artwork' });
        await started; assert.equal(f.records.length, 0);
        release(); await action; assert.equal(f.records.length, 1);
        assert.equal(f.records[0].chain_id, 84532);
        assert.equal(f.records[0].active, method === 'listResale');
    }
});

test('gas-only replacements publish the confirmed replacement hash for listing and cancellation', async () => {
    for (const method of ['listResale', 'cancelResale']) {
        const f = fixture({ waits: { [method]: async ({ tx, receipt }) => { throw {
            code: 'TRANSACTION_REPLACED', reason: 'repriced', cancelled: false,
            replacement: { to: tx.to, data: tx.data, value: tx.value }, receipt: { ...receipt, hash: REPLACEMENT_HASH }
        }; } } });
        const result = method === 'cancelResale'
            ? await f.api.cancelResale(4, { ...REVIEW, idType: 'artwork' })
            : await f.api.listResale(4, '0.002', undefined, { ...REVIEW, idType: 'artwork' });
        assert.equal(result, REPLACEMENT_HASH); assert.equal(f.records[0].transaction_hash, REPLACEMENT_HASH);
    }
});

test('a confirmed gas-only approval replacement permits only the reviewed listing afterward', async () => {
    const f = fixture({ needsApproval: true, waits: { approve: async ({ tx, receipt }) => { throw {
        code: 'TRANSACTION_REPLACED', reason: 'repriced', cancelled: false,
        replacement: { to: tx.to, data: tx.data, value: tx.value }, receipt: { ...receipt, hash: REPLACEMENT_HASH }
    }; } } });
    assert.equal(await f.api.listResale(4, '0.002', undefined, { ...REVIEW, idType: 'artwork' }), HASH);
    assert.deepEqual(f.writes.map(write => write.method), ['approve', 'listResale']);
    assert.equal(f.records.length, 1); assert.equal(f.records[0].transaction_hash, HASH);
});

test('cancellation and different-intent replacements cannot publish successful resale state', async () => {
    const changes = [error => { error.cancelled = true; }, error => { error.reason = 'cancelled'; },
        error => { error.reason = 'replaced'; }, error => { error.replacement.to = OTHER; },
        error => { error.replacement.data = '0x1234'; }, error => { error.replacement.value = 1n; },
        error => { error.receipt.status = 0; }];
    for (const method of ['approve', 'listResale', 'cancelResale']) {
        for (const change of changes) {
            const f = fixture({ needsApproval: method === 'approve', waits: { [method]: async ({ tx, receipt }) => {
                const error = { code: 'TRANSACTION_REPLACED', reason: 'repriced', cancelled: false,
                    replacement: { to: tx.to, data: tx.data, value: tx.value }, receipt: { ...receipt, hash: REPLACEMENT_HASH } };
                change(error); throw error;
            } } });
            await assert.rejects(method === 'cancelResale'
                ? f.api.cancelResale(4, { ...REVIEW, idType: 'artwork' })
                : f.api.listResale(4, '0.002', undefined, { ...REVIEW, idType: 'artwork' }));
            assert.equal(f.records.length, 0);
            if (method === 'approve') assert.deepEqual(f.writes.map(write => write.method), ['approve']);
        }
    }
});

test('a confirmed sale action stays successful if optional browser persistence fails', async () => {
    const f = fixture();
    f.window.ArtSoulDB.recordConfirmedResale = () => { throw new Error('storage unavailable'); };
    assert.equal(await f.api.listResale(4, '0.002', undefined, { ...REVIEW, idType: 'artwork' }), HASH);
});

test('resale review reads live identity, floor and listing without switching network or requesting a signature', async () => {
    const f = fixture();
    const state = await f.api.getResaleManagementState('19', { idType: 'artwork' });
    assert.equal(state.artworkId, '19'); assert.equal(state.tokenId, '4');
    assert.equal(state.wallet, SELLER); assert.equal(state.chainId, 84532);
    assert.equal(state.coreAddress, CORE); assert.equal(state.nftAddress, NFT);
    assert.equal(state.canonicalFloor, ethers.formatEther(FLOOR + 1n));
    assert.equal(state.listing.price, ethers.formatEther(FLOOR));
    assert.equal(f.writes.length, 0); assert.equal(f.reads.some(read => read[0] === 'network-gate'), false);
    f.state.chain = '0x1';
    await assert.rejects(f.api.getResaleManagementState('19', { idType: 'artwork' }), /network changed/);
});

test('reviewed listing changes are rejected before approval, listing or cancellation', async () => {
    for (const cancel of [false, true]) {
        for (const mutate of [f => { f.state.listing.active = false; }, f => { f.state.listing.price += 1n; },
            f => { f.state.listing.seller = OTHER; }, f => { f.api.coreContract.getAddress = async () => OTHER; },
            f => { f.api.nftContract.getAddress = async () => OTHER; }]) {
            const f = fixture({ needsApproval: true });
            const expectedResale = await f.api.getResaleManagementState('4', { idType: 'artwork' });
            mutate(f);
            const options = { ...REVIEW, idType: 'artwork', expectedResale };
            await assert.rejects(cancel ? f.api.cancelResale('4', options) : f.api.listResale('4', '0.002', undefined, options));
            assert.equal(f.writes.length, 0); assert.equal(f.records.length, 0);
        }
    }
});

test('approval waits cannot silently overwrite a changed listing, floor or owner', async () => {
    for (const mutate of [state => { state.listing.price += 1n; }, state => { state.listing.active = false; },
        state => { state.owner = OTHER; }, state => { state.artworks[4].canonicalFloor += 1n; }]) {
        const f = fixture({ needsApproval: true, waits: { approve: async ({ state, receipt }) => { mutate(state); return receipt; } } });
        const expectedResale = await f.api.getResaleManagementState('4', { idType: 'artwork' });
        await assert.rejects(f.api.listResale('4', '0.002', undefined, { ...REVIEW, idType: 'artwork', expectedResale }), /listing changed/);
        assert.deepEqual(f.writes.map(write => write.method), ['approve']); assert.equal(f.records.length, 0);
    }
});

test('the original seller can cancel a reviewed listing after ownership transfers', async () => {
    const f = fixture();
    const expectedResale = await f.api.getResaleManagementState('4', { idType: 'artwork' });
    f.state.owner = OTHER;
    assert.equal(await f.api.cancelResale('4', { ...REVIEW, idType: 'artwork', expectedResale }), HASH);
    assert.deepEqual(f.writes.map(write => write.method), ['cancelResale']);
    assert.equal(f.state.owner, OTHER);
});

test('adapter replacement at the final awaited check never reaches a replacement writer', async () => {
    for (const method of ['approve', 'listResale', 'cancelResale']) {
        for (const field of ['coreContract', 'nftContract', 'signer', 'provider']) {
            const f = fixture({ needsApproval: method === 'approve' });
            const expectedResale = await f.api.getResaleManagementState('4', { idType: 'artwork' });
            const originalCheck = method === 'approve' ? f.api.assertReviewedResale : f.api.assertExpectedWallet;
            let checks = 0;
            // Listing checks the wallet at entry and immediately before its write.
            // Nested review reads also check it twice; mutate after the final one.
            const checkName = method === 'approve' ? 'assertReviewedResale' : 'assertExpectedWallet';
            const lastCheck = method === 'approve' ? 2 : method === 'listResale' ? 6 : 4;
            f.api[checkName] = async function (...args) {
                await originalCheck.apply(this, args);
                if (++checks === lastCheck) this[field] = { ...this[field] };
            };
            const options = { ...REVIEW, idType: 'artwork', expectedResale };
            await assert.rejects(method === 'cancelResale' ? f.api.cancelResale('4', options)
                : f.api.listResale('4', '0.002', undefined, options), /connection changed/);
            assert.equal(f.writes.length, 0, `${method}/${field}`);
        }
    }
});
