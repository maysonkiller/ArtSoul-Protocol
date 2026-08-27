const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const profile = fs.readFileSync('src/entries/profile.jsx', 'utf8');

test('the profile hero gives the browser the resolved avatar in the first content commit', () => {
  assert.match(profile, /<img src=\{resolvedAvatarUrl\} alt="Avatar"/);
  assert.doesNotMatch(profile, /decodedProfileAvatarUrl/);
  assert.doesNotMatch(profile, /profileAvatarDecodeTokenRef/);
  assert.doesNotMatch(profile, /aria-busy=\{Boolean\(resolvedAvatarUrl/);
  assert.doesNotMatch(
    profile,
    /resolvedAvatarUrl \? \(\s*<div className="w-full h-full" aria-hidden="true"><\/div>/,
    'a known avatar must not be replaced with an intentionally empty circle'
  );
});
