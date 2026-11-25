// Collection Launch registry. It never changes the existing Base wallet default.
// Robinhood values verified against https://docs.robinhood.com/chain/connecting/
// on 2026-09-20. Mainnet launch is deliberately not a selectable write target.
export const COLLECTION_NETWORKS = Object.freeze([
  Object.freeze({
    chainId: 84532, name: 'Base Sepolia', testnet: true, writeEnabled: false,
    nativeCurrency: Object.freeze({name: 'Ether', symbol: 'ETH', decimals: 18}),
    rpcUrls: Object.freeze(['https://sepolia.base.org']),
    blockExplorerUrls: Object.freeze(['https://sepolia.basescan.org'])
  }),
  Object.freeze({
    chainId: 46630, name: 'Robinhood Chain Testnet', testnet: true, writeEnabled: false,
    nativeCurrency: Object.freeze({name: 'Ether', symbol: 'ETH', decimals: 18}),
    rpcUrls: Object.freeze(['https://rpc.testnet.chain.robinhood.com']),
    blockExplorerUrls: Object.freeze(['https://explorer.testnet.chain.robinhood.com'])
  })
]);

function parseChainId(value) {
  if (typeof value !== 'number' && typeof value !== 'bigint' &&
      !(typeof value === 'string' && /^(?:[0-9]+|0x[0-9a-f]+)$/i.test(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function getCollectionNetwork(chainId) {
  const id = parseChainId(chainId);
  return COLLECTION_NETWORKS.find(network => network.chainId === id) || null;
}

export function collectionAssetKey(chainId, contractAddress, tokenId) {
  const id = parseChainId(chainId);
  if (id === null || typeof contractAddress !== 'string' ||
      !/^0x[0-9a-f]{40}$/i.test(contractAddress) ||
      /^0x0{40}$/i.test(contractAddress) ||
      !['bigint', 'number', 'string'].includes(typeof tokenId) ||
      !/^(0|[1-9][0-9]{0,77})$/.test(String(tokenId)) ||
      (typeof tokenId === 'number' && !Number.isSafeInteger(tokenId)) ||
      BigInt(tokenId) >= 2n ** 256n) {
    throw new TypeError('A chain, contract address and uint256 token ID are required.');
  }
  return `${id}:${contractAddress.toLowerCase()}:${BigInt(tokenId)}`;
}
