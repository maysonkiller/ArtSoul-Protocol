/**
 * NFT Valuation Engine - Price Estimation Service
 *
 * Features:
 * - Rule-based + lightweight scoring (80% logic, 20% AI)
 * - Price range estimation
 * - Confidence score
 * - Explanation bullets
 * - NO chat, NO training, stateless
 *
 * Input: image metadata + traits
 * Output: { priceRange, confidence, reasons }
 */

class NFTValuationEngine {
    constructor() {
        // Base weights for scoring
        this.weights = {
            style: 0.25,
            rarity: 0.30,
            quality: 0.25,
            market: 0.20
        };

        // Market baseline (ETH)
        this.marketBaseline = {
            low: 0.1,
            medium: 0.5,
            high: 2.0
        };

        console.log(' NFTValuationEngine initialized');
    }

    /**
     * Evaluate NFT and estimate price
     */
    async evaluate(nft) {
        console.log(' Evaluating NFT:', nft.name || 'Unnamed');

        // 1. Analyze style
        const styleScore = this.analyzeStyle(nft);

        // 2. Analyze rarity
        const rarityScore = this.analyzeRarity(nft);

        // 3. Analyze quality
        const qualityScore = this.analyzeQuality(nft);

        // 4. Analyze market context
        const marketScore = this.analyzeMarket(nft);

        // Calculate weighted score
        const totalScore =
            styleScore.score * this.weights.style +
            rarityScore.score * this.weights.rarity +
            qualityScore.score * this.weights.quality +
            marketScore.score * this.weights.market;

        // Convert score to price range
        const priceRange = this.scoreToPriceRange(totalScore);

        // Calculate confidence
        const confidence = this.calculateConfidence([
            styleScore,
            rarityScore,
            qualityScore,
            marketScore
        ]);

        // Build explanation
        const reasons = this.buildExplanation({
            styleScore,
            rarityScore,
            qualityScore,
            marketScore,
            totalScore
        });

        return {
            priceRange: {
                min: priceRange.min,
                max: priceRange.max,
                currency: 'ETH'
            },
            confidence: {
                score: confidence,
                level: this.getConfidenceLevel(confidence)
            },
            reasons,
            breakdown: {
                style: styleScore.score,
                rarity: rarityScore.score,
                quality: qualityScore.score,
                market: marketScore.score,
                total: totalScore
            }
        };
    }

    /**
     * Analyze style
     */
    analyzeStyle(nft) {
        const traits = nft.traits || {};
        let score = 0.5; // baseline
        const factors = [];

        // Check for popular styles
        if (traits.style) {
            const popularStyles = ['cyberpunk', 'abstract', 'surreal', 'minimalist'];
            if (popularStyles.includes(traits.style.toLowerCase())) {
                score += 0.2;
                factors.push(`Popular style: ${traits.style}`);
            }
        }

        // Check for color complexity
        if (traits.colors && traits.colors.length > 5) {
            score += 0.15;
            factors.push('Rich color palette');
        }

        // Check for detail level
        if (traits.detail === 'high') {
            score += 0.15;
            factors.push('High detail level');
        }

        return {
            score: Math.min(score, 1.0),
            factors
        };
    }

    /**
     * Analyze rarity
     */
    analyzeRarity(nft) {
        const traits = nft.traits || {};
        let score = 0.5; // baseline
        const factors = [];

        // Check trait rarity
        if (traits.rarity) {
            const rarityMap = {
                'common': 0.3,
                'uncommon': 0.5,
                'rare': 0.7,
                'epic': 0.85,
                'legendary': 1.0
            };
            score = rarityMap[traits.rarity.toLowerCase()] || 0.5;
            factors.push(`Rarity: ${traits.rarity}`);
        }

        // Check unique traits
        if (traits.unique && traits.unique.length > 0) {
            score += 0.1 * Math.min(traits.unique.length, 3);
            factors.push(`${traits.unique.length} unique trait(s)`);
        }

        // Check edition size
        if (nft.edition) {
            if (nft.edition.total < 10) {
                score += 0.2;
                factors.push('Limited edition (< 10)');
            } else if (nft.edition.total < 100) {
                score += 0.1;
                factors.push('Small edition (< 100)');
            }
        }

        return {
            score: Math.min(score, 1.0),
            factors
        };
    }

