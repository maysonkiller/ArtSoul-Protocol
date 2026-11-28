const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('voice-commands.js', 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const searchResult = { category: 'all', groups: {
  artworks: {items: [{title: 'Moon', artwork_id: '31', creator: 'Vera', url: '/artwork/31'}], hasMore: false},
  auctions: {items: [], hasMore: false}, artists: {items: [], hasMore: false}
}};

function harness({speech = false, audio = false, execute = async () => JSON.stringify(searchResult),
  navigation, session = new Map(), storage = new Map(), browserLanguage = 'en', staffPage = false} = {}) {
  const nodes = new Map(), calls = [], sessions = [], spoken = [], utterances = [];
  const players = [], plays = [], timers = new Map();
  let prompts = 0, cancelled = 0, timerId = 0;
  const events = () => ({listeners: new Map(),
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); },
    fire(type, extra = {}) { for (const fn of this.listeners.get(type) || []) fn({preventDefault() {}, stopPropagation() {}, ...extra}); }
  });
  const document = {...events(), visibilityState: 'visible', body: {appendChild() {}},
    querySelector: selector => nodes.get(selector),
    createElement() {
      const node = {...events(), attrs: {}, hidden: false, disabled: false, value: '', textContent: '', dataset: {},
        children: [], replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); },
        setAttribute(key, value) { this.attrs[key] = value; },
        hasAttribute(key) { return Object.hasOwn(this.attrs, key); },
        focus() { document.activeElement = this; },
        classList: {toggle() {}},
        querySelector(selector) {
          if (!nodes.has(selector)) nodes.set(selector, document.createElement('div'));
          return nodes.get(selector);
        },
        querySelectorAll: () => [en, ru]
      };
      Object.defineProperty(node, 'className', {set(name) {nodes.set('.' + name, node);}});
      return node;
    }
  };
  const headerLauncher = document.createElement('button');
  headerLauncher.className = 'artsoul-voice-button';
  headerLauncher.setAttribute('aria-expanded', 'false');
  nodes.set('.site-header-actions .artsoul-voice-button', headerLauncher);
  const en = document.createElement(), ru = document.createElement(); en.dataset.lang = 'en'; ru.dataset.lang = 'ru';
  class Recognition {
    constructor() {
      if (speech === 'constructor-error') throw Error('Speech service unavailable');
      sessions.push(this);
    }
    start() { this.started = true; }
    abort() { this.aborted = true; this.onend?.(); }
  }
  class Audio {
    constructor(src = '') {
      Object.assign(this, events());
      this.src = src; this.paused = true; this.currentTime = 0;
      this.pauseCount = 0; this.loadCount = 0;
      players.push(this);
    }
    play() {
      this.paused = false;
      const attempt = {player: this, src: this.src};
      plays.push(attempt);
      return new Promise((resolve, reject) => {attempt.resolve = resolve; attempt.reject = reject;});
    }
    pause() { this.paused = true; this.pauseCount++; }
    load() { this.loadCount++; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    emit(type) {
      if (type === 'ended') this.paused = true;
      this['on' + type]?.({type, target: this});
      this.fire(type, {target: this});
    }
  }
  const window = {...events(),
    setTimeout: fn => {const id = ++timerId; timers.set(id, fn); return id;},
    clearTimeout: id => timers.delete(id),
    localStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)},
    confirm: () => {prompts++; return true;},
    speechSynthesis: {cancel() {cancelled++;}, speak(value) {utterances.push(value); spoken.push(value.text);}},
    sessionStorage: {getItem: key => session.get(key), setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key)},
    ArtSoulWebMCP: {isStaffPage: () => staffPage, browserDependencies: () => ({}), createTools: () => ['search_catalog', 'open_page', 'open_artwork', 'buy_resale_listing', 'complete_settlement', 'get_my_activity', 'add_to_saved', 'remove_from_saved', 'revise_publication_draft'].map(name => ({name,
      execute: args => {calls.push({name, args}); return execute(args);}
    }))}
  };
  if (speech) window.SpeechRecognition = Recognition;
  if (audio) window.Audio = Audio;
  if (navigation) {
    window.location = new URL(navigation.href);
    document.referrer = navigation.referrer || '';
    document.visibilityState = navigation.visibility || 'visible';
    window.performance = {getEntriesByType: () => [{type: navigation.type || 'navigate'}]};
  }
  new Function('window', fs.readFileSync('voice-phrase-bank.js', 'utf8'))(window);
  // Lifecycle fixtures deliberately expose the recovered core recordings only.
  // Adding a new reviewed recording must not turn a missing-audio fixture into
  // a different scenario. The full shipped inventory has separate integrity tests.
  const actualBank = window.ArtSoulVoicePhraseBank;
  const coreIds = new Set(['helpSpeech', 'searchPrompt', 'publicationPrompt', 'tooLong', 'empty',
    'unavailable', 'noWallet', 'submitted', 'settled', 'options', 'askSearch', 'askTitle', 'identityReviewHelp']);
  window.ArtSoulVoicePhraseBank = Object.freeze({...actualBank, lookup(text, lang = 'en') {
    const url = actualBank.lookup(text, lang);
    const id = /\/(en|ru)-([a-zA-Z0-9]+)\.wav$/.exec(url);
    return id && (coreIds.has(id[2]) || id[2] === 'r2Greeting' && lang === 'en') ? url : '';
  }});
  new Function('window', 'document', 'navigator', 'SpeechSynthesisUtterance', 'Audio', source)(window, document, {language: browserLanguage}, function(text) {this.text = text;}, audio ? Audio : undefined);
  const get = selector => nodes.get(selector);
  return {get, document, window, calls, sessions, spoken, utterances, en, ru, storage, players, plays,
    runTimers() {const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn());},
    prompts: () => prompts,
    cancelled: () => cancelled,
    open: () => get('.artsoul-voice-button').fire('click'),
    submit(value) {get('input').value = value; get('form').fire('submit');},
    connect(address) {window.artsoulSettledWalletState = {isConnected: Boolean(address), address}; window.fire('artsoul:wallet-state-changed');}
  };
}

test('no microphone support still exposes a labelled keyboard composer without requesting audio', async () => {
  const h = harness();
  assert.equal(h.get('.artsoul-voice-panel').hidden, true);
  h.open();
  assert.equal(h.document.activeElement, h.get('input'));
  assert.equal(h.get('.artsoul-voice-panel').attrs.role, 'dialog');
  assert.equal(h.get('.artsoul-voice-mic').disabled, true);
  assert.equal(h.get('.artsoul-voice-support').hidden, false);
  h.submit('search moon'); await flush();
  assert.deepEqual(h.calls, [{name: 'search_catalog', args: {query: 'moon'}}]);
  assert.match(h.get('.artsoul-voice-answer').textContent, /Shown: Artworks: 1/);
  assert.equal(h.prompts(), 0); assert.equal(h.spoken.length, 0);
});

test('opening, typing, examples and language selection never start the microphone', async () => {
  const h = harness({speech: true}); h.open(); h.submit('help'); await flush();
  h.ru.fire('click'); assert.equal(h.get('h2').textContent, 'ArtSoul commands');
  h.submit('помощь'); await flush();
  assert.equal(h.calls.length, 0); assert.equal(h.sessions.length, 0); assert.equal(h.prompts(), 0);
});

test('a prior explicit RU speech choice restores Russian recordings without translating the interface', async () => {
  const storage = new Map([['artsoul.voice.lang', 'ru'], ['artsoul.voice.reply-lang', 'ru']]);
  const h = harness({audio: true, storage}); h.open(); h.submit('помощь'); await flush();
  h.get('.artsoul-voice-replay').fire('click');
  assert.equal(h.plays[0].src, '/audio/assistant/v1/ru-helpSpeech.wav');
  assert.equal(h.get('.artsoul-voice-panel').attrs.lang, 'en');
  h.en.fire('click'); h.submit('help'); await flush(); h.get('.artsoul-voice-replay').fire('click');
  assert.equal(h.plays[1].src, '/audio/assistant/v1/en-helpSpeech.wav');
});

