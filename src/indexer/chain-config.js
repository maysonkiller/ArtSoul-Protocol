export const SUPPORTED_INDEXER_CHAINS = {
    'base-sepolia': {
        slug: 'base-sepolia',
        label: 'Base Sepolia',
        chainId: 84532,
        chainIdEnv: 'BASE_SEPOLIA_CHAIN_ID',
        rpcEnv: ['BASE_SEPOLIA_RPC_URLS', 'BASE_SEPOLIA_RPC_URL', 'RPC_URL'],
        defaultRpcUrls: ['https://sepolia.base.org'],
        coreAddressEnv: ['ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA', 'ARTSOUL_CORE_ADDRESS'],
        nftAddressEnv: ['ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA', 'ARTSOUL_NFT_ADDRESS'],
        projectNFTAddressEnv: ['ARTSOUL_PROJECT_NFT_ADDRESS_BASE_SEPOLIA', 'ARTSOUL_PROJECT_NFT_ADDRESS'],
        startBlockEnv: 'BASE_SEPOLIA_START_BLOCK',
        confirmationDepthEnv: 'BASE_SEPOLIA_CONFIRMATION_DEPTH',
        defaultConfirmationDepth: 3
    },
    'eth-sepolia': {
        slug: 'eth-sepolia',
        label: 'Ethereum Sepolia',
        chainId: 11155111,
        chainIdEnv: 'ETH_SEPOLIA_CHAIN_ID',
        rpcEnv: ['ETH_SEPOLIA_RPC_URLS', 'ETH_SEPOLIA_RPC_URL', 'RPC_URL'],
        defaultRpcUrls: [],
        coreAddressEnv: ['ARTSOUL_CORE_ADDRESS_ETH_SEPOLIA', 'ARTSOUL_CORE_ADDRESS'],
        nftAddressEnv: ['ARTSOUL_NFT_ADDRESS_ETH_SEPOLIA', 'ARTSOUL_NFT_ADDRESS'],
        projectNFTAddressEnv: ['ARTSOUL_PROJECT_NFT_ADDRESS_ETH_SEPOLIA', 'ARTSOUL_PROJECT_NFT_ADDRESS'],
        startBlockEnv: 'ETH_SEPOLIA_START_BLOCK',
        confirmationDepthEnv: 'ETH_SEPOLIA_CONFIRMATION_DEPTH',
        defaultConfirmationDepth: 12
    },
    'rialo-testnet': {
        slug: 'rialo-testnet',
        label: 'Rialo Testnet',
        chainId: null,
        disabled: true,
        reason: 'Rialo is a future target and is disabled until the full deploy/runtime path is ready.'
    }
};

const CHAIN_ID_TO_SLUG = Object.fromEntries(
    Object.values(SUPPORTED_INDEXER_CHAINS)
        .filter(chain => chain.chainId)
        .map(chain => [String(chain.chainId), chain.slug])
);

export function readEnv(names) {
    for (const name of names) {
        const value = process.env[name];
        if (value && value.trim()) return value.trim();
    }
    return '';
}

export function requireEnv(names, label) {
    const value = readEnv(names);
    if (!value) {
        throw new Error(`${label} is required. Configure one of: ${names.join(', ')}`);
    }
    return value;
}

function parseChainList(value) {
    if (!value || !value.trim()) return [];
    return value
        .split(',')
        .map(chain => chain.trim())
        .filter(Boolean);
}

function parseRpcList(value) {
    if (!value || !value.trim()) return [];
    return value
        .split(',')
        .map(url => url.trim())
        .filter(Boolean);
}

function uniqueRpcUrls(urls) {
    return [...new Set(urls.filter(Boolean))];
}

function resolveRpcUrls(chain) {
    const configured = parseRpcList(requireEnv(chain.rpcEnv, `${chain.label} RPC URL`));
    return uniqueRpcUrls([...(chain.defaultRpcUrls || []), ...configured]);
}

function resolveReadRpcUrls(chain, rpcUrls, chainId) {
    const override = process.env.BASE_SEPOLIA_READ_RPC_URLS;
    if (chain.slug === 'base-sepolia' && chainId === 84532 && override !== undefined) {
        const urls = override.split(',').map(value => value.trim());
        if (urls.some(value => {
            try { return !value || !['http:', 'https:'].includes(new URL(value).protocol); }
            catch { return true; }
        })) throw new Error('Invalid BASE_SEPOLIA_READ_RPC_URLS');
        return uniqueRpcUrls(urls);
    }
    return uniqueRpcUrls(rpcUrls);
}

