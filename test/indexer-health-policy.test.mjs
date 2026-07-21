import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_HEALTH_MAX_BLOCKS_BEHIND,
    isIndexerWithinHealthLag,
    resolveHealthMaxBlocksBehind
} from '../src/indexer/health-policy.js';

test('default health lag covers the 15-second Base polling edge with margin', () => {
    assert.equal(DEFAULT_HEALTH_MAX_BLOCKS_BEHIND, 20);
    assert.equal(isIndexerWithinHealthLag(11, DEFAULT_HEALTH_MAX_BLOCKS_BEHIND), true);
});

test('health lag remains fail-closed at and above the configured boundary', () => {
    assert.equal(isIndexerWithinHealthLag(19, 20), true);
    assert.equal(isIndexerWithinHealthLag(20, 20), false);
    assert.equal(isIndexerWithinHealthLag(21, 20), false);
    assert.equal(isIndexerWithinHealthLag(-1, 20), false);
    assert.equal(isIndexerWithinHealthLag('missing', 20), false);
});

test('health lag threshold accepts only positive integer configuration', () => {
    assert.equal(resolveHealthMaxBlocksBehind(undefined), 20);
    assert.equal(resolveHealthMaxBlocksBehind('24'), 24);
    assert.throws(() => resolveHealthMaxBlocksBehind('0'), /positive integer/);
    assert.throws(() => resolveHealthMaxBlocksBehind('1.5'), /positive integer/);
    assert.throws(() => resolveHealthMaxBlocksBehind('invalid'), /positive integer/);
});
