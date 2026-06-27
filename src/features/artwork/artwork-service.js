// ArtworkService - Business logic for artwork operations
// Coordinates between Supabase (metadata) and Smart Contracts (ownership)

import { NFTStatus, getStatusLabel, getStatusColor } from '../../core/constants/nft-status.js';

class ArtworkService {
    constructor(supabaseClient, auctionService) {
        this.supabase = supabaseClient;
        this.auctionService = auctionService;
    }

    getSupabaseQueryClient() {
        if (this.supabase?.supabase && typeof this.supabase.supabase.from === 'function') {
            return this.supabase.supabase;
        }

        if (this.supabase && typeof this.supabase.from === 'function') {
            return this.supabase;
        }

        return null;
    }

    requireSupabaseQueryClient() {
        const supabase = this.getSupabaseQueryClient();
        if (!supabase) {
            throw new Error('Supabase query client is not exposed by ArtSoulDB');
        }
        return supabase;
    }

    disabledLegacyMutation(action) {
        throw new Error(`${action} is disabled for public testnet. Use a backend operator endpoint before enabling this flow.`);
    }

    filterPublicTestnetArtworks(artworks, includeLegacy = false) {
        if (includeLegacy) {
            return Array.isArray(artworks) ? artworks : [];
        }

        if (
            typeof window !== 'undefined' &&
            typeof window.ArtSoulDiscovery?.filterPublicTestnetArtworks === 'function'
        ) {
            return window.ArtSoulDiscovery.filterPublicTestnetArtworks(artworks);
        }

        return Array.isArray(artworks) ? artworks : [];
    }

    async getProjectionArtworks(filters = {}) {
        const source = this.supabase || (typeof window !== 'undefined' ? window.ArtSoulDB : null);
        if (!source || typeof source.getPublicProjectionArtworks !== 'function') {
            return [];
        }

        try {
            return await source.getPublicProjectionArtworks({
                limit: filters.limit || 200,
                chain_id: filters.chain_id,
                view: filters.view,
                creator: filters.creator
            });
        } catch (error) {
            console.warn('[ArtworkService] V4.1 projection feed unavailable:', error.message);
            return [];
        }
    }

    async getFallbackArtworks(filters = {}) {
        const fallback = this.supabase || (typeof window !== 'undefined' ? window.ArtSoulDB : null);

        if (!fallback || typeof fallback.getArtworks !== 'function') {
            return [];
        }

        const dbFilters = {};
        if (filters.creator) {
            dbFilters.creator_id = filters.creator.toLowerCase();
        }
        if (filters.file_type && filters.file_type !== 'all') {
            dbFilters.file_type = filters.file_type;
        }

        return await fallback.getArtworks(dbFilters);
    }

    applyLocalArtworkFilters(artworks, filters = {}) {
        const {
            status = 'all',
            file_type = 'all',
            sort = 'newest',
            creator = null,
            minPrice = null,
            maxPrice = null,
            searchQuery = null,
            limit = 100,
            includeHidden = false,
            includeLegacy = false
        } = filters;

        const normalize = (value) => (value || '').toString().toLowerCase();
        const toNumber = (value) => {
            const parsed = parseFloat(value);
            return Number.isFinite(parsed) ? parsed : 0;
        };
        const toTimestamp = (value) => {
            const timestamp = new Date(value || 0).getTime();
            return Number.isFinite(timestamp) ? timestamp : 0;
        };

        let result = Array.isArray(artworks) ? [...artworks] : [];

        if (!includeHidden) {
            result = result.filter(artwork =>
                artwork.is_hidden !== true &&
                artwork.is_blocked !== true &&
                artwork.is_deleted !== true
            );
        }

        result = this.filterPublicTestnetArtworks(result, includeLegacy);

        if (status && status !== 'all') {
            result = result.filter(artwork => normalize(artwork.status) === normalize(status));
        }

        if (file_type && file_type !== 'all') {
            result = result.filter(artwork => normalize(artwork.file_type) === normalize(file_type));
        }

        if (creator) {
            const creatorAddress = normalize(creator);
            result = result.filter(artwork =>
                normalize(artwork.creator_id) === creatorAddress ||
                normalize(artwork.creator?.wallet_address) === creatorAddress
            );
        }

        if (minPrice !== null && minPrice !== '') {
            const min = parseFloat(minPrice);
            if (Number.isFinite(min)) {
                result = result.filter(artwork => toNumber(artwork.creator_value) >= min);
            }
        }

        if (maxPrice !== null && maxPrice !== '') {
            const max = parseFloat(maxPrice);
            if (Number.isFinite(max)) {
                result = result.filter(artwork => toNumber(artwork.creator_value) <= max);
            }
        }

        if (searchQuery && searchQuery.trim() !== '') {
            const query = normalize(searchQuery.trim());
            result = result.filter(artwork =>
                normalize(artwork.title).includes(query) ||
                normalize(artwork.description).includes(query)
            );
        }

        if (sort === 'newest') {
            result.sort((a, b) => toTimestamp(b.created_at) - toTimestamp(a.created_at));
        } else if (sort === 'oldest') {
            result.sort((a, b) => toTimestamp(a.created_at) - toTimestamp(b.created_at));
        } else if (sort === 'price_high') {
            result.sort((a, b) => toNumber(b.creator_value) - toNumber(a.creator_value));
        } else if (sort === 'price_low') {
            result.sort((a, b) => toNumber(a.creator_value) - toNumber(b.creator_value));
        } else if (sort === 'popular' || sort === 'ai_value') {
            result.sort((a, b) =>
                toNumber(b.system_value ?? b.ai_value) - toNumber(a.system_value ?? a.ai_value)
            );
        }

        const maxItems = parseInt(limit, 10);
        return result.slice(0, Number.isFinite(maxItems) ? maxItems : 100);
    }

