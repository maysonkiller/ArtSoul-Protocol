const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('voice-commands.js', 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const searchResult = { category: 'all', groups: {
  artworks: {items: [{title: 'Moon', artwork_id: '31', creator: 'Vera', url: '/artwork/31'}], hasMore: false},
  auctions: {items: [], hasMore: false}, artists: {items: [], hasMore: false}
}};

function harness({speech = false, execute = async () => JSON.stringify(searchResult)} = {}) {
  const nodes = new Map(), calls = [], sessions = [], spoken = [], storage = new Map();
  let prompts = 0;
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
  const en = document.createElement(), ru = document.createElement(); en.dataset.lang = 'en'; ru.dataset.lang = 'ru';
  class Recognition {
    constructor() { sessions.push(this); }
    start() { this.started = true; }
    abort() { this.aborted = true; this.onend?.(); }
  }
  const window = {...events(), setTimeout: fn => fn(),
    localStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)},
    confirm: () => {prompts++; return true;},
    speechSynthesis: {cancel() {}, speak: value => spoken.push(value.text)},
    ArtSoulWebMCP: {browserDependencies: () => ({}), createTools: () => ['search_catalog', 'buy_resale_listing', 'get_my_activity', 'add_to_saved', 'remove_from_saved'].map(name => ({name,
      execute: args => {calls.push({name, args}); return execute(args);}
    }))}
  };
  if (speech) window.SpeechRecognition = Recognition;
  new Function('window', 'document', 'navigator', 'SpeechSynthesisUtterance', source)(window, document, {language: 'en'}, function(text) {this.text = text;});
  const get = selector => nodes.get(selector);
  return {get, document, window, calls, sessions, spoken, en, ru, storage,
    prompts: () => prompts,
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
  h.ru.fire('click'); assert.equal(h.get('h2').textContent, 'Команды ArtSoul');
  h.submit('помощь'); await flush();
  assert.equal(h.calls.length, 0); assert.equal(h.sessions.length, 0); assert.equal(h.prompts(), 0);
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
  assert.equal(h.get('.artsoul-voice-answer').textContent, 'Artwork 34 is in Saved.');
  assert.equal(h.spoken.length, 0); assert.equal(h.sessions.length, 0);
  h.get('.artsoul-voice-mic').fire('click');
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

test('a late response does not reopen a closed panel or speak after closing', async () => {
  let finish; const h = harness({speech: true, execute: () => new Promise(resolve => {finish = resolve;})});
  h.open(); h.get('.artsoul-voice-mic').fire('click');
  h.sessions[0].onresult({results: [[{transcript: 'search moon', confidence: 1}]]});
  h.get('.artsoul-voice-close').fire('click');
  finish(JSON.stringify(searchResult)); await flush();
  assert.equal(h.get('.artsoul-voice-panel').hidden, true); assert.equal(h.spoken.length, 0);
  assert.equal(h.document.activeElement, h.get('.artsoul-voice-button'));
});

test('closing and reopening does not restore permission to speak an old pending answer', async () => {
  let finish; const h = harness({speech: true, execute: () => new Promise(resolve => {finish = resolve;})});
  h.open(); h.get('.artsoul-voice-mic').fire('click');
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
  h.get('.artsoul-voice-mic').fire('click');
  h.sessions[0].onresult({results: [[{transcript: phrase, confidence: 1}]]}); await flush();
  assert.equal(h.calls.length, 0);
  assert.match(h.get('.artsoul-voice-answer').textContent, /300/);
});

test('aborted or stale speech callbacks never execute commands or reopen the panel', () => {
  for (const cancel of ['close', 'hidden', 'pagehide', 'language']) {
    const h = harness({speech: true}); h.open(); h.get('.artsoul-voice-mic').fire('click');
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
  const h = harness({speech: true}); h.open(); h.get('.artsoul-voice-mic').fire('click');
  assert.equal(h.prompts(), 1); assert.equal(h.sessions[0].continuous, false);
  h.sessions[0].onresult({results: [[{transcript: 'buy artwork 31', confidence: .2}]]}); await flush();
  assert.equal(h.calls.length, 0); assert.match(h.get('.artsoul-voice-answer').textContent, /not sure/);
  h.get('.artsoul-voice-mic').fire('click');
  h.sessions[1].onresult({results: [[{transcript: 'search moon', confidence: .2}]]}); await flush();
  assert.equal(h.calls.length, 1); assert.equal(h.prompts(), 1);
});

test('microphone denial leaves text usable and a failed tool can be retried deliberately', async () => {
  const h = harness({speech: true, execute: async () => {throw Error('Request unavailable');}});
  h.open(); h.get('.artsoul-voice-mic').fire('click'); h.sessions[0].onerror({error: 'not-allowed'});
  assert.match(h.get('.artsoul-voice-answer').textContent, /blocked/);
  h.submit('search moon'); await flush(); assert.equal(h.get('input').disabled, false);
  assert.equal(h.get('input').value, 'search moon'); h.submit('search moon'); await flush();
  assert.equal(h.calls.length, 2); assert.equal(h.spoken.length, 0);
});

test('Escape restores launcher focus; untrusted text stays text, never markup', async () => {
  const h = harness(); h.open(); h.submit('<img src=x onerror=alert(1)>'); await flush();
  assert.match(h.get('.artsoul-voice-answer').textContent, /<img/); assert.equal(h.calls.length, 0);
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
