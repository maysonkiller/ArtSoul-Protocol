import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAvatarHarness } = require('./helpers/avatar-dropdown-harness.cjs');
const neutral = fs.readFileSync('public/default-avatar.png');
const inline = `data:image/png;base64,${neutral.toString('base64')}`;
const pages = ['index', 'gallery', 'profile', 'artwork', 'upload', 'admin', 'collection-builder', 'docs-protocol'];
const shell = fs.readFileSync('index.html', 'utf8')
  .match(/<div class="avatar-dropdown-container">[\s\S]*?<\/button>\s*<\/div>/)[0]
  .replace('src="/default-avatar.png"', `src="${inline}" data-avatar-source="/default-avatar.png"`);

test('guest prepaint and wallet initialization preserve embedded pixels without a network image request', async () => {
  const harness = createAvatarHarness({ staticShellHtml: shell, staticShellDecoded: false, prepaint: true, settled: false });
  assert.equal(harness.avatarSrc(), inline, 'the first-frame bridge must not replace embedded pixels with a URL');
  const image = harness.avatarImage();
  harness.dropdown.renderInitializingState();
  await harness.flush();
  assert.equal(harness.avatarImage(), image);
  assert.equal(harness.avatarSrc(), inline);
  assert.equal(harness.avatarSource(), '/default-avatar.png', 'logical identity remains canonical');
  assert.equal(harness.avatarName(), 'ArtSoul Guest');
  assert.equal(harness.imageLoads.includes('/default-avatar.png'), false);
});

test('embedding is limited to the shared header and preserves the canonical bitmap in dev as well as build', async () => {
  const { default: config } = await import('../vite.config.js');
  const plugin = config.plugins.find(plugin => plugin.name === 'inline-shared-header-avatar');
  assert.ok(plugin);
  assert.equal(plugin.apply, undefined, 'dev and production must use the same first-frame path');
  const html = fs.readFileSync('artwork.html', 'utf8') + '<img src="/default-avatar.png" alt="Unrelated avatar">';
  const rendered = await plugin.transformIndexHtml.handler(html);
  assert.ok(rendered.includes(`data-avatar-image src="${inline}"`));
  assert.ok(rendered.endsWith('<img src="/default-avatar.png" alt="Unrelated avatar">'));
  assert.equal(await plugin.transformIndexHtml.handler(rendered), rendered, 'idempotent');
});

test('embedded guest pixels do not replace a validated connected preview or reveal a stale name', () => {
  const wallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const source = 'https://cdn.artsoul.test/avatar.png';
  const preview = 'data:image/png;base64,QUJD';
  const identity = { wallet, name: 'Artist', avatarUrl: source, preview: { wallet, name: 'Artist', source, dataUri: preview } };
  const storage = { artsoul_wallet: wallet, artsoul_header_ui_state: 'connected', artsoul_header_identity: JSON.stringify(identity) };
  const restored = createAvatarHarness({ staticShellHtml: shell, prepaint: true, settled: false, storage });
  assert.equal(restored.avatarSrc(), preview);
  assert.equal(restored.avatarName(), 'Artist');
  assert.equal(restored.avatarSource(), source);
  const switchedWallet = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const switched = createAvatarHarness({
    staticShellHtml: shell, prepaint: true, settled: false,
    storage: { ...storage, artsoul_wallet: switchedWallet }
  });
  assert.equal(switched.avatarSrc(), inline);
  assert.equal(switched.avatarName(), '0xbbbb...bbbb');
  assert.equal(switched.avatarSource(), '/default-avatar.png');
});

test('built shared headers carry the exact canonical guest bitmap before JavaScript or network images',
  { skip: !fs.existsSync('dist/index.html') }, () => {
  for (const page of pages) {
    const html = fs.readFileSync(`dist/${page}.html`, 'utf8');
    const tag = html.match(/<img data-avatar-image[^>]*>/)?.[0];
    assert.ok(tag, page);
    const source = tag.match(/src="([^"]+)"/)?.[1];
    assert.equal(source, inline, `${page}: the guest bitmap must arrive with HTML`);
    assert.match(tag, /data-avatar-source="\/default-avatar\.png"/, page);
    assert.match(tag, /loading="eager"/, page);
    assert.match(tag, /decoding="sync"/, page);
    assert.deepEqual(Buffer.from(source.split(',')[1], 'base64'), neutral, 'preserve the existing artwork exactly');
    assert.equal((html.match(/data-avatar-image/g) || []).length, 1, page);
  }
});
