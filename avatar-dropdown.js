// Avatar Dropdown Component for ArtSoul
// Shows user avatar with dropdown menu in navigation

(function() {
    'use strict';

    const BASE_SEPOLIA_RPC_URL = 'https://sepolia.base.org';

    // The one canonical ArtSoul avatar visual. It is used for the guest state
    // and for a connected wallet whose profile has no avatar; connectedness is
    // carried by the name, the address row and the menu, never by the image.
    // The previously generated stylized "A" data-URI is gone: it read as a
    // third identity and was mistaken for a stale cached avatar.
    const NEUTRAL_AVATAR_URL = '/default-avatar.png';

    // supabase-client.js announces 'artsoul:db-ready' once, after the complete
    // window.ArtSoulDB API is assigned.
    const DB_READY_EVENT = 'artsoul:db-ready';
    // Hard ceiling on AUTOMATIC identity recoveries per wallet generation. A
    // wallet transition resets it. Explicit user actions (opening the menu,
    // refresh() after a profile save) are separate and stay idempotent through
    // the in-flight request map.
    const MAX_AUTOMATIC_IDENTITY_RECOVERIES = 2;
    // Backoff for the retry after a failed profile read, one entry per allowed
    // automatic recovery. This is a finite, pre-declared schedule — not a poll:
    // it fires at most MAX_AUTOMATIC_IDENTITY_RECOVERIES times per wallet
    // generation and then stops for the rest of the page lifetime.
    const AUTOMATIC_RECOVERY_BACKOFF_MS = [400, 1600];

    const isProfileBackendReady = () => typeof window.ArtSoulDB?.getProfile === 'function';

    const WALLET_ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/;
    // What the head boot script is allowed to turn into a document-level image
    // fetch: HTTPS, or a single-slash root-relative path on this origin. A
    // leading '//' is protocol-relative (a foreign origin), and every other
    // scheme — http:, data:, javascript:, blob: — is rejected outright.
    const PRELOADABLE_AVATAR_URL = /^(?:https:\/\/[^/\s]|\/(?!\/))/;
    const MOBILE_USER_AGENT_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
    const APPKIT_CONNECTION_STATUS_STORAGE_KEY = '@appkit/connection_status';
    // The label of the coherent resolving state. It must stay in sync with the
    // pre-paint placeholder in the static header shells and unified-styles.css.
    const RESOLVING_IDENTITY_LABEL = 'Connecting…';

    // Paint-ready cached header avatar.
    //
    // ArtSoul is an MPA: every navigation is a fresh document whose static shell
    // carries the canonical avatar, which users read as "wallet disconnected".
    // Caching only the remote avatar URL is not enough to avoid that, because a
    // remote URL still needs network validation and a decode in each document.
    // A tiny local raster of the LAST SUCCESSFULLY RENDERED avatar can instead be
    // committed synchronously by the header bootstrap, before the first frame.
    //
    // It is presentation only. It authorizes nothing: the settled provider stays
    // the sole authority, and the full profile and artwork surfaces keep using
    // the original avatar URL.
    const AVATAR_PREVIEW_EDGE_PX = 64;
    const AVATAR_PREVIEW_MAX_LENGTH = 32 * 1024;
    // Raster only. SVG can carry script, so it is not an accepted preview type,
    // and no other scheme is ever read back out of storage.
    const AVATAR_PREVIEW_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

    // AppKit's last persisted connection status, snapshotted ONCE while this
    // synchronous head script runs — before the SDK boots and can rewrite it.
    //
    // At boot the stored value is the previous document's settled outcome, which
    // is legitimate evidence: 'disconnected' there means the user really did end
    // the last page disconnected. Re-reading it later is not: the SDK writes a
    // transient 'disconnected' partway through restoring a live session, and a
    // later read would tear down an already committed connected identity and
    // repaint it as guest. Freezing the value at boot keeps the useful evidence
    // and removes the transient teardown. Authoritative state still comes only
    // from the settled wallet provider, which corrects this snapshot either way.
    //
    // External mobile sessions are restored by ArtSoul's separate WalletConnect
    // core, so an AppKit disconnect is never authoritative for those browsers.
    let appKitDisconnectedAtBoot = window.ArtSoulHeaderPrepaint?.boot?.appKitDisconnectedAtBoot === true;
    if (!window.ArtSoulHeaderPrepaint?.boot) {
        try {
            appKitDisconnectedAtBoot = !MOBILE_USER_AGENT_PATTERN.test(navigator.userAgent)
                && localStorage.getItem(APPKIT_CONNECTION_STATUS_STORAGE_KEY) === 'disconnected';
        } catch {
            // Storage can be unavailable in privacy-restricted browsers.
        }
    }

    // Compatibility fallback for documents that have not adopted the tiny
    // synchronous header-prepaint bridge yet. Product pages use the bridge, so
    // this deferred component must not re-apply a second boot presentation.
    //
    // 'wallet-state-resolving' swaps the static guest LABEL for a coherent
    // "Connecting…" label of the same size. It never hides the identity region
    // and never leaves the account button empty — see unified-styles.css.
    if (!window.ArtSoulHeaderPrepaint) try {
        const walletHint = String(localStorage.getItem('artsoul_wallet') || '').toLowerCase();
        const cachedUiState = localStorage.getItem('artsoul_header_ui_state');
        const hasWalletHint = WALLET_ADDRESS_PATTERN.test(walletHint);
        const appKitExplicitlyDisconnected = appKitDisconnectedAtBoot;
        if (!appKitExplicitlyDisconnected && (hasWalletHint || cachedUiState === 'connected')) {
            document.documentElement.classList.add('wallet-state-resolving');
        }

        // Start fetching the cached avatar with the document itself instead of
        // after the header has been parsed. On a repeat navigation the response
        // is already in the HTTP cache, so the one swap from the canonical
        // avatar to the user's own avatar lands within the first paints instead
        // of hundreds of milliseconds later.
        //
        // The hint is bound to the wallet it belongs to: an identity stored for
        // a DIFFERENT wallet, or one with no validated wallet hint at all, must
        // not become a document-level fetch. It is a platform hint only — it
        // changes no identity, authorizes nothing, and a rejected value simply
        // means the avatar is fetched later by the component itself.
        if (!appKitExplicitlyDisconnected && hasWalletHint && cachedUiState === 'connected') {
            let cachedIdentity = null;
            try {
                cachedIdentity = JSON.parse(localStorage.getItem('artsoul_header_identity') || 'null');
            } catch {
                // A corrupted entry is simply not a preload candidate.
            }
            const cachedWallet = String(cachedIdentity?.wallet || '').toLowerCase();
            const cachedAvatarUrl = cachedIdentity?.avatarUrl;
            if (WALLET_ADDRESS_PATTERN.test(cachedWallet)
                && cachedWallet === walletHint
                && typeof cachedAvatarUrl === 'string'
                && PRELOADABLE_AVATAR_URL.test(cachedAvatarUrl)) {
                const preloadLink = document.createElement('link');
                preloadLink.rel = 'preload';
                preloadLink.as = 'image';
                preloadLink.href = cachedAvatarUrl;
                document.head?.appendChild(preloadLink);
            }
        }
    } catch {
        // Storage can be unavailable in privacy-restricted browsers.
    }

    const ETHEREUM_NETWORK_ICON = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMiIgZmlsbD0iIzYyN0VFQSIvPjxwYXRoIGQ9Ik0xMiA0TDYgMTJMMTIgMTZMMTggMTJMMTIgNFoiIGZpbGw9IndoaXRlIi8+PHBhdGggZD0iTTEyIDE3TDYgMTNMMTIgMjBMMTggMTNMMTIgMTdaIiBmaWxsPSJ3aGl0ZSIvPjwvc3ZnPg==';

    class AvatarDropdown {
        constructor() {
            this.profile = null;
            this.isOpen = false;
            this.container = null;
            this.currentRenderKey = null;
            // Identity transaction bookkeeping. Every snapshot takes the next
            // token; any newer snapshot invalidates the pending one, which is
            // what rejects a late load/decode from a superseded render or an
            // older wallet. pendingIdentityKey collapses duplicate requests for
            // the snapshot already in flight.
            this.identityCommitToken = 0;
            this.pendingIdentityKey = null;
            this.pendingRenderKey = null;
            this.profileCache = new Map();
            this.profileRequests = new Map();
            // Identity bookkeeping. The render key encodes only wallet + chain,
            // so it cannot express "this wallet is connected but its profile
            // identity has not been resolved yet". Without that distinction a
            // single failed profile read leaves the connected header on the
            // generated ArtSoul fallback for the whole page lifetime, because
            // sync() early-returns on the unchanged key and appkit-init
            // de-duplicates identical wallet-state events at the source.
            this.identityGeneration = 0;
            this.identityWallet = null;
            this.resolvedIdentityWallet = null;
            // Automatic (ArtSoulDB readiness) recoveries used by the current
            // wallet generation, and the single readiness listener.
            this.automaticRecoveries = 0;
            this.profileBackendListener = null;
            this.recoveryTimer = null;
            this.headerIdentityStorageKey = 'artsoul_header_identity';
            this.headerNetworkStorageKey = 'artsoul_header_network_v2';
            this.headerStateStorageKey = 'artsoul_header_ui_state';
            this.protocolAdminWallet = null;
            this.protocolAdminEligible = false;
            this.protocolAdminRequest = null;
        }

        getNavContainer() {
            return document.getElementById('navButtons') || document.getElementById('avatarButton');
        }

        getStableStructure() {
            const navButtons = this.getNavContainer();
            if (!navButtons) return null;

            let dropdown = navButtons.querySelector('.avatar-dropdown-container');
            if (!dropdown) {
                dropdown = document.createElement('div');
                dropdown.className = 'avatar-dropdown-container';
                navButtons.appendChild(dropdown);
            }

            let button = dropdown.querySelector('.avatar-button');
            if (!button) {
                button = document.createElement('button');
                button.className = 'avatar-button';
                dropdown.prepend(button);
            }

            button.type = 'button';
            button.dataset.allowRapid = '';
            button.setAttribute('aria-label', 'ArtSoul account menu');
            button.setAttribute('aria-controls', 'avatarDropdownMenu');
            button.setAttribute('aria-expanded', String(this.isOpen));
            button.setAttribute('onclick', 'window.AvatarDropdown.toggle()');

            if (!button.querySelector('[data-avatar-image]')) {
                button.innerHTML = `
                    <img data-avatar-image src="/default-avatar.png" alt="ArtSoul" />
                    <div class="avatar-info">
                        <div data-avatar-name>ArtSoul Guest</div>
                        <div data-avatar-address hidden aria-hidden="true"></div>
                        <div data-avatar-resolving aria-hidden="true">${RESOLVING_IDENTITY_LABEL}</div>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 16 16" class="dropdown-arrow menu-chevron" aria-hidden="true">
                        <path d="M4 6l4 4 4-4"></path>
                    </svg>
                `;
            }

            let menu = dropdown.querySelector('#avatarDropdownMenu');
            if (!menu) {
                menu = document.createElement('div');
                menu.id = 'avatarDropdownMenu';
                menu.className = 'avatar-dropdown-menu';
                menu.style.display = this.isOpen ? 'block' : 'none';
                dropdown.appendChild(menu);
            }

            return { navButtons, dropdown, button, menu };
        }

        /**
         * Apply ONE coherent identity snapshot.
         *
         * Avatar, alt text, display name, shortened address, the stamped content
         * key and the visible UI state are a single transaction. They are never
         * committed separately, because a split commit produces exactly the
         * invalid frame the founder reported: the neutral/disconnected avatar
         * standing next to a connected profile name and address for as long as
         * the real avatar takes to arrive.
         *
         * When the snapshot needs an avatar the document has not decoded yet,
         * NOTHING of it is applied. The button keeps the previous identity while
         * that identity belongs to the same account, or falls back to the
         * complete resolving state, until the image can paint.
         */
        updateStableButton({
            avatarUrl,
            avatarAlt,
            name,
            address = '',
            stateKey,
            uiState,
            persistUiState,
            previewWallet
        }) {
            const structure = this.getStableStructure();
            if (!structure) return null;
            const { button } = structure;
            const image = button.querySelector('[data-avatar-image]');
            const nextAvatarUrl = avatarUrl || NEUTRAL_AVATAR_URL;
            const nextName = name || this.shortWalletAddress(address) || 'ArtSoul Guest';
            const nextAddress = address && nextName.toLowerCase() !== String(address).toLowerCase()
                ? address
                : '';
            const contentKey = `${stateKey || ''}|${nextAvatarUrl}|${nextName}|${nextAddress}`;

            // Already on screen. The visible identity is byte-for-byte what this
            // snapshot asks for, so not one node is touched — but the UI state
            // still advances, which is how a restored cached presentation is
            // promoted to a provider-confirmed one with zero repaint.
            if (button.dataset.avatarContentKey === contentKey) {
                if (uiState) this.commitVisibleState(uiState, { persist: persistUiState });
                return structure;
            }
            if (this.pendingIdentityKey === contentKey) return structure;

            const snapshot = {
                // The logical source of this identity's avatar. It stays the
                // original URL even when a local preview is what actually paints,
                // so a later render for the same avatar recognises it as already
                // displayed instead of swapping the image again.
                avatarUrl: nextAvatarUrl,
                paintSrc: nextAvatarUrl,
                alt: avatarAlt || nextName,
                name: nextName,
                // A wallet with no profile name already uses its shortened
                // address as the primary label. Do not print the same value a
                // second time underneath it; named profiles still show both.
                address: nextAddress,
                // The account this snapshot belongs to. Derived from the visible
                // address (empty for guest) because it is identical across every
                // render path for the same wallet, unlike the render key, which
                // also encodes the chain and the render source.
                identity: address || 'guest',
                previewWallet: previewWallet || '',
                contentKey,
                uiState,
                persistUiState
            };

            // Any newer snapshot invalidates this one, which is what rejects a
            // late result from an older wallet, an older URL or a superseded
            // render.
            const token = ++this.identityCommitToken;
            this.pendingIdentityKey = contentKey;

            // This exact avatar is already what the button displays — including
            // the case where a local preview of it is on screen. Nothing to load.
            const alreadyDisplayingThisAvatar = image
                && image.dataset.avatarSource === nextAvatarUrl
                && image.dataset.avatarIdentity === snapshot.identity;
            if (alreadyDisplayingThisAvatar) {
                snapshot.paintSrc = image.getAttribute('src') || nextAvatarUrl;
                this.commitIdentitySnapshot(structure, snapshot, token, false);
                return structure;
            }

            // A validated local preview of this exact identity is paint-ready
            // with no network at all, so the previously confirmed identity is
            // restored in this same frame instead of showing guest or the
            // resolving label on every new document.
            const preview = previewWallet
                ? this.readAvatarPreview(
                    this.getCachedHeaderIdentity(previewWallet),
                    previewWallet,
                    nextName,
                    nextAvatarUrl
                )
                : null;
            if (image && preview) {
                snapshot.paintSrc = preview;
                this.commitIdentitySnapshot(structure, snapshot, token, false);
                return structure;
            }

            // Nothing to wait for: the src is unchanged, or the target is the
            // canonical avatar, which every page paints in its static shell and
            // is therefore always available. Commit in this same frame.
            if (!image
                || nextAvatarUrl === NEUTRAL_AVATAR_URL
                || image.getAttribute('src') === nextAvatarUrl) {
                this.commitIdentitySnapshot(structure, snapshot, token, false);
                return structure;
            }

            this.holdIdentityWhilePending(structure, snapshot);
            this.decodeThenCommitIdentity(structure, snapshot, token);
            return structure;
        }

        /**
         * Write the whole snapshot to the DOM in one synchronous, guarded pass.
         * Returns false when a newer snapshot has already superseded this one.
         */
        commitIdentitySnapshot({ button }, snapshot, token, failed) {
            if (token !== this.identityCommitToken) return false;

            const image = button.querySelector('[data-avatar-image]');
            const nameNode = button.querySelector('[data-avatar-name]');
            const addressNode = button.querySelector('[data-avatar-address]');
            // A permanently broken avatar resolves to the canonical image, but it
            // is still committed TOGETHER with the connected name and address as
            // one final state. It never stays pending.
            const source = failed ? NEUTRAL_AVATAR_URL : snapshot.avatarUrl;
            const paintSrc = failed ? NEUTRAL_AVATAR_URL : (snapshot.paintSrc || snapshot.avatarUrl);

            if (image) {
                if (image.getAttribute('src') !== paintSrc) image.src = paintSrc;
                image.alt = snapshot.alt || 'ArtSoul';
                image.dataset.avatarIdentity = snapshot.identity;
                // What the pixels REPRESENT, which is not necessarily what is in
                // src: a restored local preview paints instead of its own source.
                image.dataset.avatarSource = source;
            }
            if (nameNode) nameNode.textContent = snapshot.name;
            if (addressNode) {
                addressNode.hidden = !snapshot.address;
                addressNode.textContent = snapshot.address;
                addressNode.setAttribute('aria-hidden', snapshot.address ? 'false' : 'true');
            }
            button.dataset.avatarContentKey = failed
                ? `${snapshot.contentKey}|image-error`
                : snapshot.contentKey;
            this.pendingIdentityKey = null;
            if (snapshot.uiState) {
                this.commitVisibleState(snapshot.uiState, { persist: snapshot.persistUiState });
            }
            return true;
        }

        /**
         * Keep a complete, coherent state on screen while the snapshot's avatar
         * is being fetched and decoded. Never a half identity.
         */
        holdIdentityWhilePending({ button }, snapshot) {
            const image = button.querySelector('[data-avatar-image]');
            const previousKey = button.dataset.avatarContentKey || '';
            const previousIsCoherent = previousKey
                && !previousKey.endsWith('|pending')
                && image?.dataset.avatarIdentity === snapshot.identity;
            // The identity on screen belongs to the same account and is complete,
            // so it stays untouched — this is the profile-avatar-changed case.
            if (previousIsCoherent) return;

            // Otherwise there is no safe previous identity: a fresh document, or
            // a different wallet. Show the complete resolving state rather than
            // any part of the new one.
            const nameNode = button.querySelector('[data-avatar-name]');
            const addressNode = button.querySelector('[data-avatar-address]');
            if (image) {
                if (image.getAttribute('src') !== NEUTRAL_AVATAR_URL) image.src = NEUTRAL_AVATAR_URL;
                image.alt = 'ArtSoul';
                image.dataset.avatarIdentity = snapshot.identity;
            }
            if (nameNode) nameNode.textContent = RESOLVING_IDENTITY_LABEL;
            if (addressNode) {
                addressNode.hidden = !snapshot.address;
                addressNode.textContent = snapshot.address;
                addressNode.setAttribute('aria-hidden', snapshot.address ? 'false' : 'true');
            }
            button.dataset.avatarContentKey = `${snapshot.contentKey}|pending`;
            this.commitVisibleState('resolving', { persist: false });
        }

        /**
         * Fetch and decode the snapshot's avatar off the DOM, then commit the
         * whole snapshot at once.
         *
         * 'load' alone is not the guarantee: it fires when the resource has
         * arrived, while the bitmap may still be decoding, so a commit on load
         * can still hand the compositor an image it cannot paint yet.
         * HTMLImageElement.decode() resolves only when the frame is ready. Where
         * it is unavailable, the load event remains the safe fallback.
         *
         * Every asynchronous boundary re-checks the commit token, so a late
         * result from a superseded render or a previous wallet can never commit.
         */
        decodeThenCommitIdentity(structure, snapshot, token, options = {}) {
            // A canvas can only export an image the document is allowed to read,
            // and an image loaded without CORS always taints it — verified in
            // Chromium: "SecurityError: Tainted canvases may not be exported".
            // So the request that will paint is also made CORS-aware, and there
            // is exactly ONE bounded retry without it, so an avatar host that
            // sends no CORS headers still renders. The preview is then skipped.
            const corsAttempt = options.withoutCors !== true
                && snapshot.avatarUrl !== NEUTRAL_AVATAR_URL
                && !!snapshot.previewWallet;

            const settle = (failed) => {
                if (token !== this.identityCommitToken) return;
                this.commitIdentitySnapshot(structure, snapshot, token, failed);
            };
            const preloader = typeof Image === 'function'
                ? new Image()
                : document.createElement('img');
            if (corsAttempt) preloader.crossOrigin = 'anonymous';
            preloader.onerror = () => {
                if (corsAttempt) {
                    this.decodeThenCommitIdentity(structure, snapshot, token, { withoutCors: true });
                    return;
                }
                settle(true);
            };
            const commitAndCapture = () => {
                if (!this.commitIdentitySnapshot(structure, snapshot, token, false)) return;
                if (!corsAttempt) return;
                // The avatar just decoded for display; capturing from it costs no
                // extra request and makes the NEXT document paint-ready.
                const dataUri = this.captureAvatarPreview(preloader);
                if (dataUri) {
                    this.persistAvatarPreview(
                        snapshot.previewWallet,
                        snapshot.name,
                        snapshot.avatarUrl,
                        dataUri
                    );
                }
            };
            preloader.onload = () => {
                if (token !== this.identityCommitToken) return;
                if (typeof preloader.decode !== 'function') {
                    commitAndCapture();
                    return;
                }
                preloader.decode().then(
                    () => {
                        if (token !== this.identityCommitToken) return;
                        commitAndCapture();
                    },
                    () => settle(true)
                );
            };
            preloader.src = snapshot.avatarUrl;
        }

        updateStableMenu(html, menuKey) {
            const structure = this.getStableStructure();
            if (!structure) return null;
            if (structure.menu.dataset.menuKey !== menuKey) {
                structure.menu.innerHTML = html;
                structure.menu.dataset.menuKey = menuKey;
            }
            structure.menu.style.display = this.isOpen ? 'block' : 'none';
            return structure;
        }

        bindOutsideCloseOnce() {
            if (this.closeHandler) return;
            this.closeHandler = (event) => {
                const dropdown = this.getNavContainer()?.querySelector('.avatar-dropdown-container');
                if (dropdown && !dropdown.contains(event.target) && this.isOpen) {
                    this.close();
                }
            };
            document.addEventListener('click', this.closeHandler);
            document.addEventListener('touchstart', this.closeHandler, { passive: true });
        }

        getNavigationLabels() {
            return window.ArtSoulNavigationLabels || {
                home: 'ArtSoul Home',
                explore: 'Explore Art',
                publish: 'Publish Artwork',
                auctions: 'Auctions',
                marketplace: 'Marketplace',
                collections: 'Collections',
                docs: 'Protocol Docs',
                profile: 'Profile'
            };
        }

        normalizePagePath(pathname = window.location.pathname) {
            const normalized = String(pathname || '/')
                .replace(/\.html$/, '')
                .replace(/\/index$/, '/')
                .replace(/\/$/, '');
            return normalized || '/';
        }

        isPage(pathname, page) {
            return this.normalizePagePath(pathname) === `/${page}`;
        }

        getNavigationItems() {
            const labels = this.getNavigationLabels();
            // Auctions / Marketplace / Collections live as tabs inside Explore Art
            // (/gallery), so they are intentionally NOT separate dropdown
            // destinations — one clear path to the gallery.
            return [
                { href: '/profile', label: labels.profile, path: '/profile', profile: true },
                { href: '/', label: labels.home || 'ArtSoul Home', path: '/', home: true },
                { href: '/gallery', label: labels.explore, path: '/gallery' },
                { href: '/upload', label: labels.publish, path: '/upload' },
                { href: '/docs-protocol', label: labels.docs || 'Protocol Docs', path: '/docs-protocol' }
            ];
        }

        isCurrentNavigationItem(item, currentPath = window.location.pathname, currentHash = window.location.hash) {
            const normalizedPath = this.normalizePagePath(currentPath);
            const isHome = item.home && normalizedPath === '/';
            const isSamePath = normalizedPath === item.path;
            if (!isHome && !isSamePath) return false;
            if (item.hash) return currentHash === item.hash;
            return !currentHash || isHome || !item.profile;
        }

        renderDropdownNavItems(options = {}) {
            const currentPath = options.currentPath || window.location.pathname;
            const currentHash = window.location.hash || '';
            return this.getNavigationItems()
                .filter(item => !this.isCurrentNavigationItem(item, currentPath, currentHash))
                .map(item => {
                    return `
                    <a href="${item.href}" class="dropdown-item${item.profile ? ' dropdown-profile-item' : ''}">
                        <span>${item.label}</span>
                    </a>
                `;
                })
                .join('');
        }

        renderProtocolAdminSlot(currentPath = window.location.pathname) {
            const isCurrentPage = this.isPage(currentPath, 'admin');
            const link = this.protocolAdminEligible && !isCurrentPage
                ? `
                    <a href="/admin" class="dropdown-item dropdown-protocol-admin-item">
                        <span>Protocol Admin</span>
                    </a>
                `
                : '';
            return `<div class="protocol-admin-menu-slot" data-protocol-admin-slot>${link}</div>`;
        }

        updateProtocolAdminSlot() {
            const slot = this.getNavContainer()?.querySelector('[data-protocol-admin-slot]');
            if (!slot) return;
            const currentPath = window.location.pathname;
            slot.innerHTML = this.protocolAdminEligible && !this.isPage(currentPath, 'admin')
                ? '<a href="/admin" class="dropdown-item dropdown-protocol-admin-item"><span>Protocol Admin</span></a>'
                : '';
            this.applyThemeStyles();
        }

        clearProtocolAdminAccess() {
            this.protocolAdminWallet = null;
            this.protocolAdminEligible = false;
            this.protocolAdminRequest = null;
            this.updateProtocolAdminSlot();
        }

        // Render-time bookkeeping only: never issues a network request. It
        // keeps the reserved menu slot in sync and drops any cached result
        // that belongs to a previous wallet or session.
        syncProtocolAdminWallet(walletAddress) {
            const wallet = String(walletAddress || '').toLowerCase();
            const knownWallet = this.protocolAdminWallet || this.protocolAdminRequest?.wallet || null;
            if (!/^0x[a-f0-9]{40}$/.test(wallet) || (knownWallet && knownWallet !== wallet)) {
                this.clearProtocolAdminAccess();
                return;
            }
            this.updateProtocolAdminSlot();
        }

        // Lazy menu discovery: called when the account dropdown opens, at most
        // one request per wallet for this page lifetime. Eligibility is always
        // decided by the server; protected admin endpoints still re-check
        // SIWE + staff role + passkey step-up on every request.
        async requestProtocolAdminAccessOnce() {
            const wallet = String(
                window.currentWalletAddress
                || window.artsoulSettledWalletState?.address
                || ''
            ).toLowerCase();
            if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
                this.clearProtocolAdminAccess();
                return false;
            }
            if (this.protocolAdminWallet === wallet) {
                this.updateProtocolAdminSlot();
                return this.protocolAdminEligible;
            }
            if (this.protocolAdminRequest?.wallet === wallet) return this.protocolAdminRequest.promise;

            const request = fetch('/api/moderation/access', {
                method: 'GET',
                credentials: 'include',
                headers: { Accept: 'application/json' }
            })
                .then(async response => {
                    const result = await response.json().catch(() => ({}));
                    const activeWallet = String(
                        window.currentWalletAddress
                        || window.artsoulSettledWalletState?.address
                        || ''
                    ).toLowerCase();
                    if (activeWallet !== wallet) return false;
                    this.protocolAdminWallet = wallet;
                    this.protocolAdminEligible = response.ok
                        && result.enabled === true
                        && result.authenticated === true
                        && result.eligible === true;
                    this.updateProtocolAdminSlot();
                    return this.protocolAdminEligible;
                })
                .catch(() => {
                    this.protocolAdminWallet = wallet;
                    this.protocolAdminEligible = false;
                    this.updateProtocolAdminSlot();
                    return false;
                })
                .finally(() => {
                    if (this.protocolAdminRequest?.wallet === wallet) this.protocolAdminRequest = null;
                });

            this.protocolAdminRequest = { wallet, promise: request };
            return request;
        }

        getCachedHeaderIdentity(walletAddress = '') {
            const normalizedWallet = String(walletAddress || '').toLowerCase();
            try {
                const cached = JSON.parse(localStorage.getItem(this.headerIdentityStorageKey) || 'null');
                if (!cached) return null;
                const cachedWallet = String(cached.wallet || '').toLowerCase();
                if (!/^0x[a-f0-9]{40}$/.test(cachedWallet)) return null;
                if (normalizedWallet && cachedWallet !== normalizedWallet) return null;
                if (!cached.name || !cached.avatarUrl) return null;
                return cached;
            } catch {
                return null;
            }
        }

        cacheHeaderIdentity(profile, walletAddress) {
            const wallet = String(walletAddress || profile?.wallet_address || '').toLowerCase();
            if (!wallet) return;
            const identity = {
                wallet,
                name: this.getProfileDisplayName(profile, wallet),
                avatarUrl: this.getProfileAvatarUrl(profile)
            };
            // A preview is only carried forward while it still describes exactly
            // this wallet, this display name and this avatar URL. A renamed
            // profile, a changed avatar or a removed avatar therefore drops it.
            const previous = this.getCachedHeaderIdentity(wallet);
            const preview = this.readAvatarPreview(previous, wallet, identity.name, identity.avatarUrl);
            if (preview) identity.preview = previous.preview;
            try {
                localStorage.setItem(this.headerIdentityStorageKey, JSON.stringify(identity));
            } catch {
                // The normal async profile render remains available without storage.
            }
        }

        /**
         * Validate a stored avatar preview and return its data URI, or null.
         *
         * Everything is checked defensively on every read, because localStorage
         * is attacker-writable in the threat model that matters here: the preview
         * must be bound to the normalized wallet, the display name and the
         * original avatar URL it was captured from, must be a raster data URI of
         * an allowed type, and must respect the size ceiling.
         */
        readAvatarPreview(identity, wallet, name, avatarUrl) {
            const preview = identity?.preview;
            if (!preview || typeof preview !== 'object') return null;
            const normalizedWallet = String(wallet || '').toLowerCase();
            if (!WALLET_ADDRESS_PATTERN.test(normalizedWallet)) return null;
            if (String(preview.wallet || '').toLowerCase() !== normalizedWallet) return null;
            if (preview.name !== name) return null;
            if (preview.source !== avatarUrl) return null;
            const dataUri = preview.dataUri;
            if (typeof dataUri !== 'string') return null;
            if (dataUri.length > AVATAR_PREVIEW_MAX_LENGTH) return null;
            if (!AVATAR_PREVIEW_PATTERN.test(dataUri)) return null;
            return dataUri;
        }

        /**
         * Capture a tiny raster of an avatar that has ALREADY loaded and decoded
         * for display. No second request is made: the detached image the header
         * just decoded is the source.
         *
         * Returns null whenever the platform refuses — no 2D context, or a
         * tainted canvas because the avatar host sent no CORS headers. The header
         * then simply keeps the coherent resolving path on the next document.
         */
        captureAvatarPreview(image) {
            try {
                const width = image.naturalWidth || image.width;
                const height = image.naturalHeight || image.height;
                if (!width || !height) return null;
                const canvas = document.createElement('canvas');
                canvas.width = AVATAR_PREVIEW_EDGE_PX;
                canvas.height = AVATAR_PREVIEW_EDGE_PX;
                const context = canvas.getContext?.('2d');
                if (!context) return null;
                // Centre-crop to a square, matching the button's object-fit: cover.
                const side = Math.min(width, height);
                context.drawImage(
                    image,
                    (width - side) / 2, (height - side) / 2, side, side,
                    0, 0, AVATAR_PREVIEW_EDGE_PX, AVATAR_PREVIEW_EDGE_PX
                );
                let dataUri = canvas.toDataURL('image/webp', 0.8);
                if (!dataUri.startsWith('data:image/webp')) dataUri = canvas.toDataURL('image/png');
                if (dataUri.length > AVATAR_PREVIEW_MAX_LENGTH) return null;
                if (!AVATAR_PREVIEW_PATTERN.test(dataUri)) return null;
                return dataUri;
            } catch {
                // SecurityError on a tainted canvas, or no canvas support at all.
                return null;
            }
        }

        /** Persist a captured preview, but only onto the identity it describes. */
        persistAvatarPreview(wallet, name, source, dataUri) {
            const normalizedWallet = String(wallet || '').toLowerCase();
            if (!dataUri || !WALLET_ADDRESS_PATTERN.test(normalizedWallet)) return false;
            const stored = this.getCachedHeaderIdentity(normalizedWallet);
            if (!stored || stored.name !== name || stored.avatarUrl !== source) return false;
            try {
                localStorage.setItem(this.headerIdentityStorageKey, JSON.stringify({
                    ...stored,
                    preview: { wallet: normalizedWallet, name, source, dataUri }
                }));
                return true;
            } catch {
                // Quota or unavailable storage: the header simply resolves as before.
                return false;
            }
        }

        getCachedHeaderNetwork(walletAddress) {
            const normalizedWallet = String(walletAddress || '').toLowerCase();
            if (!normalizedWallet) return null;
            try {
                const cached = JSON.parse(localStorage.getItem(this.headerNetworkStorageKey) || 'null');
                if (!cached || String(cached.wallet || '').toLowerCase() !== normalizedWallet) return null;
                if (!cached.name || !cached.icon || !cached.chainId) return null;
                return cached;
            } catch {
                return null;
            }
        }

        cacheHeaderNetwork(networkInfo, walletAddress, chainId) {
            const wallet = String(walletAddress || '').toLowerCase();
            const normalizedChainId = this.parseChainId(chainId);
            if (!wallet || !normalizedChainId || !networkInfo?.name || !networkInfo?.icon) return;
            try {
                localStorage.setItem(this.headerNetworkStorageKey, JSON.stringify({
                    wallet,
                    chainId: normalizedChainId,
                    name: networkInfo.name,
                    icon: networkInfo.icon,
                    currency: networkInfo.currency || 'ETH',
                    balance: networkInfo.balance || '0.0000',
                    baseSepoliaConfirmed: networkInfo.baseSepoliaConfirmed === true
                }));
            } catch {
                // The live network read remains available without storage.
            }
        }

        clearCachedHeaderIdentity() {
            try {
                localStorage.removeItem(this.headerIdentityStorageKey);
            } catch {
                // Ignore unavailable storage in privacy-restricted browsers.
            }
        }

        parseChainId(value) {
            if (value === null || value === undefined || value === '') return null;
            if (typeof value === 'number') return Number.isFinite(value) ? value : null;
            if (typeof value === 'bigint') return Number(value);
            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (!trimmed) return null;
                const caipMatch = trimmed.match(/^eip155:(\d+)(?::|$)/i);
                if (caipMatch) return parseInt(caipMatch[1], 10);
                return trimmed.startsWith('0x') ? parseInt(trimmed, 16) : parseInt(trimmed, 10);
            }
            return null;
        }

        getNormalizedChainId(state = {}) {
            const modalState = window.web3Modal?.getState?.();
            const candidates = [
                state?.chainId,
                state?.caipAddress,
                state?.selectedNetworkId,
                window.currentChainId,
                localStorage.getItem('artsoul_chain_id'),
                modalState?.chainId,
                modalState?.selectedNetworkId,
                window.ethereum?.chainId
            ];

            for (const candidate of candidates) {
                const chainId = this.parseChainId(candidate);
                if (chainId) return chainId;
            }

            return null;
        }

        getRenderKey(walletAddress, state = {}) {
            const normalizedAddress = walletAddress ? walletAddress.toLowerCase() : '';
            if (!normalizedAddress) return 'guest';
            // The key must encode the network, not just the wallet. sync() skips
            // the re-render when the key is unchanged, so without the chain the
            // post-connect Base Sepolia confirmation (a second wallet-state-changed
            // that only flips the chain from mainnet to 84532) never refreshes the
            // header network row until the next full page render.
            const chainId = this.getNormalizedChainId(state);
            const baseSepoliaConfirmed = typeof window.isArtSoulBaseSepoliaConfirmed === 'function'
                ? window.isArtSoulBaseSepoliaConfirmed()
                : chainId === 84532;
            return `wallet:${normalizedAddress}:${chainId || 'none'}:${baseSepoliaConfirmed ? 'confirmed' : 'pending'}`;
        }

        /**
         * Publish a coherent visible state.
         *
         * options.persist === false for the transient 'resolving' state: the
         * stored key is the NEXT document's boot hint and must only ever hold a
         * settled outcome ('connected' / 'disconnected'). Persisting 'resolving'
         * would make the following page boot from a state that is neither.
         */
        commitVisibleState(state, options = {}) {
            document.documentElement.classList.remove('wallet-state-resolving');
            document.documentElement.dataset.walletUiState = state;
            this.getNavContainer()?.setAttribute('aria-busy', state === 'resolving' ? 'true' : 'false');
            if (options.persist === false) return;
            try {
                localStorage.setItem(this.headerStateStorageKey, state);
            } catch {
                // The visible state remains stable without storage.
            }
        }

        isWalletConnectionConfirmed(walletAddress, options = {}) {
            if (!walletAddress) return false;
            const normalizedAddress = walletAddress.toLowerCase();

            if (options.confirmed === true) return true;

            // Mobile core path (external browser, no injected provider): the
            // WalletConnect session lives outside AppKit and window.ethereum,
            // so neither can confirm it. The settled wallet state maintained
            // by appkit-init is the authority there — whatever network the
            // wallet is currently on.
            const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            if (isMobileUA && !window.ethereum?.request) {
                const settled = window.artsoulSettledWalletState;
                if (settled?.isConnected && String(settled.address || '').toLowerCase() === normalizedAddress) {
                    return true;
                }
            }

            try {
                const account = window.web3Modal?.getAccount?.();
                const accountAddress = account?.address || account?.allAccounts?.[0]?.address || '';
                const accountDisconnected = account && (account.status === 'disconnected' || account.isConnected === false);
                if (accountAddress && !accountDisconnected && accountAddress.toLowerCase() === normalizedAddress) {
                    return true;
                }
            } catch (error) {
                console.warn('Unable to read AppKit account for avatar state:', error);
            }

            const selectedAddress = window.ethereum?.selectedAddress || '';
            return selectedAddress.toLowerCase() === normalizedAddress;
        }

        sync(walletAddress = null, options = {}) {
            const container = this.getNavContainer();
            if (!container) return false;

            if (window.artsoulWalletStateSettled !== true) {
                return this.renderInitializingState();
            }

            const normalizedAddress = walletAddress ? walletAddress.toLowerCase() : null;
            const confirmedAddress = this.isWalletConnectionConfirmed(normalizedAddress, options)
                ? normalizedAddress
                : null;

            const renderKey = this.getRenderKey(confirmedAddress, options);
            const hasMenuButton = !!container.querySelector('.avatar-button');

            // A wallet transition (connect, switch, disconnect) invalidates every
            // identity bound to the previous wallet, so a late response or a
            // cached profile can never leak the previous avatar.
            if (this.identityWallet !== confirmedAddress) {
                this.beginIdentityTransition(confirmedAddress);
            }

            // Connected but the profile identity has not resolved yet (failed or
            // never attempted read): the header is showing the connected-user
            // fallback. Keep this render path open so the identity can still be
            // recovered — the key alone cannot express that difference.
            const identityUnresolved = !!confirmedAddress && this.resolvedIdentityWallet !== confirmedAddress;

            if (!options.refreshProfile
                && !identityUnresolved
                && hasMenuButton
                && container.dataset.avatarRenderKey === renderKey) {
                return true;
            }

            container.dataset.avatarRenderKey = renderKey;
            this.pendingRenderKey = renderKey;

            if (confirmedAddress) {
                this.init(confirmedAddress, {
                    renderKey,
                    walletAddress: confirmedAddress,
                    // Without forwarding this flag refresh() could never bust the
                    // component cache, so a saved profile or avatar never reached
                    // the shared header.
                    refreshProfile: options.refreshProfile === true
                });
                return true;
            }

            return this.renderConnectButton({ renderKey });
        }

        // Drop every piece of state bound to the previous wallet and open a new
        // identity generation. Responses issued for an older generation are
        // discarded on arrival.
        beginIdentityTransition(nextWallet) {
            const previousWallet = this.identityWallet;
            this.identityGeneration += 1;
            this.identityWallet = nextWallet || null;
            this.resolvedIdentityWallet = null;
            this.profile = null;
            // A new wallet gets its own recovery budget; work still in flight
            // for the previous generation is discarded by the isCurrent() guard,
            // and any pending retry for the wallet we are leaving is dropped.
            this.automaticRecoveries = 0;
            this.cancelAutomaticRecovery();

            // Leaving a real wallet — disconnect or an address switch — must
            // leave no wallet-bound identity behind, in memory or in storage, so
            // the next wallet cannot inherit the previous avatar. Hydration
            // renders start from a null wallet and clear nothing, which keeps
            // the A-05 cached-identity flicker guard intact.
            if (previousWallet && previousWallet !== this.identityWallet) {
                this.profileCache.delete(previousWallet);
                this.clearCachedHeaderIdentity();
            }
        }

        /**
         * Initialize avatar dropdown
         */
        async init(walletAddress, options = {}) {
            // If no wallet connected, show connect button
            if (!walletAddress) {
                console.log('👤 No wallet address, showing connect button');
                this.renderConnectButton(options);
                return;
            }

            const renderKey = options.renderKey || this.getRenderKey(walletAddress, options);
            const container = this.getNavContainer();
            if (container) container.dataset.avatarRenderKey = renderKey;
            this.pendingRenderKey = renderKey;

            const normalizedWallet = walletAddress.toLowerCase();
            if (this.identityWallet !== normalizedWallet) {
                this.beginIdentityTransition(normalizedWallet);
            }
            const generation = this.identityGeneration;
            // A response is applied only while it still describes the active
            // wallet. A slow read for wallet A that lands after a switch to
            // wallet B is discarded instead of overwriting B's identity.
            const isCurrent = () => this.identityGeneration === generation
                && this.identityWallet === normalizedWallet;

            // The header is a synchronous head script; supabase-client.js is a
            // deferred module, so a wallet can be confirmed before ArtSoulDB
            // exists. That is an UNRESOLVED identity, not a failed profile:
            // render the connected shell, arm the one-shot readiness listener
            // and let 'artsoul:db-ready' finish the job.
            if (!isProfileBackendReady()) {
                this.armProfileBackendRecovery();
                if (this.pendingRenderKey !== renderKey) return;
                await this.renderWalletInfo(walletAddress, { renderKey, resolved: false });
                return;
            }

            try {
                const profile = await this.loadProfileOnce(walletAddress, {
                    refresh: options.refreshProfile === true
                });

                if (!isCurrent()) return;
                // A completed read — profile found or confirmed absent — resolves
                // the identity. Repeat wallet-state events then stay cheap and
                // issue no further requests.
                this.profile = profile;
                this.resolvedIdentityWallet = normalizedWallet;
                // Persisting the header identity happens here, behind the guard,
                // never inside the shared request: a superseded read for a
                // previous wallet must not overwrite the stored identity of the
                // wallet that is actually connected now.
                if (profile) this.cacheHeaderIdentity(profile, walletAddress);

                if (!profile) {
                    if (this.pendingRenderKey !== renderKey) return;
                    await this.renderWalletInfo(walletAddress, { renderKey });
                    return;
                }

                if (this.pendingRenderKey !== renderKey) return;
                await this.render({ renderKey, walletAddress });
            } catch (error) {
                console.error(' Failed to load profile:', error);
                console.log('👤 Falling back to wallet info due to error');
                if (!isCurrent()) return;
                // A transient rejection from an already-ready backend cannot be
                // repaired by 'artsoul:db-ready' — supabase-client.js announces
                // that exactly once. Without a retry of its own the identity
                // would stay unresolved until the user opened the account menu,
                // which is precisely the behaviour A-45 must remove.
                this.scheduleAutomaticRecovery();
                // Meanwhile the connected shell is shown — never guest, and the
                // last avatar confirmed for THIS address is kept if there is one.
                if (this.pendingRenderKey !== renderKey) return;
                await this.renderWalletInfo(walletAddress, { renderKey, resolved: false });
            }
        }

        async loadProfileOnce(walletAddress, options = {}) {
            const cacheKey = walletAddress.toLowerCase();
            if (options.refresh) {
                this.profileCache.delete(cacheKey);
            }
            if (this.profileCache.has(cacheKey)) {
                return this.profileCache.get(cacheKey);
            }
            if (this.profileRequests.has(cacheKey)) {
                return this.profileRequests.get(cacheKey);
            }

            console.log('👤 Initializing avatar dropdown for wallet:', walletAddress);
            const request = Promise.resolve()
                .then(() => {
                    // Defensive: init() gates on isProfileBackendReady() before
                    // reaching here. An unready backend must surface as an
                    // unresolved identity, never as a TypeError that the caller
                    // would mistake for a definitive "no profile".
                    if (!isProfileBackendReady()) {
                        const error = new Error('ArtSoul profile backend is not ready yet.');
                        error.code = 'PROFILE_BACKEND_UNAVAILABLE';
                        throw error;
                    }
                    return window.ArtSoulDB.getProfile(walletAddress);
                })
                .then(profile => {
                    // Only cache a result that still describes the active wallet.
                    // A read that was superseded by a wallet switch must not
                    // reintroduce the previous wallet after
                    // beginIdentityTransition() removed it. Persisting the header
                    // identity is init()'s job, behind its generation guard.
                    if (this.identityWallet === cacheKey) {
                        this.profileCache.set(cacheKey, profile || null);
                    }
                    if (profile) {
                        console.log('👤 Profile loaded:', profile.username || walletAddress);
                    } else {
                        console.log('👤 No profile found for wallet:', walletAddress);
                    }
                    return profile || null;
                })
                .catch(error => {
                    // Never cache a failed read. ArtSoulDB.getProfile keeps only a
                    // 15s read cache, so a permanent component-level entry here
                    // would outlive the real cache and block every recovery.
                    this.profileCache.delete(cacheKey);
                    throw error;
                })
                .finally(() => {
                    this.profileRequests.delete(cacheKey);
                });

            this.profileRequests.set(cacheKey, request);
            return request;
        }

        /**
         * Get current network info with balance
         */
        async getCurrentNetworkInfo(options = {}) {
            let chainId = this.getNormalizedChainId();
            const walletAddress = String(
                options.walletAddress
                || window.currentWalletAddress
                || localStorage.getItem('artsoul_wallet')
                || ''
            ).toLowerCase();
            const cachedNetwork = this.getCachedHeaderNetwork(walletAddress);
            let provider = null;
            try {
                provider = await window.web3Modal?.getWalletProvider?.();
                const providerChainId = await window.getArtSoulProviderChainId?.(provider);
                if (provider) chainId = this.parseChainId(providerChainId);
            } catch (error) {
                console.warn('Unable to confirm the live wallet network:', error);
            }

            // Network mapping with proper icons (matching AppKit)
            const networks = {
                84532: {
                    name: 'Base Sepolia',
                    icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTExIiBoZWlnaHQ9IjExMSIgdmlld0JveD0iMCAwIDExMSAxMTEiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik01NC45MjEgMTEwLjAzNEM4NS4zNTkgMTEwLjAzNCAxMTAuMDQyIDg1LjM1MDggMTEwLjA0MiA1NC45MTI5QzExMC4wNDIgMjQuNDc1IDg1LjM1OSAtMC4yMDgwMDggNTQuOTIxIC0wLjIwODAwOEMyNi4wODM4IC0wLjIwODAwOCAxLjgzMzU4IDIyLjQwMTYgMC4wNDIwNTMyIDUwLjUwNzlIMzEuNjcyNkMzMy4zMzE5IDM4Ljk5MzEgNDMuMjU1MSAzMC4xNTQ2IDU0LjkyMSAzMC4xNTQ2QzY3LjU5MzggMzAuMTU0NiA3Ny44OTc0IDQwLjQ1ODMgNzcuODk3NCA1My4xMzExQzc3Ljg5NzQgNjUuODAzOSA2Ny41OTM4IDc2LjEwNzYgNTQuOTIxIDc2LjEwNzZDNDMuMjU1MSA3Ni4xMDc2IDMzLjMzMTkgNjcuMjY5MSAzMS42NzI2IDU1Ljc1NDJIMS4wNDIwNTNDMi44MzM1OCA4My44NjA1IDI2LjA4MzggMTA2LjQ3IDU0LjkyMSAxMDYuNDdWMTEwLjAzNFoiIGZpbGw9IiMwMDUyRkYiLz4KPC9zdmc+Cg==',
                    color: '#0052FF',
                    currency: 'ETH'
                },
                11155111: {
                    name: 'Ethereum Sepolia',
                    icon: ETHEREUM_NETWORK_ICON,
                    color: '#627EEA',
                    currency: 'ETH'
                }
            };

            // Mainnet networks can be returned by a connected wallet session.
            // They are display-only here; Base Sepolia remains the operational
            // write network enforced by the shared transaction guard.
            networks[8453] = { ...networks[84532], name: 'Base Mainnet' };
            networks[1] = { ...networks[11155111], name: 'Ethereum Mainnet' };
            this.baseNetworkIcon = networks[84532].icon;

            const baseSepoliaConfirmed = typeof window.isArtSoulBaseSepoliaConfirmed === 'function'
                ? window.isArtSoulBaseSepoliaConfirmed()
                : chainId === 84532;
            if (chainId === 84532 && !baseSepoliaConfirmed) {
                return {
                    ...networks[84532],
                    name: 'Base Sepolia',
                    balance: 'Tap to switch',
                    currency: '',
                    chainId: null,
                    requiresConfirmation: true
                };
            }

            // Get balance
            let balance = chainId === 84532
                ? '…'
                : cachedNetwork?.chainId === chainId
                    ? cachedNetwork.balance
                    : '0.0000';
            if (options.includeBalance !== false && chainId && window.currentWalletAddress) {
                try {
                    let balanceHex = null;
                    if (chainId === 84532) {
                        const response = await fetch(BASE_SEPOLIA_RPC_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                jsonrpc: '2.0',
                                id: 1,
                                method: 'eth_getBalance',
                                params: [walletAddress, 'latest']
                            })
                        });
                        if (!response.ok) throw new Error(`Base Sepolia RPC returned ${response.status}`);
                        const payload = await response.json();
                        if (payload.error) throw new Error(payload.error.message || 'Base Sepolia balance read failed');
                        balanceHex = payload.result;
                    } else if (provider && provider.request) {
                        balanceHex = await provider.request({
                            method: 'eth_getBalance',
                            params: [walletAddress, 'latest']
                        });
                    }
                    if (balanceHex) {
                        balance = (parseInt(balanceHex, 16) / 1e18).toFixed(4);
                    }
                } catch (error) {
                    console.warn('Failed to get balance:', error);
                }
            }

            // Return network info
            if (!chainId) {
                // If wallet connected but no chainId yet, try to get it
                if (window.currentWalletAddress) {
                    // Retry after a short delay
                    setTimeout(() => {
                        if (this.profile) {
                            this.updateNetworkDisplay();
                        }
                    }, 500);
                }
                return { name: 'Connecting...', icon: '', color: '#888888', currency: 'ETH', balance: options.includeBalance === false ? '…' : '0.0000' };
            }

            const network = networks[chainId];
            if (!network) {
                // Unsupported network
                return { name: 'Unsupported', icon: '', color: '#ff6b6b', currency: 'ETH', balance: options.includeBalance === false ? '…' : '0.0000' };
            }

            const networkInfo = {
                ...network,
                balance,
                chainId,
                baseSepoliaConfirmed: chainId === 84532 && baseSepoliaConfirmed
            };
            this.cacheHeaderNetwork(networkInfo, walletAddress, chainId);
            return networkInfo;
        }

        /**
         * Update network display dynamically
         */
        async updateNetworkDisplay() {
            const networkInfo = await this.getCurrentNetworkInfo();
            const networkButton = document.querySelector('.network-switcher-btn');
            if (networkButton) {
                const icon = networkButton.querySelector('img');
                const name = networkButton.querySelector('[data-network-name]');
                const balance = networkButton.querySelector('[data-network-balance]');
                if (icon) {
                    icon.src = networkInfo.icon;
                    icon.alt = networkInfo.name;
                    icon.style.display = networkInfo.icon ? '' : 'none';
                }
                if (name) name.textContent = networkInfo.name;
                if (balance) balance.textContent = `${networkInfo.balance} ${networkInfo.currency}`.trim();
            }
        }

        renderNetworkOptions(currentChainId, requiresConfirmation = false) {
            // Hide the Base Sepolia switch option when it would duplicate the
            // current row: the wallet is already on Base Sepolia, or the row is
            // itself the "Tap to switch" control (requiresConfirmation, where
            // chainId is intentionally null while a mobile session still awaits
            // a Base Sepolia confirmation).
            const alreadyOnBaseSepolia = Number(currentChainId) === 84532 || requiresConfirmation === true;
            if (alreadyOnBaseSepolia) return '';
            return `
                <div id="avatarNetworkOptions" class="avatar-network-options" hidden>
                    <button
                        type="button"
                        class="dropdown-item avatar-network-option"
                        onclick="window.AvatarDropdown.selectNetwork(84532, event)"
                    >
                        <img src="${this.baseNetworkIcon || ''}" alt="" aria-hidden="true" />
                        <span class="network-option-name">Base Sepolia</span>
                    </button>
                </div>
            `;
        }

        // The stable menu is only re-rendered when its key changes, so the key
        // must encode the network state. Otherwise the options list built while
        // a mobile session is unconfirmed (requiresConfirmation) survives after
        // the switch to Base Sepolia, leaving a duplicate "Base Sepolia" row.
        networkMenuKeySegment(networkInfo) {
            if (!networkInfo) return 'none';
            if (networkInfo.requiresConfirmation) return 'pending';
            return networkInfo.chainId ? `chain${networkInfo.chainId}` : 'unknown';
        }

        renderMenuContent({ currentPath, isOwnProfile, networkInfo = null, restoring = false, connected = false }) {
            const networkOptions = networkInfo
                ? this.renderNetworkOptions(networkInfo.chainId, networkInfo.requiresConfirmation)
                : '';
            const networkRowContent = networkInfo ? `
                    <img src="${networkInfo.icon}" alt="${networkInfo.name}" onerror="this.style.display='none'" />
                    <div class="network-switcher-copy">
                        <div><span data-network-name>${networkInfo.name}</span></div>
                        <div data-network-balance>${networkInfo.balance} ${networkInfo.currency}</div>
                    </div>
            ` : '';
            let networkCurrentRow = '';
            if (networkInfo?.requiresConfirmation) {
                networkCurrentRow = `
                    <button
                        type="button"
                        class="dropdown-item network-switcher-btn network-current-row"
                        onclick="window.AvatarDropdown.handleNetworkRowClick(event)"
                    >
                        ${networkRowContent}
                    </button>
                `;
            } else if (networkOptions) {
                networkCurrentRow = `
                    <button
                        type="button"
                        class="dropdown-item network-switcher-btn network-current-row"
                        onclick="window.AvatarDropdown.handleNetworkRowClick(event)"
                        aria-expanded="false"
                        aria-controls="avatarNetworkOptions"
                    >
                        ${networkRowContent}
                    <svg width="16" height="16" viewBox="0 0 16 16" class="network-options-arrow menu-chevron" aria-hidden="true">
                        <path d="M4 6l4 4 4-4"></path>
                    </svg>
                    </button>
                `;
            } else if (networkInfo) {
                networkCurrentRow = `
                    <div class="dropdown-item network-switcher-btn network-current-row" role="status">
                        ${networkRowContent}
                    </div>
                `;
            }
            const networkSection = networkInfo ? `
                ${networkCurrentRow}
                ${networkOptions}
                <div class="avatar-dropdown-divider"></div>
            ` : '';

            const isConnected = connected || !!networkInfo;
            const accountAction = (restoring || isConnected) ? `
                <div class="avatar-dropdown-divider"></div>
                <button onclick="window.resetWalletConnection()" data-allow-rapid class="dropdown-item avatar-disconnect-item">
                    <span>Disconnect</span>
                </button>
            ` : `
                <div class="avatar-dropdown-divider"></div>
                <button onclick="safeConnectWallet()" id="connectBtn" data-allow-rapid class="dropdown-item btn-main">
                    <span>Connect Wallet</span>
                </button>
            `;

            return `
                <div class="avatar-theme-section">
                    <div class="avatar-theme-label">Theme Mode</div>
                    <div class="theme-toggle avatar-theme-switch">
                        <button onclick="window.setTheme('classic')" id="classicBtnDropdown" class="theme-btn">Classic</button>
                        <button onclick="window.setTheme('future')" id="futureBtnDropdown" class="theme-btn">Future</button>
                    </div>
                </div>
                ${networkSection}
                <div class="avatar-dropdown-navigation">
                    ${this.renderDropdownNavItems({ currentPath, isOwnProfile })}
                    ${this.renderProtocolAdminSlot(currentPath)}
                    ${accountAction}
                </div>
            `;
        }

        toggleNetworkOptions(event) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            const options = document.getElementById('avatarNetworkOptions');
            const trigger = document.querySelector('.network-switcher-btn');
            if (!options) return false;
            const willOpen = options.hidden;
            options.hidden = !willOpen;
            trigger?.setAttribute('aria-expanded', String(willOpen));
            return willOpen;
        }

        async handleNetworkRowClick(event) {
            if (window.isArtSoulBaseSepoliaConfirmed?.() === false) {
                return this.selectNetwork(84532, event);
            }
            return this.toggleNetworkOptions(event);
        }

        openNetworkOptions() {
            if (!this.isOpen) this.toggle();
            const options = document.getElementById('avatarNetworkOptions');
            const trigger = document.querySelector('.network-switcher-btn');
            if (!options) return false;
            options.hidden = false;
            trigger?.setAttribute('aria-expanded', 'true');
            return true;
        }

        closeNetworkOptions() {
            const options = document.getElementById('avatarNetworkOptions');
            const trigger = document.querySelector('.network-switcher-btn');
            if (options) options.hidden = true;
            trigger?.setAttribute('aria-expanded', 'false');
        }

        async selectNetwork(chainId, event) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            if (Number(chainId) !== 84532) return false;
            const switched = await window.switchArtSoulNetwork?.(84532);
            if (switched) this.closeNetworkOptions();
            return Boolean(switched);
        }

        /**
         * Render avatar dropdown
         */
        async render(options = {}) {
            const navButtons = this.getNavContainer();
            if (!navButtons) return;
            if (options.renderKey) navButtons.dataset.avatarRenderKey = options.renderKey;

            const currentPath = window.location.pathname;
            // Check if on profile page
            const isProfilePage = this.isPage(currentPath, 'profile');
            // Check if viewing own profile (no address parameter or address matches current wallet)
            const urlParams = new URLSearchParams(window.location.search);
            const viewingAddress = urlParams.get('address');
            const currentWallet = this.profile?.wallet_address?.toLowerCase();
            const isOwnProfile = isProfilePage && (!viewingAddress || viewingAddress.toLowerCase() === currentWallet);

            const walletAddress = this.profile?.wallet_address || options.walletAddress || window.currentWalletAddress || '';
            const shortAddress = walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : '';
            const avatarUrl = this.getProfileAvatarUrl(this.profile);
            const username = this.getProfileDisplayName(this.profile, walletAddress);

            if (options.renderKey && this.pendingRenderKey !== options.renderKey) return;
            // The identity depends on the profile alone. Committing it before the
            // network read means a slow, failed or hanging Base Sepolia RPC can
            // no longer hold the avatar, name and address off the screen.
            this.updateStableButton({
                avatarUrl,
                avatarAlt: username,
                name: username,
                address: shortAddress,
                stateKey: `identity:${walletAddress.toLowerCase()}`,
                previewWallet: walletAddress.toLowerCase(),
                // Part of the same transaction: 'connected' becomes visible only
                // when this identity's avatar can actually paint.
                uiState: 'connected'
            });
            this.updateStableMenu(
                this.renderMenuContent({
                    currentPath,
                    isOwnProfile,
                    networkInfo: this.getCachedHeaderNetwork(walletAddress),
                    connected: true
                }),
                `connected:${currentPath}:${isOwnProfile}:${this.networkMenuKeySegment(this.getCachedHeaderNetwork(walletAddress))}`
            );
            this.applyThemeStyles();
            this.syncProtocolAdminWallet(walletAddress);
            this.bindOutsideCloseOnce();
            void this.applyLiveNetworkSection({
                walletAddress,
                currentPath,
                isOwnProfile,
                renderKey: options.renderKey || this.pendingRenderKey
            });
        }

        /**
         * Read the live network/balance once and fold it into the already
         * committed menu. Never touches the account button, so it can never
         * delay or repaint the visible identity.
         *
         * Guarded by the render key: a late result belonging to a superseded
         * render or a previous wallet is discarded instead of applied. Exactly
         * one read per render, as before — the RPC diet is unchanged, and no
         * polling or retry loop is introduced.
         */
        async applyLiveNetworkSection({ walletAddress, currentPath, isOwnProfile, renderKey }) {
            let networkInfo = null;
            try {
                networkInfo = await this.getCurrentNetworkInfo({ walletAddress });
            } catch (error) {
                console.warn('Unable to read the live wallet network:', error);
                return;
            }
            if (renderKey && this.pendingRenderKey !== renderKey) return;
            if (!networkInfo) return;
            this.updateStableMenu(
                this.renderMenuContent({ currentPath, isOwnProfile, networkInfo, connected: true }),
                `connected:${currentPath}:${isOwnProfile}:${this.networkMenuKeySegment(networkInfo)}`
            );
            this.applyThemeStyles();
            void this.updateNetworkDisplay();
        }

        /**
         * Toggle dropdown menu
         */
        toggle() {
            const menu = document.getElementById('avatarDropdownMenu');
            const arrow = document.querySelector('.dropdown-arrow');
            const avatarButton = document.querySelector('.avatar-button');
            if (!menu) {
                this.isOpen = false;
                avatarButton?.setAttribute('aria-expanded', 'false');
                return false;
            }

            this.isOpen = !this.isOpen;

            // Lazy Protocol Admin discovery: ask the server only when the
            // menu is actually opened, once per wallet per page lifetime.
            if (this.isOpen) {
                void this.requestProtocolAdminAccessOnce();
                this.recoverUnresolvedIdentity();
            }

            if (menu) {
                menu.style.display = this.isOpen ? 'block' : 'none';
                document.body.style.overflow = '';
            }

            if (arrow) {
                arrow.style.transform = this.isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
            }
            avatarButton?.setAttribute('aria-expanded', String(this.isOpen));
            if (!this.isOpen) this.closeNetworkOptions();
            return this.isOpen;
        }

        /**
         * Close dropdown menu
         */
        close() {
            this.isOpen = false;
            const menu = document.getElementById('avatarDropdownMenu');
            const arrow = document.querySelector('.dropdown-arrow');
            const avatarButton = document.querySelector('.avatar-button');

            if (menu) {
                menu.style.display = 'none';
                document.body.style.overflow = '';
            }

            if (arrow) {
                arrow.style.transform = 'rotate(0deg)';
            }
            avatarButton?.setAttribute('aria-expanded', 'false');
            this.closeNetworkOptions();
        }

        /**
         * Apply theme-specific styles
         */
        applyThemeStyles(theme = window.ThemeManager?.getTheme?.() || localStorage.getItem('artsoul_theme') || 'classic') {
            const menu = document.getElementById('avatarDropdownMenu');
            const avatarButton = document.querySelector('.avatar-button');
            const items = document.querySelectorAll('.dropdown-item');
            const classicBtn = document.getElementById('classicBtnDropdown');
            const futureBtn = document.getElementById('futureBtnDropdown');

            if (!menu || !avatarButton) return;

            // Update theme toggle buttons
            if (classicBtn && futureBtn) {
                classicBtn.classList.remove('active', 'active-classic', 'active-future');
                futureBtn.classList.remove('active', 'active-classic', 'active-future');
                if (theme === 'classic') {
                    classicBtn.classList.add('active-classic');
                } else {
                    futureBtn.classList.add('active-future');
                }
            }

            if (theme === 'classic') {
                menu.style.background = 'var(--c-surface)';
                menu.style.border = '1px solid var(--c-border)';
                menu.style.boxShadow = 'none';
                avatarButton.style.borderColor = 'var(--c-border)';
                avatarButton.style.boxShadow = 'none';

                items.forEach(item => {
                    item.onmouseenter = null;
                    item.onmouseleave = null;
                    item.style.background = 'transparent';
                    item.style.boxShadow = 'none';
                });
            } else {
                menu.style.background = 'var(--c-surface)';
                menu.style.border = '1px solid var(--c-border-soft)';
                menu.style.boxShadow = '0 0 30px var(--c-glow)';
                avatarButton.style.borderColor = 'var(--c-accent)';
                avatarButton.style.boxShadow = '0 0 20px var(--c-glow), 0 0 40px var(--c-glow-strong)';

                items.forEach(item => {
                    item.onmouseenter = null;
                    item.onmouseleave = null;
                    item.style.background = 'transparent';
                    item.style.boxShadow = 'none';
                });
            }
        }

        // Mirrors shortWalletAddress in supabase-client.js. A connected wallet
        // always has a name we can compute, so no path needs to invent one.
        shortWalletAddress(address) {
            const value = (address || '').toString().trim();
            if (!value) return '';
            return value.length <= 12 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`;
        }

        getProfileDisplayName(profile, walletAddress) {
            const resolver = window.ArtSoulProfileDisplay?.displayName || window.ArtSoulDB?.displayName;
            const fallback = this.shortWalletAddress(walletAddress) || 'ArtSoul Guest';
            return resolver?.(profile, walletAddress) || fallback;
        }

        getProfileAvatarUrl(profile) {
            const resolver = window.ArtSoulProfileDisplay?.avatarUrl || window.ArtSoulDB?.avatarUrl;
            return resolver?.(profile, NEUTRAL_AVATAR_URL) || NEUTRAL_AVATAR_URL;
        }

        /**
         * Update profile (call after profile changes)
         */
        async refresh(walletAddress) {
            const wallet = walletAddress || window.currentWalletAddress || null;
            return this.sync(wallet, { refreshProfile: true, confirmed: true });
        }

        /**
         * Arm the one-shot ArtSoulDB readiness listener.
         *
         * Registered at most once per page: the listener itself is idempotent
         * and every recovery it triggers is capped per wallet generation, so
         * duplicate 'artsoul:db-ready' dispatches cannot become a request
         * storm. No timer, no polling, no DOM-mutation retry.
         */
        /**
         * Schedule the single pending retry after a failed profile read.
         *
         * Bounded by construction: it shares the per-generation budget with the
         * readiness-driven recovery (MAX_AUTOMATIC_IDENTITY_RECOVERIES), never
         * stacks more than one pending retry, and the callback re-checks the
         * identity generation so a wallet change or disconnect discards it.
         * Total profile reads per wallet generation stay at 1 + 2 = 3.
         */
        scheduleAutomaticRecovery() {
            if (this.recoveryTimer !== null) return false;
            if (this.automaticRecoveries >= MAX_AUTOMATIC_IDENTITY_RECOVERIES) return false;
            const delay = AUTOMATIC_RECOVERY_BACKOFF_MS[this.automaticRecoveries]
                ?? AUTOMATIC_RECOVERY_BACKOFF_MS[AUTOMATIC_RECOVERY_BACKOFF_MS.length - 1];
            const generation = this.identityGeneration;
            this.recoveryTimer = setTimeout(() => {
                this.recoveryTimer = null;
                // The authoritative guard: clearTimeout is only hygiene, this
                // check is what makes a superseded wallet impossible to revive.
                if (this.identityGeneration !== generation) return;
                this.recoverUnresolvedIdentity({ automatic: true });
            }, delay);
            return true;
        }

        cancelAutomaticRecovery() {
            if (this.recoveryTimer === null) return;
            clearTimeout(this.recoveryTimer);
            this.recoveryTimer = null;
        }

        armProfileBackendRecovery() {
            if (this.profileBackendListener) return false;
            this.profileBackendListener = () => {
                this.recoverUnresolvedIdentity({ automatic: true });
            };
            window.addEventListener(DB_READY_EVENT, this.profileBackendListener);
            return true;
        }

        /**
         * Re-attempt a connected identity whose profile read never succeeded.
         *
         * Automatic callers (ArtSoulDB readiness) pass { automatic: true } and
         * are capped at MAX_AUTOMATIC_IDENTITY_RECOVERIES per wallet
         * generation. Deliberate callers — opening the account menu, a genuine
         * wallet-state event, explicit refresh() — are uncapped but stay
         * idempotent through the in-flight request map. Arbitrary DOM mutations
         * are deliberately NOT a trigger: the nav observer watches the whole
         * document, so that would amplify a failing backend into one request
         * per unrelated render.
         *
         * Bounded by design: it runs only while the active wallet is still
         * unresolved, loadProfileOnce() collapses concurrent reads per wallet,
         * and a completed read (profile found or confirmed absent) closes the
         * path for the rest of the page lifetime. There is no timer and no poll.
         */
        recoverUnresolvedIdentity(options = {}) {
            if (window.artsoulWalletStateSettled !== true) return false;
            const wallet = String(
                window.currentWalletAddress
                || window.artsoulSettledWalletState?.address
                || ''
            ).toLowerCase();
            if (!/^0x[a-f0-9]{40}$/.test(wallet)) return false;
            if (this.identityWallet !== wallet) return false;
            if (this.resolvedIdentityWallet === wallet) return false;
            if (this.profileRequests.has(wallet)) return false;
            if (options.automatic === true) {
                if (this.automaticRecoveries >= MAX_AUTOMATIC_IDENTITY_RECOVERIES) return false;
                this.automaticRecoveries += 1;
            }
            this.init(wallet, { walletAddress: wallet, confirmed: true });
            return true;
        }

        renderInitializingState() {
            const container = this.getNavContainer();
            if (!container) return false;

            // The boot snapshot, never a fresh read: see appKitDisconnectedAtBoot.
            if (appKitDisconnectedAtBoot) {
                return this.renderConnectButton({ renderKey: 'initializing-disconnected' });
            }

            const storedWalletHint = (localStorage.getItem('artsoul_wallet') || '').toLowerCase();
            const cachedUiState = localStorage.getItem(this.headerStateStorageKey);
            const cachedIdentityWithoutHint = cachedUiState === 'connected'
                ? this.getCachedHeaderIdentity()
                : null;
            const storedWallet = /^0x[a-f0-9]{40}$/.test(storedWalletHint)
                ? storedWalletHint
                : (cachedIdentityWithoutHint?.wallet || '');
            const hasWalletHint = /^0x[a-f0-9]{40}$/.test(storedWallet);
            if (!hasWalletHint) return this.renderConnectButton({ renderKey: 'initializing' });
            let cachedIdentity = this.getCachedHeaderIdentity(storedWallet);
            const isMobileUA = MOBILE_USER_AGENT_PATTERN.test(navigator.userAgent);
            if (!cachedIdentity) {
                // A stored wallet with no complete cached identity. Render a
                // COHERENT resolving state instead of withholding the identity
                // text: the canonical avatar, a real "Connecting…" label and the
                // shortened stored address, all in the fixed geometry. The old
                // behaviour hid only the text and left the avatar visible, which
                // is exactly the "avatar plus empty black area" defect.
                //
                // This is visual continuity only. It claims no profile, and it
                // authorizes nothing: the menu still offers Connect Wallet until
                // the settled provider confirms the session.
                return this.renderResolvingState(storedWallet);
            }
            if (container.dataset.avatarRenderKey === 'cached-wallet' && container.querySelector('#avatarDropdownMenu')) return true;

            const currentPath = window.location.pathname;
            const isProfilePage = this.isPage(currentPath, 'profile');
            const viewingAddress = new URLSearchParams(window.location.search).get('address');
            const isOwnProfile = isProfilePage
                && (!viewingAddress || viewingAddress.toLowerCase() === storedWallet);
            const shortAddress = `${storedWallet.slice(0, 6)}...${storedWallet.slice(-4)}`;
            let networkInfo = this.getCachedHeaderNetwork(storedWallet);
            if (isMobileUA && networkInfo?.chainId === 84532 && networkInfo.baseSepoliaConfirmed !== true) {
                this.baseNetworkIcon = networkInfo.icon;
                networkInfo = {
                    ...networkInfo,
                    name: 'Base Sepolia',
                    balance: 'Tap to switch',
                    currency: '',
                    chainId: null,
                    requiresConfirmation: true
                };
            }
            container.dataset.avatarRenderKey = 'cached-wallet';
            container.dataset.avatarCacheHydrated = 'true';
            this.pendingRenderKey = 'cached-wallet';
            this.updateStableButton({
                avatarUrl: cachedIdentity.avatarUrl,
                avatarAlt: cachedIdentity.name,
                name: cachedIdentity.name,
                address: shortAddress,
                stateKey: `identity:${storedWallet}`,
                previewWallet: storedWallet,
                // 'restoring' is honest: this is the previously confirmed
                // presentation of this exact wallet, restored for visual
                // continuity. It authorizes nothing and is never persisted —
                // the settled provider still decides, and promotes this to
                // 'connected' without touching a single visible node.
                uiState: 'restoring',
                persistUiState: false
            });
            this.updateStableMenu(
                this.renderMenuContent({
                    currentPath,
                    isOwnProfile,
                    networkInfo,
                    restoring: true
                }),
                networkInfo
                    ? `connected:${currentPath}:${isOwnProfile}:${this.networkMenuKeySegment(networkInfo)}`
                    : `cached-restoring:${currentPath}:${isOwnProfile}`
            );
            this.applyThemeStyles();
            this.bindOutsideCloseOnce();
            return true;
        }

        /**
         * Render the coherent resolving state for a stored wallet whose profile
         * identity is not cached yet.
         *
         * Every visible part is filled: the canonical ArtSoul avatar, a real
         * "Connecting…" label and the shortened stored address, inside the same
         * fixed geometry as every other state. There is no hidden text region
         * and no fabricated profile identity.
         *
         * Strictly visual. The menu stays the guest menu — Connect Wallet, no
         * network row, no balance, no Disconnect — until the settled provider
         * confirms the session, so nothing here authorizes anything.
         */
        renderResolvingState(storedWallet) {
            const container = this.getNavContainer();
            if (!container) return false;

            const currentPath = window.location.pathname;
            const isProfilePage = this.isPage(currentPath, 'profile');
            container.dataset.avatarRenderKey = 'resolving';
            this.pendingRenderKey = 'resolving';
            this.updateStableButton({
                avatarUrl: NEUTRAL_AVATAR_URL,
                avatarAlt: 'ArtSoul',
                name: RESOLVING_IDENTITY_LABEL,
                address: `${storedWallet.slice(0, 6)}...${storedWallet.slice(-4)}`,
                stateKey: `resolving:${storedWallet}`,
                uiState: 'resolving',
                persistUiState: false
            });
            this.updateStableMenu(
                this.renderMenuContent({ currentPath, isOwnProfile: isProfilePage }),
                `resolving:${currentPath}:${isProfilePage}`
            );
            this.applyThemeStyles();
            this.bindOutsideCloseOnce();
            return true;
        }

        /**
         * Render connect button when wallet not connected
         */
        renderConnectButton(options = {}) {
            let container = this.getNavContainer();

            if (!container) return false;
            if (options.renderKey) {
                container.dataset.avatarRenderKey = options.renderKey;
                this.pendingRenderKey = options.renderKey;
            }

            // Guest is a wallet transition too: beginIdentityTransition() drops
            // the identity bound to the wallet we are leaving, if there was one.
            this.beginIdentityTransition(null);

            const currentPath = window.location.pathname;
            const isProfilePage = this.isPage(currentPath, 'profile');
            this.updateStableButton({
                avatarUrl: NEUTRAL_AVATAR_URL,
                avatarAlt: 'ArtSoul',
                name: 'ArtSoul Guest',
                address: '',
                stateKey: options.renderKey || 'guest',
                // A real disconnect commits the complete guest identity at once.
                uiState: 'disconnected'
            });
            this.clearProtocolAdminAccess();
            this.updateStableMenu(
                this.renderMenuContent({ currentPath, isOwnProfile: isProfilePage }),
                `guest:${currentPath}:${isProfilePage}`
            );
            this.applyThemeStyles();
            this.bindOutsideCloseOnce();
            return true;
        }

        /**
         * Render the connected header without a resolved profile.
         *
         * options.resolved === false means the identity is still UNRESOLVED
         * (ArtSoulDB not ready, or the read failed). Then a header identity
         * cached for THIS exact normalized address is reused, so a returning
         * user keeps their real avatar instead of flashing a neutral one.
         * options.resolved !== false means the backend answered definitively
         * that this wallet has no profile/avatar: the canonical neutral avatar
         * is correct and a stale cached avatar must NOT be resurrected.
         *
         * Either way the row stays unmistakably connected — address, network,
         * balance and Disconnect — and never renders the guest identity.
         */
        async renderWalletInfo(walletAddress, options = {}) {
            const navButtons = this.getNavContainer();
            if (!navButtons) return;
            if (options.renderKey) navButtons.dataset.avatarRenderKey = options.renderKey;

            const currentPath = window.location.pathname;
            const isProfilePage = this.isPage(currentPath, 'profile');
            const urlParams = new URLSearchParams(window.location.search);
            const viewingAddress = urlParams.get('address');
            const currentWallet = walletAddress?.toLowerCase();
            const isOwnProfile = isProfilePage && (!viewingAddress || viewingAddress.toLowerCase() === currentWallet);

            const cachedIdentity = options.resolved === false
                ? this.getCachedHeaderIdentity(currentWallet)
                : null;
            const avatarUrl = cachedIdentity?.avatarUrl || NEUTRAL_AVATAR_URL;
            const shortAddress = this.shortWalletAddress(walletAddress);
            const displayedName = cachedIdentity?.name || shortAddress;

            if (options.renderKey && this.pendingRenderKey !== options.renderKey) return;
            // A profile recovery can complete while this unresolved fallback is
            // still pending. Both renders intentionally share the same render
            // key, so the key alone cannot distinguish them. Once this wallet has
            // a resolved profile result, the older fallback must not repaint its
            // name or avatar.
            if (options.resolved === false && this.resolvedIdentityWallet === currentWallet) return;

            // Identity first, network afterwards — see render(). The balance RPC
            // must never hold the connected avatar, name and address off screen.
            this.updateStableButton({
                avatarUrl,
                avatarAlt: displayedName,
                name: displayedName,
                address: shortAddress,
                stateKey: options.renderKey || `wallet:${currentWallet}`,
                previewWallet: currentWallet,
                uiState: 'connected'
            });
            this.updateStableMenu(
                this.renderMenuContent({
                    currentPath,
                    isOwnProfile,
                    networkInfo: this.getCachedHeaderNetwork(currentWallet),
                    connected: true
                }),
                `connected:${currentPath}:${isOwnProfile}:${this.networkMenuKeySegment(this.getCachedHeaderNetwork(currentWallet))}`
            );
            this.applyThemeStyles();
            this.syncProtocolAdminWallet(walletAddress);
            this.bindOutsideCloseOnce();
            void this.applyLiveNetworkSection({
                walletAddress,
                currentPath,
                isOwnProfile,
                renderKey: options.renderKey || this.pendingRenderKey
            });
        }
    }

    // Export singleton
    window.AvatarDropdown = new AvatarDropdown();
    window.ThemeManager?.addListener?.((theme) => {
        window.AvatarDropdown.applyThemeStyles(theme);
    });

    const syncCurrentMenu = (options = {}) => {
        const walletAddress = window.currentWalletAddress || null;
        return window.AvatarDropdown.sync(walletAddress, options);
    };

    window.addEventListener('artsoul:wallet-state-changed', (event) => {
        const detail = event?.detail || {};

        if (detail.isConnected && detail.address) {
            window.AvatarDropdown.sync(detail.address, {
                chainId: detail.chainId,
                confirmed: true
            });
            return;
        }

        if (detail.isConnected === false) {
            window.AvatarDropdown.sync(null, {
                chainId: detail.chainId,
                confirmed: false
            });
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => syncCurrentMenu());
    } else {
        syncCurrentMenu();
    }

    window.addEventListener('artsoul:nav-ready', () => syncCurrentMenu());

    // The observer watches the whole document, so gallery renders, filter
    // changes and artwork loading all reach it. It therefore acts on EXACTLY one
    // condition: the shared account button is missing, i.e. the header was
    // genuinely removed or replaced. Any other mutation is ignored outright.
    //
    // It previously also re-ran renderInitializingState() while the wallet was
    // unsettled, which re-applied the resolving presentation on every unrelated
    // React render and reset the visible identity for seconds at a time.
    //
    // Recovery of an unresolved profile stays on deliberate, bounded events:
    // account-menu open, a genuine wallet-state event, ArtSoulDB readiness and
    // explicit refresh(). No polling, no arbitrary-mutation retries.
    const navObserver = new MutationObserver(() => {
        const container = window.AvatarDropdown.getNavContainer();
        if (!container || container.querySelector('.avatar-button')) return;
        if (window.artsoulWalletStateSettled === true) {
            syncCurrentMenu();
            return;
        }
        // Rebuild the pre-settle shell from the same coherent state the boot
        // path uses, so a replaced header never comes back as a bare guest.
        window.AvatarDropdown.renderInitializingState();
    });

    const startNavObserver = () => {
        navObserver.observe(document.documentElement, { childList: true, subtree: true });
    };

    startNavObserver();

    // unified-styles.css owns the component from first paint so hydration
    // cannot introduce a second set of visual rules.

    // Reconcile the pre-settle shell after the deferred component is available.
    // header-prepaint.js already committed the first visible frame immediately
    // after the static shell. Matching content keys let this component adopt
    // that frame without rewriting the avatar, name or address.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.AvatarDropdown.renderInitializingState(), { once: true });
    } else {
        window.AvatarDropdown.renderInitializingState();
    }

    console.log('📦 Avatar Dropdown module loaded');
})();
