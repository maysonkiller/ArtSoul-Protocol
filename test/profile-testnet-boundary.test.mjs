import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildDiscoveryProjection, computeTrustWeight } from '../src/indexer/discovery-projections.js';

const source = fs.readFileSync(new URL('../src/entries/profile.jsx', import.meta.url), 'utf8');
test('active product profile explorer points to Base Sepolia and rejects malformed addresses', () => {
    const code = source.match(/function getExplorerAddressUrl\(address\) \{[\s\S]*?\n            \}/)?.[0];
    assert.ok(code);
    const getUrl = new Function(`${code}; return getExplorerAddressUrl;`)();
    const address = '0x' + '1'.repeat(40);
    assert.equal(getUrl(address), 'https://sepolia.basescan.org/address/' + address);
    for (const input of [null, '', 'javascript:alert(1)', address + '/extra']) assert.equal(getUrl(input), null);
});

test('neither large testnet activity nor prototype flags can satisfy invented Genesis requirements', () => {
    const context = vm.createContext({ window: {} });
    vm.runInContext(fs.readFileSync(new URL('../src/features/discovery/discovery-service.js', import.meta.url), 'utf8'), context);
    const progress = context.window.ArtSoulDiscovery.getGenesisProgress(
        { wallet_address: '0x' + '1'.repeat(40), genesis_holder: true, has_genesis: true, successful_settlements: 1000 },
        Array.from({ length: 100 }, () => ({ status: 'settled' })),
        { genesisOwned: true, auctionParticipations: 1000, successfulSettlements: 1000, interactionCount: 1000 }
    );
    assert.equal(progress.eligible, false);
    assert.equal(progress.completed, 0);
    assert.equal(progress.total, 0);
    assert.equal(progress.requirements.length, 0);
    assert.equal(progress.availability, 'mainnet-only');
    const status = fs.readFileSync(new URL('../src/features/profile/genesis-status.jsx', import.meta.url), 'utf8');
    assert.match(status, /Testnet does not qualify\./);
    assert.doesNotMatch(source, /'Genesis Holder'|genesisProgress\.completed/);
});

test('prototype mints and unverified profile fields cannot confer Genesis status or improve discovery', () => {
    const context = vm.createContext({ window: {} });
    vm.runInContext(fs.readFileSync(new URL('../src/features/discovery/discovery-service.js', import.meta.url), 'utf8'), context);
    const { computeTrustProfile } = context.window.ArtSoulDiscovery;
    const creator = '0x' + '1'.repeat(40);
    const profile = { wallet_address: creator, auction_participations: 1 };
    const baseline = computeTrustProfile(profile);
    const claimed = computeTrustProfile({ ...profile, genesis_holder: true, has_genesis: true }, [], { genesisOwned: true });
    assert.deepEqual(claimed, baseline);
    assert.equal(claimed.signals.genesisOwned, false);

    const artworks = [{ id: '34', creator, vote_count: 4 }];
    const events = [{ name: 'ArtworkRegistered', args: { creator } }];
    const normal = buildDiscoveryProjection({ artworks, events });
    const prototype = { name: 'ProjectNFTMinted', args: { user: creator } };
    for (const chainId of [84532, 11155111]) {
        const fromPrototype = buildDiscoveryProjection({ artworks, events: [...events, { ...prototype, chainId }],
            externalSignals: { [creator]: { genesisOwned: true } } });
        assert.deepEqual(fromPrototype, normal);
        assert.equal(fromPrototype.trust[0].genesisOwned, false);
    }
    assert.deepEqual(computeTrustWeight({ genesisOwned: true }), computeTrustWeight());
});
