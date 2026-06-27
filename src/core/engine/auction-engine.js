import { AUCTION_CONSTANTS } from './types.js';

class AuctionEngine {
    isAuctionActive(auctionData, currentTime) {
        if (!auctionData || !auctionData.startTime) return false;
        if (auctionData.sold) return false;
        if (auctionData.finalized) return false;

        const endTime = auctionData.endTime || (auctionData.startTime + AUCTION_CONSTANTS.DURATION_MS);
        return currentTime < endTime;
    }

    calculateAuctionEndTime(auctionData) {
        if (!auctionData || !auctionData.startTime) return 0;

        if (auctionData.endTime) {
            return auctionData.endTime;
        }

        return auctionData.startTime + AUCTION_CONSTANTS.DURATION_MS;
    }

    hasAuctionEnded(auctionData, currentTime) {
        if (!auctionData || !auctionData.startTime) return false;

        const endTime = this.calculateAuctionEndTime(auctionData);
        return currentTime >= endTime;
    }

    getCurrentWinner(auctionData) {
        if (!auctionData || !auctionData.highestBidder) return null;
        if (auctionData.highestBidder === '0x0000000000000000000000000000000000000000') return null;

        return {
            address: auctionData.highestBidder,
            bid: auctionData.highestBid
        };
    }

    getSettlementDeadline(auctionEndTime) {
        return auctionEndTime + AUCTION_CONSTANTS.SETTLEMENT_WINDOW_MS;
    }

    isValidBidAmount(bidAmount, currentHighestBid, floorPrice) {
        const bid = typeof bidAmount === 'bigint' ? bidAmount : BigInt(bidAmount);
        const floor = typeof floorPrice === 'bigint' ? floorPrice : BigInt(floorPrice);

        if (bid < floor) return false;

        if (currentHighestBid) {
            const highest = typeof currentHighestBid === 'bigint' ? currentHighestBid : BigInt(currentHighestBid);
            const percentIncrement = (highest * 250n + 9999n) / 10000n;
            const absoluteIncrement = 10000000000000000n; // 0.01 ETH
            const requiredIncrement = percentIncrement > absoluteIncrement ? percentIncrement : absoluteIncrement;
            if (bid < highest + requiredIncrement) return false;
        }

        return true;
    }

    wouldBidExtendAuction(auctionData, currentTime) {
        if (!this.isAuctionActive(auctionData, currentTime)) return false;

        const endTime = this.calculateAuctionEndTime(auctionData);
        const timeUntilEnd = endTime - currentTime;

        return timeUntilEnd < AUCTION_CONSTANTS.EXTENSION_THRESHOLD_MS;
    }

    canCalculateExtensions(auctionData) {
        return auctionData &&
               auctionData.bids &&
               auctionData.bids.length > 0 &&
               auctionData.bids.some(bid => bid.timestamp !== undefined);
    }

    canCalculateSettlementWindow(auctionData) {
        return auctionData &&
               auctionData.bids &&
               auctionData.bids.length > 0;
    }
}

export default AuctionEngine;