test('staff help explains self-review on screen and plays the selected Marin recording without an admin action', async () => {
  const h = harness({audio: true, staffPage: true}); h.open();
  for (const [lang, request] of [['en', 'help'], ['en', "Why can't I approve my request?"], ['ru', 'Как подтвердить свою заявку?']]) {
    h[lang].fire('click'); h.submit(request); await flush();
    assert.match(h.get('.artsoul-voice-answer').textContent, /Another authorized reviewer/);
    assert.equal(h.get('.artsoul-voice-replay').disabled, false);
    h.get('.artsoul-voice-replay').fire('click');
    assert.equal(h.plays.at(-1).src, '/audio/assistant/v1/phrases/' + lang + '-identityReviewHelp.wav');
  }
  assert.deepEqual(h.calls, []); assert.deepEqual(h.sessions, []);
});

test('greetings use their exact available recording and never consume search or title data', async () => {
  const h = harness({audio: true}); h.open(); h.submit('hello'); await flush();
  h.get('.artsoul-voice-replay').fire('click');
  assert.equal(h.plays[0].src, '/audio/assistant/v1/phrases/en-r2Greeting.wav');
  assert.deepEqual(h.calls, []);
  h.ru.fire('click'); h.submit('привет'); await flush();
  assert.equal(h.get('.artsoul-voice-replay').disabled, true, 'Russian greeting recording is absent');
  h.en.fire('click'); h.submit('search'); await flush(); h.submit('hello'); await flush();
  assert.deepEqual(h.calls, [{name: 'search_catalog', args: {query: 'hello'}}]);
  assert.deepEqual(h.spoken, []);
});

test('fixed result cues stay separate from displayed live facts and failure states', () => {
  const h = harness();
  const { describeResult } = h.window.ArtSoulVoice;
  assert.equal(describeResult('search_catalog', searchResult).say, 'The ArtSoul search results are shown on screen.');
  assert.equal(describeResult('find_active_auctions', {count: 0, auctions: []}).say, 'No open auctions were returned by ArtSoul.');
  assert.notEqual(describeResult('find_active_auctions', {count: 2, auctions: []}).say, 'No open auctions were returned by ArtSoul.');
  const failed = describeResult('place_bid', {submitted: false, reason: 'Declined in wallet'});
  assert.equal(failed.show, 'Declined in wallet');
  assert.equal(failed.say, 'The action was not completed. Check the reason on screen.');
  const details = describeResult('get_artwork', {title: 'Creator title', status: 'Active', current_bid_eth: '0.002'});
  assert.match(details.show, /0.002/); assert.doesNotMatch(details.say, /0.002|Creator title/);
});

test('Russian browser locales and restored input preferences always receive English copy and audio', async () => {
  for (const stored of [false, true]) {
    const storage = new Map(stored ? [['artsoul.voice.lang', 'ru']] : []);
    const h = harness({speech: true, audio: true, browserLanguage: 'ru-RU', storage});
    h.open();
    assert.equal(h.get('.artsoul-voice-panel').attrs.lang, 'en');
    assert.equal(h.ru.attrs['aria-pressed'], String(stored));
    assert.equal(h.get('h2').textContent, 'ArtSoul commands');
    assert.match(h.get('.artsoul-voice-examples p').textContent, /open gallery/);
    h.submit(stored ? 'помощь' : 'help');
    await flush();
    h.get('.artsoul-voice-replay').fire('click');
    assert.equal(h.plays[0].src, '/audio/assistant/v1/en-helpSpeech.wav');
  }
});

test('NFT clarification accepts a short typed answer and closing the panel clears the choice', async () => {
  const h = harness({execute: async () => JSON.stringify({opened: true, page: 'marketplace', title: 'Marketplace', url: '/gallery#marketplace'})});
  h.open(); h.ru.fire('click'); h.submit('открой NFT'); await flush();
  assert.match(h.get('.artsoul-voice-answer').textContent, /marketplace/);
  assert.deepEqual(h.calls, []);
  h.submit('на маркетплейсе'); await flush();
  assert.deepEqual(h.calls, [{name: 'open_page', args: {page: 'marketplace'}}]);
  h.submit('открой NFT'); await flush(); h.get('.artsoul-voice-close').fire('click'); h.open();
  h.submit('42'); await flush();
  assert.equal(h.calls.length, 1);
});

test('search accepts the next phrase as data and the short spoken question uses the shipped voice', async () => {
  const h = harness({speech: true, audio: true});
  h.open(); h.ru.fire('click'); h.get('.artsoul-voice-chat').fire('click'); await flush();
  h.sessions[0].onresult({results: [[{transcript: 'найди', confidence: 1}]]}); await flush();
  assert.equal(h.plays[0].src, '/audio/assistant/v1/phrases/ru-askSearch.wav');
  h.players[0].emit('playing'); h.players[0].emit('ended'); h.runTimers(); await flush();
  h.sessions[1].onresult({results: [[{transcript: 'купи работу 31', confidence: 1}]]}); await flush();
  assert.deepEqual(h.calls, [{name: 'search_catalog', args: {query: 'купи работу 31'}}]);
});

test('short voice prompts use the first sentence of the existing recording without changing its speech', () => {
  for (const [id, original, words] of [
    ['options', 'helpSpeech', 'You can open the gallery, find artwork, or ask about your activity.'],
    ['askSearch', 'searchPrompt', 'What would you like to find?'],
    ['askTitle', 'publicationPrompt', 'What is the title?']
  ]) {
    const h = harness();
    const sourceClip = h.window.ArtSoulVoice.replyClips.find(clip => clip.lang === 'en' && clip.id === original);
    assert.ok(sourceClip.text.startsWith(words));
    const src = fs.readFileSync('public' + sourceClip.url);
    const short = fs.readFileSync('public' + h.window.ArtSoulVoice.getReplyAudio(words));
    assert.equal(short.subarray(0, 4).toString(), 'RIFF');
    assert.equal(short.readUInt32LE(40), short.length - 44);
    assert.deepEqual(short.subarray(12, 40), src.subarray(12, 40));
    assert.ok(short.length > 44 && short.length < src.length, id);
    assert.deepEqual(short.subarray(44), src.subarray(44, short.length), id);
  }
});

test('Publish captures a dictated title as data across voice and typing and clears pending input on close', async () => {
  const {parsePublicationTurn} = await import('../src/features/artwork/command-draft.js');
  const h = harness({speech: true, execute: async input => JSON.stringify({...input, prepared: true, review_required: true})});
  h.window.ArtSoulPublicationDraft = {parseTurn: parsePublicationTurn};
  h.open();
  h.get('.artsoul-voice-chat').fire('click'); await flush();
  h.sessions[0].onresult({results: [[{transcript: 'title', confidence: 1}]]});
  assert.match(h.get('.artsoul-voice-answer').textContent, /Say the wording/);
  h.get('input').fire('input');
  h.submit('Buy artwork 31'); await flush();
  assert.deepEqual(h.calls, [{name: 'revise_publication_draft', args: {field: 'title', value: 'Buy artwork 31'}}]);
  assert.match(h.get('.artsoul-voice-answer').textContent, /Use these details/);
  h.submit('description');
  h.get('.artsoul-voice-panel').fire('keydown', {key:'Escape'});
  h.open(); h.submit('help'); await flush();
  assert.equal(h.calls.length, 1);
});

