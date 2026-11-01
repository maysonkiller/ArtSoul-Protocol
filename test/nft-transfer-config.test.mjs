import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveIndexerChainConfig, resolveNftTransferConfig } from '../src/indexer/chain-config.js';

const CORE = `0x${'a'.repeat(40)}`, NFT = `0x${'b'.repeat(40)}`, OTHER = `0x${'c'.repeat(40)}`;
const hash = value => `0x${value.repeat(64)}`;
const chain = () => ({ chainId: 84532, coreAddress: CORE, nftAddress: NFT });
const environment = () => ({ ARTSOUL_NFT_TRANSFER_INDEX_ENABLED: 'true', REDIS_URL: 'redis://127.0.0.1:6379',
    ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA: CORE, ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA: NFT,
    ARTSOUL_NFT_OWNERSHIP_CORE_CODE_HASH: hash('1'), ARTSOUL_NFT_OWNERSHIP_NFT_CODE_HASH: hash('2'),
    ARTSOUL_NFT_TRANSFER_FROM_BLOCK: '41976861', ARTSOUL_NFT_TRANSFER_ORIGIN_BLOCK_HASH: hash('3') });
const invalid = error => error.message.startsWith('Invalid NFT transfer configuration:');

test('enabled NFT indexing requires a usable recovery cache configuration without exposing its URL', () => {
    for (const value of [undefined, '', ' ', 'invalid', 'https://private.example', 123, ' redis://localhost']) {
        assert.throws(() => resolveNftTransferConfig(chain(), { ...environment(), REDIS_URL: value }),
            { message: 'Invalid NFT transfer configuration: recovery-capable REDIS_URL required' });
    }
    for (const value of ['redis://localhost:6379', 'rediss://user:fixture-secret@private.example:6380/0']) {
        assert.equal(resolveNftTransferConfig(chain(), { ...environment(), REDIS_URL: value }).chainId, 84532);
    }
});

test('NFT indexing is disabled without new deployment requirements unless explicitly true', () => {
    assert.equal(resolveNftTransferConfig(null, {}), null);
    assert.equal(resolveNftTransferConfig(null, { ARTSOUL_NFT_TRANSFER_INDEX_ENABLED: 'false' }), null);
    assert.equal(resolveNftTransferConfig(null, { ARTSOUL_NFT_OWNERSHIP_ENABLED: 'true' }), null);
    assert.equal(resolveNftTransferConfig({ chainId: 11155111 }, { ARTSOUL_NFT_TRANSFER_INDEX_ENABLED: 'false',
        ARTSOUL_NFT_TRANSFER_FROM_BLOCK: 'invalid', ARTSOUL_NFT_OWNERSHIP_CORE_CODE_HASH: 'invalid' }), null);
});

test('NFT indexing captures exact normalized deployment, reviewed origin and bounded defaults', () => {
    const resolved = chain(), env = environment();
    env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA = CORE.toUpperCase();
    resolved.nftAddress = NFT.toUpperCase();
    env.ARTSOUL_NFT_OWNERSHIP_CORE_CODE_HASH = hash('d').toUpperCase();
    const result = resolveNftTransferConfig(resolved, env);
    assert.deepEqual(result, { chainId: 84532, coreAddress: CORE, nftAddress: NFT,
        expectedCoreCodeHash: hash('d'), expectedNftCodeHash: hash('2'), fromBlock: 41976861,
        previousBlockHash: hash('3'), maxBlocks: 1000 });
    assert.ok(Object.isFrozen(result));
    assert.throws(() => { result.fromBlock = 1; }, TypeError);
    env.ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA = OTHER; resolved.coreAddress = OTHER;
    assert.equal(result.coreAddress, CORE); assert.equal(result.nftAddress, NFT);
});

for (const value of ['', 'TRUE', 'False', ' true ', '0', '1', true, false, null]) {
    test(`NFT indexing rejects a noncanonical enable flag: ${JSON.stringify(value)}`, () => {
        assert.throws(() => resolveNftTransferConfig(chain(), { ...environment(), ARTSOUL_NFT_TRANSFER_INDEX_ENABLED: value }), invalid);
    });
}

for (const [label, resolved] of [['missing chain', null], ['legacy chain', { ...chain(), chainId: 11155111 }],
    ['string chain', { ...chain(), chainId: '84532' }], ['mainnet', { ...chain(), chainId: 8453 }],
    ['legacy slug with overridden chain ID', { ...chain(), slug: 'eth-sepolia' }],
    ['missing resolved NFT', { ...chain(), nftAddress: undefined }], ['mismatched NFT', { ...chain(), nftAddress: OTHER }],
    ['mismatched Core', { ...chain(), coreAddress: OTHER }], ['invalid resolved Core', { ...chain(), coreAddress: '0x12' }]]) {
    test(`NFT indexing rejects ${label}`, () => assert.throws(() => resolveNftTransferConfig(resolved, environment()), invalid));
}

for (const name of ['ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA', 'ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA']) {
    for (const value of [undefined, '', '0x12', `0x${'0'.repeat(40)}`, 123]) {
        test(`NFT indexing rejects ${name}=${JSON.stringify(value)}`, () => {
            assert.throws(() => resolveNftTransferConfig(chain(), { ...environment(), [name]: value }), invalid);
        });
    }
}
test('NFT indexing refuses equal deployments and legacy address fallbacks', () => {
    assert.throws(() => resolveNftTransferConfig({ ...chain(), nftAddress: CORE },
        { ...environment(), ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA: CORE }), invalid);
    const env = { ...environment(), ARTSOUL_CORE_ADDRESS: CORE, ARTSOUL_NFT_ADDRESS: NFT };
    delete env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA; delete env.ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA;
    assert.throws(() => resolveNftTransferConfig(chain(), env), invalid);
});

