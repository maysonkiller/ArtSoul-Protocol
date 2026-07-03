// Supabase Client Configuration for ArtSoul Marketplace
// Created: 2026-04-26
// Updated: 2026-04-28 - Added authentication support

const supabaseSingleton = window.ArtSoulSupabaseSingleton = window.ArtSoulSupabaseSingleton || {
    client: null,
    initPromise: null,
    configPromise: null,
    initLogged: false
};

async function loadSupabasePublicConfig() {
    if (window.ArtSoulPublicConfigData) {
        return window.ArtSoulPublicConfigData;
    }

    if (!supabaseSingleton.configPromise) {
        supabaseSingleton.configPromise = fetch('/api/public/config', {
            method: 'GET',
            credentials: 'omit'
        }).then(async response => {
            const text = await response.text();
            const data = text ? JSON.parse(text) : {};
            if (!response.ok) {
                throw new Error(data.message || data.error || 'Public Supabase configuration unavailable');
            }
            if (!data.supabaseUrl || !data.supabaseAnonKey) {
                throw new Error('Public Supabase configuration is incomplete');
            }
            window.ArtSoulPublicConfigData = data;
            window.SUPABASE_ANON_KEY = data.supabaseAnonKey;
            return data;
        });
    }

    return supabaseSingleton.configPromise;
}

// Export for OAuth integration and direct Supabase clients.
window.ArtSoulPublicConfig = window.ArtSoulPublicConfig || {};
window.ArtSoulPublicConfig.load = loadSupabasePublicConfig;

// Security: URL validation
const ALLOWED_STORAGE_DOMAIN = 'bexigvqrunomwtjsxlej.supabase.co';

function isValidStorageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
        const urlObj = new URL(url);
        return urlObj.hostname === ALLOWED_STORAGE_DOMAIN;
    } catch {
        return false;
    }
}

function sanitizeText(text) {
    if (!text || typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

const GENERATED_PROFILE_USERNAME = /^User[0-9a-fA-F]{4,6}$/;

function shortWalletAddress(address) {
    const walletAddress = (address || '').toString().trim();
    if (!walletAddress) return '';
    if (walletAddress.length <= 12) return walletAddress;
    return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
}

function isGeneratedProfileUsername(username) {
    const value = (username || '').toString().trim();
    return !value || GENERATED_PROFILE_USERNAME.test(value);
}

function displayName(profile = {}, address = '') {
    const username = (profile?.username || '').toString().trim();
    if (username && !isGeneratedProfileUsername(username)) {
        return username;
    }

    return shortWalletAddress(profile?.wallet_address || address);
}

function avatarUrl(profile = {}, fallbackUrl = '') {
    return profile?.avatar_url || fallbackUrl || '';
}

// Export security functions
window.ArtSoulSecurity = {
    isValidStorageUrl,
    sanitizeText
};

window.ArtSoulProfileDisplay = {
    displayName,
    avatarUrl,
    shortWalletAddress,
    isGeneratedProfileUsername
};

// Initialize Supabase client with auth support
let supabaseClient = supabaseSingleton.client;

async function initSupabase() {
    if (supabaseSingleton.client) {
        supabaseClient = supabaseSingleton.client;
        return supabaseClient;
    }

    if (!supabaseSingleton.initPromise) {
        supabaseSingleton.initPromise = (async () => {
            const config = await loadSupabasePublicConfig();

            // Import Supabase once for the whole page. Auth and data APIs share
            // this exact GoTrueClient instance through ArtSoulSupabaseSingleton.
            const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
            const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
                auth: {
                    autoRefreshToken: true,
                    persistSession: true,
                    detectSessionInUrl: true
                }
            });

            supabaseSingleton.client = client;
            if (!supabaseSingleton.initLogged) {
                supabaseSingleton.initLogged = true;
                console.log(' Supabase initialized with auth support');
            }
            return client;
        })().catch((error) => {
            supabaseSingleton.initPromise = null;
            throw error;
        });
    }

    supabaseClient = await supabaseSingleton.initPromise;
    return supabaseClient;
}

function currentChainId() {
    const chainId =
        window.currentChainId ||
        window.ArtSoulContracts?.chainId ||
        window.ArtSoulContracts?.provider?._network?.chainId ||
        84532;
    return Number(chainId) || 84532;
}

async function backendWrite(path, body, method = 'POST') {
    const response = await fetch(path, {
        method,
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body || {})
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
        const error = new Error(data.message || data.error || 'Backend write failed');
        error.status = response.status;
        error.code = data.error;
        error.reason = data.reason;
        error.stage = data.stage;
        throw error;
    }
    return data;
}

