#!/usr/bin/env node
// Offline only: generate a lookup from reviewed scripts and verified local Marin WAVs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hash = data => createHash('sha256').update(data).digest('hex');
const normalized = text => String(text).normalize('NFKC').toLowerCase()
    .replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const urlPattern = /^\/audio\/assistant\/v1\/(?:phrases\/)?(en|ru)-([a-z][a-zA-Z0-9]*)\.wav$/;
const fail = message => { throw new Error(`Invalid voice bank: ${message}`); };

async function localFile(publicRoot, url) {
    if (!urlPattern.test(url)) fail('unsafe recording path');
    const root = await fs.realpath(path.resolve(publicRoot));
    const segments = url.slice(1).split('/');
    let current = root;
    for (const segment of segments) {
        current = path.join(current, segment);
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) fail('linked recording path');
        if (segment !== segments.at(-1) && !stat.isDirectory()) fail('invalid recording directory');
    }
    const stat = await fs.lstat(current);
    if (!stat.isFile() || stat.size <= 44 || stat.size > 44 + 60 * 48000) fail('invalid recording file size');
    if (path.resolve(await fs.realpath(current)) !== current) fail('redirected recording path');
    return fs.readFile(current);
}

export async function buildVoicePhraseIndex(phrases, manifest, publicRoot) {
    if (phrases?.version !== 1 || phrases.voice !== 'marin' || typeof phrases.model !== 'string' || !phrases.model.trim() || !Array.isArray(phrases.clips)
        || !phrases.clips.length || phrases.clips.length > 600) fail('phrase catalog');
    if (manifest?.version !== 1 || manifest.voice !== 'marin' || manifest.model !== phrases.model || manifest.sample_rate !== 24000
        || !Array.isArray(manifest.clips) || manifest.clips.length > phrases.clips.length) fail('manifest');
    const byUrl = new Map(), texts = new Set(), pairs = new Map();
    for (const clip of phrases.clips) {
        const match = typeof clip?.url === 'string' && urlPattern.exec(clip.url);
        if (!match || clip.lang !== match[1] || clip.id !== match[2]
            || typeof clip.text !== 'string' || !clip.text.trim() || clip.text.length > 800) fail('phrase identity');
        const key = `${clip.lang}:${normalized(clip.text)}`;
        if (byUrl.has(clip.url) || texts.has(key)) fail('duplicate phrase');
        const languages = pairs.get(clip.id) || new Set();
        if (languages.has(clip.lang)) fail('duplicate language');
        languages.add(clip.lang); pairs.set(clip.id, languages);
        byUrl.set(clip.url, clip); texts.add(key);
    }
    for (const languages of pairs.values()) if (languages.size !== 2) fail('missing language pair');
    const recorded = new Map(), bytes = new Map(), hashes = new Set();
    for (const entry of manifest.clips) {
        const clip = byUrl.get(entry?.url);
        if (!clip || entry.id !== clip.id || entry.lang !== clip.lang || entry.text !== clip.text
            || entry.voice !== 'marin' || entry.model !== phrases.model
            || typeof entry.transcript !== 'string' || normalized(entry.transcript) !== normalized(clip.text)
            || !/^[a-f0-9]{64}$/.test(entry.sha256 || '') || recorded.has(entry.url)) fail('recording receipt');
        const audio = await localFile(publicRoot, entry.url);
        if (hash(audio) !== entry.sha256 || entry.bytes !== audio.length || hashes.has(entry.sha256)) fail('recording digest or duplicate bytes');
        if (audio.length <= 44 || audio.length > 44 + 60 * 48000 || (audio.length - 44) % 2
            || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.readUInt32LE(4) !== audio.length - 8
            || audio.toString('ascii', 8, 16) !== 'WAVEfmt ' || audio.readUInt32LE(16) !== 16
            || audio.readUInt16LE(20) !== 1 || audio.readUInt16LE(22) !== 1
            || audio.readUInt32LE(24) !== 24000 || audio.readUInt32LE(28) !== 48000
            || audio.readUInt16LE(32) !== 2 || audio.readUInt16LE(34) !== 16
            || audio.toString('ascii', 36, 40) !== 'data' || audio.readUInt32LE(40) !== audio.length - 44
            || !Number.isFinite(entry.duration_seconds)
            || Math.abs(entry.duration_seconds - (audio.length - 44) / 48000) > 0.011
            || !audio.subarray(44).some(value => value !== 0)) fail('invalid or silent PCM');
        recorded.set(entry.url, entry); bytes.set(entry.url, audio); hashes.add(entry.sha256);
    }
    for (const entry of recorded.values()) {
        if (!entry.derived_from) continue;
        const source = recorded.get(entry.derived_from.url), audio = bytes.get(entry.url);
        const original = bytes.get(entry.derived_from.url);
        if (!source || source.sha256 !== entry.derived_from.sha256 || source.lang !== entry.lang
            || entry.derived_from.pcm_start !== 0 || entry.derived_from.pcm_bytes !== audio.length - 44
            || !source.text.startsWith(entry.text)
            || !audio.subarray(44).equals(original.subarray(44, audio.length))) fail('invalid excerpt provenance');
    }
    const audioRoot = path.join(path.resolve(publicRoot), 'audio/assistant/v1');
    async function checkFiles(directory) {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const full = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) fail('linked audio inventory');
            if (entry.isDirectory()) { await checkFiles(full); continue; }
            if (!entry.name.endsWith('.wav')) continue;
            const url = '/' + path.relative(publicRoot, full).split(path.sep).join('/');
            if (!recorded.has(url)) fail('unindexed recording');
        }
    }
    await checkFiles(audioRoot);
    const data = phrases.clips.map(clip => [clip.id, clip.lang, clip.text, recorded.has(clip.url) ? clip.url : '']);
    return `// Generated by scripts/build-voice-phrase-index.mjs. Do not edit by hand.\n` +
        `(function () {\n    'use strict';\n    const rows = ${JSON.stringify(data)};\n` +
        `    const byId = new Map(), english = new Map();\n` +
        `    for (const [id, lang, text, url] of rows) {\n` +
        `        byId.set(id + ':' + lang, Object.freeze({id, lang, text, url}));\n` +
        `        if (lang === 'en') english.set(text, id);\n    }\n` +
        `    window.ArtSoulVoicePhraseBank = Object.freeze({\n` +
        `        voice: 'marin', phraseCount: ${data.length}, recordingCount: ${recorded.size},\n` +
        `        text: (id, lang = 'en') => byId.get(id + ':' + lang)?.text || '',\n` +
        `        lookup: (text, lang = 'en') => {\n` +
        `            if (lang !== 'en' && lang !== 'ru') return '';\n` +
        `            const id = english.get(text);\n` +
        `            return id ? byId.get(id + ':' + lang)?.url || '' : '';\n` +
        `        }\n    });\n})();\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const read = file => fs.readFile(path.join(root, file), 'utf8').then(JSON.parse);
    const output = await buildVoicePhraseIndex(await read('docs/audio/assistant-phrase-bank.json'),
        await read('public/audio/assistant/v1/manifest.json'), path.join(root, 'public'));
    const file = path.join(root, 'voice-phrase-bank.js');
    if (process.argv.includes('--write')) await fs.writeFile(file, output);
    else if ((await fs.readFile(file, 'utf8')).replace(/\r/g, '') !== output) fail('runtime index is stale');
    console.log('Voice phrase index and local WAV inventory verified.');
}
