import { RATE_LIMITS, RISK_THRESHOLDS } from './types.js';

class RiskEngine {
    isWalletRateLimited(walletAddress, action, actionHistory, currentTime) {
        if (!walletAddress || !actionHistory) return false;

        const walletHistory = actionHistory[walletAddress];
        if (!walletHistory) return false;

        if (action === 'bid') {
            const oneHourAgo = currentTime - (3600 * 1000);
            const recentBids = walletHistory.filter(h => h.action === 'bid' && h.timestamp > oneHourAgo);

            if (recentBids.length >= RATE_LIMITS.BIDS_PER_WALLET_PER_HOUR) return true;

            const tenMinAgo = currentTime - (10 * 60 * 1000);
            const recentBidsInAuction = walletHistory.filter(h =>
                h.action === 'bid' &&
                h.timestamp > tenMinAgo &&
                h.artworkId === walletHistory[walletHistory.length - 1]?.artworkId
            );

            if (recentBidsInAuction.length >= RATE_LIMITS.BIDS_PER_WALLET_PER_AUCTION_PER_10MIN) return true;
        }

        if (action === 'offer') {
            const oneHourAgo = currentTime - (3600 * 1000);
            const lastArtworkId = walletHistory[walletHistory.length - 1]?.artworkId;

            const recentOffersForArtwork = walletHistory.filter(h =>
                h.action === 'offer' &&
                h.timestamp > oneHourAgo &&
                h.artworkId === lastArtworkId
            );

            if (recentOffersForArtwork.length >= RATE_LIMITS.OFFERS_PER_WALLET_PER_ARTWORK_PER_HOUR) return true;
        }

        return false;
    }

    calculateWalletRiskScore(walletAddress, behaviorHistory) {
        if (!walletAddress || !behaviorHistory) return 0;

        let score = 0;

        const totalBids = behaviorHistory.totalBids || 0;
        const totalPurchases = behaviorHistory.totalPurchases || 0;
        const accountAge = behaviorHistory.accountAge || 0;

        if (totalBids > RISK_THRESHOLDS.SPAM_BID_COUNT) {
            const purchaseRate = totalPurchases / totalBids;
            if (purchaseRate < RISK_THRESHOLDS.LOW_PURCHASE_RATE) {
                score += 40;
            }
        }

        if (accountAge < 24 * 3600 * 1000 && totalBids > 5) {
            score += 30;
        }

        const bidFrequency = behaviorHistory.bidFrequency || 0;
        if (bidFrequency > 20) {
            score += 20;
        }

        const similarPatterns = behaviorHistory.similarPatterns || 0;
        if (similarPatterns > 3) {
            score += 10;
        }

        return Math.min(score, 100);
    }

    isBidSpam(walletAddress, artworkId, bidHistory, currentTime) {
        if (!bidHistory || bidHistory.length === 0) return false;

        const walletBids = bidHistory.filter(b => b.bidder === walletAddress && b.artworkId === artworkId);

        const tenMinAgo = currentTime - (10 * 60 * 1000);
        const recentBids = walletBids.filter(b => b.timestamp > tenMinAgo);

        return recentBids.length >= RATE_LIMITS.BIDS_PER_WALLET_PER_AUCTION_PER_10MIN;
    }

    getWalletBehaviorSummary(walletAddress, behaviorHistory) {
        if (!walletAddress || !behaviorHistory) {
            return {
                totalBids: 0,
                totalPurchases: 0,
                purchaseRate: 0,
                riskScore: 0
            };
        }

        const totalBids = behaviorHistory.totalBids || 0;
        const totalPurchases = behaviorHistory.totalPurchases || 0;
        const purchaseRate = totalBids > 0 ? totalPurchases / totalBids : 0;
        const riskScore = this.calculateWalletRiskScore(walletAddress, behaviorHistory);

        return {
            totalBids,
            totalPurchases,
            purchaseRate,
            riskScore
        };
    }
}

export default RiskEngine;
