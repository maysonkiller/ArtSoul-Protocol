import { React, createRoot, hydrateRoot } from './react-runtime.js';
import { ArtworkPageSkeleton } from './loading-skeletons.jsx';
import { prepareAvatar, readPreparedAvatar, decodeImage } from '../features/artwork/decoded-image.js';
import { readAIValuation, formatAIPrice } from '../features/artwork/ai-valuation-values.js';
import { parseUserEthAmount } from '../features/auction/eth-amount.js';
import { inspectAuctionCreation } from '../features/auction/auction-creation.js';
import { ArtistSupport } from '../features/artwork/artist-support.jsx';
import '../features/artwork/artwork-dialogs.css';
import { artworkShareIntent } from '../features/artwork/artwork-sharing.js';

import { getOwnerResaleEligibility, validateResalePrice } from '../features/marketplace/resale-eligibility.js';
import { classifyBidFailure } from '../features/auction/bid-error.js';
import { ExplainedAction } from '../ui/explained-action.jsx';
import '../../supabase-client.js';
import '../../supabase-auth.js';
import '../features/saved/saved-ui.js';

const { useState, useEffect, useRef } = React;

// Prepare the shared fallback while the artwork request is in flight, rather
// than downloading/decoding it only after Ownership is already on screen.
void prepareAvatar('/default-avatar.png').catch(() => {});

function useDecodedImage(source, fallback = '', prepare = decodeImage, keepPrevious = false, readPrepared = () => '') {
    const [prepared, setPrepared] = useState(() => ({ source, url: readPrepared(source), failed: false }));
    useEffect(() => {
        let active = true;
        if (!source) return () => { active = false; };
        prepare(source).then(
            url => { if (active) setPrepared({ source, url, failed: false }); },
            () => {
                if (active) setPrepared({ source, url: fallback, failed: !fallback });
            }
        );
        return () => { active = false; };
    }, [source, fallback, prepare]);
    const ready = readPrepared(source);
    if (ready) return { source, url: ready, failed: false };
    return prepared.source === source || (keepPrevious && source && prepared.url)
        ? prepared : { url: '', failed: false };
}