    /**
     * Get artwork with auction data
     * Combines Supabase metadata with contract auction state
     */
    async getArtworkWithAuction(artworkId) {
        try {
            // Get artwork metadata from Supabase
            const artwork = await this.supabase.getArtworkById(artworkId);

            if (!artwork) {
                throw new Error('Artwork not found');
            }

            // Get auction state from contract (if exists)
            let auction = null;
            if (artwork.blockchain_id) {
                try {
                    auction = await this.auctionService.getAuctionState(artwork.blockchain_id);
                } catch (error) {
                    console.warn('No auction data for artwork:', artworkId);
                }
            }

            return { artwork, auction };
        } catch (error) {
            console.error('Failed to get artwork with auction:', error);
            throw error;
        }
    }

    /**
     * Filter artworks (done in Supabase, not frontend)
     * Returns filtered results from database
     * Automatically excludes hidden, blocked, and deleted artworks
     * ALSO excludes artworks in Direct Offer Mode cooldown
     */
    async filterArtworks(filters = {}) {
        try {
            const {
                status = 'all',
                file_type = 'all',
                sort = 'newest',
                creator = null,
                minPrice = null,
                maxPrice = null,
                searchQuery = null,
                limit = 100,
                includeHidden = false,  // Admin/creator can see hidden
                includeCooldown = false, // Admin/creator can see cooldown artworks
                includeLegacy = false
            } = filters;

            const supabase = this.getSupabaseQueryClient();
            let artworks = [];
            const projectionArtworks = await this.getProjectionArtworks(filters);

            if (projectionArtworks.length > 0 || !includeLegacy) {
                artworks = projectionArtworks;
            } else if (supabase) {
                let query = supabase
                    .from('artworks')
                    .select('*');

                // CRITICAL: Exclude hidden/blocked/deleted NFTs (unless explicitly requested)
                if (!includeHidden) {
                    query = query
                        .eq('is_hidden', false)
                        .eq('is_blocked', false)
                        .eq('is_deleted', false);
                }

                // Apply filters
                if (status && status !== 'all') {
                    query = query.eq('status', status);
                }

                if (file_type && file_type !== 'all') {
                    query = query.eq('file_type', file_type);
                }

                if (creator) {
                    query = query.eq('creator_id', creator.toLowerCase());
                }

                // Price range filters
                if (minPrice !== null && minPrice !== '') {
                    query = query.gte('creator_value', parseFloat(minPrice));
                }

                if (maxPrice !== null && maxPrice !== '') {
                    query = query.lte('creator_value', parseFloat(maxPrice));
                }

                // Search filter (title or description)
                if (searchQuery && searchQuery.trim() !== '') {
                    query = query.or(`title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`);
                }

                // Apply sorting
                if (sort === 'newest') {
                    query = query.order('created_at', { ascending: false });
                } else if (sort === 'oldest') {
                    query = query.order('created_at', { ascending: true });
                } else if (sort === 'price_high') {
                    query = query.order('creator_value', { ascending: false });
                } else if (sort === 'price_low') {
                    query = query.order('creator_value', { ascending: true });
                } else if (sort === 'popular' || sort === 'ai_value') {
                    query = query.order('system_value', { ascending: false });
                }

                // Apply limit
                query = query.limit(limit);

                const { data, error } = await query;

                if (error) throw error;

                artworks = data || [];
            } else {
                const fallbackArtworks = await this.getFallbackArtworks(filters);
                artworks = this.applyLocalArtworkFilters(fallbackArtworks, filters);
            }

            // Post-filter: Exclude artworks in Direct Offer Mode cooldown
            // This must be done after DB query because cooldown state comes from contract
            if (!includeCooldown && artworks.length > 0) {
                artworks = await this.filterOutCooldownArtworks(artworks);
            }

            artworks = this.filterPublicTestnetArtworks(artworks, includeLegacy);

            return artworks;
        } catch (error) {
            console.error('Failed to filter artworks:', error);
            throw error;
        }
    }