for (const name of ['ARTSOUL_NFT_OWNERSHIP_CORE_CODE_HASH', 'ARTSOUL_NFT_OWNERSHIP_NFT_CODE_HASH',
    'ARTSOUL_NFT_TRANSFER_ORIGIN_BLOCK_HASH']) {
    for (const value of [undefined, '', hash('0'), '0x1234', hash('g'), ` ${hash('1')}`, 123]) {
        test(`NFT indexing rejects ${name}=${JSON.stringify(value)}`, () => {
            assert.throws(() => resolveNftTransferConfig(chain(), { ...environment(), [name]: value }), invalid);
        });
    }
}

for (const name of ['ARTSOUL_NFT_TRANSFER_FROM_BLOCK', 'ARTSOUL_NFT_TRANSFER_MAX_BLOCKS']) {
    for (const value of ['', '0', '-1', '01', '1.5', '1e3', '0x10', '1000blocks', ' 1000', '1000 ', '9007199254740992', 1000]) {
        test(`NFT indexing rejects ${name}=${JSON.stringify(value)} without truncation`, () => {
            assert.throws(() => resolveNftTransferConfig(chain(), { ...environment(), [name]: value }), invalid);
        });
    }
}
test('NFT indexing requires an origin and accepts only bounded explicit window sizes', () => {
    const env = environment(); delete env.ARTSOUL_NFT_TRANSFER_FROM_BLOCK;
    assert.throws(() => resolveNftTransferConfig(chain(), env), invalid);
    for (const maxBlocks of ['1', '100000']) assert.equal(resolveNftTransferConfig(chain(),
        { ...environment(), ARTSOUL_NFT_TRANSFER_MAX_BLOCKS: maxBlocks }).maxBlocks, Number(maxBlocks));
    assert.throws(() => resolveNftTransferConfig(chain(), { ...environment(), ARTSOUL_NFT_TRANSFER_MAX_BLOCKS: '100001' }), invalid);
    assert.equal(resolveNftTransferConfig(chain(), { ...environment(), ARTSOUL_NFT_TRANSFER_FROM_BLOCK: String(Number.MAX_SAFE_INTEGER) }).fromBlock,
        Number.MAX_SAFE_INTEGER);
});

test('NFT indexing cannot inherit a truncated or fallback Base chain override', () => {
    for (const value of ['', '84532junk', '84532.5', '084532', '8453', 'invalid', 84532]) {
        assert.throws(() => resolveNftTransferConfig(chain(), { ...environment(), BASE_SEPOLIA_CHAIN_ID: value }), invalid);
    }
    assert.equal(resolveNftTransferConfig(chain(), { ...environment(), BASE_SEPOLIA_CHAIN_ID: '84532' }).chainId, 84532);
});

function withEnv(values, run) {
    const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
    try {
        for (const [key, value] of Object.entries(values)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        return run();
    } finally {
        for (const [key, value] of Object.entries(before)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
}
const baseEnv = { BASE_SEPOLIA_RPC_URLS: 'https://ordinary.example/rpc', BASE_SEPOLIA_CHAIN_ID: undefined,
    ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA: CORE, ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA: NFT,
    BASE_SEPOLIA_READ_RPC_URLS: undefined };

test('Base read RPC override preserves ordinary providers and de-duplicates its explicit order', () => {
    withEnv({ ...baseEnv, BASE_SEPOLIA_READ_RPC_URLS: 'https://archive.example/rpc, https://reader.example, https://archive.example/rpc' }, () => {
        const resolved = resolveIndexerChainConfig('base-sepolia');
        assert.deepEqual(resolved.rpcUrl, ['https://sepolia.base.org', 'https://ordinary.example/rpc']);
        assert.deepEqual(resolved.readRpcUrls, ['https://archive.example/rpc', 'https://reader.example']);
    });
    withEnv(baseEnv, () => {
        const resolved = resolveIndexerChainConfig('base-sepolia');
        assert.deepEqual(resolved.readRpcUrls, resolved.rpcUrl);
    });
});

for (const value of ['', ' ', ',', 'https://reader.example,', 'not-a-url', 'file:///tmp/rpc', 'wss://reader.example']) {
    test(`Base read RPC override rejects malformed lists: ${JSON.stringify(value)}`, () => {
        withEnv({ ...baseEnv, BASE_SEPOLIA_READ_RPC_URLS: value }, () => {
            assert.throws(() => resolveIndexerChainConfig('base-sepolia'), /Invalid BASE_SEPOLIA_READ_RPC_URLS/);
        });
    });
}

test('Base read RPC override does not affect legacy chains or an overridden non-Base chain ID', () => {
    withEnv({ ...baseEnv, BASE_SEPOLIA_READ_RPC_URLS: 'invalid', ETH_SEPOLIA_RPC_URLS: 'https://legacy.example',
        ARTSOUL_CORE_ADDRESS_ETH_SEPOLIA: CORE }, () => {
        const resolved = resolveIndexerChainConfig('eth-sepolia');
        assert.deepEqual(resolved.readRpcUrls, resolved.rpcUrl);
    });
    withEnv({ ...baseEnv, BASE_SEPOLIA_CHAIN_ID: '11155111', BASE_SEPOLIA_READ_RPC_URLS: 'invalid' }, () => {
        const resolved = resolveIndexerChainConfig('base-sepolia');
        assert.deepEqual(resolved.readRpcUrls, resolved.rpcUrl);
        assert.throws(() => resolveNftTransferConfig(resolved, environment()), invalid);
    });
});
