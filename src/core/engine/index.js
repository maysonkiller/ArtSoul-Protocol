import AuctionEngine from './auction-engine.js';
import OfferEngine from './offer-engine.js';
import StateResolver from './state-resolver.js';
import VisibilityEngine from './visibility-engine.js';
import RiskEngine from './risk-engine.js';

class CoreMarketplaceEngine {
    constructor() {
        this.auctionEngine = new AuctionEngine();
        this.offerEngine = new OfferEngine();
        this.stateResolver = new StateResolver();
        this.visibilityEngine = new VisibilityEngine();
        this.riskEngine = new RiskEngine();
    }

    getArtworkState(artworkData, auctionData, offerData, walletData, currentTime) {
        const state = this.stateResolver.resolveState(
            artworkData,
            auctionData,
            offerData,
            currentTime
        );

        const metadata = this.stateResolver.getStateMetadata(
            state,
            artworkData,
            auctionData,
            offerData,
            currentTime
        );

        const visibility = {
            inGallery: this.visibilityEngine.isVisibleInGallery(artworkData, state),
            isFeatured: this.visibilityEngine.isFeatured(artworkData),
            isCurated: this.visibilityEngine.isCurated(artworkData)
        };

        const risk = walletData ? {
            canBid: !this.riskEngine.isWalletRateLimited(
                walletData.address,
                'bid',
                walletData.actionHistory,
                currentTime
            ),
            canOffer: !this.riskEngine.isWalletRateLimited(
                walletData.address,
                'offer',
                walletData.actionHistory,
                currentTime
            ),
            riskScore: this.riskEngine.calculateWalletRiskScore(
                walletData.address,
                walletData.behaviorHistory
            )
        } : null;

        return {
            state,
            metadata,
            visibility,
            risk
        };
    }

    validateAction(action, artworkData, auctionData, walletData, actionData, currentTime) {
        const state = this.stateResolver.resolveState(
            artworkData,
            auctionData,
            null,
            currentTime
        );

        if (action === 'bid') {
            if (state !== 'AUCTION') {
                return { valid: false, reason: 'Auction is not active' };
            }

            if (!this.auctionEngine.isValidBidAmount(
                actionData.bidAmount,
                auctionData.highestBid,
                artworkData.floorPrice
            )) {
                return { valid: false, reason: 'Bid amount too low' };
            }

            if (walletData && this.riskEngine.isWalletRateLimited(
                walletData.address,
                'bid',
                walletData.actionHistory,
                currentTime
            )) {
                return { valid: false, reason: 'Rate limit exceeded' };
            }

            return { valid: true };
        }

        if (action === 'offer') {
            if (state !== 'FOR_SALE') {
                return { valid: false, reason: 'Artwork is not listed for resale' };
            }

            if (!this.offerEngine.isValidOffer(
                actionData.offerAmount,
                artworkData.floorPrice,
                actionData.currentHighestOffer
            )) {
                return { valid: false, reason: 'Offer amount too low' };
            }

            if (walletData && this.riskEngine.isWalletRateLimited(
                walletData.address,
                'offer',
                walletData.actionHistory,
                currentTime
            )) {
                return { valid: false, reason: 'Rate limit exceeded' };
            }

            return { valid: true };
        }

        if (action === 'purchase') {
            if (state === 'SETTLEMENT_PENDING') {
                const metadata = this.stateResolver.getStateMetadata(
                    state,
                    artworkData,
                    auctionData,
                    null,
                    currentTime
                );

                if (walletData && walletData.address !== metadata.buyer) {
                    return { valid: false, reason: 'Not the designated buyer' };
                }

                if (currentTime > metadata.settlementDeadline) {
                    return { valid: false, reason: 'Settlement window expired' };
                }

                return { valid: true };
            }

            if (state === 'FOR_SALE') {
                return { valid: true };
            }

            return { valid: false, reason: 'Artwork not available for purchase' };
        }

        return { valid: false, reason: 'Unknown action' };
    }
}

export default CoreMarketplaceEngine;

if (typeof window !== 'undefined') {
    window.CoreMarketplaceEngine = CoreMarketplaceEngine;
}
