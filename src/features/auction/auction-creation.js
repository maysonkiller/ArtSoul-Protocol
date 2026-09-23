const BASE_SEPOLIA_CHAIN_ID = 84532;
const address = value => String(value || '').toLowerCase();

// A passive provider read: this must not open a signature request or switch chains.
export async function readAuctionCreationWallet(provider) {
    if (!provider?.request) throw new Error('Connect your wallet to create an auction.');
    const [accounts, rawChainId] = await Promise.all([
        provider.request({ method: 'eth_accounts' }),
        provider.request({ method: 'eth_chainId' })
    ]);
    const walletAddress = address(accounts?.[0]);
    if (!/^0x[0-9a-f]{40}$/.test(walletAddress)) throw new Error('Connect your wallet to create an auction.');
    const chainId = Number(rawChainId);
    if (chainId !== BASE_SEPOLIA_CHAIN_ID) throw new Error('Switch your wallet to Base Sepolia, then try again.');
    return { walletAddress, chainId };
}

export async function inspectAuctionCreation({ artworkId, chainId, provider, contracts, expectedWallet }) {
    if (Number(chainId) !== BASE_SEPOLIA_CHAIN_ID) throw new Error('Auction creation is available on Base Sepolia only.');
    const id = String(artworkId || '');
    if (!/^\d+$/.test(id) || BigInt(id) <= 0n || BigInt(id) >= 2n ** 256n) throw new Error('The artwork identifier is unavailable.');
    const before = await readAuctionCreationWallet(provider);
    if (expectedWallet && before.walletAddress !== address(expectedWallet)) {
        throw new Error('Your connected account changed. Switch back to the account that opened this form, or close it and try again.');
    }
    await contracts.init(provider);
    const artwork = await contracts.getArtwork(id);
    if (address(artwork?.creator) !== before.walletAddress) throw new Error('Only the artwork creator can create its primary auction.');
    if (artwork.minted || BigInt(artwork.tokenId || 0) !== 0n) {
        throw new Error('This artwork is already minted. Its current owner can use the resale flow.');
    }
    if (BigInt(artwork.activeAuctionId || 0) !== 0n) {
        throw new Error('This artwork already has an active auction. Its public auction data is updating.');
    }
    const after = await readAuctionCreationWallet(provider);
    if (after.walletAddress !== before.walletAddress || after.chainId !== before.chainId) {
        throw new Error('Your wallet changed while checking the artwork. Try again.');
    }
    if (contracts.signer?.getAddress && address(await contracts.signer.getAddress()) !== after.walletAddress) {
        throw new Error('The wallet signer changed. Try again.');
    }
    return { ...after, artwork };
}
