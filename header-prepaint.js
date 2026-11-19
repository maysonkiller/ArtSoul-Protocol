// Visual identity only; never authenticates or unlocks wallet actions.
(function () {
    'use strict';

    const WALLET_PATTERN = /^0x[a-f0-9]{40}$/;
    const MOBILE_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
    const PREVIEW_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
    const PRELOADABLE_AVATAR_URL = /^(?:https:\/\/[^/\s]|\/(?!\/))/;
    const PREVIEW_MAX_LENGTH = 32 * 1024;
    const NEUTRAL_AVATAR_URL = '/default-avatar.png';
    let neutralAvatar = NEUTRAL_AVATAR_URL;

    const read = key => {
        try { return localStorage.getItem(key); } catch { return null; }
    };

    const readIdentity = () => {
        try {
            const identity = JSON.parse(read('artsoul_header_identity') || 'null');
            const wallet = String(identity?.wallet || '').toLowerCase();
            if (!WALLET_PATTERN.test(wallet)) return null;
            if (!identity?.name || !identity?.avatarUrl) return null;
            return { ...identity, wallet };
        } catch {
            return null;
        }
    };

    const cachedUiState = read('artsoul_header_ui_state');
    const walletHint = String(read('artsoul_wallet') || '').toLowerCase();
    const identity = readIdentity();
    const appKitDisconnectedAtBoot = read('artsoul_disconnecting') === 'true'
        || (!MOBILE_PATTERN.test(navigator.userAgent)
            && read('@appkit/connection_status') === 'disconnected');
    const wallet = WALLET_PATTERN.test(walletHint)
        ? walletHint
        : (cachedUiState === 'connected' ? identity?.wallet || '' : '');
    const hasWallet = WALLET_PATTERN.test(wallet);
    const notificationWallet = !appKitDisconnectedAtBoot && cachedUiState === 'connected'
        && hasWallet && wallet === walletHint && identity?.wallet === wallet ? wallet : '';

    if (notificationWallet && PRELOADABLE_AVATAR_URL.test(identity.avatarUrl)) {
        const preload = document.createElement('link');
        preload.rel = 'preload';
        preload.as = 'image';
        preload.href = identity.avatarUrl;
        document.head?.appendChild(preload);
    }

    const readPreview = () => {
        const preview = identity?.preview;
        if (!preview || identity.wallet !== wallet) return null;
        if (String(preview.wallet || '').toLowerCase() !== wallet) return null;
        if (preview.name !== identity.name || preview.source !== identity.avatarUrl) return null;
        if (typeof preview.dataUri !== 'string' || preview.dataUri.length > PREVIEW_MAX_LENGTH) return null;
        return PREVIEW_PATTERN.test(preview.dataUri) ? preview.dataUri : null;
    };

    const preview = readPreview();
    if (!appKitDisconnectedAtBoot && !preview && (hasWallet || cachedUiState === 'connected')) {
        document.documentElement.classList.add('wallet-state-resolving');
    }

    const hydrate = (container) => {
        const inbox = document.getElementById('header-notifications');
        if (inbox) { inbox.hidden = false; inbox.dataset.notificationWallet = notificationWallet; }
        if (!container) return false;
        const button = container.querySelector('.avatar-button');
        const image = button?.querySelector('[data-avatar-image]');
        const name = container.querySelector('[data-avatar-name]');
        const address = container.querySelector('[data-avatar-address]');
        if (!button || !image || !name || !address) return false;
        try {
            const cached = sessionStorage.getItem('artsoul_header_provider_mark');
            const mark = cached?.split(':')[1];
            if (notificationWallet && (mark === 'rabby' || mark === 'metamask') && cached === notificationWallet + ':' + mark) {
                button.dataset.providerPreview = mark;
            } else if (cached) sessionStorage.removeItem('artsoul_header_provider_mark');
        } catch { /* Session storage is optional. */ }
        const shellSource = image.getAttribute('src') || '';
        if (image.dataset.avatarSource === NEUTRAL_AVATAR_URL && PREVIEW_PATTERN.test(shellSource)) {
            neutralAvatar = shellSource;
        }

        const commit = ({ renderKey, source = NEUTRAL_AVATAR_URL, paintSource = neutralAvatar,
            label, shortAddress = '', imageIdentity = shortAddress || 'guest', uiState }) => {
            const displayAddress = shortAddress && label.toLowerCase() !== shortAddress.toLowerCase()
                ? shortAddress
                : '';
            if (image.getAttribute('src') !== paintSource) image.src = paintSource;
            image.alt = label;
            image.dataset.avatarSource = source;
            image.dataset.avatarIdentity = imageIdentity;
            name.textContent = label;
            address.hidden = !displayAddress;
            address.textContent = displayAddress;
            address.setAttribute('aria-hidden', String(!displayAddress));
            button.dataset.avatarContentKey = `${renderKey}|${source}|${label}|${displayAddress}`;
            container.dataset.avatarRenderKey = renderKey === `identity:${wallet}` ? 'cached-wallet' : renderKey;
            container.setAttribute('aria-busy', uiState === 'resolving' ? 'true' : 'false');
            document.documentElement.dataset.walletUiState = uiState;
            document.documentElement.classList.toggle('wallet-state-resolving', uiState === 'resolving');
        };

        if (appKitDisconnectedAtBoot || !hasWallet) {
            const renderKey = appKitDisconnectedAtBoot ? 'initializing-disconnected' : 'initializing';
            delete container.dataset.avatarCacheHydrated;
            commit({
                renderKey,
                label: 'ArtSoul Guest',
                uiState: 'disconnected'
            });
            return true;
        }

        const shortAddress = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
        if (preview) {
            container.dataset.avatarCacheHydrated = 'true';
            commit({
                renderKey: `identity:${wallet}`,
                source: identity.avatarUrl,
                paintSource: preview,
                label: identity.name,
                shortAddress,
                uiState: 'restoring'
            });
            return true;
        }

        const settledWithoutPicture = identity?.wallet === wallet && identity.avatarUrl === NEUTRAL_AVATAR_URL;
        delete container.dataset.avatarCacheHydrated;
        commit({
            renderKey: `resolving:${wallet}`,
            label: settledWithoutPicture ? identity.name : shortAddress,
            shortAddress,
            uiState: 'resolving'
        });
        return true;
    };

    window.ArtSoulHeaderPrepaint = Object.freeze({
        hydrate,
        get neutralAvatar() { return neutralAvatar; },
        boot: Object.freeze({ appKitDisconnectedAtBoot, notificationWallet })
    });
})();
