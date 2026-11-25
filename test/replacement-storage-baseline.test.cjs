const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const baseline = require('../docs/architecture/C1_REPLACEMENT_STORAGE_2026-11-19.json');
const pair = require('../docs/architecture/C1_ORDINARY_PAIR_STORAGE_2026-11-20.json');
const payout = require('../docs/architecture/C1_ORDINARY_PAYOUT_STORAGE.json');

test('the fresh contract layout record matches every normalized source in its compiler input', () => {
    assert.equal(baseline.compiler, '0.8.24+commit.e11b9ed9');
    for (const [name, { sha256 }] of [...Object.entries(baseline.sources), ...Object.entries(pair.sources), ...Object.entries(payout.sources)]) {
        assert.match(name, /^(?:contracts\/replacement\/|@openzeppelin\/contracts\/)/);
        const file = path.join(root, name.startsWith('@') ? 'node_modules' : '', name);
        const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
        assert.equal(crypto.createHash('sha256').update(source).digest('hex'), sha256, name);
    }
});

test('credit redirection preserves every storage slot, nested member and immutable role in both contracts', () => {
    function layoutShape(layout) {
        // Compiler AST numbers and instruction offsets can change when a method is added.
        const typeName = id => id === undefined ? undefined : layout.types[id].label;
        const slots = fields => fields.map(({ label, slot, offset, type }) => [label, slot, offset, typeName(type)]);
        const types = Object.values(layout.types).map(type => [type.label, {
            encoding: type.encoding, bytes: type.numberOfBytes, key: typeName(type.key),
            value: typeName(type.value), base: typeName(type.base), members: type.members && slots(type.members)
        }]);
        assert.equal(new Set(types.map(([label]) => label)).size, types.length);
        const immutables = layout.immutables.map(({ name, declaredIn, type, bytecodeReferences }) => {
            assert.ok(bytecodeReferences.length);
            return [name, declaredIn, type];
        });
        return { slots: slots(layout.storage), types: Object.fromEntries(types), immutables };
    }
    const contract = (record, name) => record.contracts[`contracts/replacement/${name}.sol:${name}`];
    for (const [before, after] of [['OrdinaryMarket', 'OrdinaryPayoutMarket'], ['SettledArtworkNFT', 'SettledArtworkNFT']]) {
        assert.deepEqual(layoutShape(contract(payout, after)), layoutShape(contract(pair, before)));
    }
});

test('the concrete ordinary pair retains every inherited slot and embeds its six Core values and NFT authority', () => {
    const qualified = name => `contracts/replacement/${name}.sol:${name}`;
    const actual = pair.contracts[qualified('OrdinaryMarket')];
    const parent = baseline.contracts[qualified('TreasuryBoundOrdinaryArt')];
    const nft = pair.contracts[qualified('SettledArtworkNFT')];
    const slots = layout => layout.storage.map(({label, slot, offset, type}) => [label, slot, offset, layout.types[type].label]);
    assert.deepEqual(slots(actual), slots(parent));
    assert.deepEqual(slots(nft), slots(baseline.contracts[qualified('SettledArtworkNFT')]));
    assert.deepEqual(actual.immutables.map(field => field.name).sort(),
        ['adminSecurity', 'ecosystemTreasury', 'nft', 'protocolTreasury', 'refundBatchLimit', 'refundTransferGas']);
    assert.deepEqual(nft.immutables.map(field => field.name), ['core']);
    assert.ok([...actual.immutables, ...nft.immutables].every(field => field.bytecodeReferences.length > 0));
});

test('the issuance binding has bytecode references while the abstract engine layouts only declare bindings', () => {
    const names = ['SettledArtworkNFT', 'OrdinaryArtAuctions', 'OutbidRefunds', 'OrdinaryArtResales', 'TreasuryBoundOrdinaryArt'];
    const targets = names.map(name => `contracts/replacement/${name}.sol:${name}`);
    assert.deepEqual(Object.keys(baseline.contracts).sort(), [...targets].sort());
    const [nft, auctions, refunds, resales, bound] = targets.map(name => baseline.contracts[name]);
    assert.deepEqual(nft.immutables.map(field => field.name), ['core']);
    assert.ok(nft.immutables[0].bytecodeReferences.length);
    for (const name of ['_tokenGrantGenerationMinusOne', '_operatorGrantGenerationMinusOne']) {
        assert.ok(nft.storage.some(field => field.label === name), name);
    }
    assert.ok(auctions.immutables.some(field => field.name === 'nft'));
    assert.ok(auctions.storage.some(field => field.label === '_externalMarkets'));
    assert.ok(resales.storage.some(field => field.label === 'resaleListings'));
    assert.ok(bound.storage.some(field => field.label === 'marketplaceAdmissionReadyAt'));
    for (const name of ['protocolTreasury', 'ecosystemTreasury', 'adminSecurity']) {
        assert.ok(bound.immutables.some(field => field.name === name), name);
    }
    for (const contract of [auctions, refunds, resales, bound]) {
        assert.ok(contract.storage.some(field => field.label === 'credits'));
        assert.ok(contract.immutables.every(field => field.bytecodeReferences.length === 0));
    }
});