    /**
     * Analyze quality
     */
    analyzeQuality(nft) {
        let score = 0.5; // baseline
        const factors = [];

        // Check resolution
        if (nft.metadata && nft.metadata.resolution) {
            const [width, height] = nft.metadata.resolution.split('x').map(Number);
            if (width >= 2000 && height >= 2000) {
                score += 0.2;
                factors.push('High resolution (2K+)');
            } else if (width >= 1000 && height >= 1000) {
                score += 0.1;
                factors.push('Good resolution (1K+)');
            }
        }

        // Check file format
        if (nft.metadata && nft.metadata.format) {
            const highQualityFormats = ['png', 'svg', 'webp'];
            if (highQualityFormats.includes(nft.metadata.format.toLowerCase())) {
                score += 0.1;
                factors.push(`High-quality format: ${nft.metadata.format}`);
            }
        }

        // Check artist reputation (if available)
        if (nft.artist && nft.artist.verified) {
            score += 0.2;
            factors.push('Verified artist');
        }

        return {
            score: Math.min(score, 1.0),
            factors
        };
    }

    /**
     * Analyze market context
     */
    analyzeMarket(nft) {
        let score = 0.5; // baseline
        const factors = [];

        // Check category demand (simulated - in real app, fetch from DB)
        const categoryDemand = {
            'art': 0.7,
            'photography': 0.6,
            'generative': 0.8,
            'pfp': 0.9,
            'music': 0.5
        };

        const category = nft.category || 'art';
        score = categoryDemand[category.toLowerCase()] || 0.5;
        factors.push(`Category demand: ${category}`);

        // Check recent sales (simulated)
        if (nft.similarSales) {
            const avgPrice = nft.similarSales.reduce((sum, s) => sum + s.price, 0) / nft.similarSales.length;
            if (avgPrice > 1.0) {
                score += 0.2;
                factors.push('Strong similar sales');
            } else if (avgPrice > 0.5) {
                score += 0.1;
                factors.push('Moderate similar sales');
            }
        }

        return {
            score: Math.min(score, 1.0),
            factors
        };
    }

    /**
     * Convert score to price range
     */
    scoreToPriceRange(score) {
        // Map score (0-1) to price range
        const basePrice = this.marketBaseline.low;
        const maxPrice = this.marketBaseline.high;

        const estimatedPrice = basePrice + (score * (maxPrice - basePrice));

        // Add variance (±20%)
        const variance = 0.20;
        const min = estimatedPrice * (1 - variance);
        const max = estimatedPrice * (1 + variance);

        return {
            min: parseFloat(min.toFixed(3)),
            max: parseFloat(max.toFixed(3))
        };
    }

    /**
     * Calculate confidence
     */
    calculateConfidence(scores) {
        // Confidence based on consistency of scores
        const values = scores.map(s => s.score);
        const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);

        // Lower std dev = higher confidence
        const confidence = Math.max(0, 1 - (stdDev * 2));

        return parseFloat((confidence * 100).toFixed(1));
    }

    /**
     * Get confidence level
     */
    getConfidenceLevel(confidence) {
        if (confidence >= 80) return 'high';
        if (confidence >= 60) return 'medium';
        return 'low';
    }

    /**
     * Build explanation
     */
    buildExplanation(analysis) {
        const reasons = [];

        // Style factors
        if (analysis.styleScore.factors.length > 0) {
            reasons.push({
                category: 'Style',
                impact: this.getImpact(analysis.styleScore.score),
                details: analysis.styleScore.factors
            });
        }

        // Rarity factors
        if (analysis.rarityScore.factors.length > 0) {
            reasons.push({
                category: 'Rarity',
                impact: this.getImpact(analysis.rarityScore.score),
                details: analysis.rarityScore.factors
            });
        }

        // Quality factors
        if (analysis.qualityScore.factors.length > 0) {
            reasons.push({
                category: 'Quality',
                impact: this.getImpact(analysis.qualityScore.score),
                details: analysis.qualityScore.factors
            });
        }

        // Market factors
        if (analysis.marketScore.factors.length > 0) {
            reasons.push({
                category: 'Market',
                impact: this.getImpact(analysis.marketScore.score),
                details: analysis.marketScore.factors
            });
        }

        return reasons;
    }

    /**
     * Get impact level
     */
    getImpact(score) {
        if (score >= 0.7) return 'positive';
        if (score >= 0.4) return 'neutral';
        return 'negative';
    }
}

// Export
window.NFTValuationEngine = NFTValuationEngine;

console.log(' NFTValuationEngine module loaded');
