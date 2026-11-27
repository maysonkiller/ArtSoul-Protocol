import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { buildVoicePhraseIndex } from '../scripts/build-voice-phrase-index.mjs';

const phrases = JSON.parse(await fs.readFile('docs/audio/assistant-phrase-bank.json', 'utf8'));
const manifest = JSON.parse(await fs.readFile('public/audio/assistant/v1/manifest.json', 'utf8'));
const publicRoot = path.resolve('public');
const load = source => { const window = {}; new Function('window', source)(window); return window.ArtSoulVoicePhraseBank; };

test('every reviewed EN/RU pair remains unique and only genuine inventoried recordings are playable', async () => {
    const source = await buildVoicePhraseIndex(phrases, manifest, publicRoot);
    assert.equal(source, (await fs.readFile('voice-phrase-bank.js', 'utf8')).replace(/\r/g, ''));
    const bank = load(source);
    assert.equal(bank.voice, 'marin');
    assert.equal(bank.phraseCount, phrases.clips.length);
    assert.equal(bank.recordingCount, manifest.clips.length);
    const recorded = new Set(manifest.clips.map(clip => clip.url));
    for (const english of phrases.clips.filter(clip => clip.lang === 'en')) {
        for (const lang of ['en', 'ru']) {
            const selected = phrases.clips.find(clip => clip.id === english.id && clip.lang === lang);
            assert.equal(bank.text(english.id, lang), selected.text);
            assert.equal(bank.lookup(english.text, lang), recorded.has(selected.url) ? selected.url : '', selected.url);
        }
    }
    assert.equal(bank.lookup('A transaction was sent for 12 ETH.'), '');
    assert.equal(bank.lookup(phrases.clips[0].text, 'fr'), '');
});

test('recorded submission, settlement, failure and dynamic facts cannot borrow one another', async () => {
    const bank = load(await buildVoicePhraseIndex(phrases, manifest, publicRoot));
    for (const lang of ['en', 'ru']) {
        const submitted = bank.lookup(bank.text('submitted'), lang), settled = bank.lookup(bank.text('settled'), lang);
        assert.ok(submitted && settled && submitted !== settled);
        for (const id of ['r2ToolError', 'r2ActionNotCompleted', 'r2ActivityResults', 'r2SearchResults']) {
            const recorded = manifest.clips.find(clip => clip.id === id && clip.lang === lang);
            assert.equal(bank.lookup(bank.text(id), lang), recorded?.url || '', `${id} requires its own receipt`);
            assert.notEqual(bank.lookup(bank.text(id), lang), submitted);
            assert.notEqual(bank.lookup(bank.text(id), lang), settled);
        }
        assert.equal(bank.lookup(bank.text('submitted') + ' Amount: 0.01 ETH.', lang), '');
    }
});

test('changed catalog, wrong voice, duplicate texts and mismatched recording receipts fail closed', async () => {
    for (const mutate of [
        (p, m) => { m.clips[0].voice = 'another'; },
        (p, m) => { m.clips[0].model = 'unverified-model'; },
        (p, m) => { m.model = 'unverified-model'; },
        (p, m) => { m.clips[0].text += ' Changed.'; },
        (p, m) => { m.clips[0].transcript = 'Payment confirmed'; },
        (p, m) => { m.clips[0].sha256 = '0'.repeat(64); },
        (p, m) => { m.clips[0].bytes++; },
        (p, m) => { m.clips[0].duration_seconds++; },
        (p, m) => { m.clips.push(m.clips[0]); },
        p => { p.clips.push(p.clips[0]); },
        p => { p.clips.pop(); },
        p => { p.clips[0].url = '/audio/assistant/v1/../secret.wav'; },
        p => { p.clips[2].text = p.clips[0].text; },
        (p, m) => { m.clips.find(clip => clip.derived_from).derived_from.sha256 = '0'.repeat(64); }
    ]) {
        const p = structuredClone(phrases), m = structuredClone(manifest);
        mutate(p, m);
        await assert.rejects(buildVoicePhraseIndex(p, m, publicRoot));
    }
});

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artsoul-voice-bank-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const p = { ...phrases, clips: phrases.clips.filter(clip => clip.id === 'helpSpeech') };
    const m = { ...manifest, clips: structuredClone(manifest.clips.filter(clip => clip.id === 'helpSpeech')) };
    for (const clip of m.clips) {
        const destination = path.join(root, clip.url);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(path.join(publicRoot, clip.url), destination);
    }
    return { root, p, m };
}

test('an absent language recording is silent even when the other language is available', async t => {
    const { root, p, m } = await fixture(t);
    const russian = m.clips.find(clip => clip.lang === 'ru');
    await fs.unlink(path.join(root, russian.url));
    m.clips = m.clips.filter(clip => clip.lang === 'en');
    const bank = load(await buildVoicePhraseIndex(p, m, root));
    assert.ok(bank.lookup(bank.text('helpSpeech')));
    assert.equal(bank.lookup(bank.text('helpSpeech'), 'ru'), '');
});

test('missing files, malformed PCM with matching hashes, and orphan recordings are rejected', async t => {
    const { root, p, m } = await fixture(t);
    const entry = m.clips[0], file = path.join(root, entry.url);
    const original = await fs.readFile(file);
    await fs.unlink(file);
    await assert.rejects(buildVoicePhraseIndex(p, m, root), /ENOENT/);
    const malformed = Buffer.from(original); malformed.writeUInt16LE(2, 22);
    await fs.writeFile(file, malformed);
    entry.sha256 = createHash('sha256').update(malformed).digest('hex');
    await assert.rejects(buildVoicePhraseIndex(p, m, root), /invalid or silent PCM/);
    await fs.writeFile(file, original);
    entry.sha256 = createHash('sha256').update(original).digest('hex');
    await fs.writeFile(path.join(root, 'audio/assistant/v1/en-orphan.wav'), original);
    await assert.rejects(buildVoicePhraseIndex(p, m, root), /unindexed recording/);
});

test('all product pages load the verified phrase bank before the command handler', async () => {
    for (const page of ['index', 'gallery', 'artwork', 'profile', 'upload', 'collection-builder', 'admin', 'docs-protocol']) {
        const html = await fs.readFile(`${page}.html`, 'utf8');
        assert.equal((html.match(/voice-phrase-bank\.js\?v=1/g) || []).length, 1, page);
        assert.ok(html.indexOf('/voice-phrase-bank.js') < html.indexOf('/voice-commands.js'), page);
    }
    const source = await fs.readFile('voice-commands.js', 'utf8');
    assert.doesNotMatch(source, /speechSynthesis|SpeechSynthesisUtterance/);
});