test('voice chat listens for the next turn only after a finished answer and stops by voice', async () => {
  for (const audio of [false, true]) {
    const h = harness({speech: true, audio});
    h.open(); h.ru.fire('click');
    const chat = h.get('.artsoul-voice-chat');
    chat.fire('click'); await flush();
    assert.equal(chat.textContent, 'End voice chat');
    assert.equal(chat.dataset.listening, 'true');
    const hear = (session, transcript) => session.onresult({results: [[{transcript, confidence: 1}]]});
    hear(h.sessions[0], 'помощь'); await flush();
    assert.equal(h.sessions[0].aborted, true);
    assert.equal(chat.dataset.listening, 'false');
    if (audio) {
      h.players[0].emit('playing');
      assert.equal(h.sessions.length, 1, 'does not listen during recorded speech');
      h.players[0].emit('ended');
    } else {
      assert.equal(h.utterances.length, 0, 'no device voice fallback');
      assert.equal(chat.attrs['aria-pressed'], 'false', 'unavailable audio pauses voice chat');
      h.runTimers(); assert.equal(h.sessions.length, 1);
      continue;
    }
    assert.equal(h.sessions.length, 1, 'keeps a brief gap after reply audio');
    h.runTimers(); await flush();
    assert.equal(h.sessions.length, 2); assert.equal(h.prompts(), 1);
    assert.equal(h.sessions[1].lang, 'ru-RU');
    assert.match(h.get('.artsoul-voice-answer').textContent, /open gallery/);
    hear(h.sessions[1], 'стоп'); await flush(); h.runTimers();
    assert.equal(h.sessions.length, 2); assert.equal(h.calls.length, 0);
    assert.equal(chat.attrs['aria-pressed'], 'false');
  }
});

test('ending voice chat, typing or leaving the page cancels any queued next turn', async () => {
  for (const stop of ['button', 'typing', 'hidden', 'close', 'account', 'language', 'pagehide']) {
    const h = harness({speech: true, audio: true}); h.open();
    const chat = h.get('.artsoul-voice-chat');
    chat.fire('click'); await flush();
    h.sessions[0].onresult({results: [[{transcript: 'help'}]]});
    h.players[0].emit('playing'); h.players[0].emit('ended');
    if (stop === 'button') chat.fire('click');
    if (stop === 'typing') h.get('input').fire('input');
    if (stop === 'hidden') { h.document.visibilityState = 'hidden'; h.document.fire('visibilitychange'); }
    if (stop === 'close') h.get('.artsoul-voice-close').fire('click');
    if (stop === 'account') h.connect('0x' + 'b'.repeat(40));
    if (stop === 'language') h.ru.fire('click');
    if (stop === 'pagehide') h.window.fire('pagehide');
    h.runTimers(); await flush();
    assert.equal(h.sessions.length, 1, stop); assert.equal(chat.attrs['aria-pressed'], 'false', stop);
  }
});

test('voice chat pauses a protected request for deliberate review and never treats reply audio as approval', async () => {
  const h = harness({speech: true}); h.open(); h.get('.artsoul-voice-chat').fire('click'); await flush();
  h.sessions[0].onresult({results: [[{transcript: 'buy artwork 31', confidence: 1}]]});
  assert.deepEqual(h.calls, []);
  assert.equal(h.get('.artsoul-voice-chat').attrs['aria-pressed'], 'false');
  assert.equal(h.get('input').value, 'buy artwork 31');
  assert.match(h.get('.artsoul-voice-answer').textContent, /press Send/);
  assert.deepEqual(h.utterances, []); h.runTimers();
  assert.equal(h.sessions.length, 1);
  h.get('form').fire('submit'); await flush(); assert.equal(h.calls.length, 1);
});

async function voiceNavigation({from = 'https://artsoul.test/', url = '/gallery#discover', account,
  mode = 'chat', beforeLeaving} = {}) {
  const session = new Map(), storage = new Map();
  const h = harness({speech: true, storage, session, navigation: {href: from},
    execute: () => JSON.stringify({opened: true, page: 'gallery', url, title: 'Explore'})});
  if (account) h.connect(account);
  h.open(); h.ru.fire('click');
  if (mode === 'typed') h.submit('открой галерею');
  else {
    h.get(mode === 'chat' ? '.artsoul-voice-chat' : '.artsoul-voice-mic').fire('click');
    await flush();
    h.sessions[0].onresult({results: [[{transcript: 'открой галерею', confidence: 1}]]});
  }
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(session.size, 0, 'no ticket before leaving');
  beforeLeaving?.(h);
  h.window.fire('pagehide');
  const arrive = (overrides = {}) => harness({speech: true, storage, session,
    navigation: {href: new URL(url, from).href, referrer: from.split('#')[0], ...overrides}});
  return {h, session, storage, arrive};
}

test('requested navigation continues an active Russian dialogue only at its verified destination', async () => {
  const {session, arrive} = await voiceNavigation();
  assert.equal(session.size, 1);
  assert.doesNotMatch([...session.values()][0], /открой|галерею/);
  const destination = arrive();
  assert.equal(destination.get('.artsoul-voice-panel').hidden, false);
  assert.equal(destination.sessions.length, 1);
  assert.equal(destination.sessions[0].lang, 'ru-RU');
  assert.equal(destination.prompts(), 0);
  assert.deepEqual(destination.calls, []);
  assert.equal(session.size, 0);
  assert.equal(arrive().sessions.length, 0, 'a second visit cannot reuse the ticket');
  destination.sessions[0].onerror({error: 'not-allowed'});
  assert.equal(destination.get('.artsoul-voice-chat').attrs['aria-pressed'], 'false');
  assert.match(destination.get('.artsoul-voice-answer').textContent, /Start voice chat/);
  destination.get('.artsoul-voice-chat').fire('click');
  await flush();
  assert.equal(destination.sessions.length, 2, 'one explicit gesture resumes on restricted browsers');
});

test('one-shot, typed, stopped, background and hash-only navigation leave no microphone ticket', async () => {
  for (const options of [{mode: 'typed'}, {mode: 'once'}, {from: 'https://artsoul.test/gallery#auctions'},
    {beforeLeaving: h => h.get('.artsoul-voice-chat').fire('click')},
    {beforeLeaving: h => { h.document.visibilityState = 'hidden'; h.document.fire('visibilitychange'); }}]) {
    const {session} = await voiceNavigation(options);
    assert.equal(session.size, 0);
  }
  const {h} = await voiceNavigation({from: 'https://artsoul.test/gallery#auctions', beforeLeaving: h => {
    assert.equal(h.get('.artsoul-voice-panel').hidden, false);
    assert.deepEqual(h.utterances, []);
    h.runTimers();
    assert.equal(h.sessions.length, 2, 'a hash-only tab transition needs no page transfer');
  }});
  assert.equal(h.get('.artsoul-voice-panel').hidden, true, 'the departing document always closes');
});

test('stale, hidden, mismatched, back-forward and reload visits never turn on a microphone', async () => {
  const {arrive, session} = await voiceNavigation();
  const [key, ticket] = [...session][0];
  for (const mismatch of [{href: 'https://artsoul.test/profile'}, {referrer: 'https://other.test/'},
    {type: 'back_forward'}, {type: 'reload'}, {visibility: 'hidden'}]) {
    session.set(key, ticket);
    assert.equal(arrive(mismatch).sessions.length, 0);
    assert.equal(session.size, 0);
  }
  session.set(key, JSON.stringify({...JSON.parse(ticket), at: Date.now() - 31000}));
  assert.equal(arrive().sessions.length, 0);
});

test('voice navigation waits for the same connected wallet and allows a manual takeover during restoration', async () => {
  const account = '0x' + 'a'.repeat(40);
  for (const next of [account, '0x' + 'b'.repeat(40), 'manual']) {
    const {arrive} = await voiceNavigation({account});
    const h = arrive();
    assert.equal(h.sessions.length, 0);
    if (next === 'manual') h.get('input').fire('input');
    h.connect(next === 'manual' ? account : next);
    assert.equal(h.sessions.length, next === account ? 1 : 0);
  }
});

