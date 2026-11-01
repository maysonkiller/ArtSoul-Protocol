// Discovery-driven Home showcase. Presentation only: it reuses the public Home
// response, existing artwork URL/media safety helpers and current ranking.
// Never invent a highlighted work or issue a database/network request here.
export function pickHomeShowcaseSlides(slots, {
    mediaDescriptor,
    isValidStorageUrl,
    artworkPath,
    isHidden = () => false,
    creatorLabel = () => ''
} = {}) {
    if (!Array.isArray(slots) ||
        typeof mediaDescriptor !== 'function' ||
        typeof isValidStorageUrl !== 'function' ||
        typeof artworkPath !== 'function') return [];

    const selected = [];
    const seen = new Set();
    for (const slot of slots) {
        const artwork = slot?.artwork;
        if (!artwork?.id || typeof artwork.title !== 'string' ||
            !artwork.title.trim() || isHidden(artwork)) continue;
        // A local pending item has no public artwork destination until indexed.
        if (artwork.source === 'pending_indexer' && !artwork.canonical_v41_id) continue;

        const id = String(artwork.canonical_v41_id || artwork.id);
        if (seen.has(id.toLowerCase())) continue;
        let media;
        try { media = mediaDescriptor(artwork); } catch { continue; }
        // Videos may use an existing static poster; never autoplay background
        // video or display an animated source in the static Classic theme.
        const image = media?.type === 'image'
            ? media.thumbnailUrl
            : media?.type === 'video' ? media.poster : '';
        if (typeof image !== 'string' || !isValidStorageUrl(image)) continue;

        let href;
        try { href = artworkPath(id); } catch { continue; }
        if (typeof href !== 'string' || !/^\/artwork(?:\/|\?)/.test(href)) continue;

        seen.add(id.toLowerCase());
        selected.push({
            href,
            image,
            title: artwork.title.trim(),
            creator: String(creatorLabel(artwork) || ''),
            label: String(slot?.label || 'Discovery Spotlight'),
            reason: String(slot?.reason || '')
        });
        if (selected.length === 4) break;
    }
    return selected;
}

let disposePrevious = () => {};

export function renderHomeShowcase(slots) {
    const root = document.getElementById('homeShowcase');
    const stage = document.getElementById('homeShowcaseStage');
    const intro = document.getElementById('homeShowcaseIntro');
    const controls = document.getElementById('homeShowcaseControls');
    const previous = document.getElementById('homeShowcasePrev');
    const next = document.getElementById('homeShowcaseNext');
    const count = document.getElementById('homeShowcaseCount');
    if (![root, stage, intro, controls, previous, next, count].every(Boolean)) return;

    disposePrevious();
    const slides = pickHomeShowcaseSlides(slots, {
        mediaDescriptor: window.ArtSoulArtworkCard?.mediaDescriptor,
        isValidStorageUrl: window.ArtSoulSecurity?.isValidStorageUrl,
        artworkPath: window.ArtSoulArtworkUrl?.artworkPath,
        isHidden: window.ArtSoulArtworkCard?.isHidden,
        creatorLabel: window.ArtSoulArtworkCard?.creatorLabel
    });

    let active = 0;
    let timer = null;
    const fallback = () => {
        root.dataset.state = 'empty';
        intro.hidden = false;
        stage.hidden = true;
        controls.hidden = true;
        count.textContent = '';
    };
    stage.replaceChildren();
    if (!slides.length) {
        fallback();
        return;
    }

    for (const item of slides) {
        const link = document.createElement('a');
        link.className = 'home-showcase-slide';
        link.href = item.href;
        link.hidden = true;
        link.tabIndex = -1;

        const picture = document.createElement('img');
        picture.className = 'home-showcase-media';
        picture.alt = item.title;
        picture.loading = 'lazy';
        picture.decoding = 'async';
        // Only the visible slide downloads a new image. The others get a URL
        // when first selected; Supabase thumbnails retain the existing bounds.
        picture.dataset.showcaseSrc = item.image;

        const caption = document.createElement('div');
        caption.className = 'home-showcase-caption';
        const label = document.createElement('span');
        label.className = 'home-showcase-label';
        label.textContent = item.label;
        const title = document.createElement('strong');
        title.className = 'home-showcase-title';
        title.textContent = item.title;
        const detail = document.createElement('span');
        detail.className = 'home-showcase-creator';
        detail.textContent = item.creator ? `By ${item.creator}` : item.reason;
        caption.append(label, title, detail);
        link.append(picture, caption);

        picture.addEventListener('error', () => {
            const wasVisible = !link.hidden;
            link.remove();
            if (!stage.children.length) {
                fallback();
            } else if (wasVisible) {
                show(Math.min(active, stage.children.length - 1));
            } else {
                controls.hidden = stage.children.length <= 1;
                count.textContent = `${active + 1} / ${stage.children.length}`;
            }
        });
        stage.appendChild(link);
    }

    const show = (index) => {
        const items = [...stage.children];
        if (!items.length) return fallback();
        active = ((index % items.length) + items.length) % items.length;
        items.forEach((slide, i) => {
            const selected = i === active;
            slide.hidden = !selected;
            slide.tabIndex = selected ? 0 : -1;
            if (selected) {
                const image = slide.querySelector('img[data-showcase-src]');
                if (image && !image.getAttribute('src')) {
                    image.src = image.dataset.showcaseSrc;
                }
            }
        });
        count.textContent = `${active + 1} / ${items.length}`;
        controls.hidden = items.length <= 1;
    };

    root.dataset.state = 'ready';
    intro.hidden = true;
    stage.hidden = false;
    show(0);
    previous.onclick = () => show(active - 1);
    next.onclick = () => show(active + 1);

    const advance = () => {
        if (stage.children.length < 2 ||
            document.visibilityState === 'hidden' ||
            document.documentElement.classList.contains('classic') ||
            window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ||
            root.matches(':hover') ||
            root.contains(document.activeElement)) return;
        show(active + 1);
    };
    const start = () => {
        if (timer === null && stage.children.length > 1) timer = window.setInterval(advance, 5000);
    };
    const stop = () => {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
    };
    const pageHide = () => stop();
    const pageShow = () => start();
    window.addEventListener('pagehide', pageHide);
    window.addEventListener('pageshow', pageShow);
    start();
    disposePrevious = () => {
        stop();
        window.removeEventListener('pagehide', pageHide);
        window.removeEventListener('pageshow', pageShow);
        previous.onclick = null;
        next.onclick = null;
    };
}
