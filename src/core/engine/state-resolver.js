import { ARTWORK_STATES, AUCTION_CONSTANTS } from './types.js';
import AuctionEngine from './auction-engine.js';

class StateResolver {
    constructor() {
        this.auctionEngine = new AuctionEngine();
    }

    resolveState(artworkData, auctionData, offerData, currentTime) {
        if (!artworkData) return ARTWORK_STATES.DRAFT;

        if (auctionData && auctionData.sold) {
            return ARTWORK_STATES.SOLD;
        }

        if (artworkData.sold) {
            return ARTWORK_STATES.SOLD;
        }

        if (auctionData && auctionData.startTime) {
            if (auctionData.settlementPending || auctionData.status === 'settlement_pending') {
                return ARTWORK_STATES.SETTLEMENT_PENDING;
            }

            if (auctionData.defaulted || auctionData.status === 'defaulted') {
                return ARTWORK_STATES.SETTLEMENT_DEFAULTED;
            }

            if (this.auctionEngine.isAuctionActive(auctionData, currentTime)) {
                return ARTWORK_STATES.AUCTION;
            }

            if (this.auctionEngine.hasAuctionEnded(auctionData, currentTime)) {
                const auctionEndTime = this.auctionEngine.calculateAuctionEndTime(auctionData);
                const winnerDeadline = auctionData.winnerDeadline || auctionData.settlementDeadline || (auctionEndTime + AUCTION_CONSTANTS.SETTLEMENT_WINDOW_MS);

                if (currentTime < winnerDeadline) {
                    return ARTWORK_STATES.SETTLEMENT_PENDING;
                }

                return ARTWORK_STATES.SETTLEMENT_DEFAULTED;
            }
        }

        if (artworkData.minted && (artworkData.forSale || artworkData.listed)) {
            return ARTWORK_STATES.FOR_SALE;
        }

        return ARTWORK_STATES.DRAFT;
    }

    getStateMetadata(state, artworkData, auctionData, offerData, currentTime) {
        const metadata = { state };

        switch (state) {
            case ARTWORK_STATES.AUCTION:
                if (auctionData) {
                    const endTime = this.auctionEngine.calculateAuctionEndTime(auctionData);
                    const winner = this.auctionEngine.getCurrentWinner(auctionData);

                    metadata.endTime = endTime;
                    metadata.timeRemaining = Math.max(0, endTime - currentTime);
                    metadata.currentBid = winner ? winner.bid : null;
                    metadata.currentBidder = winner ? winner.address : null;
                    metadata.bidCount = auctionData.bids ? auctionData.bids.length : 0;
                    metadata.floorPrice = artworkData.floorPrice;
                }
                break;

            case ARTWORK_STATES.SETTLEMENT_PENDING:
                if (auctionData) {
                    const auctionEndTime = this.auctionEngine.calculateAuctionEndTime(auctionData);
                    const winner = this.auctionEngine.getCurrentWinner(auctionData);
                    if (winner) {
                        const winnerDeadline = auctionData.winnerDeadline || auctionData.settlementDeadline || (auctionEndTime + AUCTION_CONSTANTS.SETTLEMENT_WINDOW_MS);
                        metadata.buyer = winner.address;
                        metadata.price = winner.bid;
                        metadata.settlementDeadline = winnerDeadline;
                        metadata.timeRemaining = Math.max(0, winnerDeadline - currentTime);
                    }
                }
                break;

            case ARTWORK_STATES.SETTLEMENT_DEFAULTED:
                metadata.floorCreated = false;
                metadata.minted = false;
                break;

            case ARTWORK_STATES.FOR_SALE:
                metadata.price = artworkData.salePrice || artworkData.floorPrice;
                metadata.canonicalFloor = artworkData.canonicalFloor || artworkData.floorPrice;
                metadata.resaleEnabled = true;
                break;

            case ARTWORK_STATES.SOLD:
                metadata.soldPrice = auctionData?.highestBid || artworkData.soldPrice || null;
                metadata.buyer = auctionData?.highestBidder || artworkData.buyer || null;
                break;

            case ARTWORK_STATES.DRAFT:
                metadata.floorPrice = artworkData.floorPrice || null;
                break;
        }

        return metadata;
    }
}

export default StateResolver;
