import { React, createRoot } from './react-runtime.js';
import { CardGridSkeleton } from './loading-skeletons.jsx';
import '../../supabase-client.js';
import '../../supabase-auth.js';

const { useState, useEffect, useMemo, useRef } = React;

        const GALLERY_TABS = [
            { id: 'live_auctions', label: 'Auctions' },
            { id: 'nft', label: 'NFT' },
            { id: 'discover', label: 'Discovery' },
            { id: 'marketplace', label: 'Marketplace' },
            { id: 'collections', label: 'Collections' }
        ];
        const GALLERY_TAB_ALIASES = {
            auctions: 'live_auctions'
        };

        function getInitialGalleryTab() {
            const hash = (window.location.hash || '').replace('#', '');
            const tabId = GALLERY_TAB_ALIASES[hash] || hash;
            return GALLERY_TABS.some(tab => tab.id === tabId) ? tabId : 'live_auctions';
        }

        function GalleryPage() {
            const [theme, setTheme] = useState('classic');
            const [artworkCorpus, setArtworkCorpus] = useState([]);
            const [loading, setLoading] = useState(true);
            const loadSequenceRef = useRef(0);

            // Filters
            const [activeTab, setActiveTab] = useState(getInitialGalleryTab);
            const [statusFilter, setStatusFilter] = useState('all');
            const [sortBy, setSortBy] = useState('discovery');
            const [minPrice, setMinPrice] = useState('');
            const [maxPrice, setMaxPrice] = useState('');
            const [searchQuery, setSearchQuery] = useState('');
            const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
            const [filtersOpen, setFiltersOpen] = useState(false);

            const isClassic = theme === 'classic';
            const isGlobalSearch = debouncedSearchQuery.trim() !== '';
            const isSearchPending = searchQuery.trim() !== debouncedSearchQuery.trim();
            const activeFilters = useMemo(() => ({
                activeTab,
                statusFilter,
                sortBy,
                minPrice,
                maxPrice,
                searchQuery: debouncedSearchQuery
            }), [activeTab, statusFilter, sortBy, minPrice, maxPrice, debouncedSearchQuery]);
            const filteredArtworks = useMemo(
                () => applyPublicGalleryFilters(artworkCorpus, activeFilters),
                [artworkCorpus, activeFilters]
            );

            function selectGalleryTab(tabId) {
                setActiveTab(tabId);
                setStatusFilter('all');
                setSortBy('discovery');
                if (window.history?.replaceState) {
                    window.history.replaceState(null, '', `#${tabId}`);
                }
            }

            useEffect(() => {
                const syncTheme = (newTheme) => setTheme(newTheme);
                syncTheme(window.ThemeManager?.getTheme?.() || window.ThemeSync?.getTheme?.() || 'classic');
                const unsubscribe = window.ThemeManager?.addListener?.(syncTheme);
                window.setThemeReact = syncTheme;

                return () => {
                    unsubscribe?.();
                    if (window.setThemeReact === syncTheme) {
                        delete window.setThemeReact;
                    }
                };
            }, []);

            useEffect(() => {
                const handleHashChange = () => setActiveTab(getInitialGalleryTab());
                window.addEventListener('hashchange', handleHashChange);
                return () => window.removeEventListener('hashchange', handleHashChange);
            }, []);

            useEffect(() => {
                const debounceTimer = setTimeout(() => {
                    setDebouncedSearchQuery(searchQuery);
                }, 300);

                return () => clearTimeout(debounceTimer);
            }, [searchQuery]);

            useEffect(() => {
                loadArtworks();
            }, []);

            function sleep(ms) {
                return new Promise(resolve => setTimeout(resolve, ms));
            }

            async function waitForArtworkService(maxAttempts = 40, delay = 150) {
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    if (typeof window.ArtworkService?.filterArtworks === 'function') {
                        return window.ArtworkService;
                    }
                    await sleep(delay);
                }
                return null;
            }

            async function waitForArtSoulDB(maxAttempts = 20, delay = 150) {
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    if (typeof window.ArtSoulDB?.getPublicProjectionArtworks === 'function') {
                        return window.ArtSoulDB;
                    }
                    await sleep(delay);
                }
                return null;
            }

            function hasSafeMedia(artwork = {}) {
                const url = artwork.file_url || artwork.media_url || '';
                return Boolean(url) && (
                    typeof window.ArtSoulSecurity?.isValidStorageUrl !== 'function' ||
                    window.ArtSoulSecurity.isValidStorageUrl(url)
                );
            }

            // Plain-English labels for the contract-y projection statuses.
            // Display only — does NOT change the underlying status logic.
            const GALLERY_STATUS_LABELS = {
                auction: 'Live',
                awaiting_end: 'Awaiting payment',
                settlement_pending: 'Awaiting payment',
                defaulted: 'Unsettled',
                defaulted_no_bids: 'No bids',
                ended_no_bids: 'No bids',
                for_sale: 'For sale',
                sold: 'Sold'
            };

            function friendlyStatusLabel(status) {
                return GALLERY_STATUS_LABELS[status] || 'Not yet minted';
            }

            function categoryLabelForArtwork(artwork) {
                const categoryId = window.ArtSoulDiscovery?.galleryTabForArtwork?.(artwork) || 'discover';
                return GALLERY_TABS.find(tab => tab.id === categoryId)?.label || 'Discovery';
            }

            function prepareGalleryArtwork(artwork = {}) {
                const metadataMissing = artwork.source === 'v41_projection' && !hasSafeMedia(artwork);
                const presentationStatus = window.ArtSoulArtworkCard?.statusInfo?.(artwork);
                return {
                    ...artwork,
                    file_url: artwork.file_url || artwork.media_url || '',
                    gallery_metadata_missing: metadataMissing,
                    gallery_status_label: presentationStatus?.label || friendlyStatusLabel(artwork.status),
                    gallery_message: metadataMissing
                        ? 'This artwork is on-chain, but its media URL is unavailable.'
                        : ''
                };
            }

            function emptyStateForTab(tabId, hasFilters) {
                if (tabId === 'search') {
                    return {
                        title: 'No artworks match this search',
                        detail: 'Try another title, creator, or collection name.',
                        cta: false
                    };
                }

                if (hasFilters) {
                    return {
                        title: 'No public testnet artworks match this view',
                        detail: 'Adjust filters or explore another tab.',
                        cta: false
                    };
                }

                if (tabId === 'marketplace') {
                    return {
                        title: 'No resale listings yet',
                        detail: 'Collector resale listings will appear here after settled NFTs are listed.',
                        cta: false
                    };
                }

                if (tabId === 'nft') {
                    return {
                        title: 'No collected NFTs yet',
                        detail: 'Settled and minted artworks that are not listed for resale will appear here.',
                        cta: false
                    };
                }

                if (tabId === 'discover') {
                    return {
                        title: 'No artworks awaiting auction',
                        detail: 'Published artworks waiting to be auctioned or re-auctioned will appear here.',
                        cta: true
                    };
                }

                if (tabId === 'collections') {
                    return {
                        title: 'Collections are not live yet',
                        detail: 'Real collection pages will appear after collection data is available.',
                        cta: false
                    };
                }

                return {
                    title: 'Awaiting live testnet artworks',
                    detail: 'Published protocol artworks will appear here after processing.',
                    cta: true
                };
            }

            function applyPublicGalleryFilters(artworks, filters) {
                const {
                    activeTab,
                    statusFilter,
                    sortBy,
                    minPrice,
                    maxPrice,
                    searchQuery
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

                let result = (Array.isArray(artworks) ? artworks : []).map(prepareGalleryArtwork);
                const globalSearch = searchQuery.trim() !== '';

                result = result.filter(artwork =>
                    artwork.moderation_hidden !== true &&
                    artwork.is_hidden !== true &&
                    artwork.is_blocked !== true &&
                    artwork.is_deleted !== true
                );
                result = result.filter(artwork => (
                    window.ArtSoulArtworkCard?.hasSafeMedia?.(artwork) ?? hasSafeMedia(artwork)
                ));
                if (!globalSearch && window.ArtSoulDiscovery?.filterForGalleryTab) {
                    result = window.ArtSoulDiscovery.filterForGalleryTab(result, activeTab);
                }
                if (statusFilter !== 'all') {
                    result = result.filter(artwork => normalize(artwork.status) === normalize(statusFilter));
                }

                if (minPrice !== '') {
                    const min = parseFloat(minPrice);
                    if (Number.isFinite(min)) {
                        result = result.filter(artwork => toNumber(artwork.creator_value) >= min);
                    }
                }

                if (maxPrice !== '') {
                    const max = parseFloat(maxPrice);
                    if (Number.isFinite(max)) {
                        result = result.filter(artwork => toNumber(artwork.creator_value) <= max);
                    }
                }

                if (searchQuery.trim() !== '') {
                    if (window.ArtSoulDiscovery?.searchArtworks) {
                        result = window.ArtSoulDiscovery.searchArtworks(result, searchQuery);
                    } else {
                        const query = normalize(searchQuery.trim());
                        result = result.filter(artwork =>
                            [
                                artwork.title,
                                artwork.description,
                                artwork.creator,
                                artwork.creator_id,
                                artwork.creator_name,
                                artwork.creator_username,
                                artwork.collection_name,
                                artwork.collection?.name,
                                artwork.collection_title,
                                artwork.artwork_id,
                                artwork.auction_id
                            ].some(value => normalize(value).includes(query))
                        );
                    }
                }

                if (window.ArtSoulDiscovery?.sortArtworks) {
                    result = window.ArtSoulDiscovery.sortArtworks(result, globalSearch ? 'discovery' : sortBy);
                } else if (sortBy === 'newest') {
                    result.sort((a, b) => toTimestamp(b.created_at) - toTimestamp(a.created_at));
                } else if (sortBy === 'oldest') {
                    result.sort((a, b) => toTimestamp(a.created_at) - toTimestamp(b.created_at));
                } else if (sortBy === 'price_high') {
                    result.sort((a, b) => toNumber(b.creator_value) - toNumber(a.creator_value));
                } else if (sortBy === 'price_low') {
                    result.sort((a, b) => toNumber(a.creator_value) - toNumber(b.creator_value));
                } else if (sortBy === 'ai_value') {
                    result.sort((a, b) =>
                        toNumber(b.system_value ?? b.ai_value) - toNumber(a.system_value ?? a.ai_value)
                    );
                }

                return result.slice(0, 200);
            }

            async function loadArtworks() {
                const loadId = ++loadSequenceRef.current;

                try {
                    setLoading(true);
                    const db = await waitForArtSoulDB();
                    let data = [];

                    if (!db) {
                        throw new Error('V4.1 artwork data source is not ready');
                    }

                    data = await db.getPublicProjectionArtworks({
                        limit: 200
                    });

                    if (loadId !== loadSequenceRef.current) {
                        return;
                    }

                    setArtworkCorpus(data || []);
                    setLoading(false);
                } catch (error) {
                    if (loadId !== loadSequenceRef.current) {
                        return;
                    }
                    console.error('Error loading artworks:', error);
                    setArtworkCorpus([]);
                    setLoading(false);
                }
            }

            function clearFilters() {
                selectGalleryTab('live_auctions');
                setStatusFilter('all');
                setSortBy('discovery');
                setMinPrice('');
                setMaxPrice('');
                setSearchQuery('');
            }

            function hasActiveFilters() {
                return statusFilter !== 'all' ||
                    minPrice !== '' ||
                    maxPrice !== '' ||
                    searchQuery.trim() !== '';
            }

            return (
                <div className="min-h-screen">
                    {/* Main Content */}
                    <main className="container mx-auto px-4 py-6">
                        {/* Page title + subtitle live in the compact sticky header
                            (.page-context) — no large in-page hero heading here. */}

                        {/* Filters */}
                        <div className="rounded-xl p-6 mb-8" style={{
                            background: isClassic ? 'rgba(232, 227, 213, 0.03)' : 'rgba(var(--c-accent-rgb), 0.05)',
                            border: isClassic ? '1px solid var(--c-accent)' : '1px solid rgba(var(--c-accent-rgb), 0.3)',
                            boxShadow: isClassic ? 'none' : '0 0 20px rgba(var(--c-accent-rgb), 0.1)'
                        }}>
                            <div className="flex flex-wrap gap-2 mb-4">
                                {GALLERY_TABS.map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => selectGalleryTab(tab.id)}
                                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                                            activeTab === tab.id
                                                ? 'btn-main'
                                                : 'btn-secondary'
                                        }`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                                {/* Search */}
                                <input
                                    type="text"
                                    placeholder="Search title, creator, collection..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="px-4 py-2 rounded-lg"
                                    style={{
                                        background: isClassic ? 'rgba(232, 227, 213, 0.05)' : 'rgba(var(--c-accent-rgb), 0.05)',
                                        border: isClassic ? '1px solid var(--c-accent)' : '1px solid rgba(var(--c-accent-rgb), 0.3)',
                                        color: isClassic ? 'var(--c-accent)' : 'var(--c-accent)'
                                    }}
                                />

                                {/* Status Filter */}
                                <select
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value)}
                                    aria-label="Filter artworks by status"
                                    data-artsoul-value={statusFilter}
                                    className="gallery-filter-select"
                                >
                                    <option value="all">All Status</option>
                                    <option value="draft">Draft</option>
                                    <option value="auction">Live</option>
                                    <option value="sold">Sold</option>
                                </select>

                                {/* Sort */}
                                <select
                                    value={isGlobalSearch ? 'discovery' : sortBy}
                                    onChange={(e) => setSortBy(e.target.value)}
                                    disabled={searchQuery.trim() !== ''}
                                    aria-label="Sort artworks"
                                    data-artsoul-value={isGlobalSearch ? 'discovery' : sortBy}
                                    title={searchQuery.trim() !== '' ? 'Search results use Discovery Rank' : 'Sort artworks'}
                                    className="gallery-filter-select"
                                >
                                    <option value="discovery">Discovery Rank</option>
                                    <option value="newest">Newest First</option>
                                    <option value="oldest">Oldest First</option>
                                    <option value="price_high">Price: High to Low</option>
                                    <option value="price_low">Price: Low to High</option>
                                    <option value="ai_value">Guidance Score: High to Low</option>
                                    <option value="most_voted">Most Voted</option>
                                    <option value="would_buy">Would Buy Signals</option>
                                    <option value="watching">Watching</option>
                                    <option value="ending_soon">Ending Soon</option>
                                    <option value="highest_bid">Highest Bid</option>
                                    <option value="trust">Trust Weight</option>
                                </select>

                                {/* Clear Filters */}
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => setFiltersOpen(open => !open)}
                                        className="btn-secondary"
                                    >
                                        {filtersOpen ? 'Hide Filters' : 'Filters'}
                                    </button>
                                    <button
                                        onClick={clearFilters}
                                        className="btn-secondary"
                                    >
                                        Clear
                                    </button>
                                </div>
                            </div>

                            {/* Price Range */}
                            {filtersOpen && (
                                <div className="grid grid-cols-2 gap-4">
                                    <input
                                        type="number"
                                        step="0.01"
                                        placeholder="Min Price (ETH)"
                                        value={minPrice}
                                        onChange={(e) => setMinPrice(e.target.value)}
                                        className="px-4 py-2 rounded-lg"
                                        style={{
                                            background: isClassic ? 'rgba(232, 227, 213, 0.05)' : 'rgba(var(--c-accent-rgb), 0.05)',
                                            border: isClassic ? '1px solid var(--c-accent)' : '1px solid rgba(var(--c-accent-rgb), 0.3)',
                                            color: isClassic ? 'var(--c-accent)' : 'var(--c-accent)'
                                        }}
                                    />
                                    <input
                                        type="number"
                                        step="0.01"
                                        placeholder="Max Price (ETH)"
                                        value={maxPrice}
                                        onChange={(e) => setMaxPrice(e.target.value)}
                                        className="px-4 py-2 rounded-lg"
                                        style={{
                                            background: isClassic ? 'rgba(232, 227, 213, 0.05)' : 'rgba(var(--c-accent-rgb), 0.05)',
                                            border: isClassic ? '1px solid var(--c-accent)' : '1px solid rgba(var(--c-accent-rgb), 0.3)',
                                            color: isClassic ? 'var(--c-accent)' : 'var(--c-accent)'
                                        }}
                                    />
                                </div>
                            )}

                            {/* Results Count */}
                            <div className="mt-4 text-sm opacity-70" aria-live="polite">
                                {loading
                                    ? 'Loading artworks...'
                                    : isSearchPending
                                    ? 'Searching across all categories...'
                                    : isGlobalSearch
                                    ? `Showing ${filteredArtworks.length} results across all categories for “${debouncedSearchQuery.trim()}”`
                                    : `Showing ${filteredArtworks.length} artworks in ${GALLERY_TABS.find(tab => tab.id === activeTab)?.label || 'Discover'}`}
                            </div>
                        </div>

                        {/* Gallery Grid */}
                        {loading ? (
                            <CardGridSkeleton />
                        ) : filteredArtworks.length === 0 ? (
                            <div className="text-center py-20 rounded-xl" style={{
                                background: isClassic ? 'rgba(232, 227, 213, 0.03)' : 'rgba(var(--c-accent-rgb), 0.04)',
                                border: isClassic ? '1px solid rgba(var(--c-accent-rgb), 0.35)' : '1px solid rgba(var(--c-accent-rgb), 0.22)'
                            }}>
                                {(() => {
                                    const emptyState = emptyStateForTab(isGlobalSearch ? 'search' : activeTab, hasActiveFilters());
                                    return (
                                        <>
                                <div className="text-xl opacity-50">
                                                {emptyState.title}
                                </div>
                                <div className="text-sm opacity-30 mt-2">
                                                {emptyState.detail}
                                </div>
                                            {emptyState.cta && (
                                    <button
                                        onClick={() => window.location.href = 'upload.html'}
                                        className="btn-main mt-6"
                                    >
                                        Publish Artwork
                                    </button>
                                )}
                                        </>
                                    );
                                })()}
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                                {filteredArtworks
                                    .filter(artwork => !window.ArtSoulArtworkCard?.isHidden?.(artwork))
                                    .map(artwork => {
                                    const SharedArtworkCard = window.ArtSoulArtworkCard?.ReactCard;
                                    if (SharedArtworkCard) {
                                        // TODO: Add a "Make an offer" action to NFT cards here once
                                        // contract-level offers are supported.
                                        return (
                                            <SharedArtworkCard
                                                key={artwork.id}
                                                artwork={artwork}
                                                minimal={true}
                                                surface="gallery"
                                                onOpen={() => window.location.href = `artwork.html?id=${artwork.id}`}
                                                actions={isGlobalSearch ? (
                                                    <span
                                                        className="inline-flex rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-wide"
                                                        style={{
                                                            color: 'var(--c-accent)',
                                                            border: '1px solid var(--c-border-soft)',
                                                            background: 'var(--c-surface-muted)'
                                                        }}
                                                    >
                                                        {categoryLabelForArtwork(artwork)}
                                                    </span>
                                                ) : null}
                                            />
                                        );
                                    }
                                    return (
                                    <div
                                        key={artwork.id}
                                        onClick={() => window.location.href = `artwork.html?id=${artwork.id}`}
                                        className="rounded-xl overflow-hidden cursor-pointer transition-all hover:scale-105 flex flex-col h-full"
                                        style={{
                                            background: isClassic ? 'rgba(232, 227, 213, 0.03)' : 'rgba(var(--c-accent-rgb), 0.05)',
                                            border: isClassic ? '1px solid var(--c-accent)' : '1px solid rgba(var(--c-accent-rgb), 0.3)',
                                            boxShadow: isClassic ? 'none' : '0 0 15px rgba(var(--c-accent-rgb), 0.1)'
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!isClassic) {
                                                e.currentTarget.style.borderColor = 'var(--c-accent-2)';
                                                e.currentTarget.style.boxShadow = '0 0 30px rgba(var(--c-accent-2-rgb), 0.4)';
                                            } else {
                                                e.currentTarget.style.borderColor = 'var(--c-accent)';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!isClassic) {
                                                e.currentTarget.style.borderColor = 'rgba(var(--c-accent-rgb), 0.3)';
                                                e.currentTarget.style.boxShadow = '0 0 15px rgba(var(--c-accent-rgb), 0.1)';
                                            } else {
                                                e.currentTarget.style.borderColor = 'var(--c-accent)';
                                            }
                                        }}
                                    >
                                        {isGlobalSearch && (
                                            <div
                                                className="px-3 py-2 text-xs font-semibold uppercase tracking-wide"
                                                style={{
                                                    color: 'var(--c-accent)',
                                                    borderBottom: '1px solid var(--c-border-soft)',
                                                    background: 'var(--c-surface-muted)'
                                                }}
                                            >
                                                {categoryLabelForArtwork(artwork)}
                                            </div>
                                        )}
                                        {/* Image */}
                                        <div className="aspect-square overflow-hidden bg-black relative">
                                            {artwork.file_url && hasSafeMedia(artwork) ? (
                                                <>
                                                    {/* Video Preview */}
                                                    {(() => {
                                                        const fileType = artwork.file_type?.toLowerCase() || '';
                                                        const url = artwork.file_url?.toLowerCase() || '';
                                                        const isVideo = fileType === 'video' ||
                                                                       ['mp4', 'webm', 'mov'].includes(fileType) ||
                                                                       (!fileType && (url.includes('.mp4') || url.includes('.webm') || url.includes('.mov')));
                                                        return isVideo;
                                                    })() ? (
                                                        <>
                                                            <video
                                                                src={artwork.file_url}
                                                                className="w-full h-full object-contain"
                                                                preload="metadata"
                                                                poster="ARTSOULlogo-clean.png"
                                                                muted
                                                                playsInline
                                                                controls
                                                                onLoadedMetadata={(e) => window.ArtSoulArtworkCard?.prepareVideoPreview?.(e.currentTarget)}
                                                                onClick={(e) => e.stopPropagation()}
                                                                style={{position: 'relative', zIndex: 10}}
                                                            />
                                                        </>
                                                    ) : (() => {
                                                        const fileType = artwork.file_type?.toLowerCase() || '';
                                                        const url = artwork.file_url?.toLowerCase() || '';
                                                        const isAudio = fileType === 'audio' || fileType === 'music' ||
                                                                       ['mp3', 'wav', 'ogg'].includes(fileType) ||
                                                                       (!fileType && (url.includes('.mp3') || url.includes('.wav') || url.includes('.ogg')));
                                                        return isAudio;
                                                    })() ? (
                                                        <div className={`w-full h-full flex flex-col items-center justify-center ${isClassic ? 'bg-gray-800' : 'bg-gradient-to-br from-purple-900/30 to-cyan-900/30'}`} style={{position: 'relative'}}>
                                                            <img
                                                                id={`music-logo-${artwork.id}`}
                                                                src="ARTSOULlogo.png"
                                                                alt="Music"
                                                                style={{
                                                                    width: '50%',
                                                                    height: '50%',
                                                                    objectFit: 'contain',
                                                                    animation: 'spin 3s linear infinite',
                                                                    animationPlayState: 'paused',
                                                                    marginBottom: '1rem'
                                                                }}
                                                            />
                                                            <audio
                                                                src={artwork.file_url}
                                                                controls
                                                                crossOrigin="anonymous"
                                                                onClick={(e) => e.stopPropagation()}
                                                                onTouchStart={(e) => e.stopPropagation()}
                                                                onPlay={(e) => {
                                                                    const logo = document.getElementById(`music-logo-${artwork.id}`);
                                                                    if (logo) logo.style.animationPlayState = 'running';
                                                                }}
                                                                onPause={(e) => {
                                                                    const logo = document.getElementById(`music-logo-${artwork.id}`);
                                                                    if (logo) logo.style.animationPlayState = 'paused';
                                                                }}
                                                                onEnded={(e) => {
                                                                    const logo = document.getElementById(`music-logo-${artwork.id}`);
                                                                    if (logo) logo.style.animationPlayState = 'paused';
                                                                }}
                                                                style={{width: '90%', maxWidth: '300px'}}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <img
                                                            src={artwork.file_url}
                                                            alt={window.ArtSoulSecurity?.sanitizeText(artwork.title) || 'Artwork'}
                                                            className="w-full h-full object-contain"
                                                        />
                                                    )}
                                                </>
                                            ) : (
                                                <div className="w-full h-full flex flex-col items-center justify-center text-center p-4" style={{
                                                    background: isClassic ? 'rgba(232, 227, 213, 0.05)' : 'linear-gradient(135deg, rgba(var(--c-accent-2-rgb), 0.2), rgba(var(--c-accent-rgb), 0.2))'
                                                }}>
                                                    <div className="text-sm uppercase tracking-wide opacity-50 mb-2">On-chain</div>
                                                    <div className="text-lg opacity-70">Metadata unavailable</div>
                                                    <div className="text-xs opacity-40 mt-3">Artwork #{artwork.artwork_id || artwork.blockchain_id || 'unknown'}</div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Info */}
                                        <div className="p-4 flex flex-col flex-1">
                                            <h3 className="font-bold text-lg mb-2 truncate" style={{
                                                color: isClassic ? 'var(--c-accent)' : 'var(--c-accent)'
                                            }}>{artwork.title}</h3>
                                            <p className="text-sm opacity-70 mb-3 line-clamp-2" style={{minHeight: '2.5rem'}}>{artwork.description}</p>

                                            {/* Status Badge */}
                                            <div className="flex items-center justify-between mb-3">
                                                <span className="px-2 py-1 rounded text-xs font-medium" style={{
                                                    background: artwork.gallery_metadata_missing
                                                        ? 'rgba(var(--c-accent-rgb), 0.12)'
                                                        : artwork.status === 'auction'
                                                        ? 'rgba(var(--c-accent-rgb), 0.2)'
                                                        : artwork.status === 'sold'
                                                        ? 'rgba(var(--c-accent-2-rgb), 0.18)'
                                                        : 'rgba(var(--c-accent-3-rgb), 0.18)',
                                                    color: artwork.gallery_metadata_missing
                                                        ? 'var(--c-accent)'
                                                        : artwork.status === 'auction'
                                                        ? 'var(--c-accent)'
                                                        : artwork.status === 'sold'
                                                        ? 'var(--c-accent-2)'
                                                        : 'var(--c-accent-3)',
                                                    border: `1px solid ${artwork.gallery_metadata_missing
                                                        ? 'rgba(var(--c-accent-rgb), 0.5)'
                                                        : artwork.status === 'auction'
                                                        ? 'var(--c-accent)'
                                                        : artwork.status === 'sold'
                                                        ? 'var(--c-accent-2)'
                                                        : 'var(--c-accent-3)'}`
                                                }}>
                                                    {artwork.gallery_status_label}
                                                </span>
                                            </div>
                                            {artwork.gallery_message && (
                                                <p className="text-xs opacity-60 mb-3">{artwork.gallery_message}</p>
                                            )}

                                            {/* Values */}
                                            <div className="space-y-1 text-sm">
                                                <div className="flex justify-between">
                                                    <span className="opacity-70">Creator:</span>
                                                    <span className="font-bold">{artwork.creator_value || '0'} ETH</span>
                                                </div>
                                                {artwork.system_value && (
                                                    <div className="flex justify-between">
                                                        <span className="opacity-70">Guidance:</span>
                                                        <span className="font-bold" style={{
                                                            color: isClassic ? 'var(--c-accent)' : 'var(--c-accent)'
                                                        }}>{artwork.system_value} ETH</span>
                                                    </div>
                                                )}
                                                <div className="flex justify-between">
                                                    <span className="opacity-70">Votes:</span>
                                                    <span className="font-medium">{artwork.vote_count || 0}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="opacity-70">Would Buy:</span>
                                                    <span className="font-medium">{window.ArtSoulDiscovery?.getSocialSignals?.(artwork)?.wouldBuy || 0}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="opacity-70">Watching:</span>
                                                    <span className="font-medium">{window.ArtSoulDiscovery?.getSocialSignals?.(artwork)?.watching || 0}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="opacity-70">Trust:</span>
                                                    <span className="font-medium">{window.ArtSoulDiscovery?.normalizeArtwork?.(artwork)?.trust_score || 45}</span>
                                                </div>
                                            </div>

                                            {/* Creator */}
                                            <div className="mt-auto pt-3" style={{
                                                borderTop: isClassic ? '1px solid rgba(var(--c-accent-rgb), 0.3)' : '1px solid rgba(var(--c-accent-rgb), 0.2)'
                                            }}>
                                                <div className="text-xs opacity-50">
                                                    {artwork.creator_id?.slice(0, 6)}...{artwork.creator_id?.slice(-4)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        )}
                    </main>
                </div>
            );
        }

        createRoot(document.getElementById('app')).render(<GalleryPage />);
