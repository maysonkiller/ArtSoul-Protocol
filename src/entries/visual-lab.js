(function() {
            var theme = localStorage.getItem('artsoul_visual_lab_theme') || localStorage.getItem('artsoul_theme') || 'classic';
            document.documentElement.classList.remove('classic', 'future');
                document.documentElement.classList.add(theme === 'future' ? 'future' : 'classic');
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', function() {
                    document.body.classList.remove('classic', 'future');
                    document.body.classList.add(theme === 'future' ? 'future' : 'classic', 'visual-lab');
                });
            } else {
                document.body.classList.remove('classic', 'future');
                    document.body.classList.add(theme === 'future' ? 'future' : 'classic', 'visual-lab');
            }
        })();

(function() {
            var frame = document.getElementById('labFrame');
            var gallery = document.getElementById('artworkGallery');
            var avatarWrap = document.getElementById('labAvatarDropdown');
            var avatarButton = document.getElementById('labAvatarButton');
            var spotlightLabels = ['Featured Auction', 'Trending Artwork', 'Featured Collection', 'Marketplace Highlight'];
            var mockArtworks = [
                ['Nocturne Vault', '24h auction preview', '0.08 ETH'],
                ['Signal Bloom', 'Trust-weighted discovery', '2.4k views'],
                ['Glass Archive', 'Approved collection preview', '100 supply'],
                ['Afterimage 01', 'Minted resale preview', 'Floor 0.12 ETH'],
                ['Blue Hour Study', 'Ending soon mock state', '18m left'],
                ['Memory Frame', 'Settlement completed', 'Winner set'],
                ['Static Garden', 'Would-buy signal preview', '41 signals'],
                ['Quiet Circuit', 'Watching signal preview', '126 watching'],
                ['Silver Index', 'Floor growth preview', '+14%'],
                ['Mira V.', 'Trending creator preview', 'Established'],
                ['First Light', 'Unminted discovery', 'Published'],
                ['Soft Geometry', 'Guidance preview', 'High confidence']
            ];

            function renderSpotlights() {
                if (!gallery) return;
                gallery.innerHTML = '';

                mockArtworks.forEach(function(item, index) {
                    var label = spotlightLabels[index] || 'Discovery Spotlight';
                    var card = document.createElement('a');
                    card.href = '#';
                    card.className = 'card rounded-xl overflow-hidden lab-spotlight-card';

                    var imageContainer = document.createElement('div');
                    imageContainer.className = 'aspect-square overflow-hidden bg-black relative lab-artwork-preview';

                    var pattern = document.createElement('div');
                    pattern.className = 'lab-card-pattern';

                    var imageText = document.createElement('p');
                    imageText.className = 'text-2xl font-light opacity-30';
                    imageText.textContent = index < 4 ? label : 'Mock Artwork';
                    imageText.style.cssText = 'position:absolute;left:1rem;bottom:1rem;right:1rem;';

                    imageContainer.appendChild(pattern);
                    imageContainer.appendChild(imageText);

                    var info = document.createElement('div');
                    info.className = 'p-4 lab-card-copy';

                    var slotLabel = document.createElement('p');
                    slotLabel.className = 'text-xs uppercase tracking-wide opacity-60 mb-1';
                    slotLabel.textContent = label;

                    var title = document.createElement('h3');
                    title.className = 'font-semibold text-lg mb-1 truncate';
                    title.textContent = item[0];

                    var desc = document.createElement('p');
                    desc.className = 'text-sm opacity-70 mb-2 line-clamp-2';
                    desc.textContent = item[1];

                    var price = document.createElement('p');
                    price.className = 'text-sm font-bold';
                    price.textContent = item[2];

                    var signalLine = document.createElement('p');
                    signalLine.className = 'text-xs opacity-60 mt-2';
                    signalLine.textContent = 'Mock signals - no live data';

                    info.appendChild(slotLabel);
                    info.appendChild(title);
                    info.appendChild(desc);
                    info.appendChild(price);
                    info.appendChild(signalLine);
                    card.appendChild(imageContainer);
                    card.appendChild(info);
                    gallery.appendChild(card);
                });
            }

            function setTheme(theme) {
                var next = theme === 'future' ? 'future' : 'classic';
                document.documentElement.classList.remove('classic', 'future');
                document.documentElement.classList.add(next);
                document.body.classList.toggle('classic', next === 'classic');
                document.body.classList.toggle('future', next === 'future');
                document.body.classList.add('visual-lab');
                localStorage.setItem('artsoul_visual_lab_theme', next);
                document.querySelectorAll('[data-theme]').forEach(function(button) {
                    button.setAttribute('aria-pressed', String(button.dataset.theme === next));
                });
            }

            function setHeaderSize(size) {
                var compact = size === 'compact';
                if (frame) frame.classList.toggle('lab-header-compact', compact);
                document.querySelectorAll('[data-header-size]').forEach(function(button) {
                    button.setAttribute('aria-pressed', String(button.dataset.headerSize === (compact ? 'compact' : 'current')));
                });
            }

            function setBannerSize(size) {
                var compact = size === 'compact';
                if (frame) frame.classList.toggle('lab-banner-compact', compact);
                document.querySelectorAll('[data-banner-size]').forEach(function(button) {
                    button.setAttribute('aria-pressed', String(button.dataset.bannerSize === (compact ? 'compact' : 'normal')));
                });
            }

            function setLayout(layout) {
                var next = ['compact', 'premium'].includes(layout) ? layout : 'current';
                if (frame) {
                    frame.classList.remove('lab-layout-current', 'lab-layout-compact', 'lab-layout-premium');
                    frame.classList.add('lab-layout-' + next);
                }
                document.querySelectorAll('[data-layout]').forEach(function(button) {
                    button.setAttribute('aria-pressed', String(button.dataset.layout === next));
                });
            }

            document.querySelectorAll('[data-theme]').forEach(function(button) {
                button.addEventListener('click', function() {
                    setTheme(button.dataset.theme);
                });
            });

            document.querySelectorAll('[data-header-size]').forEach(function(button) {
                button.addEventListener('click', function() {
                    setHeaderSize(button.dataset.headerSize);
                });
            });

            document.querySelectorAll('[data-banner-size]').forEach(function(button) {
                button.addEventListener('click', function() {
                    setBannerSize(button.dataset.bannerSize);
                });
            });

            document.querySelectorAll('[data-layout]').forEach(function(button) {
                button.addEventListener('click', function() {
                    setLayout(button.dataset.layout);
                });
            });

            if (avatarButton && avatarWrap) {
                avatarButton.addEventListener('click', function(event) {
                    event.stopPropagation();
                    var isOpen = avatarWrap.classList.toggle('open');
                    avatarButton.setAttribute('aria-expanded', String(isOpen));
                });
            }

            document.addEventListener('click', function(event) {
                if (!avatarWrap || !avatarWrap.classList.contains('open')) return;
                if (avatarWrap.contains(event.target)) return;
                avatarWrap.classList.remove('open');
                if (avatarButton) avatarButton.setAttribute('aria-expanded', 'false');
            });

            renderSpotlights();
            setTheme(document.documentElement.classList.contains('future') ? 'future' : 'classic');
            setHeaderSize('current');
            setBannerSize('normal');
            setLayout('current');
        })();
