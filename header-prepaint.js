// Tiny synchronous first-frame bridge for the shared account button.
//
// This file is intentionally small and has no wallet SDK dependency. It only
// restores a previously confirmed VISUAL identity from localStorage while the
// deferred account component and wallet provider start. It never authenticates
// a wallet and never exposes connected-only actions before provider settlement.
(function () {
    'use strict';

    const WALLET_PATTERN = /^0x[a-f0-9]{40}$/;
    const MOBILE_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
    const PREVIEW_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
    const PRELOADABLE_AVATAR_URL = /^(?:https:\/\/[^/\s]|\/(?!\/))/;
    const PREVIEW_MAX_LENGTH = 32 * 1024;
    const NEUTRAL_AVATAR_URL = '/default-avatar.png';

    const read = (key) => {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
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
    const appKitDisconnectedAtBoot = !MOBILE_PATTERN.test(navigator.userAgent)
        && read('@appkit/connection_status') === 'disconnected';
    const wallet = WALLET_PATTERN.test(walletHint)
        ? walletHint
        : (cachedUiState === 'connected' ? identity?.wallet || '' : '');
    const hasWallet = WALLET_PATTERN.test(wallet);

    if (!appKitDisconnectedAtBoot
        && WALLET_PATTERN.test(walletHint)
        && cachedUiState === 'connected'
        && identity?.wallet === walletHint
        && PRELOADABLE_AVATAR_URL.test(identity.avatarUrl)) {
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

    // Claim to be resolving only with nothing to paint: this label showed for
    // every line of markup between <head> and hydrate(). See its test.
    if (!appKitDisconnectedAtBoot && !readPreview()
        && (hasWallet || cachedUiState === 'connected')) {
        document.documentElement.classList.add('wallet-state-resolving');
    }

    const writeAddress = (node, value) => {
        if (!node) return;
        node.hidden = !value;
        node.textContent = value;
        node.setAttribute('aria-hidden', value ? 'false' : 'true');
    };

    const hydrate = (container) => {
        if (!container) return false;
        const button = container.querySelector('.avatar-button');
        const image = button?.querySelector('[data-avatar-image]');
        const name = button?.querySelector('[data-avatar-name]');
        const address = button?.querySelector('[data-avatar-address]');
        if (!button || !image || !name || !address) return false;

        const commit = ({ renderKey, source, paintSource, label, shortAddress, imageIdentity, uiState }) => {
            const displayAddress = shortAddress && label.toLowerCase() !== shortAddress.toLowerCase()
                ? shortAddress
                : '';
            image.src = paintSource;
            image.alt = label;
            image.dataset.avatarSource = source;
            image.dataset.avatarIdentity = imageIdentity;
            name.textContent = label;
            writeAddress(address, displayAddress);
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
                source: NEUTRAL_AVATAR_URL,
                paintSource: NEUTRAL_AVATAR_URL,
                label: 'ArtSoul Guest',
                shortAddress: '',
                imageIdentity: 'guest',
                uiState: 'disconnected'
            });
            return true;
        }

        const shortAddress = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
        const preview = readPreview();
        if (preview) {
            container.dataset.avatarCacheHydrated = 'true';
            commit({
                renderKey: `identity:${wallet}`,
                source: identity.avatarUrl,
                paintSource: preview,
                label: identity.name,
                shortAddress,
                imageIdentity: shortAddress,
                uiState: 'restoring'
            });
            return true;
        }

        // A name beside the neutral avatar is half an identity, so a cached
        // label paints here only when the cached avatar IS the neutral one:
        // that account has nothing better arriving. See its test.
        const settledWithoutPicture = identity
            && identity.wallet === wallet
            && identity.avatarUrl === NEUTRAL_AVATAR_URL;
        delete container.dataset.avatarCacheHydrated;
        commit({
            renderKey: `resolving:${wallet}`,
            source: NEUTRAL_AVATAR_URL,
            paintSource: NEUTRAL_AVATAR_URL,
            label: settledWithoutPicture ? identity.name : shortAddress,
            shortAddress,
            imageIdentity: shortAddress,
            uiState: 'resolving'
        });
        return true;
    };

    window.ArtSoulHeaderPrepaint = Object.freeze({
        hydrate,
        boot: Object.freeze({ appKitDisconnectedAtBoot })
    });
})();
