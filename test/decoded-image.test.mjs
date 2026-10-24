import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeAvatar, decodeImage } from '../src/features/artwork/decoded-image.js';

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

test('an avatar prepares the contained display copy without downloading the original', async () => {
    const images = [];
    const result = decodeAvatar('original.png', () => {
        const image = { decode: async () => {} }; images.push(image); return image;
    }, (source, size) => { assert.equal(source, 'original.png'); assert.equal(size, 384); return 'contained.webp'; });
    assert.equal(images.length, 1);
    assert.equal(images[0].src, 'contained.webp');
    await images[0].onload();
    assert.equal(await result, 'contained.webp');
    assert.equal(images.length, 1);
});

test('a failed avatar transformation retries the original once, including decode failure', async () => {
    for (const failure of ['load', 'decode']) {
        const images = [];
        const result = decodeAvatar('original.png', () => {
            const image = { decode: async () => { if (failure === 'decode' && images.length === 1) throw new Error('bad transform'); } };
            images.push(image); return image;
        }, () => 'contained.webp');
        if (failure === 'load') images[0].onerror(); else await images[0].onload();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(images.length, 2);
        assert.equal(images[1].src, 'original.png');
        await images[1].onload();
        assert.equal(await result, 'original.png');
    }
});

test('an unchanged avatar source is not retried after failure', async () => {
    let count = 0, image;
    const result = decodeAvatar('animated.gif', () => { count++; return image = {}; }, source => source);
    image.onerror();
    await assert.rejects(result, /could not be loaded/);
    assert.equal(count, 1);
});

test('an unavailable transformation and original terminate after two requests', async () => {
    const images = [];
    const result = decodeAvatar('original.png', () => {
        const image = {}; images.push(image); return image;
    }, () => 'contained.webp');
    const rejected = assert.rejects(result, /could not be loaded/);
    images[0].onerror();
    await new Promise(resolve => setImmediate(resolve));
    images[1].onerror();
    await rejected;
    assert.equal(images.length, 2);
});

test('prepared avatars share in-flight decoding, expose only ready bitmaps, retry failures and bound memory', async () => {
    const OriginalImage = globalThis.Image, images = [];
    globalThis.Image = class { constructor() { images.push(this); } async decode() {} };
    try {
        const {prepareAvatar, readPreparedAvatar} = await import('../src/features/artwork/decoded-image.js?prepared-cache-test');
        const first = prepareAvatar('/shared.png');
        assert.equal(prepareAvatar('/shared.png'), first);
        assert.equal(images.length, 1);
        assert.equal(readPreparedAvatar('/shared.png'), '');
        await images[0].onload(); await first;
        assert.equal(readPreparedAvatar('/shared.png'), '/shared.png');
        assert.equal(await prepareAvatar('/shared.png'), '/shared.png');
        assert.equal(images.length, 1, 'a remount does not decode the same avatar again');
        const failed = prepareAvatar('/failed.png');
        images.at(-1).onerror(); await assert.rejects(failed);
        const retry = prepareAvatar('/failed.png');
        await images.at(-1).onload(); await retry;
        assert.equal(readPreparedAvatar('/failed.png'), '/failed.png');
        for (let i = 0; i < 64; i++) {
            const pending = prepareAvatar('/unique-'+i+'.png');
            assert.equal(readPreparedAvatar('/unique-'+i+'.png'), '');
            await images.at(-1).onload(); await pending;
        }
        assert.equal(readPreparedAvatar('/shared.png'), '', 'old entries leave the bounded cache');
        assert.equal(readPreparedAvatar('/unique-63.png'), '/unique-63.png');
    } finally {globalThis.Image = OriginalImage;}
});
