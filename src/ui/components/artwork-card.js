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
        return '';
    }

    function mediaType(artwork = {}) {
        const type = normalize(artwork.file_type || artwork.media_type || artwork.mime_type);
        const urlTypes = mediaCandidates(artwork).map(mediaTypeFromUrl);
        if (type.includes('video') || ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(type) || urlTypes.includes('video')) return 'video';
        if (type.includes('audio') || type === 'music' || ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'].includes(type) || urlTypes.includes('audio')) return 'audio';
        return 'image';
    }

    function mediaUrl(artwork = {}) {
        const type = mediaType(artwork);
        const candidates = mediaCandidates(artwork);
        if (type === 'video' || type === 'audio') {
            return candidates.find(candidate => mediaTypeFromUrl(candidate) === type) || candidates[0] || '';
        }
        return artwork.image || artwork.image_url || artwork.file_url || artwork.media_url || artwork.animation_url || '';
    }

    function posterUrl(artwork = {}) {
        const media = normalize(mediaUrl(artwork));
        const candidate = artwork.poster_url || artwork.thumbnail_url || artwork.preview_image || artwork.image || artwork.image_url || '';
        return candidate && normalize(candidate) !== media ? candidate : '';
    }

    function hasSafeMedia(artwork = {}) {
        const url = mediaUrl(artwork);
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
        if (isListedForSale(artwork)) return { key: 'listed', label: 'Listed for sale' };
        if (minted || status === 'sold' || status === 'settled') return { key: 'sold', label: 'Sold' };
        if (awaitingSettlement) return { key: 'awaiting_settlement', label: 'Awaiting settlement' };
        if (noBids || ((expired || ended || defaulted) && !hasBid)) {
            return { key: 'ended_no_bids', label: 'Ended — no bids' };
        }
        if (defaulted) return { key: 'unsettled', label: 'Auction unsettled' };
        if ((expired || ended) && hasBid) {
            return { key: 'ended', label: 'Auction Ended' };
        }
        if (activeAuctionId(artwork) && !expired && !minted) return { key: 'live', label: 'Live Auction' };
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

    function mediaPlaceholderElement(label = 'Media unavailable') {
        const placeholder = document.createElement('div');
        placeholder.className = 'artsoul-card-media-placeholder';
        placeholder.textContent = label;
        return placeholder;
    }

    function prepareVideoPreview(video, artwork = {}) {
        if (!video || video.dataset.artsoulPreviewPrepared === 'true') return;
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
    }

    function createMediaElement(artwork = {}) {
        const url = mediaUrl(artwork);
        const container = document.createElement('div');
        container.className = 'artsoul-card-media';

        if (!url || !hasSafeMedia(artwork)) {
            container.appendChild(mediaPlaceholderElement('Media unavailable'));
            return container;
        }

        const type = mediaType(artwork);
        if (type === 'video') {
            const video = document.createElement('video');
            video.src = url;
            video.className = 'artsoul-card-media-object';
            video.preload = 'auto';
            video.poster = posterUrl(artwork) || 'ARTSOULlogo-clean.png';
            video.playsInline = true;
            video.style.pointerEvents = 'none';
            prepareVideoPreview(video, artwork);
            const frame = document.createElement('div');
            frame.className = 'artsoul-card-video-frame';
            frame.appendChild(video);
            const badge = document.createElement('span');
            badge.className = 'artsoul-card-media-badge';
            badge.textContent = 'VIDEO';
            frame.appendChild(badge);
            const controls = document.createElement('div');
            controls.className = 'artsoul-card-media-controls';
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'artsoul-media-toggle';
            toggle.dataset.state = 'paused';
            toggle.setAttribute('aria-label', 'Play video preview');
            const progress = document.createElement('input');
            progress.type = 'range';
            progress.className = 'artsoul-media-progress';
            progress.min = '0'; progress.max = '1'; progress.step = '0.01'; progress.value = '0'; progress.disabled = true;
            progress.setAttribute('aria-label', 'Video progress');
            [controls, toggle, progress].forEach(control => {
                control.addEventListener('click', stopCardActivation);
                control.addEventListener('pointerdown', stopCardPropagation);
                control.addEventListener('touchstart', stopCardPropagation);
            });
            toggle.addEventListener('click', () => video.paused ? video.play().catch(() => {}) : video.pause());
            const sync = () => {
                const playing = !video.paused && !video.ended;
                toggle.dataset.state = playing ? 'playing' : 'paused';
                toggle.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} video preview`);
            };
            video.addEventListener('play', () => { pauseOtherMedia(video); sync(); });
            video.addEventListener('pause', sync);
            video.addEventListener('ended', sync);
            video.addEventListener('loadedmetadata', () => {
                if (Number.isFinite(video.duration) && video.duration > 0) { progress.max = String(video.duration); progress.disabled = false; }
            });
            video.addEventListener('timeupdate', () => { progress.value = String(video.currentTime || 0); });
            progress.addEventListener('input', () => { video.currentTime = Number(progress.value) || 0; });
            controls.append(toggle, progress);
            container.classList.add('artsoul-card-media-video');
            container.append(frame, controls);
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
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'artsoul-media-toggle';
            toggle.dataset.state = 'paused';
            toggle.setAttribute('aria-label', 'Play audio preview');
            [toggle].forEach(control => {
                control.addEventListener('click', stopCardActivation);
                control.addEventListener('pointerdown', stopCardPropagation);
                control.addEventListener('touchstart', stopCardPropagation);
            });
            toggle.addEventListener('click', () => audio.paused ? audio.play().catch(() => {}) : audio.pause());
            const sync = () => {
                const playing = !audio.paused && !audio.ended;
                avatar.dataset.playing = String(playing);
                toggle.dataset.state = playing ? 'playing' : 'paused';
                toggle.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} audio preview`);
            };
            audio.addEventListener('play', () => { pauseOtherMedia(audio); sync(); });
            audio.addEventListener('pause', sync);
            audio.addEventListener('ended', sync);
            audioWrap.appendChild(label);
            audioWrap.appendChild(avatar);
            audioWrap.appendChild(toggle);
            audioWrap.appendChild(audio);
            container.appendChild(audioWrap);
            return container;
        }

        const img = document.createElement('img');
        img.src = url;
        img.alt = artwork.title || 'Artwork';
        img.className = 'artsoul-card-media-object';
        img.onerror = () => {
            container.replaceChildren(mediaPlaceholderElement('Media unavailable'));
        };
        container.appendChild(img);
        return container;
    }

    function createCardElement(artwork = {}, options = {}) {
        if (options.respectHidden !== false && isHidden(artwork)) return null;

        const href = options.href === false ? '' : (options.href || detailHref(artwork));
        const card = document.createElement(href ? 'a' : 'div');
        const minimal = options.minimal === true;
        card.className = `artsoul-artwork-card${minimal ? ' artsoul-artwork-card-minimal' : ''}`;
        if (href) card.href = href;
        if (options.onClick) card.addEventListener('click', options.onClick);

        const status = minimal ? discoveryStatusInfo(artwork) : statusInfo(artwork);
        const body = document.createElement('div');
        body.className = 'artsoul-card-body';

        const eyebrow = document.createElement('div');
        eyebrow.className = 'artsoul-card-eyebrow';
        eyebrow.textContent = options.slotLabel || status.label;

        const title = document.createElement('h3');
        title.className = 'artsoul-card-title';
        title.textContent = artwork.title || 'Untitled Artwork';

        const desc = document.createElement('p');
        desc.className = 'artsoul-card-description';
        desc.textContent = artwork.description || '';

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

        const signal = document.createElement('p');
        signal.className = 'artsoul-card-signals';
        const showSignals = options.showSignals === true;
        signal.textContent = signalsText(artwork, showSignals) || options.reason || '';

        if (!minimal) body.appendChild(eyebrow);
        body.appendChild(title);
        if (!minimal) body.appendChild(desc);
        body.appendChild(meta);
        if ((!minimal || showSignals) && signal.textContent) body.appendChild(signal);

        card.appendChild(createMediaElement(artwork));
        card.appendChild(body);
        return card;
    }

    function ReactMedia({ artwork }) {
        const React = window.React;
        const h = React.createElement;
        const url = mediaUrl(artwork);
        if (!url || !hasSafeMedia(artwork)) {
            return h('div', { className: 'artsoul-card-media' },
                h('div', { className: 'artsoul-card-media-placeholder' }, 'Media unavailable')
            );
        }
        const type = mediaType(artwork);
        if (type === 'video') return h(ReactVideoPreview, { artwork, url });
        if (type === 'audio') return h(ReactAudioPreview, { artwork, url });
        return h('div', { className: 'artsoul-card-media' },
            h('img', {
                src: url,
                alt: artwork.title || 'Artwork',
                className: 'artsoul-card-media-object'
            })
        );
    }

    function ReactVideoPreview({ artwork, url }) {
        const React = window.React;
        const h = React.createElement;
        const ref = React.useRef(null);
        const [playing, setPlaying] = React.useState(false);
        const [duration, setDuration] = React.useState(0);
        const [time, setTime] = React.useState(0);
        React.useEffect(() => () => ref.current?.pause(), [url]);
        const toggle = event => {
            stopCardActivation(event);
            const video = ref.current;
            if (video) video.paused ? video.play().catch(() => setPlaying(false)) : video.pause();
        };
        return h('div', { className: 'artsoul-card-media artsoul-card-media-video' },
            h('div', { className: 'artsoul-card-video-frame' },
                h('video', { ref, src: url, className: 'artsoul-card-media-object', preload: 'auto', playsInline: true,
                    poster: posterUrl(artwork) || 'ARTSOULlogo-clean.png', style: { pointerEvents: 'none' },
                    onLoadedMetadata: event => { prepareVideoPreview(event.currentTarget, artwork); setDuration(event.currentTarget.duration || 0); },
                    onTimeUpdate: event => setTime(event.currentTarget.currentTime || 0),
                    onPlay: event => { pauseOtherMedia(event.currentTarget); setPlaying(true); },
                    onPause: () => setPlaying(false), onEnded: () => setPlaying(false) }),
                h('span', { className: 'artsoul-card-media-badge' }, 'VIDEO')
            ),
            h('div', { className: 'artsoul-card-media-controls', onClick: stopCardActivation, onPointerDown: stopCardPropagation, onTouchStart: stopCardPropagation },
                h('button', { type: 'button', className: 'artsoul-media-toggle', 'data-state': playing ? 'playing' : 'paused',
                    'aria-label': `${playing ? 'Pause' : 'Play'} video preview`, onClick: toggle }),
                h('input', { type: 'range', className: 'artsoul-media-progress', min: 0, max: duration || 1, step: 0.01,
                    value: Math.min(time, duration || 1), disabled: !duration, 'aria-label': 'Video progress',
                    onChange: event => { event.stopPropagation(); if (ref.current) ref.current.currentTime = Number(event.currentTarget.value) || 0; },
                    onClick: stopCardActivation, onPointerDown: stopCardPropagation, onTouchStart: stopCardPropagation })
            )
        );
    }

    function ReactAudioPreview({ artwork, url }) {
        const React = window.React;
        const h = React.createElement;
        const ref = React.useRef(null);
        const [playing, setPlaying] = React.useState(false);
        React.useEffect(() => () => ref.current?.pause(), [url]);
        const toggle = event => {
            stopCardActivation(event);
            const audio = ref.current;
            if (audio) audio.paused ? audio.play().catch(() => setPlaying(false)) : audio.pause();
        };
        return h('div', { className: 'artsoul-card-media' },
            h('div', { className: 'artsoul-card-audio' },
                h('div', { className: 'artsoul-card-audio-label' }, 'AUDIO'),
                h('img', { src: 'ARTSOULlogo.png', alt: '', className: 'artsoul-card-audio-avatar', 'data-playing': String(playing) }),
                h('button', { type: 'button', className: 'artsoul-media-toggle', 'data-state': playing ? 'playing' : 'paused',
                    'aria-label': `${playing ? 'Pause' : 'Play'} audio preview`, onClick: toggle,
                    onPointerDown: stopCardPropagation, onTouchStart: stopCardPropagation }),
                h('audio', { ref, src: url, className: 'artsoul-card-audio-element', preload: 'metadata',
                    onPlay: event => { pauseOtherMedia(event.currentTarget); setPlaying(true); },
                    onPause: () => setPlaying(false), onEnded: () => setPlaying(false) })
            )
        );
    }

    function ReactCard({ artwork = {}, slotLabel = '', reason = '', onOpen = null, actions = null, respectHidden = true, minimal = false, showSignals = false }) {
        const React = window.React;
        const h = React.createElement;
        if (respectHidden !== false && isHidden(artwork)) return null;

        const status = minimal ? discoveryStatusInfo(artwork) : statusInfo(artwork);
        const price = minimal ? formatDiscoveryPrice(artwork) : formatPrice(artwork);
        const signals = signalsText(artwork, showSignals);
        return h('div', {
            className: `artsoul-artwork-card${minimal ? ' artsoul-artwork-card-minimal' : ''}`,
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
            h(ReactMedia, { artwork }),
            h('div', { className: 'artsoul-card-body' },
                minimal ? null : h('div', { className: 'artsoul-card-eyebrow' }, slotLabel || status.label),
                h('h3', { className: 'artsoul-card-title' }, artwork.title || 'Untitled Artwork'),
                minimal ? null : h('p', { className: 'artsoul-card-description' }, artwork.description || ''),
                h('div', { className: 'artsoul-card-meta' },
                    h('span', { className: `artsoul-card-status artsoul-card-status-${status.key}` }, status.label),
                    price ? h('span', { className: 'artsoul-card-price' }, price) : null
                ),
                (!minimal || showSignals) && (signals || reason)
                    ? h('p', { className: 'artsoul-card-signals' }, signals || reason)
                    : null,
                actions ? h('div', { className: 'artsoul-card-actions', onClick: event => event.stopPropagation() }, actions) : null
            )
        );
    }

    window.ArtSoulArtworkCard = {
        createCardElement,
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
        hasSafeMedia,
        detailHref,
        prepareVideoPreview,
        signalsText,
        toTimestamp
    };
})();
