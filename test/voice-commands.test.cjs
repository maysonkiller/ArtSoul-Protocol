// B-09: voice commands, decided by the founder on 2026-09-15.
//
// Voice adds no ability of its own. It turns one spoken sentence into one of the
// agent tools and says the answer, so everything below tests one of three things:
// that a sentence reaches the right tool with the right figures, that a misheard
// sentence cannot cost money, and that the microphone and the audio stay where
// the person was told they would.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('voice-commands.js', 'utf8');
const agentSource = fs.readFileSync('webmcp-tools.js', 'utf8');

function loadVoice(win = {}) {
  new Function('window', 'document', 'navigator', source)(win, undefined, {});
  return win.ArtSoulVoice;
}

const voice = loadVoice();
const parse = (text, lang = 'en') => voice.parseCommand(text, lang);

test('global search keeps query text as data, supports public categories and asks for a missing query', () => {
  for (const [lang, phrase, input] of [
    ['en', 'Find artists Vera', {query: 'Vera', category: 'artists'}],
    ['en', 'search artworks Moon 🌙', {query: 'Moon 🌙', category: 'artworks'}],
    ['en', 'look for auctions Moon', {query: 'Moon', category: 'auctions'}],
    ['en', 'find artwork 34', {query: 'artwork 34'}],
    ['en', 'search buy artwork 34 & category=artists', {query: 'buy artwork 34 & category=artists'}],
    ['ru', 'найди автора Vera', {query: 'Vera', category: 'artists'}],
    ['ru', 'найди работы Луна', {query: 'Луна', category: 'artworks'}],
    ['ru', 'найди аукционы Луна', {query: 'Луна', category: 'auctions'}],
    ['ru', 'найди убери работу 34 из избранного', {query: 'убери работу 34 из избранного'}]
  ]) {
    assert.deepEqual(parse(phrase, lang), {tool: 'search_catalog', input});
    assert.equal(voice.isWrite(parse(phrase, lang)), false);
  }
  assert.deepEqual(parse('search'), {searchPrompt: true});
  assert.deepEqual(parse('найди', 'ru'), {searchPrompt: true});
});

test('global search distinguishes grouped matches shown from totals and does not speak user metadata', () => {
  const wallet = '0x' + 'a'.repeat(40);
  const result = {category: 'all', groups: {
    artworks: {items: [{title: '<img src=x>', artwork_id: '34', creator: 'Vera', url: '/artwork/34'}], hasMore: true},
    auctions: {items: [], hasMore: false},
    artists: {items: [{name: 'Vera', wallet_address: wallet, url: '/profile?address=' + wallet}], hasMore: false}
  }};
  const reply = voice.describeResult('search_catalog', result, 'en');
  assert.match(reply.show, /Shown: Artworks: 1 · Artists: 1/);
  assert.match(reply.show, /More matches/);
  assert.doesNotMatch(reply.say, /Vera|0x|img/);
  assert.equal(reply.links.length, 2);
  assert.match(reply.links[1].label, /0xaaaa/);
  assert.match(voice.describeResult('search_catalog', result, 'ru').show, /Показано: Работы: 1/);
  for (const group of Object.values(result.groups)) {group.items = []; group.hasMore = false;}
  assert.match(voice.describeResult('search_catalog', result, 'en').show, /No matches/);
  assert.match(voice.describeResult('search_catalog', {error: 'Search unavailable'}, 'en').show, /unavailable/);
});

test('explicit English and Russian favorites commands express a desired state', () => {
  for (const [lang, verb, cases] of [
    ['en', 'add_to_saved', ['save artwork 34', 'please add work #34 to favorites', 'add 34 to my favourites', 'save 34 to Saved']],
    ['en', 'remove_from_saved', ['remove artwork 34 from favorites', 'please remove #34 from my saved']],
    ['ru', 'add_to_saved', ['добавь работу 34 в избранное', 'сохрани артворк #34 в избранное']],
    ['ru', 'remove_from_saved', ['убери работу 34 из избранного', 'пожалуйста, удали 34 из избранного']]
  ]) for (const said of cases) {
    assert.deepEqual(parse(said, lang), { tool: verb, input: { artwork_id: '34' } }, said);
    assert.equal(voice.isWrite(parse(said, lang)), false, 'preference is not a chain action');
    assert.equal(voice.mayRun(parse(said, lang), .2), false, 'misheard preference cannot run');
    assert.equal(voice.mayRun(parse(said, lang), .9), true);
  }
});

