import '../../supabase-client.js';
import '../../supabase-auth.js';
import './react-runtime.js';

let morphActive = false;
        let originalPositions = [];

        // Theme is now handled by ThemeManager

        function viewArt(id) {
            if (morphActive) return;
            alert(`Opening artwork #${id}.`);
        }

        function showSuccessWave() {
            const wave = document.createElement('div');
            wave.className = 'success-wave';
            document.body.appendChild(wave);
            setTimeout(() => wave.remove(), 1000);
        }

        function morphToAnagram() {
            // Only work in Future mode
            if (!document.body.classList.contains('future')) return;
            if (morphActive) return;
            morphActive = true;

            const cards = document.querySelectorAll('.card');
            const backdrop = document.getElementById('morphBackdrop');

            // Pause sliding animation
            cards.forEach(card => {
                card.style.animation = 'none';
            });

            backdrop.classList.add('active');

            // Save original positions
            originalPositions = [];
            cards.forEach(card => {
                const rect = card.getBoundingClientRect();
                originalPositions.push({
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height
                });
            });

            // Calculate center positions for ARTSOL
            const cardWidth = 150;
            const cardHeight = 150;
            const gap = 20;
            const totalWidth = (cardWidth * 6) + (gap * 5);
            const startX = (window.innerWidth - totalWidth) / 2;
            const centerY = (window.innerHeight - cardHeight) / 2;

            cards.forEach((card, index) => {
                card.classList.add('card-morph');
                const targetX = startX + (index * (cardWidth + gap));

                card.style.width = cardWidth + 'px';
                card.style.height = cardHeight + 'px';
                card.style.left = targetX + 'px';
                card.style.top = centerY + 'px';
            });
        }

        function resetMorph() {
            if (!morphActive) return;
            morphActive = false;

            const cards = document.querySelectorAll('.card');
            const backdrop = document.getElementById('morphBackdrop');

            backdrop.classList.remove('active');

            cards.forEach((card, index) => {
                const original = originalPositions[index];

                card.style.width = original.width + 'px';
                card.style.height = original.height + 'px';
                card.style.left = original.left + 'px';
                card.style.top = original.top + 'px';

                setTimeout(() => {
                    card.classList.remove('card-morph');
                    card.style.width = '';
                    card.style.height = '';
                    card.style.left = '';
                    card.style.top = '';
                    card.style.animation = ''; // Restore sliding animation
                }, 800);
            });
        }

        // Theme is now handled by ThemeManager - removed duplicate initialization

        // Profile Section Functions
        let selectedArtworkFile = null;
        let selectedAvatarFile = null;

        function showSection(section) {
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            if (section === 'home') {
                document.getElementById('homeSection').classList.add('active');
            } else if (section === 'profile') {
                document.getElementById('profileSection').classList.add('active');
                loadProfileData();
            }
        }

        function switchProfileTab(tab) {
            document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.profile-tab-content').forEach(c => c.style.display = 'none');

            if (tab === 'edit') {
                document.querySelector('.profile-tab:nth-child(1)').classList.add('active');
                document.getElementById('editTab').style.display = 'block';
            } else if (tab === 'myworks') {
                document.querySelector('.profile-tab:nth-child(2)').classList.add('active');
                document.getElementById('myworksTab').style.display = 'block';
                loadMyArtworks();
            } else if (tab === 'allworks') {
                document.querySelector('.profile-tab:nth-child(3)').classList.add('active');
                document.getElementById('allworksTab').style.display = 'block';
                loadAllArtworks();
            }
        }

        async function loadProfileData() {
            const walletAddress = window.getCurrentWalletAddress?.();
            if (!walletAddress) return;

            try {
                const profile = await window.ArtSoulDB.getProfile(walletAddress);
                if (profile) {
                    document.getElementById('profileUsername').value = profile.username || '';
                    document.getElementById('profileBio').value = profile.bio || '';
                    document.getElementById('profileTwitter').value = profile.twitter_handle || '';
                    document.getElementById('profileDiscord').value = profile.discord_username || '';
                    if (profile.avatar_url) {
                        document.getElementById('avatarPreview').src = profile.avatar_url;
                    }
                }
            } catch (error) {
                console.error('Error loading profile:', error);
            }
        }

        async function handleAvatarUpload(event) {
            const file = event.target.files[0];
            if (!file) return;

            selectedAvatarFile = file;
            const reader = new FileReader();
            reader.onload = (e) => {
                document.getElementById('avatarPreview').src = e.target.result;
            };
            reader.readAsDataURL(file);
        }

        async function saveProfile() {
            const walletAddress = window.getCurrentWalletAddress?.();
            if (!walletAddress) {
                alert('Please connect your wallet first');
                return;
            }

            // Ensure user is authenticated before saving
            const isAuthenticated = await window.ensureAuthenticated();
            if (!isAuthenticated) {
                return;
            }

            try {
                let avatarUrl = document.getElementById('avatarPreview').src;

                if (selectedAvatarFile) {
                    const fileName = `avatar_${walletAddress}_${Date.now()}.${selectedAvatarFile.name.split('.').pop()}`;
                    avatarUrl = await window.ArtSoulDB.uploadFile(selectedAvatarFile, fileName);
                }

                const profileData = {
                    username: document.getElementById('profileUsername').value,
                    bio: document.getElementById('profileBio').value,
                    twitter_handle: document.getElementById('profileTwitter').value,
                    discord_username: document.getElementById('profileDiscord').value,
                    avatar_url: avatarUrl
                };

                await window.ArtSoulDB.updateProfile(walletAddress, profileData);
                alert('Profile saved successfully!');
            } catch (error) {
                console.error('Error saving profile:', error);
                alert('Error saving profile: ' + error.message);
            }
        }

        function handleArtworkSelect(event) {
            const file = event.target.files[0];
            if (!file) return;

            selectedArtworkFile = file;
            const modal = document.getElementById('uploadModal');
            modal.style.display = 'flex';
        }

        function closeUploadModal() {
            const modal = document.getElementById('uploadModal');
            modal.style.display = 'none';
            selectedArtworkFile = null;
            document.getElementById('artworkTitle').value = '';
            document.getElementById('artworkDescription').value = '';
            document.getElementById('artworkPrice').value = '';
        }

        async function uploadArtwork() {
            const walletAddress = window.getCurrentWalletAddress?.();
            if (!walletAddress || !selectedArtworkFile) return;

            alert('Homepage quick upload is disabled for public testnet. Please use the Publish Artwork page so on-chain registration stays canonical.');
            window.location.href = 'upload.html';
            return;

            const title = document.getElementById('artworkTitle').value;
            const description = document.getElementById('artworkDescription').value;
            const price = document.getElementById('artworkPrice').value;

            if (!title || !price) {
                alert('Please fill in title and price');
                return;
            }

            try {
                const profile = await window.ArtSoulDB.getProfile(walletAddress);
                if (!profile) {
                    alert('Profile not found');
                    return;
                }

                const fileName = `artwork_${walletAddress}_${Date.now()}.${selectedArtworkFile.name.split('.').pop()}`;
                const fileUrl = await window.ArtSoulDB.uploadFile(selectedArtworkFile, fileName);

                const fileType = selectedArtworkFile.type.startsWith('image/') ? 'image' :
                                selectedArtworkFile.type.startsWith('video/') ? 'video' :
                                selectedArtworkFile.type.startsWith('audio/') ? 'music' : 'gif';

                const artwork = await window.ArtSoulDB.createArtwork({
                    title,
                    description,
                    file_url: fileUrl,
                    file_type: fileType,
                    creator_id: profile.id,
                    creator_estimated_value: parseFloat(price)
                });

                await window.ArtSoulDB.createAuction(artwork.id);

                closeUploadModal();
                alert('Artwork published successfully!');
                loadMyArtworks();
            } catch (error) {
                console.error('Error uploading artwork:', error);
                alert('Error uploading artwork: ' + error.message);
            }
        }

        async function loadMyArtworks() {
            const walletAddress = window.getCurrentWalletAddress?.();
            if (!walletAddress) return;

            try {
                const profile = await window.ArtSoulDB.getProfile(walletAddress);
                if (!profile) return;

                const artworks = filterPublicDisplayArtworks(await window.ArtSoulDB.getArtworksByCreator(profile.id));
                renderArtworks(artworks, 'myArtworksGrid');
            } catch (error) {
                console.error('Error loading artworks:', error);
            }
        }

        async function loadAllArtworks() {
            try {
                const artworks = filterPublicDisplayArtworks(await window.ArtSoulDB.getArtworks());
                renderArtworks(artworks, 'allArtworksGrid');
            } catch (error) {
                console.error('Error loading all artworks:', error);
            }
        }

        function filterPublicDisplayArtworks(artworks) {
            if (window.ArtSoulDiscovery?.filterPublicTestnetArtworks) {
                return window.ArtSoulDiscovery.filterPublicTestnetArtworks(artworks);
            }
            return Array.isArray(artworks) ? artworks : [];
        }

        function renderArtworks(artworks, containerId) {
            const container = document.getElementById(containerId);
            if (!artworks || artworks.length === 0) {
                container.textContent = 'No artworks published yet';
                container.className = 'text-center opacity-50';
                return;
            }

            // Clear container safely
            container.innerHTML = '';

            // Create elements safely without innerHTML
            artworks.forEach(art => {
                const hasSafeMedia = window.ArtSoulSecurity?.isValidStorageUrl(art.file_url);

                // Validate URL for legacy rows. V4.1 rows may intentionally render a protocol placeholder.
                if (!hasSafeMedia && art.source !== 'v41_projection') {
                    console.warn('Invalid artwork URL:', art.id);
                    return;
                }

                const card = document.createElement('div');
                card.className = 'artwork-card';
                card.onclick = () => viewArtwork(art.id);

                // Image container with media type detection
                const imgContainer = document.createElement('div');
                imgContainer.style.cssText = 'position: relative; width: 100%; aspect-ratio: 1;';

                const fileType = art.file_type?.toLowerCase() || '';

                // Fallback: detect file type from URL if file_type is not set
                let detectedType = fileType;
                if (!detectedType && art.file_url) {
                    const url = art.file_url.toLowerCase();
                    if (url.includes('.mp4') || url.includes('.webm') || url.includes('.mov') || url.includes('.ogg')) {
                        detectedType = 'video';
                    } else if (url.includes('.mp3') || url.includes('.wav') || url.includes('.ogg')) {
                        detectedType = 'music';
                    }
                }

                const isVideo = detectedType === 'video' || ['mp4', 'webm', 'mov', 'ogg'].includes(detectedType);
                const isAudio = detectedType === 'audio' || detectedType === 'music' || ['mp3', 'wav', 'ogg', 'aac', 'm4a'].includes(detectedType) ||
                               (!detectedType && art.file_url && (art.file_url.toLowerCase().includes('.mp3') || art.file_url.toLowerCase().includes('.wav') || art.file_url.toLowerCase().includes('.ogg') || art.file_url.toLowerCase().includes('.aac')));

                const sharedMedia = hasSafeMedia
                    ? window.ArtSoulArtworkCard?.createMediaElement?.(art, () => card.remove())
                    : null;

                if (sharedMedia) {
                    imgContainer.appendChild(sharedMedia);
                } else if (isVideo && hasSafeMedia) {
                    const video = document.createElement('video');
                    video.src = art.file_url;
                    video.className = 'artwork-image';
                    video.setAttribute('preload', 'metadata');
                    video.setAttribute('playsinline', '');
                    video.muted = true;
                    video.style.cssText = 'pointer-events: none;';

                    // Add error handler for video
                    video.onerror = () => {
                        console.warn('Video failed to load:', art.file_url);
                    };

                    imgContainer.appendChild(video);
                } else if (isAudio && hasSafeMedia) {
                    const audioPreview = document.createElement('div');
                    audioPreview.style.cssText = 'width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: linear-gradient(135deg, rgba(147, 51, 234, 0.3), rgba(6, 182, 212, 0.3)); position: relative;';

                    const logoImg = document.createElement('img');
                    logoImg.src = 'ARTSOULlogo.png';
                    logoImg.alt = 'Music';
                    logoImg.style.cssText = 'width: 50%; height: 50%; object-fit: contain; animation: spin 3s linear infinite; animation-play-state: paused; margin-bottom: 1rem;';

                    // Add error handler for logo
                    logoImg.onerror = () => {
                        console.warn('Logo failed to load');
                        logoImg.style.display = 'none';
                    };

                    audioPreview.appendChild(logoImg);

                    const audioPlayer = document.createElement('audio');
                    audioPlayer.src = art.file_url;
                    audioPlayer.controls = true;
                    audioPlayer.crossOrigin = 'anonymous';
                    audioPlayer.style.cssText = 'width: 90%; max-width: 300px; position: relative; z-index: 10;';

                    // Prevent card click when interacting with audio controls
                    audioPlayer.addEventListener('click', (e) => e.stopPropagation());
                    audioPlayer.addEventListener('touchstart', (e) => e.stopPropagation());

                    // Control logo spin with play state
                    audioPlayer.onplay = () => {
                        logoImg.style.animationPlayState = 'running';
                    };
                    audioPlayer.onpause = () => {
                        logoImg.style.animationPlayState = 'paused';
                    };
                    audioPlayer.onended = () => {
                        logoImg.style.animationPlayState = 'paused';
                    };

                    // Add error handler for audio
                    audioPlayer.onerror = () => {
                        console.warn('Audio failed to load:', art.file_url);
                    };

                    audioPreview.appendChild(audioPlayer);

                    imgContainer.appendChild(audioPreview);
                } else if (hasSafeMedia) {
                    const img = document.createElement('img');
                    img.src = art.file_url;
                    img.alt = window.ArtSoulSecurity?.sanitizeText(art.title) || 'Artwork';
                    img.className = 'artwork-image';
                    imgContainer.appendChild(img);
                } else {
                    const placeholder = document.createElement('div');
                    placeholder.style.cssText = 'width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: var(--c-bg);';
                    const text = document.createElement('p');
                    text.className = 'text-2xl font-light opacity-30';
                    text.textContent = 'Protocol Artwork';
                    placeholder.appendChild(text);
                    imgContainer.appendChild(placeholder);
                }

                const info = document.createElement('div');
                info.className = 'artwork-info';

                const title = document.createElement('h4');
                title.className = 'font-medium mb-1';
                title.textContent = art.title;

                const desc = document.createElement('p');
                desc.className = 'text-sm opacity-70 mb-2';
                desc.textContent = art.description || '';

                const price = document.createElement('p');
                price.className = 'text-sm font-medium';
                price.textContent = `${art.creator_estimated_value} ETH`;

                // Vote count
                const voteCount = document.createElement('p');
                voteCount.className = 'text-xs opacity-60 mt-1';
                voteCount.textContent = `${art.vote_count || 0} votes`;

                info.appendChild(title);
                info.appendChild(desc);
                info.appendChild(price);
                info.appendChild(voteCount);
                card.appendChild(imgContainer);
                card.appendChild(info);
                container.appendChild(card);
            });
        }

        function viewArtwork(id) {
            window.location.href = `artwork.html?id=${id}`;
        }

        function normalizeProtocolArtworkId(value) {
            const text = String(value || '').trim();
            if (!text || text === '0' || text.toLowerCase() === 'none') return '';
            return /^\d+$/.test(text) ? text : '';
        }

        function resolvePendingArtworkChainId(art = {}) {
            const rawChainId = art.chain_id || art.chainId || art.network_chain_id;
            const parsed = Number(rawChainId);
            if (parsed === 84532 || parsed === 11155111) {
                return parsed;
            }

            const network = String(art.network || art.chain || art.chain_name || '').toLowerCase();
            if (network.includes('base')) return 84532;
            if (network.includes('sepolia')) return 11155111;
            return 84532;
        }

        function canonicalV41IdForPendingArtwork(art = {}) {
            const artworkId = normalizeProtocolArtworkId(art.artwork_id);
            const chainId = resolvePendingArtworkChainId(art);
            return art.register_tx_hash && chainId && artworkId ? `v41:${chainId}:${artworkId}` : '';
        }

        function artworkIdentityKeys(art = {}) {
            const keys = new Set();
            const add = (value) => {
                const text = String(value || '').trim();
                if (text) keys.add(text.toLowerCase());
            };

            add(art.register_tx_hash);
            add(art.transaction_hash);
            add(art.canonical_v41_id);
            if (String(art.id || '').startsWith('v41:')) {
                add(art.id);
            }

            const chainId = resolvePendingArtworkChainId(art);
            const artworkId = normalizeProtocolArtworkId(art.artwork_id || art.blockchain_id);
            if (chainId && artworkId) {
                add(`v41:${chainId}:${artworkId}`);
                add(`${chainId}:${artworkId}`);
            }

            return keys;
        }

        function hasAnyArtworkIdentity(art, indexedKeys) {
            return [...artworkIdentityKeys(art)].some(key => indexedKeys.has(key));
        }

        function hasConfirmedRegisterTx(art) {
            return Boolean(String(art?.register_tx_hash || '').trim());
        }

        function isBadPendingArtwork(art = {}) {
            if (hasConfirmedRegisterTx(art)) return false;
            const state = [
                art.status,
                art.stage,
                art.error_code,
                art.error_message
            ].join(' ').toLowerCase();
            return !hasConfirmedRegisterTx(art) ||
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
                const kept = list.filter(art => !isBadPendingArtwork(art));
                localStorage.setItem(key, JSON.stringify(kept));
                const result = { removed: list.length - kept.length, kept: kept.length };
                console.info('ArtSoul pending-card cleanup complete:', result);
                return result;
            } catch (error) {
                console.warn('ArtSoul pending-card cleanup failed:', error);
                return { removed: 0, kept: 0, error: error.message };
            }
        };

        function hasRenderableArtworkMedia(art) {
            return Boolean(
                art &&
                art.id &&
                art.title &&
                window.ArtSoulArtworkCard?.hasSafeMedia?.(art)
            );
        }

        function readPendingIndexerArtworks() {
            try {
                const parsed = JSON.parse(localStorage.getItem('artsoul_pending_indexer_artworks') || '[]');
                if (!Array.isArray(parsed)) return [];
                return parsed
                    .filter(art => art?.status === 'pending_indexer')
                    .filter(hasConfirmedRegisterTx)
                    .filter(art => Boolean(art.auction_tx_hash))
                    .filter(hasRenderableArtworkMedia)
                    .map(art => {
                        const canonicalV41Id = canonicalV41IdForPendingArtwork(art);
                        const mediaUrl = art.file_url || art.media_url || '';
                        const missingIndexedMedia = Boolean(canonicalV41Id && !mediaUrl);
                        const auctionConfirmed = Boolean(art.auction_tx_hash);

                        return {
                            ...art,
                            id: canonicalV41Id || art.id || `pending:${art.temp_id}`,
                            pending_id: art.id || `pending:${art.temp_id}`,
                            canonical_v41_id: canonicalV41Id,
                            source: 'pending_indexer',
                            status: canonicalV41Id ? 'indexed_missing_metadata' : 'pending_indexer',
                            lifecycle_label: missingIndexedMedia ? 'Metadata unavailable' : 'Finalizing...',
                            lifecycle_message: missingIndexedMedia
                                ? 'This artwork is on-chain, but its media is unavailable.'
                                : auctionConfirmed
                                ? 'Registration and auction are confirmed. Public display will update shortly.'
                                : 'Submitted on-chain. Public display will update shortly.',
                            discovery_lifecycle: {
                                key: canonicalV41Id ? 'indexed_missing_metadata' : 'pending_indexer',
                                label: missingIndexedMedia ? 'Metadata unavailable' : 'Finalizing...',
                                isLiveAuction: Boolean(art.auction_tx_hash),
                                isMarketplace: false,
                                isCollection: false
                            }
                        };
                    });
            } catch {
                return [];
            }
        }

        function showMediaUnavailable(container, message = 'Media unavailable') {
            if (!container) return;
            container.innerHTML = '';
            container.className = `${container.className || ''} flex items-center justify-center bg-black`.trim();
            const text = document.createElement('p');
            text.className = 'text-lg font-light opacity-40 text-center px-4';
            text.textContent = message;
            container.appendChild(text);
        }

        function showAwaitingLiveTestnetArtworks(container) {
            if (!container) return;
            container.innerHTML = '';
            container.className = 'text-center py-20';
            container.setAttribute('aria-busy', 'false');

            const title = document.createElement('div');
            title.className = 'text-xl opacity-50';
            title.textContent = 'Awaiting live testnet artworks';

            const detail = document.createElement('div');
            detail.className = 'text-sm opacity-30 mt-2';
            detail.textContent = 'Media-backed protocol artworks will appear here after creators publish them.';

            container.appendChild(title);
            container.appendChild(detail);
        }

        // Load artworks on page load
        async function loadHomeArtworks() {
            const gallery = document.getElementById('artworkGallery');
            if (!gallery) return;

            try {
                const db = window.ArtSoulDB;
                if (typeof db?.getPublicProjectionArtworks !== 'function') {
                    throw new Error('ArtSoulDB is not ready');
                }

                let artworks = await db.getPublicProjectionArtworks({ limit: 100 });
                const suppressedArtworkIds = new Set(
                    (artworks?.suppressed_artwork_ids || []).map(value => String(value).toLowerCase())
                );
                const indexedKeys = new Set();
                (artworks || []).forEach(art => {
                    artworkIdentityKeys(art).forEach(key => indexedKeys.add(key));
                });
                const pendingArtworks = readPendingIndexerArtworks()
                    .filter(art => !hasAnyArtworkIdentity(art, indexedKeys))
                    .filter(art => ![...artworkIdentityKeys(art)].some(key => suppressedArtworkIds.has(key)))
                    .filter(art => !window.ArtSoulArtworkCard?.isHidden?.(art));
                artworks = [...pendingArtworks, ...(artworks || [])]
                    .filter(art => art?.source === 'v41_projection' || art?.source === 'pending_indexer')
                    .filter(art => !window.ArtSoulArtworkCard?.isHidden?.(art));

                // Homepage = top works by Discovery Rank (canon). Render ONLY real
                // works that have data — no curated "Awaiting…" placeholder slots.
                const spotlight = window.ArtSoulDiscovery?.buildHomepageSpotlights(artworks, 12);
                const rankedWorks = (spotlight?.ranked && spotlight.ranked.length
                    ? spotlight.ranked
                    : artworks.filter(hasRenderableArtworkMedia)
                ).slice(0, 12);
                const slots = rankedWorks.map(artwork => ({
                    label: 'Discovery Spotlight',
                    reason: window.ArtSoulDiscovery?.classifyLifecycle?.(artwork)?.label || 'Community signal',
                    artwork
                }));

                gallery.innerHTML = '';
                gallery.setAttribute('aria-busy', 'false');

                if (slots.length === 0) {
                    showAwaitingLiveTestnetArtworks(gallery);
                    return;
                }

                for (const slot of slots) {
                        const art = slot.artwork;
                        if (window.ArtSoulArtworkCard?.createCardElement) {
                            const sharedCard = window.ArtSoulArtworkCard.createCardElement(art, {
                                minimal: true,
                                surface: 'homepage'
                            });
                            if (sharedCard) gallery.appendChild(sharedCard);
                            continue;
                        }
                        const socialSignals = window.ArtSoulDiscovery?.getSocialSignals?.(art) || {
                            likes: art.vote_count || 0,
                            wouldBuy: 0,
                            watching: 0
                        };
                        const mediaUrl = art.file_url || art.media_url || '';
                        const hasSafeMedia = Boolean(mediaUrl) && (
                            typeof window.ArtSoulSecurity?.isValidStorageUrl !== 'function' ||
                            window.ArtSoulSecurity.isValidStorageUrl(mediaUrl)
                        );

                        if (!hasSafeMedia && art.source !== 'v41_projection') {
                            console.warn('Invalid artwork URL:', art.id);
                            continue;
                        }

                        const canonicalV41Id = art.canonical_v41_id || canonicalV41IdForPendingArtwork(art);
                        const card = document.createElement(art.source === 'pending_indexer' && !canonicalV41Id ? 'div' : 'a');
                        if (art.source !== 'pending_indexer' || canonicalV41Id) {
                            card.href = `artwork.html?id=${canonicalV41Id || art.id}`;
                        }
                        card.className = 'card rounded-xl overflow-hidden';

                        const imageContainer = document.createElement('div');
                        imageContainer.className = 'aspect-square overflow-hidden bg-black relative';

                        if (mediaUrl && hasSafeMedia) {
                            const fileType = art.file_type?.toLowerCase() || '';

                            // Check if video
                            if (fileType === 'video' || ['mp4', 'webm', 'ogg', 'mov'].includes(fileType)) {
                                const video = document.createElement('video');
                                video.src = art.file_url;
                                video.className = 'w-full h-full object-contain';
                                video.controls = true;
                                video.preload = 'metadata';
                                video.onclick = (e) => e.stopPropagation();
                                video.onerror = () => {
                                    console.warn('Video failed to load:', art.file_url);
                                    showMediaUnavailable(imageContainer);
                                };
                                imageContainer.appendChild(video);
                            }
                            // Check if audio/music
                            else if (fileType === 'audio' || fileType === 'music' || ['mp3', 'wav', 'ogg', 'aac', 'm4a'].includes(fileType)) {
                                // Show spinning logo with audio player
                                const audioContainer = document.createElement('div');
                                audioContainer.className = 'w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-900 to-black';

                                const logoImg = document.createElement('img');
                                logoImg.src = 'ARTSOULlogo.png';
                                logoImg.alt = 'Music';
                                logoImg.style.cssText = 'width: 50%; height: 50%; object-fit: contain; animation: spin 8s linear infinite; margin-bottom: 1rem; transition: animation-duration 0.3s;';
                                logoImg.onerror = function() {
                                    console.warn('Failed to load logo for music preview');
                                    this.style.display = 'none';
                                };

                                const audio = document.createElement('audio');
                                audio.src = art.file_url;
                                audio.className = 'w-full px-4';
                                audio.controls = true;
                                audio.crossOrigin = 'anonymous';
                                audio.preload = 'metadata';
                                audio.onclick = (e) => e.stopPropagation();

                                // Make logo spin faster when playing
                                audio.onplay = () => {
                                    logoImg.style.animation = 'spin 2s linear infinite';
                                };
                                audio.onpause = () => {
                                    logoImg.style.animation = 'spin 8s linear infinite';
                                };
                                audio.onended = () => {
                                    logoImg.style.animation = 'spin 8s linear infinite';
                                };

                                audio.onerror = function() {
                                    console.error('Failed to load audio:', art.file_url);
                                    showMediaUnavailable(imageContainer);
                                };

                                audioContainer.appendChild(logoImg);
                                audioContainer.appendChild(audio);
                                imageContainer.appendChild(audioContainer);
                            }
                            // Default: image
                            else {
                                const img = document.createElement('img');
                                img.src = art.file_url;
                                img.alt = window.ArtSoulSecurity?.sanitizeText(art.title) || 'Artwork';
                                img.className = 'w-full h-full object-contain';
                                img.onerror = () => {
                                    console.warn('Image failed to load:', art.file_url);
                                    showMediaUnavailable(imageContainer);
                                };
                                imageContainer.appendChild(img);
                            }
                        } else {
                            const placeholder = document.createElement('div');
                            placeholder.className = 'w-full h-full flex items-center justify-center';
                            placeholder.style.background = 'var(--c-bg)';
                            const text = document.createElement('p');
                            text.className = 'text-2xl font-light opacity-30 text-center px-4';
                            text.textContent = 'Metadata unavailable';
                            placeholder.appendChild(text);
                            imageContainer.appendChild(placeholder);
                        }

                        const info = document.createElement('div');
                        info.className = 'p-4';

                        const presentationStatus = window.ArtSoulArtworkCard?.statusInfo?.(art);
                        const slotLabel = document.createElement('p');
                        slotLabel.className = 'text-xs uppercase tracking-wide opacity-60 mb-1';
                        slotLabel.textContent = presentationStatus?.label || 'Not yet minted';

                        const title = document.createElement('h3');
                        title.className = 'font-semibold text-lg mb-1 truncate';
                        title.textContent = art.title;

                        const desc = document.createElement('p');
                        desc.className = 'text-sm opacity-70 mb-2 line-clamp-2';
                        desc.textContent = art.description || '';

                        const price = document.createElement('p');
                        price.className = 'text-sm font-bold';
                        price.textContent = `${art.creator_value || '0'} ETH`;

                        const signalLine = document.createElement('p');
                        signalLine.className = 'text-xs opacity-60 mt-2 truncate';
                        if (art.source === 'pending_indexer') {
                            signalLine.textContent = 'Finalizing...';
                        } else {
                            const parts = [];
                            if (socialSignals.likes) parts.push(`${socialSignals.likes} ♥`);
                            if (socialSignals.wouldBuy) parts.push(`${socialSignals.wouldBuy} would buy`);
                            if (socialSignals.watching) parts.push(`${socialSignals.watching} watching`);
                            signalLine.textContent = parts.length ? parts.join('  ·  ') : '';
                        }

                        info.appendChild(slotLabel);
                        info.appendChild(title);
                        info.appendChild(desc);
                        info.appendChild(price);
                        info.appendChild(signalLine);
                        card.appendChild(imageContainer);
                        card.appendChild(info);
                        gallery.appendChild(card);
                }

            } catch (error) {
                console.error('Failed to load artworks:', error);
                showAwaitingLiveTestnetArtworks(gallery);
            }
        }

        // The entry is mounted after the homepage markup, so discovery can start
        // immediately without waiting for the independently deferred wallet module.
        loadHomeArtworks();

        window.showSection = showSection;

Object.assign(window, { showSection, switchProfileTab, handleAvatarUpload, saveProfile, handleArtworkSelect, uploadArtwork, closeUploadModal });
