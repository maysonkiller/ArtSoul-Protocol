(function () {
    'use strict';

    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const RECENT_PENDING_MS = 30 * 60 * 1000;

    function normalize(value) {
        return (value || '').toString().trim().toLowerCase();
    }

    function toNumber(value, fallback = 0) {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function toTimestamp(value) {
        if (!value) return 0;
        if (typeof value === 'number') return value > 9999999999 ? value : value * 1000;
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function shortId(value) {
        const text = (value || '').toString();
        return text.length > 16 ? `${text.slice(0, 8)}...${text.slice(-6)}` : text;
    }

    function creatorLabel(artwork = {}) {
        const displayName = artwork.creator_name || artwork.creator_username || artwork.artist_name;
        const address = artwork.creator || artwork.creator_id || artwork.artist_address;
        return String(displayName || shortId(address) || 'Unknown creator');
    }

    function identityKeys(artwork = {}) {
        const keys = new Set();
        [
            artwork.id,
            artwork.canonical_v41_id,
            artwork.pending_id,
            artwork.register_tx_hash,
            artwork.transaction_hash,
            artwork.tx_hash
        ].filter(Boolean).forEach(value => keys.add(normalize(value)));

        const chainId = artwork.chain_id || artwork.chainId;
        const artworkId = artwork.artwork_id || artwork.artworkId || artwork.blockchain_id;
        if (chainId && artworkId) keys.add(`v41:${chainId}:${artworkId}`.toLowerCase());
        return [...keys].filter(Boolean);
    }

    function isHidden(artwork) {
        return artwork?.moderation_hidden === true ||
            artwork?.is_hidden === true ||
            artwork?.is_blocked === true ||
            artwork?.is_deleted === true;
    }

    function mediaCandidates(artwork = {}) {
        return [artwork.animation_url, artwork.file_url, artwork.media_url, artwork.image, artwork.image_url]
            .filter(Boolean)
            .map(String);
    }

    function mediaTypeFromUrl(value = '') {
        const url = normalize(value);
        if (/\.(mp4|webm|mov|avi|mkv)(\?|$)/.test(url)) return 'video';
        if (/\.(mp3|wav|ogg|aac|m4a|flac)(\?|$)/.test(url)) return 'audio';
        if (/\.gif(\?|$)/.test(url)) return 'gif';
        if (/\.(jpg|jpeg|png|webp|avif|svg)(\?|$)/.test(url)) return 'image';
        return '';
    }

    function mediaType(artwork = {}) {
        const explicitTypes = [artwork.file_type, artwork.media_type, artwork.mime_type]
            .filter(Boolean)
            .map(normalize);
        const urlTypes = mediaCandidates(artwork).map(mediaTypeFromUrl);
        if (explicitTypes.some(type => type.includes('video') || ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(type)) || urlTypes.includes('video')) return 'video';
        if (explicitTypes.some(type => type.includes('audio') || type === 'music' || ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'].includes(type)) || urlTypes.includes('audio')) return 'audio';
        if (explicitTypes.some(type => type.includes('gif')) || urlTypes.includes('gif')) return 'gif';
        if (explicitTypes.some(type => type.includes('image') || ['jpg', 'jpeg', 'png', 'webp', 'avif', 'svg'].includes(type)) || urlTypes.includes('image')) return 'image';
        return 'unknown';
    }

    function mediaUrl(artwork = {}) {
        const type = mediaType(artwork);
        const candidates = mediaCandidates(artwork);
        if (type === 'video' || type === 'audio') {
            return candidates.find(candidate => mediaTypeFromUrl(candidate) === type) ||
                artwork.file_url || artwork.media_url || artwork.animation_url || candidates[0] || '';
        }
        if (type === 'image' || type === 'gif') {
            return candidates.find(candidate => mediaTypeFromUrl(candidate) === type) ||
                artwork.image || artwork.image_url || artwork.file_url || artwork.media_url || artwork.animation_url || '';
        }
        return artwork.file_url || artwork.media_url || artwork.animation_url || artwork.image || artwork.image_url || '';
    }

    function posterUrl(artwork = {}) {
        const media = normalize(mediaUrl(artwork));
        const candidate = artwork.poster_url || artwork.thumbnail_url || artwork.preview_image || artwork.image || artwork.image_url || '';
        return candidate && normalize(candidate) !== media ? candidate : '';
    }

    function mediaDescriptor(artwork = {}) {
        const type = mediaType(artwork);
        return Object.freeze({
            type,
            url: mediaUrl(artwork),
            poster: type === 'video' ? posterUrl(artwork) : '',
            known: type !== 'unknown'
        });
    }

    function hasSafeMedia(artwork = {}) {
        const url = mediaDescriptor(artwork).url;
        if (!url) return false;
        return typeof window.ArtSoulSecurity?.isValidStorageUrl !== 'function' ||
            window.ArtSoulSecurity.isValidStorageUrl(url);
    }

    function stopCardActivation(event) {
        event.preventDefault();
        event.stopPropagation();
    }

    function stopCardPropagation(event) {
        event.stopPropagation();
    }

    function pauseOtherMedia(currentMedia) {
        document.querySelectorAll('audio, video').forEach(media => {
            if (media !== currentMedia && !media.paused) media.pause();
        });
    }

    function isolateMediaControl(element) {
        element.addEventListener('click', stopCardActivation);
        element.addEventListener('pointerdown', stopCardPropagation);
        element.addEventListener('mousedown', stopCardPropagation);
        element.addEventListener('touchstart', stopCardPropagation, { passive: true });
        element.addEventListener('dragstart', stopCardActivation);
        element.draggable = false;
    }

    function syncPlaybackButton(button, media, label) {
        const playing = !media.paused && !media.ended;
        button.dataset.state = playing ? 'playing' : 'paused';
        button.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${label}`);
    }

    function createPlaybackButton(media, label) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'artsoul-media-toggle';
        button.dataset.state = 'paused';
        button.setAttribute('aria-label', `Play ${label}`);
        isolateMediaControl(button);
        button.addEventListener('click', () => {
            if (media.paused) media.play().catch(() => syncPlaybackButton(button, media, label));
            else media.pause();
        });
        return button;
    }

    function syncMuteButton(button, media, label) {
        button.dataset.muted = String(media.muted);
        button.setAttribute('aria-label', `${media.muted ? 'Unmute' : 'Mute'} ${label}`);
    }

    function createMuteButton(media, label) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'artsoul-media-mute';
        isolateMediaControl(button);
        button.addEventListener('click', () => {
            media.muted = !media.muted;
            syncMuteButton(button, media, label);
        });
        syncMuteButton(button, media, label);
        return button;
    }

    function hasWinnerOrBid(artwork = {}) {
        const winner = normalize(artwork.winner || artwork.auction_winner_address || artwork.current_bidder || artwork.highest_bidder);
        return Boolean(winner && winner !== ZERO_ADDRESS) ||
            toNumber(artwork.current_bid || artwork.highest_bid || artwork.final_price) > 0;
    }

    function activeAuctionId(artwork = {}) {
        const value = artwork.active_auction_id || artwork.activeAuctionId || artwork.auction_id;
        if (value === undefined || value === null || value === '' || value === '0' || value === 0) return '';
        return String(value);
    }

    function isMinted(artwork = {}) {
        return Boolean(artwork.minted) || Boolean(artwork.token_id || artwork.tokenId);
    }

    function isListedForSale(artwork = {}) {
        const listingStatus = normalize(artwork.listing_status || artwork.resale_status || artwork.status);
        const listingPrice = toNumber(artwork.sale_price || artwork.resale_price || artwork.listing_price);
        const discoveryTab = window.ArtSoulDiscovery?.galleryTabForArtwork?.(artwork);
        return isMinted(artwork) && listingPrice > 0 && (
            discoveryTab === 'marketplace' ||
            ['for_sale', 'listed', 'resale_listed', 'active'].includes(listingStatus)
        );
    }

    function statusInfo(artwork = {}) {
        const status = normalize(artwork.status || artwork.auction_state || artwork.lifecycle_state || artwork.nft_status);
        const endTime = toTimestamp(artwork.auction_end_time || artwork.end_time || artwork.endTime);
        const expired = Boolean(endTime && endTime <= Date.now());
        const hasBid = hasWinnerOrBid(artwork);
        const minted = isMinted(artwork);
        const noBids = status.includes('no_bid');
        const ended = status === 'awaiting_end' || status === 'auction_ended' || status === 'ended';
        const defaulted = status.includes('default') || status.includes('unsettled');
        const awaitingSettlement = status.includes('settlement_pending') || status === 'waiting_payment';
        const pendingCreated = toTimestamp(artwork.created_at || artwork.createdAt || artwork.saved_at || artwork.savedAt);
        const recentPending = artwork.source === 'pending_indexer' && (!pendingCreated || Date.now() - pendingCreated <= RECENT_PENDING_MS);

        if (recentPending) return { key: 'finalizing', label: 'Finalizing...' };
        if (isListedForSale(artwork)) return { key: 'listed', label: 'For sale' };
        if (minted || status === 'sold' || status === 'settled') return { key: 'sold', label: 'Sold' };
        if (awaitingSettlement) return { key: 'awaiting_settlement', label: 'Awaiting payment' };
        if (noBids || ((expired || ended || defaulted) && !hasBid)) {
            return { key: 'ended_no_bids', label: 'No bids' };
        }
        if (defaulted) return { key: 'unsettled', label: 'Unsettled' };
        if ((expired || ended) && hasBid) {
            return { key: 'awaiting_settlement', label: 'Awaiting payment' };
        }
        if (activeAuctionId(artwork) && !expired && !minted) return { key: 'live', label: 'Live' };
        return { key: 'not_minted', label: 'Not yet minted' };
    }

    function discoveryStatusInfo(artwork = {}) {
        return statusInfo(artwork);
    }

    function formatPrice(artwork = {}) {
        const price = artwork.current_bid || artwork.highest_bid || artwork.creator_value || artwork.start_price || artwork.price || '';
        const numeric = toNumber(price, NaN);
        if (!Number.isFinite(numeric) || numeric <= 0) return '';
        return `${price} ETH`;
    }

    function formatDiscoveryPrice(artwork = {}) {
        const candidates = isMinted(artwork)
            ? [artwork.sale_price, artwork.resale_price, artwork.listing_price, artwork.floor_price, artwork.canonical_floor, artwork.price]
            : [artwork.current_bid, artwork.highest_bid, artwork.start_price, artwork.creator_value, artwork.price];

        for (const value of candidates) {
            const numeric = toNumber(value, NaN);
            if (Number.isFinite(numeric) && numeric > 0) return `${value} ETH`;
        }
        return '';
    }

    function signalsText(artwork = {}, includeZero = false) {
        const signals = window.ArtSoulDiscovery?.getSocialSignals?.(artwork) || {};
        const likes = toNumber(signals.likes ?? artwork.like_count ?? artwork.vote_count);
        const wouldBuy = toNumber(signals.wouldBuy ?? artwork.would_buy_count);
        const watching = toNumber(signals.watching ?? artwork.watching_count);
        if (includeZero) {
            return `${likes} likes · ${wouldBuy} would buy · ${watching} watching`;
        }
        const parts = [];
        if (likes) parts.push(`${likes} likes`);
        if (wouldBuy) parts.push(`${wouldBuy} would buy`);
        if (watching) parts.push(`${watching} watching`);
        return parts.join(' · ');
    }

    function detailHref(artwork = {}) {
        const canonical = artwork.canonical_v41_id ||
            ((artwork.chain_id || artwork.chainId) && (artwork.artwork_id || artwork.artworkId || artwork.blockchain_id)
                ? `v41:${artwork.chain_id || artwork.chainId}:${artwork.artwork_id || artwork.artworkId || artwork.blockchain_id}`
                : '');
        const id = canonical || artwork.id || '';
        return id ? `artwork.html?id=${encodeURIComponent(id)}` : '';
    }

    function prepareVideoPreview(video, artwork = {}, options = {}) {
        if (!video || (video.dataset.artsoulPreviewPrepared === 'true' && !options.force)) return;
        video.dataset.artsoulPreviewPrepared = 'true';

        const poster = posterUrl(artwork);
        if (poster) video.poster = poster;

        const renderFirstFrame = () => {
            const duration = Number(video.duration);
            if (!Number.isFinite(duration) || duration <= 0) return;
            const target = Math.min(0.1, Math.max(0, duration - 0.05));
            if (Math.abs(video.currentTime - target) < 0.01) return;
            try {
                video.currentTime = target;
            } catch {
                // The poster remains visible when a browser cannot seek before playback.
            }
        };

        if (video.readyState >= 1) renderFirstFrame();
        video.addEventListener('loadedmetadata', renderFirstFrame, { once: true });
        video.addEventListener('loadeddata', renderFirstFrame, { once: true });
        video.addEventListener('seeked', () => {
            video.closest('.artsoul-card-media')?.querySelector('.artsoul-media-loading')?.remove();
        }, { once: true });
    }

    function createMediaLoadingElement() {
        const loading = document.createElement('div');
        loading.className = 'artsoul-media-loading';
        loading.setAttribute('role', 'status');
        loading.setAttribute('aria-label', 'Loading media');
        return loading;
    }

    function createVideoFirstPaintGuard(video, descriptor) {
        const guard = descriptor.poster
            ? document.createElement('img')
            : createMediaLoadingElement();
        guard.className = descriptor.poster
            ? 'artsoul-video-poster'
            : guard.className;
        if (descriptor.poster) {
            guard.src = descriptor.poster;
            guard.alt = '';
            video.addEventListener('play', () => guard.remove(), { once: true });
            guard.onerror = () => {
                guard.className = 'artsoul-media-loading';
                guard.src = '';
                ['loadedmetadata', 'loadeddata', 'seeked'].forEach((eventName) => {
                    video.addEventListener(eventName, () => guard.remove(), { once: true });
                });
            };
        } else {
            // iOS commonly honours metadata loading but defers loadeddata until
            // playback. Revealing at metadata/seeked lets the prepared first
            // frame paint instead of leaving the homepage card covered forever.
            ['loadedmetadata', 'loadeddata', 'seeked', 'play'].forEach((eventName) => {
                video.addEventListener(eventName, () => guard.remove(), { once: true });
            });
        }
        return guard;
    }

    function reviveMediaPreviews(root = document) {
        root.querySelectorAll('.artsoul-card-media video').forEach((video) => {
            video.pause();
            const container = video.closest('.artsoul-card-media-video');
            if (container) container.dataset.playing = 'false';
            const toggle = container?.querySelector('.artsoul-media-toggle');
            if (toggle) syncPlaybackButton(toggle, video, 'video preview');
            prepareVideoPreview(video, {}, { force: true });
        });

        root.querySelectorAll('.artsoul-card-audio-element').forEach((audio) => {
            audio.pause();
            const wrap = audio.closest('.artsoul-card-audio');
            const avatar = wrap?.querySelector('.artsoul-card-audio-avatar');
            const toggle = wrap?.querySelector('.artsoul-media-toggle');
            if (avatar) avatar.dataset.playing = 'false';
            if (toggle) syncPlaybackButton(toggle, audio, 'audio preview');
        });

        if (window.matchMedia('(min-width: 769px) and (prefers-reduced-motion: no-preference)').matches) {
            root.querySelectorAll('.artsoul-card-audio-avatar').forEach((avatar) => {
                avatar.getAnimations?.().forEach((animation) => animation.play());
            });
        }

        window.dispatchEvent(new CustomEvent('artsoul:media-previews-restored'));
    }

    function createMediaElement(artwork = {}, onUnavailable = null) {
        const descriptor = mediaDescriptor(artwork);
        const { type, url } = descriptor;
        const container = document.createElement('div');
        container.className = 'artsoul-card-media';

        if (!descriptor.known) {
            container.appendChild(createMediaLoadingElement());
            return container;
        }

        if (type === 'video') {
            container.classList.add('artsoul-card-media-video');
            container.dataset.playing = 'false';
            const video = document.createElement('video');
            video.src = url;
            video.className = 'artsoul-card-media-object';
            video.preload = 'metadata';
            video.poster = descriptor.poster;
            video.playsInline = true;
            video.muted = true;
            video.style.pointerEvents = 'none';
            prepareVideoPreview(video, artwork);
            const badge = document.createElement('span');
            badge.className = 'artsoul-card-media-badge';
            badge.textContent = 'VIDEO';
            const controls = document.createElement('div');
            controls.className = 'artsoul-card-media-controls';
            isolateMediaControl(controls);
            const toggle = createPlaybackButton(video, 'video preview');
            const mute = createMuteButton(video, 'video preview');
            const sync = () => {
                container.dataset.playing = String(!video.paused && !video.ended);
                syncPlaybackButton(toggle, video, 'video preview');
            };
            video.addEventListener('play', () => { pauseOtherMedia(video); sync(); });
            video.addEventListener('pause', sync);
            video.addEventListener('ended', sync);
            video.addEventListener('error', () => onUnavailable?.());
            video.addEventListener('volumechange', () => syncMuteButton(mute, video, 'video preview'));
            controls.append(toggle, mute);
            container.append(video, badge, controls, createVideoFirstPaintGuard(video, descriptor));
            return container;
        }

        if (type === 'audio') {
            const audioWrap = document.createElement('div');
            audioWrap.className = 'artsoul-card-audio';
            const label = document.createElement('div');
            label.className = 'artsoul-card-audio-label';
            label.textContent = 'AUDIO';
            const avatar = document.createElement('img');
            avatar.className = 'artsoul-card-audio-avatar';
            avatar.src = 'ARTSOULlogo.png';
            avatar.alt = '';
            avatar.dataset.playing = 'false';
            const audio = document.createElement('audio');
            audio.src = url;
            audio.preload = 'metadata';
            audio.className = 'artsoul-card-audio-element';
            const controls = document.createElement('div');
            controls.className = 'artsoul-card-media-controls';
            isolateMediaControl(controls);
            const toggle = createPlaybackButton(audio, 'audio preview');
            const mute = createMuteButton(audio, 'audio preview');
            const sync = () => {
                const playing = !audio.paused && !audio.ended;
                avatar.dataset.playing = String(playing);
                syncPlaybackButton(toggle, audio, 'audio preview');
            };
            audio.addEventListener('play', () => { pauseOtherMedia(audio); sync(); });
            audio.addEventListener('pause', sync);
            audio.addEventListener('ended', sync);
            audio.addEventListener('error', () => onUnavailable?.());
            audio.addEventListener('volumechange', () => syncMuteButton(mute, audio, 'audio preview'));
            controls.append(toggle, mute);
            audioWrap.appendChild(label);
            audioWrap.appendChild(avatar);
            audioWrap.appendChild(controls);
            audioWrap.appendChild(audio);
            container.appendChild(audioWrap);
            return container;
        }

        const img = document.createElement('img');
        img.src = url;
        img.alt = artwork.title || 'Artwork';
        img.className = 'artsoul-card-media-object';
        img.onerror = () => onUnavailable?.();
        container.appendChild(img);
        return container;
    }

    function createCardElement(artwork = {}, options = {}) {
        if (options.respectHidden !== false && isHidden(artwork)) return null;
        if (!hasSafeMedia(artwork)) return null;

        const href = options.href === false ? '' : (options.href || detailHref(artwork));
        const card = document.createElement(href ? 'a' : 'div');
        const minimal = options.minimal === true;
        const surfaceClass = options.surface ? ` artsoul-artwork-card-${options.surface}` : '';
        card.className = `artsoul-artwork-card${minimal ? ' artsoul-artwork-card-minimal' : ''}${surfaceClass}`;
        if (href) card.href = href;
        if (options.onClick) card.addEventListener('click', options.onClick);

        const status = minimal ? discoveryStatusInfo(artwork) : statusInfo(artwork);
        const body = document.createElement('div');
        body.className = 'artsoul-card-body';

        const title = document.createElement('h3');
        title.className = 'artsoul-card-title';
        title.textContent = artwork.title || 'Untitled Artwork';

        const creator = document.createElement('p');
        creator.className = 'artsoul-card-creator';
        creator.textContent = `Creator: ${creatorLabel(artwork)}`;

        const meta = document.createElement('div');
        meta.className = 'artsoul-card-meta';
        const badge = document.createElement('span');
        badge.className = `artsoul-card-status artsoul-card-status-${status.key}`;
        badge.textContent = status.label;
        meta.appendChild(badge);

        const price = minimal ? formatDiscoveryPrice(artwork) : formatPrice(artwork);
        if (price) {
            const priceEl = document.createElement('span');
            priceEl.className = 'artsoul-card-price';
            priceEl.textContent = price;
            meta.appendChild(priceEl);
        }

        body.appendChild(title);
        body.appendChild(creator);
        body.appendChild(meta);

        card.appendChild(createMediaElement(artwork, () => card.remove()));
        card.appendChild(body);
        return card;
    }

    function reactMediaLoading(h) {
        return h('div', { className: 'artsoul-media-loading', role: 'status', 'aria-label': 'Loading media' });
    }

    function ReactMedia({ artwork, onUnavailable = null }) {
        const React = window.React;
        const h = React.createElement;
        const descriptor = mediaDescriptor(artwork);
        const { type, url } = descriptor;
        if (!url || !hasSafeMedia(artwork)) return null;
        if (!descriptor.known) {
            return h('div', { className: 'artsoul-card-media' }, reactMediaLoading(h));
        }
        if (type === 'video') return h(ReactVideoPreview, { artwork, descriptor, onUnavailable });
        if (type === 'audio') return h(ReactAudioPreview, { artwork, url, onUnavailable });
        return h('div', { className: 'artsoul-card-media' },
            h('img', {
                src: url,
                alt: artwork.title || 'Artwork',
                className: 'artsoul-card-media-object',
                onError: onUnavailable || undefined
            })
        );
    }

    function ReactVideoPreview({ artwork, descriptor, onUnavailable = null }) {
        const React = window.React;
        const h = React.createElement;
        const { url, poster } = descriptor;
        const ref = React.useRef(null);
        const [playing, setPlaying] = React.useState(false);
        const [muted, setMuted] = React.useState(true);
        const [loaded, setLoaded] = React.useState(false);
        const [started, setStarted] = React.useState(false);
        const [posterFailed, setPosterFailed] = React.useState(false);
        React.useEffect(() => {
            setLoaded(false);
            setStarted(false);
            setPosterFailed(false);
            return () => ref.current?.pause();
        }, [url]);
        React.useEffect(() => {
            const restore = () => {
                const video = ref.current;
                if (!video) return;
                video.pause();
                setPlaying(false);
                setStarted(false);
                setLoaded(video.readyState >= 1);
                prepareVideoPreview(video, artwork, { force: true });
            };
            window.addEventListener('artsoul:media-previews-restored', restore);
            return () => window.removeEventListener('artsoul:media-previews-restored', restore);
        }, [artwork, url]);
        const toggle = event => {
            stopCardActivation(event);
            const video = ref.current;
            if (video) video.paused ? video.play().catch(() => setPlaying(false)) : video.pause();
        };
        const toggleMute = event => {
            stopCardActivation(event);
            const video = ref.current;
            if (!video) return;
            video.muted = !video.muted;
            setMuted(video.muted);
        };
        return h('div', { className: 'artsoul-card-media artsoul-card-media-video', 'data-playing': String(playing) },
            h('video', { ref, src: url, className: 'artsoul-card-media-object', preload: 'metadata', playsInline: true,
                poster: posterFailed ? '' : poster, muted, style: { pointerEvents: 'none' },
                onLoadedMetadata: event => { prepareVideoPreview(event.currentTarget, artwork); setLoaded(true); },
                onLoadedData: () => setLoaded(true),
                onPlay: event => { pauseOtherMedia(event.currentTarget); setPlaying(true); setStarted(true); },
                onPause: () => setPlaying(false), onEnded: () => setPlaying(false),
                onError: onUnavailable || undefined,
                onVolumeChange: event => setMuted(event.currentTarget.muted) }),
            h('span', { className: 'artsoul-card-media-badge' }, 'VIDEO'),
            h('div', { className: 'artsoul-card-media-controls', draggable: false,
                onClick: stopCardActivation, onPointerDown: stopCardPropagation, onMouseDown: stopCardPropagation,
                onTouchStart: stopCardPropagation, onDragStart: stopCardActivation },
                h('button', { type: 'button', className: 'artsoul-media-toggle', 'data-state': playing ? 'playing' : 'paused',
                    'aria-label': `${playing ? 'Pause' : 'Play'} video preview`, draggable: false,
                    onClick: toggle, onPointerDown: stopCardPropagation, onMouseDown: stopCardPropagation,
                    onTouchStart: stopCardPropagation, onDragStart: stopCardActivation }),
                h('button', { type: 'button', className: 'artsoul-media-mute', 'data-muted': String(muted),
                    'aria-label': `${muted ? 'Unmute' : 'Mute'} video preview`, draggable: false,
                    onClick: toggleMute, onPointerDown: stopCardPropagation, onMouseDown: stopCardPropagation,
                    onTouchStart: stopCardPropagation, onDragStart: stopCardActivation })
            ),
            poster && !posterFailed && !started
                ? h('img', { src: poster, alt: '', className: 'artsoul-video-poster', onError: () => setPosterFailed(true) })
                : (!loaded ? reactMediaLoading(h) : null)
        );
    }

    function ReactAudioPreview({ artwork, url, onUnavailable = null }) {
        const React = window.React;
        const h = React.createElement;
        const ref = React.useRef(null);
        const [playing, setPlaying] = React.useState(false);
        const [muted, setMuted] = React.useState(false);
        React.useEffect(() => () => ref.current?.pause(), [url]);
        React.useEffect(() => {
            const restore = () => {
                ref.current?.pause();
                setPlaying(false);
            };
            window.addEventListener('artsoul:media-previews-restored', restore);
            return () => window.removeEventListener('artsoul:media-previews-restored', restore);
        }, [url]);
        const toggle = event => {
            stopCardActivation(event);
            const audio = ref.current;
            if (audio) audio.paused ? audio.play().catch(() => setPlaying(false)) : audio.pause();
        };
        const toggleMute = event => {
            stopCardActivation(event);
            const audio = ref.current;
            if (!audio) return;
            audio.muted = !audio.muted;
            setMuted(audio.muted);
        };
        return h('div', { className: 'artsoul-card-media' },
            h('div', { className: 'artsoul-card-audio' },
                h('div', { className: 'artsoul-card-audio-label' }, 'AUDIO'),
                h('img', { src: 'ARTSOULlogo.png', alt: '', className: 'artsoul-card-audio-avatar', 'data-playing': String(playing) }),
                h('div', { className: 'artsoul-card-media-controls', draggable: false,
                    onClick: stopCardActivation, onPointerDown: stopCardPropagation, onMouseDown: stopCardPropagation,
                    onTouchStart: stopCardPropagation, onDragStart: stopCardActivation },
                    h('button', { type: 'button', className: 'artsoul-media-toggle', 'data-state': playing ? 'playing' : 'paused',
                        'aria-label': `${playing ? 'Pause' : 'Play'} audio preview`, draggable: false,
                        onClick: toggle, onPointerDown: stopCardPropagation, onMouseDown: stopCardPropagation,
                        onTouchStart: stopCardPropagation, onDragStart: stopCardActivation }),
                    h('button', { type: 'button', className: 'artsoul-media-mute', 'data-muted': String(muted),
                        'aria-label': `${muted ? 'Unmute' : 'Mute'} audio preview`, draggable: false,
                        onClick: toggleMute, onPointerDown: stopCardPropagation, onMouseDown: stopCardPropagation,
                        onTouchStart: stopCardPropagation, onDragStart: stopCardActivation })
                ),
                h('audio', { ref, src: url, className: 'artsoul-card-audio-element', preload: 'metadata', muted,
                    onPlay: event => { pauseOtherMedia(event.currentTarget); setPlaying(true); },
                    onPause: () => setPlaying(false), onEnded: () => setPlaying(false),
                    onError: onUnavailable || undefined,
                    onVolumeChange: event => setMuted(event.currentTarget.muted) })
            )
        );
    }

    function ReactCard({ artwork = {}, onOpen = null, actions = null, respectHidden = true, minimal = false, surface = '' }) {
        const React = window.React;
        const h = React.createElement;
        const [mediaUnavailable, setMediaUnavailable] = React.useState(false);
        React.useEffect(() => setMediaUnavailable(false), [mediaUrl(artwork)]);
        if (respectHidden !== false && isHidden(artwork)) return null;
        if (!hasSafeMedia(artwork) || mediaUnavailable) return null;

        const status = minimal ? discoveryStatusInfo(artwork) : statusInfo(artwork);
        const price = minimal ? formatDiscoveryPrice(artwork) : formatPrice(artwork);
        return h('div', {
            className: `artsoul-artwork-card${minimal ? ' artsoul-artwork-card-minimal' : ''}${surface ? ` artsoul-artwork-card-${surface}` : ''}`,
            onClick: onOpen || undefined,
            role: onOpen ? 'button' : undefined,
            tabIndex: onOpen ? 0 : undefined,
            onKeyDown: onOpen ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpen(event);
                }
            } : undefined
        },
            h(ReactMedia, { artwork, onUnavailable: () => setMediaUnavailable(true) }),
            h('div', { className: 'artsoul-card-body' },
                h('h3', { className: 'artsoul-card-title' }, artwork.title || 'Untitled Artwork'),
                h('p', { className: 'artsoul-card-creator' }, `Creator: ${creatorLabel(artwork)}`),
                h('div', { className: 'artsoul-card-meta' },
                    h('span', { className: `artsoul-card-status artsoul-card-status-${status.key}` }, status.label),
                    price ? h('span', { className: 'artsoul-card-price' }, price) : null
                ),
                actions ? h('div', { className: 'artsoul-card-actions', onClick: event => event.stopPropagation() }, actions) : null
            )
        );
    }

    if (!window.__artsoulMediaRestoreBound) {
        window.__artsoulMediaRestoreBound = true;
        window.addEventListener('pageshow', (event) => {
            const navigationType = performance.getEntriesByType?.('navigation')?.[0]?.type;
            if (event.persisted || navigationType === 'back_forward') {
                requestAnimationFrame(() => reviveMediaPreviews(document));
            }
        });
    }

    window.ArtSoulArtworkCard = {
        createCardElement,
        createMediaElement,
        ReactCard,
        ReactMedia,
        statusInfo,
        discoveryStatusInfo,
        isListedForSale,
        isHidden,
        identityKeys,
        mediaUrl,
        posterUrl,
        mediaType,
        mediaDescriptor,
        hasSafeMedia,
        detailHref,
        prepareVideoPreview,
        reviveMediaPreviews,
        signalsText,
        toTimestamp
    };
})();