test('polite Russian and English stop phrases end voice chat in silence', async () => {
  for (const phrase of ['ничего не надо', 'ничего не нужно', 'хватит', 'на этом всё', 'спасибо, пока', 'no thanks', "that's all"]) {
    const h = harness({speech: true});
    h.open(); h.get('.artsoul-voice-chat').fire('click'); await flush();
    h.sessions[0].onresult({results: [[{transcript: phrase, confidence: 1}]]});
    h.runTimers();
    assert.equal(h.get('.artsoul-voice-chat').attrs['aria-pressed'], 'false', phrase);
    assert.deepEqual(h.calls, []); assert.deepEqual(h.spoken, []); assert.equal(h.sessions.length, 1);
  }
});

test('unsuccessful recognition or playback ends voice chat without restarting the microphone', async () => {
  for (const failure of ['consent', 'constructor-error', 'blocked', 'silence', 'audio', 'audio-stalled', 'no-player']) {
    const h = harness({speech: failure === 'constructor-error' ? failure : true, audio: failure.startsWith('audio')});
    if (failure === 'consent') h.window.confirm = () => false;
    h.open(); const chat = h.get('.artsoul-voice-chat'); chat.fire('click'); await flush();
    if (failure === 'blocked') h.sessions[0].onerror({error: 'not-allowed'});
    if (failure === 'silence') h.sessions[0].onend();
    if (failure.startsWith('audio') || failure === 'no-player') {
      h.sessions[0].onresult({results: [[{transcript: 'help'}]]});
      if (failure === 'audio') h.players[0].emit('error');
      if (failure === 'audio-stalled') h.players[0].emit('playing');
    }
    h.runTimers(); await flush();
    assert.equal(chat.attrs['aria-pressed'], 'false', failure);
    assert.equal(h.sessions.length, ['consent', 'constructor-error'].includes(failure) ? 0 : 1, failure);
    if (failure === 'audio-stalled') assert.equal(h.players[0].paused, true);
    assert.equal(h.get('input').disabled, false, failure);
  }
});

test('dynamic account details remain text-only while their fixed summary has no recording', async () => {
  const h = harness({audio: true, execute: async () => JSON.stringify({
    created: {count: 2}, owned: {count: 3}, resale_listings: {count: 1},
    needs_attention: [{artwork_id: '31', tool: 'unknown', why: 'Private account detail visible on screen only'}]
  })});
  h.open(); h.submit('my activity'); await flush();
  const replay = h.get('.artsoul-voice-replay');
  assert.match(h.get('.artsoul-voice-answer').textContent, /Private account detail/);
  assert.equal(replay.disabled, true);
  assert.match(h.get('.artsoul-voice-audio-status').textContent, /no Marin recording/);
  replay.fire('click');
  assert.equal(h.calls.length, 1); assert.equal(h.prompts(), 0); assert.equal(h.sessions.length, 0);
  assert.deepEqual(h.spoken, []); assert.deepEqual(h.plays, []);
});

test('listening to a completed wallet action never submits it again or reads the transaction hash', async () => {
  const hash = '0x' + 'ab'.repeat(32);
  const h = harness({audio: true, execute: async () => JSON.stringify({submitted: true, transaction_hash: hash, url: '/artwork/31'})});
  h.open(); h.submit('buy artwork 31'); await flush();
  h.get('.artsoul-voice-replay').fire('click'); h.players[0].emit('playing'); h.players[0].emit('ended');
  h.get('.artsoul-voice-replay').fire('click');
  assert.equal(h.calls.length, 1); assert.equal(h.get('input').value, '');
  assert.deepEqual(h.plays.map(play => play.src), Array(2).fill('/audio/assistant/v1/en-submitted.wav'));
  assert.deepEqual(h.spoken, []);
});

test('explicit RU selection speaks the recorded Russian answer while keeping the visible reply English', async () => {
  const h = harness({speech: true, audio: true}); h.open(); h.ru.fire('click');
  h.get('.artsoul-voice-mic').fire('click'); await flush();
  h.sessions[0].onresult({results: [[{transcript: 'помощь', confidence: 1}]]}); await flush();
  assert.equal(h.plays[0].src, '/audio/assistant/v1/ru-helpSpeech.wav');
  assert.match(h.get('.artsoul-voice-answer').textContent, /open gallery/);
  assert.equal(h.storage.get('artsoul.voice.reply-lang'), 'ru');
  const replay = h.get('.artsoul-voice-replay');
  assert.equal(replay.textContent, 'Stop audio');
  h.players[0].emit('playing'); h.players[0].emit('ended');
  assert.equal(replay.textContent, 'Listen to answer');
  replay.fire('click'); assert.equal(h.plays[1].src, h.plays[0].src);
  assert.equal(h.sessions.length, 1); assert.equal(h.calls.length, 0); assert.deepEqual(h.spoken, []);
});

test('an unavailable bank fails closed instead of choosing a native voice', async () => {
  const h = harness({audio: true});
  delete h.window.ArtSoulVoicePhraseBank;
  h.open(); h.submit('help'); await flush();
  const replay = h.get('.artsoul-voice-replay');
  assert.equal(replay.disabled, true); replay.fire('click');
  assert.deepEqual(h.plays, []); assert.deepEqual(h.spoken, []);
  assert.match(h.get('.artsoul-voice-answer').textContent, /open gallery/);
  assert.match(h.get('.artsoul-voice-audio-status').textContent, /no Marin recording/);
});

test('an unavailable media player preserves the composer and never calls device speech', async () => {
  const h = harness(); h.open();
  h.window.speechSynthesis.speak = () => assert.fail('Device speech is forbidden');
  h.submit('help'); await flush();
  const replay = h.get('.artsoul-voice-replay');
  assert.equal(replay.disabled, true); replay.fire('click');
  assert.equal(h.get('.artsoul-voice-audio-status').hidden, false);
  assert.equal(h.get('input').disabled, false);
  h.submit('search moon'); await flush(); assert.equal(h.calls.length, 1);
});

test('closing or hiding the page cancels recordings and ignores queued media callbacks', async () => {
  for (const change of ['close', 'hidden']) {
    const h = harness({audio: true}); h.open(); h.submit('help'); await flush();
    const replay = h.get('.artsoul-voice-replay'); replay.fire('click');
    const player = h.players[0], late = [player.onplaying, player.onended, player.onerror];
    player.emit('playing'); const pauses = player.pauseCount;
    if (change === 'close') h.get('.artsoul-voice-close').fire('click');
    else { h.document.visibilityState = 'hidden'; h.document.fire('visibilitychange'); }
    assert.ok(player.pauseCount > pauses);
    assert.equal(player.onplaying, null); assert.equal(player.onended, null); assert.equal(player.onerror, null);
    for (const callback of late) callback({error: 'interrupted'});
    assert.equal(replay.attrs['aria-pressed'], 'false');
    assert.equal(h.get('.artsoul-voice-audio-status').hidden, true);
    replay.fire('click'); assert.equal(h.plays.length, 1); assert.deepEqual(h.spoken, []);
  }
});

test('account, authentication, language and page lifecycle changes clear private dynamic answers', async () => {
  for (const change of ['wallet', 'disconnect', 'auth', 'language', 'pagehide']) {
    const h = harness({audio: true, execute: async () => JSON.stringify({created: {count: 73}})});
    h.connect('0x' + 'a'.repeat(40)); h.open(); h.submit('my activity'); await flush();
    const replay = h.get('.artsoul-voice-replay'); replay.fire('click');
    if (change === 'wallet') h.connect('0x' + 'b'.repeat(40));
    if (change === 'disconnect') h.connect(null);
    if (change === 'auth') h.window.fire('artsoul:auth-state-changed');
    if (change === 'language') h.ru.fire('click');
    if (change === 'pagehide') h.window.fire('pagehide');
    assert.doesNotMatch(h.get('.artsoul-voice-answer').textContent, /73/, change);
    replay.fire('click');
    assert.deepEqual(h.spoken, []); assert.deepEqual(h.plays, []); assert.equal(h.calls.length, 1);
  }
});

