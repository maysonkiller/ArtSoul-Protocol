const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = { addEventListener() {} };
vm.runInNewContext(fs.readFileSync('src/ui/artwork-url.js', 'utf8'), { window });
vm.runInNewContext(fs.readFileSync('src/ui/components/artwork-card.js', 'utf8'), { window });
const actions = window.ArtSoulArtworkCard.cardActionItems;
const creator = '0x1111111111111111111111111111111111111111';
const owner = '0x2222222222222222222222222222222222222222';
const artwork = { id: 'v41:84532:34', chain_id: 84532, blockchain_id: '34', creator, status: 'registered' };
const enabled = { reportingEnabled: true, donations: { enabled: true, chainId: 84532 } };
const labels = (...args) => Array.from(actions(...args), item => item.label);

test('guest actions follow explicit live feature flags without offering owner controls', () => {
    assert.deepEqual(labels(artwork), []);
    assert.deepEqual(labels(artwork, enabled), ['Donate', 'Report']);
    assert.deepEqual(labels(artwork, { reportingEnabled: 'true', donations: { enabled: 'true', chainId: 84532 } }), []);
    assert.deepEqual(labels(artwork, { donations: { enabled: true, chainId: 8453 } }), []);
});

test('preview menus never expose owner controls regardless of wallet or lifecycle', () => {
    for (const status of ['registered', 'defaulted', 'auction', 'settlement_pending']) {
        for (const wallet of ['', creator, owner]) {
            assert.deepEqual(labels({ ...artwork, status }, enabled, wallet), ['Donate', 'Report']);
        }
    }
    assert.deepEqual(labels({ ...artwork, minted: true, current_owner_address: owner }, {}, owner), []);
    for (const creator of ['unverified-name', '0x0000000000000000000000000000000000000000']) {
        assert.deepEqual(labels({ ...artwork, creator }, enabled), ['Report']);
    }
});

test('creation links use only indexed registration evidence and a known chain explorer', () => {
    const hash = '0x' + 'a'.repeat(64);
    const indexed = { ...artwork, source: 'v41_projection', transaction_hash: hash, auction_id: 999 };
    assert.deepEqual(labels(indexed, enabled), ['Donate', 'Report', 'Creation transaction']);
    assert.equal(actions(indexed, enabled).at(-1).href, `https://sepolia.basescan.org/tx/${hash}`);
    assert.equal(actions({ ...indexed, chain_id: 11155111 }).at(-1).href, `https://sepolia.etherscan.io/tx/${hash}`);
    for (const patch of [{ source: 'pending' }, { transaction_hash: '' }, { transaction_hash: 'javascript:alert(1)' },
        { transaction_hash: hash + '/bad' }, { chain_id: 1 }, { chain_id: 8453 }]) {
        assert.ok(!labels({ ...indexed, ...patch }, enabled).includes('Creation transaction'));
    }
    assert.ok(!labels({ ...artwork, register_tx_hash: hash, tx_hash: hash }, enabled).includes('Creation transaction'));
});

test('menu links preserve artwork identity across short and legacy URLs and never use auction IDs', () => {
    const base = actions({ ...artwork, auction_id: 999 }, enabled, creator);
    assert.equal(base.find(item => item.label === 'Donate').href, '/artwork/34?action=donate');
    const legacy = actions({ ...artwork, id: 'v41:11155111:7', chain_id: 11155111, blockchain_id: '7' }, enabled, creator);
    assert.equal(legacy.find(item => item.label === 'Report').href, '/artwork?id=v41%3A11155111%3A7&action=report');
    assert.ok(!legacy.some(item => ['Donate', 'Start auction', 'Manage artwork'].includes(item.label)));
    assert.deepEqual(labels({ id: 'pending:local' }, enabled, creator), []);
    assert.deepEqual(labels({ id: 'unknown' }, enabled, creator), []);
});

