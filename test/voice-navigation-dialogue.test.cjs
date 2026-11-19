const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const win = {};
new Function('window', 'document', 'navigator', fs.readFileSync('voice-commands.js', 'utf8'))(win, undefined, {});
const { parseNavigationTurn, parseCommand } = win.ArtSoulVoice;

test('general NFT requests offer destinations and accept a short follow-up in either language', () => {
  for (const [lang, request, answers] of [
    ['ru', 'Покажи мне, пожалуйста, эн-эф-ти!', [
      ['в галерее', 'nfts'], ['на маркетплейсе', 'marketplace'], ['в моем профиле', 'collected'],
      ['в кошельке', 'walletNfts'], ['мою коллекцию', 'collected'], ['нет, в маркетплейсе', 'marketplace']
    ]],
    ['en', 'Could you open an NFT?', [
      ['in the gallery', 'nfts'], ['marketplace', 'marketplace'], ['my collection', 'collected'], ['my wallet', 'walletNfts'],
      ['actually, the gallery', 'nfts']
    ]]
  ]) {
    const clarification = parseNavigationTurn(request, lang);
    assert.equal(clarification.nftPrompt, true);
    assert.ok(clarification.message.length > 0);
    for (const [reply, page] of answers) {
      assert.deepEqual(parseNavigationTurn(reply, lang, true), { tool: 'open_page', input: { page } }, reply);
    }
  }
  assert.equal(parseNavigationTurn('my wallet', 'en'), null);
  assert.equal(parseNavigationTurn('в кошельке', 'ru'), null);
  assert.equal(parseNavigationTurn('отмена', 'ru', true).tool, undefined);
  assert.equal(parseCommand('да', 'ru', true).nftPrompt, true);
});

test('a conversational navigation request can go straight to a named destination or an artwork', () => {
  for (const [lang, input, page] of [
    ['ru', 'можешь открыть вкладку маркетплейс?', 'marketplace'], ['en', 'take me to the marketplace', 'marketplace'],
    ['ru', 'переключись на вкладку аукционы', 'auctions'], ['ru', 'покажи NFT из кошелька', 'walletNfts'],
    ['ru', 'давай перейдём в галерею', 'gallery'], ['ru', 'хочу посмотреть все NFT', 'nfts'],
    ['ru', 'я хочу в галерею', 'gallery'], ['ru', 'переключись на вкладку NFT в профиле', 'collected'],
    ['en', 'switch to the collections tab', 'collections'], ['en', 'show me my wallet NFTs', 'walletNfts'],
    ['ru', 'перейди в мой профиль', 'profile'], ['en', 'could you open the upload page?', 'create']
  ]) assert.deepEqual(parseNavigationTurn(input, lang), { tool: 'open_page', input: { page } }, input);
  for (const [lang, input, pending] of [['ru', 'открой NFT №38', false], ['ru', 'номер 38', true], ['en', 'number 38', true]]) {
    assert.deepEqual(parseNavigationTurn(input, lang, pending), { tool: 'open_artwork', input: { artwork_id: '38' } });
  }
});

test('NFT follow-ups neither run trailing actions nor interpret a command as title or search data', () => {
  for (const input of ['не открывай NFT', 'найди NFT номер 31', 'название открой NFT',
    'открой NFT и купи работу 31', 'открой NFT номер 12 и заплати', 'номер 31 и выставь работу',
    '«открой NFT номер 38»', 'открой NFT номер 0', 'открой NFT ' + (2n ** 256n)]) {
    assert.equal(parseNavigationTurn(input, 'ru', true)?.tool, undefined, input);
  }
  for (const input of ['buy artwork 31', 'search open NFT', 'open NFT and buy work 31', '0', 'open https://example.test/']) {
    assert.equal(parseNavigationTurn(input, 'en', true)?.tool, undefined, input);
  }
  assert.equal(parseNavigationTurn('38', 'ru'), null);
});

test('the complete parser refuses mixed or negated navigation and preserves explicit data payloads', () => {
  for (const [lang, input] of [
    ['ru', 'не открывай NFT и покажи работу 31'], ['en', 'don’t open NFT and show artwork 31'],
    ['ru', 'открой работу 31 и купи работу 31'], ['en', 'show artwork 31 and buy artwork 31'],
    ['ru', 'купи работу 31 и открой маркетплейс'], ['en', 'withdraw and open marketplace'],
    ['ru', '«открой NFT» и покажи мой профиль'], ['ru', 'не открывай NFT и отключи кошелек']
  ]) assert.equal(parseCommand(input, lang, true)?.tool, undefined, input);
  assert.deepEqual(parseCommand('найди открой NFT и покажи работу 31', 'ru', true),
    { tool: 'search_catalog', input: { query: 'открой NFT и покажи работу 31' } });
  assert.deepEqual(parseCommand('prepare artwork titled Open NFT and buy artwork 31', 'en', true),
    { tool: 'prepare_artwork_registration', input: { title: 'Open NFT and buy artwork 31' } });
});
