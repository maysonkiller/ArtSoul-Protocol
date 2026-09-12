import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeImage } from '../src/features/artwork/decoded-image.js';

test('an image is not committed when bytes arrive but decoding is still pending', async () => {
    let finishDecode;
    const image = { decode: () => new Promise(resolve => { finishDecode = resolve; }) };
    let committed = false;
    const result = decodeImage('art.png', () => image).then(url => { committed = true; return url; });
    const load = image.onload();
    await Promise.resolve();
    assert.equal(committed, false);
    assert.equal(image.src, 'art.png');
    finishDecode();
    await load;
    assert.equal(await result, 'art.png');
    assert.equal(image.onload, null);
});

test('load and decode failures reject so the caller can show its stable fallback', async () => {
    const loadImage = {};
    const load = decodeImage('broken.png', () => loadImage);
    loadImage.onerror();
    await assert.rejects(load, /could not be loaded/);
    const decode = { decode: async () => { throw new Error('invalid bitmap'); } };
    const result = decodeImage('invalid.png', () => decode);
    await decode.onload();
    await assert.rejects(result, /invalid bitmap/);
});

test('browsers without decode still commit only after image load', async () => {
    const image = {};
    const result = decodeImage('legacy.png', () => image);
    await image.onload();
    assert.equal(await result, 'legacy.png');
});