// An explicit origin is a prerequisite, not a coverage claim. The range
// reader must still prove its predecessor and pinned deployment before writing.
export function resolveNftTransferConfig(chain, env = process.env) {
    const flag = env.ARTSOUL_NFT_TRANSFER_INDEX_ENABLED;
    if (flag === undefined || flag === 'false') return null;
    const invalid = label => { throw new Error(`Invalid NFT transfer configuration: ${label}`); };
    if (flag !== 'true') invalid('ARTSOUL_NFT_TRANSFER_INDEX_ENABLED');
    // Coverage is exposed only after the durable cache-purge obligation has
    // been acknowledged. Without Redis, bootstrap would stop Core catch-up.
    try {
        if (typeof env.REDIS_URL !== 'string' || env.REDIS_URL.trim() !== env.REDIS_URL) throw new Error();
        const redis = new URL(env.REDIS_URL);
        if (!['redis:', 'rediss:'].includes(redis.protocol) || !redis.hostname) throw new Error();
    } catch { invalid('recovery-capable REDIS_URL required'); }
    if (chain?.chainId !== 84532 || (chain.slug !== undefined && chain.slug !== 'base-sepolia') ||
        (env.BASE_SEPOLIA_CHAIN_ID !== undefined && env.BASE_SEPOLIA_CHAIN_ID !== '84532')) {
        invalid('Base Sepolia chain required');
    }
    const address = (value, label) => {
        if (typeof value !== 'string') invalid(label);
        const normalized = value.trim().toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(normalized) || /^0x0{40}$/.test(normalized)) invalid(label);
        return normalized;
    };
    const hash = name => {
        const value = env[name];
        if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value) || /^0x0{64}$/i.test(value)) invalid(name);
        return value.toLowerCase();
    };
    const integer = (name, maximum, fallback) => {
        const value = env[name];
        if (value === undefined && fallback !== undefined) return fallback;
        if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) ||
            !Number.isSafeInteger(Number(value)) || Number(value) > maximum) invalid(name);
        return Number(value);
    };
    const coreAddress = address(env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA, 'ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA');
    const nftAddress = address(env.ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA, 'ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA');
    if (coreAddress === nftAddress || coreAddress !== address(chain.coreAddress, 'resolved Core address') ||
        nftAddress !== address(chain.nftAddress, 'resolved NFT address')) invalid('deployment mismatch');
    return Object.freeze({ chainId: 84532, coreAddress, nftAddress,
        expectedCoreCodeHash: hash('ARTSOUL_NFT_OWNERSHIP_CORE_CODE_HASH'),
        expectedNftCodeHash: hash('ARTSOUL_NFT_OWNERSHIP_NFT_CODE_HASH'),
        fromBlock: integer('ARTSOUL_NFT_TRANSFER_FROM_BLOCK', Number.MAX_SAFE_INTEGER),
        previousBlockHash: hash('ARTSOUL_NFT_TRANSFER_ORIGIN_BLOCK_HASH'),
        maxBlocks: integer('ARTSOUL_NFT_TRANSFER_MAX_BLOCKS', 100000, 1000) });
}

export function resolveChainSlug(value) {
    if (!value || !value.trim()) return '';

    const normalized = value.trim().toLowerCase();
    return CHAIN_ID_TO_SLUG[normalized] || normalized;
}

export function resolveIndexerChainSlugs() {
    const explicitChains = parseChainList(process.env.ARTSOUL_INDEXER_CHAINS);
    if (explicitChains.length > 0) {
        return explicitChains.map(resolveChainSlug);
    }

    const singleChain = process.env.ARTSOUL_INDEXER_CHAIN ||
        process.env.ARTSOUL_INDEXER_CHAIN_ID ||
        process.env.CHAIN_ID;

    return [resolveChainSlug(singleChain || 'base-sepolia')];
}

function resolveStartBlock(chain) {
    const chainStartBlock = readEnv([chain.startBlockEnv]);
    if (chainStartBlock) return parseInt(chainStartBlock, 10);

    const legacyStartBlock = readEnv(['INDEXER_START_BLOCK']);
    return legacyStartBlock ? parseInt(legacyStartBlock, 10) : 0;
}

function resolveChainId(chain) {
    const configuredChainId = chain.chainIdEnv ? readEnv([chain.chainIdEnv]) : '';
    if (!configuredChainId) return chain.chainId;

    const parsed = parseInt(configuredChainId, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : chain.chainId;
}

function parsePositiveInteger(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveConfirmationDepth(chain) {
    const chainDepth = chain.confirmationDepthEnv ? readEnv([chain.confirmationDepthEnv]) : '';
    if (chainDepth) return parsePositiveInteger(chainDepth, chain.defaultConfirmationDepth || 12);

    const globalDepth = readEnv(['INDEXER_CONFIRMATION_DEPTH']);
    if (globalDepth) return parsePositiveInteger(globalDepth, chain.defaultConfirmationDepth || 12);

    return chain.defaultConfirmationDepth || 12;
}

export function resolveIndexerChainConfig(slug) {
    const chain = SUPPORTED_INDEXER_CHAINS[resolveChainSlug(slug)];
    if (!chain) {
        throw new Error(`Unsupported ArtSoul indexer chain: ${slug}`);
    }

    if (chain.disabled) {
        throw new Error(`${chain.label} is disabled. ${chain.reason}`);
    }

    const rpcUrls = resolveRpcUrls(chain);
    const chainId = resolveChainId(chain);

    return {
        slug: chain.slug,
        label: chain.label,
        chainId,
        rpcUrl: rpcUrls,
        readRpcUrls: resolveReadRpcUrls(chain, rpcUrls, chainId),
        coreAddress: requireEnv(chain.coreAddressEnv, `${chain.label} ArtSoulCore address`),
        nftAddress: readEnv(chain.nftAddressEnv),
        projectNFTAddress: readEnv(chain.projectNFTAddressEnv),
        donationAddress: chain.chainId === 84532 ? readEnv(['ARTSOUL_DONATIONS_ADDRESS_BASE_SEPOLIA']) : '',
        startBlock: resolveStartBlock(chain),
        confirmationDepth: resolveConfirmationDepth(chain),
        lockName: `indexer_leader_${chain.slug}`
    };
}

export function resolveIndexerChainConfigs() {
    const slugs = resolveIndexerChainSlugs();
    const uniqueSlugs = [...new Set(slugs)];
    return uniqueSlugs.map(resolveIndexerChainConfig);
}
