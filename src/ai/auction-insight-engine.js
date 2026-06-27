/**
 * Auction Insight Engine - Bid Pattern Analysis Service
 *
 * Features:
 * - Bid pattern analysis (trend detection)
 * - Market behavior explanation
 * - Risk assessment (manipulation detection)
 * - Entry/exit signals
 * - NO chat, NO training, stateless
 *
 * Input: bids history
 * Output: { trend, explanation, risk, signal }
 */

class AuctionInsightEngine {
    constructor() {
        // Thresholds for pattern detection
        this.thresholds = {
            rapidBidWindow: 60000, // 1 minute
            rapidBidCount: 5,
            priceJumpPercent: 50,
            suspiciousBidWindow: 30000, // 30 seconds
            suspiciousBidCount: 3,
            overheatedMultiplier: 3.0
        };

        console.log(' AuctionInsightEngine initialized');
    }

    /**
     * Analyze auction bids and provide insights
     */
    async analyze(auction) {
        console.log(' Analyzing auction:', auction.id || 'Unknown');

        const bids = auction.bids || [];

        if (bids.length === 0) {
            return this.getEmptyAuctionInsight(auction);
        }

        // 1. Detect trend
        const trend = this.detectTrend(bids, auction);

        // 2. Analyze bid velocity
        const velocity = this.analyzeBidVelocity(bids);

        // 3. Detect manipulation patterns
        const manipulation = this.detectManipulation(bids);

        // 4. Calculate risk level
        const risk = this.calculateRisk({
            trend,
            velocity,
            manipulation,
            bids,
            auction
        });

        // 5. Generate signal
        const signal = this.generateSignal({
            trend,
            velocity,
            manipulation,
            risk,
            bids,
            auction
        });

        // 6. Build explanation
        const explanation = this.buildExplanation({
            trend,
            velocity,
            manipulation,
            risk,
            signal,
            bids
        });

        return {
            trend: trend.type,
            explanation,
            risk: {
                level: risk.level,
                score: risk.score,
                factors: risk.factors
            },
            signal: {
                action: signal.action,
                confidence: signal.confidence,
                reason: signal.reason
            },
            metadata: {
                totalBids: bids.length,
                priceRange: {
                    min: Math.min(...bids.map(b => b.amount)),
                    max: Math.max(...bids.map(b => b.amount))
                },
                velocity: velocity.bidsPerMinute
            }
        };
    }

    /**
     * Detect price trend
     */
    detectTrend(bids, auction) {
        if (bids.length < 2) {
            return { type: 'stable', strength: 0 };
        }

        // Sort by timestamp
        const sortedBids = [...bids].sort((a, b) => a.timestamp - b.timestamp);

        // Calculate price changes
        const changes = [];
        for (let i = 1; i < sortedBids.length; i++) {
            const prev = sortedBids[i - 1].amount;
            const curr = sortedBids[i].amount;
            const change = ((curr - prev) / prev) * 100;
            changes.push(change);
        }

        const avgChange = changes.reduce((sum, c) => sum + c, 0) / changes.length;
        const maxChange = Math.max(...changes);

        // Detect trend type
        if (avgChange > 20) {
            return { type: 'bullish', strength: Math.min(avgChange / 20, 1.0) };
        } else if (avgChange > 10) {
            return { type: 'rising', strength: Math.min(avgChange / 10, 1.0) };
        } else if (maxChange > this.thresholds.priceJumpPercent) {
            return { type: 'volatile', strength: Math.min(maxChange / 50, 1.0) };
        } else if (avgChange < 5) {
            return { type: 'stable', strength: 0.5 };
        } else {
            return { type: 'moderate', strength: 0.6 };
        }
    }

