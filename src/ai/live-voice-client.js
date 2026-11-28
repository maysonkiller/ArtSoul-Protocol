// Explicit, local-only developer pilot. No auto-connect or provider credential.
export const LIVE_READ_TOOLS = Object.freeze([
  'search_artworks', 'search_catalog', 'find_active_auctions', 'get_artwork',
  'get_auction_state', 'get_artwork_provenance', 'explain_settlement', 'open_page', 'open_artwork'
]);

export function createLiveVoiceController({onState = () => {}, onTranscript = () => {},
  onTool = async () => ({error: 'Tool review unavailable.'}), environment = globalThis} = {}) {
  let generation = 0, socket, context, stream, capture, source, mute, aborter;
  let ready = false, audioEndsAt = 0, expiryTimer, connectTimer;
  const speakers = new Set();
  const listeners = [];
  const state = (name, message) => onState({name, message});
  const closeResources = () => {
    environment.clearTimeout(expiryTimer);
    environment.clearTimeout(connectTimer);
    ready = false;
    audioEndsAt = 0;
    aborter?.abort();
    if (capture) capture.port.onmessage = null;
    for (const node of [capture, source, mute]) { try { node?.disconnect(); } catch {} }
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    for (const speaker of speakers) { try { speaker.stop(); } catch {} }
    speakers.clear();
    try { context?.close()?.catch(() => {}); } catch {}
    context = null;
    try {
      if (socket?.readyState === 1) socket.send(JSON.stringify({type: 'stop'}));
      socket?.close();
    } catch {}
    socket = null;
  };
  function stop(reason = 'stopped') {
    generation++;
    closeResources();
    state('ended', reason === 'expired' ? 'The local pilot time limit was reached.' : 'Live conversation ended.');
  }
  async function start({language = 'en'} = {}) {
    if (!['localhost', '127.0.0.1'].includes(environment.location.hostname) ||
        environment.navigator.userActivation?.isActive !== true) {
      state('error', 'Start this local pilot with its button.'); return;
    }
    if (socket || context) return;
    const attempt = ++generation;
    aborter = new AbortController();
    const signal = aborter.signal;
    const rateError = 'Live voice requires 24 kHz audio. Try a browser or audio device that supports 24 kHz.';
    const bridgeError = 'Could not connect to the local voice bridge. Check that the local pilot server is running and try again.';
    let startupError = 'Could not start browser audio. Check your audio settings and try again.';
    let bridgeConnected = false;
    const failStartup = message => {
      if (attempt !== generation) return;
      generation++;
      closeResources();
      state('error', message);
    };
    try {
      state('connecting', 'Starting browser audio…');
      const AudioContextClass = environment.AudioContext || environment.webkitAudioContext;
      if (!AudioContextClass) {
        failStartup('Live voice needs Web Audio support. Try a browser that supports Web Audio.');
        return;
      }
      try {
        context = new AudioContextClass({sampleRate: 24000});
      } catch (error) {
        failStartup(error?.name === 'NotSupportedError' ? rateError : startupError);
        return;
      }
      if (context.sampleRate !== 24000) { failStartup(rateError); return; }
      await context.resume();
      if (attempt !== generation) return;
      state('connecting', 'Requesting microphone permission…');
      let granted;
      try {
        granted = await environment.navigator.mediaDevices.getUserMedia({audio: {
          channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true
        }});
      } catch (error) {
        if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
          failStartup('Microphone permission was denied. Allow microphone access for this site in your browser settings and try again.');
        } else if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
          failStartup('No microphone was found. Connect or select a microphone and try again.');
        } else {
          failStartup('Could not open the microphone. Check your input device settings and try again.');
        }
        return;
      }
      if (attempt !== generation) { granted.getTracks().forEach(track => track.stop()); return; }
      stream = granted;
      await context.audioWorklet.addModule('/src/ai/live-voice-capture.js');
      if (attempt !== generation) return;
      source = context.createMediaStreamSource(stream);
      capture = new environment.AudioWorkletNode(context, 'artsoul-live-capture');
      mute = context.createGain();
      mute.gain.value = 0;
      source.connect(capture); capture.connect(mute); mute.connect(context.destination);
      const url = new URL('/__live-voice-pilot/socket', environment.location.origin);
      url.searchParams.set('language', language === 'ru' ? 'ru' : 'en');
      url.protocol = environment.location.protocol === 'https:' ? 'wss:' : 'ws:';
      startupError = bridgeError;
      socket = new environment.WebSocket(url.href);
      const activeSocket = socket;
      connectTimer = environment.setTimeout(() => failStartup(bridgeError), 15000);
      capture.port.onmessage = event => {
        if (attempt !== generation || !ready || activeSocket.readyState !== 1 || context.currentTime < audioEndsAt) return;
        if (activeSocket.bufferedAmount > 64000) { stop('network_slow'); return; }
        const bytes = new Uint8Array(event.data);
        activeSocket.send(JSON.stringify({type: 'audio', audio: environment.btoa(String.fromCharCode(...bytes))}));
      };
      activeSocket.onmessage = async event => {
        if (attempt !== generation) return;
        let data;
        try { data = JSON.parse(event.data); } catch { stop('invalid_response'); return; }
        if (data.type === 'ready') {
          bridgeConnected = true;
          environment.clearTimeout(connectTimer);
          ready = true;
          expiryTimer = environment.setTimeout(() => { if (attempt === generation) stop('expired'); }, Math.min(60000, data.durationMs || 60000));
          state('listening', 'Listening. Replies use the AI-generated Marin voice.');
        } else if (data.type === 'audio') {
          ready = false;
          state('speaking', 'Speaking…');
          try {
            const raw = environment.atob(data.audio);
            if (!raw.length || raw.length % 2 || raw.length > 262144) throw new Error();
            const pcm = Uint8Array.from(raw, char => char.charCodeAt(0));
            const view = new DataView(pcm.buffer);
            const buffer = context.createBuffer(1, raw.length / 2, 24000);
            const channel = buffer.getChannelData(0);
            for (let i = 0; i < channel.length; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
            const speaker = context.createBufferSource();
            speaker.buffer = buffer; speaker.connect(context.destination);
            const startAt = Math.max(context.currentTime + 0.025, audioEndsAt);
            if (startAt - context.currentTime > 30) throw new Error();
            audioEndsAt = startAt + buffer.duration;
            speakers.add(speaker);
            speaker.onended = () => speakers.delete(speaker);
            speaker.start(startAt);
          } catch { stop('playback_failed'); }
        } else if (data.type === 'transcript') {
          onTranscript(String(data.text || '').slice(0, 2000));
        } else if (data.type === 'listening') {
          ready = true;
          state('listening', 'Listening after the current reply finishes…');
        } else if (data.type === 'tool') {
          ready = false;
          state('review', 'Review the requested site action.');
          let result;
          try { result = await onTool(data.command, {signal, stop}); }
          catch { result = {error: 'The requested action did not complete.'}; }
          if (attempt !== generation || signal.aborted) return;
          const serialized = JSON.stringify(result ?? {error: 'No tool result.'});
          const output = new TextEncoder().encode(serialized).length <= 6000
            ? serialized : JSON.stringify({error: 'The result is too long. Inspect the site directly.'});
          activeSocket.send(JSON.stringify({type: 'tool_result', callId: data.callId, result: output}));
        } else if (data.type === 'ended') {
          const reason = data.reason;
          stop(reason);
          if (reason === 'funding_not_verified') state('unavailable', 'Live voice is off until promotional coverage and protection from cash charges are independently verified.');
          else if (reason !== 'stopped') state('ended', `Pilot ended: ${String(reason).replace(/_/g, ' ')}.`);
        }
      };
      const connectionLost = reason => {
        if (attempt !== generation) return;
        if (bridgeConnected) stop(reason);
        else failStartup(bridgeError);
      };
      activeSocket.onerror = () => connectionLost('connection_error');
      activeSocket.onclose = () => connectionLost('disconnected');
    } catch {
      failStartup(startupError);
    }
  }
  const listen = (target, name, callback) => {
    target?.addEventListener?.(name, callback);
    listeners.push(() => target?.removeEventListener?.(name, callback));
  };
  listen(environment, 'pagehide', () => stop('page_closed'));
  listen(environment.document, 'visibilitychange', () => { if (environment.document.hidden) stop('page_hidden'); });
  for (const name of ['artsoul:wallet-state-changed', 'artsoul:auth-state-changed']) listen(environment, name, () => stop('account_changed'));
  return {start, stop, destroy() { stop(); listeners.forEach(remove => remove()); }};
}

