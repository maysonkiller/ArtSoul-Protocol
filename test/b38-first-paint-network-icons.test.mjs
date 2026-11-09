// B38 regression: mobile first paint is usable even if all external CSS is delayed.
// Offline tests only. No wallet, provider, RPC, DB, or Alchemy calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { criticalFirstPaintCss, inlineCriticalFirstPaint } from '../scripts/critical-first-paint.mjs';

const unified = readFileSync('unified-styles.css', 'utf8');
const baseline = readFileSync('nft-network-frames.css', 'utf8');
const vite = readFileSync('vite.config.js', 'utf8');
const multichain = readFileSync('src/features/profile/multichain-wallet-assets.jsx', 'utf8');
const legacy = readFileSync('src/features/profile/wallet-nfts.jsx', 'utf8');

test('the first paint is inline, theme-accurate, small and available before page scripts', () => {
  const css = criticalFirstPaintCss(unified);
  const wrapped = inlineCriticalFirstPaint('<html><head><script>theme()</script></head><body></body></html>', unified);
  assert.ok(wrapped.indexOf('data-artsoul-critical-paint') < wrapped.indexOf('<script>theme()'));
  assert.match(wrapped, /<style data-artsoul-critical-paint>/);
  assert.match(css, /:root\s*\{[\s\S]*--bg-classic:/);
  assert.match(css, /\.classic\s*\{[\s\S]*--c-bg:/);
  assert.match(css, /\.future\s*\{[\s\S]*--c-bg:/);
  assert.match(css, /site-header\s+\.logo-link\s*>\s*\.site-logo/);
  assert.match(css, /max-width:\s*40px/);
  assert.match(css, /body\.classic,\s*body\.future/);
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /home-showcase-shell/);
  assert.ok(css.length < 13_000, 'inline shell must not duplicate the 385KB shared stylesheet');
  assert.equal(inlineCriticalFirstPaint(wrapped, unified), wrapped, 'must not inject twice');
  assert.equal(inlineCriticalFirstPaint('<body></body>', unified), '<body></body>');
});

test('B39: desktop Guide label never disappears when critical and full CSS are combined', () => {
  const css = criticalFirstPaintCss(unified);
  const desktop = css.split('@media (max-width: 768px)')[0];
  const mobile = css.slice(css.indexOf('@media (max-width: 768px)'));
  assert.ok(desktop.includes(':where(.site-primary-nav .site-nav-guide-long) { display: inline; }'));
  assert.ok(desktop.includes(':where(.site-primary-nav .site-nav-guide-short) { display: none; }'));
  assert.ok(!desktop.includes(':where(.site-primary-nav .site-nav-guide-long) { display: none; }'),
    'never hide the sole desktop visible label in the unconditional critical shell');
  assert.ok(mobile.includes(':where(.site-primary-nav .site-nav-guide-long) { display: none; }'));
  assert.ok(mobile.includes(':where(.site-primary-nav .site-nav-guide-short) { display: inline; }'));
  assert.match(unified, /\.site-header \.site-nav-guide-short \{ display: none; \}/);
  for (const page of ['index.html', 'gallery.html', 'profile.html', 'upload.html', 'docs-protocol.html']) {
    const content = readFileSync(page, 'utf8');
    assert.match(content, /href="\/docs-protocol"[^>]*aria-label="How it works"/);
  }
});

test('critical colors always originate from canonical CSS, and missing themes fail closed', () => {
  const original = criticalFirstPaintCss(unified);
  const changed = unified.replace('--bg-classic: #010101;', '--bg-classic: #010102;');
  assert.notEqual(original, criticalFirstPaintCss(changed));
  assert.throws(() => criticalFirstPaintCss('.classic {} .future {}'), /Missing canonical theme/);
  assert.doesNotMatch(readFileSync('scripts/critical-first-paint.mjs', 'utf8'),
    /#[a-f0-9]{6}(?![a-f0-9])/i, 'do not hardcode a second copy of the palette in the build helper');
});

test('Vite applies the fallback in every HTML entry before the existing async bundle', () => {
  assert.match(vite, /inlineCriticalFirstPaintPlugin\(\)/);
  assert.match(vite, /order:\s*'pre'/);
  assert.match(vite, /inlineCriticalFirstPaint\(html, shared\)/);
  for (const path of ['index.html','gallery.html','profile.html','artwork.html']) {
    const html = readFileSync(path, 'utf8');
    assert.match(html, /<head>/);
    const transformed = inlineCriticalFirstPaint(html, unified);
    assert.ok(transformed.indexOf('data-artsoul-critical-paint') < transformed.indexOf('/header-prepaint.js'));
    assert.match(transformed, /site-primary-nav/);
  }
});

test('ArtSoul and wallet NFT overlays use bottom-right round icons only, with video controls clear', () => {
  assert.match(baseline, /artsoul-card-media \.artsoul-chain-marker \{[\s\S]*right: 8px; bottom: 8px;/);
  assert.match(baseline, /artsoul-card-media \.artsoul-chain-marker > span \{ display: none;/);
  assert.match(baseline, /artsoul-card-media:has\(\.artsoul-card-media-controls\) \.artsoul-chain-marker \{ bottom: 60px;/);
  assert.match(baseline, /wallet-nft-image, \.wallet-asset-art/);
  assert.match(baseline, /wallet-asset-overlay \.wallet-chain-chip > span:not\(\.wallet-chain-glyph\)/);
  assert.match(baseline, /border-radius: 50%/);
  assert.match(legacy, /aria-label="Network: Base" title="Base"/);
  assert.match(multichain, /title=\{info\[1\]\} aria-label=\{"Network: " \+ info\[1\]\}/);
  assert.match(multichain, /quickNetworkChoices\.map/);
  assert.doesNotMatch(baseline, /#[a-f0-9]{3,8}\b/i, 'themes remain CSS-token based');
});

test('B38 is presentation-only and does not enable Alchemy usage', () => {
  assert.match(readFileSync('src/features/profile/wallet-nfts.jsx', 'utf8'),
    /config.multichainWalletAssetsEnabled === true\s*\? <MultiChainWalletAssets key=\{wallet\} wallet=\{wallet\} \/>/);
  assert.doesNotMatch(baseline, /https?:\/\/|fetch\(|background-image:\s*url\(/i);
  assert.doesNotMatch(readFileSync('scripts/critical-first-paint.mjs','utf8'),
    /https?:\/\/|fetch\(|localStorage|document\./i);
});