test('fixed replies play directly from the click without native synthesis or another command', async () => {
  for (const lang of ['en', 'ru']) {
    const h = harness({audio: true, speech: true});
    delete h.window.speechSynthesis;
    h.open();
    if (lang === 'ru') h.ru.fire('click');
    h.submit(lang === 'ru' ? 'поиск' : 'search'); await flush();
    const replay = h.get('.artsoul-voice-replay');
    const answer = h.get('.artsoul-voice-answer').textContent;
    const clip = h.window.ArtSoulVoice.replyClips.find(entry => entry.lang === 'en' && entry.text === answer);
    assert.ok(clip, 'the exact answer has a prerecorded clip');
    assert.equal(h.plays.length, 0, 'typing remains silent');
    assert.equal(replay.disabled, false, 'a fixed clip does not require native synthesis');
    replay.fire('click');
    assert.equal(h.plays.length, 1, 'play is called in the click stack, before any await');
    assert.equal(h.plays[0].src, h.window.ArtSoulVoice.getReplyAudio(clip.text, lang));
    const player = h.plays[0].player;
    player.emit('playing'); h.plays[0].resolve(); await flush();
    assert.equal(replay.attrs['aria-pressed'], 'true');
    player.emit('ended');
    assert.equal(replay.attrs['aria-pressed'], 'false');
    assert.equal(h.get('.artsoul-voice-audio-status').hidden, true);
    replay.fire('click');
    assert.equal(h.plays.length, 2);
    assert.equal(h.players.length, 1, 'replay reuses the media element');
    assert.equal(h.calls.length, 0); assert.equal(h.sessions.length, 0); assert.equal(h.prompts(), 0);
    assert.equal(h.spoken.length, 0);
  }
});

test('recorded settlement replies preserve submitted versus confirmed state and never repeat payment', async () => {
  for (const lang of ['en', 'ru']) {
    const urls = [];
    for (const confirmed of [false, true]) {
      const result = {submitted: true, confirmed, transaction_hash: '0x' + 'ab'.repeat(32), url: '/artwork/31'};
      const h = harness({audio: true, execute: async () => JSON.stringify(result)});
      h.open(); if (lang === 'ru') h.ru.fire('click');
      h.submit(lang === 'ru' ? 'оплати работу 31' : 'pay for artwork 31'); await flush();
      const answer = h.window.ArtSoulVoice.describeResult('complete_settlement', result, lang);
      const clip = h.window.ArtSoulVoice.replyClips.find(entry => entry.lang === 'en' && entry.text === answer.say);
      assert.ok(clip, `${lang}: ${confirmed ? 'confirmed' : 'submitted'} has its own exact clip`);
      assert.equal(h.plays.length, 0);
      const replay = h.get('.artsoul-voice-replay'); replay.fire('click');
      assert.equal(h.plays[0].src, h.window.ArtSoulVoice.getReplyAudio(clip.text, lang)); urls.push(clip.url);
      h.plays[0].player.emit('playing'); h.plays[0].resolve(); await flush();
      h.plays[0].player.emit('ended'); replay.fire('click');
      assert.equal(h.plays.length, 2); assert.equal(h.plays[1].src, h.window.ArtSoulVoice.getReplyAudio(clip.text, lang));
      assert.deepEqual(h.calls, [{name: 'complete_settlement', args: {artwork_id: '31'}}]);
      assert.equal(h.get('input').value, ''); assert.equal(h.spoken.length, 0);
      assert.doesNotMatch(clip.text, /0x/);
      if (confirmed) assert.match(clip.text, /confirmed.*NFT is yours/);
      else assert.doesNotMatch(clip.text, /NFT is yours|Settlement confirmed/);
      assert.equal(h.get('.artsoul-voice-answer').textContent, answer.show);
    }
    assert.notEqual(urls[0], urls[1], 'submission and settlement cannot share a success recording');
  }
});

test('fixed audio rejection and media errors leave the answer retryable without automatic retries', async () => {
  for (const failure of ['rejected', 'media-error']) {
    const h = harness({audio: true}); h.open(); h.submit('search'); await flush();
    const replay = h.get('.artsoul-voice-replay'), status = h.get('.artsoul-voice-audio-status');
    replay.fire('click');
    const attempt = h.plays[0];
    if (failure === 'rejected') attempt.reject(Object.assign(Error('Gesture required'), {name: 'NotAllowedError'}));
    else attempt.player.emit('error');
    await flush();
    assert.equal(status.hidden, false, failure);
    assert.equal(replay.disabled, false, failure); assert.equal(replay.attrs['aria-pressed'], 'false', failure);
    assert.match(h.get('.artsoul-voice-answer').textContent, /What would you like to find/);
    assert.equal(h.plays.length, 1, failure); assert.equal(h.spoken.length, 0, failure);
    replay.fire('click');
    assert.equal(h.plays.length, 2, 'only a new click retries');
    assert.equal(status.hidden, true); assert.equal(h.calls.length, 0);
    h.plays[1].player.emit('playing'); h.plays[1].resolve(); await flush();
    assert.equal(replay.attrs['aria-pressed'], 'true');
  }
});

test('pending fixed playback can be stopped and its start timeout cannot affect a later attempt', async () => {
  const h = harness({audio: true}); h.open(); h.submit('search'); await flush();
  const replay = h.get('.artsoul-voice-replay'), status = h.get('.artsoul-voice-audio-status');
  replay.fire('click');
  const first = h.plays[0];
  replay.fire('click');
  assert.equal(h.plays.length, 1, 'the second click stops pending playback');
  assert.equal(first.player.paused, true); assert.equal(replay.attrs['aria-pressed'], 'false');
  first.reject(Object.assign(Error('Stopped'), {name: 'AbortError'})); await flush();
  h.runTimers();
  assert.equal(status.hidden, true, 'stopping is not a playback failure');
  replay.fire('click');
  assert.equal(h.plays.length, 2);
  h.runTimers();
  assert.equal(status.hidden, false, 'a player that never starts reports failure');
  assert.equal(h.plays[1].player.paused, true);
  assert.equal(replay.attrs['aria-pressed'], 'false'); assert.equal(replay.disabled, false);
  replay.fire('click');
  const current = h.plays[2]; current.player.emit('playing'); current.resolve(); await flush();
  assert.equal(status.hidden, true); assert.equal(replay.attrs['aria-pressed'], 'true');
  h.runTimers();
  assert.equal(status.hidden, false, 'manual playback also has a bounded stall timeout');
  assert.equal(replay.attrs['aria-pressed'], 'false');
  assert.equal(h.plays.length, 3); assert.equal(h.calls.length, 0); assert.equal(h.spoken.length, 0);
});

test('fixed audio cancellation fences pending promises and stale media events across lifecycle changes', async () => {
  for (const phase of ['pending-resolve', 'pending-reject', 'playing']) {
    for (const change of ['close', 'hidden', 'pagehide', 'language', 'wallet', 'disconnect', 'auth']) {
      const label = `${phase}/${change}`;
      const h = harness({audio: true}); h.connect('0x' + 'a'.repeat(40));
      h.open(); h.submit('search'); await flush();
      const replay = h.get('.artsoul-voice-replay'), status = h.get('.artsoul-voice-audio-status');
      replay.fire('click');
      const attempt = h.plays[0], player = attempt.player;
      const stale = ['onplaying', 'onplay', 'onended', 'onerror'].map(name => player[name]).filter(fn => typeof fn === 'function');
      if (phase === 'playing') {player.emit('playing'); attempt.resolve(); await flush();}
      const pauses = player.pauseCount, loads = player.loadCount;
      if (change === 'close') {h.get('.artsoul-voice-close').fire('click'); h.open();}
      if (change === 'hidden') {
        h.document.visibilityState = 'hidden'; h.document.fire('visibilitychange');
        h.document.visibilityState = 'visible'; h.document.fire('visibilitychange');
      }
      if (change === 'pagehide') {h.window.fire('pagehide'); h.open();}
      if (change === 'language') h.ru.fire('click');
      if (change === 'wallet') h.connect('0x' + 'b'.repeat(40));
      if (change === 'disconnect') h.connect(null);
      if (change === 'auth') h.window.fire('artsoul:auth-state-changed');
      assert.equal(player.paused, true, label);
      assert.ok(player.pauseCount > pauses, label); assert.ok(player.loadCount > loads, label);
      const answer = h.get('.artsoul-voice-answer').textContent;
      const statusBefore = {hidden: status.hidden, text: status.textContent};
      for (const callback of stale) callback({target: player, error: 'interrupted'});
      if (phase === 'pending-reject') attempt.reject(Object.assign(Error('Interrupted'), {name: 'AbortError'}));
      else attempt.resolve();
      await flush();
      assert.equal(replay.attrs['aria-pressed'], 'false', label);
      assert.equal(h.get('.artsoul-voice-answer').textContent, answer, label);
      assert.deepEqual({hidden: status.hidden, text: status.textContent}, statusBefore, label);
      assert.equal(h.plays.length, 1, label); assert.equal(h.spoken.length, 0, label); assert.equal(h.calls.length, 0, label);
    }
  }
});