function disabledLegacyWrite(action) {
    throw new Error(`${action} is disabled for public testnet. Contract events and v41 indexer projections are the source of truth.`);
}

function buildQuery(params = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            search.set(key, value);
        }
    });
    const query = search.toString();
    return query ? `?${query}` : '';
}

async function backendRead(path) {
    const response = await fetch(path, {
        method: 'GET',
        credentials: 'include'
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
        const error = new Error(data.message || data.error || 'Backend read failed');
        error.status = response.status;
        throw error;
    }
    return data;
}

async function getPublicProjectionArtworks(options = {}) {
    try {
        const result = await backendRead(`/api/public/artworks${buildQuery(options)}`);
        const rows = Array.isArray(result.data) ? result.data : [];
        rows.suppressed_artwork_ids = Array.isArray(result.suppressed_artwork_ids)
            ? result.suppressed_artwork_ids
            : [];
        return rows;
    } catch (error) {
        console.warn('[ArtSoulDB] V4.1 projection feed unavailable:', error.message);
        return [];
    }
}

async function getPublicProjectionArtwork(idOrOptions) {
    const options = typeof idOrOptions === 'string'
        ? { id: idOrOptions, limit: 1 }
        : { ...(idOrOptions || {}), limit: 1 };
    const rows = await getPublicProjectionArtworks(options);
    return rows[0] || null;
}

// Profile Functions
async function createProfile(walletAddress, profileData) {
    return updateProfile(walletAddress, profileData);
}

async function getProfile(walletAddress) {
    const supabase = await initSupabase();

    // CRITICAL: Normalize wallet address to lowercase for consistent identity
    const normalizedAddress = walletAddress.toLowerCase();

    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('wallet_address', normalizedAddress)
        .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = not found
        console.error('Error fetching profile:', error);
        throw error;
    }

    return data;
}

async function updateProfile(walletAddress, updates) {
    if (!walletAddress) {
        throw new Error('Connect wallet before saving profile');
    }

    const result = await backendWrite('/api/profile', updates, 'PUT');
    return result.profile;
}

// Artwork Functions
async function createArtwork(artworkData) {
    disabledLegacyWrite('Legacy artwork creation');
}

async function getArtworks(filters = {}) {
    if (filters.publicTestnet !== false) {
        const projectionArtworks = await getPublicProjectionArtworks({
            limit: filters.limit || 200,
            chain_id: filters.chain_id,
            view: filters.view,
            creator: filters.creator || filters.creator_id
        });

        if (projectionArtworks.length > 0) {
            return projectionArtworks;
        }
    }

    const supabase = await initSupabase();

    let query = supabase
        .from('artworks')
        .select(`
            *,
            creator:profiles!creator_id(*)
        `)
        .order('created_at', { ascending: false });

    if (filters.creator_id) {
        query = query.eq('creator_id', filters.creator_id);
    }

    if (filters.file_type) {
        query = query.eq('file_type', filters.file_type);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching artworks:', error);
        throw error;
    }

    return data;
}

async function getAllArtworks() {
    const supabase = await initSupabase();

    const { data, error } = await supabase
        .from('artworks')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching all artworks:', error);
        throw error;
    }

    return data;
}

async function getArtwork(artworkId) {
    if (String(artworkId || '').startsWith('v41:')) {
        const projectionArtwork = await getPublicProjectionArtwork(artworkId);
        if (projectionArtwork) {
            return projectionArtwork;
        }

        const error = new Error('V4.1 artwork is waiting for indexer projection');
        error.code = 'V41_ARTWORK_NOT_INDEXED';
        error.artwork_id = artworkId;
        throw error;
    }

    const supabase = await initSupabase();

    // First try with creator join
    let { data, error } = await supabase
        .from('artworks')
        .select(`
            *,
            creator:profiles!artworks_creator_id_fkey(*),
            auctions(*)
        `)
        .eq('id', artworkId)
        .single();

    // If foreign key error, try without creator join
    if (error && (error.code === 'PGRST200' || error.code === '42P01')) {
        console.warn('[getArtwork] Foreign key not found, loading without creator');
        const result = await supabase
            .from('artworks')
            .select('*, auctions(*)')
            .eq('id', artworkId)
            .single();

        data = result.data;
        error = result.error;
    }

    if (error) {
        console.error('Error fetching artwork:', error);
        throw error;
    }

    return data;
}

