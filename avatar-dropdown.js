// Avatar Dropdown Component for ArtSoul
// Shows user avatar with dropdown menu in navigation

(function() {
    'use strict';

    class AvatarDropdown {
        constructor() {
            this.profile = null;
            this.isOpen = false;
            this.container = null;
            this.currentRenderKey = null;
            this.pendingRenderKey = null;
        }

        getNavContainer() {
            return document.getElementById('navButtons') || document.getElementById('avatarButton');
        }

        getNavigationLabels() {
            return window.ArtSoulNavigationLabels || {
                explore: 'Explore Art',
                publish: 'Publish Artwork',
                auctions: 'Auctions',
                marketplace: 'Marketplace',
                collections: 'Collections',
                docs: 'Docs',
                profile: 'Profile'
            };
        }

        getNavigationItems() {
            const labels = this.getNavigationLabels();
            // Auctions / Marketplace / Collections live as tabs inside Explore Art
            // (gallery.html), so they are intentionally NOT separate dropdown
            // destinations — one clear path to the gallery.
            return [
                { href: 'gallery.html', label: labels.explore, path: 'gallery.html' },
                { href: 'upload.html', label: labels.publish, path: 'upload.html' },
                { href: 'auction-system.html', label: 'Protocol', path: 'auction-system.html' },
                { href: 'docs.html', label: labels.docs, path: 'docs.html' },
                { href: 'profile.html', label: labels.profile, path: 'profile.html', profile: true }
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
                .filter(item => !(item.profile && options.isOwnProfile))
                .filter(item => item.profile || !this.isCurrentNavigationItem(item, currentPath, currentHash))
                .map(item => `
                    <a
                        href="${item.href}"
                        class="dropdown-item"
                        style="
                            display: flex;
                            align-items: center;
                            gap: 0.75rem;
                            padding: 0.75rem;
                            border-radius: 0.5rem;
                            cursor: pointer;
                            transition: all 0.2s;
                            text-decoration: none;
                            color: inherit;
                        "
                    >
                        <span>${item.label}</span>
                    </a>
                `)
                .join('');
        }

        parseChainId(value) {
            if (value === null || value === undefined || value === '') return null;
            if (typeof value === 'number') return Number.isFinite(value) ? value : null;
            if (typeof value === 'bigint') return Number(value);
            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (!trimmed) return null;
                return trimmed.startsWith('0x') ? parseInt(trimmed, 16) : parseInt(trimmed, 10);
            }
            return null;
        }

        getNormalizedChainId(state = {}) {
            const modalState = window.web3Modal?.getState?.();
            const candidates = [
                state?.chainId,
                modalState?.chainId,
                window.ethereum?.chainId,
                window.currentChainId,
                localStorage.getItem('artsoul_chain_id'),
                state?.selectedNetworkId,
                modalState?.selectedNetworkId
            ];

            for (const candidate of candidates) {
                const chainId = this.parseChainId(candidate);
                if (chainId) return chainId;
            }

            return null;
        }

        getRenderKey(walletAddress, state = {}) {
            const normalizedAddress = walletAddress ? walletAddress.toLowerCase() : '';
            const chainId = this.getNormalizedChainId(state) || 'none';
            return normalizedAddress ? `wallet:${normalizedAddress}:chain:${chainId}` : 'guest';
        }

        isWalletConnectionConfirmed(walletAddress, options = {}) {
            if (!walletAddress) return false;
            const normalizedAddress = walletAddress.toLowerCase();

            if (options.confirmed === true) return true;

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

            if (!options.force && hasMenuButton && container.dataset.avatarRenderKey === renderKey) {
                return true;
            }

            container.dataset.avatarRenderKey = renderKey;

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

            console.log('👤 Initializing avatar dropdown for wallet:', walletAddress);

            try {
                // Load profile from Supabase
                this.profile = await window.ArtSoulDB.getProfile(walletAddress);

                if (!this.profile) {
                    console.log('👤 No profile found for wallet:', walletAddress);
                    this.renderWalletInfo(walletAddress, { renderKey });
                    return;
                }

                console.log('👤 Profile loaded:', this.profile.username || walletAddress);
                if (this.pendingRenderKey !== renderKey) return;
                this.render({ renderKey, walletAddress });
            } catch (error) {
                console.error(' Failed to load profile:', error);
                console.log('👤 Falling back to wallet info due to error');
                // Show wallet info on error instead of connect button
                if (this.pendingRenderKey !== renderKey) return;
                this.renderWalletInfo(walletAddress, { renderKey });
            }
        }

        /**
         * Get current network info with balance
         */
        async getCurrentNetworkInfo() {
            const chainId = this.getNormalizedChainId();

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
                    icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMiIgZmlsbD0iIzYyN0VFQSIvPjxwYXRoIGQ9Ik0xMiA0TDYgMTJMMTIgMTZMMTggMTJMMTIgNFoiIGZpbGw9IndoaXRlIi8+PHBhdGggZD0iTTEyIDE3TDYgMTNMMTIgMjBMMTggMTNMMTIgMTdaIiBmaWxsPSJ3aGl0ZSIvPjwvc3ZnPg==',
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

            // Get balance
            let balance = '0.0000';
            if (chainId && window.currentWalletAddress) {
                try {
                    const provider = await window.web3Modal?.getWalletProvider();
                    if (provider && provider.request) {
                        const balanceHex = await provider.request({
                            method: 'eth_getBalance',
                            params: [window.currentWalletAddress, 'latest']
                        });
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
                return { name: 'Connecting...', icon: '', color: '#888888', currency: 'ETH', balance: '0.0000' };
            }

            const network = networks[chainId];
            if (!network) {
                // Unsupported network
                return { name: 'Unsupported', icon: '', color: '#ff6b6b', currency: 'ETH', balance: '0.0000' };
            }

            return { ...network, balance };
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
                if (balance) balance.textContent = `${networkInfo.balance} ${networkInfo.currency}`;
            }
        }

        /**
         * Render avatar dropdown
         */
        async render(options = {}) {
            const navButtons = this.getNavContainer();
            if (!navButtons) return;
            if (options.renderKey) navButtons.dataset.avatarRenderKey = options.renderKey;

            const currentPath = window.location.pathname;
            const isIndexPage = currentPath.endsWith('index.html') || currentPath === '/' || currentPath.endsWith('/');
            const isGalleryPage = currentPath.includes('gallery.html');
            const isUploadPage = currentPath.includes('upload.html');
            const isDocsPage = currentPath.includes('docs.html');

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

            // Get current network info with balance
            const networkInfo = await this.getCurrentNetworkInfo();

            // Create avatar dropdown HTML
            navButtons.innerHTML = `
                <div class="avatar-dropdown-container" style="position: relative;">
                    <!-- Avatar Button -->
                    <button
                        class="avatar-button"
                        onclick="window.AvatarDropdown.toggle()"
                        style="
                            display: flex;
                            align-items: center;
                            gap: 0.75rem;
                            padding: 0.5rem;
                            border-radius: 9999px;
                            cursor: pointer;
                            transition: all 0.3s;
                            border: 2px solid transparent;
                        "
                    >
                        <!-- Avatar -->
                        <img
                            src="${avatarUrl}"
                            alt="${username}"
                            style="
                                width: 40px;
                                height: 40px;
                                border-radius: 9999px;
                                object-fit: cover;
                                flex-shrink: 0;
                            "
                            onerror="this.src='${this.getDefaultAvatar()}'"
                        />

                        <!-- Username & Address (hidden on mobile) -->
                        <div class="avatar-info" style="text-align: left;">
                            <div style="font-weight: 600; font-size: 0.875rem;">${username}</div>
                            <div style="font-size: 0.75rem; opacity: 0.6; font-family: monospace;">${shortAddress}</div>
                        </div>

                        <!-- Dropdown Arrow -->
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            style="transition: transform 0.3s; flex-shrink: 0;"
                            class="dropdown-arrow"
                        >
                            <path d="M4 6l4 4 4-4"/>
                        </svg>
                    </button>

                    <div
                        id="avatarDropdownMenu"
                        class="avatar-dropdown-menu"
                        style="
                            display: none;
                            position: absolute;
                            top: calc(100% + 0.5rem);
                            right: 0;
                            min-width: 220px;
                            border-radius: 0.75rem;
                            padding: 0.5rem;
                            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
                            z-index: 10002;
                        "
                    >
                        <!-- Theme Switcher -->
                        <div style="padding: 0.5rem; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                            <div class="avatar-theme-label">Theme Mode</div>
                            <div class="theme-toggle avatar-theme-switch" style="width: 100%;">
                                <button onclick="window.setTheme('classic')" id="classicBtnDropdown" class="theme-btn" style="flex: 1;">Classic</button>
                                <button onclick="window.setTheme('future')" id="futureBtnDropdown" class="theme-btn" style="flex: 1;">Future</button>
                            </div>
                        </div>

                        <!-- Network Switcher -->
                        <button
                            onclick="window.openArtSoulNetworkSelector?.()"
                            class="dropdown-item network-switcher-btn"
                            style="
                                display: flex;
                                align-items: center;
                                gap: 0.75rem;
                                padding: 0.75rem;
                                border-radius: 0.5rem;
                                cursor: pointer;
                                transition: all 0.2s;
                                width: 100%;
                                border: none;
                                background: transparent;
                                color: inherit;
                                text-align: left;
                            "
                        >
                            <img src="${networkInfo.icon}" alt="${networkInfo.name}" style="width: 20px; height: 20px; border-radius: 50%;" onerror="this.style.display='none'" />
                            <div style="flex: 1;">
                                <div><span data-network-name>${networkInfo.name}</span></div>
                                <div data-network-balance style="font-size: 0.75rem; opacity: 0.7; font-family: monospace;">${networkInfo.balance} ${networkInfo.currency}</div>
                            </div>
                        </button>

                        <div style="border-top: 1px solid rgba(255, 255, 255, 0.1); margin: 0.25rem 0;"></div>

                        <!-- Menu Items -->
                        <div style="padding: 0.25rem 0;">
                            ${this.renderDropdownNavItems({ currentPath, isOwnProfile })}

                            <div style="border-top: 1px solid rgba(255, 255, 255, 0.1); margin: 0.25rem 0;"></div>

                            <button
                                onclick="window.resetWalletConnection()"
                                class="dropdown-item"
                                style="
                                    display: flex;
                                    align-items: center;
                                    gap: 0.75rem;
                                    padding: 0.75rem;
                                    border-radius: 0.5rem;
                                    cursor: pointer;
                                    transition: all 0.2s;
                                    width: 100%;
                                    border: none;
                                    background: transparent;
                                    color: inherit;
                                    text-align: left;
                                "
                            >
                                <span>Disconnect</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;

            // Apply theme-specific styles
            this.applyThemeStyles();

            // Clean up old event listeners before adding new ones
            if (this.closeHandler) {
                document.removeEventListener('click', this.closeHandler);
                document.removeEventListener('touchstart', this.closeHandler);
            }

            // Close dropdown when clicking outside
            this.closeHandler = (e) => {
                const container = document.querySelector('.avatar-dropdown-container');
                const menu = document.getElementById('avatarDropdownMenu');

                // Don't close if clicking inside the menu
                if (menu && menu.contains(e.target)) {
                    // Allow navigation links to work
                    if (e.target.tagName === 'A' || e.target.closest('a')) {
                        return; // Let link navigate
                    }
                    // Only close if clicking disconnect button
                    if (e.target.closest('button')?.textContent?.includes('Disconnect')) {
                        return; // Let disconnect handler close it
                    }
                    return; // Don't close for other menu items
                }

                // Close if clicking outside container
                if (container && !container.contains(e.target) && this.isOpen) {
                    this.close();
                }
            };

            document.addEventListener('click', this.closeHandler);
            document.addEventListener('touchstart', this.closeHandler, { passive: true });
        }

        /**
         * Toggle dropdown menu
         */
        toggle() {
            this.isOpen = !this.isOpen;
            const menu = document.getElementById('avatarDropdownMenu');
            const arrow = document.querySelector('.dropdown-arrow');

            if (menu) {
                menu.style.display = this.isOpen ? 'block' : 'none';
                document.body.style.overflow = '';
            }

            if (arrow) {
                arrow.style.transform = this.isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
            }
        }

        /**
         * Close dropdown menu
         */
        close() {
            this.isOpen = false;
            const menu = document.getElementById('avatarDropdownMenu');
            const arrow = document.querySelector('.dropdown-arrow');

            if (menu) {
                menu.style.display = 'none';
                document.body.style.overflow = '';
            }

            if (arrow) {
                arrow.style.transform = 'rotate(0deg)';
            }
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
            const fallback = walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : 'Wallet Connected';
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
            return this.sync(walletAddress, { force: true });
        }

        renderInitializingState() {
            const container = this.getNavContainer();
            if (!container) return false;
            if (container.dataset.avatarRenderKey === 'initializing') return true;

            container.dataset.avatarRenderKey = 'initializing';
            container.innerHTML = `
                <div
                    class="wallet-initializing-state"
                    role="status"
                    aria-live="polite"
                    style="display:flex;align-items:center;min-height:48px;padding:0 0.75rem;opacity:0.7;"
                >
                    <span class="text-sm">Initializing...</span>
                </div>
            `;
            return true;
        }

        /**
         * Render connect button when wallet not connected
         */
        renderConnectButton(options = {}) {
            let container = this.getNavContainer();

            if (!container) return false;
            if (options.renderKey) container.dataset.avatarRenderKey = options.renderKey;

            const currentPath = window.location.pathname;
            const isIndexPage = currentPath.endsWith('index.html') || currentPath === '/' || currentPath.endsWith('/');
            const isGalleryPage = currentPath.includes('gallery.html');
            const isUploadPage = currentPath.includes('upload.html');
            const isDocsPage = currentPath.includes('docs.html');
            const isProfilePage = currentPath.includes('profile.html');
            const guestAvatarFallback = this.getDefaultAvatar();

            container.innerHTML = `
                <div class="avatar-dropdown-container" style="position: relative;">
                    <button
                        class="avatar-button"
                        onclick="window.AvatarDropdown.toggle()"
                        style="
                            display: flex;
                            align-items: center;
                            gap: 0.75rem;
                            padding: 0.5rem 0.75rem;
                            border-radius: 9999px;
                            cursor: pointer;
                            transition: all 0.3s;
                            border: 2px solid transparent;
                            background: transparent;
                            color: inherit;
                        "
                    >
                        <img
                            src="/default-avatar.png"
                            alt="ArtSoul"
                            onerror="this.onerror=null;this.src='${guestAvatarFallback}'"
                            style="width: 40px; height: 40px; border-radius: 9999px; object-fit: cover; flex-shrink: 0;"
                        />
                        <div class="avatar-info" style="text-align: left;">
                            <div style="font-weight: 600; font-size: 0.875rem;">ArtSoul Guest</div>
                        </div>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="transition: transform 0.3s; flex-shrink: 0;" class="dropdown-arrow">
                            <path d="M4 6l4 4 4-4"/>
                        </svg>
                    </button>

                    <div
                        id="avatarDropdownMenu"
                        class="avatar-dropdown-menu"
                        style="
                            display: none;
                            position: absolute;
                            top: calc(100% + 0.5rem);
                            right: 0;
                            min-width: 220px;
                            border-radius: 0.75rem;
                            padding: 0.5rem;
                            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
                            z-index: 10002;
                        "
                    >
                        <div style="padding: 0.5rem; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                            <div class="avatar-theme-label">Theme Mode</div>
                            <div class="theme-toggle avatar-theme-switch" style="width: 100%;">
                                <button onclick="window.setTheme('classic')" id="classicBtnDropdown" class="theme-btn" style="flex: 1;">Classic</button>
                                <button onclick="window.setTheme('future')" id="futureBtnDropdown" class="theme-btn" style="flex: 1;">Future</button>
                            </div>
                        </div>

                        <div style="padding: 0.25rem 0;">
                            ${this.renderDropdownNavItems({ currentPath, isOwnProfile: isProfilePage })}

                            <div style="border-top: 1px solid rgba(255, 255, 255, 0.1); margin: 0.25rem 0;"></div>

                            <button onclick="safeConnectWallet()" id="connectBtn" class="dropdown-item btn-main" style="display:flex;align-items:center;justify-content:center;gap:0.75rem;padding:0.75rem;border-radius:0.5rem;cursor:pointer;width:100%;text-align:center;">
                                <span>Connect Wallet</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;

            this.applyThemeStyles();

            if (this.closeHandler) {
                document.removeEventListener('click', this.closeHandler);
                document.removeEventListener('touchstart', this.closeHandler);
            }

            this.closeHandler = (e) => {
                const containerEl = document.querySelector('.avatar-dropdown-container');
                if (containerEl && !containerEl.contains(e.target) && this.isOpen) {
                    this.close();
                }
            };

            document.addEventListener('click', this.closeHandler);
            document.addEventListener('touchstart', this.closeHandler, { passive: true });
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
            const isIndexPage = currentPath.endsWith('index.html') || currentPath === '/' || currentPath.endsWith('/');
            const isProfilePage = currentPath.includes('profile.html');
            const isGalleryPage = currentPath.includes('gallery.html');
            const isUploadPage = currentPath.includes('upload.html');
            const isDocsPage = currentPath.includes('docs.html');
            const urlParams = new URLSearchParams(window.location.search);
            const viewingAddress = urlParams.get('address');
            const currentWallet = walletAddress?.toLowerCase();
            const isOwnProfile = isProfilePage && (!viewingAddress || viewingAddress.toLowerCase() === currentWallet);

            const avatarUrl = this.getDefaultAvatar();
            const shortAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;

            // Get current network info with balance
            const networkInfo = await this.getCurrentNetworkInfo();

            // Create avatar dropdown HTML (same as render() but without profile)
            navButtons.innerHTML = `
                <div class="avatar-dropdown-container" style="position: relative;">
                    <!-- Avatar Button -->
                    <button
                        class="avatar-button"
                        onclick="window.AvatarDropdown.toggle()"
                        style="
                            display: flex;
                            align-items: center;
                            gap: 0.75rem;
                            padding: 0.5rem;
                            border-radius: 9999px;
                            cursor: pointer;
                            transition: all 0.3s;
                            border: 2px solid transparent;
                        "
                    >
                        <!-- Avatar -->
                        <img
                            src="${avatarUrl}"
                            alt="Wallet"
                            style="
                                width: 40px;
                                height: 40px;
                                border-radius: 9999px;
                                object-fit: cover;
                                flex-shrink: 0;
                            "
                        />

                        <!-- Address (hidden on mobile) -->
                        <div class="avatar-info" style="text-align: left;">
                            <div style="font-weight: 600; font-size: 0.875rem;">Wallet Connected</div>
                            <div style="font-size: 0.75rem; opacity: 0.6; font-family: monospace;">${shortAddress}</div>
                        </div>

                        <!-- Dropdown Arrow -->
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            style="transition: transform 0.3s; flex-shrink: 0;"
                            class="dropdown-arrow"
                        >
                            <path d="M4 6l4 4 4-4"/>
                        </svg>
                    </button>

                    <div
                        id="avatarDropdownMenu"
                        class="avatar-dropdown-menu"
                        style="
                            display: none;
                            position: absolute;
                            top: calc(100% + 0.5rem);
                            right: 0;
                            min-width: 220px;
                            border-radius: 0.75rem;
                            padding: 0.5rem;
                            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
                            z-index: 10002;
                        "
                    >
                        <!-- Theme Switcher -->
                        <div style="padding: 0.5rem; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                            <div class="avatar-theme-label">Theme Mode</div>
                            <div class="theme-toggle avatar-theme-switch" style="width: 100%;">
                                <button onclick="window.setTheme('classic')" id="classicBtnDropdown" class="theme-btn" style="flex: 1;">Classic</button>
                                <button onclick="window.setTheme('future')" id="futureBtnDropdown" class="theme-btn" style="flex: 1;">Future</button>
                            </div>
                        </div>

                        <!-- Network Switcher -->
                        <button
                            onclick="window.openArtSoulNetworkSelector?.()"
                            class="dropdown-item network-switcher-btn"
                            style="
                                display: flex;
                                align-items: center;
                                gap: 0.75rem;
                                padding: 0.75rem;
                                border-radius: 0.5rem;
                                cursor: pointer;
                                transition: all 0.2s;
                                width: 100%;
                                border: none;
                                background: transparent;
                                color: inherit;
                                text-align: left;
                            "
                        >
                            <img src="${networkInfo.icon}" alt="${networkInfo.name}" style="width: 20px; height: 20px; border-radius: 50%;" onerror="this.style.display='none'" />
                            <div style="flex: 1;">
                                <div><span data-network-name>${networkInfo.name}</span></div>
                                <div data-network-balance style="font-size: 0.75rem; opacity: 0.7; font-family: monospace;">${networkInfo.balance} ${networkInfo.currency}</div>
                            </div>
                        </button>

                        <div style="border-top: 1px solid rgba(255, 255, 255, 0.1); margin: 0.25rem 0;"></div>

                        <!-- Menu Items -->
                        <div style="padding: 0.25rem 0;">
                            ${this.renderDropdownNavItems({ currentPath, isOwnProfile })}

                            <div style="border-top: 1px solid rgba(255, 255, 255, 0.1); margin: 0.25rem 0;"></div>

                            <button
                                onclick="window.resetWalletConnection()"
                                class="dropdown-item"
                                style="
                                    display: flex;
                                    align-items: center;
                                    gap: 0.75rem;
                                    padding: 0.75rem;
                                    border-radius: 0.5rem;
                                    cursor: pointer;
                                    transition: all 0.2s;
                                    width: 100%;
                                    border: none;
                                    background: transparent;
                                    color: inherit;
                                    text-align: left;
                                "
                            >
                                <span>Disconnect</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;

            // Apply theme-specific styles
            this.applyThemeStyles();
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
                force: true,
                confirmed: true
            });
            return;
        }

        if (detail.isConnected === false) {
            window.AvatarDropdown.sync(null, {
                chainId: detail.chainId,
                force: true,
                confirmed: false
            });
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => syncCurrentMenu());
    } else {
        syncCurrentMenu();
    }

    window.addEventListener('artsoul:nav-ready', () => syncCurrentMenu({ force: true }));

    const navObserver = new MutationObserver(() => {
        const container = window.AvatarDropdown.getNavContainer();
        if (container && !container.querySelector('.avatar-button')) {
            syncCurrentMenu({ force: true });
        }
    });

    const startNavObserver = () => {
        if (document.body) {
            navObserver.observe(document.body, { childList: true, subtree: true });
        }
    };

    if (document.body) {
        startNavObserver();
    } else {
        document.addEventListener('DOMContentLoaded', startNavObserver, { once: true });
    }

    // Add mobile-responsive CSS
    const style = document.createElement('style');
    style.textContent = `
        /* Hide username/address text on mobile, show only avatar and arrow */
        @media (max-width: 640px) {
            .avatar-info {
                display: none !important;
            }
            .avatar-button {
                gap: 0.5rem !important;
            }
        }
        .avatar-dropdown-menu {
            overflow: visible !important;
            max-height: none !important;
        }
        .avatar-theme-switch {
            position: relative;
            display: flex;
            gap: 0 !important;
            padding: 0.25rem !important;
            border-radius: 9999px !important;
            overflow: hidden;
            border: 1px solid currentColor;
        }
        .avatar-theme-label {
            display: block;
            width: 100%;
            text-align: center;
            margin-bottom: 0.55rem;
            font-size: 0.75rem;
            font-weight: 600;
            letter-spacing: 0;
            opacity: 0.78;
        }
        .avatar-theme-switch .theme-btn {
            position: relative;
            z-index: 1;
            flex: 1;
            border-radius: 9999px !important;
            padding: 0.45rem 0.85rem !important;
            border: 0 !important;
        }
        .classic .avatar-theme-switch {
            color: var(--c-text);
            background: var(--c-surface);
            border-color: var(--c-border);
            box-shadow: none;
        }
        .classic .avatar-theme-label {
            color: var(--c-text);
            text-shadow: none;
        }
        .future .avatar-theme-switch {
            color: var(--c-accent);
            background: linear-gradient(90deg, rgba(var(--c-accent-rgb), 0.09), rgba(var(--c-accent-2-rgb), 0.13));
            border-color: var(--c-border-soft);
            box-shadow: inset 0 0 18px rgba(var(--c-accent-rgb), 0.12), 0 0 18px rgba(var(--c-accent-2-rgb), 0.16);
        }
        .future .avatar-theme-label {
            color: var(--c-accent);
            text-shadow: 0 0 8px rgba(var(--c-accent-rgb), 0.45);
        }
    `;
    document.head.appendChild(style);

    console.log('📦 Avatar Dropdown module loaded');
})();
