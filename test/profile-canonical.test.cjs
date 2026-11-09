const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('profile.html', 'utf8');
const source = html.match(/<script data-profile-canonical>([\s\S]*?)<\/script>/)[1];
const origin = 'https://artsoulprotocol.com/profile';

function canonical(search) {
  const links = [], og = {};
  vm.runInNewContext(source, {
    URLSearchParams,
    window: { location: { search }, currentWalletAddress: '0x' + 'f'.repeat(40) },
    document: {
      createElement: () => ({}),
      head: { appendChild: link => links.push(link) },
      querySelector: () => og
    }
  });
  assert.equal(links.length, 1);
  assert.equal(links[0].rel, 'canonical');
  assert.equal(og.content, links[0].href);
  return links[0].href;
}

test('public authors retain distinct canonical identities, independent of the viewing wallet', () => {
  const a = '0x' + 'Aa'.repeat(20), b = '0x' + 'bb'.repeat(20);
  assert.equal(canonical('?address=' + a), origin + '?address=' + a.toLowerCase());
  assert.equal(canonical('?address=' + b), origin + '?address=' + b);
  assert.notEqual(canonical('?address=' + a), canonical('?address=' + b));
});

test('case, tracking and OAuth parameters do not create duplicate author pages', () => {
  const address = '0x' + 'aB'.repeat(20);
  assert.equal(canonical('?utm_source=telegram&address=' + address + '&oauth_status=ok'),
    origin + '?address=' + address.toLowerCase());
});

test('generic and invalid addresses cannot turn visitor state or untrusted input into a canonical URL', () => {
  for (const search of ['', '?address=bad', '?address=https://other.example', '?address=%22%3E%3Cscript%3E']) {
    assert.equal(canonical(search), origin);
  }
});

test('the profile document does not first declare a conflicting generic canonical', () => {
  assert.doesNotMatch(html, /<link\s+[^>]*rel=["']canonical["']/i);
  assert.ok(html.indexOf('data-profile-canonical') < html.indexOf('/header-prepaint.js'));
});
