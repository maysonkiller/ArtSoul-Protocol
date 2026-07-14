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

function resolveReadRpcUrls(chain, rpcUrls) {
    return uniqueRpcUrls(rpcUrls);
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

    return {
        slug: chain.slug,
        label: chain.label,
        chainId: resolveChainId(chain),
        rpcUrl: rpcUrls,
        readRpcUrls: resolveReadRpcUrls(chain, rpcUrls),
        coreAddress: requireEnv(chain.coreAddressEnv, `${chain.label} ArtSoulCore address`),
        nftAddress: readEnv(chain.nftAddressEnv),
        projectNFTAddress: readEnv(chain.projectNFTAddressEnv),
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