async function getArtworksByCreator(creatorId) {
    const projectionArtworks = await getPublicProjectionArtworks({
        creator: creatorId,
        limit: 200
    });

    if (projectionArtworks.length > 0) {
        return projectionArtworks;
    }

    const supabase = await initSupabase();

    const { data, error } = await supabase
        .from('artworks')
        .select(`
            *,
            creator:profiles!creator_id(*)
        `)
        .eq('creator_id', creatorId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching creator artworks:', error);
        throw error;
    }

    return data;
}

async function getArtworksByOwner(ownerAddress) {
    const supabase = await initSupabase();

    const { data, error } = await supabase
        .from('artworks')
        .select(`
            *,
            creator:profiles!creator_id(*)
        `)
        .eq('owner_address', ownerAddress)
        .neq('creator_id', ownerAddress)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching owned artworks:', error);
        // Return empty array if owner_address column doesn't exist yet
        if (error.code === '42703') {
            console.warn('owner_address column not found - run supabase-ownership-migration.sql');
            return [];
        }
        throw error;
    }

    return data || [];
}

async function updateArtwork(artworkId, updates) {
    disabledLegacyWrite('Legacy artwork update');
}

async function deleteArtwork(artworkId) {
    disabledLegacyWrite('Legacy artwork deletion');
}

// Storage Functions
async function uploadSignedBlob({ blob, fileName, contentType, size, kind = 'media' }) {
    const signedUpload = await backendWrite('/api/upload/file', {
        kind,
        file_name: fileName || 'upload.bin',
        content_type: contentType,
        size
    });

    if (!signedUpload?.signed_upload_url || !signedUpload?.public_url) {
        throw new Error('Upload authorization failed');
    }

    const formData = new FormData();
    formData.append('cacheControl', '3600');
    formData.append('', blob, fileName || 'upload.bin');

    const response = await fetch(signedUpload.signed_upload_url, {
        method: 'PUT',
        headers: {
            'x-upsert': 'false'
        },
        body: formData
    });

    if (!response.ok) {
        let message = 'Storage upload failed';
        try {
            const data = await response.json();
            message = data.message || data.error || message;
        } catch {
            message = await response.text() || message;
        }
        throw new Error(message);
    }

    return signedUpload;
}

async function uploadFile(file, fileName) {
    if (!file || !(file instanceof File)) {
        throw new Error('A valid file is required');
    }

    const signedUpload = await uploadSignedBlob({
        blob: file,
        fileName: fileName || file.name,
        contentType: file.type,
        size: file.size,
        kind: 'media'
    });

    return signedUpload.public_url;
}

async function uploadMetadata(metadata, fileName = 'metadata.json') {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new Error('A valid metadata object is required');
    }

    const json = JSON.stringify(metadata);
    const blob = new Blob([json], { type: 'application/json' });
    const signedUpload = await uploadSignedBlob({
        blob,
        fileName,
        contentType: 'application/json',
        size: blob.size,
        kind: 'metadata'
    });

    return {
        url: signedUpload.public_url,
        path: signedUpload.path,
        size: blob.size,
        content_type: 'application/json'
    };
}

// Auction Functions
async function createAuction(artworkId) {
    disabledLegacyWrite('Legacy auction creation');
}

async function getActiveAuctions() {
    const supabase = await initSupabase();

    const { data, error } = await supabase
        .from('auctions')
        .select(`
            *,
            artwork:artworks(*,
                creator:profiles!creator_id(*)
            ),
            winner:profiles!winner_id(*),
            bids(count)
        `)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching auctions:', error);
        throw error;
    }

    return data;
}

function projectionAuctionState(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'settlement_pending') return 'WAITING_PAYMENT';
    if (normalized === 'auction') return 'ACTIVE';
    if (normalized === 'awaiting_end') return 'AWAITING_END';
    if (normalized === 'sold') return 'SETTLED';
    if (normalized === 'defaulted') return 'DEFAULTED';
    return normalized ? normalized.toUpperCase() : 'UNKNOWN';
}

async function getAuctions(options = {}) {
    const artworks = await getPublicProjectionArtworks({
        limit: options.limit || 200,
        chain_id: options.chain_id
    });

    return artworks
        .filter(artwork => artwork.auction_id)
        .map(artwork => ({
            id: artwork.auction_id,
            auction_id: artwork.auction_id,
            artwork_id: artwork.id,
            blockchain_artwork_id: artwork.blockchain_id,
            chain_id: artwork.chain_id,
            state: projectionAuctionState(artwork.status),
            status: artwork.status,
            highestBidder: artwork.auction_winner_address || artwork.current_bidder || null,
            highest_bidder: artwork.auction_winner_address || artwork.current_bidder || null,
            current_bid: artwork.current_bid,
            settlement_deadline: artwork.settlement_deadline,
            artwork
        }));
}