    /**
     * Analyze bid velocity
     */
    analyzeBidVelocity(bids) {
        if (bids.length < 2) {
            return { bidsPerMinute: 0, acceleration: 0 };
        }

        const sortedBids = [...bids].sort((a, b) => a.timestamp - b.timestamp);
        const firstBid = sortedBids[0];
        const lastBid = sortedBids[sortedBids.length - 1];
        const duration = lastBid.timestamp - firstBid.timestamp;

        const bidsPerMinute = (bids.length / duration) * 60000;

        // Check recent acceleration (last 5 bids vs previous 5)
        let acceleration = 0;
        if (bids.length >= 10) {
            const recent = sortedBids.slice(-5);
            const previous = sortedBids.slice(-10, -5);

            const recentDuration = recent[recent.length - 1].timestamp - recent[0].timestamp;
            const previousDuration = previous[previous.length - 1].timestamp - previous[0].timestamp;

            if (previousDuration > 0 && recentDuration > 0) {
                const recentRate = 5 / recentDuration;
                const previousRate = 5 / previousDuration;
                acceleration = (recentRate - previousRate) / previousRate;
            }
        }

        return {
            bidsPerMinute: parseFloat(bidsPerMinute.toFixed(2)),
            acceleration: parseFloat(acceleration.toFixed(2))
        };
    }

    /**
     * Detect manipulation patterns
     */
    detectManipulation(bids) {
        const patterns = [];

        // Pattern 1: Rapid sequential bids from same bidder
        const bidderCounts = {};
        bids.forEach(bid => {
            bidderCounts[bid.bidder] = (bidderCounts[bid.bidder] || 0) + 1;
        });

        const maxBidsFromOne = Math.max(...Object.values(bidderCounts));
        if (maxBidsFromOne > bids.length * 0.5) {
            patterns.push({
                type: 'single_bidder_dominance',
                severity: 'high',
                description: 'One bidder placed >50% of all bids'
            });
        }

        // Pattern 2: Suspicious bid timing (too fast)
        const sortedBids = [...bids].sort((a, b) => a.timestamp - b.timestamp);
        let rapidBidCount = 0;

        for (let i = 1; i < sortedBids.length; i++) {
            const timeDiff = sortedBids[i].timestamp - sortedBids[i - 1].timestamp;
            if (timeDiff < this.thresholds.suspiciousBidWindow) {
                rapidBidCount++;
            }
        }

        if (rapidBidCount > this.thresholds.suspiciousBidCount) {
            patterns.push({
                type: 'rapid_bidding',
                severity: 'medium',
                description: `${rapidBidCount} bids placed within 30 seconds`
            });
        }

        // Pattern 3: Artificial price inflation (huge jumps)
        for (let i = 1; i < sortedBids.length; i++) {
            const prev = sortedBids[i - 1].amount;
            const curr = sortedBids[i].amount;
            const jump = ((curr - prev) / prev) * 100;

            if (jump > this.thresholds.priceJumpPercent) {
                patterns.push({
                    type: 'price_jump',
                    severity: 'medium',
                    description: `${jump.toFixed(0)}% price jump detected`
                });
                break; // Only report once
            }
        }

        return {
            detected: patterns.length > 0,
            patterns,
            score: Math.min(patterns.length / 3, 1.0)
        };
    }

    /**
     * Calculate risk level
     */
    calculateRisk(analysis) {
        let riskScore = 0;
        const factors = [];

        // Factor 1: Manipulation detected
        if (analysis.manipulation.detected) {
            riskScore += 0.4 * analysis.manipulation.score;
            factors.push(`Manipulation patterns detected (${analysis.manipulation.patterns.length})`);
        }

        // Factor 2: High velocity
        if (analysis.velocity.bidsPerMinute > 10) {
            riskScore += 0.2;
            factors.push('Very high bid velocity');
        }

        // Factor 3: Volatile trend
        if (analysis.trend.type === 'volatile') {
            riskScore += 0.2;
            factors.push('Volatile price movement');
        }

        // Factor 4: Overheated (price vs starting price)
        if (analysis.bids.length > 0 && analysis.auction.startingPrice) {
            const currentPrice = Math.max(...analysis.bids.map(b => b.amount));
            const multiplier = currentPrice / analysis.auction.startingPrice;

            if (multiplier > this.thresholds.overheatedMultiplier) {
                riskScore += 0.2;
                factors.push(`Price ${multiplier.toFixed(1)}x starting price`);
            }
        }

        // Determine risk level
        let level;
        if (riskScore >= 0.7) {
            level = 'high';
        } else if (riskScore >= 0.4) {
            level = 'medium';
        } else {
            level = 'low';
        }

        return {
            level,
            score: parseFloat((riskScore * 100).toFixed(1)),
            factors
        };
    }

