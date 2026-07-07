export const BASE_SEPOLIA_CHAIN_ID = 84532;

function normalizeAddress(value) {
    return String(value || '').trim().toLowerCase();
}

function hasProtocolId(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    return Boolean(normalized && normalized !== '0' && normalized !== 'none' && normalized !== 'null');
}

export function getOwnerResaleEligibility({
    walletSettled = false,
    walletAddress = '',
    walletChainId = 0,
    currentOwnerAddress = '',
    minted = false,
    tokenId = '',
    floorPrice = 0,
    activeListing = false,
    activeAuction = false
} = {}) {
    const connected = walletSettled && Boolean(normalizeAddress(walletAddress));
    const hasMintedToken = Boolean(minted) && hasProtocolId(tokenId);
    const isCurrentOwner = connected &&
        Boolean(normalizeAddress(currentOwnerAddress)) &&
        normalizeAddress(walletAddress) === normalizeAddress(currentOwnerAddress);
    const showOwnerAction = hasMintedToken && isCurrentOwner && !activeListing && !activeAuction;

    if (!showOwnerAction) {
        return {
            canList: false,
            showOwnerAction: false,
            reason: activeListing
                ? 'already_listed'
                : activeAuction
                    ? 'auction_active'
                    : !hasMintedToken
                        ? 'not_minted'
                        : !connected
                            ? 'wallet_not_ready'
                            : 'not_owner'
        };
    }

    if (Number(walletChainId) !== BASE_SEPOLIA_CHAIN_ID) {
        return {
            canList: false,
            showOwnerAction: true,
            reason: 'wrong_chain'
        };
    }

    if (!Number.isFinite(Number(floorPrice)) || Number(floorPrice) <= 0) {
        return {
            canList: false,
            showOwnerAction: true,
            reason: 'floor_unavailable'
        };
    }

    return {
        canList: true,
        showOwnerAction: true,
        reason: ''
    };
}