test('Saved grammar rejects negation, questions, multiple targets and invalid numbers', () => {
  const cases = {
    en: ['do not save artwork 34', 'do not remove artwork 34 from saved', 'can you save artwork 34', 'save artwork 34?',
      'save artwork 34 and 35', 'save artwork 34 and remove artwork 35 from saved', 'save it', 'add 34',
      'save artwork 0', 'save artwork 034', 'save artwork -1', 'save artwork 1.5', `save artwork ${2n ** 256n}`, 'save auction 66'],
    ru: ['не добавь работу 34 в избранное', 'не убери работу 34 из избранного', 'добавить работу 34 в избранное?',
      'добавь работу 34 и 35 в избранное', 'убери работу 34 из избранного и купи работу 34', 'добавь её в избранное',
      'добавь работу 0 в избранное', 'убери работу 034 из избранного', 'убери аукцион 66 из избранного']
  };
  for (const [lang, commands] of Object.entries(cases)) for (const said of commands) {
    assert.ok(!['add_to_saved', 'remove_from_saved'].includes(parse(said, lang)?.tool), said);
  }
  assert.deepEqual(parse('search save artwork 34'), { tool: 'search_catalog', input: { query: 'save artwork 34' } });
});

test('Saved replies report only server-confirmed results, never a wallet transaction', () => {
  for (const lang of ['en', 'ru']) for (const saved of [true, false]) {
    const reply = voice.describeResult(saved ? 'add_to_saved' : 'remove_from_saved', { updated: true, artwork_id: '34', saved }, lang);
    assert.match(reply.show, /34/);
    assert.doesNotMatch(reply.show, /transaction|транзакц/);
  }
  assert.equal(voice.describeResult('add_to_saved', { updated: false, reason: 'Sign in first.' }, 'en').show, 'Sign in first.');
  assert.match(voice.describeResult('add_to_saved', {}, 'en').show, /could not be confirmed/);
});

test('English sentences reach the tool they mean, with the figures they said', () => {
  const cases = [
    ['what auctions are open right now?', 'find_active_auctions', {}],
    ['tell me about artwork 31', 'get_artwork', { artwork_id: '31' }],
    ['who owns artwork 19', 'get_artwork_provenance', { artwork_id: '19' }],
    ['what is the status of artwork 31', 'get_auction_state', { artwork_id: '31' }],
    ['my activity', 'get_my_activity', {}],
    ['open artwork 31', 'open_artwork', { artwork_id: '31' }],
    ['search moon', 'search_catalog', { query: 'moon' }],
    ['place a bid of 0.05 on artwork 31', 'place_bid', { artwork_id: '31', bid_eth: '0.05' }],
    ['bid 0.05 eth on 31', 'place_bid', { artwork_id: '31', bid_eth: '0.05' }],
    ['pay for artwork 30', 'complete_settlement', { artwork_id: '30' }],
    ['close the expired settlement on artwork 30', 'close_expired_settlement', { artwork_id: '30' }],
    ['end the auction on artwork 31', 'end_expired_auction', { artwork_id: '31' }],
    ['start an auction on artwork 31 at 0.005 for 36 hours', 'start_auction', { artwork_id: '31', start_price_eth: '0.005', duration_hours: 36 }],
    ['list artwork 19 for 0.002', 'list_for_resale', { artwork_id: '19', price_eth: '0.002' }],
    ['buy artwork 19', 'buy_resale_listing', { artwork_id: '19' }],
    ['buy artwork 19 for 0.0011', 'buy_resale_listing', { artwork_id: '19', expected_price_eth: '0.0011' }],
    ['withdraw my money', 'withdraw_pending_funds', {}],
    ['stop using my wallet', 'revoke_wallet_access', {}]
  ];
  for (const [said, tool, input] of cases) {
    assert.deepEqual({ ...parse(said) }, { tool, input }, said);
  }
});

