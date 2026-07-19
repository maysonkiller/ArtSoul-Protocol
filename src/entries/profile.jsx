import { React, createRoot } from './react-runtime.js';
import { CardGridSkeleton, ProfilePageSkeleton } from './loading-skeletons.jsx';
import '../../supabase-client.js';
import '../../supabase-auth.js';

const { useState, useEffect, useRef } = React;

        const GALLERY_TYPES = [
            { id: 'created', label: 'Created Artworks', icon: '', description: 'Artworks you created' },
            { id: 'auction', label: 'Auctions', icon: '', description: 'Artwork currently in auction' },
            { id: 'sold', label: 'Sales', icon: '', description: 'Completed sales' },
            { id: 'collected', label: 'Owned NFTs', icon: '', description: 'NFTs you own' },
        ];

        function TransactionProcessingLabel() {
            return (
                <span className="inline-flex items-center justify-center gap-2">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true"></span>
                    Processing...
                </span>
            );
        }

        function ProfilePage() {
            const initialViewAddress = getViewAddress();
            const initialWalletHint = getStoredWalletHint();
            const hasInitialWalletHint = /^0x[a-f0-9]{40}$/i.test(initialWalletHint);
            const initiallySettled = Boolean(initialViewAddress) ||
                window.artsoulWalletStateSettled === true ||
                !hasInitialWalletHint;
            const [theme, setTheme] = useState(() => window.ThemeSync?.getTheme() || 'classic');
            const [profile, setProfile] = useState(null);
            const [editMode, setEditMode] = useState(false);
            const [selectedGallery, setSelectedGallery] = useState('created');
            const [myArtworks, setMyArtworks] = useState([]);
            const [loading, setLoading] = useState(() => Boolean(initialViewAddress || hasInitialWalletHint));
            const [artworksLoading, setArtworksLoading] = useState(() => Boolean(initialViewAddress || hasInitialWalletHint));
            const [isOwnProfile, setIsOwnProfile] = useState(true);
            const [walletStateSettled, setWalletStateSettled] = useState(initiallySettled);
            const [discoveryProfile, setDiscoveryProfile] = useState(null);
            const [oauthNotice, setOAuthNotice] = useState(null);
            const fileInputRef = useRef(null);
            const profileSignalRef = useRef({ address: null, chainId: null, initialized: false });
            const profileRequestRef = useRef(0);
            const loadedProfileAddressRef = useRef(null);
            const loadingProfileAddressRef = useRef(null);
            const artworksRequestRef = useRef(0);
            const transactionActionsRef = useRef(new Set());
            const [transactionActions, setTransactionActions] = useState({});
            const [addressCopied, setAddressCopied] = useState(false);
            const addressCopiedTimerRef = useRef(null);

            const isClassic = theme === 'classic';
            // Keep React-rendered theme classes aligned with ThemeManager.
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

            useEffect(() => () => {
                if (addressCopiedTimerRef.current) clearTimeout(addressCopiedTimerRef.current);
            }, []);

            // Load profile and keep it aligned with late wallet/network state.
            useEffect(() => {
                if (new URLSearchParams(window.location.search).has('oauth_status')) {
                    handleOAuthCallback();
                }

                let disposed = false;
                const refreshProfileState = (event = null, options = {}) => {
                    if (disposed) return;

                    const viewAddress = getViewAddress();
                    const stateIsSettled = Boolean(viewAddress) || window.artsoulWalletStateSettled === true;
                    if (!stateIsSettled) return;
                    setWalletStateSettled(true);

                    const signal = getProfileSignal(event?.detail);
                    const previous = profileSignalRef.current;
                    const confirmedAddress = event?.detail?.isConnected
                        ? event.detail.address
                        : getActiveWalletAddress();
                    const viewedAddress = getViewAddress() || signal.address;
                    if (viewedAddress && confirmedAddress) {
                        setIsOwnProfile(viewedAddress.toLowerCase() === confirmedAddress.toLowerCase());
                    }

                    const addressChanged = signal.address !== previous.address;
                    if (!previous.initialized || options.force || addressChanged) {
                        profileSignalRef.current = { ...signal, initialized: true };
                        loadProfile(signal.address);
                    }
                };

                if (getViewAddress() || window.artsoulWalletStateSettled === true) {
                    refreshProfileState({ detail: window.artsoulSettledWalletState });
                }

                window.addEventListener('artsoul:wallet-state-settled', refreshProfileState);
                window.addEventListener('artsoul:wallet-state-changed', refreshProfileState);

                return () => {
                    disposed = true;
                    window.removeEventListener('artsoul:wallet-state-settled', refreshProfileState);
                    window.removeEventListener('artsoul:wallet-state-changed', refreshProfileState);
                };
            }, []);

            useEffect(() => {
                if (profile) {
                    loadMyArtworks();
                }
            }, [selectedGallery]);

            function sleep(ms) {
                return new Promise(resolve => setTimeout(resolve, ms));
            }

            function getViewAddress() {
                const urlParams = new URLSearchParams(window.location.search);
                return urlParams.get('address') || '';
            }

            function getStoredWalletHint() {
                return window.getStoredWalletHint?.() || localStorage.getItem('artsoul_wallet') || '';
            }

            function getActiveWalletAddress() {
                return window.getCurrentWalletAddress?.() ||
                    window.currentWalletAddress ||
                    getAppKitAccountAddress() ||
                    '';
            }

            function getActiveChainId() {
                return (window.getCurrentChainId?.() ||
                    window.selectedNetworkId ||
                    window.currentChainId ||
                    getAppKitChainId() ||
                    window.ethereum?.chainId ||
                    '').toString();
            }

            function getProfileSignal(walletState = null) {
                const viewAddress = getViewAddress();
                const walletAddress = walletState?.isConnected === false
                    ? ''
                    : walletState?.address || getActiveWalletAddress();
                const chainId = walletState?.chainId || getActiveChainId();

                return {
                    address: viewAddress || walletAddress,
                    chainId: (chainId || '').toString()
                };
            }

            function getProfileDisplayName(profileData, address = '') {
                const resolver = window.ArtSoulProfileDisplay?.displayName || window.ArtSoulDB?.displayName;
                const fallbackAddress = address || profileData?.wallet_address || '';
                const fallbackName = fallbackAddress
                    ? `${fallbackAddress.slice(0, 6)}...${fallbackAddress.slice(-4)}`
                    : 'Anonymous Artist';
                return resolver?.(profileData, fallbackAddress) || fallbackName;
            }

            function getProfileAvatarUrl(profileData) {
                const resolver = window.ArtSoulProfileDisplay?.avatarUrl || window.ArtSoulDB?.avatarUrl;
                return resolver?.(profileData, '') || '';
            }

            // Base mainnet explorer: the protocol targets Base mainnet, so the
            // profile address always links to basescan.org.
            function getExplorerAddressUrl(address) {
                const normalized = String(address || '').trim();
                if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) return null;
                return `https://basescan.org/address/${normalized}`;
            }

            async function handleCopyAddress(address) {
                const value = String(address || '').trim();
                if (!value) return;
                try {
                    if (navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(value);
                    } else {
                        const helper = document.createElement('textarea');
                        helper.value = value;
                        helper.setAttribute('readonly', '');
                        helper.style.position = 'absolute';
                        helper.style.left = '-9999px';
                        document.body.appendChild(helper);
                        helper.select();
                        document.execCommand('copy');
                        helper.remove();
                    }
                    setAddressCopied(true);
                    if (addressCopiedTimerRef.current) clearTimeout(addressCopiedTimerRef.current);
                    addressCopiedTimerRef.current = setTimeout(() => setAddressCopied(false), 1500);
                } catch (error) {
                    console.warn('Copy wallet address failed:', error);
                    window.ErrorHandler?.showToast?.('Could not copy the address. Copy it manually.', 'error');
                }
            }

            function getAppKitAccountAddress() {
                try {
                    const account = window.web3Modal?.getAccount?.();
                    const accountDisconnected = account && (account.status === 'disconnected' || account.isConnected === false);
                    if (accountDisconnected) return '';
                    return account?.address || account?.allAccounts?.[0]?.address || '';
                } catch (error) {
                    return '';
                }
            }

            function getAppKitChainId() {
                try {
                    const account = window.web3Modal?.getAccount?.();
                    const state = window.web3Modal?.getState?.();
                    return account?.chainId || state?.selectedNetworkId || state?.chainId || '';
                } catch (error) {
                    return '';
                }
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

            async function waitForArtSoulDB(maxAttempts = 40, delay = 150) {
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    if (typeof window.ArtSoulDB?.getProfile === 'function') {
                        return window.ArtSoulDB;
                    }
                    await sleep(delay);
                }
                return null;
            }

            async function waitForOAuthIntegration(maxAttempts = 40, delay = 150) {
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    if (typeof window.OAuthIntegration?.handleCallback === 'function') {
                        return window.OAuthIntegration;
                    }
                    await sleep(delay);
                }
                return null;
            }

            function filterProfileFallbackArtworks(artworks, walletAddress, status = null) {
                const owner = (walletAddress || '').toLowerCase();
                let result = Array.isArray(artworks) ? [...artworks] : [];

                result = result.filter(artwork =>
                    artwork.is_hidden !== true &&
                    artwork.is_blocked !== true &&
                    artwork.is_deleted !== true &&
                    artwork.creator_id?.toLowerCase() === owner
                );

                if (window.ArtSoulDiscovery?.filterPublicTestnetArtworks) {
                    result = window.ArtSoulDiscovery.filterPublicTestnetArtworks(result);
                }

                if (status) {
                    result = result.filter(artwork => artwork.status === status);
                }

                return result;
            }

            function normalizeAddress(address) {
                return String(address || '').trim().toLowerCase();
            }

            function isZeroProtocolId(value) {
                const text = String(value || '').trim();
                return !text || text === '0' || text.toLowerCase() === 'none';
            }

            function hasActiveAuction(artwork = {}) {
                const status = String(artwork.status || '').toLowerCase();
                if (isMintedArtwork(artwork) || status === 'sold' || status === 'for_sale') return false;
                if (!isZeroProtocolId(artwork.active_auction_id || artwork.activeAuctionId)) return true;
                return status === 'auction' || status === 'awaiting_end' || status === 'settlement_pending';
            }

            function isMintedArtwork(artwork = {}) {
                return Boolean(artwork.minted) || !isZeroProtocolId(artwork.token_id || artwork.tokenId);
            }

            function isSoldOrSettledArtwork(artwork = {}) {
                const status = String(artwork.status || '').toLowerCase();
                return isMintedArtwork(artwork) || status === 'sold' || status === 'for_sale' || status === 'settled';
            }

            function isLiveAuctionArtwork(artwork = {}) {
                return window.ArtSoulDiscovery?.isLiveAuction?.(artwork) === true;
            }

            function isCollectedArtwork(artwork = {}, ownerAddress = '') {
                const owner = normalizeAddress(ownerAddress);
                // A creator who buys back their own mint through a completed
                // resale is still the projected current owner, so Owned must
                // not exclude creator-owned mints. Ownership comes only from
                // the indexed current_owner_address, never wallet state.
                return Boolean(owner) && isMintedArtwork(artwork) &&
                    normalizeAddress(artwork.current_owner_address) === owner;
            }

            function filterCanonicalProfileArtworks(artworks, walletAddress, galleryType = 'created') {
                const owner = normalizeAddress(walletAddress);
                let result = Array.isArray(artworks) ? [...artworks] : [];

                result = result.filter(artwork =>
                    artwork?.source === 'v41_projection' &&
                    artwork.is_hidden !== true &&
                    artwork.is_blocked !== true &&
                    artwork.is_deleted !== true
                );

                if (galleryType === 'owned' || galleryType === 'collected') {
                    result = result.filter(artwork => isCollectedArtwork(artwork, owner));
                } else {
                    result = result.filter(artwork => normalizeAddress(artwork.creator_id || artwork.creator) === owner);

                    if (galleryType === 'auction') {
                        result = result.filter(isLiveAuctionArtwork);
                    } else if (galleryType === 'sold') {
                        result = result.filter(isSoldOrSettledArtwork);
                    }
                }

                return result;
            }

            function getProfileArtworkStatus(artwork = {}) {
                return window.ArtSoulArtworkCard?.statusInfo?.(artwork) || {
                    key: 'not_minted',
                    label: 'Not yet minted'
                };
            }

            function getProfileArtworkPrice(artwork = {}) {
                const minted = isMintedArtwork(artwork);
                const candidates = minted
                    ? [artwork.listing_price, artwork.resale_price, artwork.sale_price, artwork.price, artwork.floor_price, artwork.canonical_floor]
                    : [artwork.start_price, artwork.creator_value, artwork.price];

                for (const value of candidates) {
                    const numeric = Number(value);
                    if (Number.isFinite(numeric) && numeric > 0) {
                        return `${numeric.toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH`;
                    }
                }
                return '';
            }

            function getProfileArtworkHref(artwork = {}) {
                const sharedHref = window.ArtSoulArtworkCard?.detailHref?.(artwork) || '';
                if (!sharedHref || sharedHref.includes('id=pending%3A')) return '';
                return sharedHref;
            }

            function ProfileArtworkMedia({ artwork, onUnavailable }) {
                const SharedMedia = window.ArtSoulArtworkCard?.ReactMedia;
                return SharedMedia ? <SharedMedia artwork={artwork} onUnavailable={onUnavailable} /> : null;
            }

            function ProfileArtworkCard({ artwork }) {
                const [mediaUnavailable, setMediaUnavailable] = useState(false);
                const sharedCards = window.ArtSoulArtworkCard;
                const mediaKey = sharedCards?.mediaUrl?.(artwork) || '';
                useEffect(() => setMediaUnavailable(false), [mediaKey]);
                if (!sharedCards?.hasSafeMedia?.(artwork) || mediaUnavailable) return null;

                const status = getProfileArtworkStatus(artwork);
                const price = getProfileArtworkPrice(artwork);
                const href = getProfileArtworkHref(artwork);
                const SharedProvenance = sharedCards?.ReactProvenance;
                const CardElement = href ? 'a' : 'div';

                return (
                    <CardElement
                        href={href || undefined}
                        className="artsoul-artwork-card profile-artwork-card"
                        aria-label={href ? `Open ${artwork.title || 'artwork'}` : undefined}
                    >
                        <ProfileArtworkMedia artwork={artwork} onUnavailable={() => setMediaUnavailable(true)} />
                        <div className="artsoul-card-body">
                            <h4 className="artsoul-card-title">{artwork.title || 'Untitled Artwork'}</h4>
                            {SharedProvenance && <SharedProvenance artwork={artwork} />}
                            <div className="artsoul-card-meta">
                                <span className={`artsoul-card-status artsoul-card-status-${status.key}`}>{status.label}</span>
                                {price && <span className="artsoul-card-price">{price}</span>}
                            </div>
                        </div>
                    </CardElement>
                );
            }

            function canCreateNewAuction(artwork = {}, walletAddress = '') {
                return normalizeAddress(artwork.creator_id || artwork.creator) === normalizeAddress(walletAddress) &&
                    !isMintedArtwork(artwork) &&
                    !hasActiveAuction(artwork);
            }

            function canListForResale(artwork = {}, walletAddress = '') {
                return isMintedArtwork(artwork) &&
                    normalizeAddress(artwork.current_owner_address) === normalizeAddress(walletAddress);
            }

            function sortNewestFirst(artworks = []) {
                const timestamp = window.ArtSoulArtworkCard?.toTimestamp || ((value) => new Date(value || 0).getTime() || 0);
                return [...artworks].sort((a, b) =>
                    timestamp(b.created_at || b.createdAt || b.indexed_at || b.updated_at) -
                    timestamp(a.created_at || a.createdAt || a.indexed_at || a.updated_at)
                );
            }

            function loadPendingIndexerArtworks(walletAddress, galleryType = 'created') {
                if (!walletAddress || galleryType !== 'created') {
                    return [];
                }

                try {
                    const owner = walletAddress.toLowerCase();
                    const parsed = JSON.parse(localStorage.getItem('artsoul_pending_indexer_artworks') || '[]');
                    if (!Array.isArray(parsed)) return [];

                    return parsed
                        .filter(artwork => artwork?.wallet_address?.toLowerCase() === owner || artwork?.creator_id?.toLowerCase() === owner)
                        .filter(hasConfirmedRegisterTx)
                        .map(artwork => {
                            const chainId = resolvePendingArtworkChainId(artwork);
                            const artworkId = normalizeProtocolArtworkId(artwork.artwork_id);
                            const canonicalV41Id = artwork.register_tx_hash && chainId && artworkId
                                ? `v41:${chainId}:${artworkId}`
                                : '';
                            const mediaUrl = artwork.file_url || artwork.media_url || '';
                            const missingIndexedMedia = Boolean(canonicalV41Id && !mediaUrl);
                            const auctionFailed = String(artwork.stage || '').toLowerCase() === 'auction_failed' ||
                                Boolean(artwork.auction_error_code || artwork.auction_error_message);
                            const auctionConfirmed = Boolean(artwork.auction_tx_hash);

                            return {
                                ...artwork,
                                id: canonicalV41Id || artwork.id || `pending:${artwork.temp_id}`,
                                pending_id: artwork.id || `pending:${artwork.temp_id}`,
                                canonical_v41_id: canonicalV41Id,
                                source: 'pending_indexer',
                                status: auctionFailed ? 'registered' : (canonicalV41Id ? 'indexed_missing_metadata' : 'pending_indexer'),
                                lifecycle_label: auctionFailed ? 'Artwork registered - auction failed' : (missingIndexedMedia ? 'Metadata unavailable' : 'Finalizing...'),
                                lifecycle_message: auctionFailed
                                    ? (artwork.auction_error_message || 'The artwork is registered on-chain, but auction creation failed. You can retry auction from your profile.')
                                    : missingIndexedMedia
                                    ? 'This artwork is on-chain, but its media is unavailable.'
                                    : auctionConfirmed
                                    ? 'Registration and auction are confirmed. Public display will update shortly.'
                                    : 'Submitted on-chain. Public display will update shortly.',
                                creator_id: artwork.creator_id || owner,
                                creator: artwork.creator || walletAddress,
                                title: artwork.title || 'Pending Artwork',
                                description: artwork.description || 'Submitted on-chain. Public display will update shortly.',
                                creator_value: artwork.creator_value || '0',
                                file_url: mediaUrl,
                                file_type: artwork.file_type || artwork.media_type || 'image'
                            };
                        });
                } catch {
                    return [];
                }
            }

            function hasConfirmedRegisterTx(artwork) {
                return Boolean(String(artwork?.register_tx_hash || '').trim());
            }

            function isBadPendingArtwork(artwork = {}) {
                if (hasConfirmedRegisterTx(artwork)) return false;
                const state = [
                    artwork.status,
                    artwork.stage,
                    artwork.error_code,
                    artwork.error_message
                ].join(' ').toLowerCase();
                return !hasConfirmedRegisterTx(artwork) ||
                    state.includes('fail') ||
                    state.includes('error') ||
                    state.includes('reject') ||
                    state.includes('revert') ||
                    state.includes('nonce');
            }

            window.ArtSoulCleanupBadPendingCards = function ArtSoulCleanupBadPendingCards() {
                try {
                    const key = 'artsoul_pending_indexer_artworks';
                    const current = JSON.parse(localStorage.getItem(key) || '[]');
                    const list = Array.isArray(current) ? current : [];
                    const kept = list.filter(artwork => !isBadPendingArtwork(artwork));
                    localStorage.setItem(key, JSON.stringify(kept));
                    const result = { removed: list.length - kept.length, kept: kept.length };
                    console.info('ArtSoul pending-card cleanup complete:', result);
                    return result;
                } catch (error) {
                    console.warn('ArtSoul pending-card cleanup failed:', error);
                    return { removed: 0, kept: 0, error: error.message };
                }
            };

            function normalizeProtocolArtworkId(value) {
                const text = String(value || '').trim();
                if (!text || text === '0' || text.toLowerCase() === 'none') return '';
                return /^\d+$/.test(text) ? text : '';
            }

            function resolvePendingArtworkChainId(artwork = {}) {
                const rawChainId = artwork.chain_id || artwork.chainId || artwork.network_chain_id;
                const parsed = Number(rawChainId);
                if (parsed === 84532 || parsed === 11155111) {
                    return parsed;
                }

                const network = String(artwork.network || artwork.chain || artwork.chain_name || '').toLowerCase();
                if (network.includes('base')) return 84532;
                if (network.includes('sepolia')) return 11155111;
                return 84532;
            }

            function artworkIdentityKeys(artwork = {}) {
                const keys = new Set();
                const add = (value) => {
                    const text = String(value || '').trim();
                    if (text) keys.add(text.toLowerCase());
                };

                add(artwork.register_tx_hash);
                add(artwork.transaction_hash);
                add(artwork.canonical_v41_id);
                if (String(artwork.id || '').startsWith('v41:')) {
                    add(artwork.id);
                }

                const chainId = resolvePendingArtworkChainId(artwork);
                const artworkId = normalizeProtocolArtworkId(artwork.artwork_id || artwork.blockchain_id);
                if (chainId && artworkId) {
                    add(`v41:${chainId}:${artworkId}`);
                    add(`${chainId}:${artworkId}`);
                }

                return keys;
            }

            function mergePendingIndexerArtworks(indexedArtworks, pendingArtworks) {
                const indexedKeys = new Set();
                (indexedArtworks || []).forEach(artwork => {
                    artworkIdentityKeys(artwork).forEach(key => indexedKeys.add(key));
                });

                const pending = (pendingArtworks || []).filter(artwork => {
                    return ![...artworkIdentityKeys(artwork)].some(key => indexedKeys.has(key));
                });

                return [...pending, ...(indexedArtworks || [])];
            }

            async function getGenesisState(walletAddress) {
                const fallback = {
                    owned: false,
                    tokenId: null,
                    eligibilityHash: null,
                    source: 'indexer-pending'
                };

                if (!walletAddress || typeof window.ArtSoulContracts?.getProjectNFTState !== 'function') {
                    return fallback;
                }

                try {
                    const provider = await window.web3Modal?.getWalletProvider?.();
                    if (provider && !window.ArtSoulContracts.provider) {
                        await window.ArtSoulContracts.init(provider);
                    }
                    const state = await window.ArtSoulContracts.getProjectNFTState(walletAddress);
                    return {
                        owned: Boolean(state?.minted || state?.hasProjectNFT || state?.owned || state?.balance > 0),
                        tokenId: state?.tokenId || null,
                        eligibilityHash: state?.eligibilityHash || null,
                        source: 'contract'
                    };
                } catch (error) {
                    console.warn('Could not load Genesis state:', error);
                    return fallback;
                }
            }

            function buildDiscoveryProfile(profileData, fullArtworkCorpus, genesisState) {
                if (!profileData?.wallet_address || !window.ArtSoulDiscovery) return null;
                const trust = window.ArtSoulDiscovery.computeTrustProfile(profileData, fullArtworkCorpus, {
                    genesisOwned: genesisState.owned
                });
                const genesisProgress = window.ArtSoulDiscovery.getGenesisProgress(profileData, fullArtworkCorpus, {
                    genesisOwned: genesisState.owned,
                    auctionParticipations: trust.signals.auctionParticipations,
                    successfulSettlements: trust.signals.successfulSettlements,
                    interactionCount: trust.signals.interactionCount
                });
                return { trust, genesisState, genesisProgress };
            }

            async function handleOAuthCallback() {
                const oauthIntegration = await waitForOAuthIntegration();
                if (!oauthIntegration) return;

                const result = await oauthIntegration.handleCallback();
                if (result) {
                    if (!result.success) {
                        setOAuthNotice({ type: 'error', message: result.message });
                        return;
                    }
                    const walletAddress = getActiveWalletAddress();
                    setOAuthNotice({
                        type: 'success',
                        message: `${result.provider === 'discord' ? 'Discord' : 'X'} account linked successfully.`
                    });
                    // Reload profile to show connected account
                    setTimeout(() => {
                        loadProfile(walletAddress, { force: true });
                    }, 250);
                }
            }

            async function handleSocialConnect(provider) {
                setOAuthNotice(null);
                try {
                    const oauthIntegration = await waitForOAuthIntegration();
                    if (!oauthIntegration) throw new Error('Social linking is still loading. Please try again.');
                    // Open the wallet modal on tap when not connected, then
                    // continue linking on this same page — no error toast.
                    const walletAddress = getActiveWalletAddress() || await window.ensureWalletConnected?.() || '';
                    if (!walletAddress) return;
                    if (provider === 'discord') {
                        await oauthIntegration.connectDiscord(walletAddress);
                    } else {
                        await oauthIntegration.connectTwitter(walletAddress);
                    }
                } catch (error) {
                    setOAuthNotice({
                        type: 'error',
                        message: error?.message || 'Social account linking could not start.'
                    });
                }
            }

            async function handleSocialDisconnect(provider) {
                setOAuthNotice(null);
                try {
                    const oauthIntegration = await waitForOAuthIntegration();
                    if (!oauthIntegration) throw new Error('Social linking is still loading. Please try again.');
                    const walletAddress = getActiveWalletAddress() || await window.ensureWalletConnected?.() || '';
                    if (!walletAddress) return;
                    const result = await oauthIntegration.disconnect(provider, walletAddress);
                    setProfile(result.profile || {
                        ...profile,
                        ...(provider === 'discord'
                            ? { discord_id: null, discord_username: null }
                            : { twitter_id: null, twitter_username: null, twitter_handle: null })
                    });
                    setOAuthNotice({
                        type: 'success',
                        message: `${provider === 'discord' ? 'Discord' : 'X'} account removed.`
                    });
                } catch (error) {
                    setOAuthNotice({
                        type: 'error',
                        message: error?.message || 'The linked account could not be removed.'
                    });
                }
            }

            async function loadProfile(walletAddressOverride = null, options = {}) {
                // Check if viewing another user's profile
                const viewAddress = getViewAddress();
                const walletAddress = viewAddress || walletAddressOverride || getActiveWalletAddress();
                const normalizedAddress = walletAddress?.toLowerCase() || null;

                if (normalizedAddress && !options.force && (
                    loadedProfileAddressRef.current === normalizedAddress ||
                    loadingProfileAddressRef.current === normalizedAddress
                )) {
                    return;
                }

                const requestId = ++profileRequestRef.current;
                setArtworksLoading(true);
                if (!walletAddress) {
                    if (requestId !== profileRequestRef.current) return;
                    loadedProfileAddressRef.current = null;
                    loadingProfileAddressRef.current = null;
                    setProfile(null);
                    setMyArtworks([]);
                    setArtworksLoading(false);
                    setDiscoveryProfile(null);
                    setIsOwnProfile(false);
                    setEditMode(false);
                    setLoading(false);
                    return;
                }

                loadingProfileAddressRef.current = normalizedAddress;

                // Determine if this is the current user's profile
                const currentAddress = getActiveWalletAddress();
                const isOwn = currentAddress && currentAddress.toLowerCase() === walletAddress.toLowerCase();

                try {
                    const db = await waitForArtSoulDB();
                    if (!db) {
                        throw new Error('ArtSoulDB is not ready');
                    }

                    const [profileResult, artworksResult, genesisResult] = await Promise.allSettled([
                        db.getProfile(walletAddress),
                        fetchProfileArtworks({ wallet_address: walletAddress }, selectedGallery, db),
                        getGenesisState(walletAddress)
                    ]);
                    let profileData = profileResult.status === 'fulfilled' ? profileResult.value : null;
                    if (!profileData) {
                        profileData = {
                            wallet_address: walletAddress,
                            username: '',
                            bio: '',
                            avatar_url: '',
                            twitter_handle: '',
                            discord_username: ''
                        };
                    }

                    if (requestId !== profileRequestRef.current) return;
                    const artworkData = artworksResult.status === 'fulfilled'
                        ? artworksResult.value
                        : { items: [], corpus: [] };
                    const genesisState = genesisResult.status === 'fulfilled'
                        ? genesisResult.value
                        : { owned: false, tokenId: null, eligibilityHash: null, source: 'indexer-pending' };
                    const nextDiscoveryProfile = buildDiscoveryProfile(profileData, artworkData.corpus, genesisState);

                    setProfile(profileData);
                    setMyArtworks(artworkData.items);
                    setDiscoveryProfile(nextDiscoveryProfile);
                    setArtworksLoading(false);
                    setIsOwnProfile(Boolean(isOwn));
                    setEditMode(Boolean(isOwn && profileResult.status === 'fulfilled' && !profileResult.value));
                    loadedProfileAddressRef.current = normalizedAddress;
                } catch (error) {
                    if (requestId !== profileRequestRef.current) return;
                    console.error('Error loading profile:', error);
                }
                if (requestId !== profileRequestRef.current) return;
                if (loadingProfileAddressRef.current === normalizedAddress) {
                    loadingProfileAddressRef.current = null;
                }
                setLoading(false);
            }

            async function fetchProfileArtworks(activeProfile, galleryType = selectedGallery, dbOverride = null) {
                if (!activeProfile?.wallet_address) return { items: [], corpus: [] };

                const walletAddress = activeProfile.wallet_address;
                const db = dbOverride || await waitForArtSoulDB();
                const suppressedArtworkIds = new Set();
                const rememberSuppressedArtworks = (rows = []) => {
                    (rows.suppressed_artwork_ids || []).forEach(value => {
                        suppressedArtworkIds.add(String(value).toLowerCase());
                    });
                    return rows;
                };

                const options = galleryType === 'collected'
                    ? { owner: walletAddress, limit: 200 }
                    : { creator: walletAddress, limit: 200, ...(galleryType === 'auction' ? { view: 'auctions' } : {}) };
                const projected = rememberSuppressedArtworks(
                    await db?.getPublicProjectionArtworks?.(options) || []
                );
                const filtered = filterCanonicalProfileArtworks(projected, walletAddress, galleryType);
                const pendingIndexerArtworks = loadPendingIndexerArtworks(walletAddress, galleryType)
                    .filter(artwork => ![...artworkIdentityKeys(artwork)]
                        .some(key => suppressedArtworkIds.has(key)));
                const corpus = sortNewestFirst(mergePendingIndexerArtworks(filtered || [], pendingIndexerArtworks));
                return {
                    corpus,
                    items: corpus.filter(artwork => window.ArtSoulArtworkCard?.hasSafeMedia?.(artwork) === true)
                };
            }

            async function loadMyArtworks(profileOverride = null) {
                const requestId = ++artworksRequestRef.current;
                setArtworksLoading(true);
                const activeProfile = profileOverride || profile;

                try {
                    const result = await fetchProfileArtworks(activeProfile, selectedGallery);
                    if (requestId === artworksRequestRef.current) setMyArtworks(result.items);
                } catch (error) {
                    console.error('Error loading artworks:', error);
                    if (requestId === artworksRequestRef.current) setMyArtworks([]);
                } finally {
                    if (requestId === artworksRequestRef.current) setArtworksLoading(false);
                }
            }

            async function handleAvatarUpload(e) {
                const file = e.target.files[0];
                if (!file) return;

                // Validate file type
                if (!file.type.startsWith('image/')) {
                    alert('Please select an image file');
                    return;
                }

                // Validate file size (max 5MB)
                if (file.size > 5 * 1024 * 1024) {
                    alert('Image size must be less than 5MB');
                    return;
                }

                try {
                    // Ensure authenticated before upload
                    const isAuth = await window.ensureAuthenticated();
                    if (!isAuth) return;

                    const walletAddress = window.getCurrentWalletAddress?.();
                    const fileName = `avatar_${walletAddress}_${Date.now()}.${file.name.split('.').pop()}`;

                    // Show loading feedback
                    const originalAvatar = profile?.avatar_url;
                    setProfile({...profile, avatar_url: 'uploading...'});

                    const avatarUrl = await window.ArtSoulDB.uploadFile(file, fileName);
                    setProfile({...profile, avatar_url: avatarUrl});
                } catch (error) {
                    console.error('Error uploading avatar:', error);
                    alert('Error uploading avatar: ' + error.message);
                    // Restore original avatar on error
                    setProfile({...profile, avatar_url: originalAvatar});
                }
            }

            async function saveProfile() {
                const walletAddress = window.getCurrentWalletAddress?.() || await window.ensureWalletConnected?.();
                if (!walletAddress) return;

                try {
                    // Authenticate before saving (only once)
                    const isAuthenticated = await window.ensureAuthenticated?.();
                    if (!isAuthenticated) {
                        alert('Authentication required to save profile');
                        return;
                    }

                    const profileData = {
                        username: profile.username,
                        bio: profile.bio,
                        twitter_handle: profile.twitter_handle,
                        discord_username: profile.discord_username,
                        avatar_url: profile.avatar_url
                    };

                    if (profile.id) {
                        await window.ArtSoulDB.updateProfile(walletAddress, profileData);
                    } else {
                        const newProfile = await window.ArtSoulDB.createProfile(walletAddress, profileData);
                        setProfile(newProfile);
                    }

                    setEditMode(false);
                    alert('Profile saved!');
                } catch (error) {
                    console.error('Error saving profile:', error);
                    alert('Error saving profile: ' + error.message);
                }
            }

            function handleQuickUpload() {
                window.location.href = 'upload.html';
            }

            async function handleProfileConnect() {
                if (typeof window.safeConnectWallet === 'function') {
                    await window.safeConnectWallet();
                    return;
                }
                await window.web3Modal?.open?.();
            }

            function getTransactionActionKey(action, artwork) {
                const artworkKey = artwork?.id || artwork?.blockchain_id || artwork?.artwork_id || 'unknown';
                return `${action}:${artworkKey}`;
            }

            function beginTransactionAction(action, artwork) {
                const key = getTransactionActionKey(action, artwork);
                if (transactionActionsRef.current.has(key)) return null;

                transactionActionsRef.current.add(key);
                setTransactionActions(current => ({ ...current, [key]: true }));
                return key;
            }

            function finishTransactionAction(key) {
                if (!key) return;
                transactionActionsRef.current.delete(key);
                setTransactionActions(current => {
                    const next = { ...current };
                    delete next[key];
                    return next;
                });
            }

            function isTransactionActionPending(action, artwork) {
                return Boolean(transactionActions[getTransactionActionKey(action, artwork)]);
            }

            function getTransactionErrorMessage(error, fallback) {
                return window.ArtSoulTransactionErrors?.message?.(error, fallback) ||
                    error?.shortMessage ||
                    error?.reason ||
                    error?.message ||
                    fallback;
            }

            // ============================================
            // AUCTION MANAGEMENT FUNCTIONS
            // ============================================

            async function handleCreateAuction(artwork) {
                const actionKey = beginTransactionAction('create-auction', artwork);
                if (!actionKey) return;

                // Primary auctions support 24h / 36h / 48h only.
                const durationHours = 24;

                try {
                    // Check wallet connection
                    let provider = await window.web3Modal?.getWalletProvider();
                    if (!provider) {
                        await window.ensureWalletConnected?.();
                        provider = await window.web3Modal?.getWalletProvider();
                    }
                    if (!provider) return;

                    const walletAddress = window.getCurrentWalletAddress?.() || await window.ensureWalletConnected?.();
                    if (!walletAddress) return;

                    if (!canCreateNewAuction(artwork, walletAddress)) {
                        alert('A new primary auction is only available to the creator while the artwork is unminted and has no active auction.');
                        return;
                    }

                    // Initialize contracts through the shared ethers BrowserProvider wrapper.
                    await window.ArtSoulContracts.init(provider);

                    // Check blockchain status first
                    console.log('Checking blockchain status for artwork:', artwork.blockchain_id);
                    const blockchainArtwork = await window.ArtSoulContracts.getArtwork(artwork.blockchain_id);
                    console.log('Blockchain status:', blockchainArtwork.status);

                    // Protocol status: 0=UNMINTED, 1=AUCTION, 3=MINTED
                    if (blockchainArtwork.status === 1) {
                        // Already in AUCTION status on blockchain, just sync database
                        console.log(' Artwork already in AUCTION status on blockchain, syncing database...');
                        try {
                            await window.ArtSoulDB.updateArtwork(artwork.id, { status: 'auction' });
                        } catch (syncError) {
                            console.warn('Legacy artwork sync skipped; indexer projection remains source of truth.', syncError.message);
                        }
                        alert('Auction was already active on the blockchain. Public state will update shortly.');
                        loadMyArtworks();
                        return;
                    }

                    if (blockchainArtwork.status !== 0) {
                        // Can only create/relaunch primary auctions while artwork remains unminted.
                        const statusNames = ['UNMINTED', 'AUCTION', 'SETTLEMENT_PENDING', 'MINTED'];
                        alert(`Cannot create auction. Artwork status: ${statusNames[blockchainArtwork.status]}`);
                        return;
                    }

                    // Get current network before transaction
                    const network = await window.ArtSoulContracts.provider.getNetwork();
                    const initialChainId = Number(network.chainId);
                    console.log('Initial network:', initialChainId);

                    // Create auction on blockchain
                    console.log('Creating auction for artwork:', artwork.blockchain_id);

                    try {
                        await window.ArtSoulContracts.createAuction(
                            artwork.blockchain_id,
                            artwork.creator_value.toString(),
                            durationHours
                        );

                        // Verify network didn't change during transaction
                        const finalNetwork = await window.ArtSoulContracts.provider.getNetwork();
                        const finalChainId = Number(finalNetwork.chainId);

                        if (initialChainId !== finalChainId) {
                            throw new Error(`Network changed during transaction. Please stay on the same network and try again.`);
                        }

                        try {
                            await window.ArtSoulDB.updateArtwork(artwork.id, { status: 'auction' });
                        } catch (syncError) {
                            console.warn('Legacy artwork sync skipped; indexer projection remains source of truth.', syncError.message);
                        }

                        alert('Auction created successfully! Public state will update shortly.');
                        loadMyArtworks(); // Reload artworks
                    } catch (txError) {
                        if (txError.message.includes('network changed') || txError.code === 'NETWORK_ERROR') {
                            throw new Error('Network was changed during transaction. Please stay on the same network and try again.');
                        }
                        throw txError;
                    }
                } catch (error) {
                    console.error('Create auction failed:', error);
                    const message = getTransactionErrorMessage(error, 'The auction could not be created. Please try again.');
                    console.log('Create auction error shown to user:', message);
                    alert(`Auction could not be created: ${message}`);
                } finally {
                    finishTransactionAction(actionKey);
                }
            }

            async function handleDeleteArtwork(artwork) {
                if (!confirm(`Delete "${artwork.title}"? This cannot be undone.`)) return;

                try {
                    // Check wallet connection
                    let provider = await window.web3Modal?.getWalletProvider();
                    if (!provider) {
                        await window.ensureWalletConnected?.();
                        provider = await window.web3Modal?.getWalletProvider();
                    }
                    if (!provider) return;

                    // Verify ownership
                    const walletAddress = window.getCurrentWalletAddress?.() || await window.ensureWalletConnected?.();
                    if (!walletAddress) return;

                    if (artwork.creator_id?.toLowerCase() !== walletAddress.toLowerCase()) {
                        alert('You can only delete your own artworks');
                        return;
                    }

                    alert('Legacy artwork deletion is disabled for public testnet. On-chain/indexed artwork state remains the source of truth.');
                } catch (error) {
                    console.error('Delete failed:', error);
                    alert('Failed to delete artwork: ' + (error.message || 'Unknown error'));
                }
            }

            async function handleListForResale(artwork) {
                const actionKey = beginTransactionAction('list-resale', artwork);
                if (!actionKey) return;

                try {
                    const defaultPrice = artwork.sale_price && parseFloat(artwork.sale_price) > 0
                        ? artwork.sale_price
                        : artwork.creator_value;
                    const newPrice = prompt('Resale price (ETH):', defaultPrice || '0.01');
                    if (!newPrice) return;

                    const price = parseFloat(newPrice);
                    if (isNaN(price) || price <= 0) {
                        alert('Invalid price');
                        return;
                    }

                    // Check wallet connection
                    let provider = await window.web3Modal?.getWalletProvider();
                    if (!provider) {
                        await window.ensureWalletConnected?.();
                        provider = await window.web3Modal?.getWalletProvider();
                    }
                    if (!provider) return;

                    // Verify ownership
                    const walletAddress = window.getCurrentWalletAddress?.() || await window.ensureWalletConnected?.();
                    if (!walletAddress) return;

                    if (!canListForResale(artwork, walletAddress)) {
                        alert('Only the current owner can list this minted NFT for resale.');
                        return;
                    }

                    const tokenId = artwork.token_id || artwork.tokenId;
                    if (isZeroProtocolId(tokenId)) {
                        alert('Token ID is unavailable for resale listing.');
                        return;
                    }

                    // Initialize contracts
                    if (!window.ArtSoulContracts.marketplaceContract) {
                        await window.ArtSoulContracts.init(provider);
                    }

                    console.log('Listing NFT for resale:', tokenId);
                    await window.ArtSoulContracts.listResale(tokenId, price.toString());

                    alert('NFT listed for resale. Public state will update shortly.');
                    loadMyArtworks(); // Reload artworks
                } catch (error) {
                    console.error('Resale listing failed:', error);
                    const message = getTransactionErrorMessage(error, 'The resale listing could not be created. Please try again.');
                    console.log('Resale listing error shown to user:', message);
                    alert(`Resale listing failed: ${message}`);
                } finally {
                    finishTransactionAction(actionKey);
                }
            }

            const bgClass = isClassic ? 'bg-gray-900 text-gray-100' : 'bg-black text-cyan-100';
            const viewAddress = getViewAddress();
            const connectedWalletAddress = getActiveWalletAddress();

            if (!viewAddress && !walletStateSettled) {
                return (
                    <div className={`min-h-screen ${bgClass}`}>
                        <ProfilePageSkeleton />
                    </div>
                );
            }

            if (loading) {
                return (
                    <div className={`min-h-screen ${bgClass}`}>
                        <ProfilePageSkeleton />
                    </div>
                );
            }

            if (!viewAddress && !connectedWalletAddress) {
                return (
                    <div className={`min-h-screen ${bgClass}`}>
                        <main className="site-page-container py-12">
                            <section className="profile-connect-state max-w-xl mx-auto p-8 text-center">
                                <h1 className="text-2xl font-semibold mb-3">Connect your wallet to view your profile</h1>
                                <p className="text-sm opacity-70 mb-6">Your creator, auction, sales, and collected artwork sections will appear after connection.</p>
                                <button type="button" onClick={handleProfileConnect} className="btn-main">Connect Wallet</button>
                            </section>
                        </main>
                    </div>
                );
            }

            const profileAddress = profile?.wallet_address || viewAddress || connectedWalletAddress;
            const resolvedProfileName = getProfileDisplayName(profile, profileAddress);
            const resolvedAvatarUrl = getProfileAvatarUrl(profile);

            return (
                <div className={`min-h-screen ${bgClass} transition-all duration-500`}>
                    {/* Main Content */}
                    <main className="site-page-container profile-page-main py-8">
                        {/* Profile Header */}
                        <div className={`profile-hero ${editMode ? 'is-editing' : ''} rounded-xl p-5 mb-5 ${
                            isClassic
                                ? 'bg-gray-800/50 border border-gray-700'
                                : 'bg-gray-900/50 backdrop-blur-md border border-cyan-500/30 neon-border'
                        }`}>
                            <div className="profile-identity-layout flex items-start gap-5 flex-wrap">
                                {/* Avatar */}
                                <div className="profile-avatar-column flex-shrink-0">
                                    <div
                                        className={`profile-avatar-shell w-24 h-24 rounded-full overflow-hidden ${editMode ? 'cursor-pointer' : ''} ${
                                            isClassic
                                                ? 'bg-gray-700 border-4 border-gray-600'
                                                : 'bg-gradient-to-br from-purple-900 to-cyan-900 border-4 border-cyan-400 neon-border'
                                        }`}
                                        style={!isClassic ? {
                                            boxShadow: '0 0 20px rgba(var(--c-accent-rgb), 0.5)',
                                            animation: 'colorShift 8s ease-in-out infinite'
                                        } : {}}
                                        onClick={() => editMode && fileInputRef.current?.click()}
                                    >
                                        {resolvedAvatarUrl ? (
                                            <img src={resolvedAvatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-sm opacity-50">
                                                No Avatar
                                            </div>
                                        )}
                                    </div>
                                    {editMode && (
                                        <label className="block mt-3 text-center text-sm cursor-pointer opacity-0 hover:opacity-100 transition-opacity">
                                            <input
                                                type="file"
                                                accept="image/*,video/*"
                                                onChange={handleAvatarUpload}
                                                className="hidden"
                                                ref={fileInputRef}
                                            />
                                        </label>
                                    )}
                                </div>

                                {/* Profile Info */}
                                <div className="profile-identity-copy flex-1 min-w-0">
                                    {editMode ? (
                                        <div className="space-y-4">
                                            <input
                                                type="text"
                                                value={profile?.username || ''}
                                                onChange={(e) => setProfile({...profile, username: e.target.value})}
                                                placeholder="Your Name"
                                                className={`w-full px-4 py-3 rounded-lg text-2xl font-bold ${
                                                    isClassic
                                                        ? 'bg-gray-700 border border-gray-600 text-gray-100'
                                                        : 'bg-gray-800/50 border border-cyan-500/30 text-cyan-100'
                                                } outline-none`}
                                            />
                                            <textarea
                                                value={profile?.bio || ''}
                                                onChange={(e) => setProfile({...profile, bio: e.target.value})}
                                                placeholder="Tell us about yourself..."
                                                rows={3}
                                                className={`w-full px-4 py-3 rounded-lg ${
                                                    isClassic
                                                        ? 'bg-gray-700 border border-gray-600 text-gray-100'
                                                        : 'bg-gray-800/50 border border-cyan-500/30 text-cyan-100'
                                                } outline-none`}
                                            />
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {/* X (Twitter) OAuth */}
                                                <div className="overflow-hidden max-w-full">
                                                    {profile?.twitter_username ? (
                                                        <div className={`flex items-center justify-between px-4 py-2 rounded-lg max-w-full ${
                                                            isClassic ? 'bg-gray-700 border border-gray-600' : 'bg-cyan-900/50 border border-cyan-500/30'
                                                        }`}>
                                                            <span className="flex items-center gap-2 min-w-0 flex-1 max-w-[calc(100%-2rem)]">
                                                                <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                                                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                                                                </svg>
                                                                <span className="truncate min-w-0">@{profile.twitter_username}</span>
                                                            </span>
                                                            <button
                                                                onClick={() => handleSocialDisconnect('twitter')}
                                                                type="button"
                                                                aria-label="Remove linked X account"
                                                                className="text-red-400 hover:text-red-300 text-sm flex-shrink-0 ml-2 w-6"
                                                            >
                                                                ✕
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleSocialConnect('twitter')}
                                                            type="button"
                                                            aria-label="Link X account"
                                                            className={`w-full px-4 py-3 rounded-lg flex items-center justify-center ${
                                                                isClassic
                                                                    ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                                                                    : 'bg-cyan-900/50 hover:bg-cyan-800/50 text-cyan-300 border border-cyan-500/30'
                                                            }`}
                                                        >
                                                            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                                                                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                                                            </svg>
                                                        </button>
                                                    )}
                                                </div>
                                                {/* Discord OAuth */}
                                                <div className="overflow-hidden max-w-full">
                                                    {profile?.discord_username ? (
                                                        <div className={`flex items-center justify-between px-4 py-2 rounded-lg max-w-full ${
                                                            isClassic ? 'bg-gray-700 border border-gray-600' : 'bg-purple-900/50 border border-purple-500/30'
                                                        }`}>
                                                            <span className="flex items-center gap-2 min-w-0 flex-1 max-w-[calc(100%-2rem)]">
                                                                <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                                                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
                                                                </svg>
                                                                <span className="truncate min-w-0">{profile.discord_username.replace('#0', '')}</span>
                                                            </span>
                                                            <button
                                                                onClick={() => handleSocialDisconnect('discord')}
                                                                type="button"
                                                                aria-label="Remove linked Discord account"
                                                                className="text-red-400 hover:text-red-300 text-sm flex-shrink-0 ml-2 w-6"
                                                            >
                                                                ✕
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleSocialConnect('discord')}
                                                            type="button"
                                                            aria-label="Link Discord account"
                                                            className={`w-full px-4 py-3 rounded-lg flex items-center justify-center ${
                                                                isClassic
                                                                    ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                                                                    : 'bg-purple-900/50 hover:bg-purple-800/50 text-purple-300 border border-purple-500/30'
                                                            }`}
                                                        >
                                                            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                                                                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
                                                            </svg>
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div>
                                            <h1 className={`text-xl md:text-3xl font-bold mb-1 break-words ${
                                                isClassic ? 'text-gray-100' : ''
                                            }`}>
                                                {resolvedProfileName}
                                            </h1>
                                            {profile?.wallet_address && (
                                                <div className="flex items-center gap-2 mb-3 flex-wrap">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyAddress(profile.wallet_address)}
                                                        aria-label={addressCopied ? 'Wallet address copied' : 'Copy wallet address'}
                                                        title={addressCopied ? 'Copied' : 'Click to copy address'}
                                                        className="inline-flex items-center gap-1.5 font-mono text-xs opacity-70 hover:opacity-100 cursor-pointer bg-transparent border-0 p-0 transition-opacity"
                                                    >
                                                        <span className="break-all">
                                                            {profile.wallet_address.slice(0, 6)}...{profile.wallet_address.slice(-4)}
                                                        </span>
                                                        {addressCopied ? (
                                                            <span className="inline-flex items-center gap-1 flex-shrink-0">
                                                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                                                                <span className="not-italic">Copied</span>
                                                            </span>
                                                        ) : (
                                                            <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                                        )}
                                                    </button>
                                                    {getExplorerAddressUrl(profile.wallet_address) && (
                                                        <a
                                                            href={getExplorerAddressUrl(profile.wallet_address)}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            aria-label="View wallet on BaseScan"
                                                            title="View on BaseScan"
                                                            className={`inline-flex items-center justify-center w-6 h-6 cursor-pointer opacity-70 hover:opacity-100 transition-opacity flex-shrink-0 ${
                                                                isClassic ? 'text-gray-300' : 'text-cyan-300'
                                                            }`}
                                                        >
                                                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>
                                                        </a>
                                                    )}
                                                </div>
                                            )}
                                            <p className={`text-sm md:text-base mb-3 break-words ${
                                                isClassic ? 'text-gray-400' : 'text-purple-300'
                                            }`}>
                                                {profile?.bio || 'No bio yet'}
                                            </p>
                                            <div className="profile-social-action-row">
                                                <div className="profile-social-links flex gap-3 flex-wrap">
                                                    {profile?.twitter_handle && (
                                                        <a
                                                            href={`https://twitter.com/${profile.twitter_handle.replace('@', '')}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer hover:opacity-80 transition-opacity max-w-full ${
                                                            isClassic
                                                                ? 'bg-gray-700 text-gray-200 border border-gray-600'
                                                                : 'bg-cyan-900/50 text-cyan-300 border border-cyan-500/30 shadow-[0_0_15px_rgba(var(--c-accent-rgb),0.3)]'
                                                        }`}>
                                                            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                                                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                                                            </svg>
                                                            <span className="truncate min-w-0">@{profile.twitter_handle.replace('@', '')}</span>
                                                        </a>
                                                    )}
                                                    {profile?.discord_username && (
                                                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg max-w-full ${
                                                            isClassic
                                                                ? 'bg-gray-700 text-gray-200 border border-gray-600'
                                                                : 'bg-purple-900/50 text-purple-300 border border-purple-500/30 shadow-[0_0_15px_rgba(var(--c-accent-2-rgb),0.3)]'
                                                        }`}>
                                                            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                                                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
                                                            </svg>
                                                            <span className="truncate min-w-0">{profile.discord_username.replace('#0', '')}</span>
                                                        </div>
                                                    )}
                                                </div>
                                                {isOwnProfile && (
                                                    <div className="profile-inline-edit-action">
                                                        <button onClick={() => setEditMode(true)} className="btn-main">
                                                            Edit Profile
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            {discoveryProfile && (
                                                <div className={`profile-stat-grid mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm ${
                                                    isClassic ? 'text-gray-200' : 'text-cyan-100'
                                                }`}>
                                                    <div className={`profile-stat-card p-3 rounded-lg ${
                                                        isClassic ? 'bg-gray-700/60 border border-gray-600' : 'bg-cyan-900/20 border border-cyan-500/30'
                                                    }`}>
                                                        <div className="opacity-70 mb-1">Trust Weight</div>
                                                        <div className="text-xl font-bold">{discoveryProfile.trust.score}</div>
                                                        <div className="text-xs opacity-70">{discoveryProfile.trust.tier}</div>
                                                    </div>
                                                    <div className={`profile-stat-card p-3 rounded-lg ${
                                                        isClassic ? 'bg-gray-700/60 border border-gray-600' : 'bg-purple-900/20 border border-purple-500/30'
                                                    }`}>
                                                        <div className="opacity-70 mb-1">Genesis Status</div>
                                                        <div className="text-lg font-bold">
                                                            {discoveryProfile.genesisState.owned ? 'Genesis Holder' : 'In Progress'}
                                                        </div>
                                                        <div className="text-xs opacity-70">
                                                            {discoveryProfile.genesisProgress.completed}/{discoveryProfile.genesisProgress.total} requirements
                                                        </div>
                                                    </div>
                                                    <div className={`profile-stat-card p-3 rounded-lg ${
                                                        isClassic ? 'bg-gray-700/60 border border-gray-600' : 'bg-cyan-900/20 border border-cyan-500/30'
                                                    }`}>
                                                        <div className="opacity-70 mb-1">Discovery Influence</div>
                                                        <div className="text-xl font-bold">{discoveryProfile.trust.influenceWeight}x</div>
                                                        <div className="text-xs opacity-70">Affects ranking only, not protocol economics.</div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {oauthNotice && (
                                        <p
                                            className={`profile-oauth-notice mt-4 ${oauthNotice.type === 'error' ? 'is-error' : 'is-success'}`}
                                            role={oauthNotice.type === 'error' ? 'alert' : 'status'}
                                        >
                                            {oauthNotice.message}
                                        </p>
                                    )}

                                    {editMode && (
                                        <div className="profile-actions mt-4 flex gap-3 flex-wrap">
                                            <>
                                                <button onClick={saveProfile} className="btn-main">
                                                    Save Profile
                                                </button>
                                                <button
                                                    onClick={() => setEditMode(false)}
                                                    className={`px-6 py-2 rounded-lg font-medium ${
                                                        isClassic ? 'bg-gray-700 text-gray-300' : 'bg-gray-700 text-gray-300'
                                                    }`}
                                                >
                                                    Cancel
                                                </button>
                                            </>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Gallery Tabs */}
                        <div className={`profile-sections-nav rounded-xl p-6 mb-6 ${
                            isClassic
                                ? 'bg-gray-800/50 border border-gray-700'
                                : 'bg-gray-900/50 backdrop-blur-md border border-cyan-500/30'
                        }`}>
                            <h2 className={`text-2xl font-bold mb-4 ${
                                isClassic ? 'text-gray-100' : ''
                            }`}>
                                Profile Sections
                            </h2>
                            <div className="profile-section-tabs flex flex-wrap gap-3">
                                {GALLERY_TYPES.map(gallery => (
                                    <button
                                        key={gallery.id}
                                        onClick={() => {
                                            if (gallery.id !== selectedGallery) {
                                                setArtworksLoading(true);
                                                setSelectedGallery(gallery.id);
                                            }
                                        }}
                                        className={`px-6 py-3 rounded-lg font-medium transform hover:scale-105 transition-all ${
                                            selectedGallery === gallery.id
                                                ? isClassic
                                                    ? 'bg-gray-600 text-white'
                                                    : 'bg-gradient-to-r from-cyan-500 to-purple-500 text-white neon-border'
                                                : isClassic
                                                    ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                                    : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/50'
                                        }`}
                                    >
                                        {gallery.icon} {gallery.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Gallery Content */}
                        <div className={`profile-gallery-panel rounded-xl p-6 ${
                            isClassic
                                ? 'bg-gray-800/50 border border-gray-700'
                                : 'bg-gray-900/50 backdrop-blur-md border border-cyan-500/30'
                        }`}>
                            <div className="flex items-center justify-between mb-6">
                                <h3 className={`text-xl font-bold ${
                                    isClassic ? 'text-gray-100' : 'text-cyan-300'
                                }`}>
                                    {GALLERY_TYPES.find(g => g.id === selectedGallery)?.label}
                                </h3>
                                {!artworksLoading && (
                                    <span className={`text-sm ${
                                        isClassic ? 'text-gray-400' : 'text-purple-300'
                                    }`}>
                                        {myArtworks.length} items
                                    </span>
                                )}
                            </div>

                            <div className="profile-artwork-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3" aria-busy={artworksLoading}>
                                {artworksLoading ? (
                                    <CardGridSkeleton count={6} className="contents" />
                                ) : (
                                    <>
                                        {/* Add New is a Created Artworks action only. */}
                                        {isOwnProfile && selectedGallery === 'created' && (
                                            <button
                                                type="button"
                                                onClick={handleQuickUpload}
                                                className="artsoul-artwork-card artsoul-add-new-card text-center self-stretch"
                                                style={{ borderStyle: 'dashed', cursor: 'pointer' }}
                                                aria-label="Publish a new artwork"
                                            >
                                                <div className="artsoul-card-media">
                                                    <div className="text-center" style={{ color: 'var(--c-accent)' }}>
                                                        <div className="text-5xl leading-none mb-3" aria-hidden="true">+</div>
                                                        <div className="text-sm font-semibold">Add New</div>
                                                    </div>
                                                </div>
                                                <div className="artsoul-card-body">
                                                    <h4 className="artsoul-card-title">Publish Artwork</h4>
                                                </div>
                                            </button>
                                        )}

                                        {myArtworks.map(artwork => (
                                            <ProfileArtworkCard key={artwork.id} artwork={artwork} />
                                        ))}

                                        {myArtworks.length === 0 && (
                                            <div className="profile-empty-state col-span-full p-6 text-center text-sm opacity-70">
                                                {selectedGallery === 'created' && 'No created artworks yet.'}
                                                {selectedGallery === 'auction' && 'No live auctions right now.'}
                                                {selectedGallery === 'sold' && 'No completed sales yet.'}
                                                {selectedGallery === 'collected' && 'No collected NFTs yet.'}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    </main>
                </div>
            );
        }

        createRoot(document.getElementById('app')).render(<ProfilePage />);

        // Theme is managed by ThemeManager
