import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auraFrameClassName } from '../src/ui/components/aura-frame.js';

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
