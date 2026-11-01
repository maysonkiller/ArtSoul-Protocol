// Discovery-driven Home showcase. Presentation only: it reuses the public Home
// response, existing artwork URL/media safety helpers and current ranking.
// Never invent a highlighted work or issue a database/network request here.
// Eight seconds leaves time to read a title and creator name without requiring
// a long wait. Motion preference applies to BOTH themes, visual animation only
// to Future. A real pause button prevents uncontrollable auto-rotation.
export const HOME_SHOWCASE_CYCLE_MS = 8000;

export function shouldAutoAdvanceShowcase({ slideCount = 0, visibility = 'visible', reducedMotion = false, hovered = false, focused = false, paused = false } = {}) {
    return slideCount > 1 && visibility === 'visible' && !reducedMotion && !hovered && !focused && !paused;
}
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
let userPaused = false;

export function renderHomeShowcase(slots, { unavailable = false } = {}) {
    const root = document.getElementById('homeShowcase');
    const stage = document.getElementById('homeShowcaseStage');
    const intro = document.getElementById('homeShowcaseIntro');
    const controls = document.getElementById('homeShowcaseControls');
    const previous = document.getElementById('homeShowcasePrev');
    const next = document.getElementById('homeShowcaseNext');
    const count = document.getElementById('homeShowcaseCount');
    // The visible slide counter doubles as an accessible pause/resume control;
    // no separate pause icon or opaque control bar covers the artwork.
    const pause = count;
    const status = document.getElementById('homeShowcaseStatus');
    if (![root, stage, intro, controls, previous, next, count, pause, status].every(Boolean)) return;

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
    let mediaUnavailable = false;
    const fallback = () => {
        root.dataset.state = unavailable || mediaUnavailable ? 'unavailable' : 'empty';
        status.textContent = unavailable
            ? 'Featured artworks are temporarily unavailable.'
            : mediaUnavailable
                ? 'Artwork previews are temporarily unavailable.'
                : 'No featured artworks available yet.';
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
        picture.loading = 'eager';
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
            mediaUnavailable = true;
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
        count.setAttribute('aria-label', `Artwork ${active + 1} of ${items.length}. Activate to pause or resume automatic rotation.`);
    };

    root.dataset.state = 'ready';
    intro.hidden = true;
    stage.hidden = false;
    show(0);
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    // An explicit press of Resume wins over the hover/focus pause until focus
    // moves to another control. Simply focusing the carousel always pauses it.
    let explicitResume = false;
    let focusPaused = false;
    let pointerFocus = false;
    // Touch browsers can hold :hover after a tap. Only fine-hover devices
    // should let pointer hover suspend the carousel.
    const fineHover = window.matchMedia?.('(hover: hover)')?.matches ?? true;
    const mayAdvance = () => shouldAutoAdvanceShowcase({
        slideCount: stage.children.length,
        visibility: document.visibilityState,
        reducedMotion: Boolean(motion?.matches),
        hovered: fineHover && root.matches(':hover') && !explicitResume,
        focused: root.contains(document.activeElement) && !pointerFocus && !explicitResume,
        paused: userPaused || focusPaused
    });
    const stop = () => {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
    };
    const advance = () => {
        if (!mayAdvance()) {
            stop();
            return;
        }
        show(active + 1);
    };
    const start = () => {
        if (timer === null && mayAdvance()) timer = window.setInterval(advance, HOME_SHOWCASE_CYCLE_MS);
    };
    const restart = () => { stop(); start(); };
    const syncPause = () => {
        const stopped = userPaused || focusPaused;
        // Preserve the visible 2 / 4 counter in all states. Pause is an action
        // on this counter, announced to assistive technology rather than shown
        // as a distracting extra icon over the artwork.
        pause.setAttribute('aria-pressed', String(stopped));
        const current = active + 1;
        const total = stage.children.length;
        const reduced = Boolean(motion?.matches);
        pause.setAttribute('aria-label', reduced
            ? `Artwork ${current} of ${total}. Automatic rotation disabled by motion preference.`
            : `Artwork ${current} of ${total}. ${stopped ? 'Resume' : 'Pause'} automatic rotation.`);
        pause.title = reduced ? 'Autoplay disabled by motion preference'
            : stopped ? 'Resume slideshow' : 'Pause slideshow';
        stage.setAttribute('aria-live', stopped || reduced ? 'polite' : 'off');
        pause.disabled = reduced;
    };
    previous.onclick = () => { show(active - 1); restart(); };
    next.onclick = () => { show(active + 1); restart(); };
    pause.onclick = () => {
        // Keyboard focus can pause before click: the first click then resumes,
        // rather than toggling the already-stopped carousel back to "paused".
        const wasStopped = userPaused || focusPaused;
        userPaused = !wasStopped;
        focusPaused = false;
        explicitResume = wasStopped;
        syncPause();
        restart();
    };
    syncPause();

    const onHover = () => { if (fineHover) { explicitResume = false; stop(); } };
    const onLeave = () => { if (fineHover) { explicitResume = false; start(); } };
    const onPointerDown = () => { pointerFocus = true; };
    const onPointerUp = () => { pointerFocus = false; };
    const onFocus = event => {
        // Pointer/touch focus is not a keyboard navigation pause; otherwise
        // tapping "Pause" on an iPhone would silently turn into "Resume".
        if (pointerFocus) return;
        if (explicitResume && event.target === pause) return;
        explicitResume = false;
        focusPaused = true;
        syncPause();
        stop();
    };
    const onBlur = event => {
        if (!root.contains(event.relatedTarget)) {
            explicitResume = false;
            // Per WAI-ARIA, keyboard-focus pause survives blur until
            // the visitor expressly uses the rotation control.
            start();
        }
    };
    const onVisibility = () => {
        if (document.visibilityState === 'visible') start();
        else stop();
    };
    const onMotion = () => { syncPause(); if (motion?.matches) stop(); else start(); };
    const pageHide = () => stop();
    const pageShow = () => start();
    root.addEventListener('mouseenter', onHover);
    root.addEventListener('mouseleave', onLeave);
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', onPointerUp);
    root.addEventListener('focusin', onFocus);
    root.addEventListener('focusout', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    motion?.addEventListener?.('change', onMotion);
    window.addEventListener('pagehide', pageHide);
    window.addEventListener('pageshow', pageShow);
    start();
    disposePrevious = () => {
        stop();
        root.removeEventListener('mouseenter', onHover);
        root.removeEventListener('mouseleave', onLeave);
        root.removeEventListener('pointerdown', onPointerDown);
        root.removeEventListener('pointerup', onPointerUp);
        root.removeEventListener('pointercancel', onPointerUp);
        root.removeEventListener('focusin', onFocus);
        root.removeEventListener('focusout', onBlur);
        document.removeEventListener('visibilitychange', onVisibility);
        motion?.removeEventListener?.('change', onMotion);
        window.removeEventListener('pagehide', pageHide);
        window.removeEventListener('pageshow', pageShow);
        previous.onclick = null;
        next.onclick = null;
        pause.onclick = null;
    };
}