async function getAuction(auctionId) {
    const supabase = await initSupabase();

    const { data, error } = await supabase
        .from('auctions')
        .select(`
            *,
            artwork:artworks(*,
                creator:profiles!creator_id(*)
            ),
            winner:profiles!winner_id(*),
            bids(*,
                bidder:profiles!bidder_id(*)
            )
        `)
        .eq('id', auctionId)
        .single();

    if (error) {
        console.error('Error fetching auction:', error);
        throw error;
    }

    return data;
}

async function endAuction(auctionId) {
    disabledLegacyWrite('Legacy auction status update');
}

// Bid Functions
async function placeBid(auctionId, bidderId, amount, maxLimit = null) {
    disabledLegacyWrite('Legacy bid write');
}

async function getAuctionBids(auctionId) {
    const supabase = await initSupabase();

    const { data, error } = await supabase
        .from('bids')
        .select(`
            *,
            bidder:profiles!bidder_id(*)
        `)
        .eq('auction_id', auctionId)
        .order('amount', { ascending: false });

    if (error) {
        console.error('Error fetching bids:', error);
        throw error;
    }

    return data;
}

async function getUserBid(auctionId, bidderId) {
    const supabase = await initSupabase();

    const { data, error } = await supabase
        .from('bids')
        .select('*')
        .eq('auction_id', auctionId)
        .eq('bidder_id', bidderId)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('Error fetching user bid:', error);
        throw error;
    }

    return data;
}

