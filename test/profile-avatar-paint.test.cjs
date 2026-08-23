const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const profile = fs.readFileSync('src/entries/profile.jsx', 'utf8');

test('the profile hero commits an avatar only after an off-DOM decode', () => {
  assert.match(profile, /const \[decodedProfileAvatarUrl, setDecodedProfileAvatarUrl\] = useState\(''\)/);
  assert.match(profile, /const preloader = typeof Image === 'function'[\s\S]*?new Image\(\)/);
  assert.match(profile, /preloader\.onload = \(\) => \{[\s\S]*?preloader\.decode\(\)\.then\(commit/);
  assert.match(profile, /setDecodedProfileAvatarUrl\(resolvedAvatarUrl\)/);
  assert.match(profile, /<img src=\{decodedProfileAvatarUrl\}/);
  assert.doesNotMatch(profile, /<img src=\{resolvedAvatarUrl\}/);
});

test('late avatar decodes cannot commit after the profile source changes', () => {
  assert.match(profile, /const token = \+\+profileAvatarDecodeTokenRef\.current/);
  assert.match(profile, /if \(token !== profileAvatarDecodeTokenRef\.current\) return/);
  assert.match(profile, /profileAvatarDecodeTokenRef\.current \+= 1/);
});

test('the profile hero keeps a stable shell while its avatar is pending', () => {
  assert.match(profile, /aria-busy=\{Boolean\(resolvedAvatarUrl && !decodedProfileAvatarUrl\)\}/);
  assert.match(profile, /\) : resolvedAvatarUrl \? \(\s*<div className="w-full h-full" aria-hidden="true"><\/div>/);
  assert.match(profile, /preloader\.onerror = \(\) => \{[\s\S]*?Keep the stable shell/);
});