export function mountLiveVoicePilot(container, win = window) {
  const doc = container.ownerDocument;
  const status = doc.createElement('p'); status.setAttribute('role', 'status');
  const transcript = doc.createElement('p'); transcript.setAttribute('aria-live', 'polite');
  const start = doc.createElement('button'); start.type = 'button'; start.textContent = 'Start local voice test';
  const language = doc.createElement('select'); language.setAttribute('aria-label', 'Spoken reply language');
  for (const [value, text] of [['en', 'English'], ['ru', 'Russian']]) {
    const option = doc.createElement('option'); option.value = value; option.textContent = text; language.append(option);
  }
  const stop = doc.createElement('button'); stop.type = 'button'; stop.textContent = 'Stop'; stop.disabled = true;
  const reviewBox = doc.createElement('div'); reviewBox.hidden = true;
  container.append(language, start, stop, status, transcript, reviewBox);
  const review = (command, signal) => new Promise(resolve => {
    const label = doc.createElement('p'); label.textContent = `Requested action: ${command}`;
    const approve = doc.createElement('button'); approve.type = 'button'; approve.textContent = 'Run this action';
    const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Decline';
    const done = value => { signal.removeEventListener('abort', aborted); reviewBox.replaceChildren(); reviewBox.hidden = true; resolve(value); };
    const aborted = () => done(false);
    approve.onclick = () => done(!signal.aborted); cancel.onclick = () => done(false);
    if (signal.aborted) { resolve(false); return; }
    signal.addEventListener('abort', aborted, {once: true});
    reviewBox.replaceChildren(label, approve, cancel); reviewBox.hidden = false; approve.focus();
  });
  const controller = createLiveVoiceController({environment: win,
    onState: value => {
      status.textContent = value.message;
      const active = ['connecting', 'listening', 'speaking', 'review'].includes(value.name);
      start.disabled = active; stop.disabled = !active; language.disabled = active;
    }, onTranscript: text => { transcript.textContent = text; },
    onTool: (command, context) => runReviewedLiveCommand(command, context, {window: win, review})
  });
  start.onclick = () => {
    if (win.confirm('This local test sends microphone audio and reviewed public tool results to OpenAI. Replies use an AI voice. It stops within 60 seconds and can consume API credits. Start only after the operator has verified funding protection.')) controller.start({language: language.value});
  };
  stop.onclick = () => controller.stop();
  return controller;
}

