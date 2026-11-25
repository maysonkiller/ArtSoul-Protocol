import './artwork-player.css';

function mediaTime(seconds) {
    if (!Number.isFinite(seconds)) return '–:––';
    const whole = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(whole / 60);
    const tail = String(whole % 60).padStart(2, '0');
    return minutes < 60 ? `${minutes}:${tail}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${tail}`;
}

// All markup is fixed product copy. Artwork URLs are read only on user action.
const controlsMarkup = `
    <input class="ap-seek" type="range" min="0" step="0.1" value="0" aria-label="Seek">
    <button class="artsoul-media-toggle" type="button" aria-label="Play" title="Play"></button>
    <span class="ap-time"></span>
    <button class="artsoul-media-mute" type="button" aria-label="Mute" title="Mute"></button>
    <button class="ap-options" type="button" aria-label="Playback options" title="Playback options" aria-haspopup="dialog">•••</button>
    <dialog class="ap-dialog" aria-label="Playback options">
        <form method="dialog"><strong>Playback options</strong><button aria-label="Close playback options" title="Close" value="close">×</button></form>
        <label>Playback speed <select>
            <option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="0.75">0.75×</option>
            <option value="1" selected>Normal</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option>
            <option value="1.75">1.75×</option><option value="2">2×</option>
        </select></label>
        <label>Volume <input class="ap-volume" type="range" min="0" max="1" step="0.01" value="1"></label>
        <button type="button" class="ap-full">Full screen</button>
        <button type="button" class="ap-pip">Picture in picture</button>
        <a class="ap-file" rel="noopener noreferrer" target="_blank">Download media</a>
    </dialog>
    <span class="ap-message" role="status"></span>`;

class ArtworkMediaPlayer extends HTMLElement {
    connectedCallback() {
        // React and DOM cards can attach a player in the same task as its media.
        queueMicrotask(() => {
            const media = this.querySelector('video, audio');
            if (this.isConnected && !this.bar && media) this.bind(media);
        });
    }

    disconnectedCallback() {
        this.events?.abort();
        this.bar?.remove();
        this.bar = null;
    }

