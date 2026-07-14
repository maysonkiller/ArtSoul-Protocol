const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('artwork discovery writes authenticate before calling protected APIs', () => {
    const artwork = read('src/entries/artwork.jsx');
    const vote = artwork.match(/async function handleVote\(\) \{[\s\S]*?\n            \}/)?.[0] || '';
    const signal = artwork.match(/async function handleDiscoverySignal\(type\) \{[\s\S]*?\n            \}/)?.[0] || '';

    assert.ok(vote, 'handleVote must exist');
    assert.ok(signal, 'handleDiscoverySignal must exist');
    assert.match(vote, /await window\.ensureAuthenticated\(\)/);
    assert.match(signal, /await window\.ensureAuthenticated\(\)/);
    assert.ok(
        vote.indexOf('await window.ensureAuthenticated()') < vote.indexOf('saveDiscoverySignal'),
        'like authentication must happen before the discovery write'
    );
    assert.ok(
        signal.indexOf('await window.ensureAuthenticated()') < signal.indexOf('saveDiscoverySignal'),
        'signal authentication must happen before the discovery write'
    );
});

test('protected API auth errors use wallet-neutral wording', () => {
    const backend = read('src/api/backend.js');
    const apiServer = read('src/api/server.js');
    const uploadRoute = read('src/api/routes/upload/file.js');
    const combined = `${backend}\n${apiServer}\n${uploadRoute}`;

    assert.doesNotMatch(combined, /Please sign in with Ethereum/i);
    assert.match(backend, /Please authenticate with your connected wallet\./);
});