// Real-time subscriptions
function subscribeToAuction(auctionId, callback) {
    initSupabase().then(supabase => {
        const subscription = supabase
            .channel(`auction:${auctionId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'bids',
                filter: `auction_id=eq.${auctionId}`
            }, callback)
            .subscribe();

        return subscription;
    });
}

// Voting Functions
async function saveVote(voteData) {
    // Simple like system - one wallet can vote once per artwork
    // Validate voter_address is Ethereum address
    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!voteData.voter_address || !addressRegex.test(voteData.voter_address)) {
        throw new Error('Invalid voter address format');
    }

    const result = await backendWrite('/api/discovery/like', {
        chain_id: currentChainId(),
        artwork_id: voteData.artwork_id
    });

    if (result.alreadyRecorded) {
        return {
            artwork_id: voteData.artwork_id,
            voter_address: voteData.voter_address,
            vote_type: 'like',
            alreadyRecorded: true
        };
    }

    return result.vote;
}

async function saveDiscoverySignal(signalData) {
    return backendWrite('/api/discovery/signal', {
        chain_id: signalData.chain_id || currentChainId(),
        artwork_id: signalData.artwork_id,
        signal_type: signalData.signal_type
    });
}

async function getVotes(artworkId) {
    const supabase = await initSupabase();

    const { data, error } = await supabase
        .from('votes')
        .select('*')
        .eq('artwork_id', artworkId);

    if (error) {
        console.error('Error getting votes:', error);
        throw error;
    }

    return data;
}

async function getUserVote(artworkId, voterAddress) {
    const supabase = await initSupabase();

    const { data, error } = await supabase
        .from('votes')
        .select('*')
        .eq('artwork_id', artworkId)
        .eq('voter_address', voterAddress)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('Error getting user vote:', error);
        throw error;
    }

    return data;
}

// Get vote count for an artwork
async function getVoteCount(artworkId) {
    const supabase = await initSupabase();

    const { count, error } = await supabase
        .from('votes')
        .select('*', { count: 'exact', head: true })
        .eq('artwork_id', artworkId);

    if (error) {
        console.error('Error getting vote count:', error);
        return 0;
    }

    return count || 0;
}

// Get artworks sorted by vote count
async function getArtworksByVotes(limit = null) {
    const projectionArtworks = await getPublicProjectionArtworks({
        limit: limit || 100
    });

    if (projectionArtworks.length > 0) {
        return projectionArtworks;
    }

    const supabase = await initSupabase();

    // Use LEFT JOIN with COUNT to get vote counts in a single query
    // This is much more efficient than N+1 queries
    const { data: artworks, error } = await supabase
        .from('artworks')
        .select(`
            *,
            votes:votes(count)
        `)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching artworks with votes:', error);
        throw error;
    }

    // Transform the data to include vote_count
    const artworksWithVotes = artworks.map(artwork => ({
        ...artwork,
        vote_count: artwork.votes?.[0]?.count || 0
    }));

    // Sort by vote count (descending), then by created_at (ascending) for ties
    artworksWithVotes.sort((a, b) => {
        if (b.vote_count !== a.vote_count) {
            return b.vote_count - a.vote_count;
        }
        // If votes are equal, earlier created artwork comes first
        return new Date(a.created_at) - new Date(b.created_at);
    });

    // Return limited results if specified
    return limit ? artworksWithVotes.slice(0, limit) : artworksWithVotes;
}

// ============================================
// AUCTION V2 FUNCTIONS
// ============================================

/**
 * Save bid to bids_history table (for V2 deposit system)
 */
async function saveBidHistory(bidData) {
    disabledLegacyWrite('Legacy bid history write');
}

/**
 * Get bid history for an auction
 */
async function getBidHistory(auctionId) {
    const supabase = await initSupabase();

    const { data, error } = await supabase
        .from('bids_history')
        .select('*')
        .eq('auction_id', auctionId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error getting bid history:', error);
        throw error;
    }

    return data;
}

/**
 * Update artwork with auction winner and floor price
 */
async function setAuctionWinner(artworkId, winnerAddress, floorPrice, winnerDeadline) {
    disabledLegacyWrite('Legacy auction winner update');
}

/**
 * Update artwork after winner purchase
 */
async function recordWinnerPurchase(artworkId, winnerAddress, tokenId) {
    disabledLegacyWrite('Legacy settlement projection update');
}

/**
 * Set artwork for direct sale
 */
async function setArtworkForSale(artworkId, salePrice) {
    disabledLegacyWrite('Legacy resale projection update');
}

/**
 * Record direct purchase
 */
async function recordDirectPurchase(artworkId, buyerAddress, tokenId) {
    disabledLegacyWrite('Legacy resale purchase projection update');
}

/**
 * Mark bid as refunded
 */
async function markBidRefunded(bidId) {
    disabledLegacyWrite('Legacy bid refund update');
}

// ============================================
// AI INTEGRATION FUNCTIONS
// ============================================

/**
 * Get recent sales for similar artworks (for AI valuation)
 */
async function getRecentSales({ fileType, days = 7, limit = 20 }) {
    const supabase = await initSupabase();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const { data, error } = await supabase
        .from('artworks')
        .select('id, sale_price, updated_at')
        .eq('file_type', fileType)
        .eq('status', 'sold')
        .not('sale_price', 'is', null)
        .gte('updated_at', cutoffDate.toISOString())
        .order('updated_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('Error getting recent sales:', error);
        return [];
    }

    return data || [];
}

/**
 * Get creator's sales history (for AI valuation)
 */
async function getCreatorSales(creatorAddress) {
    const supabase = await initSupabase();

    const { data, error } = await supabase
        .from('artworks')
        .select('id, sale_price, updated_at')
        .ilike('creator_id', creatorAddress)
        .eq('status', 'sold')
        .not('sale_price', 'is', null)
        .order('updated_at', { ascending: false });

    if (error) {
        console.error('Error getting creator sales:', error);
        return [];
    }

    return data || [];
}

/**
 * Update auction with AI data
 */
async function updateAuction(auctionId, updates) {
    disabledLegacyWrite('Legacy auction update');
}

// Export functions
window.ArtSoulDB = {
    initSupabase,
    displayName,
    avatarUrl,
    shortWalletAddress,
    isGeneratedProfileUsername,
    // Profiles
    createProfile,
    getProfile,
    updateProfile,
    // Artworks
    createArtwork,
    getPublicProjectionArtworks,
    getPublicProjectionArtwork,
    getArtworks,
    getAllArtworks,
    getArtwork,
    getArtworksByCreator,
    getArtworksByOwner,
    updateArtwork,
    deleteArtwork,
    // Storage
    uploadFile,
    uploadMetadata,
    // Auctions
    createAuction,
    getAuctions,
    getActiveAuctions,
    getAuction,
    updateAuction,
    endAuction,
    // Bids
    placeBid,
    getAuctionBids,
    getUserBid,
    // Voting
    saveVote,
    saveDiscoverySignal,
    getVotes,
    getUserVote,
    getVoteCount,
    getArtworksByVotes,
    // Real-time
    subscribeToAuction,
    // Auction V2
    saveBidHistory,
    getBidHistory,
    setAuctionWinner,
    recordWinnerPurchase,
    setArtworkForSale,
    recordDirectPurchase,
    markBidRefunded,
    // AI Integration
    getRecentSales,
    getCreatorSales
};

console.log('📦 ArtSoul Database Client loaded');