    /**
     * Generate trading signal
     */
    generateSignal(analysis) {
        const { trend, velocity, manipulation, risk, bids, auction } = analysis;

        // High risk = avoid
        if (risk.level === 'high') {
            return {
                action: 'avoid',
                confidence: 0.8,
                reason: 'High risk detected - possible manipulation'
            };
        }

        // Manipulation detected = caution
        if (manipulation.detected) {
            return {
                action: 'caution',
                confidence: 0.7,
                reason: 'Suspicious bid patterns detected'
            };
        }

        // Stable trend + low risk = good entry
        if (trend.type === 'stable' && risk.level === 'low') {
            return {
                action: 'entry',
                confidence: 0.75,
                reason: 'Stable price with low risk'
            };
        }

        // Rising trend + moderate risk = consider entry
        if (trend.type === 'rising' && risk.level === 'low') {
            return {
                action: 'entry',
                confidence: 0.65,
                reason: 'Rising price with healthy momentum'
            };
        }

        // Bullish trend + high velocity = overheated
        if (trend.type === 'bullish' && velocity.bidsPerMinute > 5) {
            return {
                action: 'wait',
                confidence: 0.6,
                reason: 'Market overheated - wait for cooldown'
            };
        }

        // Volatile = wait
        if (trend.type === 'volatile') {
            return {
                action: 'wait',
                confidence: 0.7,
                reason: 'High volatility - wait for stabilization'
            };
        }

        // Default: hold
        return {
            action: 'hold',
            confidence: 0.5,
            reason: 'Moderate conditions - monitor closely'
        };
    }

    /**
     * Build human-readable explanation
     */
    buildExplanation(analysis) {
        const parts = [];

        // Trend explanation
        const trendExplanations = {
            'bullish': 'Price is rising rapidly with strong momentum',
            'rising': 'Price is steadily increasing',
            'volatile': 'Price is fluctuating significantly',
            'stable': 'Price is holding steady',
            'moderate': 'Price is moving moderately'
        };

        parts.push(trendExplanations[analysis.trend.type]);

        // Velocity explanation
        if (analysis.velocity.bidsPerMinute > 10) {
            parts.push('Very high bidding activity');
        } else if (analysis.velocity.bidsPerMinute > 5) {
            parts.push('High bidding activity');
        } else if (analysis.velocity.bidsPerMinute > 2) {
            parts.push('Moderate bidding activity');
        } else {
            parts.push('Low bidding activity');
        }

        // Manipulation warning
        if (analysis.manipulation.detected) {
            const pattern = analysis.manipulation.patterns[0];
            parts.push(` ${pattern.description}`);
        }

        // Risk explanation
        if (analysis.risk.level === 'high') {
            parts.push(' High risk - exercise caution');
        } else if (analysis.risk.level === 'medium') {
            parts.push('Moderate risk level');
        }

        // Signal explanation
        const signalEmojis = {
            'entry': '',
            'wait': '⏸️',
            'hold': '⏳',
            'caution': '',
            'avoid': '🚫'
        };

        const emoji = signalEmojis[analysis.signal.action] || '';
        parts.push(`${emoji} ${analysis.signal.reason}`);

        return parts.join('. ');
    }

    /**
     * Get insight for empty auction
     */
    getEmptyAuctionInsight(auction) {
        return {
            trend: 'stable',
            explanation: 'No bids yet. Auction just started.',
            risk: {
                level: 'low',
                score: 0,
                factors: []
            },
            signal: {
                action: 'entry',
                confidence: 0.8,
                reason: 'Early entry opportunity - no competition yet'
            },
            metadata: {
                totalBids: 0,
                priceRange: {
                    min: auction.startingPrice || 0,
                    max: auction.startingPrice || 0
                },
                velocity: 0
            }
        };
    }
}

// Export
window.AuctionInsightEngine = AuctionInsightEngine;

console.log(' AuctionInsightEngine module loaded');
