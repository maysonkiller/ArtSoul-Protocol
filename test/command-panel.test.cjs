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
  assert.equal(h.get('.artsoul-voice-answer').textContent, 'Artwork 34 is in Saved.');
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
