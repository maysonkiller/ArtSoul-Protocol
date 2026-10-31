const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const profile = fs.readFileSync('src/entries/profile.jsx', 'utf8');

test('a profile without an uploaded avatar uses the same neutral image as Ownership', async () => {
  const React = require('react');
  const {renderToStaticMarkup} = require('react-dom/server');
  const {transformWithOxc} = await import('vite');
  const start = profile.indexOf('function renderAvatar(editable)');
  const end = profile.indexOf('const profileAddress =', start);
  assert.ok(start >= 0 && end > start);
  const {code} = await transformWithOxc(profile.slice(start, end), 'avatar.jsx', {jsx: {runtime: 'classic'}});
  const scope = {React, isClassic: true, resolvedAvatarUrl: '', decodedProfileAvatarUrl: '', profileAvatarFailed: false};
  require('node:vm').runInNewContext(code + '\nthis.avatar = renderAvatar;', scope);
  const html = renderToStaticMarkup(scope.avatar(false));
  assert.match(html, /src="\/default-avatar.png"/);
  assert.doesNotMatch(html, /No Avatar|Avatar unavailable/);
  scope.profileAvatarFailed = true;
  assert.match(renderToStaticMarkup(scope.avatar(false)), /Avatar unavailable/);
  scope.profileAvatarFailed = false;
  scope.decodedProfileAvatarUrl = '/custom.png';
  assert.match(renderToStaticMarkup(scope.avatar(false)), /src="\/custom.png"/);
});

test('the profile hero commits an avatar only after an off-DOM decode', () => {
  assert.match(profile, /const \[decodedProfileAvatarUrl, setDecodedProfileAvatarUrl\] = useState\(''\)/);
  assert.match(profile, /import \{ decodeAvatar \} from/);
  assert.match(profile, /decodeAvatar\(resolvedAvatarUrl\)\.then\(commit, fail\)/);
  assert.match(profile, /setDecodedProfileAvatarUrl\(url\)/);
  assert.match(profile, /<img src=\{decodedProfileAvatarUrl\}/);
  assert.doesNotMatch(profile, /<img src=\{resolvedAvatarUrl\}/);
});

test('late avatar decodes cannot commit after the profile source changes', () => {
  assert.match(profile, /const token = \+\+profileAvatarDecodeTokenRef\.current/);
  assert.match(profile, /if \(token !== profileAvatarDecodeTokenRef\.current\) return/);
  assert.match(profile, /profileAvatarDecodeTokenRef\.current \+= 1/);
});

test('the profile hero keeps a stable shell while its avatar is pending', () => {
  assert.match(profile, /aria-busy=\{Boolean\(resolvedAvatarUrl && !decodedProfileAvatarUrl && !profileAvatarFailed\)\}/);
  assert.match(profile, /\) : resolvedAvatarUrl \? \(\s*<div className="w-full h-full" aria-hidden="true"><\/div>/);
  // An unavailable image is not an endless pending decode. Keep its dimensions
  // but finish the pending state with a truthful label, never a broken <img>.
  assert.match(profile, /decodeAvatar\(resolvedAvatarUrl\)\.then\(commit, fail\)/);
  assert.match(profile, /profileAvatarFailed \? \([\s\S]*?Avatar unavailable/);
});