test('a report deeplink only opens the existing form after artwork and live config are ready', () => {
    const source = fs.readFileSync('src/entries/artwork.jsx', 'utf8').replace(/\r\n/g, '\n');
    const start = source.indexOf('            useEffect(() => {\n                if (!artwork || !cardActionsReady');
    assert.notEqual(start, -1);
    const end = source.indexOf('}, [artwork, cardActionsReady', start);
    const callback = source.slice(start, end).replace(/^\s*useEffect\(\(\) => \{/, '');
    const run = (overrides = {}) => {
        const events = [];
        const context = { artwork, cardActionsReady: true, cardActionOpenedRef: { current: false }, walletRenderState: { settled: true },
            window: { ...window, location: { search: '?action=report' } }, URLSearchParams,
            reportingEnabled: true, donationDeployment: enabled.donations,
            openArtworkReport: () => events.push('report'), setOpenDonationFromCard: () => events.push('donate'),
            setCardActionNotice: value => events.push(value), ...overrides };
        vm.runInNewContext(`(() => { ${callback} })()`, context);
        return events;
    };
    assert.deepEqual(run(), ['report']);
    assert.deepEqual(run({ artwork: null }), []);
    assert.deepEqual(run({ cardActionsReady: false }), []);
    assert.deepEqual(run({ cardActionOpenedRef: { current: true } }), []);
    assert.deepEqual(run({ reportingEnabled: false }), ['Reporting is unavailable for this artwork.']);
    assert.deepEqual(run({ window: { ...window, location: { search: '?action=donate' } } }), ['donate']);
    assert.deepEqual(run({ window: { ...window, location: { search: '?action=donate' } }, walletRenderState: { settled: false } }), []);
    assert.deepEqual(run({ window: { ...window, location: { search: '?action=donate' } }, donationDeployment: null }), ['Donations are unavailable for this artwork.']);
    assert.doesNotMatch(callback, /ensureAuthenticated|ensureWalletConnected|\.submit|ArtSoulContracts/);
});

test('shared menu preserves native modified links, focus and navigation boundaries through a delayed config read', async () => {
    const listeners = {};
    const document = { activeElement: null, querySelectorAll: () => menus.filter(menu => menu.open) };
    const menus = [];
    class Element {
        constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.isConnected = true; }
        appendChild(child) { this.children.push(child); return child; }
        append(...children) { this.children.push(...children); }
        replaceChildren() { if (this.contains(document.activeElement)) document.activeElement = null; this.children = []; }
        setAttribute(key, value) { this[key] = value; }
        addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
        contains(node) { return this === node || this.children.some(child => child.contains(node)); }
        focus() { document.activeElement = this; }
        async dispatch(type, properties = {}) {
            const event = { button: 0, key: '', target: this, currentTarget: this, defaultPrevented: false,
                preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...properties };
            await Promise.all((this.listeners[type] || []).map(listener => listener(event)));
            return event;
        }
    }
    document.createElement = tag => { const element = new Element(tag); if (tag === 'details') menus.push(element); return element; };
    let resolveConfig, reads = 0, starts = 0;
    const local = { currentWalletAddress: creator, ArtSoulSecurity: { isValidStorageUrl: () => true },
        ArtSoulPublicConfig: { load: () => { reads++; return new Promise(resolve => { resolveConfig = resolve; }); } },
        addEventListener: (name, callback) => { listeners[name] = callback; } };
    for (const file of ['src/ui/artwork-url.js', 'src/ui/components/artwork-card.js']) vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window: local, document });
    const fullTitle = 'A complete artwork title that does not fit in a compact card';
    const fullCreator = 'A complete creator name that also does not fit in a compact card';
    const card = local.ArtSoulArtworkCard.createCardElement({ ...artwork, source: 'v41_projection', transaction_hash: '0x' + 'b'.repeat(64), title: fullTitle, creator_name: fullCreator, start_price: '0.001', file_url: 'fixture.png' }, { onStartAuction: () => starts++ });
    assert.equal(reads, 0, 'rendering cards must not start per-card requests');
    assert.equal(card.tagName, 'div');
    assert.equal(card.children.at(-1).tagName, 'a');
    assert.equal(card.children.at(-1).href, '/artwork/34');
    assert.ok(card.children.at(-1).title.includes(fullTitle));
    assert.ok(card.children.at(-1)['aria-label'].includes(fullCreator));
    const menu = menus[0], summary = menu.children[0], list = menu.children[1].children[0];
    assert.ok(card.children.includes(menu), 'the overlay belongs to the card, outside the metadata layout');
    assert.ok(!card.children.find(child => child.className === 'artsoul-card-body').contains(menu));
    assert.equal(menu.children[1].children.length, 1, 'only requested actions, no details or management section');
    menu.open = true;
    const loading = menu.dispatch('toggle');
    const creation = list.children.find(link => link.textContent === 'Creation transaction');
    assert.equal(creation.target, '_blank');
    assert.equal(creation.rel, 'noopener noreferrer');
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) assert.equal((await creation.dispatch('click', { [modifier]: true })).defaultPrevented, false);
    assert.equal((await creation.dispatch('click')).defaultPrevented, false);
    assert.equal(starts, 0, 'menu never invokes auction management');
    menu.open = true;
    creation.focus();
    resolveConfig(enabled); await loading;
    assert.equal(document.activeElement.textContent, 'Creation transaction', 'late flags retain focused action');
    assert.deepEqual(list.children.map(link => link.textContent), ['Donate', 'Report', 'Creation transaction']);
    local.ArtSoulPublicConfigData = enabled;
    menu.open = true;
    const thirdLoading = menu.dispatch('toggle');
    list.children.find(link => link.textContent === 'Report').focus();
    resolveConfig({}); await thirdLoading;
    assert.equal(document.activeElement, summary, 'a removed action returns keyboard focus to the menu control');
    assert.equal((await menu.dispatch('click')).stopped, true);
    await menu.dispatch('keydown', { key: 'Escape' });
    assert.equal(menu.open, false); assert.equal(document.activeElement, summary);
    menu.open = true; listeners['artsoul:wallet-state-changed'](); assert.equal(menu.open, false);
    menu.open = true; listeners.click({ target: new Element('outside') }); assert.equal(menu.open, false);
    const before = menus.length;
    const disabled = local.ArtSoulArtworkCard.createCardElement({ ...artwork, file_url: 'fixture.png' }, { href: false });
    assert.equal(menus.length, before); assert.equal(disabled.children.some(child => child.tagName === 'a'), false);
});
