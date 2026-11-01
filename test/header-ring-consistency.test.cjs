const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('unified-styles.css', 'utf8');
const block = css.slice(css.indexOf('/* B18.3 — single idle/interaction treatment'));
const pages = [
  'index.html','gallery.html','artwork.html','profile.html','upload.html',
  'admin.html','docs-protocol.html','collection-builder.html','visual-lab.html'
];
const controlClasses = [
  '.site-search-button','.artsoul-voice-button',
  '.notification-inbox > .notification-toggle','.site-theme-toggle','.avatar-button'
];

test('exact shared header CSS is loaded on all page shells after cache invalidation', () => {
  assert.ok(block.startsWith('/* B18.3'), 'new styles must be a final block after older theme-specific rules');
  for (const page of pages) {
    const source = fs.readFileSync(page, 'utf8');
    assert.equal((source.match(/unified-styles\.css\?v=74/g) || []).length, 1, page);
  }
});

test('all five buttons share the same neutral border and no idle glow or animation', () => {
  const idle = block.match(/\/\* Same border, surface[\s\S]*?\n\}/)?.[0] || '';
  for (const className of controlClasses) assert.ok(idle.includes(className), className);
  for (const cssRule of [
    /border: 1px solid var\(--c-border-soft\) !important/,
    /border-radius: 999px !important/,
    /background: var\(--c-surface\) !important/,
    /color: var\(--c-text\) !important/,
    /box-shadow: none !important/,
    /animation: none !important/,
    /transition: none !important/
  ]) assert.match(idle, cssRule);
  // Future Appearance mode is a persistent preference, not an "open" state.
  assert.doesNotMatch(block, /\.site-theme-toggle\[aria-pressed="true"\]/);
});

test('hover, keyboard focus and open state show one common theme-aware glow', () => {
  const hover = block.match(/@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?\n\}/)?.[0] || '';
  for(const cls of controlClasses) assert.ok(hover.includes(cls), cls);
  assert.match(hover, /box-shadow: 0 0 0 1px var\(--c-glow\), 0 0 14px var\(--c-glow\) !important/);
  assert.match(block, /:is\(:focus-visible, :active, \[aria-expanded="true"\]\)/);
  assert.match(block, /outline: 2px solid var\(--c-accent\) !important/);
  assert.match(block, /#notification-preview-panel:popover-open/);
  assert.match(block, /#artsoul-search-dialog\\[open\\]/);
});

test('voice listening state remains explicit; all buttons keep 44px targets', () => {
  // Matching :hover must never disguise an active microphone as an idle button.
  assert.match(block, /\.artsoul-voice-button\.artsoul-voice-button\.is-listening \{[\s\S]*?background: var\(--c-accent\) !important/);
  assert.match(block, /width: 44px !important/);
  assert.match(block, /min-height: 44px !important/);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)/);
});

test('header control accessibility and click owners remain unchanged', () => {
  const home = fs.readFileSync('index.html','utf8');
  const wallet = fs.readFileSync('avatar-dropdown.js','utf8');
  const notification = fs.readFileSync('src/features/moderation/notification-inbox.jsx','utf8');
  assert.match(home, /aria-label="Search ArtSoul"/);
  assert.match(home, /aria-label="ArtSoul commands"/);
  assert.match(home, /data-notification-preview/);
  assert.match(home, /data-artsoul-theme-toggle/);
  assert.match(home, /aria-label="ArtSoul account menu"/);
  assert.match(wallet, /avatarButton\?\.setAttribute\('aria-expanded', String\(this\.isOpen\)\)/);
  assert.match(notification, /aria-expanded=\{open\}/);
  assert.doesNotMatch(block, /pointer-events: none|display: none|position: fixed/);
});
