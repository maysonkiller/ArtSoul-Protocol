const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const source = fs.readFileSync('src/entries/loading-skeletons.jsx', 'utf8')
  .replace("import { React } from './react-runtime.js';", '')
  .replaceAll('export function', 'function');
const moduleStub = { exports: {} };
let ArtworkPageSkeleton, ProfilePageSkeleton, CardGridSkeleton;
test.before(async () => {
  const { transformWithOxc } = await import('vite');
  const compiled = await transformWithOxc(source, 'loading-feedback.jsx', { jsx: { runtime: 'classic' } });
  vm.runInNewContext(compiled.code + '\nObject.assign(module.exports, { ArtworkPageSkeleton, ProfilePageSkeleton, CardGridSkeleton });',
    { React, module: moduleStub });
  ({ ArtworkPageSkeleton, ProfilePageSkeleton, CardGridSkeleton } = moduleStub.exports);
});

for (const name of ['artwork', 'profile']) {
  test(`${name} loading announces the real wait without synthetic content`, () => {
    const Component = name === 'artwork' ? ArtworkPageSkeleton : ProfilePageSkeleton;
    const markup = renderToStaticMarkup(React.createElement(Component, { immediate: true }));
    assert.match(markup, new RegExp(`aria-label="Loading ${name}"`));
    assert.match(markup, /aria-busy="true"/);
    assert.match(markup, /artsoul-wait-word/);
    assert.doesNotMatch(markup, /artsoul-skeleton|artsoul-placeholder/);
  });

  test(`${name} pre-module feedback is identical to its hydrated component`, () => {
    const Component = name === 'artwork' ? ArtworkPageSkeleton : ProfilePageSkeleton;
    const html = fs.readFileSync(`${name}.html`, 'utf8');
    const start = html.indexOf('data-' + name + '-static-skeleton');
    const main = html.slice(start).match(/<main[\s\S]*?<\/main>/)[0];
    const markup = renderToStaticMarkup(React.createElement(Component, { immediate: true }));
    const compact = text => text.replace(/>\s+</g, '><').trim();
    assert.equal(compact(main), compact(markup));
  });
}

test('gallery feedback does not invent artwork cards or an empty result', () => {
  const markup = renderToStaticMarkup(React.createElement(CardGridSkeleton));
  assert.match(markup, /Loading artworks/);
  assert.match(markup, /aria-busy="true"/);
  assert.doesNotMatch(markup, /artsoul-skeleton|No artworks/);
});

test('an indexed artwork wait keeps its reference accessible without showing an extra ID chip', () => {
  const markup = renderToStaticMarkup(React.createElement(ArtworkPageSkeleton, { immediate: true, artworkId: '35' }));
  assert.match(markup, /aria-label="Loading artwork 35"/);
  assert.doesNotMatch(markup, /artsoul-placeholder|artsoul-wait-id/);
  assert.equal(markup.replace(/<[^>]+>/g, ''), 'ArtSoul');
});

test('a failed or stalled profile entry exits its loader and a mounted entry cancels the timeout', () => {
  const html = fs.readFileSync('profile.html', 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(body => body.includes('window.ArtSoulProfileEntryFailed'));
  assert.ok(script, 'A profile module failure must have a bounded recovery path');
  function start(mounted = false) {
    const events = {}, timers = [], cleared = [], replacements = [];
    const app = { dataset: { profileEntryMounted: String(mounted) }, replaceChildren: node => replacements.push(node) };
    const template = { content: { cloneNode: () => 'retry-panel' } };
    const window = { addEventListener: (name, listener) => { events[name] = listener; },
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); return 1; } };
    vm.runInNewContext(script, { window, clearTimeout: id => cleared.push(id),
      document: { getElementById: id => id === 'app' ? app : template } });
    return { window, events, timers, cleared, replacements };
  }
  const stalled = start();
  assert.equal(stalled.timers[0].delay, 15000);
  stalled.timers[0].callback();
  assert.deepEqual(stalled.replacements, ['retry-panel']);
  const failed = start();
  failed.window.ArtSoulProfileEntryFailed();
  assert.deepEqual(failed.replacements, ['retry-panel']);
  const mounted = start(true);
  mounted.events['artsoul:profile-entry-mounted']();
  mounted.timers[0].callback();
  assert.deepEqual(mounted.cleared, [1]);
  assert.deepEqual(mounted.replacements, []);
  assert.match(html, /onerror="window\.ArtSoulProfileEntryFailed\?\.\(\)"/);
});
