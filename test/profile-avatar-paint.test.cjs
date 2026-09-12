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
  assert.match(profile, /aria-busy=\{Boolean\(resolvedAvatarUrl && !decodedProfileAvatarUrl && !profileAvatarFailed\)\}/);
  assert.match(profile, /\) : resolvedAvatarUrl \? \(\s*<div className="w-full h-full" aria-hidden="true"><\/div>/);
  // An unavailable image is not an endless pending decode. Keep its dimensions
  // but finish the pending state with a truthful label, never a broken <img>.
  assert.match(profile, /preloader\.onerror = fail;/);
  assert.match(profile, /profileAvatarFailed \? \([\s\S]*?Avatar unavailable/);
});