/** Reuse the existing parser and checked tool implementations; never create wallet access. */
export async function runReviewedLiveCommand(command, {signal, stop}, {window: win = window, review} = {}) {
  const parsed = win.ArtSoulVoice?.parseCommand?.(command, 'en');
  if (!parsed || !LIVE_READ_TOOLS.includes(parsed.tool)) return {error: 'This pilot supports read and navigation commands only. Use the ordinary assistant for reviewed wallet actions.'};
  if (win.ArtSoulWebMCP?.isStaffPage?.()) return {error: 'Live voice is unavailable on staff pages.'};
  const approved = await review?.(command, signal);
  if (!approved || signal.aborted) return {error: 'Action was not approved.'};
  const deps = win.ArtSoulWebMCP.browserDependencies();
  deps.openPath = path => {
    const target = new URL(path, 'https://artsoulprotocol.com');
    if (target.origin !== 'https://artsoulprotocol.com' || !/^\/(?:gallery|profile|upload|docs-protocol|artwork\/\d+)?$/.test(target.pathname)) throw new Error('Unsupported navigation');
    win.location.assign(target.href);
  };
  const tool = win.ArtSoulWebMCP.createTools(deps).find(item => item.name === parsed.tool);
  if (!tool) return {error: 'This command is unavailable on the current page.'};
  if (['open_page', 'open_artwork'].includes(parsed.tool)) stop('navigation');
  try { return JSON.parse(await tool.execute(parsed.input)); }
  catch { return {error: 'The site tool could not complete this request.'}; }
}
