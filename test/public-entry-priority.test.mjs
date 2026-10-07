import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prioritizePublicPageEntry } from '../vite.config.js';

for (const name of ['gallery', 'profile', 'artwork']) {
    test(`${name} public entry precedes the legacy contract and service graph without duplication`, () => {
        const classic = '<script src="/src/ui/components/artwork-card.js?v=18" defer></script>';
        const contract = '<script type="module" src="/contracts-integration.js?v=11"></script>';
        const service = '<script type="module" src="/src/index.js"></script>';
        const entry = `<script type="module" crossorigin src="/assets/${name}-fixture.js"></script>`;
        const before = classic + contract + service + entry;
        const after = prioritizePublicPageEntry(before, `${name}.html`);
        assert.ok(after.indexOf(classic) < after.indexOf(entry));
        assert.ok(after.indexOf(entry) < after.indexOf(contract));
        assert.ok(after.indexOf(contract) < after.indexOf(service));
        for (const tag of [classic, contract, service, entry]) assert.equal(after.split(tag).length - 1, 1);
        assert.equal(prioritizePublicPageEntry(after, `${name}.html`), after, 'ordering is idempotent');
    });
}

test('unrelated routes and incomplete entry layouts remain unchanged', () => {
    const html = '<script type="module" src="/contracts-integration.js?v=11"></script><script type="module" crossorigin src="/assets/upload-fixture.js"></script>';
    for (const page of ['upload.html', 'index.html', 'admin.html', 'wallet-test.html', 'gallery.html']) {
        assert.equal(prioritizePublicPageEntry(html, page), html);
    }
});

test('the build verifies emitted public entry order without requiring dist for unit tests', () => {
    const verifier = fs.readFileSync('scripts/verify-build.mjs', 'utf8');
    assert.match(verifier, /public entry must precede legacy contract\/service modules/);
    assert.match(verifier, /classic artwork cards must initialize before the public entry/);
});
