const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');

function withEnv(values, callback) {
    const previous = {};
    for (const [name, value] of Object.entries(values)) {
        previous[name] = process.env[name];
        if (value === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = value;
        }
    }

    return Promise.resolve()
        .then(callback)
        .finally(() => {
            for (const [name, value] of Object.entries(previous)) {
                if (value === undefined) {
                    delete process.env[name];
                } else {
                    process.env[name] = value;
                }
            }
        });
}

test('Base Sepolia public RPC is primary and configured endpoints remain fallbacks', async () => {
    await withEnv({
        ARTSOUL_INDEXER_CHAINS: 'base-sepolia',
        BASE_SEPOLIA_RPC_URLS: 'https://paid-one.example/rpc, https://paid-two.example/rpc, https://paid-one.example/rpc',
        ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA: '0x1111111111111111111111111111111111111111'
    }, async () => {
        const moduleUrl = `${pathToFileURL(path.join(repoRoot, 'src/indexer/chain-config.js')).href}?test=${Date.now()}`;
        const { resolveIndexerChainConfigs } = await import(moduleUrl);
        const [config] = resolveIndexerChainConfigs();

        assert.equal(config.slug, 'base-sepolia');
        assert.equal(config.chainId, 84532);
        assert.deepEqual(config.rpcUrl, [
            'https://sepolia.base.org',
            'https://paid-one.example/rpc',
            'https://paid-two.example/rpc'
        ]);
        assert.deepEqual(config.readRpcUrls, config.rpcUrl);
    });
});

test('read-only RPC calls cool down a failed public endpoint and use the fallback', async () => {
    const moduleUrl = `${pathToFileURL(path.join(repoRoot, 'src/indexer/event-listener.js')).href}?test=${Date.now()}`;
    const { default: EventListener } = await import(moduleUrl);
    const listener = new EventListener({
        rpcUrl: ['https://sepolia.base.org', 'https://paid.example/rpc'],
        readRpcUrls: ['https://sepolia.base.org', 'https://paid.example/rpc'],
        contractAddress: '0x1111111111111111111111111111111111111111',
        chainId: 84532
    });

    let publicCalls = 0;
    let fallbackCalls = 0;
    listener.readProviders = [
        {
            getBlockNumber: async () => {
                publicCalls += 1;
                throw new Error('public endpoint unavailable');
            }
        },
        {
            getBlockNumber: async () => {
                fallbackCalls += 1;
                return 12345;
            }
        }
    ];

    assert.equal(await listener.getCurrentBlock(), 12345);
    assert.equal(await listener.getCurrentBlock(), 12345);
    assert.equal(publicCalls, 1, 'failed public RPC should remain in cooldown');
    assert.equal(fallbackCalls, 2);
});

test('production polling reuses one observed block and bounds reorg reads', () => {
    const runner = fs.readFileSync(path.join(repoRoot, 'src/indexer/production-runner.js'), 'utf8');
    const syncEngine = fs.readFileSync(path.join(repoRoot, 'src/indexer/sync-engine.js'), 'utf8');

    assert.match(runner, /INDEXER_REORG_CHECK_INTERVAL \|\| '60000'/);
    assert.match(runner, /detectReorg\(\{\s*sampleSize: this\.reorgSampleSize/s);
    // The observed block is still reused instead of re-fetched. A-15 additionally
    // gates confirmation on a completed catch-up, so a range that failed closed
    // performs no confirmation work at all (strictly fewer RPC reads, and never
    // confirms past an unapplied event).
    assert.match(runner, /if \(checkpoint\) \{\s*await this\._processConfirmations\(checkpoint\.currentBlock\);/s);
    assert.doesNotMatch(runner, /_processConfirmations\(checkpoint\?\.currentBlock\)/);
    assert.match(runner, /this\.lastObservedBlock = currentBlock/);
    assert.doesNotMatch(runner, /const currentBlock = await this\.eventListener\.getCurrentBlock\(\);\s*const lag/s);

    assert.match(syncEngine, /LIMIT \$3/);
    assert.match(syncEngine, /options\.sampleSize/);
    assert.doesNotMatch(syncEngine, /last_indexed_block\s*-\s*256/);
    assert.doesNotMatch(syncEngine, /eventListener\.provider\.getBlock/);
    assert.doesNotMatch(syncEngine, /getTransactionReceipt/);
});
