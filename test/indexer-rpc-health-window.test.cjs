const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function moduleUrl(relativePath) {
    return `${pathToFileURL(path.join(ROOT, relativePath)).href}?test=${Date.now()}-${Math.random()}`;
}

test('RPC health exposes only errors from its maintained rolling window', async () => {
    const { default: EventListener } = await import(moduleUrl('src/indexer/event-listener.js'));
    const listener = Object.create(EventListener.prototype);
    const now = Date.now();

    listener.rpcHealth = [{
        url: 'https://rpc.example',
        healthScore: 82,
        avgLatency: 321.6,
        errorWindowDuration: 60_000,
        errorWindow: [now - 70_000, now - 50_000, now - 1_000]
    }];

    assert.deepEqual(listener.getRpcHealth(), [{
        url: 'https://rpc.example',
        healthScore: 82,
        avgLatencyMs: 321.6,
        errorsLastMinute: 2
    }]);
    assert.equal(listener.rpcHealth[0].errorWindow.length, 2);
});

test('production runner contains no dormant webhook or false throughput path', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/indexer/production-runner.js'), 'utf8');

    for (const removedName of [
        'ALERT_WEBHOOK',
        'alertWebhook',
        '_sendAlert',
        '_checkAlerts',
        'blocksPerSecond',
        'eventsPerSecond'
    ]) {
        assert.equal(source.includes(removedName), false, `${removedName} must stay removed`);
    }
});
