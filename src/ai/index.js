/**
 * AI Services Index
 *
 * Exports all AI modules:
 * - NFTValuationEngine: Price estimation for NFTs
 * - AuctionInsightEngine: Bid pattern analysis
 * - SystemDebugAssistant: Log and error analysis
 */

// Import AI modules
import './nft-valuation-engine.js';
import './auction-insight-engine.js';
import './system-debug-assistant.js';

// Initialize AI services
class AIServices {
    constructor() {
        this.valuation = new window.NFTValuationEngine();
        this.auction = new window.AuctionInsightEngine();
        this.debug = new window.SystemDebugAssistant();

        console.log('🤖 AI Services initialized');
    }

    /**
     * Evaluate NFT price
     */
    async evaluateNFT(nft) {
        return await this.valuation.evaluate(nft);
    }

    /**
     * Analyze auction bids
     */
    async analyzeAuction(auction) {
        return await this.auction.analyze(auction);
    }

    /**
     * Diagnose system issue
     */
    diagnoseIssue(input) {
        return this.debug.diagnose(input);
    }

    /**
     * Generate system health report
     */
    generateHealthReport(logs) {
        return this.debug.generateReport(logs);
    }

    /**
     * Detect bottlenecks
     */
    detectBottlenecks(logs) {
        return this.debug.detectBottlenecks(logs);
    }
}

// Export singleton
window.AIServices = new AIServices();

console.log('🤖 AI Services module loaded');