    /**
     * Filter out artworks that are in Direct Offer Mode cooldown
     * These should NOT appear in public gallery/marketplace
     * PERFORMANCE: Uses batch method to reduce blockchain calls
     */
    async filterOutCooldownArtworks(artworks) {
        // Collect artworks with blockchain_id
        const artworksWithBlockchainId = artworks.filter(artwork => artwork.blockchain_id);
        const artworksWithoutBlockchainId = artworks.filter(artwork => !artwork.blockchain_id);

        if (artworksWithBlockchainId.length === 0) {
            return artworks; // No blockchain artworks, return all
        }

        try {
            if (!this.auctionService || typeof this.auctionService.getAuctionStatesBatch !== 'function') {
                return artworks;
            }

            // PERFORMANCE: Batch fetch all auction states in parallel
            const artworkIds = artworksWithBlockchainId.map(artwork => artwork.blockchain_id);
            const offchainDataMap = {};
            artworksWithBlockchainId.forEach(artwork => {
                offchainDataMap[artwork.blockchain_id] = {
                    cooldown_start: artwork.cooldown_start
                };
            });

            const auctionStates = await this.auctionService.getAuctionStatesBatch(
                artworkIds,
                offchainDataMap
            );

            // Create map of artworkId -> auctionState
            const stateMap = new Map();
            auctionStates.forEach(state => {
                stateMap.set(state.artworkId, state);
            });

            // Filter artworks based on shouldHideFromPublic flag
            const filtered = [];

            for (const artwork of artworksWithBlockchainId) {
                const auctionState = stateMap.get(artwork.blockchain_id.toString());

                if (!auctionState) {
                    // Fail-safe: include artwork if no state found
                    filtered.push(artwork);
                    continue;
                }

                // Exclude if should hide from public (in cooldown)
                if (!auctionState.shouldHideFromPublic) {
                    filtered.push(artwork);
                }
            }

            // Combine with artworks without blockchain_id
            return [...artworksWithoutBlockchainId, ...filtered];

        } catch (error) {
            console.error('Failed to batch check cooldown artworks:', error);
            // Fail-safe: return all artworks on error
            return artworks;
        }
    }

    /**
     * Get artworks by votes (for TOP-12)
     */
    async getArtworksByVotes(limit = 12) {
        try {
            const projectionArtworks = await this.getProjectionArtworks({ limit });
            if (projectionArtworks.length > 0) {
                return projectionArtworks;
            }

            const supabase = this.requireSupabaseQueryClient();

            // This should be done with a Supabase view or function
            // For now, get artworks and sort by vote count
            const { data: artworks, error: artworksError } = await supabase
                .from('artworks')
                .select('*, votes(count)')
                .order('votes.count', { ascending: false })
                .limit(limit);

            if (artworksError) {
                // Fallback: get all artworks and count votes manually
                const { data: allArtworks } = await supabase
                    .from('artworks')
                    .select('*')
                    .limit(100);

                const { data: allVotes } = await supabase
                    .from('votes')
                    .select('artwork_id');

                // Count votes per artwork
                const voteCounts = {};
                allVotes?.forEach(vote => {
                    voteCounts[vote.artwork_id] = (voteCounts[vote.artwork_id] || 0) + 1;
                });

                // Add vote count to artworks
                allArtworks?.forEach(artwork => {
                    artwork.vote_count = voteCounts[artwork.id] || 0;
                });

                // Sort by votes and return top N
                return this.filterPublicTestnetArtworks(allArtworks)
                    ?.sort((a, b) => b.vote_count - a.vote_count)
                    .slice(0, limit) || [];
            }

            return this.filterPublicTestnetArtworks(artworks || []);
        } catch (error) {
            console.error('Failed to get artworks by votes:', error);
            throw error;
        }
    }

