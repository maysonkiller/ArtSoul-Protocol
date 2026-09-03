const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const wrapper = fs.readFileSync('api/public/artworks.js', 'utf8');
const catchAll = fs.readFileSync('api/[...route].js', 'utf8');
const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));

test('public artwork projection has a dedicated serverless entry', () => {
  assert.match(wrapper, /\.\.\/\.\.\/src\/api\/routes\/public\/artworks\.js/);
  assert.doesNotMatch(wrapper, /\[\.\.\.route\]/);
  assert.doesNotMatch(wrapper, /routes\/(auth|functions|moderation|oauth|upload)\//);
  assert.match(wrapper, /private, no-store/);
  assert.match(wrapper, /X-Content-Type-Options/);
  assert.match(wrapper, /Referrer-Policy/);
});

test('dedicated public artwork entry imports as a Vercel handler', async () => {
  const endpoint = await import('../api/public/artworks.js');
  assert.equal(typeof endpoint.default, 'function');
});

test('exact public artwork endpoint does not depend on a rewrite', () => {
  const exactRewrite = vercel.rewrites.find(rewrite => rewrite.source === '/api/public/artworks');
  const publicCatchAll = vercel.rewrites.find(rewrite => rewrite.source === '/api/public/:route*');

  assert.equal(exactRewrite, undefined, 'the physical exact function is not shadowed by rewrite behavior');
  assert.ok(publicCatchAll, 'public catch-all rewrite remains available for other public routes');
  assert.match(catchAll, /\['public\/artworks', publicArtworksHandler\]/);
});
