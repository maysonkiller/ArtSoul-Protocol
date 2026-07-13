import { React, createRoot } from './react-runtime.js';
import { ArtworkPageSkeleton } from './loading-skeletons.jsx';
import { getOwnerResaleEligibility } from '../features/marketplace/resale-eligibility.js';
import { classifyBidFailure } from '../features/auction/bid-error.js';
import '../../supabase-client.js';
import '../../supabase-auth.js';

const { useState, useEffect, useRef } = React;
        const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
        const WEI_PER_ETH = 1000000000000000000n;
        const MIN_ABSOLUTE_BID_INCREMENT_WEI = 10000000000000000n;
        const BID_INCREMENT_BPS = 250n;
        const BPS_DENOMINATOR = 10000n;

        function normalizeTimestampMs(value) {
            if (value instanceof Date) {
                const dateMs = value.getTime();
                return Number.isFinite(dateMs) ? dateMs : 0;
            }

            if (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()))) {
                const timestamp = Number(value);
                if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
                return timestamp > 1000000000000 ? timestamp : timestamp * 1000;
            }

            const parsed = new Date(value).getTime();
            return Number.isFinite(parsed) ? parsed : 0;
        }

        // Settlement countdown component
        function SettlementCountdown({ deadline }) {
            const [timeLeft, setTimeLeft] = useState('');
            const [isUrgent, setIsUrgent] = useState(false);

            useEffect(() => {
                const updateCountdown = () => {
                    const now = Date.now();
                    const deadlineMs = normalizeTimestampMs(deadline);
                    const diff = deadlineMs - now;

                    if (diff <= 0) {
                        setTimeLeft('EXPIRED');
                        setIsUrgent(true);
                        return;
                    }

                    const hours = Math.floor(diff / (1000 * 60 * 60));
                    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

                    setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
                    setIsUrgent(hours < 1); // Urgent if less than 1 hour
                };

                updateCountdown();
                const interval = setInterval(updateCountdown, 1000);

                return () => clearInterval(interval);
            }, [deadline]);

            return (
                <span className={isUrgent ? 'text-red-400 animate-pulse' : ''}>
                    {timeLeft}
                </span>
            );
        }

        function parseV41CompositeArtworkId(id) {
            const parts = String(id || '').split(':');
            if (parts.length !== 3 || parts[0] !== 'v41') {
                return null;
            }

            const chainId = Number(parts[1]);
            const artworkId = parts[2];
            if (!Number.isSafeInteger(chainId) || !/^\d+$/.test(artworkId)) {
                return null;
            }

            return { chainId, artworkId };
        }

        // Media Viewer Component - supports images, videos, audio, GIFs
        function MediaViewer({ media, title }) {
            const [mediaError, setMediaError] = React.useState(false);
            const [isPlaying, setIsPlaying] = React.useState(false);
            const [videoLoaded, setVideoLoaded] = React.useState(false);
            const [posterFailed, setPosterFailed] = React.useState(false);
            const [isImageFullscreen, setIsImageFullscreen] = React.useState(false);
            const mediaType = media?.type || 'unknown';
            const url = media?.url || '';
            const poster = media?.poster || '';
            const sanitizedTitle = window.ArtSoulSecurity?.sanitizeText(title) || 'Artwork';
            const isSafeMediaUrl = window.ArtSoulSecurity?.isValidStorageUrl(url);

            React.useEffect(() => {
                setMediaError(false);
                setVideoLoaded(false);
                setPosterFailed(false);
            }, [url]);

            React.useEffect(() => {
                if (!isImageFullscreen) return undefined;
                const previousOverflow = document.body.style.overflow;
                const closeOnEscape = (event) => {
                    if (event.key === 'Escape') setIsImageFullscreen(false);
                };
                document.body.style.overflow = 'hidden';
                document.addEventListener('keydown', closeOnEscape);
                return () => {
                    document.body.style.overflow = previousOverflow;
                    document.removeEventListener('keydown', closeOnEscape);
                };
            }, [isImageFullscreen]);

            const renderMediaFallback = (message = 'Media unavailable') => (
                <div className="w-full h-full flex flex-col items-center justify-center bg-black p-8 text-center">
                    <div className="text-2xl mb-3 opacity-60">{message}</div>
                    <div className="text-sm opacity-50 max-w-sm">
                        This legacy artwork record is available, but its media cannot be displayed safely.
                    </div>
                </div>
            );

            const renderFirstVideoFrame = (event) => {
                const video = event.currentTarget;
                const duration = Number(video.duration);
                if (!Number.isFinite(duration) || duration <= 0) return;
                const target = Math.min(0.1, Math.max(0, duration - 0.05));
                if (Math.abs(video.currentTime - target) < 0.01) return;
                try {
                    video.currentTime = target;
                } catch {
                    // The poster remains visible when early seeking is unavailable.
                }
            };

            if (!isSafeMediaUrl || mediaError) {
                return renderMediaFallback();
            }

            if (mediaType === 'unknown') {
                return <div className="artsoul-media-loading" role="status" aria-label="Loading media"></div>;
            }

            if (mediaType === 'video') {
                return (
                    <div className="artwork-detail-video-shell">
                        <video
                            src={url}
                            controls
                            loop
                            playsInline
                            preload="metadata"
                            poster={poster || undefined}
                            className="artwork-detail-media-object artwork-detail-video"
                            style={{ visibility: videoLoaded ? 'visible' : 'hidden' }}
                            onLoadedMetadata={(event) => {
                                renderFirstVideoFrame(event);
                                // iOS/mobile browsers with preload="metadata" never fire
                                // loadeddata before playback starts, so metadata must
                                // already reveal the (tappable) player.
                                setVideoLoaded(true);
                            }}
                            onLoadedData={() => setVideoLoaded(true)}
                            onError={() => setMediaError(true)}
                        >
                            Your browser does not support video playback.
                        </video>
                        {!videoLoaded && <div className="artsoul-media-loading" role="status" aria-label="Loading media"></div>}
                        {poster && !posterFailed && !videoLoaded && (
                            <img
                                src={poster}
                                alt=""
                                className="artsoul-video-poster"
                                onError={() => setPosterFailed(true)}
                            />
                        )}
                    </div>
                );
            }

            if (mediaType === 'audio') {
                return (
                    <div className="artwork-detail-audio">
                        <div className="artwork-detail-audio-visual">
                            <div className="artwork-detail-audio-logo-wrap">
                                <img
                                    src="ARTSOULlogo.png"
                                    alt="Music"
                                    className={`artwork-detail-audio-logo ${isPlaying ? 'is-playing' : ''}`}
                                />
                            </div>
                        </div>
                        <div className="artwork-detail-audio-controls">
                            <audio
                                src={url}
                                controls
                                preload="metadata"
                                crossOrigin="anonymous"
                                onPlay={() => setIsPlaying(true)}
                                onPause={() => setIsPlaying(false)}
                                onEnded={() => setIsPlaying(false)}
                                onError={() => setMediaError(true)}
                                className="artwork-detail-audio-player"
                            >
                                Your browser does not support audio playback.
                            </audio>
                        </div>
                    </div>
                );
            }

            // Images and GIFs share the same aspect-safe artwork surface and fullscreen control.
            return (
                <div className="artwork-detail-image-shell">
                    <img
                        src={url}
                        alt={sanitizedTitle}
                        className="artwork-detail-media-object artwork-detail-image artwork-detail-image-zoomable"
                        role="button"
                        tabIndex="0"
                        aria-label="View artwork full size"
                        onClick={() => setIsImageFullscreen(true)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setIsImageFullscreen(true);
                            }
                        }}
                        onError={() => setMediaError(true)}
                    />
                    {isImageFullscreen && window.ReactDOM?.createPortal?.(
                        <div
                            className="artwork-image-lightbox"
                            role="dialog"
                            aria-modal="true"
                            aria-label={`${sanitizedTitle} full-size view`}
                            onClick={() => setIsImageFullscreen(false)}
                        >
                            <button
                                type="button"
                                className="artwork-image-lightbox-close"
                                aria-label="Close full-size artwork view"
                                onClick={() => setIsImageFullscreen(false)}
                            >
                                ×
                            </button>
                            <img src={url} alt={sanitizedTitle} className="artwork-image-lightbox-media" />
                        </div>,
                        document.body
                    )}
                </div>
            );
        }

        function TransactionProcessingLabel() {
            return (
                <span className="inline-flex items-center justify-center gap-2">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true"></span>
                    Processing...
                </span>
            );
        }

        function ArtworkPage() {
            const [theme, setTheme] = useState('classic');
            const [artwork, setArtwork] = useState(null);
            const [auction, setAuction] = useState(null);
            const [creatorProfile, setCreatorProfile] = useState(null);
            const [auctionWinnerProfile, setAuctionWinnerProfile] = useState(null);
            const [currentOwnerProfile, setCurrentOwnerProfile] = useState(null);
            const [loading, setLoading] = useState(true);
            const [error, setError] = useState(null);
            const [bidAmount, setBidAmount] = useState('');
            const [bidActivity, setBidActivity] = useState([]);
            const [bidderProfiles, setBidderProfiles] = useState({});
            const [moderationAccess, setModerationAccess] = useState(null);
            const [moderationReason, setModerationReason] = useState('');
            const [moderationBusy, setModerationBusy] = useState(false);
            const [moderationMessage, setModerationMessage] = useState('');
            const [walletRenderState, setWalletRenderState] = useState(() => ({
                settled: window.artsoulWalletStateSettled === true,
                address: window.artsoulSettledWalletState?.address || window.currentWalletAddress || null,
                chainId: Number(window.getCurrentChainId?.(window.artsoulSettledWalletState) || 0)
            }));
            const [timeLeft, setTimeLeft] = useState('');
            const [userVote, setUserVote] = useState(null);
            const [votes, setVotes] = useState([]);
            const [interactionState, setInteractionState] = useState({
                like: false,
                would_buy: false,
                watching: false
            });
            const [socialSignals, setSocialSignals] = useState({
                likes: 0,
                wouldBuy: 0,
                watching: 0
            });
            const [aiGuidance, setAiGuidance] = useState(null);
            const [newAuctionPrice, setNewAuctionPrice] = useState('');
            const [newAuctionDuration, setNewAuctionDuration] = useState(24);
            const [isNewAuctionModalOpen, setIsNewAuctionModalOpen] = useState(false);
            const [reauctionEstimateState, setReauctionEstimateState] = useState('idle');
            const [reauctionEstimate, setReauctionEstimate] = useState(null);
            const [isResaleModalOpen, setIsResaleModalOpen] = useState(false);
            const [resaleModalPrice, setResaleModalPrice] = useState('');
            const [resaleModalError, setResaleModalError] = useState('');
            const [resaleModalStepLabel, setResaleModalStepLabel] = useState('');
            const [withdrawalState, setWithdrawalState] = useState({
                status: 'idle',
                amount: '0',
                message: ''
            });
            const [confirmedResaleListing, setConfirmedResaleListing] = useState(false);
            const bidPollInFlightRef = useRef(false);
            const bidCursorRef = useRef(null);
            const bidderProfileCacheRef = useRef(new Map());
            const transactionActionsRef = useRef(new Set());
            const reauctionValuationControllerRef = useRef(null);
            const [transactionActions, setTransactionActions] = useState({});

            const isClassic = theme === 'classic';
            const artworkId = new URLSearchParams(window.location.search).get('id');
            const v41CompositeId = parseV41CompositeArtworkId(artworkId);
            const isV41CompositeId = Boolean(v41CompositeId);
            const connectedWalletAddress = walletRenderState.address || window.currentWalletAddress || window.getCurrentWalletAddress?.();

            function beginTransactionAction(action) {
                if (transactionActionsRef.current.has(action)) return false;

                transactionActionsRef.current.add(action);
                setTransactionActions(current => ({ ...current, [action]: true }));
                return true;
            }

            function finishTransactionAction(action) {
                transactionActionsRef.current.delete(action);
                setTransactionActions(current => {
                    const next = { ...current };
                    delete next[action];
                    return next;
                });
            }

            function isTransactionActionPending(action) {
                return Boolean(transactionActions[action]);
            }

            function getTransactionErrorMessage(error, fallback) {
                return window.ArtSoulTransactionErrors?.message?.(error, fallback) ||
                    error?.shortMessage ||
                    error?.reason ||
                    error?.message ||
                    fallback;
            }

            function getArtworkWriteChainId() {
                const explicitChainId = Number(
                    artwork?.chain_id || artwork?.chainId || v41CompositeId?.chainId || 0
                );
                if (Number.isSafeInteger(explicitChainId) && explicitChainId > 0) return explicitChainId;
                if (artwork?.network === 'baseSepolia') return 84532;
                if (artwork?.network === 'sepolia') return 11155111;
                return null;
            }

            function ensureArtworkWriteEnabled() {
                const artworkChainId = getArtworkWriteChainId();
                const legacyNetwork = artwork?.network === 'sepolia' || artworkChainId === 11155111;
                if (legacyNetwork || (!artworkChainId && artwork?.network !== 'baseSepolia')) {
                    alert('This artwork is on a legacy network. On-chain actions are disabled for now.');
                    return false;
                }
                return true;
            }

            function requiredDepositForBidWei(value) {
                const bidWei = parseEthToWei(value);
                if (!bidWei || bidWei <= 0n) return 0n;
                const percentageDeposit = (bidWei * 1000n + 9999n) / 10000n;
                const minimumDeposit = 10000000000000000n;
                return percentageDeposit > minimumDeposit ? percentageDeposit : minimumDeposit;
            }

            function releasedDepositCreditWei(walletAddress = connectedWalletAddress) {
                const normalizedWallet = String(walletAddress || '').toLowerCase();
                if (!normalizedWallet) return 0n;

                const userBids = bidActivity.filter(bid =>
                    String(bid.bidder || '').toLowerCase() === normalizedWallet
                );
                let releasedTotal = userBids.reduce(
                    (total, bid) => total + requiredDepositForBidWei(bid.bid_amount),
                    0n
                );

                if (isSameAddress(getAuctionHighestBidder(auction), walletAddress) && userBids.length > 0) {
                    releasedTotal -= requiredDepositForBidWei(userBids[0].bid_amount);
                }

                return releasedTotal > 0n ? releasedTotal : 0n;
            }

            async function loadPendingWithdrawal() {
                if (!walletRenderState.settled || !connectedWalletAddress || releasedDepositCreditWei() === 0n) {
                    setWithdrawalState(current => current.status === 'success'
                        ? current
                        : { status: 'idle', amount: '0', message: '' });
                    return;
                }

                try {
                    const provider = await window.web3Modal?.getWalletProvider();
                    if (!provider || !window.ArtSoulContracts) return;
                    await window.ArtSoulContracts.init(provider);
                    const amount = await window.ArtSoulContracts.getPendingWithdrawal(connectedWalletAddress);
                    setWithdrawalState({ status: 'ready', amount: String(amount || '0'), message: '' });
                } catch (error) {
                    console.warn('Could not load withdrawable deposit balance:', error);
                }
            }

            async function handleWithdrawDeposit() {
                if (!ensureArtworkWriteEnabled()) return;
                if (!beginTransactionAction('withdraw-deposit')) return;

                try {
                    let provider = await window.web3Modal?.getWalletProvider();
                    if (!provider) {
                        await window.ensureWalletConnected?.();
                        provider = await window.web3Modal?.getWalletProvider();
                    }
                    if (!provider) throw new Error('Connect your wallet before withdrawing.');
                    await window.ArtSoulContracts.init(provider);

                    const available = await window.ArtSoulContracts.getPendingWithdrawal(connectedWalletAddress);
                    if (!parseEthToWei(available)) {
                        setWithdrawalState({
                            status: 'success',
                            amount: '0',
                            message: 'No deposit balance remains to withdraw.'
                        });
                        return;
                    }

                    await window.ArtSoulContracts.withdraw();
                    setWithdrawalState({
                        status: 'success',
                        amount: '0',
                        message: 'Deposit balance withdrawn successfully.'
                    });
                } catch (error) {
                    const message = getTransactionErrorMessage(
                        error,
                        'The deposit balance could not be withdrawn. Please try again.'
                    );
                    setWithdrawalState(current => ({
                        ...current,
                        status: 'error',
                        message: `Withdrawal failed: ${message}`
                    }));
                } finally {
                    finishTransactionAction('withdraw-deposit');
                }
            }

            async function confirmAuctionAction(message, title = 'Confirm Auction Action') {
                const confirmation = window.ArtSoulModal?.confirm
                    ? window.ArtSoulModal.confirm(message, title)
                    : window.confirm(message);
                return Boolean(await confirmation);
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
                const syncWalletRenderState = (event) => {
                    const detail = event?.detail || window.artsoulSettledWalletState || {};
                    setWalletRenderState({
                        settled: window.artsoulWalletStateSettled === true,
                        address: detail.isConnected === false ? null : (detail.address || window.currentWalletAddress || null),
                        chainId: Number(window.getCurrentChainId?.(detail, window.artsoulSettledWalletState) || 0)
                    });
                };

                if (window.artsoulWalletStateSettled === true) {
                    syncWalletRenderState();
                }
                window.addEventListener('artsoul:wallet-state-changed', syncWalletRenderState);
                return () => window.removeEventListener('artsoul:wallet-state-changed', syncWalletRenderState);
            }, []);

            useEffect(() => {
                if (!isNewAuctionModalOpen) return undefined;
                const previousOverflow = document.body.style.overflow;
                document.body.style.overflow = 'hidden';
                const closeOnEscape = event => {
                    if (event.key === 'Escape' && !transactionActionsRef.current.has('create-auction')) {
                        reauctionValuationControllerRef.current?.abort();
                        setIsNewAuctionModalOpen(false);
                    }
                };
                window.addEventListener('keydown', closeOnEscape);
                return () => {
                    window.removeEventListener('keydown', closeOnEscape);
                    document.body.style.overflow = previousOverflow;
                };
            }, [isNewAuctionModalOpen]);

            useEffect(() => () => reauctionValuationControllerRef.current?.abort(), []);

            useEffect(() => {
                if (!isResaleModalOpen) return undefined;
                const previousOverflow = document.body.style.overflow;
                document.body.style.overflow = 'hidden';
                const closeOnEscape = event => {
                    if (event.key === 'Escape' && !transactionActionsRef.current.has('resale-list')) {
                        setIsResaleModalOpen(false);
                    }
                };
                window.addEventListener('keydown', closeOnEscape);
                return () => {
                    window.removeEventListener('keydown', closeOnEscape);
                    document.body.style.overflow = previousOverflow;
                };
            }, [isResaleModalOpen]);

            useEffect(() => {
                void loadPendingWithdrawal();
            }, [
                walletRenderState.settled,
                walletRenderState.address,
                auction?.auctionId,
                auction?.highestBidder,
                bidActivity.length
            ]);

            function getAuctionHelper(name) {
                const helper = window.AuctionService?.[name];
                return typeof helper === 'function' ? helper.bind(window.AuctionService) : null;
            }

            function getAuctionActionId(artworkData = artwork, auctionData = auction) {
                const explicitAuctionId =
                    auctionData?.auctionId ||
                    artworkData?.auction_id ||
                    artworkData?.active_auction_id;
                const normalized = String(explicitAuctionId || '').trim();
                if (normalized && normalized !== '0') {
                    return normalized;
                }

                if (!isV41CompositeId) {
                    return String(artworkData?.blockchain_id || '').trim();
                }

                return '';
            }

            function hasProtocolId(value) {
                const normalized = String(value ?? '').trim().toLowerCase();
                return Boolean(normalized && normalized !== '0' && normalized !== 'none' && normalized !== 'null');
            }

            function isArtworkMinted(artworkData = artwork) {
                return Boolean(artworkData?.minted) || hasProtocolId(artworkData?.token_id || artworkData?.tokenId);
            }

            function canCreateNewAuctionForWallet(artworkData, walletAddress) {
                const creatorAddress = artworkData?.creator_id || artworkData?.creator;
                const rawStatus = String(
                    artworkData?.status || artworkData?.auction_state || artworkData?.lifecycle_state || ''
                ).toLowerCase();
                const presentationStatus = window.ArtSoulArtworkCard?.statusInfo?.(artworkData)?.key;
                const eligibleLifecycle = presentationStatus === 'ended_no_bids' ||
                    presentationStatus === 'unsettled' ||
                    rawStatus.includes('no_bid') ||
                    rawStatus.includes('default') ||
                    rawStatus.includes('unsettled');
                return isSameAddress(creatorAddress, walletAddress) &&
                    eligibleLifecycle &&
                    !isArtworkMinted(artworkData) &&
                    !hasProtocolId(artworkData?.active_auction_id || artworkData?.activeAuctionId);
            }

            function v41InteractionKey(walletAddress) {
                if (!isV41CompositeId || !walletAddress) return '';
                return `artsoul_interactions:${v41CompositeId.chainId}:${walletAddress.toLowerCase()}:${v41CompositeId.artworkId}`;
            }

            function readV41InteractionState(walletAddress) {
                try {
                    const key = v41InteractionKey(walletAddress);
                    if (!key) return { like: false, would_buy: false, watching: false };
                    const state = JSON.parse(localStorage.getItem(key) || '{}');
                    return {
                        like: Boolean(state.like),
                        would_buy: Boolean(state.would_buy),
                        watching: Boolean(state.watching)
                    };
                } catch {
                    return { like: false, would_buy: false, watching: false };
                }
            }

            function saveV41InteractionState(walletAddress, signalType) {
                const key = v41InteractionKey(walletAddress);
                if (!key) return readV41InteractionState(walletAddress);

                const state = readV41InteractionState(walletAddress);
                state[signalType] = true;
                try {
                    localStorage.setItem(key, JSON.stringify(state));
                } catch (error) {
                    console.warn('Could not persist local discovery interaction state:', error);
                }
                return state;
            }

            function normalizeAuctionTimestamp(value) {
                return normalizeTimestampMs(value);
            }

            function firstPositiveTimestamp(...values) {
                return values.find(value => normalizeTimestampMs(value) > 0);
            }

            function isAuctionEndActionAvailable(auctionData) {
                if (!auctionData) {
                    return false;
                }

                const helper = getAuctionHelper('shouldEndAuction');
                if (helper) {
                    try {
                        return Boolean(helper(auctionData));
                    } catch (error) {
                        console.warn('Auction end helper failed; using local fallback.', error.message);
                    }
                }

                if (auctionData.ended || auctionData.finalized || auctionData.settled || auctionData.defaulted) {
                    return false;
                }

                const status = String(auctionData.status || '').toLowerCase();
                if (status && status !== 'active') {
                    return false;
                }

                const state = String(auctionData.state || '').toUpperCase();
                if (state && state !== 'PRIMARY_ACTIVE' && state !== 'AUCTION') {
                    return false;
                }

                const endTime = normalizeAuctionTimestamp(auctionData.endTime);
                return endTime > 0 && Date.now() >= endTime;
            }

            function isAuctionClosedForBidding(auctionData) {
                if (!auctionData) {
                    return false;
                }

                if (isAuctionEndActionAvailable(auctionData)) {
                    return true;
                }

                const status = String(auctionData.status || '').toLowerCase();
                const state = String(auctionData.state || '').toUpperCase();
                return Boolean(
                    auctionData.ended ||
                    auctionData.finalized ||
                    auctionData.settled ||
                    auctionData.defaulted ||
                    (status && status !== 'active') ||
                    (state && state !== 'PRIMARY_ACTIVE' && state !== 'AUCTION')
                );
            }

            function formatAuctionTimeRemaining(endTime) {
                const endTimeMs = normalizeAuctionTimestamp(endTime);
                if (!endTimeMs) {
                    return 'Syncing end time';
                }

                const helper = getAuctionHelper('formatTimeRemaining');
                if (helper) {
                    try {
                        const formatted = helper(endTime);
                        if (formatted && String(formatted).toLowerCase() !== 'unknown') {
                            return formatted;
                        }
                    } catch (error) {
                        console.warn('Auction time helper failed; using local fallback.', error.message);
                    }
                }

                const remaining = Math.max(0, endTimeMs - Date.now());
                if (remaining <= 0) {
                    return 'Ended';
                }

                const days = Math.floor(remaining / 86400000);
                const hours = Math.floor((remaining % 86400000) / 3600000);
                const minutes = Math.floor((remaining % 3600000) / 60000);
                const seconds = Math.floor((remaining % 60000) / 1000);

                if (days > 0) {
                    return `${days}d ${hours}h ${minutes}m`;
                }
                if (hours > 0) {
                    return `${hours}h ${minutes}m ${seconds}s`;
                }
                if (minutes > 0) {
                    return `${minutes}m ${seconds}s`;
                }
                return `${seconds}s`;
            }

            function isZeroAddress(address) {
                return !address || String(address).toLowerCase() === ZERO_ADDRESS;
            }

            function isSameAddress(left, right) {
                return Boolean(left && right && String(left).toLowerCase() === String(right).toLowerCase());
            }

            function getDefaultProfileAvatar(address) {
                return `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(address || 'artsoul')}`;
            }

            function getProfileDisplayName(profileData, address = '') {
                const resolver = window.ArtSoulProfileDisplay?.displayName || window.ArtSoulDB?.displayName;
                const fallbackAddress = address || profileData?.wallet_address || '';
                const fallbackName = fallbackAddress
                    ? `${fallbackAddress.slice(0, 6)}...${fallbackAddress.slice(-4)}`
                    : 'Unknown';
                return resolver?.(profileData, fallbackAddress) || fallbackName;
            }

            function getProfileAvatarUrl(profileData, address = '') {
                const fallbackAvatar = getDefaultProfileAvatar(address || profileData?.wallet_address || 'artsoul');
                const resolver = window.ArtSoulProfileDisplay?.avatarUrl || window.ArtSoulDB?.avatarUrl;
                return resolver?.(profileData, fallbackAvatar) || fallbackAvatar;
            }

            function renderOwnershipRole({ label, address, profile }) {
                if (!address || isZeroAddress(address)) return null;

                const roleCardStyle = !isClassic ? {
                    boxShadow: '0 0 15px rgba(var(--c-accent-rgb), 0.2)',
                    border: '1px solid rgba(var(--c-accent-rgb), 0.3)',
                    animation: 'glow-pulse 3s ease-in-out infinite'
                } : {};

                const avatarStyle = !isClassic ? {
                    boxShadow: '0 0 10px rgba(var(--c-accent-rgb), 0.5)',
                    animation: 'colorShift 8s ease-in-out infinite'
                } : {};

                const nameStyle = !isClassic ? {
                    background: 'linear-gradient(90deg, var(--c-accent), var(--c-accent-2))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    animation: 'colorShift 8s ease-in-out infinite'
                } : {};

                return (
                    <div className="artwork-ownership-row flex w-full items-center gap-3">
                        <a
                            href={`profile.html?address=${encodeURIComponent(address)}`}
                            className={`artwork-ownership-profile flex w-full items-center gap-3 flex-1 min-w-0 p-3 rounded-lg transition-all ${
                                isClassic ? 'hover:bg-gray-700/50' : 'hover:bg-cyan-900/30'
                            }`}
                            style={roleCardStyle}
                        >
                            <img
                                src={getProfileAvatarUrl(profile, address)}
                                alt={label}
                                className={`w-12 h-12 rounded-full border-2 flex-shrink-0 ${
                                    isClassic ? 'border-current' : 'border-cyan-400'
                                }`}
                                style={avatarStyle}
                            />
                            <div className="min-w-0 flex-1">
                                <div className={`text-xs ${isClassic ? 'opacity-70' : 'opacity-90'}`}>{label}</div>
                                <div className="font-semibold truncate" style={nameStyle}>
                                    {getProfileDisplayName(profile, address)}
                                </div>
                            </div>
                        </a>
                    </div>
                );
            }

            function firstDefined(...values) {
                return values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
            }

            function parseEthToWei(value) {
                if (value === undefined || value === null || value === '') return null;
                if (typeof value === 'bigint') return value;

                const raw = String(value).trim();
                if (!raw || raw === 'NaN') return null;

                // Contract/API values are normally ETH decimals, but raw wei strings can appear in fallbacks.
                if (/^\d+$/.test(raw) && raw.length > 15) {
                    return BigInt(raw);
                }

                if (!/^\d+(\.\d+)?$/.test(raw)) return null;

                const [whole, fraction = ''] = raw.split('.');
                const paddedFraction = (fraction + '0'.repeat(18)).slice(0, 18);
                return BigInt(whole || '0') * WEI_PER_ETH + BigInt(paddedFraction || '0');
            }

            function formatWeiToEth(wei, maxDecimals = 6) {
                if (wei === undefined || wei === null) return '0';
                const value = typeof wei === 'bigint' ? wei : BigInt(String(wei));
                const whole = value / WEI_PER_ETH;
                const fraction = value % WEI_PER_ETH;
                if (fraction === 0n) return whole.toString();

                const fractionText = fraction.toString().padStart(18, '0').slice(0, maxDecimals).replace(/0+$/, '');
                return fractionText ? `${whole}.${fractionText}` : whole.toString();
            }

            function getAuctionHighestBidWei(auctionData) {
                return parseEthToWei(firstDefined(
                    auctionData?.highestBid,
                    auctionData?.currentBid,
                    auctionData?.highest_bid,
                    auctionData?.current_bid
                )) || 0n;
            }

            function getAuctionStartingBidWei(auctionData) {
                return parseEthToWei(firstDefined(
                    auctionData?.startingPrice,
                    auctionData?.startPrice,
                    auctionData?.start_price,
                    auctionData?.creator_value
                )) || 0n;
            }

            function getAuctionHighestBidder(auctionData) {
                return firstDefined(
                    auctionData?.highestBidder,
                    auctionData?.current_bidder,
                    auctionData?.highest_bidder,
                    auctionData?.auctionWinner,
                    auctionData?.winner
                );
            }

            function projectedAuctionFromArtwork(projection) {
                const auctionId = firstDefined(projection?.auction_id, projection?.active_auction_id);
                if (!projection || !auctionId) return null;

                const projectionStatus = String(projection.status || '').toLowerCase();
                const remainsActive = projectionStatus === 'auction' || projectionStatus === 'awaiting_end';
                const stateByStatus = {
                    auction: 'PRIMARY_ACTIVE',
                    awaiting_end: 'PRIMARY_ACTIVE',
                    settlement_pending: 'WAITING_PAYMENT',
                    sold: 'SOLD',
                    defaulted: 'DEFAULTED'
                };

                return {
                    auctionId,
                    artworkId: projection.artwork_id || projection.blockchain_id,
                    seller: projection.creator_id || projection.creator,
                    startingPrice: firstDefined(projection.start_price, projection.creator_value, '0'),
                    startPrice: firstDefined(projection.start_price, projection.creator_value, '0'),
                    highestBid: firstDefined(projection.highest_bid, projection.current_bid, '0'),
                    currentBid: firstDefined(projection.current_bid, projection.highest_bid, '0'),
                    highestBidder: projection.current_bidder || ZERO_ADDRESS,
                    current_bidder: projection.current_bidder || ZERO_ADDRESS,
                    endTime: firstPositiveTimestamp(
                        projection.auction_end_time,
                        projection.end_time,
                        projection.endTime,
                        projection.auction?.end_time,
                        projection.auction?.endTime
                    ),
                    status: remainsActive ? 'active' : projectionStatus,
                    state: stateByStatus[projectionStatus] || String(projectionStatus || 'registered').toUpperCase(),
                    ended: !remainsActive && projectionStatus !== 'registered',
                    settled: projectionStatus === 'sold',
                    defaulted: projectionStatus === 'defaulted',
                    winnerDeadline: projection.settlement_deadline,
                    depositAmount: 0
                };
            }

            function mergeProjectedAuction(currentAuction, projection) {
                const projectedAuction = projectedAuctionFromArtwork(projection);
                if (!projectedAuction) return currentAuction;
                if (!currentAuction) return projectedAuction;

                const projectedBidWei = parseEthToWei(projectedAuction.highestBid) || 0n;
                const currentBidWei = getAuctionHighestBidWei(currentAuction);
                const projectionHasLatestBid = projectedBidWei >= currentBidWei;

                return {
                    ...projectedAuction,
                    ...currentAuction,
                    status: projectedAuction.status,
                    state: projectedAuction.state,
                    ended: projectedAuction.ended,
                    settled: projectedAuction.settled,
                    defaulted: projectedAuction.defaulted,
                    endTime: projectedAuction.endTime || currentAuction.endTime,
                    winnerDeadline: projectedAuction.winnerDeadline || currentAuction.winnerDeadline,
                    highestBid: projectionHasLatestBid ? projectedAuction.highestBid : currentAuction.highestBid,
                    currentBid: projectionHasLatestBid ? projectedAuction.currentBid : currentAuction.currentBid,
                    highestBidder: projectionHasLatestBid ? projectedAuction.highestBidder : currentAuction.highestBidder,
                    current_bidder: projectionHasLatestBid ? projectedAuction.current_bidder : currentAuction.current_bidder
                };
            }

            async function hydrateBidderProfiles(bids) {
                const addresses = [...new Set((bids || [])
                    .map(bid => String(bid.bidder || '').toLowerCase())
                    .filter(Boolean))];
                const missingAddresses = addresses.filter(address => !bidderProfileCacheRef.current.has(address));

                if (missingAddresses.length > 0) {
                    await Promise.all(missingAddresses.map(async address => {
                        try {
                            const profile = await window.ArtSoulDB.getProfile(address);
                            bidderProfileCacheRef.current.set(address, profile || null);
                        } catch (error) {
                            console.warn('Could not load bidder profile:', error);
                            bidderProfileCacheRef.current.set(address, null);
                        }
                    }));
                }

                setBidderProfiles(current => {
                    const next = { ...current };
                    addresses.forEach(address => {
                        next[address] = bidderProfileCacheRef.current.get(address) || null;
                    });
                    return next;
                });
            }

            function bidIdentity(bid) {
                return `${bid?.transaction_hash || ''}:${Number(bid?.block_number || 0)}:${Number(bid?.log_index || 0)}`;
            }

            function advanceBidCursor(bids) {
                for (const bid of bids || []) {
                    const block = Number(bid?.block_number || 0);
                    const log = Number(bid?.log_index || 0);
                    const cursor = bidCursorRef.current;
                    if (!cursor || block > cursor.block || (block === cursor.block && log > cursor.log)) {
                        bidCursorRef.current = { block, log };
                    }
                }
            }

            async function applyLiveAuctionProjection(projection) {
                const nextBids = Array.isArray(projection?.bids)
                    ? [...projection.bids].sort((left, right) => {
                        const blockDelta = Number(right.block_number || 0) - Number(left.block_number || 0);
                        if (blockDelta) return blockDelta;
                        const logDelta = Number(right.log_index || 0) - Number(left.log_index || 0);
                        if (logDelta) return logDelta;
                        return normalizeTimestampMs(right.indexed_at) - normalizeTimestampMs(left.indexed_at);
                    })
                    : [];
                advanceBidCursor(nextBids);
                setBidActivity(nextBids);
                setAuction(current => mergeProjectedAuction(current, projection));
                await hydrateBidderProfiles(nextBids);
            }

            // Live polling hits the light cursor endpoint (new bids only), not the
            // full projection — the projection is only fetched on page load.
            async function refreshLiveBidActivity() {
                if (!isV41CompositeId || bidPollInFlightRef.current) return;

                const auctionActionId = getAuctionActionId();
                if (!auctionActionId) return;

                bidPollInFlightRef.current = true;
                try {
                    const cursor = bidCursorRef.current;
                    const live = await window.ArtSoulDB.getLiveAuctionActivity({
                        chain_id: artwork?.chain_id,
                        auction_id: auctionActionId,
                        after_block: cursor ? cursor.block : undefined,
                        after_log: cursor ? cursor.log : undefined
                    });
                    if (!live) return;

                    const newBids = Array.isArray(live.bids) ? live.bids : [];
                    if (newBids.length > 0) {
                        advanceBidCursor(newBids);
                        setBidActivity(current => {
                            const seen = new Set(current.map(bidIdentity));
                            return [...newBids.filter(bid => !seen.has(bidIdentity(bid))), ...current];
                        });
                        await hydrateBidderProfiles(newBids);
                    }
                    if (live.auction) {
                        setAuction(current => mergeProjectedAuction(current, live.auction));
                    }
                } catch (error) {
                    console.warn('Could not refresh live bid activity:', error);
                } finally {
                    bidPollInFlightRef.current = false;
                }
            }

            function getBidderDisplayName(address) {
                const profile = bidderProfiles[String(address || '').toLowerCase()] || null;
                return getProfileDisplayName(profile, address);
            }

            function formatBidTime(bid) {
                const timestamp = normalizeTimestampMs(
                    bid?.indexed_at || bid?.timestamp || bid?.created_at || bid?.createdAt
                );
                if (!timestamp) return '';

                return new Intl.DateTimeFormat('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                }).format(timestamp);
            }

            function getTokenExplorerUrl(artworkData) {
                const tokenId = artworkData?.token_id || artworkData?.tokenId;
                if (!tokenId) return '';

                const chainId = Number(artworkData?.chain_id || artworkData?.chainId || 0);
                const networkKey = chainId === 11155111 ? 'sepolia' : chainId === 84532 ? 'baseSepolia' : '';
                const nftAddress = networkKey ? window.ARTSOUL_CONTRACTS?.[networkKey]?.nft : '';
                if (!nftAddress) return '';

                const explorer = networkKey === 'sepolia'
                    ? 'https://sepolia.etherscan.io'
                    : 'https://sepolia.basescan.org';
                return `${explorer}/token/${encodeURIComponent(nftAddress)}?a=${encodeURIComponent(tokenId)}`;
            }

            async function loadModerationVisibility(projection = artwork, options = {}) {
                if (!projection?.chain_id || !projection?.artwork_id) return false;

                if (options.interactive) {
                    const authenticated = await window.ensureAuthenticated?.();
                    if (!authenticated) {
                        setModerationMessage('Sign in with your staff wallet to continue.');
                        return false;
                    }
                }

                try {
                    const query = new URLSearchParams({
                        chain_id: String(projection.chain_id),
                        artwork_id: String(projection.artwork_id)
                    });
                    const response = await fetch(`/api/moderation/artwork-visibility?${query}`, {
                        method: 'GET',
                        credentials: 'include'
                    });
                    const result = await response.json().catch(() => ({}));

                    if (!response.ok) {
                        if (options.interactive) {
                            setModerationMessage(result.message || 'This wallet does not have staff moderation access.');
                        }
                        return false;
                    }

                    setModerationAccess({
                        ...result.access,
                        ...(result.data || {})
                    });
                    setModerationReason(result.data?.hidden_reason || '');
                    setModerationMessage('');
                    return true;
                } catch (error) {
                    console.warn('Could not load moderation visibility:', error);
                    if (options.interactive) {
                        setModerationMessage('Moderation controls are temporarily unavailable.');
                    }
                    return false;
                }
            }

            async function handleModerationVisibility(hidden) {
                if (!artwork?.chain_id || !artwork?.artwork_id || moderationBusy) return;
                if (hidden && !moderationReason.trim()) {
                    setModerationMessage('Add a reason before hiding this artwork.');
                    return;
                }

                const authenticated = await window.ensureAuthenticated?.();
                if (!authenticated) return;

                setModerationBusy(true);
                setModerationMessage('');
                try {
                    const response = await fetch('/api/moderation/artwork-visibility', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chain_id: artwork.chain_id,
                            artwork_id: artwork.artwork_id,
                            hidden,
                            reason: hidden ? moderationReason.trim() : null
                        })
                    });
                    const result = await response.json().catch(() => ({}));
                    if (!response.ok) {
                        throw new Error(result.message || 'Moderation update failed');
                    }

                    setModerationAccess(current => ({
                        ...(current || {}),
                        ...(result.access || {}),
                        ...(result.data || {}),
                        hidden
                    }));
                    if (!hidden) setModerationReason('');
                    setModerationMessage(hidden
                        ? 'Artwork is hidden from public surfaces.'
                        : 'Artwork is visible again where its auction state allows.');
                } catch (error) {
                    console.error('Moderation visibility update failed:', error);
                    setModerationMessage(error.message || 'Moderation update failed.');
                } finally {
                    setModerationBusy(false);
                }
            }

            function calculateMinimumBidDetails(auctionData) {
                const contractMinimumWei = parseEthToWei(firstDefined(
                    auctionData?.minimumBid,
                    auctionData?.requiredNextBid,
                    auctionData?.minimum_bid
                ));
                if (contractMinimumWei && contractMinimumWei > 0n) {
                    return { wei: contractMinimumWei, eth: formatWeiToEth(contractMinimumWei) };
                }

                const helper = getAuctionHelper('calculateMinimumBid');
                if (helper) {
                    try {
                        const helperMinimum = helper(auctionData?.highestBid, auctionData?.startingPrice);
                        const helperMinimumWei = parseEthToWei(helperMinimum);
                        if (helperMinimumWei && helperMinimumWei > 0n) {
                            return { wei: helperMinimumWei, eth: formatWeiToEth(helperMinimumWei) };
                        }
                    } catch (error) {
                        console.warn('Minimum bid helper failed; using local fallback.', error.message);
                    }
                }

                const currentBidWei = getAuctionHighestBidWei(auctionData);
                if (currentBidWei > 0n) {
                    const absoluteIncrement = currentBidWei + MIN_ABSOLUTE_BID_INCREMENT_WEI;
                    const percentIncrement = (currentBidWei * (BPS_DENOMINATOR + BID_INCREMENT_BPS) + (BPS_DENOMINATOR - 1n)) / BPS_DENOMINATOR;
                    const minimumWei = absoluteIncrement > percentIncrement ? absoluteIncrement : percentIncrement;
                    return { wei: minimumWei, eth: formatWeiToEth(minimumWei) };
                }

                const startingBidWei = getAuctionStartingBidWei(auctionData);
                return { wei: startingBidWei, eth: formatWeiToEth(startingBidWei) };
            }

            function calculateMinimumBidSafe(auctionData) {
                return Number(calculateMinimumBidDetails(auctionData).eth || 0);
            }

            function friendlyMinimumBidMessage(minimumBidDetails) {
                const minimumEth = minimumBidDetails?.eth || '0';
                return `Your bid is below the minimum. The minimum next bid is ${minimumEth} ETH.`;
            }

            function validateBidAmountSafe(amount, minimumBidDetails) {
                const helper = getAuctionHelper('validateBidAmount');
                if (helper) {
                    try {
                        const validation = helper(amount, minimumBidDetails?.eth || minimumBidDetails);
                        if (validation) {
                            return validation.valid
                                ? validation
                                : { valid: false, error: friendlyMinimumBidMessage(minimumBidDetails) };
                        }
                    } catch (error) {
                        console.warn('Bid validation helper failed; using local fallback.', error.message);
                    }
                }

                const bidWei = parseEthToWei(amount);
                const minimumWei = minimumBidDetails?.wei ?? parseEthToWei(minimumBidDetails);
                if (!bidWei || bidWei <= 0n) {
                    return { valid: false, error: 'Enter a valid bid amount.' };
                }
                if (minimumWei && bidWei < minimumWei) {
                    return { valid: false, error: friendlyMinimumBidMessage(minimumBidDetails) };
                }
                return { valid: true };
            }

            function formatBidFailureMessage(error, context = {}) {
                const minimumBidDetails = context.minimumBidDetails || calculateMinimumBidDetails(auction);
                const isCreator = isSameAddress(context.walletAddress, context.creatorAddress);
                const isHighestBidder = isSameAddress(context.walletAddress, context.highestBidder);
                return classifyBidFailure(error, {
                    providerSource: context.providerSource,
                    minimumBidEth: minimumBidDetails?.eth || '0',
                    isCreator,
                    isHighestBidder,
                    auctionEnded: context.auctionEnded,
                    bidBelowMinimum: context.bidBelowMinimum
                }).message;
            }

            async function canPlaceBidSafe(artworkIdValue, walletAddress, creatorAddress) {
                const helper = getAuctionHelper('canPlaceBid');
                if (helper) {
                    try {
                        const result = await helper(artworkIdValue, walletAddress, creatorAddress);
                        if (result) {
                            return result;
                        }
                    } catch (error) {
                        console.warn('Bid eligibility helper failed; using local fallback.', error.message);
                    }
                }

                if (!walletAddress) {
                    return { canBid: false, reason: 'Please connect your wallet' };
                }

                if (creatorAddress && walletAddress.toLowerCase() === creatorAddress.toLowerCase()) {
                    return { canBid: false, reason: 'Creator cannot bid on own artwork' };
                }

                if (!auction || isAuctionClosedForBidding(auction)) {
                    return { canBid: false, reason: 'Auction is not active' };
                }

                return { canBid: true };
            }

            useEffect(() => {
                if (artworkId && !artwork) {
                    // Wait for ArtSoulDB to be ready
                    const checkAndLoad = async () => {
                        let attempts = 0;
                        while (!window.ArtSoulDB && attempts < 50) {
                            await new Promise(resolve => setTimeout(resolve, 100));
                            attempts++;
                        }
                        if (window.ArtSoulDB) {
                            loadArtwork();
                        } else {
                            console.error('ArtSoulDB not loaded after 5 seconds');
                            setLoading(false);
                        }
                    };
                    checkAndLoad();
                }
            }, [artworkId]);

            useEffect(() => {
                if (auction && !isAuctionClosedForBidding(auction)) {
                    updateTimeLeft();
                    const interval = setInterval(updateTimeLeft, 1000);
                    return () => clearInterval(interval);
                }
            }, [auction]);

            useEffect(() => {
                if (!auction || isAuctionClosedForBidding(auction)) return;
                const minimumBidDetails = calculateMinimumBidDetails(auction);
                if (!minimumBidDetails?.wei) return;

                setBidAmount(currentAmount => {
                    const currentWei = parseEthToWei(currentAmount);
                    if (currentWei && currentWei >= minimumBidDetails.wei) {
                        return currentAmount;
                    }
                    return minimumBidDetails.eth;
                });
            }, [auction]);

            useEffect(() => {
                if (!isV41CompositeId || !auction || isAuctionClosedForBidding(auction)) return;

                let cancelled = false;
                const poll = async () => {
                    if (cancelled) return;
                    // Fully stop network activity while the tab is in the background.
                    if (document.visibilityState !== 'visible') return;

                    const endTimeMs = normalizeAuctionTimestamp(auction.endTime);
                    if (endTimeMs > 0 && Date.now() >= endTimeMs) {
                        clearInterval(interval);
                        await refreshLiveBidActivity();
                        return;
                    }

                    await refreshLiveBidActivity();
                };
                const interval = setInterval(poll, 12000);
                const onVisibilityChange = () => {
                    if (document.visibilityState === 'visible') poll();
                };
                document.addEventListener('visibilitychange', onVisibilityChange);

                return () => {
                    cancelled = true;
                    clearInterval(interval);
                    document.removeEventListener('visibilitychange', onVisibilityChange);
                };
            }, [artworkId, isV41CompositeId, auction?.status, auction?.state, auction?.endTime]);

            async function loadArtwork() {
                try {
                    console.log('[Artwork] Loading artwork:', artworkId);
                    // Load from Supabase
                    const data = await window.ArtSoulDB.getArtwork(artworkId);
                    console.log('[Artwork] Loaded data:', data);
                    setArtwork(data);
                    setNewAuctionPrice(current => current || String(firstDefined(
                        data.start_price,
                        data.creator_value,
                        ''
                    )));
                    loadModerationVisibility(data);
                    if (isV41CompositeId) {
                        await applyLiveAuctionProjection(data);
                    } else {
                        setBidActivity([]);
                    }
                    setCreatorProfile(null);
                    setAuctionWinnerProfile(null);
                    setCurrentOwnerProfile(null);
                    setSocialSignals(window.ArtSoulDiscovery?.getSocialSignals?.(data) || {
                        likes: data.vote_count || 0,
                        wouldBuy: 0,
                        watching: 0
                    });
                    setAiGuidance(data.ai_guidance || window.ArtSoulDiscovery?.getAIGuidance?.(data) || null);

                    // Keep share previews branded; artwork-specific data stays in the page content.
                    const pageUrl = window.location.href;
                    document.getElementById('og-url').setAttribute('content', pageUrl);
                    document.title = data.title + ' - ArtSoul';

                    const profileAddresses = [...new Set([
                        data.creator_id,
                        data.auction_winner_address,
                        data.current_owner_address
                    ].filter(address => address && !isZeroAddress(address)).map(address => address.toLowerCase()))];
                    const profilesPromise = Promise.allSettled(profileAddresses.map(async address => {
                        const profile = await window.ArtSoulDB.getProfile(address);
                        return { address, profile };
                    })).then(results => {
                        const profiles = new Map();
                        results.forEach(result => {
                            if (result.status === 'fulfilled') profiles.set(result.value.address, result.value.profile);
                            else console.warn('Could not load artwork profile:', result.reason);
                        });
                        if (data.creator_id) setCreatorProfile(profiles.get(data.creator_id.toLowerCase()) || null);
                        if (data.auction_winner_address && !isZeroAddress(data.auction_winner_address)) {
                            setAuctionWinnerProfile(profiles.get(data.auction_winner_address.toLowerCase()) || null);
                        }
                        if (data.current_owner_address && !isZeroAddress(data.current_owner_address)) {
                            setCurrentOwnerProfile(profiles.get(data.current_owner_address.toLowerCase()) || null);
                        }
                    });

                    const votesPromise = (async () => {
                        if (isV41CompositeId) {
                            setVotes([]);
                            setUserVote(null);
                            return;
                        }
                        try {
                            const allVotes = await window.ArtSoulDB.getVotes(artworkId);
                            setVotes(allVotes || []);
                            setSocialSignals(current => ({
                                ...current,
                                likes: allVotes?.length || current.likes || 0
                            }));
                        } catch (error) {
                            console.warn('Could not load votes:', error);
                            setVotes([]);
                        }
                    })();

                    const walletAddress = window.getCurrentWalletAddress?.();
                    const interactionPromise = (async () => {
                        if (!walletAddress) return;
                        try {
                            const [voteResult, discoveryResult] = await Promise.allSettled([
                                isV41CompositeId
                                    ? Promise.resolve(null)
                                    : window.ArtSoulDB.getUserVote(artworkId, walletAddress),
                                isV41CompositeId
                                    ? Promise.resolve(readV41InteractionState(walletAddress))
                                    : Promise.resolve(window.ArtSoulDiscovery?.getInteractionState?.(artworkId, walletAddress))
                            ]);
                            const existingVote = voteResult.status === 'fulfilled' ? voteResult.value : null;
                            if (existingVote) setUserVote(existingVote);
                            const discoveryState = discoveryResult.status === 'fulfilled' ? discoveryResult.value : null;
                            if (discoveryState) {
                                setInteractionState(discoveryState);
                                if (isV41CompositeId && discoveryState.like) {
                                    setUserVote({
                                        artwork_id: artworkId,
                                        voter_address: walletAddress,
                                        vote_type: 'like'
                                    });
                                }
                            }
                        } catch (error) {
                            console.warn('Could not load user vote:', error);
                        }
                    })();

                    const auctionActionId = getAuctionActionId(data, null);
                    const contractPromise = (async () => {
                        if (!auctionActionId || !window.ArtSoulContracts) return;
                        try {
                            const provider = await window.web3Modal?.getWalletProvider();
                            if (!provider) return;
                            await window.ArtSoulContracts.init(provider);
                            const auctionData = await window.ArtSoulContracts.getAuction(auctionActionId);
                            if (auctionData && auctionData.seller !== '0x0000000000000000000000000000000000000000') {
                                setAuction(current => ({
                                    ...current,
                                    ...auctionData,
                                    winnerDeadline: firstPositiveTimestamp(
                                        auctionData.winnerDeadline,
                                        auctionData.winner_deadline,
                                        auctionData.settlementDeadline,
                                        auctionData.settlement_deadline,
                                        data.settlement_deadline
                                    )
                                }));
                            }
                        } catch (error) {
                            console.warn('Could not load blockchain auction data:', error);
                        }
                    })();

                    await Promise.allSettled([
                        profilesPromise,
                        votesPromise,
                        interactionPromise,
                        contractPromise
                    ]);

                    setLoading(false);
                } catch (error) {
                    console.error('Error loading artwork:', error);
                    if (error?.code === 'V41_ARTWORK_NOT_INDEXED') {
                        setError({
                            code: 'V41_ARTWORK_NOT_INDEXED',
                            artworkId: error.artwork_id || artworkId
                        });
                    } else {
                        setError(error.message || 'Failed to load artwork. The artwork may not exist or there was a database error.');
                    }
                    setLoading(false);
                }
            }

            function updateTimeLeft() {
                if (!auction || isAuctionClosedForBidding(auction)) return;

                // Use AuctionService for time calculation
                const timeRemaining = formatAuctionTimeRemaining(auction.endTime);
                setTimeLeft(timeRemaining || 'Calculating...');
            }

            async function handlePlaceBid() {
                if (!beginTransactionAction('bid')) return;

                try {
                    await placeBidOnce();
                } finally {
                    finishTransactionAction('bid');
                }
            }

            async function placeBidOnce() {
                if (!ensureArtworkWriteEnabled()) return;
                const minimumBidDetails = calculateMinimumBidDetails(auction);
                // Open the wallet modal on tap when not connected, then continue
                // the bid on this same page instead of showing a "connect" toast.
                const walletAddress = window.currentWalletAddress || window.getCurrentWalletAddress?.() || await window.ensureWalletConnected?.();
                if (!walletAddress) return;
                const creatorAddress = artwork?.creator_id || artwork?.creator;
                const highestBidder = getAuctionHighestBidder(auction);
                const bidContext = {
                    walletAddress,
                    creatorAddress,
                    highestBidder,
                    minimumBidDetails,
                    auctionEnded: isAuctionClosedForBidding(auction),
                    bidBelowMinimum: Boolean(
                        parseEthToWei(bidAmount) &&
                        minimumBidDetails?.wei &&
                        parseEthToWei(bidAmount) < minimumBidDetails.wei
                    )
                };

                if (!parseEthToWei(bidAmount) || parseEthToWei(bidAmount) <= 0n) {
                    alert('Enter a valid bid amount.');
                    return;
                }

                const auctionActionId = getAuctionActionId();
                if (!auctionActionId) {
                    alert('Auction ID is unavailable');
                    return;
                }

                if (isSameAddress(walletAddress, highestBidder) && !isZeroAddress(highestBidder)) {
                    alert("You're already the highest bidder.");
                    return;
                }

                // Use AuctionService to check if user can bid
                const { canBid, reason } = await canPlaceBidSafe(
                    artwork.blockchain_id,
                    walletAddress,
                    creatorAddress
                );

                if (!canBid) {
                    alert(formatBidFailureMessage({ message: reason || 'Cannot place bid' }, bidContext));
                    return;
                }

                // Validate bid amount
                const validation = validateBidAmountSafe(bidAmount, minimumBidDetails);
                if (!validation.valid) {
                    alert(validation.error);
                    return;
                }

                let provider = null;
                try {
                    provider = await window.web3Modal?.getWalletProvider();
                    if (!provider) {
                        await window.ensureWalletConnected?.();
                        provider = await window.web3Modal?.getWalletProvider();
                    }
                    if (!provider) return;

                    await window.ArtSoulContracts.init(provider);
                    await window.ArtSoulContracts.placeBid(auctionActionId, bidAmount);

                    alert('Bid placed successfully!');
                    await refreshLiveBidActivity();
                } catch (error) {
                    console.error('Bid failed:', error);
                    const providerSource = window.getArtSoulWalletProviderSource?.(provider) || (provider ? 'unknown' : 'missing');
                    let providerChainId = null;
                    try {
                        providerChainId = await provider?.request?.({ method: 'eth_chainId' });
                    } catch {
                        // The original transaction error remains authoritative.
                    }
                    const failureContext = {
                        ...bidContext,
                        providerSource
                    };
                    const classification = classifyBidFailure(error, {
                        providerSource,
                        minimumBidEth: minimumBidDetails?.eth || '0',
                        isCreator: isSameAddress(walletAddress, creatorAddress),
                        isHighestBidder: isSameAddress(walletAddress, highestBidder),
                        auctionEnded: bidContext.auctionEnded,
                        bidBelowMinimum: bidContext.bidBelowMinimum
                    });
                    window.ArtSoulWalletDebug?.log?.('bid failure classified', {
                        classification: classification.category,
                        connectedAddress: walletAddress,
                        providerSource,
                        chainId: providerChainId,
                        artworkCreator: creatorAddress || null,
                        currentHighestBidder: highestBidder || null,
                        auctionStatus: auction?.status || null,
                        auctionEndTime: auction?.endTime || auction?.end_time || null,
                        bidAmount,
                        requiredMinimum: minimumBidDetails?.eth || null,
                        walletBalance: document.querySelector('[data-network-balance]')?.textContent || null,
                        rpcErrorCode: classification.rpcCode ?? error?.code ?? error?.info?.error?.code ?? null,
                        revertReason: error?.reason || error?.revert?.name || null,
                        shortMessage: error?.shortMessage || null,
                        details: error?.details || error?.info?.error?.message || error?.error?.message || null,
                        cause: error?.cause?.message || null
                    });
                    const message = formatBidFailureMessage(error, failureContext);
                    console.log('Bid error shown to user:', message);
                    alert(message);
                }
            }

            async function requestFreshReauctionValuation() {
                reauctionValuationControllerRef.current?.abort();
                const controller = new AbortController();
                reauctionValuationControllerRef.current = controller;
                const timeout = setTimeout(() => controller.abort(), 20000);
                setReauctionEstimate(null);
                setReauctionEstimateState('loading');

                try {
                    const walletAddress = window.currentWalletAddress || window.getCurrentWalletAddress?.();
                    const mediaUrl = window.ArtSoulArtworkCard?.mediaUrl?.(artwork) ||
                        artwork.file_url || artwork.media_url || artwork.animation_url || '';
                    const result = await window.ArtSoulAIValuation.request({
                        title: artwork.title || '',
                        description: artwork.description || '',
                        creator_value: newAuctionPrice || artwork.start_price || artwork.creator_value || '',
                        media_type: artwork.file_type || artwork.media_type || '',
                        media_url: mediaUrl || undefined,
                        artwork_id: artwork.blockchain_id || artwork.artwork_id || artwork.id,
                        creator: walletAddress,
                        chain_id: artwork.chain_id || window.getCurrentChainId?.() || 84532,
                        like_count: socialSignals.likes || votes.length || 0,
                        would_buy_count: socialSignals.wouldBuy || 0,
                        watching_count: socialSignals.watching || 0
                    }, { signal: controller.signal, promptAuthentication: false });

                    if (reauctionValuationControllerRef.current !== controller) return;
                    setReauctionEstimate(result.valuation);
                    setReauctionEstimateState('ready');
                } catch (error) {
                    if (reauctionValuationControllerRef.current !== controller) return;
                    console.warn('[Re-auction AI Guidance] Estimate unavailable:', error);
                    setReauctionEstimateState('unavailable');
                } finally {
                    clearTimeout(timeout);
                    if (reauctionValuationControllerRef.current === controller) {
                        reauctionValuationControllerRef.current = null;
                    }
                }
            }

            function openNewAuctionModal() {
                setIsNewAuctionModalOpen(true);
                void requestFreshReauctionValuation();
            }

            function closeNewAuctionModal() {
                if (isTransactionActionPending('create-auction')) return;
                reauctionValuationControllerRef.current?.abort();
                reauctionValuationControllerRef.current = null;
                setIsNewAuctionModalOpen(false);
            }

            async function handleConfirmNewAuction() {
                if (!ensureArtworkWriteEnabled()) return;
                if (!beginTransactionAction('create-auction')) return;

                try {
                    const walletAddress = window.currentWalletAddress || window.getCurrentWalletAddress?.() || await window.ensureWalletConnected?.();
                    if (!walletAddress) return;

                    if (!canCreateNewAuctionForWallet(artwork, walletAddress)) {
                        alert('Re-auction is available only to the creator for an ended-no-bids or defaulted artwork that is unminted and has no active auction.');
                        return;
                    }

                    const startingPriceWei = parseEthToWei(newAuctionPrice);
                    if (!startingPriceWei || startingPriceWei <= 0n) {
                        alert('Enter a valid starting price greater than 0 ETH.');
                        return;
                    }

                    if (![24, 36, 48].includes(Number(newAuctionDuration))) {
                        alert('Choose a 24h, 36h, or 48h auction duration.');
                        return;
                    }

                    let provider = await window.web3Modal?.getWalletProvider();
                    if (!provider) {
                        await window.ensureWalletConnected?.();
                        provider = await window.web3Modal?.getWalletProvider();
                    }
                    if (!provider) return;

                    await window.ArtSoulContracts.init(provider);

                    const blockchainArtwork = await window.ArtSoulContracts.getArtwork(artwork.blockchain_id);
                    if (!isSameAddress(blockchainArtwork.creator, walletAddress)) {
                        throw new Error('Only the artwork creator can create a new primary auction.');
                    }
                    if (blockchainArtwork.minted || hasProtocolId(blockchainArtwork.tokenId)) {
                        throw new Error('This NFT is already minted. The current owner must use the resale flow instead.');
                    }
                    if (hasProtocolId(blockchainArtwork.activeAuctionId)) {
                        throw new Error('This artwork already has an active auction.');
                    }

                    const txHash = await window.ArtSoulContracts.createAuction(
                        artwork.blockchain_id,
                        newAuctionPrice,
                        Number(newAuctionDuration)
                    );
                    console.log('New auction transaction:', txHash);

                    await alert('New auction created successfully. Public auction data will update shortly.');
                    window.location.assign('gallery.html#auctions');
                } catch (error) {
                    console.error('Create new auction failed:', error);
                    const message = getTransactionErrorMessage(error, 'The new auction could not be created. Please try again.');
                    console.log('Create new auction error shown to user:', message);
                    alert(`New auction could not be created: ${message}`);
                } finally {
                    finishTransactionAction('create-auction');
                }
            }

            async function handleEndAuction() {
                if (!beginTransactionAction('end-auction')) return;

                try {
                    await endAuctionOnce();
                } finally {
                    finishTransactionAction('end-auction');
                }
            }

            async function endAuctionOnce() {
                if (!ensureArtworkWriteEnabled()) return;
                const confirmed = await confirmAuctionAction(
                    'Finalize this expired auction? If it has bids, the winner settlement window will open. If it has no bids, the creator can create a new auction.',
                    'End Expired Auction'
                );
                if (!confirmed) return;
                const auctionActionId = getAuctionActionId();
                if (!auctionActionId) {
                    alert('Auction ID is unavailable');
                    return;
                }

                try {
                    let provider = await window.web3Modal?.getWalletProvider();
                    if (!provider) {
                        await window.ensureWalletConnected?.();
                        provider = await window.web3Modal?.getWalletProvider();
                    }
                    if (!provider) return;

                    await window.ArtSoulContracts.init(provider);

                    // Get auction details to find the winner
                    const auctionData = await window.ArtSoulContracts.getAuction(auctionActionId);

                    // End auction on blockchain
                    await window.ArtSoulContracts.endAuction(auctionActionId);

                    // Ending the auction opens the settlement window.
                    // NFT ownership changes only after successful settlement.
                    try {
                        if (auctionData.highestBidder && auctionData.highestBidder !== '0x0000000000000000000000000000000000000000') {
                            await window.ArtSoulDB.updateArtwork(artwork.id, {
                                auction_winner_address: auctionData.highestBidder.toLowerCase(),
                                status: 'settlement_pending'
                            });
                        } else {
                            // No bids - artwork remains unminted and can be relaunched.
                            await window.ArtSoulDB.updateArtwork(artwork.id, {
                                status: 'draft'
                            });
                        }
                    } catch (syncError) {
                        console.warn('Legacy artwork sync skipped; indexer projection remains source of truth.', syncError.message);
                    }

                    const hasWinner = !isZeroAddress(auctionData.highestBidder);
                    alert(hasWinner
                        ? 'Auction ended. The winner settlement window is now open. Public state will update shortly.'
                        : 'Auction ended with no bids. The creator can create a new auction after public state updates.');
                    loadArtwork();
                } catch (error) {
                    console.error('End auction failed:', error);
                    const message = getTransactionErrorMessage(error, 'The auction could not be ended. Please try again.');
                    console.log('End auction error shown to user:', message);
                    alert(`Auction could not be ended: ${message}`);
                }
            }

            async function handleVote() {
                // Check if already voted
                if (userVote) {
                    alert('You have already voted for this artwork');
                    return;
                }

                // Check wallet connection — open the wallet modal instead of a toast.
                const walletAddress = window.currentWalletAddress || window.getCurrentWalletAddress?.() || await window.ensureWalletConnected?.();
                if (!walletAddress) return;

                try {
                    if (isV41CompositeId) {
                        const result = await window.ArtSoulDB.saveDiscoverySignal({
                            chain_id: v41CompositeId.chainId,
                            artwork_id: v41CompositeId.artworkId,
                            signal_type: 'like'
                        });
                        const nextState = saveV41InteractionState(walletAddress, 'like');

                        setUserVote({
                            artwork_id: artworkId,
                            voter_address: walletAddress,
                            vote_type: 'like'
                        });
                        setInteractionState(nextState);
                        if (!result?.alreadyRecorded) {
                            setSocialSignals(current => ({
                                ...current,
                                likes: (current.likes || votes.length || 0) + 1
                            }));
                        }
                        alert(result?.alreadyRecorded ? 'Like already saved.' : 'Vote submitted successfully!');
                        return;
                    }

                    // Simple like vote
                    await window.ArtSoulDB.saveVote({
                        artwork_id: artworkId,
                        voter_address: walletAddress
                    });

                    // Reload artwork data to update votes
                    await loadArtwork();
                    alert('Vote submitted successfully!');
                } catch (error) {
                    console.error('Vote failed:', error);
                    alert(error.message || 'Failed to submit vote');
                }
            }

            async function handleDiscoverySignal(type) {
                const walletAddress = window.currentWalletAddress || window.getCurrentWalletAddress?.() || await window.ensureWalletConnected?.();
                if (!walletAddress) return;

                try {
                    if (isV41CompositeId) {
                        const result = await window.ArtSoulDB.saveDiscoverySignal({
                            chain_id: v41CompositeId.chainId,
                            artwork_id: v41CompositeId.artworkId,
                            signal_type: type
                        });
                        const nextState = saveV41InteractionState(walletAddress, type);

                        setInteractionState(nextState);
                        if (!result?.alreadyRecorded) {
                            setSocialSignals(current => ({
                                ...current,
                                wouldBuy: type === 'would_buy' ? (current.wouldBuy || 0) + 1 : current.wouldBuy,
                                watching: type === 'watching' ? (current.watching || 0) + 1 : current.watching
                            }));
                        }
                        alert(result?.alreadyRecorded ? 'Signal already saved.' : 'Discovery signal saved.');
                        return;
                    }

                    const result = await window.ArtSoulDiscovery.recordSignal(type, artworkId, walletAddress);
                    setInteractionState(result.state);

                    if (!result.alreadyRecorded && result.persisted) {
                        setSocialSignals(current => ({
                            ...current,
                            wouldBuy: type === 'would_buy' ? (current.wouldBuy || 0) + 1 : current.wouldBuy,
                            watching: type === 'watching' ? (current.watching || 0) + 1 : current.watching
                        }));
                    }

                    alert(result.alreadyRecorded ? 'Signal already saved.' : 'Discovery signal saved.');
                } catch (error) {
                    console.error('Discovery signal failed:', error);
                    alert(error.message || 'Failed to save discovery signal');
                }
            }

            async function handleWinnerPurchase() {
                if (!beginTransactionAction('settlement')) return;

                try {
                    await settleAuctionOnce();
                } finally {
                    finishTransactionAction('settlement');
                }
            }

            async function settleAuctionOnce() {
                if (!ensureArtworkWriteEnabled()) return;
                const auctionActionId = getAuctionActionId();
                if (!auctionActionId) {
                    alert('Auction ID is unavailable');
                    return;
                }

                try {
                    const walletAddress = window.currentWalletAddress || window.getCurrentWalletAddress?.() || await window.ensureWalletConnected?.();
                    const auctionWinner = getAuctionHighestBidder(auction);
                    if (!walletAddress || !isSameAddress(walletAddress, auctionWinner)) {
                        alert('Only the auction winner can complete settlement');
                        return;
                    }

                    const confirmed = await confirmAuctionAction(
                        `Complete settlement for ${auction.highestBid} ETH? Successful settlement mints the NFT to your wallet.`,
                        'Complete Settlement & Mint NFT'
                    );
                    if (!confirmed) return;

                    let provider = await window.web3Modal?.getWalletProvider();
                    if (!provider) {
                        await window.ensureWalletConnected?.();
                        provider = await window.web3Modal?.getWalletProvider();
                    }
                    if (!provider) return;

                    await window.ArtSoulContracts.init(provider);

                    // Complete settlement; the NFT mints only after this succeeds.
                    const txHash = await window.ArtSoulContracts.completeSettlement(auctionActionId);
                    console.log('Settlement tx:', txHash);

                    const blockchainArtwork = await window.ArtSoulContracts.getArtwork(artwork.blockchain_id);
                    try {
                        await window.ArtSoulDB.recordWinnerPurchase(
                            artworkId,
                            walletAddress,
                            blockchainArtwork.tokenId
                        );
                    } catch (syncError) {
                        console.warn('Legacy settlement sync skipped; indexer projection remains source of truth.', syncError.message);
                    }

                    alert('Settlement complete! NFT minted to your wallet. The indexer will update public state.');
                    loadArtwork();
                } catch (error) {
                    console.error('Settlement failed:', error);
                    const message = getTransactionErrorMessage(error, 'Settlement could not be completed. Please try again.');
                    console.log('Settlement error shown to user:', message);
                    alert(`Settlement failed: ${message}`);
                }
            }

            async function handleDirectPurchase() {
                if (!beginTransactionAction('resale-purchase')) return;

                try {
                    await purchaseResaleOnce();
                } finally {
                    finishTransactionAction('resale-purchase');
                }
            }

            function normalizeResalePriceInput(rawValue) {
                return String(rawValue || '').trim().replace(',', '.');
            }

            function validateResaleModalPrice(rawValue, floorPrice) {
                const normalized = normalizeResalePriceInput(rawValue);
                if (!normalized) {
                    return { valid: false, normalized, error: 'Enter a resale price.' };
                }
                const numeric = Number(normalized);
                if (!Number.isFinite(numeric) || numeric <= 0) {
                    return { valid: false, normalized, error: 'Enter a valid ETH amount.' };
                }
                if (numeric < floorPrice) {
                    return {
                        valid: false,
                        normalized,
                        error: `Listing price must be at least the canonical floor of ${floorPrice} ETH.`
                    };
                }
                return { valid: true, normalized, numeric, error: '' };
            }

            async function openResaleListingModal() {
                if (!ensureArtworkWriteEnabled()) return;

                const walletAddress = connectedWalletAddress || window.currentWalletAddress || window.getCurrentWalletAddress?.() || await window.ensureWalletConnected?.();
                if (!walletAddress) return;

                const tokenId = artwork.token_id || artwork.tokenId;
                if (!isArtworkMinted(artwork) || !hasProtocolId(tokenId)) {
                    alert('Complete settlement and mint this NFT before listing it for resale.');
                    return;
                }

                if (!isSameAddress(walletAddress, artwork.current_owner_address)) {
                    alert('Only the current NFT owner can create a resale listing.');
                    return;
                }

                const defaultPrice = firstDefined(
                    artwork.floor_price,
                    artwork.canonical_floor,
                    artwork.final_price
                );
                const floorPrice = Number(defaultPrice || 0);
                if (!Number.isFinite(floorPrice) || floorPrice <= 0) {
                    alert('The canonical floor price is unavailable. Wait for the settlement projection to finish updating.');
                    return;
                }

                setResaleModalPrice(String(defaultPrice));
                setResaleModalError('');
                setResaleModalStepLabel('');
                setIsResaleModalOpen(true);
            }

            function closeResaleListingModal() {
                if (isTransactionActionPending('resale-list')) return;
                setIsResaleModalOpen(false);
                setResaleModalError('');
            }

            function handleResaleModalPriceChange(rawValue) {
                setResaleModalPrice(rawValue);
                if (!resaleModalError) return;
                const floorPrice = Number(resaleFloorPrice || 0);
                const validation = validateResaleModalPrice(rawValue, floorPrice);
                setResaleModalError(validation.valid ? '' : validation.error);
            }

            async function confirmResaleListing() {
                const floorPrice = Number(resaleFloorPrice || 0);
                const validation = validateResaleModalPrice(resaleModalPrice, floorPrice);
                if (!validation.valid) {
                    setResaleModalError(validation.error);
                    return;
                }

                if (!beginTransactionAction('resale-list')) return;
                setResaleModalError('');
                setResaleModalStepLabel('');

                try {
                    let provider = await window.web3Modal?.getWalletProvider();
                    if (!provider) {
                        await window.ensureWalletConnected?.();
                        provider = await window.web3Modal?.getWalletProvider();
                    }
                    if (!provider) {
                        setResaleModalError('Connect your wallet to list this NFT.');
                        return;
                    }

                    await window.ArtSoulContracts.init(provider);
                    const protocolArtworkId = artwork.blockchain_id || artwork.artwork_id;
                    if (!hasProtocolId(protocolArtworkId)) {
                        setResaleModalError('Artwork ID is unavailable for resale listing.');
                        return;
                    }

                    await window.ArtSoulContracts.listResale(
                        protocolArtworkId,
                        validation.normalized,
                        ({ step, totalSteps }) => {
                            setResaleModalStepLabel(
                                totalSteps > 1
                                    ? `Step ${step} of ${totalSteps}: ${step === totalSteps ? 'confirm the listing' : 'allow the marketplace to access this NFT'}`
                                    : 'Confirm the listing in your wallet'
                            );
                        }
                    );

                    setConfirmedResaleListing(true);
                    setIsResaleModalOpen(false);
                    alert('NFT listed for resale. Public state will update shortly.');
                    await loadArtwork();
                } catch (error) {
                    console.error('Resale listing failed:', error);
                    const message = getTransactionErrorMessage(
                        error,
                        'The resale listing could not be created. Please try again.'
                    );
                    setResaleModalError(message);
                } finally {
                    setResaleModalStepLabel('');
                    finishTransactionAction('resale-list');
                }
            }

            async function purchaseResaleOnce() {
                if (!ensureArtworkWriteEnabled()) return;
                if (!artwork.blockchain_id) {
                    alert('Blockchain ID not found');
                    return;
                }

                if (!artwork.sale_price || parseFloat(artwork.sale_price) <= 0) {
                    alert('Artwork not for sale');
                    return;
                }

                try {
                    let provider = await window.web3Modal?.getWalletProvider();
                    if (!provider) {
                        await window.ensureWalletConnected?.();
                        provider = await window.web3Modal?.getWalletProvider();
                    }
                    if (!provider) return;

                    await window.ArtSoulContracts.init(provider);

                    const walletAddress = window.currentWalletAddress || window.getCurrentWalletAddress?.() || await window.ensureWalletConnected?.();
                    if (!walletAddress) return;

                    // Buy an already minted resale listing.
                    const txHash = await window.ArtSoulContracts.buyResale(
                        artwork.blockchain_id,
                        artwork.sale_price
                    );
                    console.log('Resale purchase tx:', txHash);

                    const blockchainArtwork = await window.ArtSoulContracts.getArtwork(artwork.blockchain_id);
                    try {
                        await window.ArtSoulDB.recordDirectPurchase(
                            artworkId,
                            walletAddress,
                            blockchainArtwork.tokenId
                        );
                    } catch (syncError) {
                        console.warn('Legacy resale sync skipped; indexer projection remains source of truth.', syncError.message);
                    }

                    alert('Purchase successful! NFT transferred to your wallet. The indexer will update public state.');
                    loadArtwork();
                } catch (error) {
                    console.error('Resale purchase failed:', error);
                    const message = getTransactionErrorMessage(error, 'The resale purchase could not be completed. Please try again.');
                    console.log('Resale purchase error shown to user:', message);
                    alert(`Purchase failed: ${message}`);
                }
            }

            if (loading) {
                return (
                    <div className="artwork-page-root">
                        <ArtworkPageSkeleton />
                    </div>
                );
            }

            if (error?.code === 'V41_ARTWORK_NOT_INDEXED') {
                return (
                    <div className="min-h-screen">
                        <main className="min-h-[60vh] flex items-center justify-center">
                            <div className="text-center max-w-lg mx-auto px-4">
                                <div className="text-2xl mb-4">Waiting for indexer projection</div>
                                <div className="text-base mb-4 opacity-75">
                                    This artwork was submitted on-chain or is pending locally, but the public V4.1 projection has not indexed it yet.
                                </div>
                                <div className={`rounded-lg p-3 mb-6 break-all text-sm ${
                                    isClassic ? 'bg-gray-800 text-gray-300' : 'bg-cyan-900/20 border border-cyan-500/30 text-cyan-200'
                                }`}>
                                    {error.artworkId || artworkId}
                                </div>
                                <div className="flex gap-4 justify-center">
                                    <a href="profile.html" className="btn-secondary">Back to profile</a>
                                    <a href="gallery.html" className="btn-main">Explore Art</a>
                                </div>
                            </div>
                        </main>
                    </div>
                );
            }

            if (error) {
                return (
                    <div className="min-h-screen">
                        <main className="min-h-[60vh] flex items-center justify-center">
                            <div className="text-center max-w-md mx-auto px-4">
                                <div className="text-2xl mb-4 text-red-400">Error Loading Artwork</div>
                                <div className="text-base mb-6 opacity-75">{error}</div>
                                <div className="flex gap-4 justify-center">
                                    <a href="gallery.html" className="btn-main">Explore Art</a>
                                    <button onClick={() => window.location.reload()} className="btn-secondary">Retry</button>
                                </div>
                            </div>
                        </main>
                    </div>
                );
            }

            if (!artwork) {
                return (
                    <div className="min-h-screen">
                        <main className="min-h-[60vh] flex items-center justify-center">
                            <div className="text-center">
                                <div className="text-2xl mb-4">Artwork not found</div>
                                <a href="gallery.html" className="btn-main">Explore Art</a>
                            </div>
                        </main>
                    </div>
                );
            }

            // Check if auction has ended (using service when available)
            const auctionEnded = auction ? isAuctionClosedForBidding(auction) : false;
            const canEndAuction = auction ? isAuctionEndActionAvailable(auction) : false;
            const currentHighestBidWei = auction ? getAuctionHighestBidWei(auction) : 0n;
            const currentHighestBid = formatWeiToEth(currentHighestBidWei);
            const hasAuctionBids = currentHighestBidWei > 0n || bidActivity.length > 0;
            const currentHighestBidder = auction ? getAuctionHighestBidder(auction) : null;
            const minimumBidDetails = auction ? calculateMinimumBidDetails(auction) : { wei: 0n, eth: '0' };
            const settlementDeadlineValue = auction
                ? firstPositiveTimestamp(
                    auction.winnerDeadline,
                    auction.winner_deadline,
                    auction.settlementDeadline,
                    auction.settlement_deadline,
                    artwork.settlement_deadline
                )
                : null;
            const settlementDeadlineMs = normalizeTimestampMs(settlementDeadlineValue);
            const resolvedMedia = window.ArtSoulArtworkCard?.mediaDescriptor?.(artwork) || {
                type: 'unknown',
                url: artwork.file_url || artwork.media_url || artwork.animation_url || '',
                poster: ''
            };
            const safeMediaUrl = window.ArtSoulSecurity?.isValidStorageUrl(resolvedMedia.url) ? resolvedMedia.url : '';
            const canCreateNewAuction = walletRenderState.settled && canCreateNewAuctionForWallet(artwork, connectedWalletAddress);
            const enteredBidDepositWei = requiredDepositForBidWei(bidAmount);
            const pendingWithdrawalWei = parseEthToWei(withdrawalState.amount) || 0n;
            const showWithdrawableDeposit = walletRenderState.settled &&
                releasedDepositCreditWei() > 0n &&
                pendingWithdrawalWei > 0n;
            const presentationStatus = window.ArtSoulArtworkCard?.statusInfo?.(auction ? {
                ...artwork,
                auction_state: auction.state,
                active_auction_id: firstDefined(artwork.active_auction_id, auction.auctionId),
                auction_end_time: firstDefined(artwork.auction_end_time, auction.endTime),
                current_bid: hasAuctionBids && currentHighestBidWei === 0n ? '0.000000000000000001' : currentHighestBid,
                highest_bidder: currentHighestBidder || bidActivity[0]?.bidder
            } : artwork) || {
                key: isArtworkMinted(artwork) ? 'sold' : 'not_minted',
                label: isArtworkMinted(artwork) ? 'Sold' : 'Not yet minted'
            };
            const normalizedArtwork = window.ArtSoulDiscovery?.normalizeArtwork?.(artwork) || artwork;
            const trustScore = Math.round(Number(normalizedArtwork.trust_score || 0));
            const creatorName = getProfileDisplayName(creatorProfile, artwork.creator_id || artwork.creator);
            const mintedArtwork = isArtworkMinted(artwork) || auction?.state === 'SOLD';
            const awaitingPayment = auction?.state === 'WAITING_PAYMENT';
            const liveAuction = Boolean(auction && !auctionEnded && !awaitingPayment && !mintedArtwork);
            const resaleStatus = String(artwork.status || artwork.listing_status || artwork.resale_status || '').toLowerCase();
            const listedForResale = mintedArtwork &&
                Number(artwork.sale_price || artwork.listing_price || artwork.resale_price || 0) > 0 &&
                ['for_sale', 'listed', 'resale_listed'].includes(resaleStatus);
            const resaleFloorPrice = firstDefined(
                artwork.floor_price,
                artwork.canonical_floor,
                artwork.final_price
            );
            const startingPrice = firstDefined(auction?.startingPrice, artwork.start_price, artwork.creator_value, '0');
            const finalPrice = hasAuctionBids
                ? currentHighestBid
                : firstDefined(artwork.final_price, artwork.floor_price, '0');
            const winnerAddress = currentHighestBidder || artwork.auction_winner_address;
            const creatorAddress = artwork.creator_id || artwork.creator;
            const ownerAddress = artwork.current_owner_address;
            const connectedWalletOwnsArtwork = walletRenderState.settled &&
                isSameAddress(connectedWalletAddress, ownerAddress);
            const resaleEligibility = getOwnerResaleEligibility({
                walletSettled: walletRenderState.settled,
                walletAddress: connectedWalletAddress,
                walletChainId: walletRenderState.chainId,
                currentOwnerAddress: ownerAddress,
                minted: mintedArtwork,
                tokenId: artwork.token_id || artwork.tokenId,
                floorPrice: resaleFloorPrice,
                activeListing: listedForResale || confirmedResaleListing,
                activeAuction: liveAuction
            });
            const tokenExplorerUrl = mintedArtwork ? getTokenExplorerUrl(artwork) : '';
            const statusForState = mintedArtwork
                ? { key: 'sold', label: 'Sold' }
                : awaitingPayment
                    ? { key: 'awaiting_settlement', label: 'Awaiting payment' }
                    : liveAuction
                        ? { key: 'live', label: 'Live' }
                        : presentationStatus;

            return (
                <div className="artwork-page-root">
                    {isNewAuctionModalOpen && (
                        <div
                            className="reauction-modal-backdrop"
                            role="presentation"
                            onMouseDown={event => {
                                if (event.target === event.currentTarget) closeNewAuctionModal();
                            }}
                        >
                            <section
                                className="reauction-modal"
                                role="dialog"
                                aria-modal="true"
                                aria-labelledby="reauction-modal-title"
                            >
                                <div className="reauction-modal-header">
                                    <div>
                                        <p className="reauction-modal-eyebrow">Re-list artwork</p>
                                        <h2 id="reauction-modal-title">Create New Auction</h2>
                                    </div>
                                    <button
                                        type="button"
                                        className="reauction-modal-close"
                                        aria-label="Close new auction setup"
                                        onClick={closeNewAuctionModal}
                                        disabled={isTransactionActionPending('create-auction')}
                                    >
                                        ×
                                    </button>
                                </div>

                                <label className="reauction-field-label" htmlFor="newAuctionPrice">
                                    New starting price (ETH)
                                </label>
                                <input
                                    id="newAuctionPrice"
                                    className="new-auction-input rounded-lg px-4 py-3"
                                    type="number"
                                    min="0.000001"
                                    step="0.000001"
                                    value={newAuctionPrice}
                                    onChange={event => setNewAuctionPrice(event.target.value)}
                                    disabled={isTransactionActionPending('create-auction')}
                                    autoFocus
                                />

                                <fieldset className="reauction-fieldset">
                                    <legend className="reauction-field-label">Duration</legend>
                                    <div className="grid grid-cols-3 gap-2">
                                        {[24, 36, 48].map(duration => (
                                            <button
                                                key={duration}
                                                type="button"
                                                className={`auction-duration-option rounded-lg px-3 py-3 font-bold ${newAuctionDuration === duration ? 'is-active' : ''}`}
                                                aria-pressed={newAuctionDuration === duration}
                                                onClick={() => setNewAuctionDuration(duration)}
                                                disabled={isTransactionActionPending('create-auction')}
                                            >
                                                {duration}h
                                            </button>
                                        ))}
                                    </div>
                                </fieldset>

                                <div className="reauction-estimate" aria-live="polite">
                                    <div className="reauction-estimate-title">Fresh AI valuation</div>
                                    {reauctionEstimateState === 'loading' && (
                                        <p>Refreshing the guidance for this artwork…</p>
                                    )}
                                    {reauctionEstimateState === 'ready' && reauctionEstimate && (
                                        <div>
                                            <p className="reauction-estimate-range">
                                                {Number(reauctionEstimate.estimated_value_min_eth).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                                                {' to '}
                                                {Number(reauctionEstimate.estimated_value_max_eth).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH
                                            </p>
                                            <p>
                                                Suggested start: {Number(reauctionEstimate.suggested_start_price_eth || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH
                                                {' · '}{reauctionEstimate.confidence || 'medium'} confidence
                                            </p>
                                            {reauctionEstimate.rationale && <p className="reauction-estimate-rationale">{reauctionEstimate.rationale}</p>}
                                        </div>
                                    )}
                                    {reauctionEstimateState === 'unavailable' && <p>estimate unavailable</p>}
                                    <p className="reauction-estimate-note">Guidance only. It never affects settlement, floor, ownership, or royalties.</p>
                                </div>

                                <div className="reauction-modal-actions">
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        onClick={closeNewAuctionModal}
                                        disabled={isTransactionActionPending('create-auction')}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-main"
                                        onClick={handleConfirmNewAuction}
                                        disabled={isTransactionActionPending('create-auction')}
                                        aria-busy={isTransactionActionPending('create-auction')}
                                    >
                                        {isTransactionActionPending('create-auction')
                                            ? <TransactionProcessingLabel />
                                            : 'Confirm'}
                                    </button>
                                </div>
                            </section>
                        </div>
                    )}
                    {isResaleModalOpen && (() => {
                        const floorPrice = Number(resaleFloorPrice || 0);
                        const resaleTokenId = artwork.token_id || artwork.tokenId;
                        const resaleOwnerAddress = artwork.current_owner_address || connectedWalletAddress || '';
                        const resaleOwnerShort = resaleOwnerAddress
                            ? `${resaleOwnerAddress.slice(0, 6)}...${resaleOwnerAddress.slice(-4)}`
                            : 'Unavailable';
                        const resalePending = isTransactionActionPending('resale-list');
                        return (
                            <div
                                className="resale-modal-backdrop"
                                role="presentation"
                                onMouseDown={event => {
                                    if (event.target === event.currentTarget) closeResaleListingModal();
                                }}
                            >
                                <section
                                    className="resale-modal"
                                    role="dialog"
                                    aria-modal="true"
                                    aria-labelledby="resaleModalTitle"
                                >
                                    <div className="resale-modal-header">
                                        <div>
                                            <p className="resale-modal-eyebrow">Resale listing</p>
                                            <h2 id="resaleModalTitle">List NFT for resale</h2>
                                        </div>
                                        <button
                                            type="button"
                                            className="resale-modal-close"
                                            aria-label="Close resale listing"
                                            onClick={closeResaleListingModal}
                                            disabled={resalePending}
                                        >
                                            ×
                                        </button>
                                    </div>

                                    <dl className="resale-modal-summary">
                                        <div>
                                            <dt>Artwork</dt>
                                            <dd>{artwork.title || 'Untitled'}</dd>
                                        </div>
                                        <div>
                                            <dt>Token ID</dt>
                                            <dd>#{resaleTokenId ?? '—'}</dd>
                                        </div>
                                        <div>
                                            <dt>Network</dt>
                                            <dd>Base Sepolia</dd>
                                        </div>
                                        <div>
                                            <dt>Owner</dt>
                                            <dd>{resaleOwnerShort}</dd>
                                        </div>
                                        <div>
                                            <dt>Canonical floor</dt>
                                            <dd>{floorPrice} ETH</dd>
                                        </div>
                                    </dl>

                                    <label className="resale-field-label" htmlFor="resaleModalPrice">
                                        Resale price (ETH) — minimum {floorPrice} ETH
                                    </label>
                                    <input
                                        id="resaleModalPrice"
                                        className={`resale-modal-input rounded-lg px-4 py-3${resaleModalError ? ' has-error' : ''}`}
                                        type="text"
                                        inputMode="decimal"
                                        value={resaleModalPrice}
                                        onChange={event => handleResaleModalPriceChange(event.target.value)}
                                        disabled={resalePending}
                                        aria-invalid={Boolean(resaleModalError)}
                                        aria-describedby={resaleModalError ? 'resaleModalError' : undefined}
                                        autoFocus
                                    />
                                    {resaleModalError && (
                                        <p id="resaleModalError" className="resale-modal-error" role="alert">
                                            {resaleModalError}
                                        </p>
                                    )}
                                    {resalePending && resaleModalStepLabel && (
                                        <p className="resale-modal-step" aria-live="polite">
                                            {resaleModalStepLabel}
                                        </p>
                                    )}

                                    <div className="resale-modal-actions">
                                        <button
                                            type="button"
                                            className="btn-secondary"
                                            onClick={closeResaleListingModal}
                                            disabled={resalePending}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            className="btn-main"
                                            onClick={confirmResaleListing}
                                            disabled={resalePending}
                                            aria-busy={resalePending}
                                        >
                                            {resalePending
                                                ? <TransactionProcessingLabel />
                                                : 'List NFT'}
                                        </button>
                                    </div>
                                </section>
                            </div>
                        );
                    })()}
                    {/* Content */}
                    <main className="artwork-page-shell site-page-container">
                        <div className="artwork-page-layout">
                            {/* Artwork Media Viewer */}
                            <div className="artwork-page-left">
                                <section className="artwork-detail-stage artwork-mobile-media" aria-label="Artwork media">
                                <div className={`artwork-detail-frame artwork-detail-frame-${resolvedMedia.type} relative w-full h-full rounded-xl overflow-hidden`}>
                                    {safeMediaUrl ? (
                                        <MediaViewer
                                            media={{ ...resolvedMedia, url: safeMediaUrl }}
                                            title={artwork.title}
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-black p-6">
                                            <div className="max-w-lg text-center">
                                                <div className="text-xs uppercase tracking-wide opacity-60 mb-3">
                                                        Indexed metadata unavailable
                                                </div>
                                                <h2 className="text-2xl font-semibold mb-3">{artwork.title || 'Indexed artwork'}</h2>
                                                <p className="text-sm opacity-70 mb-5">
                                                    {artwork.description || 'This artwork is indexed on-chain, but its metadata media URL is unavailable.'}
                                                </p>
                                                <div className="grid gap-3 text-left text-xs">
                                                    <div className="rounded-lg border border-current/20 p-3">
                                                        <div className="uppercase tracking-wide opacity-60 mb-1">Artwork ID</div>
                                                        <div className="break-all">{artwork.artwork_id || artwork.blockchain_id || 'Unavailable'}</div>
                                                    </div>
                                                    <div className="rounded-lg border border-current/20 p-3">
                                                        <div className="uppercase tracking-wide opacity-60 mb-1">Auction ID</div>
                                                        <div className="break-all">{artwork.auction_id || artwork.active_auction_id || 'Unavailable'}</div>
                                                    </div>
                                                    <div className="rounded-lg border border-current/20 p-3">
                                                        <div className="uppercase tracking-wide opacity-60 mb-1">Register tx hash</div>
                                                        <div className="break-all">{artwork.transaction_hash || 'Unavailable'}</div>
                                                    </div>
                                                </div>
                                                <p className="text-sm opacity-70 mt-5">
                                                    This artwork is indexed on-chain, but its metadata media URL is unavailable.
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                </section>

                                <section className="artwork-page-panel artwork-page-context artwork-mobile-context">
                                    <header className="artwork-page-header">
                                        <h1 className="artwork-detail-title">{artwork.title}</h1>
                                    </header>
                                    <div className="artwork-page-description">
                                        <h2>Description</h2>
                                        <p className="artwork-page-copy">{artwork.description || 'No description supplied.'}</p>
                                    </div>
                                    <div className="artwork-page-extra">
                                        <h2>Artwork details</h2>
                                        <dl className="artwork-page-detail-list">
                                            {resolvedMedia.type && <><dt>Media</dt><dd>{resolvedMedia.type}</dd></>}
                                            {artwork.network && <><dt>Network</dt><dd>{artwork.network}</dd></>}
                                            {(artwork.artwork_id || artwork.blockchain_id) && <><dt>Artwork ID</dt><dd>{artwork.artwork_id || artwork.blockchain_id}</dd></>}
                                            {artwork.token_id && (
                                                <>
                                                    <dt>Token ID</dt>
                                                    <dd>
                                                        {tokenExplorerUrl ? (
                                                            <a href={tokenExplorerUrl} target="_blank" rel="noopener noreferrer">{artwork.token_id}</a>
                                                        ) : artwork.token_id}
                                                    </dd>
                                                </>
                                            )}
                                        </dl>
                                    </div>
                                </section>

                                <section className="artwork-page-panel artwork-page-trust artwork-mobile-trust" aria-label="Community signals">
                                        <div className="artwork-page-panel-heading">
                                            <h2>Community</h2>
                                            {trustScore > 0 && <span className="artwork-page-chip">Trust {trustScore}/100</span>}
                                        </div>
                                        <div className="artwork-page-signal-actions">
                                            <div className="artwork-page-signal-action">
                                                <strong>{socialSignals.likes || votes.length}</strong>
                                                {userVote ? (
                                                    <p className="artwork-page-saved artwork-page-action-control">You voted</p>
                                                ) : (
                                                    <button onClick={handleVote} className="btn-main artwork-page-action-control">Like</button>
                                                )}
                                            </div>
                                            <div className="artwork-page-signal-action">
                                                <strong>{socialSignals.wouldBuy || 0}</strong>
                                                <button onClick={() => handleDiscoverySignal('would_buy')} className={interactionState.would_buy ? 'btn-secondary artwork-page-action-control opacity-70' : 'btn-main artwork-page-action-control'} disabled={interactionState.would_buy}>
                                                    {interactionState.would_buy ? 'Would Buy Saved' : 'Would Buy'}
                                                </button>
                                            </div>
                                            <div className="artwork-page-signal-action">
                                                <strong>{socialSignals.watching || 0}</strong>
                                                <button onClick={() => handleDiscoverySignal('watching')} className={interactionState.watching ? 'btn-secondary artwork-page-action-control opacity-70' : 'btn-main artwork-page-action-control'} disabled={interactionState.watching}>
                                                    {interactionState.watching ? 'Watching Saved' : 'Watching'}
                                                </button>
                                            </div>
                                        </div>
                                </section>

                                <section className="artwork-page-panel artwork-page-ai artwork-mobile-ai" aria-label="Gemini analysis">
                                        <div className="artwork-page-panel-heading">
                                            <h2>Gemini Analysis</h2>
                                            {aiGuidance?.confidence != null && (
                                                <span className="artwork-page-chip">
                                                    {Number.isFinite(Number(aiGuidance.confidence)) ? `${Number(aiGuidance.confidence)}%` : String(aiGuidance.confidence)} confidence
                                                </span>
                                            )}
                                        </div>
                                        {aiGuidance?.estimated_value_min_eth != null && aiGuidance?.estimated_value_max_eth != null && Number.isFinite(Number(aiGuidance.estimated_value_min_eth)) && Number.isFinite(Number(aiGuidance.estimated_value_max_eth)) ? (
                                            <>
                                                <p className="artwork-page-ai-range">
                                                    {Number(aiGuidance.estimated_value_min_eth).toLocaleString(undefined, { maximumFractionDigits: 6 })} to {Number(aiGuidance.estimated_value_max_eth).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH
                                                </p>
                                                <p className="artwork-page-copy">Suggested starting price: {Number(aiGuidance.suggested_start_price_eth || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH</p>
                                                {aiGuidance.rationale && <p className="artwork-page-copy">{aiGuidance.rationale}</p>}
                                            </>
                                        ) : aiGuidance?.range ? (
                                            <>
                                                <p className="artwork-page-ai-range">{aiGuidance.range.low} to {aiGuidance.range.high} ETH</p>
                                                {aiGuidance.reason && <p className="artwork-page-copy">{aiGuidance.reason}</p>}
                                            </>
                                        ) : (
                                            <p className="artwork-page-copy">{aiGuidance?.reason || 'AI analysis is unavailable for this artwork.'}</p>
                                        )}
                                        <p className="artwork-page-note">Guidance only. It does not affect settlement, floor, royalties, or mint rights.</p>
                                </section>
                            </div>

                            {/* Artwork Info */}
                            <aside className="artwork-page-right">
                                {moderationAccess?.canModerate && (
                                    <section className="moderation-panel artwork-mobile-moderation rounded-xl p-5" aria-label="Staff moderation">
                                        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                                            <div>
                                                <h3 className="text-lg font-bold">Staff moderation</h3>
                                                <p className="text-xs opacity-70">Signed in as {moderationAccess.role}</p>
                                            </div>
                                            <span className="moderation-state rounded-full px-3 py-1 text-xs font-bold">
                                                {moderationAccess.hidden ? 'Hidden' : 'Visible'}
                                            </span>
                                        </div>

                                        {moderationAccess.hidden ? (
                                            <div className="space-y-3">
                                                {moderationAccess.hidden_reason && (
                                                    <p className="text-sm opacity-80">
                                                        Reason: {moderationAccess.hidden_reason}
                                                    </p>
                                                )}
                                                <button
                                                    type="button"
                                                    className="moderation-action w-full rounded-lg px-4 py-3 font-bold"
                                                    disabled={moderationBusy}
                                                    onClick={() => handleModerationVisibility(false)}
                                                >
                                                    {moderationBusy ? 'Updating...' : 'Unhide Artwork'}
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                <label className="block text-sm font-semibold" htmlFor="moderationReason">
                                                    Hide reason
                                                </label>
                                                <textarea
                                                    id="moderationReason"
                                                    className="moderation-reason min-h-[96px] w-full rounded-lg px-3 py-2"
                                                    maxLength="500"
                                                    placeholder="Explain why this artwork must be removed from public surfaces"
                                                    value={moderationReason}
                                                    onChange={event => setModerationReason(event.target.value)}
                                                />
                                                <button
                                                    type="button"
                                                    className="moderation-action w-full rounded-lg px-4 py-3 font-bold"
                                                    disabled={moderationBusy || !moderationReason.trim()}
                                                    onClick={() => handleModerationVisibility(true)}
                                                >
                                                    {moderationBusy ? 'Updating...' : 'Hide Artwork'}
                                                </button>
                                            </div>
                                        )}

                                        {moderationMessage && (
                                            <p className="mt-3 text-sm" role="status">{moderationMessage}</p>
                                        )}
                                    </section>
                                )}

                                {/* Ownership Info - Three Roles */}
                                <div className="artwork-page-panel artwork-page-people artwork-mobile-people">
                                    <h3 className="artwork-page-card-title">Ownership</h3>

                                    <div className="artwork-page-people-list">
                                        {renderOwnershipRole({
                                            label: 'Creator',
                                            address: creatorAddress,
                                            profile: creatorProfile
                                        })}

                                        {awaitingPayment && !isSameAddress(creatorAddress, winnerAddress) && renderOwnershipRole({
                                            label: 'Highest Bidder',
                                            address: winnerAddress,
                                            profile: bidderProfiles[String(winnerAddress || '').toLowerCase()] || auctionWinnerProfile
                                        })}

                                        {mintedArtwork && renderOwnershipRole({
                                            label: 'First Collector',
                                            address: artwork.auction_winner_address,
                                            profile: auctionWinnerProfile
                                        })}

                                        {ownerAddress &&
                                            !isZeroAddress(ownerAddress) &&
                                            !isSameAddress(ownerAddress, creatorAddress) &&
                                            (!mintedArtwork || !isSameAddress(ownerAddress, artwork.auction_winner_address)) &&
                                            (!awaitingPayment || !isSameAddress(ownerAddress, winnerAddress)) &&
                                            renderOwnershipRole({
                                                label: 'Owner',
                                                address: ownerAddress,
                                                profile: currentOwnerProfile
                                            })}
                                    </div>

                                    <div className="artwork-ownership-actions">
                                        <button
                                            onClick={() => {
                                                const text = `Check out "${artwork.title}" by ${creatorName || 'artist'} on ArtSoul Protocol!`;
                                                const url = window.location.href;
                                                window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank', 'width=550,height=420');
                                            }}
                                            className="btn-secondary artwork-page-compact-action artwork-page-share"
                                            title="Share on X"
                                        >
                                            Share on X
                                        </button>
                                        <button
                                            onClick={() => window.history.back()}
                                            className="btn-secondary artwork-page-compact-action artwork-mobile-back"
                                        >
                                            Back
                                        </button>
                                    </div>
                                </div>

                                {/* Auction Info */}
                                <div className="auction-detail-panel artwork-mobile-auction p-6 rounded-xl">
                                        <div className="artwork-page-card-heading">
                                            <h3 className="artwork-page-card-title">Auction</h3>
                                            <span className={`artsoul-card-status artsoul-card-status-${statusForState.key}`}>
                                                {statusForState.label}
                                            </span>
                                        </div>

                                        <div className="space-y-3">
                                            {getAuctionActionId() && (
                                            <div className="flex justify-between artwork-auction-fact artwork-auction-id">
                                                <span className="opacity-70">Auction ID:</span>
                                                <span className="font-mono">{getAuctionActionId()}</span>
                                            </div>
                                            )}
                                            {startingPrice && Number(startingPrice) >= 0 && (
                                            <div className="flex justify-between artwork-auction-fact">
                                                <span className="opacity-70">Starting Price:</span>
                                                <span className="font-bold">{startingPrice} ETH</span>
                                            </div>
                                            )}
                                            {(liveAuction || awaitingPayment) && (
                                            <div className="flex justify-between artwork-auction-fact">
                                                <span className="opacity-70">
                                                    {awaitingPayment ? 'Final Bid:' : 'Current Bid:'}
                                                </span>
                                                <span className="font-bold text-2xl" data-testid="live-auction-current-bid">
                                                    {hasAuctionBids ? `${currentHighestBid} ETH` : 'No bids'}
                                                </span>
                                            </div>
                                            )}
                                            {mintedArtwork && (
                                                <div className="flex justify-between artwork-auction-fact">
                                                    <span className="opacity-70">Final Price:</span>
                                                    <span className="font-bold">{finalPrice} ETH</span>
                                                </div>
                                            )}
                                            {liveAuction && (
                                                <div className="flex justify-between artwork-auction-fact">
                                                    <span className="opacity-70">Time Left:</span>
                                                    <span className="font-bold" data-testid="live-auction-countdown">{timeLeft}</span>
                                                </div>
                                            )}
                                            {liveAuction && (
                                                <div className="flex justify-between artwork-auction-fact">
                                                    <span className="opacity-70">Next Bid:</span>
                                                    <span className="font-bold">{minimumBidDetails.eth} ETH</span>
                                                </div>
                                            )}

                                            {/* Settlement window countdown */}
                                            {awaitingPayment && settlementDeadlineMs > 0 && (
                                                <div className="artwork-settlement-window p-4 rounded-lg border-2">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-sm font-bold">Settlement Window</span>
                                                        <span className="text-xs opacity-70">24h to complete</span>
                                                    </div>
                                                    <div className="text-2xl font-bold text-center">
                                                        <SettlementCountdown deadline={settlementDeadlineMs} />
                                                    </div>
                                                    <div className="text-xs opacity-70 text-center mt-2">
                                                        Deadline: {new Date(settlementDeadlineMs).toLocaleString()}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Deposit Info */}
                                            {liveAuction && auction.depositAmount > 0 && (
                                                <div className="flex justify-between text-sm">
                                                    <span className="opacity-70">Deposit (10%):</span>
                                                    <span className="font-mono">{auction.depositAmount} ETH</span>
                                                </div>
                                            )}
                                            {mintedArtwork && artwork.floor_price && parseFloat(artwork.floor_price) > 0 && (
                                                <div className="flex justify-between">
                                                    <span className="opacity-70">Floor Price:</span>
                                                    <span className="font-bold text-lg">{artwork.floor_price} ETH</span>
                                                </div>
                                            )}
                                            {listedForResale && (
                                                <div className="flex justify-between">
                                                    <span className="opacity-70">Sale Price:</span>
                                                    <span className="artwork-sale-price font-bold text-xl">{artwork.sale_price} ETH</span>
                                                </div>
                                            )}
                                        </div>

                                        {liveAuction && (
                                        <section
                                                className="bid-activity-panel mt-6 rounded-lg p-4"
                                                aria-live="polite"
                                                data-testid="live-auction-bid-feed"
                                            >
                                                <div className="artwork-page-card-heading artwork-bid-heading">
                                                    <h4 className="artwork-page-card-title">Bid Activity</h4>
                                                    <span className="text-xs opacity-70">
                                                        {bidActivity.length} {bidActivity.length === 1 ? 'bid' : 'bids'}
                                                    </span>
                                                </div>

                                                {bidActivity.length > 0 ? (
                                                    <div>
                                                        {bidActivity.map(bid => (
                                                            <div
                                                                key={`${bid.transaction_hash || bid.block_number}:${bid.log_index}`}
                                                                className="bid-activity-row rounded-lg px-3 py-3"
                                                            >
                                                                <div className="bid-activity-identity">
                                                                    <a
                                                                        href={`profile.html?address=${encodeURIComponent(bid.bidder)}`}
                                                                        className="bidder-profile-link min-w-0 truncate font-semibold"
                                                                    >
                                                                        {getBidderDisplayName(bid.bidder)}
                                                                    </a>
                                                                    {formatBidTime(bid) && <time dateTime={bid.indexed_at || bid.timestamp}>{formatBidTime(bid)}</time>}
                                                                </div>
                                                                <span className="bid-activity-amount whitespace-nowrap font-bold">
                                                                    {bid.bid_amount} ETH
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : null}
                                        </section>
                                        )}

                                        {/* Bid Input (during auction) */}
                                        {liveAuction && (
                                            <div className="mt-6 space-y-3">
                                                <input
                                                    type="number"
                                                    step="0.000001"
                                                    min={minimumBidDetails.eth}
                                                    placeholder="Enter bid amount (ETH)"
                                                    value={bidAmount}
                                                    onChange={(e) => setBidAmount(e.target.value)}
                                                    disabled={isTransactionActionPending('bid')}
                                                    className="artwork-bid-input w-full px-4 py-3 rounded-lg"
                                                />
                                                <div className="text-sm opacity-70 text-center">
                                                    Minimum bid: {minimumBidDetails.eth} ETH
                                                </div>
                                                <div className="artwork-bid-deposit-note" aria-live="polite">
                                                    {enteredBidDepositWei > 0n
                                                        ? `Your deposit: ${formatWeiToEth(enteredBidDepositWei, 8)} ETH. Fully refundable if you are outbid.`
                                                        : 'Your deposit is 10% of the bid or 0.01 ETH minimum. It is fully refundable if you are outbid.'}
                                                </div>
                                                <button
                                                    onClick={handlePlaceBid}
                                                    className="btn-main w-full artwork-page-primary-action"
                                                    disabled={isTransactionActionPending('bid')}
                                                    aria-busy={isTransactionActionPending('bid')}
                                                >
                                                    {isTransactionActionPending('bid')
                                                        ? <TransactionProcessingLabel />
                                                        : 'Place Bid (10% deposit required)'}
                                                </button>
                                            </div>
                                        )}

                                        {(showWithdrawableDeposit || withdrawalState.message) && (
                                            <section className="artwork-withdrawal-panel" aria-live="polite">
                                                {showWithdrawableDeposit && (
                                                    <>
                                                        <div className="artwork-withdrawal-summary">
                                                            <span>Withdrawable balance</span>
                                                            <strong>{withdrawalState.amount} ETH</strong>
                                                        </div>
                                                        <p>
                                                            You placed a non-leading bid on this auction and the contract reports an available balance. This transaction withdraws the full balance, including any other refunds or proceeds.
                                                        </p>
                                                        <button
                                                            type="button"
                                                            className="btn-secondary artwork-page-primary-action"
                                                            onClick={handleWithdrawDeposit}
                                                            disabled={isTransactionActionPending('withdraw-deposit')}
                                                            aria-busy={isTransactionActionPending('withdraw-deposit')}
                                                        >
                                                            {isTransactionActionPending('withdraw-deposit')
                                                                ? <TransactionProcessingLabel />
                                                                : `Withdraw deposit balance: ${withdrawalState.amount} ETH`}
                                                        </button>
                                                    </>
                                                )}
                                                {withdrawalState.message && (
                                                    <p className={withdrawalState.status === 'error' ? 'transaction-message-error' : 'transaction-message-success'}>
                                                        {withdrawalState.message}
                                                    </p>
                                                )}
                                            </section>
                                        )}

                                        {/* End Auction Button (for anyone after time expires) */}
                                        {canEndAuction && (
                                            <div className="artwork-auction-next-step mt-4">
                                                <p>Confirm the expired auction first. After it closes on-chain, the creator can start a new auction.</p>
                                                <button
                                                    onClick={handleEndAuction}
                                                    className="btn-secondary w-full artwork-page-primary-action"
                                                    disabled={isTransactionActionPending('end-auction')}
                                                    aria-busy={isTransactionActionPending('end-auction')}
                                                >
                                                    {isTransactionActionPending('end-auction')
                                                        ? <TransactionProcessingLabel />
                                                        : 'End Expired Auction'}
                                                </button>
                                            </div>
                                        )}

                                        {canCreateNewAuction && (
                                            <div className="artwork-auction-next-step mt-4">
                                                <p>The previous auction is closed. Create a new auction when you are ready.</p>
                                                <button
                                                    type="button"
                                                    className="btn-main w-full artwork-page-primary-action"
                                                    onClick={openNewAuctionModal}
                                                    disabled={isTransactionActionPending('create-auction')}
                                                >
                                                    Create New Auction
                                                </button>
                                            </div>
                                        )}

                                        {/* Settlement button (24h window) */}
                                        {walletRenderState.settled && awaitingPayment && isSameAddress(connectedWalletAddress, winnerAddress) && (
                                            <div className="mt-6 space-y-3">
                                                <div className="artwork-settlement-notice p-4 rounded-lg border-2">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <p className="text-sm font-bold">Settlement requires wallet confirmation</p>
                                                    </div>
                                                    <p className="text-xs opacity-70 mb-2">
                                                        Complete settlement within the 24h window to mint and claim this NFT.
                                                    </p>
                                                    <div className="text-xs opacity-50">
                                                        If settlement is missed within 24h, the deposit is split between the artist and platform. The artwork remains unminted.
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={handleWinnerPurchase}
                                                    className="btn-main w-full text-lg font-bold"
                                                    disabled={isTransactionActionPending('settlement')}
                                                    aria-busy={isTransactionActionPending('settlement')}
                                                    style={!isClassic ? {
                                                        background: 'linear-gradient(90deg, var(--c-accent), var(--c-accent-2))',
                                                        boxShadow: '0 0 20px rgba(var(--c-accent-rgb), 0.5)',
                                                        animation: 'glow-pulse 2s ease-in-out infinite'
                                                    } : {}}
                                                >
                                                    {isTransactionActionPending('settlement')
                                                        ? <TransactionProcessingLabel />
                                                        : `Complete Settlement & Mint NFT - ${finalPrice} ETH`}
                                                </button>
                                            </div>
                                        )}

                                        {/* Resale actions (only after successful settlement/mint) */}
                                        {resaleEligibility.showOwnerAction && (
                                            <div className="artwork-auction-next-step mt-4">
                                                <p>
                                                    List this minted NFT at or above its canonical floor of {resaleFloorPrice || 'pending'} ETH.
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={openResaleListingModal}
                                                    className="btn-main w-full artwork-page-primary-action"
                                                    disabled={!resaleEligibility.canList || isTransactionActionPending('resale-list')}
                                                    aria-busy={isTransactionActionPending('resale-list')}
                                                >
                                                    {isTransactionActionPending('resale-list')
                                                        ? <TransactionProcessingLabel />
                                                        : resaleEligibility.reason === 'wrong_chain'
                                                            ? 'Base Sepolia Required'
                                                            : resaleEligibility.reason === 'floor_unavailable'
                                                                ? 'Floor Price Loading'
                                                                : 'List NFT'}
                                                </button>
                                            </div>
                                        )}

                                        {listedForResale && connectedWalletOwnsArtwork && (
                                            <div className="artwork-auction-next-step mt-4">
                                                <p>Your NFT is already listed for {artwork.sale_price} ETH.</p>
                                            </div>
                                        )}

                                        {listedForResale && !connectedWalletOwnsArtwork && (
                                            <div className="mt-6">
                                                <button
                                                    onClick={handleDirectPurchase}
                                                    className="btn-main w-full"
                                                    disabled={isTransactionActionPending('resale-purchase')}
                                                    aria-busy={isTransactionActionPending('resale-purchase')}
                                                >
                                                    {isTransactionActionPending('resale-purchase')
                                                        ? <TransactionProcessingLabel />
                                                        : `Buy Now - ${artwork.sale_price} ETH`}
                                                </button>
                                            </div>
                                        )}

                                </div>

                                {/* Discovery Signals */}
                                <div className="artwork-page-legacy-discovery" aria-hidden="true">
                                    <div className="flex justify-between items-center mb-3">
                                        <h3 className="text-lg font-bold">Discovery Signals</h3>
                                        <span className="text-sm opacity-70">{window.ArtSoulDiscovery?.classifyLifecycle?.(artwork)?.label || 'Artwork'}</span>
                                    </div>

                                    <div className="grid grid-cols-3 gap-2 text-center mb-4">
                                        <div className={`p-3 rounded-lg ${isClassic ? 'bg-gray-700/60' : 'bg-cyan-900/20 border border-cyan-500/20'}`}>
                                            <div className="text-xl font-bold">{socialSignals.likes || votes.length}</div>
                                            <div className="text-xs opacity-70">Likes</div>
                                        </div>
                                        <div className={`p-3 rounded-lg ${isClassic ? 'bg-gray-700/60' : 'bg-cyan-900/20 border border-cyan-500/20'}`}>
                                            <div className="text-xl font-bold">{socialSignals.wouldBuy || 0}</div>
                                            <div className="text-xs opacity-70">Would Buy</div>
                                        </div>
                                        <div className={`p-3 rounded-lg ${isClassic ? 'bg-gray-700/60' : 'bg-cyan-900/20 border border-cyan-500/20'}`}>
                                            <div className="text-xl font-bold">{socialSignals.watching || 0}</div>
                                            <div className="text-xs opacity-70">Watching</div>
                                        </div>
                                    </div>

                                    {userVote ? (
                                        <div className="text-center py-1">
                                            <p className="text-sm opacity-70">✓ You voted</p>
                                        </div>
                                    ) : (
                                        <button onClick={handleVote} className="btn-main w-full">
                                            Like
                                        </button>
                                    )}

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                                        <button
                                            onClick={() => handleDiscoverySignal('would_buy')}
                                            className={interactionState.would_buy ? 'btn-secondary w-full opacity-70' : 'btn-main w-full'}
                                            disabled={interactionState.would_buy}
                                        >
                                            {interactionState.would_buy ? 'Would Buy Saved' : 'Would Buy'}
                                        </button>
                                        <button
                                            onClick={() => handleDiscoverySignal('watching')}
                                            className={interactionState.watching ? 'btn-secondary w-full opacity-70' : 'btn-main w-full'}
                                            disabled={interactionState.watching}
                                        >
                                            {interactionState.watching ? 'Watching Saved' : 'Watching'}
                                        </button>
                                    </div>

                                    {aiGuidance && (
                                        <div
                                            className="mt-4 p-3 rounded-lg text-sm"
                                            style={{
                                                background: 'var(--c-surface-muted)',
                                                border: '1px solid var(--c-border-soft)',
                                                color: 'var(--c-text)'
                                            }}
                                        >
                                            <div className="font-semibold mb-1">Value Guidance</div>
                                            {Number.isFinite(Number(aiGuidance.estimated_value_min_eth)) && Number.isFinite(Number(aiGuidance.estimated_value_max_eth)) ? (
                                                <div className="opacity-80">
                                                    Estimated range: {Number(aiGuidance.estimated_value_min_eth).toLocaleString(undefined, { maximumFractionDigits: 6 })} - {Number(aiGuidance.estimated_value_max_eth).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH
                                                    <div className="mt-1">
                                                        Suggested starting price: {Number(aiGuidance.suggested_start_price_eth || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH - {aiGuidance.confidence || 'medium'} confidence
                                                    </div>
                                                    {aiGuidance.rationale && <div className="mt-1 opacity-80">{aiGuidance.rationale}</div>}
                                                </div>
                                            ) : aiGuidance.range ? (
                                                <div className="opacity-80">
                                                    Estimated range: {aiGuidance.range.low} - {aiGuidance.range.high} ETH - Confidence {aiGuidance.confidence}%
                                                </div>
                                            ) : (
                                                <div className="opacity-80">{aiGuidance.reason}</div>
                                            )}
                                            <div className="text-xs opacity-60 mt-1">Guidance only. It does not affect settlement, floor, royalties, or mint rights.</div>
                                        </div>
                                    )}
                                </div>

                            </aside>
                        </div>
                    </main>
                </div>
            );
        }

        createRoot(document.getElementById('app')).render(<ArtworkPage />);
