import { RATE_LIMITS } from './types.js';

class OfferEngine {
    isDirectBuyEnabled(artworkData) {
        return artworkData && artworkData.minted === true && (artworkData.forSale === true || artworkData.listed === true);
    }

    isInCooldown(auctionEndTime, currentTime) {
        return false;
    }

    getCooldownEndTime(auctionEndTime) {
        return 0;
    }

    isValidOffer(offerAmount, floorPrice, currentHighestOffer) {
        const offer = typeof offerAmount === 'bigint' ? offerAmount : BigInt(offerAmount);
        const floor = typeof floorPrice === 'bigint' ? floorPrice : BigInt(floorPrice);

        if (offer < floor) return false;

        if (currentHighestOffer) {
            const highest = typeof currentHighestOffer === 'bigint' ? currentHighestOffer : BigInt(currentHighestOffer);
            if (offer <= highest) return false;
        }

        return true;
    }

    canWalletMakeOffer(walletAddress, artworkId, lastOfferTime, currentTime) {
        if (!walletAddress || !artworkId) return false;

        if (!lastOfferTime) return true;

        const timeSinceLastOffer = currentTime - lastOfferTime;
        const oneHourMs = RATE_LIMITS.OFFERS_PER_WALLET_PER_ARTWORK_PER_HOUR * 3600 * 1000;

        return timeSinceLastOffer >= oneHourMs;
    }

    getMinimumOfferAmount(floorPrice, currentHighestOffer) {
        if (!currentHighestOffer) return floorPrice;

        const floor = typeof floorPrice === 'bigint' ? floorPrice : BigInt(floorPrice);
        const highest = typeof currentHighestOffer === 'bigint' ? currentHighestOffer : BigInt(currentHighestOffer);

        return highest >= floor ? highest + BigInt(1) : floor;
    }
}

export default OfferEngine;