function OwnershipIdentity({ source, label, name, className, style, nameStyle, isClassic }) {
    // This component is keyed by wallet: keep the same person's decoded avatar
    // visible while a newer profile image is prepared, never across identities.
    const image = useDecodedImage(source, '/default-avatar.png', prepareAvatar, true, readPreparedAvatar);
    return (
        <>
            {image.url ? <img src={image.url} alt={label} className={className} style={style} /> : (
                <span className="w-12 h-12 flex-shrink-0" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
                <div className={`text-xs ${isClassic ? 'opacity-70' : 'opacity-90'}`}>{label}</div>
                {image.url ? <div className="font-semibold truncate" style={nameStyle}>{name}</div> : (
                    <div className="text-sm" role="status">Loading profile…</div>
                )}
            </div>
        </>
    );
}
        const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
        const WEI_PER_ETH = 1000000000000000000n;
        const MIN_ABSOLUTE_BID_INCREMENT_WEI = 10000000000000000n;
        const BID_INCREMENT_BPS = 250n;
        const BPS_DENOMINATOR = 10000n;
        const REPORT_CATEGORIES = [
            { value: 'copyright', label: 'Copyright or ownership' },
            { value: 'impersonation', label: 'Impersonation' },
            { value: 'prohibited_content', label: 'Prohibited or harmful content' },
            { value: 'spam', label: 'Spam or misleading listing' },
            { value: 'other', label: 'Other concern' }
        ];

        function emptyArtworkReport() {
            return {
                category: 'copyright',
                details: '',
                referenceUrl: '',
                goodFaithConfirmed: false
            };
        }

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
            const [isImageFullscreen, setIsImageFullscreen] = React.useState(false);
            const imageDialogRef = React.useRef(null);
            const imageCloseRef = React.useRef(null);
            const imageReturnFocusRef = React.useRef(null);
            const mediaType = media?.type || 'unknown';
            const url = media?.url || '';
            const poster = media?.poster || '';
            const sanitizedTitle = window.ArtSoulSecurity?.sanitizeText(title) || 'Artwork';
            const isSafeMediaUrl = window.ArtSoulSecurity?.isValidStorageUrl(url);
            const decodedImage = useDecodedImage(isSafeMediaUrl && ['image', 'gif'].includes(mediaType) ? url : '');
            const canOpenImage = isSafeMediaUrl && ['image', 'gif'].includes(mediaType) && !mediaError && !decodedImage.failed;

            React.useEffect(() => {
                setMediaError(false);
                setVideoLoaded(false);
                setIsImageFullscreen(false);
            }, [url, mediaType]);

            React.useEffect(() => {
                const dialog = imageDialogRef.current;
                if (!isImageFullscreen || !canOpenImage || !dialog) return undefined;
                const previousOverflow = document.body.style.overflow;
                const returnFocus = imageReturnFocusRef.current;
                dialog.showModal();
                imageCloseRef.current?.focus({ preventScroll: true });
                document.body.style.overflow = 'hidden';
                return () => {
                    if (dialog.open) dialog.close();
                    document.body.style.overflow = previousOverflow;
                    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
                };
            }, [isImageFullscreen, canOpenImage, url]);

            const openImage = (event) => {
                imageReturnFocusRef.current = event.currentTarget;
                setIsImageFullscreen(true);
            };

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

            if (!isSafeMediaUrl || mediaError || decodedImage.failed) {
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
                            onLoadedMetadata={(event) => {
                                renderFirstVideoFrame(event);
                            }}
                            onLoadedData={(event) => {
                                if (!event.currentTarget.seeking) setVideoLoaded(true);
                            }}
                            onSeeked={() => setVideoLoaded(true)}
                            onPlaying={() => setVideoLoaded(true)}
                            onError={() => setMediaError(true)}
                        >
                            Your browser does not support video playback.
                        </video>
                        {!videoLoaded && !poster && (
                            <span className="artwork-video-loading-label" role="status">Loading video…</span>
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
                                    src="/ARTSOULlogo.png"
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
                    {!decodedImage.url && <div className="artsoul-media-loading" role="status" aria-label="Loading image" />}
                    {decodedImage.url && <img
                        src={decodedImage.url}
                        alt={sanitizedTitle}
                        className="artwork-detail-media-object artwork-detail-image artwork-detail-image-zoomable"
                        role="button"
                        tabIndex="0"
                        data-allow-rapid="true"
                        aria-label="View artwork full size"
                        aria-haspopup="dialog"
                        onClick={openImage}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openImage(event);
                            }
                        }}
                        onError={() => setMediaError(true)}
                    />}
                    <div className="artwork-detail-image-controls" role="group" aria-label="Artwork image controls">
                        <button type="button" data-allow-rapid="true" onClick={openImage} aria-label="View full size" title="View full size" aria-haspopup="dialog">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" /></svg>
                        </button>
                    </div>
                    {isImageFullscreen && window.ReactDOM?.createPortal?.(
                        <dialog
                            ref={imageDialogRef}
                            className="artwork-image-lightbox"
                            aria-label={`${sanitizedTitle} full-size view`}
                            onCancel={(event) => {
                                event.preventDefault();
                                setIsImageFullscreen(false);
                            }}
                            onClose={() => setIsImageFullscreen(false)}
                            onClick={(event) => {
                                if (event.target === event.currentTarget) setIsImageFullscreen(false);
                            }}
                        >
                            <button
                                ref={imageCloseRef}
                                type="button"
                                className="artwork-image-lightbox-close"
                                data-allow-rapid="true"
                                aria-label="Close full-size artwork view"
                                autoFocus
                                onClick={() => setIsImageFullscreen(false)}
                            >
                                ×
                            </button>
                            <img src={url} alt={sanitizedTitle} className="artwork-image-lightbox-media" />
                        </dialog>,
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

        function ArtworkPage({ initialSkeletonVisible = false }) {
            const [theme, setTheme] = useState(() => window.ThemeSync?.getTheme() || 'classic');
            const [artwork, setArtwork] = useState(null);
            const [auction, setAuction] = useState(null);
            const [creatorProfile, setCreatorProfile] = useState(null);
            const [auctionWinnerProfile, setAuctionWinnerProfile] = useState(null);
            const [currentOwnerProfile, setCurrentOwnerProfile] = useState(null);
            const [resolvedProfileAddresses, setResolvedProfileAddresses] = useState(() => new Set());
            const [loading, setLoading] = useState(true);
            const [error, setError] = useState(null);
            const [refreshError, setRefreshError] = useState('');
            const [projectionRetryCount, setProjectionRetryCount] = useState(0);
            const [bidAmount, setBidAmount] = useState('');
            const [bidActivity, setBidActivity] = useState([]);
            const [bidderProfiles, setBidderProfiles] = useState({});
            const [provenanceState, setProvenanceState] = useState({
                status: 'idle',
                events: [],
                complete: true
            });
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
            const [auctionCreationError, setAuctionCreationError] = useState('');
            const [auctionCreationChecking, setAuctionCreationChecking] = useState(false);
            const auctionCreationCheckRef = useRef({ pending: false, context: null, autoOpened: false });
            const [reauctionEstimateState, setReauctionEstimateState] = useState('idle');
            const [reauctionEstimate, setReauctionEstimate] = useState(null);
            const [isResaleModalOpen, setIsResaleModalOpen] = useState(false);
            const resaleDialogRef = useRef(null);
            const [resaleModalMode, setResaleModalMode] = useState('list');
            const [resaleModalPrice, setResaleModalPrice] = useState('');
            const [resaleModalError, setResaleModalError] = useState('');
            const [resaleModalStepLabel, setResaleModalStepLabel] = useState('');
            const [reportingEnabled, setReportingEnabled] = useState(false);
            const [donationDeployment, setDonationDeployment] = useState(null);
            const [cardActionsReady, setCardActionsReady] = useState(false);
            const [cardActionNotice, setCardActionNotice] = useState('');
            const [openDonationFromCard, setOpenDonationFromCard] = useState(false);
            const cardActionOpenedRef = useRef(false);
            const [isReportModalOpen, setIsReportModalOpen] = useState(false);
            const reportDialogRef = useRef(null);
            const [artworkReport, setArtworkReport] = useState(emptyArtworkReport);
            const [reportBusy, setReportBusy] = useState(false);
            const [reportError, setReportError] = useState('');
            const [reportReceipt, setReportReceipt] = useState(null);
            const [reportDonationTarget, setReportDonationTarget] = useState(null);
            const [withdrawalState, setWithdrawalState] = useState({
                status: 'idle',
                amount: '0',
                message: ''
            });
            const [resaleNotice, setResaleNotice] = useState('');
            const bidPollInFlightRef = useRef(false);
            const bidCursorRef = useRef(null);
            const artworkLoadSequenceRef = useRef(0);
            const loadedArtworkIdRef = useRef(null);
            const liveAuctionIdentityRef = useRef('');
            const bidderProfileCacheRef = useRef(new Map());
            const transactionActionsRef = useRef(new Set());
            const reauctionValuationControllerRef = useRef(null);
            const reportTriggerRef = useRef(null);
            const reportReturnFocusRef = useRef(null);
            const reportSubmissionRef = useRef(false);
            const [transactionActions, setTransactionActions] = useState({});

            const isClassic = theme === 'classic';
            const artworkId = window.ArtSoulArtworkUrl.currentArtworkId();
            // Set by the publish flow when it navigates here. The only thing
            // being waited for then is the indexer, which the branded mark names.
            const justPublished = (() => {
                try {
                    return new URLSearchParams(window.location.search).get('published') === '1';
                } catch {
                    return false;
                }
            })();

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

            // Canon rule 13 / Phase A7: on-chain actions exist ONLY on Base
            // Sepolia 84532. Any other resolved chain — legacy 11155111,
            // mainnets 1/8453, arbitrary or missing chain evidence — fails
            // closed while the artwork stays readable. getArtworkWriteChainId
            // resolves the explicit chain id first, so an explicit non-84532
            // chain_id always overrides a conflicting network label. This
            // pure predicate gates BOTH action visibility and every
            // click/submit handler.
            function isArtworkWriteChainSupported() {
                return getArtworkWriteChainId() === 84532;
            }

            function ensureArtworkWriteEnabled() {
                if (!isArtworkWriteChainSupported()) {
                    alert('On-chain actions require Base Sepolia. This artwork record is readable, but write actions are disabled for it.');
                    return false;
                }
                return true;
            }

            // Submit-time authorization must use the wallet provider's LIVE
            // account, never the rendered/window snapshot: the account can
            // change while a modal is open, and the stale value must not
            // authorize an action for the wrong identity. Read-only probe of
            // the existing provider — no reconnect or deep-link is triggered.
            async function getLiveProviderAccount() {
                try {
                    const provider = await window.web3Modal?.getWalletProvider?.();
                    if (!provider?.request) return '';
                    const accounts = await provider.request({ method: 'eth_accounts' });
                    return Array.isArray(accounts) && accounts[0] ? String(accounts[0]) : '';
                } catch {
                    return '';
                }
            }

            function requiredDepositForBidWei(value) {
                let bidWei;
                try { bidWei = parseUserEthAmount(String(value)).wei; } catch { return 0n; }
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
                if (!artwork || !walletRenderState.settled || auctionCreationCheckRef.current.autoOpened) return;
                if (new URLSearchParams(window.location.search).get('action') !== 'create-auction') return;
                auctionCreationCheckRef.current.autoOpened = true;
                void openNewAuctionModal();
            }, [artwork, walletRenderState.settled]);

            useEffect(() => {
                if (!isResaleModalOpen) return undefined;
                const dialog = resaleDialogRef.current;
                dialog?.showModal();
                return () => { if (dialog?.open) dialog.close(); };
            }, [isResaleModalOpen]);

            useEffect(() => {
                let active = true;
                window.ArtSoulPublicConfig?.load?.()
                    .then(config => {
                        if (active) {
                            setReportingEnabled(config?.reportingEnabled === true);
                            setDonationDeployment(config?.donations || null);
                            setCardActionsReady(true);
                        }
                    })
                    .catch(() => {
                        if (active) { setReportingEnabled(false); setCardActionsReady(true); }
                    });
                return () => {
                    active = false;
                };
            }, []);

            useEffect(() => {
                if (!artwork || !cardActionsReady || cardActionOpenedRef.current) return;
                const action = new URLSearchParams(window.location.search).get('action');
                if (!['report', 'donate'].includes(action)) return;
                if (action === 'donate' && !walletRenderState.settled) return;
                cardActionOpenedRef.current = true;
                const config = { reportingEnabled, donations: donationDeployment };
                const allowed = window.ArtSoulArtworkCard?.cardActionItems?.(artwork, config)
                    .some(item => item.href.endsWith(`action=${action}`));
                if (!allowed) {
                    setCardActionNotice(action === 'report' ? 'Reporting is unavailable for this artwork.' : 'Donations are unavailable for this artwork.');
                    return;
                }
                // A navigation may open a form; only its explicit submit action
                // may request authentication or a wallet transaction.
                try {
                    const url = new URL(window.location.href);
                    url.searchParams.delete('action');
                    window.history.replaceState(window.history.state, '', url);
                } catch { /* Opening the form does not depend on history access. */ }
                if (action === 'report') openArtworkReport();
                else setOpenDonationFromCard(true);
            }, [artwork, cardActionsReady, reportingEnabled, donationDeployment, walletRenderState.settled]);

            useEffect(() => {
                if (!isReportModalOpen) return undefined;
                const dialog = reportDialogRef.current;
                dialog?.showModal();
                return () => { if (dialog?.open) dialog.close(); };
            }, [isReportModalOpen]);

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
                const eligibleLifecycle = rawStatus === 'registered' ||
                    presentationStatus === 'ended_no_bids' ||
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

            // Canon 11: every NFT surface shows Creator, First Collector and Owner.
            // The Owner row is left out only where it would repeat a role that
            // already says who holds the work. Before mint that is the creator;
            // after settlement, until a resale, it is the first collector.
            //
            // After mint the creator holds the work again only by buying it back
            // through a completed resale, and then the row is the whole point:
            // Creator beside First Collector, with no Owner, reads as though the
            // collector still has it. Artwork 1 on the public testnet showed
            // exactly that while its own provenance timeline said "Resale
            // completed - Owner" the creator. Profile > Owned NFTs already
            // counted the buyback (issue #121); this page did not.
            // B-11: a settlement whose 24h window has passed can no longer be paid
            // - settleAuction reverts with SettlementExpired - and it can only be
            // closed by claimSettlementDefault, which the contract lets anyone call.
            // The page had no way to call it, and kept offering the winner a
            // payment the chain would refuse.
            //
            // The chain decides with block.timestamp and the page with the
            // visitor's clock, and those can differ by seconds. Waiting out a
            // margin on this side means the page never offers a default the
            // contract would still reject as SettlementStillActive.
            const SETTLEMENT_CLOCK_MARGIN_MS = 60 * 1000;
            function isSettlementWindowClosed(deadlineMs, nowMs = Date.now()) {
                const deadline = Number(deadlineMs);
                return Number.isFinite(deadline) && deadline > 0 && nowMs > deadline + SETTLEMENT_CLOCK_MARGIN_MS;
            }

            function shouldShowOwnerRole({ ownerAddress, creatorAddress, firstCollectorAddress, winnerAddress, minted, awaitingPayment }) {
                if (!ownerAddress || isZeroAddress(ownerAddress)) return false;
                if (!minted && isSameAddress(ownerAddress, creatorAddress)) return false;
                if (minted && isSameAddress(ownerAddress, firstCollectorAddress)) return false;
                if (awaitingPayment && isSameAddress(ownerAddress, winnerAddress)) return false;
                return true;
            }

            function getDefaultProfileAvatar() {
                return '/default-avatar.png';
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
                // Displayed at the uploader's own proportions; see the note in
                // avatar-dropdown.js getProfileAvatarUrl.
                return resolver?.(profileData, fallbackAvatar) || fallbackAvatar;
            }

            function renderOwnershipRole({ label, address, profile, currentOwner = false }) {
                if (!address || isZeroAddress(address)) return null;
                const projectedProfiles = artwork.ownership_profiles || {};
                const projected = Object.hasOwn(projectedProfiles, address.toLowerCase());
                const resolvedProfile = projected ? projectedProfiles[address.toLowerCase()] : profile || (
                    isSameAddress(address, artwork.creator_id || artwork.creator) ? creatorProfile : null
                );
                const identityResolved = projected || Boolean(resolvedProfile?.avatar_url) ||
                    resolvedProfileAddresses.has(address.toLowerCase()) || Object.hasOwn(bidderProfiles, address.toLowerCase());

                const roleCardStyle = !isClassic ? {
                    boxShadow: '0 0 12px rgba(var(--c-accent-rgb), 0.1)',
                    border: '1px solid var(--c-border-soft)'
                } : {};

                const avatarStyle = {
                    display: 'block',
                    objectFit: 'cover',
                    ...(!isClassic ? {
                        boxShadow: '0 0 8px rgba(var(--c-accent-rgb), 0.25)'
                    } : {})
                };

                const nameStyle = !isClassic ? {
                    background: 'linear-gradient(90deg, var(--c-accent), var(--c-accent-2))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text'
                } : {};

                return (
                    <div className="artwork-ownership-row flex w-full items-center gap-3">
                        <a
                            href={`/profile?address=${encodeURIComponent(address)}`}
                            className={`artwork-ownership-profile flex w-full items-center gap-3 flex-1 min-w-0 p-3 rounded-lg transition-all ${
                                isClassic ? 'hover:bg-gray-700/50' : 'hover:bg-cyan-900/30'
                            }`}
                            style={roleCardStyle}
                        >
                            <OwnershipIdentity
                                key={address.toLowerCase()}
                                source={identityResolved ? getProfileAvatarUrl(resolvedProfile, address) : ''}
                                label={currentOwner ? `${label} · Owner` : label}
                                name={getProfileDisplayName(resolvedProfile, address)}
                                nameStyle={nameStyle}
                                isClassic={isClassic}
                                className={`w-12 h-12 rounded-full border-2 flex-shrink-0 ${
                                    isClassic ? 'border-current' : 'border-cyan-400'
                                }`}
                                style={avatarStyle}
                            />
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

            function formatWeiToEth(wei, maxDecimals = 18) {
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
                    chainId: projection.chain_id,
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

                // Bid monotonicity belongs to one round. A new auction must not
                // inherit the previous round's ID, price or highest bidder.
                const sameArtwork = String(currentAuction.artworkId) === String(projectedAuction.artworkId);
                const sameChain = !currentAuction.chainId || !projectedAuction.chainId || Number(currentAuction.chainId) === Number(projectedAuction.chainId);
                if (!sameArtwork || !sameChain) return projectedAuction;
                const currentId = BigInt(currentAuction.auctionId || 0);
                const projectedId = BigInt(projectedAuction.auctionId || 0);
                if (projectedId > currentId) return projectedAuction;
                if (projectedId < currentId) return currentAuction;
                // A stale indexer response cannot reopen a confirmed round.
                if (currentAuction.ended && !projectedAuction.ended) return currentAuction;
                if ((currentAuction.settled || currentAuction.defaulted) && !projectedAuction.settled && !projectedAuction.defaulted) return currentAuction;

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

            async function hydrateBidderProfiles(bids, projectedProfiles = {}) {
                const addresses = [...new Set((bids || [])
                    .map(bid => String(bid.bidder || '').toLowerCase())
                    .filter(Boolean))];
                addresses.forEach(address => {
                    if (Object.hasOwn(projectedProfiles, address)) bidderProfileCacheRef.current.set(address, projectedProfiles[address]);
                });
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
                const identity = `${projection?.chain_id}:${projection?.artwork_id || projection?.blockchain_id}:${projection?.auction_id || projection?.active_auction_id || ''}`;
                const previous = liveAuctionIdentityRef.current.split(':');
                const incoming = identity.split(':');
                if (previous[0] === incoming[0] && previous[1] === incoming[1] &&
                    BigInt(previous[2] || 0) > BigInt(incoming[2] || 0)) return;
                if (identity !== liveAuctionIdentityRef.current) {
                    liveAuctionIdentityRef.current = identity;
                    bidCursorRef.current = null;
                }
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
                await hydrateBidderProfiles(nextBids, projection?.ownership_profiles);
            }

            // Live polling hits the light cursor endpoint (new bids only), not the
            // full projection — the projection is only fetched on page load.
            async function refreshLiveBidActivity() {
                if (!isV41CompositeId || bidPollInFlightRef.current) return;

                const auctionActionId = getAuctionActionId();
                if (!auctionActionId) return;

                bidPollInFlightRef.current = true;
                const identity = liveAuctionIdentityRef.current;
                const generation = artworkLoadSequenceRef.current;
                try {
                    const cursor = bidCursorRef.current;
                    const live = await window.ArtSoulDB.getLiveAuctionActivity({
                        chain_id: artwork?.chain_id,
                        auction_id: auctionActionId,
                        after_block: cursor ? cursor.block : undefined,
                        after_log: cursor ? cursor.log : undefined
                    });
                    if (!live || identity !== liveAuctionIdentityRef.current || generation !== artworkLoadSequenceRef.current) return;

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

            function formatProvenanceTime(event) {
                const timestamp = normalizeTimestampMs(event?.recorded_at);
                if (!timestamp) return '';

                return new Intl.DateTimeFormat('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                }).format(timestamp);
            }

            function provenanceEventView(event = {}) {
                const definitions = {
                    artwork_registered: {
                        title: 'Artwork published',
                        role: 'Creator',
                        address: event.creator_address
                    },
                    auction_started: {
                        title: 'Auction started',
                        role: 'Creator',
                        address: event.creator_address,
                        amount: event.start_price
                    },
                    auction_ended: {
                        title: event.highest_bidder_address ? 'Auction ended' : 'Auction closed without bids',
                        role: event.highest_bidder_address ? 'Highest Bidder' : '',
                        address: event.highest_bidder_address,
                        amount: event.winning_bid
                    },
                    settlement_pending: {
                        title: 'Settlement window opened',
                        role: 'Highest Bidder',
                        address: event.highest_bidder_address,
                        amount: event.final_price
                    },
                    settlement_completed: {
                        title: 'Settled and minted',
                        role: 'First Collector',
                        address: event.first_collector_address,
                        amount: event.final_price
                    },
                    settlement_defaulted: {
                        title: 'Settlement defaulted',
                        role: 'Highest Bidder',
                        address: event.highest_bidder_address
                    },
                    resale_completed: {
                        title: 'Resale completed',
                        role: 'Owner',
                        address: event.owner_address,
                        secondaryRole: 'Seller',
                        secondaryAddress: event.seller_address,
                        amount: event.price
                    },
                    resale_listed: {
                        title: 'Listed for resale',
                        role: 'Owner',
                        address: event.owner_address,
                        amount: event.price
                    },
                    nft_transferred: {
                        title: 'NFT transferred',
                        role: 'To',
                        address: event.to_address,
                        secondaryRole: 'From',
                        secondaryAddress: event.from_address
                    }
                };
                return definitions[event.type] || { title: 'On-chain update' };
            }

            function transactionExplorerUrl(event = {}) {
                const hash = String(event.transaction_hash || '').trim();
                if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) return '';
                const explorer = Number(artwork?.chain_id) === 11155111
                    ? 'https://sepolia.etherscan.io'
                    : 'https://sepolia.basescan.org';
                return `${explorer}/tx/${encodeURIComponent(hash)}`;
            }

            function renderProvenanceAddress(role, address) {
                if (!role || !address || isZeroAddress(address)) return null;
                return (
                    <span className="provenance-event-role">
                        {role}:{' '}
                        <a href={`/profile?address=${encodeURIComponent(address)}`}>
                            {window.ArtSoulDB?.shortWalletAddress?.(address) || `${address.slice(0, 6)}...${address.slice(-4)}`}
                        </a>
                    </span>
                );
            }

            // A-33: the details list printed the stored enum - "sepolia" or
            // "baseSepolia" - so a visitor read a legacy Ethereum record as if it
            // were the network the protocol runs on, and the active one as a
            // camelCase key. Canon 13: Base Sepolia is the only active product
            // testnet, and legacy records stay readable without presenting as
            // active. Chain id decides where it exists; the stored key is the
            // fallback for older rows that carry no id.
            function describeArtworkNetwork(artworkData) {
                const chainId = Number(artworkData?.chain_id || artworkData?.chainId || 0);
                if (chainId === 84532) return 'Base Sepolia';
                if (chainId === 11155111) return 'Ethereum Sepolia (legacy, read-only)';
                const networkKey = String(artworkData?.network || '').trim();
                if (chainId) return networkKey;
                if (networkKey === 'baseSepolia') return 'Base Sepolia';
                if (networkKey === 'sepolia') return 'Ethereum Sepolia (legacy, read-only)';
                return networkKey;
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

            function openArtworkReport(donation = null) {
                reportReturnFocusRef.current = document.activeElement;
                setReportDonationTarget(donation);
                setArtworkReport(emptyArtworkReport());
                setReportError('');
                setReportReceipt(null);
                setIsReportModalOpen(true);
            }

            function closeArtworkReport() {
                if (reportSubmissionRef.current) return;
                setIsReportModalOpen(false);
                window.requestAnimationFrame(() => (reportReturnFocusRef.current || reportTriggerRef.current)?.focus({ preventScroll: true }));
            }

            async function submitArtworkReport(event) {
                event.preventDefault();
                if (reportSubmissionRef.current || !artwork) return;

                const chainId = Number(artwork.chain_id || v41CompositeId?.chainId || 0);
                const reportArtworkId = String(
                    artwork.artwork_id ||
                    artwork.blockchain_id ||
                    v41CompositeId?.artworkId ||
                    ''
                ).trim();
                if (![84532, 11155111].includes(chainId) || !/^\d{1,78}$/.test(reportArtworkId)) {
                    setReportError('This artwork record cannot be reported through the current form.');
                    return;
                }
                if (!artworkReport.details.trim()) {
                    setReportError('Describe the concern before submitting.');
                    return;
                }
                if (!artworkReport.goodFaithConfirmed) {
                    setReportError('Confirm that the report is accurate and submitted in good faith.');
                    return;
                }

                const requestedWallet = String(window.getCurrentWalletAddress?.() || window.currentWalletAddress || '').toLowerCase();
                reportSubmissionRef.current = true;
                setReportBusy(true);
                setReportError('');
                try {
                    const authenticated = await window.ensureAuthenticated?.();
                    if (!authenticated) throw new Error('Connect and sign in with your wallet to submit a report.');
                    const currentWallet = String(window.getCurrentWalletAddress?.() || window.currentWalletAddress || '').toLowerCase();
                    if (requestedWallet && requestedWallet !== currentWallet) throw new Error('Your wallet changed. Review the report before submitting again.');
                    const response = await fetch('/api/moderation/reports', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chain_id: chainId,
                            artwork_id: reportArtworkId,
                            ...(reportDonationTarget ? {
                                target_type: 'donation_message',
                                donation_transaction_hash: reportDonationTarget.transaction_hash,
                                donation_log_index: reportDonationTarget.log_index
                            } : {}),
                            category: artworkReport.category,
                            details: artworkReport.details.trim(),
                            reference_url: artworkReport.referenceUrl.trim() || null,
                            good_faith_confirmed: true
                        })
                    });
                    const result = await response.json().catch(() => ({}));
                    if (!response.ok) {
                        throw new Error(result.message || 'The report could not be submitted.');
                    }

                    setReportReceipt({
                        reference: result.report?.reference || '',
                        alreadySubmitted: result.alreadySubmitted === true
                    });
                } catch (error) {
                    setReportError(error.message || 'The report could not be submitted.');
                } finally {
                    reportSubmissionRef.current = false;
                    setReportBusy(false);
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

                // Match the contract's integer ceiling rule without passing
                // through floating-point helpers or rounding the input value.
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
                let bidWei;
                try {
                    bidWei = parseUserEthAmount(amount).wei;
                } catch (error) {
                    return { valid: false, error: error.message || 'Enter a valid bid amount.' };
                }
                const minimumWei = minimumBidDetails?.wei ?? parseEthToWei(minimumBidDetails);
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
                if (!artworkId || artwork) return undefined;

                // supabase-client.js announces 'artsoul:db-ready' exactly once,
                // after the complete window.ArtSoulDB API is assigned. This used
                // to poll for it every 100ms for up to 5 seconds, so the page sat
                // idle for most of a tick that had already passed, and gave up
                // entirely if the module was merely slow.
                if (window.ArtSoulDB) {
                    loadArtwork();
                    return undefined;
                }

                const onReady = () => loadArtwork();
                window.addEventListener('artsoul:db-ready', onReady, { once: true });
                return () => window.removeEventListener('artsoul:db-ready', onReady);
            }, [artworkId]);

            // A projection usually lands well inside the first second, so the early
            // checks are cheap and fast and only then widen out. A flat interval made
            // every recovery wait the full step even when the row was already there.
            const PROJECTION_RETRY_DELAYS_MS = [400, 800, 1500, 2500, 3000, 3000, 3000, 3000];

            useEffect(() => {
                if (error?.code !== 'V41_ARTWORK_NOT_INDEXED' || !isV41CompositeId || projectionRetryCount >= PROJECTION_RETRY_DELAYS_MS.length) {
                    return undefined;
                }

                let retryTimer = null;
                let cancelled = false;
                const retry = () => {
                    retryTimer = setTimeout(async () => {
                        if (cancelled) return;
                        const recovered = await loadArtwork();
                        if (!cancelled && !recovered) {
                            setProjectionRetryCount(current => current + 1);
                        }
                    }, PROJECTION_RETRY_DELAYS_MS[projectionRetryCount] ?? 3000);
                };
                const onVisibilityChange = () => {
                    if (document.visibilityState !== 'visible') return;
                    document.removeEventListener('visibilitychange', onVisibilityChange);
                    retry();
                };

                if (document.visibilityState === 'visible') retry();
                else document.addEventListener('visibilitychange', onVisibilityChange);

                return () => {
                    cancelled = true;
                    if (retryTimer) clearTimeout(retryTimer);
                    document.removeEventListener('visibilitychange', onVisibilityChange);
                };
            }, [artworkId, error?.code, isV41CompositeId, projectionRetryCount]);

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
            }, [artworkId, isV41CompositeId, auction?.auctionId, auction?.status, auction?.state, auction?.endTime]);

            useEffect(() => {
                const refresh = () => {
                    // Apply the confirmed receipt before waiting for API/profile
                    // reads. The shared bridge preserves ownership and floor.
                    setArtwork(current => current && (window.ArtSoulDB.applyConfirmedAuctionUpdate?.(current) || current));
                    void loadArtwork();
                };
                window.addEventListener('artsoul:auction-confirmed', refresh);
                window.addEventListener('artsoul:resale-confirmed', refresh);
                return () => {
                    window.removeEventListener('artsoul:auction-confirmed', refresh);
                    window.removeEventListener('artsoul:resale-confirmed', refresh);
                    artworkLoadSequenceRef.current++;
                };
            }, [artworkId]);

            async function loadArtwork() {
                const sequence = ++artworkLoadSequenceRef.current;
                const isCurrent = () => sequence === artworkLoadSequenceRef.current;
                // The URL already identifies this independent indexer read. Do
                // not expose it until the artwork succeeds and this load is current.
                const earlyProvenance = isV41CompositeId
                    ? Promise.resolve().then(() => window.ArtSoulDB.getArtworkProvenance?.({
                        chain_id: v41CompositeId.chainId,
                        artwork_id: v41CompositeId.artworkId
                    })).catch(() => null)
                    : null;
                try {
                    console.log('[Artwork] Loading artwork:', artworkId);
                    // Load from Supabase
                    const data = await window.ArtSoulDB.getArtwork(artworkId);
                    if (!isCurrent()) return false;
                    console.log('[Artwork] Loaded data:', data);
                    setError(null);
                    setRefreshError('');
                    loadedArtworkIdRef.current = artworkId;
                    setProjectionRetryCount(0);
                    setArtwork(data);
                    setNewAuctionPrice(current => current || String(firstDefined(
                        data.start_price,
                        data.creator_value,
                        ''
                    )));
                    let bidderProfilesPromise = Promise.resolve();
                    if (isV41CompositeId) {
                        // The projection itself is applied synchronously before
                        // bidder profile hydration begins. Profile names are
                        // supplementary and must not hold the artwork behind the
                        // loading screen.
                        bidderProfilesPromise = applyLiveAuctionProjection(data);
                    } else {
                        setBidActivity([]);
                    }
                    const projectedCreatorAddress = data.creator_id || data.creator || '';
                    const projectedProfiles = data.ownership_profiles || {};
                    function profileFromProjection(address, current, fallback = null) {
                        if (!address) return null;
                        if (Object.hasOwn(projectedProfiles, address.toLowerCase())) {
                            return projectedProfiles[address.toLowerCase()] || { wallet_address: address, username: '', avatar_url: '' };
                        }
                        return isSameAddress(current?.wallet_address, address) ? current : fallback;
                    }
                    setCreatorProfile(current => profileFromProjection(projectedCreatorAddress, current, projectedCreatorAddress ? {
                        wallet_address: projectedCreatorAddress,
                        username: data.creator_name || '',
                        avatar_url: data.creator_avatar_url || ''
                    } : null));
                    setAuctionWinnerProfile(current => profileFromProjection(data.auction_winner_address, current));
                    setCurrentOwnerProfile(current => profileFromProjection(data.current_owner_address, current));
                    setResolvedProfileAddresses(current => new Set([...current, ...Object.keys(projectedProfiles)]));
                    setSocialSignals(window.ArtSoulDiscovery?.getSocialSignals?.(data) || {
                        likes: data.vote_count || 0,
                        wouldBuy: 0,
                        watching: 0
                    });
                    // Only display stored model guidance. Creator prices and
                    // discovery heuristics are not a Gemini analysis.
                    setAiGuidance(readAIValuation(data.ai_guidance));

                    // Keep share previews branded; artwork-specific data stays in the page content.
                    const pageUrl = window.location.href;
                    document.getElementById('og-url').setAttribute('content', pageUrl);
                    document.title = data.title + ' - ArtSoul';

                    // Exact projections already contain public role identities.
                    // Missing-profile fallbacks, votes, provenance and contract
                    // details stay off the page-load gate.
                    setLoading(false);

                    const profileAddresses = [...new Set([
                        projectedCreatorAddress,
                        data.auction_winner_address,
                        data.current_owner_address
                    ].filter(address => address && !isZeroAddress(address)).map(address => address.toLowerCase()))]
                        .filter(address => !Object.hasOwn(projectedProfiles, address));
                    const profilesPromise = Promise.allSettled(profileAddresses.map(async address => {
                        try {
                            const profile = await window.ArtSoulDB.getProfile(address);
                            if (!isCurrent()) return;
                            if (isSameAddress(address, projectedCreatorAddress) && profile) setCreatorProfile(profile);
                            if (isSameAddress(address, data.auction_winner_address)) setAuctionWinnerProfile(profile);
                            if (isSameAddress(address, data.current_owner_address)) setCurrentOwnerProfile(profile);
                        } catch (error) {
                            console.warn('Could not load artwork profile:', error);
                        } finally {
                            if (isCurrent()) setResolvedProfileAddresses(current => new Set([...current, address]));
                        }
                    }));

                    const votesPromise = (async () => {
                        if (isV41CompositeId) {
                            setVotes([]);
                            setUserVote(null);
                            return;
                        }
                        try {
                            const allVotes = await window.ArtSoulDB.getVotes(artworkId);
                            if (!isCurrent()) return;
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
                            if (!isCurrent() || walletAddress !== window.getCurrentWalletAddress?.()) return;
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

                    const provenancePromise = (async () => {
                        if (!isV41CompositeId || !data.chain_id || !data.artwork_id) {
                            setProvenanceState({ status: 'idle', events: [], complete: true });
                            return;
                        }

                        setProvenanceState(current => ({ ...current, status: 'loading' }));
                        const projection = Number(data.chain_id) === v41CompositeId.chainId &&
                            String(data.artwork_id) === String(v41CompositeId.artworkId)
                            ? await earlyProvenance
                            : await Promise.resolve().then(() => window.ArtSoulDB.getArtworkProvenance?.({
                                chain_id: data.chain_id,
                                artwork_id: data.artwork_id
                            })).catch(() => null);
                        if (!isCurrent()) return;
                        setProvenanceState(projection
                            ? {
                                status: 'ready',
                                events: Array.isArray(projection.events) ? projection.events : [],
                                complete: projection.complete !== false
                            }
                            : { status: 'unavailable', events: [], complete: false });
                    })();

                    const contractPromise = (async () => {
                        if (!window.ArtSoulContracts || !data.blockchain_id) return;
                        try {
                            const provider = await window.web3Modal?.getWalletProvider();
                            if (!provider) return;
                            await window.ArtSoulContracts.init(provider);
                            if (!isCurrent()) return;
                            const chain = Number(await provider.request({method: 'eth_chainId'}));
                            if (chain !== Number(data.chain_id)) return;
                            const chainArtwork = await window.ArtSoulContracts.getArtwork(data.blockchain_id);
                            if (!isCurrent()) return;
                            // Resolve the live pointer by artwork, never reuse a
                            // cached previous auction ID after a re-auction.
                            const auctionActionId = hasProtocolId(chainArtwork.activeAuctionId)
                                ? chainArtwork.activeAuctionId : getAuctionActionId(data, null);
                            if (!auctionActionId) return;
                            const auctionData = await window.ArtSoulContracts.getAuction(auctionActionId);
                            if (!isCurrent() || Number(await provider.request({method: 'eth_chainId'})) !== chain) return;
                            if (auctionData && auctionData.seller !== '0x0000000000000000000000000000000000000000') {
                                const identity = `${chain}:${data.artwork_id || data.blockchain_id}:${auctionData.auctionId}`;
                                if (identity !== liveAuctionIdentityRef.current) {
                                    liveAuctionIdentityRef.current = identity;
                                    bidCursorRef.current = null;
                                    setBidActivity([]);
                                }
                                setAuction(current => {
                                    if (BigInt(current?.auctionId || 0) > BigInt(auctionData.auctionId || 0)) return current;
                                    if (String(current?.auctionId) === String(auctionData.auctionId) && current?.ended && !auctionData.ended) return current;
                                    return {
                                    ...auctionData,
                                    chainId: chain,
                                    winnerDeadline: firstPositiveTimestamp(
                                        auctionData.winnerDeadline,
                                        auctionData.winner_deadline,
                                        auctionData.settlementDeadline,
                                        auctionData.settlement_deadline,
                                        data.settlement_deadline
                                    )
                                    };
                                });
                            }
                        } catch (error) {
                            console.warn('Could not load blockchain auction data:', error);
                        }
                    })();

                    await Promise.allSettled([
                        bidderProfilesPromise,
                        profilesPromise,
                        votesPromise,
                        interactionPromise,
                        provenancePromise,
                        contractPromise
                    ]);

                    return true;
                } catch (error) {
                    console.error('Error loading artwork:', error);
                    if (!isCurrent()) return false;
                    // A failed read cannot undo a loaded, receipt-confirmed
                    // state. A successful empty/hidden response still follows
                    // the normal unavailable-artwork path below.
                    if (error?.code === 'ARTWORK_READ_UNAVAILABLE' && loadedArtworkIdRef.current === artworkId) {
                        setRefreshError('Auction data could not be refreshed. Showing the last available state.');
                        setLoading(false);
                        return false;
                    }
                    if (error?.code === 'ARTWORK_UNAVAILABLE') {
                        loadedArtworkIdRef.current = null;
                        setArtwork(null);
                        setAuction(null);
                        setBidActivity([]);
                        setRefreshError('');
                        setError({ code: 'ARTWORK_UNAVAILABLE', message: 'This artwork is currently unavailable.' });
                    } else if (error?.code === 'V41_ARTWORK_NOT_INDEXED') {
                        setError({
                            code: 'V41_ARTWORK_NOT_INDEXED',
                            artworkId: error.artwork_id || artworkId
                        });
                    } else {
                        setError(error.message || 'Failed to load artwork. The artwork may not exist or there was a database error.');
                    }
                    setLoading(false);
                    return false;
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
                let enteredBid;
                try { enteredBid = parseUserEthAmount(bidAmount); } catch (error) { alert(error.message); return; }
                if (isAuctionClosedForBidding(auction)) {
                    alert('This auction has ended.');
                    return;
                }
                const minimumBidDetails = calculateMinimumBidDetails(auction);
                // Open the wallet modal on tap when not connected, then continue
                // the bid on this same page instead of showing a "connect" toast.
                const walletAddress = window.currentWalletAddress || window.getCurrentWalletAddress?.() || await window.ensureWalletConnected?.();
                if (!walletAddress) return;
                const creatorAddress = artwork?.creator_id || artwork?.creator;
                if (isSameAddress(walletAddress, creatorAddress)) {
                    alert('Creators cannot bid on their own artwork.');
                    return;
                }
                const highestBidder = getAuctionHighestBidder(auction);
                const bidContext = {
                    walletAddress,
                    creatorAddress,
                    highestBidder,
                    minimumBidDetails,
                    auctionEnded: isAuctionClosedForBidding(auction),
                    bidBelowMinimum: Boolean(
                        minimumBidDetails?.wei &&
                        enteredBid.wei < minimumBidDetails.wei
                    )
                };

                if (enteredBid.wei <= 0n) {
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
                const validation = validateBidAmountSafe(enteredBid.eth, minimumBidDetails);
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
                    const liveWallet = await getLiveProviderAccount();
                    if (!isSameAddress(liveWallet, walletAddress)) throw new Error('The wallet changed. Review your bid again.');
                    const deposit = BigInt(await window.ArtSoulContracts.getRequiredBidDeposit(enteredBid.eth));
                    const remainder = enteredBid.wei > deposit ? enteredBid.wei - deposit : 0n;
                    const confirmed = await confirmAuctionAction(
                        `Bid: ${enteredBid.eth} ETH. Pay now: ${formatWeiToEth(deposit, 18)} ETH deposit, plus wallet-estimated gas on Base Sepolia. Deposit is the greater of 10% (rounded up to wei) and 0.01 ETH. If you win, the remaining settlement payment is ${formatWeiToEth(remainder, 18)} ETH within 24 hours. Losing deposits are refundable.`,
                        'Review Bid'
                    );
                    if (!confirmed) return;
                    await window.ArtSoulContracts.placeBid(auctionActionId, enteredBid.eth, {expectedWallet: liveWallet, expectedChainId: 84532});

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

            async function openNewAuctionModal() {
                if (!ensureArtworkWriteEnabled() || auctionCreationCheckRef.current.pending) return;
                auctionCreationCheckRef.current.pending = true;
                setAuctionCreationChecking(true);
                setAuctionCreationError('');
                try {
                    let provider = await window.web3Modal?.getWalletProvider();
                    if (!provider) {
                        await window.ensureWalletConnected?.();
                        provider = await window.web3Modal?.getWalletProvider();
                    }
                    if (!provider) return;
                    const context = await inspectAuctionCreation({
                        artworkId: artwork.blockchain_id || artwork.artwork_id,
                        chainId: getArtworkWriteChainId(),
                        provider,
                        contracts: window.ArtSoulContracts
                    });
                    auctionCreationCheckRef.current.context = context;
                    setIsNewAuctionModalOpen(true);
                    void requestFreshReauctionValuation();
                } catch (error) {
                    setAuctionCreationError(getTransactionErrorMessage(error, 'Auction setup is unavailable. Please try again.'));
                } finally {
                    auctionCreationCheckRef.current.pending = false;
                    setAuctionCreationChecking(false);
                }
            }

            function closeNewAuctionModal() {
                if (isTransactionActionPending('create-auction')) return;
                reauctionValuationControllerRef.current?.abort();
                reauctionValuationControllerRef.current = null;
                auctionCreationCheckRef.current.context = null;
                setAuctionCreationError('');
                setIsNewAuctionModalOpen(false);
            }

            async function handleConfirmNewAuction() {
                if (!ensureArtworkWriteEnabled()) return;
                if (!beginTransactionAction('create-auction')) return;

                try {
                    setAuctionCreationError('');
                    const startingPrice = parseUserEthAmount(newAuctionPrice);

                    if (![24, 36, 48].includes(Number(newAuctionDuration))) {
                        throw new Error('Choose a 24h, 36h, or 48h auction duration.');
                    }
                    const openingContext = auctionCreationCheckRef.current.context;
                    if (!openingContext) {
                        throw new Error('Close this form and reopen auction setup to check the current wallet and artwork.');
                    }
                    const provider = await window.web3Modal?.getWalletProvider();
                    const context = await inspectAuctionCreation({
                        artworkId: artwork.blockchain_id || artwork.artwork_id,
                        chainId: getArtworkWriteChainId(),
                        provider,
                        contracts: window.ArtSoulContracts,
                        expectedWallet: openingContext.walletAddress
                    });
                    const txHash = await window.ArtSoulContracts.createAuction(
                        artwork.blockchain_id,
                        startingPrice.eth,
                        Number(newAuctionDuration),
                        { expectedWallet: context.walletAddress, expectedChainId: context.chainId }
                    );
                    console.log('New auction transaction:', txHash);

                    await alert('New auction created successfully. Public auction data will update shortly.');
                    window.location.assign('/gallery#auctions');
                } catch (error) {
                    console.error('Create new auction failed:', error);
                    const message = getTransactionErrorMessage(error, 'The new auction could not be created. Please try again.');
                    console.log('Create new auction error shown to user:', message);
                    setAuctionCreationError(message);
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

                    const hasWinner = !isZeroAddress(auctionData.highestBidder);
                    // The adapter has awaited confirmation. Apply the receipt
                    // bridge before any stale projection can paint another CTA.
                    setAuction(current => String(current?.auctionId) === String(auctionActionId)
                        ? {...current, ended: true, status: hasWinner ? 'settlement_pending' : 'ended_no_bids', state: hasWinner ? 'WAITING_PAYMENT' : 'ENDED_NO_BIDS'} : current);
                    setArtwork(current => window.ArtSoulDB.applyConfirmedAuctionUpdate?.(current) || current);
                    alert(hasWinner
                        ? 'Auction ended. The winner settlement window is now open. Public state will update shortly.'
                        : 'Auction confirmed closed with no bids. The creator can now create a new auction.');
                    loadArtwork();
                } catch (error) {
                    console.error('End auction failed:', error);
                    const message = getTransactionErrorMessage(error, 'The auction could not be ended. Please try again.');
                    console.log('End auction error shown to user:', message);
                    alert(`Auction could not be ended: ${message}`);
                }
            }

            async function handleClaimSettlementDefault() {
                if (!beginTransactionAction('settlement-default')) return;

                try {
                    await claimSettlementDefaultOnce();
                } finally {
                    finishTransactionAction('settlement-default');
                }
            }

            async function claimSettlementDefaultOnce() {
                if (!ensureArtworkWriteEnabled()) return;
                const confirmed = await confirmAuctionAction(
                    'Close this expired settlement? The winner did not complete payment within 24 hours. Closing it records the default on-chain: the locked deposit is split between the artist and the platform, the artwork stays unminted, and the creator can auction it again.',
                    'Close Expired Settlement'
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
                    await window.ArtSoulContracts.claimSettlementDefault(auctionActionId, { idType: 'auction' });
                    setAuction(current => String(current?.auctionId) === String(auctionActionId)
                        ? {...current, ended: true, defaulted: true, status: 'defaulted', state: 'DEFAULTED'} : current);
                    setArtwork(current => window.ArtSoulDB.applyConfirmedAuctionUpdate?.(current) || current);
                    alert('Settlement confirmed closed as defaulted. The creator can start a new auction.');
                    loadArtwork();
                } catch (error) {
                    console.error('Close expired settlement failed:', error);
                    const message = getTransactionErrorMessage(error, 'The expired settlement could not be closed. Please try again.');
                    console.log('Close expired settlement error shown to user:', message);
                    alert(`Settlement could not be closed: ${message}`);
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
                if (typeof window.ensureAuthenticated === 'function') {
                    const authenticated = await window.ensureAuthenticated();
                    if (!authenticated) return;
                }

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
                if (typeof window.ensureAuthenticated === 'function') {
                    const authenticated = await window.ensureAuthenticated();
                    if (!authenticated) return;
                }

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
                return validateResalePrice(rawValue, floorPrice);
            }

            async function openResaleListingModal(mode = 'list') {
                if (!ensureArtworkWriteEnabled()) return;
                if (!['list', 'edit', 'cancel'].includes(mode)) mode = 'list';

                const walletAddress = connectedWalletAddress || window.currentWalletAddress || window.getCurrentWalletAddress?.() || await window.ensureWalletConnected?.();
                if (!walletAddress) return;

                const tokenId = artwork.token_id || artwork.tokenId;
                if (!isArtworkMinted(artwork) || !hasProtocolId(tokenId)) {
                    alert('Complete settlement and mint this NFT before listing it for resale.');
                    return;
                }

                const requiredAddress = mode === 'cancel' ? artwork.resale_seller : artwork.current_owner_address;
                if (!isSameAddress(walletAddress, requiredAddress)) {
                    alert(mode === 'cancel' ? 'Only the listing seller can remove it from sale.' : 'Only the current NFT owner can create a resale listing.');
                    return;
                }

                const defaultPrice = firstDefined(
                    artwork.floor_price,
                    artwork.canonical_floor,
                    artwork.final_price
                );
                const floorPrice = Number(defaultPrice || 0);
                if (mode !== 'cancel' && (!Number.isFinite(floorPrice) || floorPrice <= 0)) {
                    alert('The canonical floor price is unavailable. Wait for the settlement projection to finish updating.');
                    return;
                }

                setResaleModalMode(mode);
                setResaleModalPrice(String(mode === 'edit' ? artwork.sale_price : (defaultPrice || '')));
                setResaleModalError('');
                setResaleNotice('');
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
                const floorPrice = String(resaleFloorPrice || '0');
                const validation = validateResaleModalPrice(rawValue, floorPrice);
                setResaleModalError(validation.valid ? '' : validation.error);
            }

            async function confirmResaleListing() {
                // Re-check eligibility at submit time: wallet account or chain
                // can change while the modal is open, so the open-time checks
                // in openResaleListingModal are not sufficient on their own.
                // The live provider account is authoritative, never the
                // rendered or window snapshot.
                if (!ensureArtworkWriteEnabled()) return;
                const submitWalletAddress = await getLiveProviderAccount();
                if (!submitWalletAddress) {
                    setResaleModalError('Connect your wallet to manage this listing.');
                    return;
                }
                const requiredAddress = resaleModalMode === 'cancel' ? artwork.resale_seller : artwork.current_owner_address;
                if (!isSameAddress(submitWalletAddress, requiredAddress)) {
                    setResaleModalError(resaleModalMode === 'cancel' ? 'Only the listing seller can remove it from sale.' : 'Only the current NFT owner can create a resale listing.');
                    return;
                }

                const floorPrice = String(resaleFloorPrice || '0');
                const validation = resaleModalMode === 'cancel' ? { valid: true } : validateResaleModalPrice(resaleModalPrice, floorPrice);
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

                    const options = { idType: 'artwork', expectedWallet: submitWalletAddress, expectedChainId: 84532 };
                    if (resaleModalMode === 'cancel') {
                        setResaleModalStepLabel('Confirm removal from sale in your wallet');
                        await window.ArtSoulContracts.cancelResale(protocolArtworkId, options);
                    } else await window.ArtSoulContracts.listResale(
                        protocolArtworkId,
                        validation.normalized,
                        ({ step, totalSteps }) => {
                            setResaleModalStepLabel(
                                totalSteps > 1
                                    ? `Step ${step} of ${totalSteps}: ${step === totalSteps ? 'confirm the listing' : 'allow the marketplace to access this NFT'}`
                                    : 'Confirm the listing in your wallet'
                            );
                        },
                        options
                    );

                    setIsResaleModalOpen(false);
                    setResaleNotice(resaleModalMode === 'cancel' ? 'Removed from sale. NFT ownership is unchanged.'
                        : resaleModalMode === 'edit' ? 'Listing price updated.' : 'NFT listed for sale.');
                    await loadArtwork();
                } catch (error) {
                    console.error('Resale listing failed:', error);
                    const message = getTransactionErrorMessage(
                        error,
                        'The listing change could not be completed. Please try again.'
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

                    // The live provider account is authoritative for the
                    // purchase identity, never the rendered/window snapshot.
                    const walletAddress = await getLiveProviderAccount();
                    if (!walletAddress) {
                        alert('Connect your wallet to buy this NFT.');
                        return;
                    }

                    if (isSameAddress(walletAddress, artwork.current_owner_address)) {
                        alert('You already own this NFT, so it cannot be purchased from yourself.');
                        return;
                    }

                    // Buy an already minted resale listing.
                    const txHash = await window.ArtSoulContracts.buyResale(
                        artwork.blockchain_id,
                        artwork.sale_price,
                        { idType: 'artwork' }
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

            // Adopt the same loading tree on every entry path. Switching the
            // root after first paint makes React discard the static frame.
            if (loading || error?.code === 'V41_ARTWORK_NOT_INDEXED') {
                return (
                    <div
                        className="artwork-page-root"
                        data-artwork-static-skeleton={initialSkeletonVisible ? '' : undefined}
                    >
                        <ArtworkPageSkeleton
                            immediate={initialSkeletonVisible || justPublished || Boolean(error)}
                            artworkId={error?.code === 'V41_ARTWORK_NOT_INDEXED' ? (error.artworkId || artworkId) : ''}
                        />
                    </div>
                );
            }

            if (error) {
                return (
                    <div className="min-h-screen">
                        <main className="min-h-[60vh] flex items-center justify-center">
                            <div className="text-center max-w-md mx-auto px-4">
                                <div className={`text-2xl mb-4 ${error?.code === 'ARTWORK_UNAVAILABLE' ? '' : 'text-red-400'}`}>{error?.code === 'ARTWORK_UNAVAILABLE' ? 'Artwork unavailable' : 'Error Loading Artwork'}</div>
                                <div className="text-base mb-6 opacity-75">{typeof error === 'string' ? error : error.message}</div>
                                <div className="flex gap-4 justify-center">
                                    <a href="/gallery" className="btn-main">Explore Art</a>
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
                                <a href="/gallery" className="btn-main">Explore Art</a>
                            </div>
                        </main>
                    </div>
                );
            }

            // Check if auction has ended (using service when available)
            const auctionEnded = auction ? isAuctionClosedForBidding(auction) : false;
            const artworkWriteEnabled = isArtworkWriteChainSupported();
            const canEndAuction = artworkWriteEnabled && auction ? isAuctionEndActionAvailable(auction) : false;
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
            const canCreateNewAuction = artworkWriteEnabled &&
                walletRenderState.settled &&
                canCreateNewAuctionForWallet(artwork, connectedWalletAddress);
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
            const awaitingPayment = auction?.state === 'WAITING_PAYMENT' && !['sold', 'for_sale'].includes(artwork.status);
            const settlementExpired = awaitingPayment && isSettlementWindowClosed(settlementDeadlineMs);
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
            const bidIdentityBlocked = walletRenderState.settled && (isSameAddress(connectedWalletAddress, creatorAddress) || isSameAddress(connectedWalletAddress, currentHighestBidder));
            const bidRestriction = !bidIdentityBlocked ? '' : isSameAddress(connectedWalletAddress, creatorAddress)
                ? 'This connected wallet created the artwork. Creators cannot bid on their own auctions. Other collectors can place bids; no wallet request will be sent.'
                : 'Your connected wallet already has the highest bid. You can bid again if another collector outbids you. No additional deposit is needed while you are leading.';
            const ownerAddress = artwork.current_owner_address;
            const connectedWalletOwnsArtwork = walletRenderState.settled &&
                isSameAddress(connectedWalletAddress, ownerAddress);
            const connectedWalletIsSeller = walletRenderState.settled &&
                isSameAddress(connectedWalletAddress, artwork.resale_seller);
            const resaleEligibility = getOwnerResaleEligibility({
                walletSettled: walletRenderState.settled,
                walletAddress: connectedWalletAddress,
                walletChainId: walletRenderState.chainId,
                currentOwnerAddress: ownerAddress,
                minted: mintedArtwork,
                tokenId: artwork.token_id || artwork.tokenId,
                floorPrice: resaleFloorPrice,
                activeListing: listedForResale,
                activeAuction: liveAuction
            });
            const tokenExplorerUrl = mintedArtwork ? getTokenExplorerUrl(artwork) : '';
            const statusForState = mintedArtwork
                ? { key: 'sold', label: 'Sold' }
                : settlementExpired
                    ? { key: 'settlement_expired', label: 'Payment window closed' }
                    : awaitingPayment
                    ? { key: 'awaiting_settlement', label: 'Awaiting payment' }
                    : liveAuction
                        ? { key: 'live', label: 'Live' }
                        : presentationStatus;

            const DetailsPanel = 'details';
            const DetailsHeading = 'summary';
            const GuidancePanel = 'details';
            const HistoryPanel = 'details';
            const DisclosureHeading = 'summary';

            const detailsPanel = (
                <DetailsPanel key="details" className="artwork-page-extra artwork-mobile-details">
                    <DetailsHeading><h2>Artwork details</h2></DetailsHeading>
                    <dl className="artwork-page-detail-list">
                        {resolvedMedia.type && <><dt>Media</dt><dd className="artwork-detail-media-type">{resolvedMedia.type}</dd></>}
                        {describeArtworkNetwork(artwork) && <><dt>Network</dt><dd>{describeArtworkNetwork(artwork)}</dd></>}
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
                </DetailsPanel>
            );

            const mediaPanel = (
                <section key="media" className="artwork-detail-stage artwork-mobile-media" aria-label="Artwork media">
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
                                <div className="artwork-fallback-facts grid gap-3 text-left text-xs">
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
            );

            const contextPanel = (
                <section key="context" className="artwork-page-panel artwork-page-context artwork-mobile-context">
                    <header className="artwork-page-header">
                        <h1 className="artwork-detail-title">{artwork.title}</h1>
                        {window.ArtSoulArtworkCard?.ReactSavedControl && React.createElement(window.ArtSoulArtworkCard.ReactSavedControl, { artwork, detail: true })}
                    </header>
                    <div className="artwork-page-description">
                        <h2>Description</h2>
                        <p className="artwork-page-copy">{artwork.description || 'No description supplied.'}</p>
                    </div>

                </section>
            );

            const communityPanel = (
                <section key="community" className="artwork-page-panel artwork-page-trust artwork-mobile-trust" aria-label="Community signals">
                        <div className="artwork-page-panel-heading">
                            <h2>Community</h2>
                            {trustScore > 0 && (
                                <span className="artwork-page-chip artwork-community-trust" title="Community signal for discovery. Does not affect price or ownership.">
                                    <span>Trust</span>
                                    <strong>{trustScore}<small>/100</small></strong>
                                </span>
                            )}
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
                                <ExplainedAction onClick={() => handleDiscoverySignal('would_buy')} className={interactionState.would_buy ? 'btn-secondary artwork-page-action-control opacity-70' : 'btn-main artwork-page-action-control'}
                                    contextKey={connectedWalletAddress} explanationTitle="Your interest is recorded"
                                    reason={interactionState.would_buy ? 'Your Would Buy signal is already recorded for this artwork. It expresses interest, not a bid or a purchase. It cannot be submitted again from this wallet.' : ''}>
                                    {interactionState.would_buy ? 'Would Buy Saved' : 'Would Buy'}
                                </ExplainedAction>
                            </div>
                            <div className="artwork-page-signal-action">
                                <strong>{socialSignals.watching || 0}</strong>
                                <ExplainedAction onClick={() => handleDiscoverySignal('watching')} className={interactionState.watching ? 'btn-secondary artwork-page-action-control opacity-70' : 'btn-main artwork-page-action-control'}
                                    contextKey={connectedWalletAddress} explanationTitle="Your interest is recorded"
                                    reason={interactionState.watching ? 'Your Watching signal is already recorded for this artwork. It cannot be submitted again from this wallet. Use Favorites to add or remove the artwork from your private list.' : ''}>
                                    {interactionState.watching ? 'Watching Saved' : 'Watching'}
                                </ExplainedAction>
                            </div>
                        </div>
                    <div className="artwork-community-actions" aria-label="Artwork actions">
                        {isV41CompositeId && Number(artwork.chain_id) === 84532 && (
                            <ArtistSupport key={artworkId} deployment={donationDeployment} artworkId={artwork.blockchain_id}
                                creator={creatorAddress} creatorName={creatorName} connectedWallet={connectedWalletAddress}
                                initialOpen={openDonationFromCard}
                                onReportDonation={reportingEnabled ? openArtworkReport : undefined}/>
                        )}
                        <button
                            onClick={() => {
                                const intent = artworkShareIntent({ ...artwork, creator_name: creatorName });
                                if (intent) window.open(intent, '_blank', 'noopener,noreferrer,width=550,height=420');
                            }}
                            className="btn-secondary artwork-page-compact-action artwork-page-share"
                            title="Share on X"
                        >
                            Share on X
                        </button>
                        {reportingEnabled && (
                            <button
                                type="button"
                                ref={reportTriggerRef}
                                data-allow-rapid="true"
                                onClick={() => openArtworkReport()}
                                className="btn-secondary artwork-page-compact-action artwork-page-report"
                            >
                                Report
                            </button>
                        )}
                        <button
                            onClick={() => window.history.back()}
                            className="btn-secondary artwork-page-compact-action artwork-mobile-back"
                        >
                            Back
                        </button>
                    </div>
                    <details className="artwork-community-help">
                        <summary>About community signals</summary>
                        <p>Like supports artwork you appreciate. Would Buy expresses interest; it does not place a bid or make a purchase. Watching records your interest in following the artwork.</p>
                        <p>Trust is a community signal for discovery. It does not change price, floor, ownership, or settlement.</p>
                        <a href="/docs-protocol#trust-community">How community signals work</a>
                    </details>
                    {cardActionNotice && <p role="status">{cardActionNotice}</p>}
                </section>
            );

            const guidancePanel = (
                <GuidancePanel key="guidance" className="artwork-page-panel artwork-page-ai artwork-mobile-ai" aria-label="Gemini analysis">
                        <DisclosureHeading className="artwork-page-panel-heading">
                            <h2>Gemini Analysis</h2>
                            {aiGuidance?.confidence != null && (
                                <span className="artwork-page-chip">
                                    {Number.isFinite(Number(aiGuidance.confidence)) ? `${Number(aiGuidance.confidence)}%` : String(aiGuidance.confidence)} confidence
                                </span>
                            )}
                        </DisclosureHeading>
                        {aiGuidance ? (
                            <>
                                <p className="artwork-page-ai-range">
                                    {formatAIPrice(aiGuidance.estimated_value_min_eth)} to {formatAIPrice(aiGuidance.estimated_value_max_eth)} ETH
                                </p>
                                <p className="artwork-page-copy">Suggested starting price: {formatAIPrice(aiGuidance.suggested_start_price_eth)} ETH</p>
                                {aiGuidance.rationale && <p className="artwork-page-copy">{aiGuidance.rationale}</p>}
                            </>
                        ) : (
                            <p className="artwork-page-copy">AI analysis is unavailable for this artwork.</p>
                        )}
                        <p className="artwork-page-note">Guidance only. It does not affect settlement, floor, royalties, or mint rights.</p>
                </GuidancePanel>
            );

            // Ownership Info - Three Roles
            const ownershipPanel = (
                <div key="ownership" className="artwork-page-panel artwork-page-people artwork-mobile-people">
                    <h3 className="artwork-page-card-title">Ownership</h3>
                    {artwork.ownership_status === 'unavailable' && (
                        <p className="artwork-page-note" role="status">Owner information is being verified. Please check again shortly.</p>
                    )}

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
                            profile: auctionWinnerProfile,
                            currentOwner: !isZeroAddress(ownerAddress) && isSameAddress(ownerAddress, artwork.auction_winner_address)
                        })}

                        {shouldShowOwnerRole({
                            ownerAddress,
                            creatorAddress,
                            firstCollectorAddress: artwork.auction_winner_address,
                            winnerAddress,
                            minted: mintedArtwork,
                            awaitingPayment
                        }) &&
                            renderOwnershipRole({
                                label: 'Owner',
                                address: ownerAddress,
                                // A buyback puts the same person in two rows; they
                                // must read the same, not a name above an address.
                                profile: currentOwnerProfile || (isSameAddress(ownerAddress, creatorAddress) ? creatorProfile : null)
                            })}
                    </div>

                </div>
            );

            const provenancePanel = isV41CompositeId && (
                <HistoryPanel key="history" open className="artwork-page-panel artwork-page-provenance artwork-mobile-provenance" aria-labelledby="provenanceTitle">
                    <DisclosureHeading className="artwork-page-card-heading">
                        <h3 id="provenanceTitle" className="artwork-page-card-title">Provenance</h3>
                        {provenanceState.status === 'ready' && (
                            <span className="text-xs opacity-70">
                                {provenanceState.events.length} {provenanceState.events.length === 1 ? 'event' : 'events'}
                            </span>
                        )}
                    </DisclosureHeading>

                    {provenanceState.status === 'loading' && (
                        <p className="provenance-state-copy" role="status">Loading indexer history...</p>
                    )}
                    {provenanceState.status === 'unavailable' && (
                        <p className="provenance-state-copy">Indexer history is temporarily unavailable.</p>
                    )}
                    {provenanceState.status === 'ready' && provenanceState.events.length === 0 && (
                        <p className="provenance-state-copy">No indexer history is available yet.</p>
                    )}
                    {provenanceState.events.length > 0 && (
                        <ol className="provenance-timeline">
                            {provenanceState.events.map((event, index) => {
                                const view = provenanceEventView(event);
                                const explorerUrl = transactionExplorerUrl(event);
                                const amount = Number(event?.type === 'auction_started' ? view.amount : view.amount || 0);
                                return (
                                    <li
                                        key={`${event.type}:${event.transaction_hash || event.block_number}:${event.log_index}:${index}`}
                                        className="provenance-event"
                                    >
                                        <span className="provenance-event-marker" aria-hidden="true" />
                                        <div className="provenance-event-main">
                                            <strong>{view.title}</strong>
                                            {renderProvenanceAddress(view.role, view.address)}
                                            {renderProvenanceAddress(view.secondaryRole, view.secondaryAddress)}
                                            {formatProvenanceTime(event) && (
                                                <time dateTime={event.recorded_at}>{formatProvenanceTime(event)}</time>
                                            )}
                                        </div>
                                        <div className="provenance-event-meta">
                                            {Number.isFinite(amount) && amount > 0 && <span>{view.amount} ETH</span>}
                                            {explorerUrl && (
                                                <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
                                                    Transaction
                                                </a>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                    {!provenanceState.complete && provenanceState.status === 'ready' && (
                        <p className="provenance-state-copy provenance-state-note">
                            This history reached the current display limit. Older indexer events remain preserved.
                        </p>
                    )}
                </HistoryPanel>
            );

            const auctionPanel = (
                <div key="auction" id="artwork-actions" className="auction-detail-panel artwork-mobile-auction p-6 rounded-xl">
                        <div className="artwork-page-card-heading">
                            <h3 className="artwork-page-card-title">Auction</h3>
                            <span className={`artsoul-card-status artsoul-card-status-${statusForState.key}`}>
                                {statusForState.label}
                            </span>
                        </div>

                        {(artwork.pending_auction_sync || refreshError) && (
                            <p className="text-sm mb-3" role="status">
                                {artwork.pending_auction_sync && 'Transaction confirmed. Updating auction data. '}
                                {refreshError}
                                {refreshError && <button type="button" className="underline ml-2" onClick={() => void loadArtwork()}>Retry</button>}
                            </p>
                        )}
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
                                    {settlementExpired && (
                                        <p className="text-xs opacity-70 text-center mt-2" role="status">
                                            Payment is no longer possible. Until the default is recorded, the artwork cannot be auctioned again.
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Deposit Info */}
                            {liveAuction && auction.depositAmount > 0 && (
                                <div className="flex justify-between text-sm">
                                    <span className="opacity-70">Locked deposit:</span>
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

                        <details className="artwork-payment-help">
                            <summary>About bids, payment and floor</summary>
                            <p>Review the bid and required deposit before confirming in your wallet. The highest bid alone does not create an NFT.</p>
                            <p>The winner completes payment within the displayed deadline. The deposit counts toward the auction price; any excess becomes withdrawable credit. Successful settlement creates the NFT and sets its floor to the paid auction price.</p>
                            <p>ArtSoul resale listings cannot be below that floor. The floor is not an estimate or guarantee of market value.</p>
                            <a href="/docs-protocol#settlement">Read the payment and minting guide</a>
                            <a href="/docs-protocol#deposits">How deposits work</a>
                        </details>

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
                                                        href={`/profile?address=${encodeURIComponent(bid.bidder)}`}
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

                        {/* Bid Input (during auction; Base Sepolia artworks only) */}
                        {liveAuction && artworkWriteEnabled && (
                            <div className="mt-6 space-y-3">
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="Enter bid amount (ETH)"
                                    value={bidAmount}
                                    onChange={(e) => setBidAmount(e.target.value)}
                                    disabled={isTransactionActionPending('bid') || bidIdentityBlocked}
                                    className="artwork-bid-input w-full px-4 py-3 rounded-lg"
                                />
                                <div className="text-sm opacity-70 text-center">
                                    Minimum bid: {minimumBidDetails.eth} ETH
                                </div>
                                <div className="artwork-bid-deposit-note" aria-live="polite">
                                    {enteredBidDepositWei > 0n
                                        ? `Pay now: ${formatWeiToEth(enteredBidDepositWei, 18)} ETH deposit plus gas on Base Sepolia. The deposit is max(10% of your bid, 0.01 ETH), rounded up to wei. Fully refundable if you are outbid.`
                                        : 'Your deposit is 10% of the bid or 0.01 ETH minimum. It is fully refundable if you are outbid.'}
                                </div>
                                <ExplainedAction
                                    onClick={handlePlaceBid}
                                    className="btn-main w-full artwork-page-primary-action"
                                    disabled={isTransactionActionPending('bid')}
                                    reason={bidRestriction}
                                    contextKey={connectedWalletAddress}
                                    explanationTitle={isSameAddress(connectedWalletAddress, creatorAddress) ? 'You are the creator' : 'You are already leading'}
                                    aria-busy={isTransactionActionPending('bid')}
                                >
                                    {isTransactionActionPending('bid')
                                        ? <TransactionProcessingLabel />
                                        : bidIdentityBlocked ? (isSameAddress(connectedWalletAddress, creatorAddress) ? 'Creators cannot bid on their own artwork' : 'You are already the highest bidder') : 'Review Bid and Deposit'}
                                </ExplainedAction>
                            </div>
                        )}

                        {artworkWriteEnabled && (showWithdrawableDeposit || withdrawalState.message) && (
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
                                <p>Confirm the expired auction. With a winning bid, this opens payment for the winner. With no bids, the creator can start a new auction.</p>
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

                        {/* Close Expired Settlement (for anyone after the 24h window passes) */}
                        {artworkWriteEnabled && settlementExpired && (
                            <div className="artwork-auction-next-step mt-4">
                                <p>The winner did not complete payment in time. Record the default on-chain so the creator can auction this artwork again.</p>
                                <button
                                    type="button"
                                    onClick={handleClaimSettlementDefault}
                                    className="btn-secondary w-full artwork-page-primary-action"
                                    disabled={isTransactionActionPending('settlement-default')}
                                    aria-busy={isTransactionActionPending('settlement-default')}
                                >
                                    {isTransactionActionPending('settlement-default')
                                        ? <TransactionProcessingLabel />
                                        : 'Close Expired Settlement'}
                                </button>
                            </div>
                        )}

                        {!isNewAuctionModalOpen && auctionCreationError && (
                            <p role="alert">{auctionCreationError}</p>
                        )}
                        {canCreateNewAuction && (
                            <div className="artwork-auction-next-step mt-4">
                                <p>Create a primary auction when you are ready. The current on-chain state will be checked before setup.</p>
                                <button
                                    type="button"
                                    className="btn-main w-full artwork-page-primary-action"
                                    onClick={openNewAuctionModal}
                                    disabled={auctionCreationChecking || isTransactionActionPending('create-auction')}
                                    aria-busy={auctionCreationChecking}
                                >
                                    {auctionCreationChecking ? 'Checking auction eligibility…' : 'Create New Auction'}
                                </button>
                            </div>
                        )}

                        {/* Settlement button (24h window; winner only, Base Sepolia artworks only) */}
                        {artworkWriteEnabled && walletRenderState.settled && awaitingPayment && !settlementExpired && isSameAddress(connectedWalletAddress, winnerAddress) && (
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

                        {/* Resale actions (only after successful settlement/mint; Base Sepolia artworks only) */}
                        {artworkWriteEnabled && resaleEligibility.showOwnerAction && (
                            <div className="artwork-auction-next-step mt-4">
                                <p>
                                    List this minted NFT at or above its canonical floor of {resaleFloorPrice || 'pending'} ETH.
                                </p>
                                <ExplainedAction
                                    type="button"
                                    onClick={openResaleListingModal}
                                    className="btn-main w-full artwork-page-primary-action"
                                    disabled={isTransactionActionPending('resale-list')}
                                    reason={resaleEligibility.canList ? '' : resaleEligibility.reason === 'wrong_chain'
                                        ? 'This NFT is on Base Sepolia. Switch your connected wallet to Base Sepolia before listing it. No transaction has been requested.'
                                        : 'The confirmed floor price is still loading. Listing will become available when it is known, so you can review the correct minimum price.'}
                                    contextKey={connectedWalletAddress}
                                    explanationTitle={resaleEligibility.reason === 'wrong_chain' ? 'Switch network to continue' : 'Waiting for the floor price'}
                                    aria-busy={isTransactionActionPending('resale-list')}
                                >
                                    {isTransactionActionPending('resale-list')
                                        ? <TransactionProcessingLabel />
                                        : resaleEligibility.reason === 'wrong_chain'
                                            ? 'Base Sepolia Required'
                                            : resaleEligibility.reason === 'floor_unavailable'
                                                ? 'Floor Price Loading'
                                                : 'List NFT'}
                                </ExplainedAction>
                            </div>
                        )}

                        {listedForResale && (connectedWalletOwnsArtwork || connectedWalletIsSeller) && artworkWriteEnabled && (
                            <div className="artwork-auction-next-step mt-4">
                                <p>This NFT is listed for {artwork.sale_price} ETH.</p>
                                <div className="flex flex-wrap gap-2 mt-3">
                                    {connectedWalletOwnsArtwork && <ExplainedAction type="button" className="btn-main" onClick={() => openResaleListingModal('edit')}
                                        reason={walletRenderState.chainId !== 84532 ? 'Switch your connected wallet to Base Sepolia to change this listing. No transaction has been requested.' : ''}
                                        explanationTitle="Switch network to continue" contextKey={connectedWalletAddress}
                                        disabled={isTransactionActionPending('resale-list')}>
                                        Change price
                                    </ExplainedAction>}
                                    {connectedWalletIsSeller && <ExplainedAction type="button" className="btn-secondary" onClick={() => openResaleListingModal('cancel')}
                                        reason={walletRenderState.chainId !== 84532 ? 'Switch your connected wallet to Base Sepolia to remove this listing. No transaction has been requested.' : ''}
                                        explanationTitle="Switch network to continue" contextKey={connectedWalletAddress}
                                        disabled={isTransactionActionPending('resale-list')}>
                                        Remove from sale
                                    </ExplainedAction>}
                                </div>
                                {walletRenderState.chainId !== 84532 && <p>Switch to Base Sepolia to manage this listing.</p>}
                            </div>
                        )}

                        {resaleNotice && <p className="mt-3" role="status">{resaleNotice}</p>}

                        {listedForResale && !connectedWalletOwnsArtwork && !connectedWalletIsSeller && artworkWriteEnabled && (
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
            );

            const legacyPanel = (
                <div key="legacy" className="artwork-page-legacy-discovery" aria-hidden="true">
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
                                <div className="opacity-80">
                                    Estimated range: {formatAIPrice(aiGuidance.estimated_value_min_eth)} - {formatAIPrice(aiGuidance.estimated_value_max_eth)} ETH
                                    <div className="mt-1">
                                        Suggested starting price: {formatAIPrice(aiGuidance.suggested_start_price_eth)} ETH - {aiGuidance.confidence || 'medium'} confidence
                                    </div>
                                    {aiGuidance.rationale && <div className="mt-1 opacity-80">{aiGuidance.rationale}</div>}
                                </div>
                            <div className="text-xs opacity-60 mt-1">Guidance only. It does not affect settlement, floor, royalties, or mint rights.</div>
                        </div>
                    )}
                </div>
            );

            return (
                <div className="artwork-page-root">
                    {isReportModalOpen && (
                            <dialog
                                ref={reportDialogRef}
                                className="report-modal"
                                aria-modal="true"
                                aria-labelledby="artworkReportTitle"
                                aria-describedby="artworkReportDescription"
                                onCancel={event => { event.preventDefault(); closeArtworkReport(); }}
                            >
                                <div className="report-modal-header">
                                    <div>
                                        <p className="report-modal-eyebrow">Notice and takedown</p>
                                        <h2 id="artworkReportTitle">{reportDonationTarget ? 'Report this message' : 'Report this artwork'}</h2>
                                    </div>
                                    <button
                                        type="button"
                                        className="report-modal-close"
                                        aria-label={reportDonationTarget ? 'Close message report' : 'Close artwork report'}
                                        data-allow-rapid="true"
                                        onClick={closeArtworkReport}
                                        disabled={reportBusy}
                                        autoFocus
                                    >
                                        ×
                                    </button>
                                </div>

                                {reportReceipt ? (
                                    <div className="report-confirmation" role="status">
                                        <h3>{reportReceipt.alreadySubmitted ? 'Report already received' : 'Report received'}</h3>
                                        <p>
                                            {reportReceipt.alreadySubmitted
                                                ? `A report from this wallet for the same ${reportDonationTarget ? 'message' : 'artwork'} and category is already pending review.`
                                                : 'Your report is stored for moderator review. Submitting a report does not decide ownership or remove on-chain history.'}
                                        </p>
                                        {reportReceipt.reference && (
                                            <p className="report-reference">
                                                Reference: <code>{reportReceipt.reference}</code>
                                            </p>
                                        )}
                                        <div className="report-modal-actions">
                                            <button type="button" className="btn-main" data-allow-rapid="true" onClick={closeArtworkReport}>
                                                Done
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <form onSubmit={submitArtworkReport}>
                                        <p id="artworkReportDescription" className="report-modal-copy">
                                            {reportDonationTarget
                                                ? 'Report a concern about this message. Moderation can hide its text on ArtSoul; it cannot remove or reverse the donation.'
                                                : 'Report copyright, impersonation, harmful content, spam, or another concern. Reports are reviewed and do not change blockchain ownership.'}
                                        </p>

                                        <label className="report-field-label" htmlFor="artworkReportCategory">
                                            Reason
                                        </label>
                                        <select
                                            id="artworkReportCategory"
                                            className="report-field"
                                            value={artworkReport.category}
                                            onChange={event => setArtworkReport(current => ({
                                                ...current,
                                                category: event.target.value
                                            }))}
                                            disabled={reportBusy}
                                        >
                                            {REPORT_CATEGORIES.map(category => (
                                                <option key={category.value} value={category.value}>{category.label}</option>
                                            ))}
                                        </select>

                                        <label className="report-field-label" htmlFor="artworkReportDetails">
                                            Details
                                        </label>
                                        <textarea
                                            id="artworkReportDetails"
                                            className="report-field report-details"
                                            value={artworkReport.details}
                                            onChange={event => setArtworkReport(current => ({
                                                ...current,
                                                details: event.target.value
                                            }))}
                                            maxLength="2000"
                                            placeholder="Explain what should be reviewed"
                                            disabled={reportBusy}
                                            required
                                        />
                                        <p className="report-character-count">{artworkReport.details.length}/2000</p>

                                        <label className="report-field-label" htmlFor="artworkReportReference">
                                            Supporting URL <span>(optional)</span>
                                        </label>
                                        <input
                                            id="artworkReportReference"
                                            className="report-field"
                                            type="url"
                                            inputMode="url"
                                            maxLength="500"
                                            value={artworkReport.referenceUrl}
                                            onChange={event => setArtworkReport(current => ({
                                                ...current,
                                                referenceUrl: event.target.value
                                            }))}
                                            placeholder="https://"
                                            disabled={reportBusy}
                                        />

                                        <label className="report-confirmation-check">
                                            <input
                                                type="checkbox"
                                                checked={artworkReport.goodFaithConfirmed}
                                                onChange={event => setArtworkReport(current => ({
                                                    ...current,
                                                    goodFaithConfirmed: event.target.checked
                                                }))}
                                                disabled={reportBusy}
                                                required
                                            />
                                            <span>I confirm that this report is accurate and submitted in good faith.</span>
                                        </label>

                                        {reportError && <p className="report-modal-error" role="alert">{reportError}</p>}

                                        <div className="report-modal-actions">
                                            <button
                                                type="button"
                                                className="btn-secondary"
                                                data-allow-rapid="true"
                                                onClick={closeArtworkReport}
                                                disabled={reportBusy}
                                            >
                                                Cancel
                                            </button>
                                            <ExplainedAction
                                                type="submit"
                                                className="btn-main"
                                                disabled={reportBusy}
                                                explanationTitle="Complete your report"
                                                contextKey={connectedWalletAddress}
                                                reason={!artworkReport.details.trim() ? 'Describe the concern in the report details so the moderation team can review it.' : !artworkReport.goodFaithConfirmed ? 'Confirm that this report is made in good faith before submitting it for review.' : ''}
                                                data-allow-rapid="true"
                                                aria-busy={reportBusy}
                                            >
                                                {reportBusy ? 'Submitting...' : 'Submit report'}
                                            </ExplainedAction>
                                        </div>
                                    </form>
                                )}
                            </dialog>
                    )}
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
                                        <p className="reauction-modal-eyebrow">Primary auction</p>
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
                                    type="text"
                                    inputMode="decimal"
                                    aria-describedby="new-auction-price-help new-auction-error"
                                    aria-invalid={Boolean(auctionCreationError)}
                                    value={newAuctionPrice}
                                    onChange={event => setNewAuctionPrice(event.target.value)}
                                    disabled={isTransactionActionPending('create-auction')}
                                    autoFocus
                                />
                                <p id="new-auction-price-help">Use a decimal point or comma, with up to 18 decimal places. The price must be greater than zero.</p>
                                <p id="new-auction-error" role="alert">{auctionCreationError}</p>

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
                                                {formatAIPrice(reauctionEstimate.estimated_value_min_eth)}
                                                {' to '}
                                                {formatAIPrice(reauctionEstimate.estimated_value_max_eth)} ETH
                                            </p>
                                            <p>
                                                Suggested start: {formatAIPrice(reauctionEstimate.suggested_start_price_eth)} ETH
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
                        const floorPrice = String(resaleFloorPrice || '0');
                        const removing = resaleModalMode === 'cancel';
                        const actionLabel = removing ? 'Remove from sale' : resaleModalMode === 'edit' ? 'Update price' : 'List NFT';
                        const resaleTokenId = artwork.token_id || artwork.tokenId;
                        // Owner comes from the indexer projection only — never from the
                        // connected wallet, even though listing is gated to the owner.
                        const resaleOwnerAddress = artwork.current_owner_address || '';
                        const resaleOwnerShort = resaleOwnerAddress
                            ? `${resaleOwnerAddress.slice(0, 6)}...${resaleOwnerAddress.slice(-4)}`
                            : 'Unavailable';
                        const resalePending = isTransactionActionPending('resale-list');
                        return (
                                <dialog
                                    ref={resaleDialogRef}
                                    className="resale-modal"
                                    aria-modal="true"
                                    aria-labelledby="resaleModalTitle"
                                    onCancel={event => { event.preventDefault(); closeResaleListingModal(); }}
                                >
                                    <div className="resale-modal-header">
                                        <div>
                                            <p className="resale-modal-eyebrow">Resale listing</p>
                                            <h2 id="resaleModalTitle">{removing ? 'Remove NFT from sale?' : resaleModalMode === 'edit' ? 'Change listing price' : 'List NFT for resale'}</h2>
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

                                    {removing ? (
                                        <p>The listing is removed after your transaction confirms. NFT ownership stays unchanged; the current owner can list it again later.</p>
                                    ) : <>
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
                                    <button type="button" className="btn-secondary mt-2" disabled={resalePending}
                                        onClick={() => handleResaleModalPriceChange(floorPrice)}>
                                        Use floor price
                                    </button>
                                    </>}
                                    <p className="text-sm mt-3">Confirm in your wallet. Network fees apply.</p>
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
                                                : actionLabel}
                                        </button>
                                    </div>
                                </dialog>
                        );
                    })()}
                    {/* Content */}
                    <main className="artwork-page-shell site-page-container">
                        <div className="artwork-page-layout">
                            <div className="artwork-page-left">
                                {[mediaPanel, contextPanel, ownershipPanel, auctionPanel, communityPanel, provenancePanel, guidancePanel, detailsPanel]}
                            </div>
                            <aside className="artwork-page-right">
                                {legacyPanel}
                            </aside>
                        </div>
                    </main>
                </div>
            );
        }

        const artworkAppRoot = document.getElementById('app');
        if (artworkAppRoot) {
            const initialSkeletonVisible = Boolean(
                artworkAppRoot.querySelector('[data-artwork-static-skeleton]')
            );
            artworkAppRoot.dataset.artworkEntryMounted = 'true';
            window.dispatchEvent(new CustomEvent('artsoul:artwork-entry-mounted'));
            const artworkPage = <ArtworkPage initialSkeletonVisible={initialSkeletonVisible} />;
            if (initialSkeletonVisible) {
                // The document already contains the exact loading tree. Hydrate
                // it in place so iOS never has to repaint an empty application
                // root between the static frame and React ownership. The static
                // HTML is indented for maintenance, while JSX has no whitespace
                // text nodes between elements; remove only those inert nodes so
                // React can adopt the element tree instead of rejecting it.
                const walker = document.createTreeWalker(artworkAppRoot, NodeFilter.SHOW_TEXT);
                const whitespaceNodes = [];
                while (walker.nextNode()) {
                    if (!walker.currentNode.nodeValue?.trim()) whitespaceNodes.push(walker.currentNode);
                }
                whitespaceNodes.forEach(node => node.remove());
                hydrateRoot(artworkAppRoot, artworkPage);
            } else {
                createRoot(artworkAppRoot).render(artworkPage);
            }
        }
