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

test('English sentences reach the tool they mean, with the figures they said', () => {
  const cases = [
    ['what auctions are open right now?', 'find_active_auctions', {}],
    ['tell me about artwork 31', 'get_artwork', { artwork_id: '31' }],
    ['who owns artwork 19', 'get_artwork_provenance', { artwork_id: '19' }],
    ['what is the status of artwork 31', 'get_auction_state', { artwork_id: '31' }],
    ['my activity', 'get_my_activity', {}],
    ['open artwork 31', 'open_artwork', { artwork_id: '31' }],
    ['search moon', 'search_artworks', { query: 'moon' }],
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
    ['найди луна', 'search_artworks', { query: 'луна' }],
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
  assert.match(source, /button\.addEventListener\('click', start\);/);
  assert.equal((source.match(/\.start\(\)/g) || []).length, 1, 'the one start() is inside the click handler');
  // A hidden tab stops listening.
  assert.match(source, /visibilityState === 'hidden'\) stopListening\(\)/);
  assert.match(source, /addEventListener\('pagehide', stopListening\)/);
});

test('the person is told where the audio goes before the microphone first opens', () => {
  assert.match(source, /In Chrome, the audio is sent to Google to be transcribed\. ArtSoul does not record, store or receive it\./);
  assert.match(source, /В Chrome звук отправляется в Google для распознавания\. ArtSoul его не записывает, не хранит и не получает\./);
  const start = source.slice(source.indexOf('function start()'));
  assert.ok(start.indexOf('TEXT[lang].notice') < start.indexOf('new Recognition()'), 'notice before recognition');
});

test('a browser without speech recognition gets no button, and the API still exists for tests', () => {
  const win = { ArtSoulWebMCP: {} };
  const api = loadVoice(win);
  assert.equal(typeof api.parseCommand, 'function');
  assert.match(source, /typeof Recognition !== 'function' \|\| !window\.ArtSoulWebMCP/);
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
  const block = css.slice(css.indexOf('/* B-09 voice commands.'));
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

test('on a phone the last controls can scroll clear of the button', () => {
  // Seen on the preview at 375px: the fixed button sat over the settlement
  // text at the bottom of the artwork page. A spacer at the end of the page
  // gives the final controls room; it takes none on wider screens.
  assert.match(source, /spacer\.className = 'artsoul-voice-spacer';/);
  const css = fs.readFileSync('unified-styles.css', 'utf8');
  assert.match(css, /\.artsoul-voice-spacer \{\s*display: none;\s*\}/);
  assert.match(css, /@media \(max-width: 768px\) \{\s*\.artsoul-voice-spacer \{\s*display: block;/);
});