test('a superseded clip cannot stop a newer reply or report its late playback error', async () => {
  const h = harness({audio: true}); h.open(); h.submit('search'); await flush();
  const replay = h.get('.artsoul-voice-replay'), status = h.get('.artsoul-voice-audio-status');
  replay.fire('click');
  const old = h.plays[0], stale = ['onplaying', 'onplay', 'onended', 'onerror'].map(name => old.player[name]).filter(fn => typeof fn === 'function');
  h.submit('help'); await flush(); replay.fire('click');
  const current = h.plays[1];
  assert.ok(current); assert.notEqual(current.src, old.src);
  current.player.emit('playing'); current.resolve(); await flush();
  for (const callback of stale) callback({target: old.player, error: 'interrupted'});
  old.reject(Object.assign(Error('Interrupted by new reply'), {name: 'AbortError'})); await flush();
  assert.equal(replay.attrs['aria-pressed'], 'true'); assert.equal(status.hidden, true);
  assert.equal(h.plays.length, 2); assert.equal(h.players.length, 1); assert.equal(h.spoken.length, 0);
  current.player.emit('ended');
  assert.equal(replay.attrs['aria-pressed'], 'false'); assert.equal(h.calls.length, 0);
});

test('dynamic replies stay on screen without generic success audio or device fallback', async () => {
  const h = harness({audio: true}); h.open(); h.submit('search moon'); await flush();
  const answer = h.get('.artsoul-voice-answer').textContent;
  const replay = h.get('.artsoul-voice-replay');
  assert.equal(replay.disabled, true); replay.fire('click');
  assert.equal(h.plays.length, 0); assert.deepEqual(h.spoken, []);
  assert.equal(h.get('.artsoul-voice-answer').textContent, answer);
  assert.equal(h.calls.length, 1);
});

test('search results are safe text links and clear on another request or account change', async () => {
  const data = structuredClone(searchResult);
  data.groups.artworks.items = [
    {title: '<img src=x onerror=alert(1)>', artwork_id: '34', creator: 'Vera', url: '/artwork/34'},
    {title: 'Unsafe', artwork_id: '35', url: 'https://evil.test/'},
    {title: 'Script', artwork_id: '36', url: 'javascript:alert(1)'}
  ];
  const h = harness({execute: async () => JSON.stringify(data)}); h.open(); h.submit('search moon'); await flush();
  const results = h.get('.artsoul-voice-results');
  assert.equal(results.children.length, 1);
  assert.equal(results.children[0].href, '/artwork/34');
  assert.match(results.children[0].textContent, /<img/);
  assert.equal(results.children[0].innerHTML, undefined);
  h.submit('help'); await flush(); assert.equal(results.children.length, 0);
  h.submit('search moon'); await flush(); assert.equal(results.children.length, 1);
  h.connect('0x' + 'a'.repeat(40)); assert.equal(results.children.length, 0);
});

test('missing search terms request clarification without fetching or opening a wallet', async () => {
  const h = harness(); h.open(); h.submit('search'); await flush();
  assert.match(h.get('.artsoul-voice-answer').textContent, /What would you like to find/);
  assert.equal(h.calls.length, 0); assert.equal(h.prompts(), 0);
});

test('an unrecognized command offers an optional local support link without contacting anyone', async () => {
  const h = harness(); h.open(); h.submit('My question has no command'); await flush();
  assert.match(h.get('.artsoul-voice-answer').textContent, /didn’t recognize that command/);
  const results = h.get('.artsoul-voice-results');
  assert.deepEqual(results.children.map(link => [link.textContent, link.href]), [['Help and contact', '/docs-protocol#support']]);
  assert.equal(h.get('.artsoul-voice-panel').hidden, false);
  assert.equal(h.calls.length, 0); assert.equal(h.prompts(), 0);
  results.children[0].fire('click', {button: 0, preventDefault() {assert.fail('keep native link navigation');}});
  assert.equal(h.get('.artsoul-voice-panel').hidden, true);
});

test('page and documentation command links allow only public routes and safe section anchors', async () => {
  const data = structuredClone(searchResult);
  data.groups.artworks.items = [];
  const allowed = ['/', '/gallery', '/upload', '/profile', '/docs-protocol', '/docs-protocol#fees', '/docs-protocol#what-is-artsoul'];
  const rejected = ['/admin', '/profile?email=private@example.test', '/gallery?redirect=/admin', '/docs-protocol#fees<script>',
    '/docs-protocol#../admin', '/docs-protocol/../admin', '//evil.test/docs-protocol', 'https://evil.test/docs-protocol#fees',
    'javascript:alert(1)', '/docs-protocol%23fees', '/docs-protocol#fees\n'];
  data.category = 'docs';
  data.groups.pages = {items: allowed.slice(0, 5).map(url => ({title: 'Public page', url})), hasMore: false};
  data.groups.docs = {items: [...allowed.slice(5), ...rejected].map(url => ({title: '<img onerror=alert(1)>', url})), hasMore: false};
  data.warning = 'Catalog unavailable';
  const h = harness({execute: async () => JSON.stringify(data)}); h.open(); h.submit('search docs fees'); await flush();
  const results = h.get('.artsoul-voice-results');
  assert.deepEqual(h.calls, [{name: 'search_catalog', args: {query: 'fees', category: 'docs'}}]);
  assert.deepEqual(results.children.map(link => link.href), allowed);
  assert.match(results.children[5].textContent, /<img onerror=alert\(1\)>/);
  assert.equal(results.children[5].innerHTML, undefined);
  assert.match(h.get('.artsoul-voice-answer').textContent, /Only matching pages and documentation/);
  assert.equal(h.prompts(), 0);
});

test('a normal docs result activation closes commands once and preserves native hash navigation', async () => {
  const data = structuredClone(searchResult); data.groups.artworks.items = [];
  data.groups.docs = {items: [{title: 'Fees', url: '/docs-protocol#fees'}], hasMore: false};
  const h = harness({execute: async () => JSON.stringify(data)}); h.open(); h.submit('search docs fees'); await flush();
  const link = h.get('.artsoul-voice-results').children[0], launcher = h.get('.artsoul-voice-button');
  let closes = 0;
  const focus = launcher.focus; launcher.focus = () => {closes++; focus.call(launcher);};
  const event = {button: 0, detail: 0,
    preventDefault() {assert.fail('Native hash navigation must remain available');},
    stopPropagation() {assert.fail('The docs page must receive the repeated-anchor click');}};
  link.fire('click', event);
  assert.equal(h.get('.artsoul-voice-panel').hidden, true);
  assert.equal(launcher.attrs['aria-expanded'], 'false'); assert.equal(h.document.activeElement, launcher);
  assert.equal(link.href, '/docs-protocol#fees'); assert.equal(closes, 1);
  link.fire('click', event); assert.equal(closes, 1, 'an already hidden panel is not closed again');
  assert.deepEqual(h.calls, [{name: 'search_catalog', args: {query: 'fees', category: 'docs'}}]);
  assert.equal(h.prompts(), 0); assert.equal(h.sessions.length, 0);
});

