(function(global) {
    'use strict';

    const SIGNAL_TYPES = new Set(['like', 'would_buy', 'watching']);
    const HOMEPAGE_SLOT_LABELS = [
        'Featured Auction',
        'Trending Artwork',
        'Featured Collection',
        'Marketplace Highlight'
    ];
    const PUBLIC_TESTNET_CHAIN_IDS = new Set([84532, 11155111]);
    const LEGACY_DEMO_TITLES = new Set(['music', 'test', 'my avatar']);
    const LEGACY_DEMO_TERMS = ['rialo', 'maysonkiller'];

    function normalize(value) {
        return (value || '').toString().trim().toLowerCase();
    }

    function toNumber(value, fallback = 0) {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function toTimestamp(value) {
        if (!value) return 0;
        if (typeof value === 'number') {
            return value > 9999999999 ? value : value * 1000;
        }

        const timestamp = new Date(value).getTime();
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function firstNumber(artwork, keys) {
        for (const key of keys) {
            if (artwork?.[key] !== undefined && artwork?.[key] !== null) {
                return toNumber(artwork[key]);
            }
        }
        return 0;
    }

    function getVoteCount(artwork) {
        if (Array.isArray(artwork?.votes) && artwork.votes[0]?.count !== undefined) {
            return toNumber(artwork.votes[0].count);
        }

        return firstNumber(artwork, ['vote_count', 'votes_count', 'like_count', 'likes_count']);
    }

    function getSocialSignals(artwork = {}) {
        return {
            likes: getVoteCount(artwork),
            wouldBuy: firstNumber(artwork, ['would_buy_count', 'would_buy_signals', 'wouldBuyCount']),
            watching: firstNumber(artwork, ['watch_count', 'watching_count', 'watcher_count', 'watchers_count']),
            bids: firstNumber(artwork, ['bid_count', 'bids_count', 'auction_bid_count']),
            successfulSettlements: firstNumber(artwork, ['successful_settlement_count', 'settlement_count']),
            floorGrowth: firstNumber(artwork, ['floor_growth', 'floor_growth_percent'])
        };
    }

    function getAuctionEndTimestamp(artwork = {}) {
        return toTimestamp(
            artwork.auction_end_time ||
            artwork.end_time ||
            artwork.endTime ||
            artwork.auction?.end_time ||
            artwork.auction?.endTime
        );
    }

    function isEndingSoon(artwork) {
        const endTime = getAuctionEndTimestamp(artwork);
        if (!endTime) return false;

        const remaining = endTime - Date.now();
        return remaining > 0 && remaining <= 24 * 60 * 60 * 1000;
    }

    function classifyLifecycle(artwork = {}) {
        const status = normalize(artwork.status || artwork.nft_status || artwork.auction_state);
        const hasToken = Boolean(artwork.token_id || artwork.tokenId);
        const hasSalePrice = toNumber(artwork.sale_price || artwork.resale_price) > 0;
        const hasCollection = Boolean(
            artwork.collection_id ||
            artwork.collection_name ||
            artwork.drop_id ||
            artwork.drop_name ||
            artwork.is_collection ||
            artwork.is_drop
        );

        if (hasCollection) {
            return {
                key: 'collection',
                label: 'Collection/Drop',
                isCollection: true,
                isMarketplace: hasToken || hasSalePrice,
                isLiveAuction: status.includes('auction') || status === 'active'
            };
        }

        if (
            status === 'auction' ||
            status === 'active' ||
            status === 'live_auction' ||
            status === 'primary_active' ||
            status === 'auction_active'
        ) {
            return {
                key: 'live_auction',
                label: 'Live Auction',
                isLiveAuction: true,
                isMarketplace: false,
                isCollection: false
            };
        }

        if (
            status === 'settlement_pending' ||
            status === 'waiting_payment' ||
            status === 'auction_ended'
        ) {
            return {
                key: 'settlement_pending',
                label: 'Awaiting settlement',
                isLiveAuction: false,
                isMarketplace: false,
                isCollection: false
            };
        }

        if (
            hasToken ||
            hasSalePrice ||
            status === 'for_sale' ||
            status === 'listed' ||
            status === 'resale_listed' ||
            status === 'minted' ||
            status === 'sold'
        ) {
            return {
                key: hasSalePrice ? 'marketplace' : 'minted',
                label: hasSalePrice ? 'Listed for sale' : 'Sold',
                isLiveAuction: false,
                isMarketplace: true,
                isCollection: false
            };
        }

        return {
            key: 'unminted',
            label: 'Not yet minted',
            isLiveAuction: false,
            isMarketplace: false,
            isCollection: false
        };
    }

    function computeTrustProfile(profile = {}, artworks = [], extra = {}) {
        const artworkCount = Array.isArray(artworks) ? artworks.length : 0;
        const successfulSettlements = toNumber(extra.successfulSettlements ?? profile.successful_settlements);
        const failedSettlements = toNumber(extra.failedSettlements ?? profile.failed_settlements);
        const auctionParticipations = toNumber(extra.auctionParticipations ?? profile.auction_participations);
        const interactionCount = toNumber(extra.interactionCount ?? profile.artwork_interactions);
        const genesisOwned = Boolean(extra.genesisOwned || profile.genesis_holder || profile.has_genesis);
        const suspiciousFlags = toNumber(extra.suspiciousFlags ?? profile.suspicious_flags);
        const profileCreated = Boolean(profile.wallet_address || profile.username || profile.created_at);

        let ageBonus = 0;
        if (profile.created_at) {
            const ageDays = Math.max(0, (Date.now() - toTimestamp(profile.created_at)) / 86400000);
            ageBonus = clamp(ageDays / 30, 0, 10);
        }

        let score = 45;
        score += profileCreated ? 5 : 0;
        score += Math.min(artworkCount, 6) * 2;
        score += Math.min(auctionParticipations, 10) * 1.5;
        score += Math.min(successfulSettlements, 5) * 8;
        score += Math.min(interactionCount, 20) * 0.5;
        score += genesisOwned ? 10 : 0;
        score += ageBonus;
        score -= Math.min(failedSettlements, 5) * 6;
        score -= Math.min(suspiciousFlags, 4) * 8;

        score = Math.round(clamp(score, 5, 100));

        let tier = 'Building';
        if (score >= 80) tier = 'High trust';
        else if (score >= 60) tier = 'Established';
        else if (score < 30) tier = 'Low signal';

        return {
            score,
            tier,
            influenceWeight: Number((0.25 + (score / 100)).toFixed(2)),
            signals: {
                profileCreated,
                artworkCount,
                auctionParticipations,
                successfulSettlements,
                failedSettlements,
                interactionCount,
                genesisOwned,
                suspiciousFlags
            }
        };
    }

    function computeArtworkTrust(artwork = {}) {
        const directScore = firstNumber(artwork, [
            'trust_score',
            'creator_trust_score',
            'discovery_trust_score'
        ]);

        if (directScore > 0) {
            return clamp(directScore, 5, 100);
        }

        const signals = getSocialSignals(artwork);
        const lifecycle = classifyLifecycle(artwork);
        let score = 45;

        score += Math.min(signals.successfulSettlements, 5) * 8;
        score += Math.min(signals.bids, 10) * 2;
        score += lifecycle.isMarketplace ? 8 : 0;
        score += lifecycle.isLiveAuction ? 5 : 0;
        score -= artwork.is_flagged || artwork.suspicious ? 15 : 0;

        return clamp(score, 5, 100);
    }

    function computeDiscoveryScore(artwork = {}) {
        const signals = getSocialSignals(artwork);
        const lifecycle = classifyLifecycle(artwork);
        const trustScore = computeArtworkTrust(artwork);
        const aiScore = firstNumber(artwork, ['ai_discovery_score', 'ai_score', 'system_value', 'ai_value']);
        const createdAt = toTimestamp(artwork.created_at);
        const ageDays = createdAt ? Math.max(0, (Date.now() - createdAt) / 86400000) : 365;
        const freshness = clamp(20 - ageDays, 0, 20);

        let score = 0;
        score += signals.likes * 2;
        score += signals.wouldBuy * 5;
        score += signals.watching * 3;
        score += signals.bids * 4;
        score += signals.successfulSettlements * 8;
        score += signals.floorGrowth * 0.5;
        score += aiScore * 0.25;
        score += lifecycle.isLiveAuction ? 12 : 0;
        score += lifecycle.isMarketplace ? 8 : 0;
        score += lifecycle.isCollection ? 6 : 0;
        score += isEndingSoon(artwork) ? 10 : 0;
        score += freshness;

        return Math.round(score * (0.35 + trustScore / 100));
    }

    function isPublicArtwork(artwork = {}) {
        return artwork.moderation_hidden !== true &&
            artwork.is_hidden !== true &&
            artwork.is_blocked !== true &&
            artwork.is_deleted !== true;
    }

    function isLegacyDisplayEnabled() {
        try {
            const params = new URLSearchParams(global.location?.search || '');
            return params.get('showLegacy') === '1' ||
                params.get('legacy') === '1' ||
                global.localStorage?.getItem('artsoul_show_legacy_artworks') === 'true';
        } catch {
            return false;
        }
    }

    function areProtocolPlaceholdersEnabled() {
        try {
            const params = new URLSearchParams(global.location?.search || '');
            return params.get('showPlaceholders') === '1' ||
                params.get('debugProtocol') === '1' ||
                global.localStorage?.getItem('artsoul_show_protocol_placeholders') === 'true';
        } catch {
            return false;
        }
    }

    function parseChainId(value) {
        if (value === undefined || value === null || value === '') return 0;
        if (typeof value === 'string' && value.startsWith('0x')) {
            const parsed = parseInt(value, 16);
            return Number.isFinite(parsed) ? parsed : 0;
        }

        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function getArtworkChainId(artwork = {}) {
        return parseChainId(
            artwork.chain_id ||
            artwork.chainId ||
            artwork.network_chain_id ||
            artwork.networkChainId ||
            artwork.chain?.id
        );
    }

    function hasPositiveProtocolId(value) {
        if (value === undefined || value === null) return false;
        const normalized = normalize(value);
        return Boolean(normalized) &&
            normalized !== '0' &&
            normalized !== '0n' &&
            normalized !== 'none' &&
            normalized !== 'null' &&
            normalized !== 'undefined';
    }

    function hasPositiveNumericProtocolId(value) {
        if (!hasPositiveProtocolId(value)) return false;
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0;
    }

    function hasProtocolAnchor(artwork = {}) {
        const chainId = getArtworkChainId(artwork);
        return hasPositiveNumericProtocolId(artwork.blockchain_id) ||
            (chainId > 0 && (
                hasPositiveNumericProtocolId(artwork.artwork_id) ||
                hasPositiveNumericProtocolId(artwork.auction_id) ||
                hasPositiveNumericProtocolId(artwork.active_auction_id) ||
                hasPositiveNumericProtocolId(artwork.activeAuctionId) ||
                hasPositiveNumericProtocolId(artwork.token_id) ||
                hasPositiveNumericProtocolId(artwork.tokenId)
            ));
    }

    function hasSupportedTestnetHint(artwork = {}) {
        const chainId = getArtworkChainId(artwork);
        if (chainId > 0) {
            return PUBLIC_TESTNET_CHAIN_IDS.has(chainId);
        }

        const network = normalize(
            artwork.network ||
            artwork.chain ||
            artwork.chain_name ||
            artwork.network_name
        ).replace(/[_\s]+/g, '-');

        if (network) {
            return network.includes('sepolia');
        }

        return hasPositiveNumericProtocolId(artwork.blockchain_id);
    }

    function hasPublicDisplayMedia(artwork = {}) {
        const mediaUrl = artwork.file_url || artwork.media_url || artwork.image_url || artwork.image;

        if (artwork.source === 'v41_projection') {
            if (areProtocolPlaceholdersEnabled()) {
                return !mediaUrl ||
                    typeof global.ArtSoulSecurity?.isValidStorageUrl !== 'function' ||
                    global.ArtSoulSecurity.isValidStorageUrl(mediaUrl);
            }
            return Boolean(mediaUrl) &&
                typeof global.ArtSoulSecurity?.isValidStorageUrl === 'function' &&
                global.ArtSoulSecurity.isValidStorageUrl(mediaUrl);
        }

        if (!mediaUrl) return false;

        if (typeof global.ArtSoulSecurity?.isValidStorageUrl === 'function') {
            return global.ArtSoulSecurity.isValidStorageUrl(mediaUrl);
        }

        return typeof mediaUrl === 'string' && mediaUrl.length > 0;
    }

    function hasCanonicalV41Provenance(artwork = {}) {
        const id = normalize(artwork.id);
        const canonicalId = normalize(artwork.canonical_v41_id);

        return artwork.source === 'v41_projection' ||
            id.startsWith('v41:') ||
            canonicalId.startsWith('v41:') ||
            (
                artwork.source === 'pending_indexer' &&
                Boolean(normalize(artwork.register_tx_hash)) &&
                hasProtocolAnchor(artwork)
            );
    }

    function isLegacyDemoArtwork(artwork = {}) {
        // Canonical V4.1 projections and confirmed pending submissions are
        // identified by provenance, never by title or creator text.
        if (hasCanonicalV41Provenance(artwork)) {
            return false;
        }

        const title = normalize(artwork.title || artwork.name);
        if (LEGACY_DEMO_TITLES.has(title)) {
            return true;
        }

        const haystack = [
            artwork.title,
            artwork.name,
            artwork.description,
            artwork.creator?.username,
            artwork.creator?.display_name,
            artwork.artist_name,
            artwork.slug
        ].map(normalize).join(' ');

        return LEGACY_DEMO_TERMS.some(term => haystack.includes(term));
    }

    function isPublicTestnetArtwork(artwork = {}) {
        if (!isPublicArtwork(artwork)) return false;
        if (isLegacyDisplayEnabled()) return true;
        if (isLegacyDemoArtwork(artwork)) return false;

        return hasProtocolAnchor(artwork) &&
            hasSupportedTestnetHint(artwork) &&
            hasPublicDisplayMedia(artwork) &&
            Boolean(normalize(artwork.title || artwork.name));
    }

    function filterPublicTestnetArtworks(artworks = []) {
        return (Array.isArray(artworks) ? artworks : []).filter(isPublicTestnetArtwork);
    }

    function normalizeArtwork(artwork = {}) {
        const lifecycle = classifyLifecycle(artwork);
        const social = getSocialSignals(artwork);
        return {
            ...artwork,
            discovery_lifecycle: lifecycle,
            discovery_signals: social,
            discovery_score: computeDiscoveryScore(artwork),
            trust_score: computeArtworkTrust(artwork)
        };
    }

    function sortByDiscovery(a, b) {
        const scoreDiff = (b.discovery_score ?? computeDiscoveryScore(b)) - (a.discovery_score ?? computeDiscoveryScore(a));
        if (scoreDiff !== 0) return scoreDiff;
        return toTimestamp(b.created_at) - toTimestamp(a.created_at);
    }

    function pickSlot(label, artworks, predicate, usedIds) {
        const candidate = artworks
            .filter(artwork => !usedIds.has(String(artwork.id)))
            .filter(predicate)
            .sort(sortByDiscovery)[0];

        if (!candidate) {
            return { label, artwork: null, reason: 'Awaiting live data' };
        }

        usedIds.add(String(candidate.id));
        return {
            label,
            artwork: candidate,
            reason: candidate.discovery_lifecycle?.label || classifyLifecycle(candidate).label
        };
    }

    function buildHomepageSpotlights(artworks = [], limit = 12) {
        const normalized = (Array.isArray(artworks) ? artworks : [])
            .filter(isPublicTestnetArtwork)
            .map(normalizeArtwork);
        const ranked = [...normalized].sort(sortByDiscovery);
        const usedIds = new Set();

        const slots = [
            pickSlot(HOMEPAGE_SLOT_LABELS[0], normalized, artwork => artwork.discovery_lifecycle.isLiveAuction, usedIds),
            pickSlot(HOMEPAGE_SLOT_LABELS[1], normalized, () => true, usedIds),
            pickSlot(HOMEPAGE_SLOT_LABELS[2], normalized, artwork => artwork.discovery_lifecycle.isCollection, usedIds),
            pickSlot(HOMEPAGE_SLOT_LABELS[3], normalized, artwork => artwork.discovery_lifecycle.isMarketplace, usedIds)
        ];

        for (const artwork of ranked) {
            if (slots.length >= limit) break;
            if (usedIds.has(String(artwork.id))) continue;

            usedIds.add(String(artwork.id));
            slots.push({
                label: 'Discovery Spotlight',
                artwork,
                reason: getSpotlightReason(artwork)
            });
        }

        while (slots.length < limit) {
            slots.push({
                label: 'Discovery Spotlight',
                artwork: null,
                reason: 'Awaiting live data'
            });
        }

        return {
            slots,
            ranked,
            availableCount: normalized.length
        };
    }

    function getSpotlightReason(artwork = {}) {
        if (isEndingSoon(artwork)) return 'Ending soon';
        const signals = getSocialSignals(artwork);
        if (signals.wouldBuy > 0) return 'Collector intent';
        if (signals.watching > 0) return 'Watched artwork';
        if (signals.bids > 0) return 'Bid activity';
        if (signals.likes > 0) return 'Community signal';
        return classifyLifecycle(artwork).label;
    }

    function isGalleryCollection(artwork = {}) {
        return artwork.is_collection === true ||
            hasPositiveProtocolId(artwork.collection_id || artwork.collectionId) ||
            hasPositiveProtocolId(artwork.collection_address || artwork.collectionAddress) ||
            hasPositiveProtocolId(artwork.project_id || artwork.projectId) ||
            ['collection', 'partner_collection', 'project_collection'].includes(normalize(
                artwork.content_type || artwork.artwork_type || artwork.source_type
            ));
    }

    function isGalleryMinted(artwork = {}) {
        return artwork.minted === true ||
            hasPositiveNumericProtocolId(artwork.token_id || artwork.tokenId);
    }

    function isGalleryLiveAuction(artwork = {}) {
        const status = normalize(artwork.status || artwork.auction_state || artwork.lifecycle_state);
        const endTime = getAuctionEndTimestamp(artwork);
        const auctionId = artwork.active_auction_id || artwork.activeAuctionId || artwork.auction_id;

        return !isGalleryMinted(artwork) &&
            status === 'auction' &&
            hasPositiveNumericProtocolId(auctionId) &&
            endTime > Date.now();
    }

    function isGalleryResale(artwork = {}) {
        const status = normalize(artwork.status || artwork.listing_status || artwork.resale_status);
        const price = firstNumber(artwork, [
            'sale_price',
            'resale_price',
            'listing_price'
        ]);

        return isGalleryMinted(artwork) &&
            ['for_sale', 'listed', 'resale_listed', 'active'].includes(status) &&
            price > 0;
    }

    function galleryTabForArtwork(artwork = {}) {
        if (isGalleryCollection(artwork)) return 'collections';
        if (isGalleryLiveAuction(artwork)) return 'live_auctions';
        if (isGalleryResale(artwork)) return 'marketplace';
        if (isGalleryMinted(artwork)) return 'nft';

        // TODO: Once the canonical project wallet is configured, route its works only
        // through Collections instead of guessing an address here.
        return 'discover';
    }

    function filterForGalleryTab(artworks = [], tab = 'discover') {
        const normalizedTab = normalize(tab);
        const list = (Array.isArray(artworks) ? artworks : [])
            .filter(isPublicArtwork)
            .map(normalizeArtwork);
        return list.filter(artwork => galleryTabForArtwork(artwork) === normalizedTab);
    }

    function searchArtworks(artworks = [], query = '') {
        const needle = normalize(query);
        if (!needle) return artworks;

        return artworks.filter(artwork => {
            const haystack = [
                artwork.title,
                artwork.description,
                artwork.creator_id,
                artwork.creator?.username,
                artwork.creator?.wallet_address,
                artwork.category,
                artwork.file_type,
                artwork.status,
                artwork.network,
                artwork.chain,
                artwork.collection_name,
                artwork.drop_name,
                ...(Array.isArray(artwork.tags) ? artwork.tags : [])
            ].map(normalize).join(' ');

            return haystack.includes(needle);
        });
    }

    function sortArtworks(artworks = [], sort = 'discovery') {
        const list = (Array.isArray(artworks) ? artworks : []).map(normalizeArtwork);
        const mode = normalize(sort);
        const byNumber = (getter) => list.sort((a, b) => getter(b) - getter(a));

        if (mode === 'newest') {
            list.sort((a, b) => toTimestamp(b.created_at) - toTimestamp(a.created_at));
        } else if (mode === 'oldest') {
            list.sort((a, b) => toTimestamp(a.created_at) - toTimestamp(b.created_at));
        } else if (mode === 'price_high') {
            byNumber(artwork => toNumber(artwork.creator_value || artwork.sale_price || artwork.floor_price));
        } else if (mode === 'price_low') {
            list.sort((a, b) =>
                toNumber(a.creator_value || a.sale_price || a.floor_price) -
                toNumber(b.creator_value || b.sale_price || b.floor_price)
            );
        } else if (mode === 'most_voted' || mode === 'popular') {
            byNumber(artwork => getSocialSignals(artwork).likes);
        } else if (mode === 'would_buy') {
            byNumber(artwork => getSocialSignals(artwork).wouldBuy);
        } else if (mode === 'watching') {
            byNumber(artwork => getSocialSignals(artwork).watching);
        } else if (mode === 'ending_soon') {
            list.sort((a, b) => {
                const aTime = getAuctionEndTimestamp(a);
                const bTime = getAuctionEndTimestamp(b);
                const aRemaining = aTime && aTime > Date.now() ? aTime - Date.now() : Number.MAX_SAFE_INTEGER;
                const bRemaining = bTime && bTime > Date.now() ? bTime - Date.now() : Number.MAX_SAFE_INTEGER;
                return aRemaining - bRemaining;
            });
        } else if (mode === 'highest_bid') {
            byNumber(artwork => firstNumber(artwork, ['highest_bid', 'highestBid', 'current_bid']));
        } else if (mode === 'ai_value') {
            byNumber(artwork => firstNumber(artwork, ['system_value', 'ai_value', 'ai_score']));
        } else if (mode === 'trust') {
            byNumber(artwork => computeArtworkTrust(artwork));
        } else {
            list.sort(sortByDiscovery);
        }

        return list;
    }

    function getAIGuidance(artwork = {}) {
        const referenceValue = firstNumber(artwork, ['system_value', 'ai_value', 'creator_value', 'floor_price', 'sale_price']);
        const confidence = clamp(firstNumber(artwork, ['ai_confidence', 'confidence_score', 'ai_score'], 35), 0, 100);
        const category = artwork.category || artwork.file_type || 'mixed media';
        const signals = getSocialSignals(artwork);

        if (!referenceValue) {
            return {
                range: null,
                confidence,
                reason: `More settlement and collector signals are needed for ${category} guidance.`
            };
        }

        return {
            range: {
                low: Number((referenceValue * 0.8).toFixed(4)),
                high: Number((referenceValue * 1.2).toFixed(4))
            },
            confidence,
            reason: `Guidance blends ${category} metadata with ${signals.likes} likes, ${signals.wouldBuy} would-buy signals, and settlement/floor history when available.`
        };
    }

    function normalizeSignalType(type) {
        const normalized = normalize(type).replace('-', '_');
        if (normalized === 'wouldbuy' || normalized === 'would_buy') return 'would_buy';
        if (normalized === 'watch' || normalized === 'watching') return 'watching';
        return normalized === 'like' ? 'like' : '';
    }

    function getActiveChainId() {
        const contracts = global.ARTSOUL_CONTRACTS || {};
        const currentNetwork = global.ArtSoulContracts?.currentNetwork;
        if (currentNetwork && contracts[currentNetwork]?.chainId) {
            return Number(contracts[currentNetwork].chainId);
        }

        const raw = global.currentChainId ||
            global.selectedNetworkId ||
            global.ethereum?.chainId ||
            contracts.baseSepolia?.chainId ||
            84532;

        if (typeof raw === 'string' && raw.startsWith('0x')) {
            return parseInt(raw, 16);
        }

        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
    }

    function localInteractionKey(artworkId, walletAddress) {
        return `artsoul_interactions:${getActiveChainId()}:${normalize(walletAddress)}:${artworkId}`;
    }

    function readLocalInteractions(artworkId, walletAddress) {
        try {
            const raw = global.localStorage?.getItem(localInteractionKey(artworkId, walletAddress));
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    }

    function writeLocalInteraction(artworkId, walletAddress, type) {
        try {
            const current = readLocalInteractions(artworkId, walletAddress);
            current[type] = true;
            global.localStorage?.setItem(
                localInteractionKey(artworkId, walletAddress),
                JSON.stringify(current)
            );
            return current;
        } catch {
            return {};
        }
    }

    async function getInteractionState(artworkId, walletAddress) {
        if (!artworkId || !walletAddress) {
            return { like: false, would_buy: false, watching: false };
        }

        const localState = readLocalInteractions(artworkId, walletAddress);
        let like = Boolean(localState.like);

        try {
            if (typeof global.ArtSoulDB?.getUserVote === 'function') {
                like = Boolean(await global.ArtSoulDB.getUserVote(artworkId, walletAddress));
            }
        } catch {
            like = Boolean(localState.like);
        }

        return {
            like,
            would_buy: Boolean(localState.would_buy),
            watching: Boolean(localState.watching)
        };
    }

    async function persistSocialSignal(type, artworkId, walletAddress) {
        if (type === 'like' && typeof global.ArtSoulDB?.saveVote === 'function') {
            await global.ArtSoulDB.saveVote({
                artwork_id: artworkId,
                voter_address: walletAddress
            });
            return true;
        }

        if (typeof global.ArtSoulDB?.saveDiscoverySignal !== 'function') {
            return false;
        }

        try {
            const chainId = getActiveChainId();
            await global.ArtSoulDB.saveDiscoverySignal({
                chain_id: chainId,
                artwork_id: artworkId,
                signal_type: type
            });
            return true;
        } catch (error) {
            console.warn('[ArtSoulDiscovery] Persistent social signal unavailable; using local state only.', error.message);
            return false;
        }
    }

    async function recordSignal(type, artworkId, walletAddress) {
        const signalType = normalizeSignalType(type);
        if (!SIGNAL_TYPES.has(signalType)) {
            throw new Error('Unsupported discovery signal');
        }

        if (!artworkId) {
            throw new Error('Artwork is required');
        }

        if (!walletAddress) {
            throw new Error('Connect wallet to save discovery signals');
        }

        const existing = await getInteractionState(artworkId, walletAddress);
        if (existing[signalType]) {
            return {
                alreadyRecorded: true,
                state: existing,
                persisted: false
            };
        }

        let persisted = false;
        try {
            persisted = await persistSocialSignal(signalType, artworkId, walletAddress);
        } catch (error) {
            if (signalType === 'like') throw error;
        }

        const nextState = writeLocalInteraction(artworkId, walletAddress, signalType);
        return {
            alreadyRecorded: false,
            state: {
                like: Boolean(nextState.like || existing.like),
                would_buy: Boolean(nextState.would_buy || existing.would_buy),
                watching: Boolean(nextState.watching || existing.watching)
            },
            persisted
        };
    }

    function getGenesisProgress(profile = {}, artworks = [], extra = {}) {
        const signals = computeTrustProfile(profile, artworks, extra).signals;
        const requirements = [
            { key: 'profile', label: 'Profile created', current: signals.profileCreated ? 1 : 0, target: 1 },
            { key: 'artworks', label: 'Artworks uploaded', current: signals.artworkCount, target: 3 },
            { key: 'participation', label: 'Auction participations', current: signals.auctionParticipations, target: 5 },
            { key: 'settlement', label: 'Successful settlement', current: signals.successfulSettlements, target: 1 },
            { key: 'interactions', label: 'Artwork interactions', current: signals.interactionCount, target: 10 }
        ];

        const completed = requirements.filter(item => item.current >= item.target).length;
        return {
            completed,
            total: requirements.length,
            eligible: completed === requirements.length,
            requirements
        };
    }

    global.ArtSoulDiscovery = {
        buildHomepageSpotlights,
        classifyLifecycle,
        computeDiscoveryScore,
        computeTrustProfile,
        filterPublicTestnetArtworks,
        filterForGalleryTab,
        galleryTabForArtwork,
        getAIGuidance,
        getGenesisProgress,
        getInteractionState,
        getSocialSignals,
        isEndingSoon,
        isPublicTestnetArtwork,
        normalizeArtwork,
        recordSignal,
        searchArtworks,
        sortArtworks
    };
})(window);
