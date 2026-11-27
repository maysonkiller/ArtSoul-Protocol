// A muted MP3 can report an early end and then a near-zero duration on WebKit.
// Keep the last known length for this source and recover only on a user's Play.
const tracks = new WeakMap();
let recoveryContext;
let connectedOutputs = 0;

function track(media) {
    const url = media.src || media.currentSrc;
    let state = tracks.get(media);
    if (!state || state.url !== url) {
        state = { url, duration: 0, position: 0, checkedMute: false, output: state?.output };
        tracks.set(media, state);
    }
    return state;
}

function collapsed(media, state) {
    return state.checkedMute && Number.isFinite(media.duration)
        && media.duration < state.duration / 4 && state.duration - media.duration > 1;
}

function knownDuration(media) {
    const state = track(media);
    if (collapsed(media, state)) return state.duration || NaN;
    if (media.duration > 0 && Number.isFinite(media.duration)) {
        state.duration = media.duration;
        state.position = media.currentTime;
    }
    return media.duration > 0 ? media.duration : state.duration || NaN;
}

function elapsed(media) {
    const state = track(media);
    if (collapsed(media, state)) return media.currentTime || state.position || 0;
    if (Number.isFinite(media.currentTime)) state.position = media.currentTime;
    return media.currentTime || 0;
}

function isMuted(media) {
    return media.muted || tracks.get(media)?.output?.gain.value === 0;
}

function setMuted(media, value) {
    knownDuration(media);
    const state = track(media);
    state.checkedMute = true;
    if (state.output) state.output.gain.value = value ? 0 : 1;
    else media.muted = value;
}

function enableSilentOutput(media, state) {
    if (state.output || !window.AudioContext || !media.crossOrigin) return;
    // Only our public artwork storage is explicitly requested with anonymous CORS.
    if (!window.ArtSoulStorageImage?.isValidStorageUrl(state.url)) return;
    try {
        recoveryContext ||= new window.AudioContext();
        const output = recoveryContext.createGain();
        output.gain.value = 0;
        const source = recoveryContext.createMediaElementSource(media);
        source.connect(output);
        let connected = false;
        const connect = () => {
            if (connected) return;
            output.connect(recoveryContext.destination);
            connected = true;
            connectedOutputs++;
        };
        const disconnect = () => {
            if (!connected || (!media.paused && !media.ended)) return;
            output.disconnect();
            connected = false;
            if (--connectedOutputs === 0) recoveryContext.suspend().catch(() => {});
        };
        // Release the device after the last recovered track pauses or ends.
        media.addEventListener('play', connect);
        media.addEventListener('pause', disconnect);
        media.addEventListener('ended', disconnect);
        connect();
        state.output = output;
        media.muted = false;
    } catch {
        // Native playback and mute remain available when Web Audio is unavailable.
    }
}

function play(media) {
    const state = track(media);
    if (collapsed(media, state)) {
        const position = elapsed(media);
        if (media.muted) enableSilentOutput(media, state);
        media.load();
        if (position > 0 && position < state.duration) media.currentTime = position;
    } else if (media.ended) media.currentTime = 0;
    // Start both in the tap, before either promise can consume the user gesture.
    const resumed = state.output ? recoveryContext.resume() : null;
    return resumed ? Promise.all([media.play(), resumed]) : media.play();
}

export const artworkAudio = { knownDuration, elapsed, isMuted, setMuted, play };
// DOM and React cards share one classic deferred script; entries install these
// same controls before either kind of card is rendered.
window.ArtSoulArtworkAudio = artworkAudio;