test('new-tab, modified, download and prevented result clicks leave the command panel open', async () => {
  const h = harness(); h.open(); h.submit('search moon'); await flush();
  const link = h.get('.artsoul-voice-results').children[0];
  for (const flags of [{ctrlKey: true}, {metaKey: true}, {shiftKey: true}, {altKey: true}, {button: 1}, {defaultPrevented: true}]) {
    link.fire('click', {button: 0, ...flags});
    assert.equal(h.get('.artsoul-voice-panel').hidden, false);
  }
  link.target = '_blank'; link.fire('click', {button: 0});
  assert.equal(h.get('.artsoul-voice-panel').hidden, false);
  link.target = ''; link.setAttribute('download', ''); link.fire('click', {button: 0});
  assert.equal(h.get('.artsoul-voice-panel').hidden, false);
  assert.equal(h.calls.length, 1); assert.equal(h.prompts(), 0);
});

test('completed requests restore focus lost when Send was disabled, without stealing external focus', async () => {
  for (const lost of [true, false]) {
    let finish; const h = harness({execute: () => new Promise(resolve => {finish = resolve;})});
    h.open(); h.submit('search moon');
    const previous = lost ? h.document.body : {};
    h.document.activeElement = previous;
    finish(JSON.stringify(searchResult)); await flush();
    assert.equal(h.document.activeElement, lost ? h.get('input') : previous);
  }
});

test('typed favorites commands show confirmed state while low-confidence speech and late account answers are fenced', async () => {
  const h = harness({speech: true, execute: async () => JSON.stringify({updated: true, artwork_id: '34', saved: true})});
  h.open(); h.submit('save artwork 34'); await flush();
  assert.deepEqual(h.calls, [{name: 'add_to_saved', args: {artwork_id: '34'}}]);
  assert.equal(h.get('.artsoul-voice-answer').textContent, 'Artwork 34 is in Favorites.');
  assert.equal(h.spoken.length, 0); assert.equal(h.sessions.length, 0);
  h.get('.artsoul-voice-mic').fire('click'); await flush();
  h.sessions[0].onresult({results: [[{transcript: 'remove artwork 34 from saved', confidence: .2}]]}); await flush();
  assert.equal(h.calls.length, 1);
  let finish;
  const late = harness({execute: () => new Promise(resolve => {finish = resolve;})});
  late.connect('0x' + 'a'.repeat(40)); late.open(); late.submit('remove artwork 34 from saved');
  late.connect('0x' + 'b'.repeat(40));
  finish(JSON.stringify({updated: true, artwork_id: '34', saved: false})); await flush();
  assert.doesNotMatch(late.get('.artsoul-voice-answer').textContent, /34|removed/);
});

test('double submit and closing/reopening cannot replay an in-flight wallet request', async () => {
  let finish; const h = harness({execute: () => new Promise(resolve => {finish = resolve;})});
  assert.equal(h.get('.artsoul-voice-send').dataset.allowRapid, 'true', 'native form submission bypasses the global capture guard');
  h.open(); h.submit('buy artwork 31'); h.submit('buy artwork 31');
  assert.equal(h.calls.length, 1); assert.equal(h.get('input').disabled, true);
  h.get('.artsoul-voice-close').fire('click'); h.open(); h.submit('buy artwork 31');
  assert.equal(h.calls.length, 1);
  finish(JSON.stringify({submitted: false, reason: 'Declined in wallet'})); await flush();
  assert.equal(h.get('input').disabled, false);
  assert.equal(h.get('.artsoul-voice-answer').textContent, 'Declined in wallet');
});

test('successful wallet actions clear the composer and offer safe next steps without replay', async () => {
  const hash = '0x' + 'ab'.repeat(32);
  const h = harness({execute: async () => JSON.stringify({submitted: true, transaction_hash: hash, url: '/artwork/31'})});
  h.open(); h.submit('buy artwork 31'); await flush();
  assert.equal(h.get('input').value, '');
  assert.match(h.get('input').placeholder, /next/);
  assert.equal(h.get('.artsoul-voice-send').disabled, true);
  assert.deepEqual(h.get('.artsoul-voice-results').children.map(link => link.href), ['/artwork/31', `https://sepolia.basescan.org/tx/${hash}`]);
  assert.equal(h.get('.artsoul-voice-results').children[1].rel, 'noopener noreferrer');
  h.get('form').fire('submit'); await flush(); assert.equal(h.calls.length, 1);
  h.get('input').value = 'my activity'; h.get('input').fire('input');
  assert.equal(h.get('.artsoul-voice-send').disabled, false);
});

test('declined and failed wallet commands retain the draft for an explicit retry', async () => {
  for (const result of [{submitted: false, reason: 'Declined'}, {error: 'Network unavailable'}]) {
    const h = harness({execute: async () => JSON.stringify(result)});
    h.open(); h.submit('buy artwork 31'); await flush();
    assert.equal(h.get('input').value, 'buy artwork 31');
    assert.equal(h.get('.artsoul-voice-send').disabled, false);
    assert.equal(h.get('.artsoul-voice-results').children.length, 0);
  }
});

test('a late response does not reopen a closed panel or speak after closing', async () => {
  let finish; const h = harness({speech: true, execute: () => new Promise(resolve => {finish = resolve;})});
  h.open(); h.get('.artsoul-voice-mic').fire('click'); await flush();
  h.sessions[0].onresult({results: [[{transcript: 'search moon', confidence: 1}]]});
  h.get('.artsoul-voice-close').fire('click');
  finish(JSON.stringify(searchResult)); await flush();
  assert.equal(h.get('.artsoul-voice-panel').hidden, true); assert.equal(h.spoken.length, 0);
  assert.equal(h.document.activeElement, h.get('.artsoul-voice-button'));
});

test('closing and reopening does not restore permission to speak an old pending answer', async () => {
  let finish; const h = harness({speech: true, execute: () => new Promise(resolve => {finish = resolve;})});
  h.open(); h.get('.artsoul-voice-mic').fire('click'); await flush();
  h.sessions[0].onresult({results: [[{transcript: 'search moon', confidence: 1}]]});
  h.get('.artsoul-voice-close').fire('click'); h.open();
  finish(JSON.stringify(searchResult)); await flush();
  assert.equal(h.spoken.length, 0);
  assert.match(h.get('.artsoul-voice-answer').textContent, /Shown: Artworks: 1/);
});

test('long typed or spoken requests are rejected, never truncated into a wallet action', async () => {
  const phrase = 'buy artwork 31'.padEnd(300, ' ') + ' and withdraw';
  const h = harness({speech: true}); h.open(); h.submit(phrase); await flush();
  assert.equal(h.calls.length, 0);
  h.get('.artsoul-voice-mic').fire('click'); await flush();
  h.sessions[0].onresult({results: [[{transcript: phrase, confidence: 1}]]}); await flush();
  assert.equal(h.calls.length, 0);
  assert.match(h.get('.artsoul-voice-answer').textContent, /300/);
});

test('aborted or stale speech callbacks never execute commands or reopen the panel', async () => {
  for (const cancel of ['close', 'hidden', 'pagehide', 'language']) {
    const h = harness({speech: true}); h.open(); h.get('.artsoul-voice-mic').fire('click'); await flush();
    const session = h.sessions[0], late = session.onresult, ended = session.onend;
    if (cancel === 'close') h.get('.artsoul-voice-close').fire('click');
    if (cancel === 'hidden') {h.document.visibilityState = 'hidden'; h.document.fire('visibilitychange');}
    if (cancel === 'pagehide') h.window.fire('pagehide');
    if (cancel === 'language') h.ru.fire('click');
    late({results: [[{transcript: 'buy artwork 31', confidence: 1}]]}); ended();
    assert.equal(session.aborted, true, cancel); assert.equal(h.calls.length, 0, cancel);
    assert.equal(session.onresult, null, cancel);
  }
});

