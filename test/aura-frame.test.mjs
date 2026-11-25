import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auraFrameClassName, projectedArtworkAura } from '../src/ui/components/aura-frame.js';

test('aura presentation is absent unless the caller supplies one supported kind', () => {
    const unsafeClaim = {
        genesis: true,
        partner: true,
        toString() { throw new Error('A profile claim must never be coerced into an aura'); }
    };
    for (const value of [undefined, null, '', 'none', true, unsafeClaim, ['platform', 'genesis'], '__proto__', 'platform other-class']) {
        assert.equal(auraFrameClassName(value), '');
    }
});

test('the shared aura API supplies exactly one decoration without mutating caller data', () => {
    const claim = Object.freeze({ kind: 'genesis', owner: 'unverified' });
    assert.equal(auraFrameClassName(claim), '');
    for (const kind of ['platform', 'genesis', 'partner']) {
        const classes = auraFrameClassName(kind).split(' ');
        assert.equal(classes[0], 'artsoul-aura-frame');
        assert.deepEqual(classes.slice(1), [`artsoul-aura-frame--${kind}`]);
    }
    assert.equal(claim.owner, 'unverified');
});

test('only the verified minted projection exposes a named frame to the interface', () => {
    const nft = { source: 'v41_projection', minted: true, ownership_status: 'verified', chain_id: 84532, aura_kind: 'platform' };
    assert.deepEqual(projectedArtworkAura(nft), {
        className: auraFrameClassName('platform'), label: 'ArtSoul platform NFT'
    });
    for (const artwork of [null, {}, { metadata: nft }, { ...nft, source: 'wallet' }, { ...nft, source: 'pending_indexer' },
        { ...nft, minted: 'true' }, { ...nft, minted: false }, { ...nft, ownership_status: 'unavailable' },
        { ...nft, aura_kind: '__proto__' }, { ...nft, aura_kind: 'genesis' },
        { ...nft, chain_id: 11155111 }, { ...nft, chain_id: 1, aura_kind: 'partner' },
        { ...nft, chain_id: null }, { ...nft, chain_id: [84532] }]) {
        assert.equal(projectedArtworkAura(artwork), null);
    }
    assert.equal(projectedArtworkAura({ ...nft, chain_id: 8453, aura_kind: 'genesis' }).label, 'Genesis aura');
    assert.equal(projectedArtworkAura({ ...nft, aura_kind: 'partner' }).label, 'Partner collection NFT');
    assert.equal(projectedArtworkAura({ ...nft, aura_border_text: true }).borderLabel, 'ArtSoul platform NFT');
    assert.equal(projectedArtworkAura({ ...nft, aura_border_text: 'yes' }).borderLabel, undefined);
    assert.equal(projectedArtworkAura({ ...nft, minted: false, aura_border_text: true }), null);
});