    bind(media) {
        const bar = document.createElement('div');
        this.bar = bar;
        this.events = new AbortController();
        const listen = (element, name, fn) => element.addEventListener(name, fn, {signal: this.events.signal});
        this.lang = 'en';
        bar.className = 'ap-controls';
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', 'Media playback');
        bar.innerHTML = controlsMarkup;
        this.appendChild(bar);
        const find = selector => bar.querySelector(selector);
        const play = find('.artsoul-media-toggle'), mute = find('.artsoul-media-mute');
        const options = find('.ap-options'), dialog = find('dialog'), speed = find('select');
        const seek = find('.ap-seek'), volume = find('.ap-volume'), clock = find('.ap-time');
        const full = find('.ap-full'), pip = find('.ap-pip'), file = find('.ap-file'), message = find('.ap-message');
        const isVideo = media.tagName === 'VIDEO';
        const label = (button, text) => { button.setAttribute('aria-label', text); button.title = text; };
        const report = text => { message.textContent = text; };
        const syncPlay = () => {
            const playing = !media.paused && !media.ended;
            play.dataset.state = playing ? 'playing' : 'paused';
            label(play, playing ? 'Pause' : 'Play');
        };
        const syncVolume = () => {
            const silent = media.muted || media.volume === 0;
            mute.dataset.muted = String(silent);
            label(mute, silent ? 'Unmute' : 'Mute');
            volume.value = media.muted ? 0 : media.volume;
            volume.setAttribute('aria-valuetext', Math.round(volume.value * 100) + '%');
        };
        const syncTime = () => {
            const duration = media.duration;
            seek.disabled = !Number.isFinite(duration) || duration <= 0;
            seek.max = seek.disabled ? 0 : duration;
            seek.value = media.currentTime;
            const position = mediaTime(media.currentTime);
            const displayed = position + ' / ' + mediaTime(duration);
            if (clock.textContent !== displayed) {
                clock.textContent = displayed;
                seek.setAttribute('aria-valuetext', displayed);
            }
        };
        let clockTimer, waitingAt = null;
        const stopClock = () => {
            clearInterval(clockTimer);
            clockTimer = undefined;
        };
        const sampleClock = () => {
            if (waitingAt !== null && waitingAt !== media.currentTime) waitingAt = null;
            if (waitingAt === null && message.textContent === 'Buffering…') report('');
            syncTime();
        };
        const updateClock = event => {
            const type = event?.type;
            if (type === 'waiting' && media.readyState < 3 && !media.paused) {
                waitingAt = media.currentTime;
                report('Buffering…');
            } else if (type === 'playing' || type === 'emptied' || media.paused || media.ended) {
                waitingAt = null;
            }
            if (media.paused || media.ended || media.error || document.hidden || type === 'emptied') stopClock();
            else if (clockTimer === undefined) clockTimer = setInterval(sampleClock, 1000);
            sampleClock();
        };
        this.events.signal.addEventListener('abort', stopClock, { once: true });
        const startPlayback = () => media.play().catch(error => {
            if (error.name !== 'AbortError') report('Playback could not start. Try again.');
        });
        const togglePlay = () => {
            report('');
            if (media.paused || media.ended) startPlayback();
            else media.pause();
        };
        listen(play, 'click', togglePlay);
        if (isVideo) listen(media, 'click', event => { event.preventDefault(); event.stopPropagation(); togglePlay(); });
        listen(mute, 'click', () => {
            const wasPlaying = !media.paused && !media.ended;
            if (media.volume === 0) { media.volume = 1; media.muted = false; }
            else media.muted = !media.muted;
            if (wasPlaying && media.paused && !media.ended && media.isConnected && !document.hidden) startPlayback();
            syncVolume();
        });
        listen(volume, 'input', () => { media.volume = Number(volume.value); media.muted = media.volume === 0; syncVolume(); });
        listen(seek, 'input', () => { if (!seek.disabled) { media.currentTime = Number(seek.value); syncTime(); } });
        listen(speed, 'change', () => { media.playbackRate = Number(speed.value); });
        listen(media, 'ratechange', () => { speed.value = media.playbackRate; });
        for (const event of ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked']) listen(media, event, sampleClock);
        for (const event of ['play', 'playing', 'waiting', 'pause', 'ended', 'emptied', 'error']) listen(media, event, updateClock);
        listen(document, 'visibilitychange', updateClock);
        for (const event of ['play', 'pause', 'ended', 'emptied']) listen(media, event, syncPlay);
        listen(media, 'volumechange', syncVolume);
        listen(media, 'play', () => {
            for (const other of document.querySelectorAll('video, audio')) {
                if (other !== media && !other.paused) other.pause();
            }
        });

        const isFullscreen = () => document.fullscreenElement === this;
        const inPip = () => document.pictureInPictureElement === media || media.webkitPresentationMode === 'picture-in-picture';
        listen(options, 'click', () => {
            speed.value = media.playbackRate;
            full.hidden = !isVideo || !(document.fullscreenEnabled && this.requestFullscreen || media.webkitSupportsFullscreen);
            full.textContent = isFullscreen() ? 'Exit full screen' : 'Full screen';
            pip.hidden = !isVideo || !(document.pictureInPictureEnabled && media.requestPictureInPicture || media.webkitSupportsPresentationMode?.('picture-in-picture'));
            pip.textContent = inPip() ? 'Exit picture in picture' : 'Picture in picture';
            const source = media.currentSrc || media.src;
            file.hidden = !source;
            if (source) {
                const url = new URL(source, document.baseURI);
                const supported = ['https:', 'http:', 'blob:'].includes(url.protocol);
                const publicStorage = url.pathname.startsWith('/storage/v1/object/public/');
                if (publicStorage) url.searchParams.set('download', '');
                const downloadable = publicStorage || url.origin === location.origin || url.protocol === 'blob:';
                file.toggleAttribute('download', downloadable);
                file.textContent = downloadable ? 'Download media' : 'Open original media';
                file.hidden = !supported;
                if (supported) file.href = url.href;
                else file.removeAttribute('href');
            }
            dialog.showModal();
        });
        listen(full, 'click', async () => {
            dialog.close();
            try {
                if (isFullscreen()) await document.exitFullscreen();
                else if (document.fullscreenEnabled && this.requestFullscreen) await this.requestFullscreen();
                else media.webkitEnterFullscreen();
            } catch { report('Full screen is unavailable.'); }
        });
        listen(pip, 'click', async () => {
            dialog.close();
            try {
                if (document.pictureInPictureEnabled && media.requestPictureInPicture) {
                    if (document.pictureInPictureElement === media) await document.exitPictureInPicture();
                    else await media.requestPictureInPicture();
                } else media.webkitSetPresentationMode(inPip() ? 'inline' : 'picture-in-picture');
            } catch { report('Picture in picture is unavailable.'); }
        });
        listen(dialog, 'click', event => { if (event.target === dialog) dialog.close(); });
        // Legacy preview cards can be links. Keep taps and keyboard activation inside the player.
        listen(bar, 'click', event => {
            event.stopPropagation();
            if (!event.target.closest('a, select, input, form button')) event.preventDefault();
        });
        syncPlay(); updateClock(); syncVolume();
    }
}

if (!customElements.get('artsoul-media-player')) customElements.define('artsoul-media-player', ArtworkMediaPlayer);

export function wrapArtworkMedia(media) {
    const player = document.createElement('artsoul-media-player');
    player.appendChild(media);
    return player;
}