test('wallet changes, disconnect, logout and BFCache remove prior input and ignore late private answers', async () => {
  for (const change of ['wallet', 'disconnect', 'auth', 'pagehide']) {
    let finish; const h = harness({execute: () => new Promise(resolve => {finish = resolve;})});
    h.connect('0x' + 'a'.repeat(40)); h.open(); h.submit('my activity');
    if (change === 'wallet') h.connect('0x' + 'b'.repeat(40));
    if (change === 'disconnect') h.connect(null);
    if (change === 'auth') h.window.fire('artsoul:auth-state-changed');
    if (change === 'pagehide') h.window.fire('pagehide');
    assert.equal(h.get('input').value, '', change);
    finish(JSON.stringify({error: 'previous account private answer'})); await flush();
    assert.doesNotMatch(h.get('.artsoul-voice-answer').textContent, /private answer/, change);
    assert.equal(h.get('input').disabled, false, change);
  }
});

test('microphone is explicit, low-confidence wallet requests are refused, reads remain available', async () => {
  const h = harness({speech: true}); h.open(); h.get('.artsoul-voice-mic').fire('click'); await flush();
  assert.equal(h.prompts(), 1); assert.equal(h.sessions[0].continuous, false);
  h.sessions[0].onresult({results: [[{transcript: 'buy artwork 31', confidence: .2}]]}); await flush();
  assert.equal(h.calls.length, 0); assert.match(h.get('.artsoul-voice-answer').textContent, /not sure/);
  h.get('.artsoul-voice-mic').fire('click'); await flush();
  h.sessions[1].onresult({results: [[{transcript: 'search moon', confidence: .2}]]}); await flush();
  assert.equal(h.calls.length, 1); assert.equal(h.prompts(), 1);
});

test('microphone denial leaves text usable and a failed tool can be retried deliberately', async () => {
  const h = harness({speech: true, execute: async () => {throw Error('Request unavailable');}});
  h.open(); h.get('.artsoul-voice-mic').fire('click'); await flush(); h.sessions[0].onerror({error: 'not-allowed'});
  assert.match(h.get('.artsoul-voice-answer').textContent, /blocked/);
  h.submit('search moon'); await flush(); assert.equal(h.get('input').disabled, false);
  assert.equal(h.get('input').value, 'search moon'); h.submit('search moon'); await flush();
  assert.equal(h.calls.length, 2); assert.equal(h.spoken.length, 0);
});

test('Escape restores launcher focus; untrusted text stays text, never markup', async () => {
  const h = harness(); h.open(); h.submit('<img src=x onerror=alert(1)>'); await flush();
  assert.match(h.get('.artsoul-voice-heard').textContent, /<img/);
  assert.match(h.get('.artsoul-voice-answer').textContent, /open NFTs/);
  assert.equal(h.calls.length, 0);
  h.get('.artsoul-voice-panel').fire('keydown', {key: 'Escape'});
  assert.equal(h.get('.artsoul-voice-panel').hidden, true);
  assert.equal(h.get('.artsoul-voice-button').attrs['aria-expanded'], 'false');
  assert.equal(h.document.activeElement, h.get('.artsoul-voice-button'));
});

test('financial commands reject negation, questions, compound actions and truncated arguments', () => {
  const api = harness().window.ArtSoulVoice;
  for (const [lang, phrases] of [
    ['en', ['do not buy artwork 31', 'can you buy artwork 31', 'buy artwork 31 and withdraw', 'buy artwork 31 for 0.2.3', 'pay not for artwork 31', 'bid 0.01 on artwork 31 or 32', 'withdraw then buy artwork 1']],
    ['ru', ['не купи работу 31', 'не надо оплати работу 31', 'купи работу 31 и выведи деньги', 'оплати не работу 31', 'ставка 0,01 на работу 31 или 32', 'выведи деньги завтра']]
  ]) for (const phrase of phrases) assert.equal(api.isWrite(api.parseCommand(phrase, lang)), false, phrase);
  assert.deepEqual(api.parseCommand('search buy artwork 31', 'en'), {tool: 'search_catalog', input: {query: 'buy artwork 31'}});
  assert.deepEqual(api.parseCommand('найди аукцион', 'ru'), {tool: 'search_catalog', input: {query: 'аукцион'}});
  assert.equal(api.parseCommand('grant admin to wallet', 'en'), null);
});

test('audio waits for resolved consent, ignores duplicate clicks and renews legacy permission', async () => {
  const h = harness({speech: true}); let finish, prompts = 0;
  h.storage.set('artsoul.voice.notice', 'accepted');
  h.window.confirm = () => {prompts++; return new Promise(resolve => {finish = resolve;});};
  h.open(); h.get('.artsoul-voice-mic').fire('click'); await flush();
  assert.equal(prompts, 1); assert.equal(h.sessions.length, 0);
  assert.equal(h.get('input').disabled, true);
  assert.equal(h.get('.artsoul-voice-mic').disabled, true);
  h.get('.artsoul-voice-mic').fire('click'); h.submit('buy artwork 31');
  assert.equal(prompts, 1); assert.equal(h.calls.length, 0);
  finish(true); await flush();
  assert.equal(h.sessions.length, 1); assert.equal(h.sessions[0].started, true);
  assert.equal(h.storage.get('artsoul.voice.notice.v2'), 'accepted');
  h.get('.artsoul-voice-close').fire('click'); h.open();
  assert.equal(h.sessions[0].aborted, true); assert.equal(h.sessions.length, 1);
  h.get('.artsoul-voice-mic').fire('click'); await flush();
  assert.equal(h.sessions.length, 2); assert.equal(prompts, 1);
});

test('declined, malformed and failed audio consent never starts recognition or persists approval', async () => {
  for (const outcome of [false, undefined, 'true', new Error('dialog unavailable')]) {
    const h = harness({speech: true});
    h.window.confirm = async () => {if (outcome instanceof Error) throw outcome; return outcome;};
    h.open(); h.get('.artsoul-voice-mic').fire('click'); await flush();
    assert.equal(h.sessions.length, 0);
    assert.equal(h.storage.has('artsoul.voice.notice.v2'), false);
    assert.equal(h.get('input').disabled, false); assert.equal(h.get('.artsoul-voice-mic').disabled, false);
    h.submit('help'); await flush(); assert.equal(h.calls.length, 0);
    h.window.confirm = async () => true;
    h.get('.artsoul-voice-mic').fire('click'); await flush();
    assert.equal(h.sessions.length, 1, 'an explicit retry can succeed');
  }
});

test('late audio approval is discarded after closing, tab lifecycle, language or account changes', async () => {
  for (const change of ['close', 'hidden', 'pagehide', 'language', 'wallet', 'disconnect', 'auth']) {
    const h = harness({speech: true}); let finish;
    h.connect('0x' + 'a'.repeat(40));
    h.window.confirm = () => new Promise(resolve => {finish = resolve;});
    h.open(); h.get('.artsoul-voice-mic').fire('click');
    if (change === 'close') {h.get('.artsoul-voice-close').fire('click'); h.open();}
    if (change === 'hidden') {
      h.document.visibilityState = 'hidden'; h.document.fire('visibilitychange');
      h.document.visibilityState = 'visible'; h.document.fire('visibilitychange');
    }
    if (change === 'pagehide') {h.window.fire('pagehide'); h.open();}
    if (change === 'language') h.ru.fire('click');
    if (change === 'wallet') h.connect('0x' + 'b'.repeat(40));
    if (change === 'disconnect') h.connect(null);
    if (change === 'auth') h.window.fire('artsoul:auth-state-changed');
    finish(true); await flush();
    assert.equal(h.sessions.length, 0, change);
    assert.equal(h.storage.has('artsoul.voice.notice.v2'), false, change);
    assert.equal(h.get('input').disabled, false, change);
  }
});
