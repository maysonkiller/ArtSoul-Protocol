// Avatar Dropdown Component for ArtSoul
// Shows user avatar with dropdown menu in navigation

(function() {
    'use strict';

    const BASE_SEPOLIA_RPC_URL = 'https://sepolia.base.org';

    const ETHEREUM_NETWORK_ICON = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMiIgZmlsbD0iIzYyN0VFQSIvPjxwYXRoIGQ9Ik0xMiA0TDYgMTJMMTIgMTZMMTggMTJMMTIgNFoiIGZpbGw9IndoaXRlIi8+PHBhdGggZD0iTTEyIDE3TDYgMTNMMTIgMjBMMTggMTNMMTIgMTdaIiBmaWxsPSJ3aGl0ZSIvPjwvc3ZnPg==';

    class AvatarDropdown {
        constructor() {
            this.profile = null;
            this.isOpen = false;
            this.container = null;
            this.currentRenderKey = null;
            this.pendingRenderKey = null;
            this.profileCache = new Map();
            this.profileRequests = new Map();
            this.headerIdentityStorageKey = 'artsoul_header_identity';
            this.headerNetworkStorageKey = 'artsoul_header_network';
            this.headerStateStorageKey = 'artsoul_header_ui_state';
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

        updateStableButton({ avatarUrl, avatarAlt, name, address = '', stateKey }) {
            const structure = this.getStableStructure();
            if (!structure) return null;
            const { button } = structure;
            const contentKey = `${stateKey || ''}|${avatarUrl || ''}|${name || ''}|${address || ''}`;
            if (button.dataset.avatarContentKey === contentKey) return structure;

            const image = button.querySelector('[data-avatar-image]');
            const nameNode = button.querySelector('[data-avatar-name]');
            const addressNode = button.querySelector('[data-avatar-address]');
            const fallback = this.getDefaultAvatar();
            const nextAvatarUrl = avatarUrl || '/default-avatar.png';
            const nextName = name || 'ArtSoul Guest';
            const currentAddress = addressNode?.hidden ? '' : (addressNode?.textContent || '');
            const contentAlreadyMatches = image?.getAttribute('src') === nextAvatarUrl
                && nameNode?.textContent === nextName
                && currentAddress === (address || '');

            if (contentAlreadyMatches) {
                button.dataset.avatarContentKey = contentKey;
                return structure;
            }

            if (image) {
                const revealAvatar = () => image.classList.remove('avatar-image-loading');
                if (image.getAttribute('src') !== nextAvatarUrl) {
                    image.classList.add('avatar-image-loading');
                    image.addEventListener('load', revealAvatar, { once: true });
                }
                image.src = nextAvatarUrl;
                image.alt = avatarAlt || nextName || 'ArtSoul';
                image.onerror = () => {
                    image.onerror = null;
                    image.src = fallback;
                    if (image.complete) revealAvatar();
                };
                if (image.complete) revealAvatar();
            }
            if (nameNode) nameNode.textContent = nextName;
            if (addressNode) {
                addressNode.hidden = !address;
                addressNode.textContent = address || '';
                addressNode.setAttribute('aria-hidden', address ? 'false' : 'true');
            }

            button.dataset.avatarContentKey = contentKey;
            return structure;
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

        getNavigationItems() {
            const labels = this.getNavigationLabels();
            // Auctions / Marketplace / Collections live as tabs inside Explore Art
            // (gallery.html), so they are intentionally NOT separate dropdown
            // destinations — one clear path to the gallery.
            return [
                { href: 'profile.html', label: labels.profile, path: 'profile.html', profile: true },
                { href: 'index.html', label: labels.home || 'ArtSoul Home', path: 'index.html', home: true },
                { href: 'gallery.html', label: labels.explore, path: 'gallery.html' },
                { href: 'upload.html', label: labels.publish, path: 'upload.html' },
                { href: 'docs-protocol.html', label: labels.docs || 'Protocol Docs', path: 'docs-protocol.html' }
            ];
        }

        isCurrentNavigationItem(item, currentPath = window.location.pathname, currentHash = window.location.hash) {
            const isHome = item.home && (currentPath.endsWith('index.html') || currentPath === '/' || currentPath.endsWith('/'));
            const isSamePath = currentPath.includes(item.path);
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
            try {
                localStorage.setItem(this.headerIdentityStorageKey, JSON.stringify(identity));
            } catch {
                // The normal async profile render remains available without storage.
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
            return normalizedAddress ? `wallet:${normalizedAddress}` : 'guest';
        }

        commitVisibleState(state) {
            document.documentElement.classList.remove('wallet-state-resolving');
            document.documentElement.dataset.walletUiState = state;
            this.getNavContainer()?.setAttribute('aria-busy', 'false');
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

            if (!options.refreshProfile && hasMenuButton && container.dataset.avatarRenderKey === renderKey) {
                return true;
            }

            container.dataset.avatarRenderKey = renderKey;
            this.pendingRenderKey = renderKey;

            if (confirmedAddress) {
                this.init(confirmedAddress, { renderKey, walletAddress: confirmedAddress });
                return true;
            }

            return this.renderConnectButton({ renderKey });
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

            try {
                this.profile = await this.loadProfileOnce(walletAddress, {
                    refresh: options.refreshProfile === true
                });

                if (!this.profile) {
                    if (this.pendingRenderKey !== renderKey) return;
                    await this.renderWalletInfo(walletAddress, { renderKey });
                    return;
                }

                if (this.pendingRenderKey !== renderKey) return;
                await this.render({ renderKey, walletAddress });
            } catch (error) {
                console.error(' Failed to load profile:', error);
                console.log('👤 Falling back to wallet info due to error');
                // Show wallet info on error instead of connect button
                if (this.pendingRenderKey !== renderKey) return;
                await this.renderWalletInfo(walletAddress, { renderKey });
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
                .then(() => window.ArtSoulDB.getProfile(walletAddress))
                .then(profile => {
                    this.profileCache.set(cacheKey, profile || null);
                    if (profile) {
                        this.cacheHeaderIdentity(profile, walletAddress);
                        console.log('👤 Profile loaded:', profile.username || walletAddress);
                    } else {
                        console.log('👤 No profile found for wallet:', walletAddress);
                    }
                    return profile || null;
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
                },
                2025: {
                    name: 'Rialo',
                    icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTIiIGZpbGw9IiMwMDAwMDAiLz4KPHBhdGggZD0iTTEyLjUgOC4yQzEyLjIgOC4xOCAxMS44NSA3Ljk1IDExLjY1IDcuNjVDMTEuMzUgNy4yIDExLjI1IDYuNSAxMS41NSA2QzExLjk1IDUuMyAxMi41IDUuMTUgMTMuMDUgNS4yQzEzLjUgNS4yIDE0LjUgNS4yMiAxNS4xIDUuMjJDMTUuMzUgNS4yMiAxNS41NSA1LjI0IDE1Ljc1IDUuMkMxNi4yIDUuMTIgMTYuNiA0Ljg1IDE2Ljg1IDQuNUMxNy4zIDMuODUgMTcuMTUgMi45IDE2LjU1IDIuNUMxNi4yIDIuMjUgMTUuOCAyLjE1IDE1LjQgMi4xMkMxNS4yIDIuMSAxNSAyLjA4IDE0Ljg1IDIuMDJDMTQuMyAxLjggMTMuOSAxLjMgMTMuNzUgMC44QzEzLjY1IDAuNTUgMTMuNjUgMC4yOCAxMy42IDAuMDJDMTMuNDUgLTAuNSAxMyAtMC45IDEyLjUgLTFDMTIuMzUgLTEuMDUgMTIuMiAtMS4wOCAxMi4wNSAtMS4wOEMxMC41IC0xLjEgOCAtMS4xNSA3LjUgLTEuMTVDNi44IC0xLjE3IDYuMTUgLTAuNjUgNiAwLjAyQzUuOCAwLjcgNi4xNSAxLjQ1IDYuOCAxLjhDNy4xIDEuOTUgNy4zIDEuOTggNy42IDEuOTdDOC41IDEuOTggOC40NSAyIDguOTUgMi4wMkM5LjU1IDEuOTggMTAuMiAyLjMgMTAuNSAyLjlDMTEuMTUgNC4yIDEwLjIgNS4yIDkgNS4xMkM3LjUgNS4xNSA2LjggNS4xMyA0LjUgNS4xM0M0LjEgNS4xNCAzLjg1IDUuMSAzLjUgNS4yMkMyLjUgNS41IDIgNi41IDIuMiA3LjRDMi40IDggMi45IDguNDUgMy41IDguNkM0LjMgOC43IDUuNSA4LjY1IDcuNSA4LjY4QzggOC42OCA4LjMgOC42OCA4LjUgOC42OEM4LjY1IDguNjggOC44IDguNyA4Ljk1IDguNzVDOS44IDguOTUgMTAuMzUgOS43NSAxMC4zIDEwLjZDMTAuMyAxMS4yIDEwLjMgMTMuNSAxMC4zIDE0LjVDMTAuMyAxNC44NSAxMC4zNSAxNS4yIDEwLjU1IDE1LjU1QzExIDE2LjUgMTIuMiAxNi44NSAxMyAxNi4zQzEzLjYgMTUuOSAxMy43NSAxNS4yIDEzLjcgMTQuNEMxMy43IDEzLjYgMTMuNyAxMi4yIDEzLjcgMTEuNUMxMy44IDEwLjIgMTMgOS4zIDEyLjUgOS4yVjguMloiIGZpbGw9IiNBOURERDMiLz4KPC9zdmc+Cg==',
                    color: '#A9DDD3',
                    currency: 'RIA'
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

        renderNetworkOptions(currentChainId) {
            const baseSepoliaOption = Number(currentChainId) === 84532 ? '' : `
                    <button
                        type="button"
                        class="dropdown-item avatar-network-option"
                        onclick="window.AvatarDropdown.selectNetwork(84532, event)"
                    >
                        <img src="${this.baseNetworkIcon || ''}" alt="" aria-hidden="true" />
                        <span class="network-option-name">Base Sepolia</span>
                    </button>
            `;
            return `
                <div id="avatarNetworkOptions" class="avatar-network-options avatar-network-future-options" hidden>
                    ${baseSepoliaOption}
                    <button
                        type="button"
                        class="dropdown-item avatar-network-option is-disabled"
                        disabled
                        aria-disabled="true"
                        title="Coming soon"
                    >
                        <img src="${ETHEREUM_NETWORK_ICON}" alt="" aria-hidden="true" />
                        <span class="network-option-name">ETH Sepolia</span>
                        <span class="network-soon-badge">SOON</span>
                    </button>
                </div>
            `;
        }

        renderMenuContent({ currentPath, isOwnProfile, networkInfo = null, restoring = false, connected = false }) {
            const networkSection = networkInfo ? `
                <button
                    type="button"
                    class="dropdown-item network-switcher-btn network-current-row"
                    onclick="window.AvatarDropdown.handleNetworkRowClick(event)"
                    aria-expanded="false"
                    aria-controls="avatarNetworkOptions"
                >
                    <img src="${networkInfo.icon}" alt="${networkInfo.name}" onerror="this.style.display='none'" />
                    <div class="network-switcher-copy">
                        <div><span data-network-name>${networkInfo.name}</span></div>
                        <div data-network-balance>${networkInfo.balance} ${networkInfo.currency}</div>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 16 16" class="network-options-arrow menu-chevron" aria-hidden="true">
                        <path d="M4 6l4 4 4-4"></path>
                    </svg>
                </button>
                ${this.renderNetworkOptions(networkInfo.chainId)}
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
            const isProfilePage = currentPath.includes('profile.html');
            // Check if viewing own profile (no address parameter or address matches current wallet)
            const urlParams = new URLSearchParams(window.location.search);
            const viewingAddress = urlParams.get('address');
            const currentWallet = this.profile?.wallet_address?.toLowerCase();
            const isOwnProfile = isProfilePage && (!viewingAddress || viewingAddress.toLowerCase() === currentWallet);

            const walletAddress = this.profile?.wallet_address || options.walletAddress || window.currentWalletAddress || '';
            const shortAddress = walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : '';
            const avatarUrl = this.getProfileAvatarUrl(this.profile);
            const username = this.getProfileDisplayName(this.profile, walletAddress);
            const networkInfo = await this.getCurrentNetworkInfo({ walletAddress });

            if (options.renderKey && this.pendingRenderKey !== options.renderKey) return;

            this.updateStableButton({
                avatarUrl,
                avatarAlt: username,
                name: username,
                address: shortAddress,
                stateKey: `identity:${walletAddress.toLowerCase()}`
            });
            this.commitVisibleState('connected');
            this.updateStableMenu(
                this.renderMenuContent({ currentPath, isOwnProfile, networkInfo, connected: true }),
                `connected:${currentPath}:${isOwnProfile}`
            );
            this.applyThemeStyles();
            void this.updateNetworkDisplay();
            this.bindOutsideCloseOnce();
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

        getThemeColor(variableName, fallback) {
            try {
                return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim() || fallback;
            } catch {
                return fallback;
            }
        }

        /**
         * Get default avatar (first letter of username or generic icon)
         */
        getDefaultAvatar() {
            // Use ArtSoul logo as default avatar (same as header logo)
            // Beautiful gradient with transparent background
            const primary = this.getThemeColor('--c-accent', 'currentColor');
            const secondary = this.getThemeColor('--c-accent-2', primary);
            const svg = `data:image/svg+xml,${encodeURIComponent(`
                <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" style="stop-color:${primary};stop-opacity:1" />
                            <stop offset="100%" style="stop-color:${secondary};stop-opacity:1" />
                        </linearGradient>
                    </defs>
                    <!-- Outer circle with gradient border -->
                    <circle cx="20" cy="20" r="18" fill="none" stroke="url(#logoGradient)" stroke-width="2"/>
                    <!-- Inner artistic "A" shape -->
                    <path d="M20 8 L28 28 L24 28 L22 22 L18 22 L16 28 L12 28 Z M19 18 L21 18 L20 13 Z"
                          fill="url(#logoGradient)"/>
                </svg>
            `)}`;
            return svg;
        }

        getProfileDisplayName(profile, walletAddress) {
            const resolver = window.ArtSoulProfileDisplay?.displayName || window.ArtSoulDB?.displayName;
            const fallback = walletAddress ? 'ArtSoul User' : 'ArtSoul Guest';
            return resolver?.(profile, walletAddress) || fallback;
        }

        getProfileAvatarUrl(profile) {
            const resolver = window.ArtSoulProfileDisplay?.avatarUrl || window.ArtSoulDB?.avatarUrl;
            return resolver?.(profile, this.getDefaultAvatar()) || this.getDefaultAvatar();
        }

        /**
         * Update profile (call after profile changes)
         */
        async refresh(walletAddress) {
            return this.sync(walletAddress, { refreshProfile: true, confirmed: true });
        }

        renderInitializingState() {
            const container = this.getNavContainer();
            if (!container) return false;

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
            // Mobile core path (WalletConnect session restore is async on every
            // page load): a stored wallet renders the connected header
            // immediately, even without a cached identity — the address is the
            // optimistic identity. Desktop keeps its resolving state.
            const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            if (!cachedIdentity && isMobileUA) {
                cachedIdentity = {
                    name: `${storedWallet.slice(0, 6)}...${storedWallet.slice(-4)}`,
                    avatarUrl: this.getDefaultAvatar()
                };
            }
            if (!cachedIdentity) {
                document.documentElement.classList.add('wallet-state-resolving');
                container.setAttribute('aria-busy', 'true');
                return true;
            }
            if (container.dataset.avatarRenderKey === 'cached-wallet' && container.querySelector('#avatarDropdownMenu')) return true;

            const currentPath = window.location.pathname;
            const isProfilePage = currentPath.includes('profile.html');
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
                stateKey: `identity:${storedWallet}`
            });
            this.commitVisibleState('connected');
            this.updateStableMenu(
                this.renderMenuContent({
                    currentPath,
                    isOwnProfile,
                    networkInfo,
                    restoring: true
                }),
                networkInfo
                    ? `connected:${currentPath}:${isOwnProfile}`
                    : `cached-restoring:${currentPath}:${isOwnProfile}`
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

            const currentPath = window.location.pathname;
            const isProfilePage = currentPath.includes('profile.html');
            this.updateStableButton({
                avatarUrl: '/default-avatar.png',
                avatarAlt: 'ArtSoul',
                name: 'ArtSoul Guest',
                address: '',
                stateKey: options.renderKey || 'guest'
            });
            this.commitVisibleState('disconnected');
            this.updateStableMenu(
                this.renderMenuContent({ currentPath, isOwnProfile: isProfilePage }),
                `guest:${currentPath}:${isProfilePage}`
            );
            this.applyThemeStyles();
            this.bindOutsideCloseOnce();
            return true;
        }

        /**
         * Render wallet info when connected but no profile
         */
        async renderWalletInfo(walletAddress, options = {}) {
            const navButtons = this.getNavContainer();
            if (!navButtons) return;
            if (options.renderKey) navButtons.dataset.avatarRenderKey = options.renderKey;

            const currentPath = window.location.pathname;
            const isProfilePage = currentPath.includes('profile.html');
            const urlParams = new URLSearchParams(window.location.search);
            const viewingAddress = urlParams.get('address');
            const currentWallet = walletAddress?.toLowerCase();
            const isOwnProfile = isProfilePage && (!viewingAddress || viewingAddress.toLowerCase() === currentWallet);

            const avatarUrl = this.getDefaultAvatar();
            const shortAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
            const networkInfo = await this.getCurrentNetworkInfo({ walletAddress });

            if (options.renderKey && this.pendingRenderKey !== options.renderKey) return;

            this.updateStableButton({
                avatarUrl,
                avatarAlt: 'ArtSoul User',
                name: 'ArtSoul User',
                address: shortAddress,
                stateKey: options.renderKey || `wallet:${currentWallet}`
            });
            this.commitVisibleState('connected');
            this.updateStableMenu(
                this.renderMenuContent({ currentPath, isOwnProfile, networkInfo, connected: true }),
                `connected:${currentPath}:${isOwnProfile}`
            );
            this.applyThemeStyles();
            void this.updateNetworkDisplay();
            this.bindOutsideCloseOnce();
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

    const navObserver = new MutationObserver(() => {
        const container = window.AvatarDropdown.getNavContainer();
        if (container && window.artsoulWalletStateSettled !== true && container.dataset.avatarCacheHydrated !== 'true') {
            window.AvatarDropdown.renderInitializingState();
        } else if (container && !container.querySelector('.avatar-button')) {
            syncCurrentMenu();
        }
    });

    const startNavObserver = () => {
        navObserver.observe(document.documentElement, { childList: true, subtree: true });
    };

    startNavObserver();

    // unified-styles.css owns the component from first paint so hydration
    // cannot introduce a second set of visual rules.

    console.log('📦 Avatar Dropdown module loaded');
})();