test('Russian sentences reach the same tools, and a spoken comma is a decimal point', () => {
  const cases = [
    ['какие аукционы открыты', 'find_active_auctions', {}],
    ['расскажи о работе 31', 'get_artwork', { artwork_id: '31' }],
    ['кто владелец работы 19', 'get_artwork_provenance', { artwork_id: '19' }],
    ['мой профиль', 'get_my_activity', {}],
    ['открой работу 31', 'open_artwork', { artwork_id: '31' }],
    ['найди луна', 'search_catalog', { query: 'луна' }],
    ['поставь ставку 0,05 на работу 31', 'place_bid', { artwork_id: '31', bid_eth: '0.05' }],
    ['оплати работу 30', 'complete_settlement', { artwork_id: '30' }],
    ['закрой расчёт по работе 30', 'close_expired_settlement', { artwork_id: '30' }],
    ['заверши аукцион по работе 31', 'end_expired_auction', { artwork_id: '31' }],
    ['запусти аукцион на работу 31 за 0,005 на 36 часов', 'start_auction', { artwork_id: '31', start_price_eth: '0.005', duration_hours: 36 }],
    ['выстави работу 19 за 0,002', 'list_for_resale', { artwork_id: '19', price_eth: '0.002' }],
    ['купи работу 19', 'buy_resale_listing', { artwork_id: '19' }],
    ['выведи деньги', 'withdraw_pending_funds', {}],
    ['стоп, не трогай кошелёк', 'revoke_wallet_access', {}]
  ];
  for (const [said, tool, input] of cases) {
    assert.deepEqual({ ...parse(said, 'ru') }, { tool, input }, said);
  }
});

test('a wallet command never guesses which work or which amount', () => {
  // Every write needs its work named; a bid and a listing need their figure.
  for (const said of ['buy it', 'pay for it', 'bid on artwork 31', 'bid 0.05', 'list artwork 19', 'end the auction', 'close the settlement']) {
    const command = parse(said);
    assert.ok(!command || !voice.isWrite(command), `"${said}" must not become a wallet command`);
  }
  for (const said of ['купи её', 'оплати', 'поставь ставку на 31', 'выстави работу 19']) {
    const command = parse(said, 'ru');
    assert.ok(!command || !voice.isWrite(command), `"${said}" must not become a wallet command`);
  }
});

test('an unknown sentence is nothing, not a nearest guess', () => {
  assert.equal(parse('hello there'), null);
  assert.equal(parse('привет', 'ru'), null);
  assert.equal(parse(''), null);
  assert.deepEqual({ ...parse('help') }, { help: true });
  assert.deepEqual({ ...parse('помощь', 'ru') }, { help: true });
});

test('a low-confidence wallet command is not run; a read is', () => {
  const bid = parse('bid 0.05 on artwork 31');
  assert.equal(voice.mayRun(bid, 0.3), false, 'misheard money is asked again');
  assert.equal(voice.mayRun(bid, 0.9), true);
  // An engine that does not measure confidence reports 0. That is unknown, not
  // low, and the tool gate still confirms the figure on the page.
  assert.equal(voice.mayRun(bid, 0), true);
  assert.equal(voice.mayRun(bid, undefined), true);
  assert.equal(voice.mayRun(parse('what auctions are open'), 0.1), true);
});

test('voice writes are exactly the agent writes, so neither can grow alone', () => {
  const agentWindow = { setTimeout: (fn) => fn(), location: { assign() {} } };
  new Function('window', 'document', 'navigator', 'console', agentSource)(agentWindow, {}, {}, console);
  const agentWrites = agentWindow.ArtSoulWebMCP.createTools({ fetchJson: async () => ({}) })
    .filter((tool) => /authorizeWalletAction\(/.test(tool.execute.toString()))
    .map((tool) => tool.name);
  assert.deepEqual([...voice.WRITE_TOOLS].sort(), agentWrites.sort());

  // And voice reaches the chain only through those tools: no contract call, no
  // wallet provider, no grant of its own.
  assert.doesNotMatch(source, /ArtSoulContracts\./);
  assert.doesNotMatch(source, /ethereum|getWalletProvider|eth_sendTransaction/);
  assert.doesNotMatch(source, /artsoul\.agent\.permission/);
  assert.match(source, /agent\.createTools\(agent\.browserDependencies\(\)\)/);
});

test('no audio reaches ArtSoul, and nothing listens without a click', () => {
  // The browser recognises and speaks. This file makes no request of its own.
  assert.doesNotMatch(source, /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|MediaRecorder|getUserMedia/);
  // One sentence per click, never continuous, never on load.
  assert.match(source, /session\.continuous = false;/);
  assert.match(source, /session\.interimResults = false;/);
  assert.match(source, /mic\.addEventListener\('click', start\);/);
  assert.equal((source.match(/\.start\(\)/g) || []).length, 1, 'the one start() is inside the click handler');
  // A hidden tab stops listening.
  assert.match(source, /visibilityState === 'hidden'\) \{ stopListening\(\); silence\(\); \}/);
});