    /**
     * Search artworks by title or description
     */
    async searchArtworks(searchTerm, limit = 50) {
        try {
            const supabase = this.requireSupabaseQueryClient();
            const { data, error } = await supabase
                .from('artworks')
                .select('*')
                .or(`title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`)
                .limit(limit);

            if (error) throw error;

            return data || [];
        } catch (error) {
            console.error('Failed to search artworks:', error);
            throw error;
        }
    }

    /**
     * Get artwork status for UI display
     */
    getArtworkStatusLabel(status) {
        return getStatusLabel(status);
    }

    /**
     * Get artwork status color
     */
    getArtworkStatusColor(status) {
        return getStatusColor(status);
    }

    /**
     * Check if user owns artwork
     */
    isOwner(artwork, userAddress) {
        if (!userAddress || !artwork.current_owner_address) return false;
        return userAddress.toLowerCase() === artwork.current_owner_address.toLowerCase();
    }

    /**
     * Check if user created artwork
     */
    isCreator(artwork, userAddress) {
        if (!userAddress || !artwork.creator_id) return false;
        return userAddress.toLowerCase() === artwork.creator_id.toLowerCase();
    }

    /**
     * Format price for display
     */
    formatPrice(price) {
        if (!price || price === '0' || price === '0.0') {
            return 'No price set';
        }
        return `${parseFloat(price).toFixed(4)} ETH`;
    }

    /**
     * Validate artwork data before upload
     */
    validateArtworkData(data) {
        const errors = [];

        if (!data.title || data.title.trim().length === 0) {
            errors.push('Title is required');
        }

        if (data.title && data.title.length > 100) {
            errors.push('Title must be less than 100 characters');
        }

        if (data.description && data.description.length > 1000) {
            errors.push('Description must be less than 1000 characters');
        }

        if (!data.creator_value || parseFloat(data.creator_value) <= 0) {
            errors.push('Price must be greater than 0');
        }

        if (!data.file_url) {
            errors.push('File is required');
        }

        if (!data.file_type) {
            errors.push('File type is required');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Hide artwork (soft delete, reversible)
     * Off-chain only - does not affect blockchain
     */
    async hideArtwork(artworkId, reason = null) {
        this.disabledLegacyMutation('Artwork hide');
    }

    /**
     * Unhide artwork (restore visibility)
     */
    async unhideArtwork(artworkId) {
        this.disabledLegacyMutation('Artwork unhide');
    }

    /**
     * Block artwork (moderation action)
     * Off-chain only - does not affect blockchain
     */
    async blockArtwork(artworkId, reason) {
        this.disabledLegacyMutation('Artwork block');
    }

    /**
     * Unblock artwork
     */
    async unblockArtwork(artworkId) {
        this.disabledLegacyMutation('Artwork unblock');
    }

    /**
     * Soft delete artwork (can be restored)
     * Off-chain only - does not affect blockchain
     */
    async softDeleteArtwork(artworkId, reason = null) {
        this.disabledLegacyMutation('Artwork soft delete');
    }

    /**
     * Restore soft deleted artwork
     */
    async restoreArtwork(artworkId) {
        this.disabledLegacyMutation('Artwork restore');
    }

    /**
     * Check if artwork is visible to public
     */
    isVisible(artwork) {
        return !artwork.is_hidden && !artwork.is_blocked && !artwork.is_deleted;
    }
}

// Export for use in other modules
export default ArtworkService;

// Also make available globally for HTML pages
if (typeof window !== 'undefined') {
    window.ArtworkService = ArtworkService;
}