test('the person is told where the audio goes before the microphone first opens', () => {
  assert.match(source, /In Chrome, the audio is sent to Google to be transcribed\. ArtSoul does not record, store or receive it\./);
  assert.match(source, /В Chrome звук отправляется в Google для распознавания\. ArtSoul его не записывает, не хранит и не получает\./);
  const start = source.slice(source.indexOf('function start()'));
  assert.ok(start.indexOf('TEXT[lang].notice') < start.indexOf('new Recognition()'), 'notice before recognition');
});

test('text commands do not require speech recognition', () => {
  const win = { ArtSoulWebMCP: {} };
  const api = loadVoice(win);
  assert.equal(typeof api.parseCommand, 'function');
  assert.doesNotMatch(source, /typeof Recognition !== 'function' \|\| !window\.ArtSoulWebMCP/);
  assert.match(source, /mic.disabled = busy \|\| typeof Recognition !== 'function'/);
});

test('what was heard and the answer are shown, not only spoken', () => {
  // A person who cannot hear the reply still gets all of it.
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /heardEl\.textContent = /);
  assert.match(source, /answerEl\.textContent = /);
  // Recognised text is never inserted as markup.
  assert.doesNotMatch(source, /innerHTML\s*=\s*[^'"]*(transcript|heard|answer|reply)/);
});

test('spoken replies are short, and Russian does not read English out loud', () => {
  const auctions = voice.describeResult('find_active_auctions', {
    count: 5,
    auctions: [
      { title: 'Moon 2026', hours_remaining: 5.2 },
      { title: 'Solar', hours_remaining: 30 },
      { title: 'Third', hours_remaining: 40 },
      { title: 'Fourth', hours_remaining: 44 }
    ]
  }, 'en');
  assert.match(auctions.say, /^5 auctions are open\./);
  assert.doesNotMatch(auctions.say, /Fourth/, 'three is enough to say aloud');

  const refusal = voice.describeResult('place_bid', { submitted: false, reason: 'You created this artwork.' }, 'ru');
  assert.doesNotMatch(refusal.say, /created/, 'the English reason is shown, not read with a Russian voice');
  assert.equal(refusal.show, 'You created this artwork.');

  const provenance = voice.describeResult('get_artwork_provenance', {
    creator: '0xA61C114E38cEAc5BDE6325956F4e808582690329', first_collector: null, owner: null
  }, 'en');
  assert.doesNotMatch(provenance.say, /0x/, 'nobody wants a hex address read aloud');
  assert.match(provenance.show, /0xA61C…0329/);
});

test('the styles follow canon 16 and respect reduced motion', () => {
  const css = fs.readFileSync('unified-styles.css', 'utf8');
  const block = css.slice(css.indexOf('/* B-09/B-21 commands.'));
  assert.ok(block.length > 0);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/, 'theme colours only through variables');
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.artsoul-voice-button\.is-listening\s*\{\s*animation: none;/);
  assert.match(block, /z-index: 110;/, 'below every modal');
  assert.doesNotMatch(source, /#[0-9a-fA-F]{6}\b/, 'no colours in the script either');
});

test('the voice script loads after the agent tools on every page that has them', () => {
  const pages = fs.readdirSync('.').filter((name) => name.endsWith('.html'));
  const withAgent = pages.filter((page) => fs.readFileSync(page, 'utf8').includes('/webmcp-tools.js?v='));
  assert.ok(withAgent.length >= 6);
  for (const page of withAgent) {
    const html = fs.readFileSync(page, 'utf8');
    const agent = html.indexOf('/webmcp-tools.js?v=');
    const spoken = html.indexOf('/voice-commands.js?v=');
    assert.ok(spoken > agent, `${page} must load voice after the agent tools`);
    assert.match(html, /<script src="\/voice-commands\.js\?v=\d+" defer><\/script>/, `${page} defers it`);
  }
  assert.match(fs.readFileSync('vite.config.js', 'utf8'), /'voice-commands\.js',/);
});

test('the command launcher is present in the header before scripts run, outside Admin', () => {
  for (const page of ['index','gallery','artwork','profile','upload','collection-builder','docs-protocol']) {
    const html = fs.readFileSync(page + '.html', 'utf8');
    assert.match(html, /class="site-header-actions">[\s\S]*?class="artsoul-voice-button"/);
    assert.equal((html.match(/class="artsoul-voice-button"/g) || []).length, 1);
  }
  assert.doesNotMatch(fs.readFileSync('admin.html', 'utf8'), /voice-commands|artsoul-voice-button/);
  assert.doesNotMatch(source, /artsoul-voice-spacer|requestIdleCallback/);
});
