const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

module.exports = async function silentAudio(durationSeconds) {
    const wav = await readFile(path.join(__dirname, '../../docs/design/study-assets/tone-demo.wav'));
    const samples = wav.indexOf('data', 36);
    assert(samples >= 36 && wav.readUInt16LE(20) === 1 && wav.readUInt16LE(34) === 16);
    if (durationSeconds === undefined) return wav.fill(0, samples + 8);
    assert(Number.isSafeInteger(durationSeconds) && durationSeconds > 0);
    const dataLength = wav.readUInt32LE(28) * durationSeconds;
    const silence = Buffer.alloc(samples + 8 + dataLength);
    wav.copy(silence, 0, 0, samples + 8);
    silence.writeUInt32LE(silence.length - 8, 4);
    silence.writeUInt32LE(dataLength, samples + 4);
    return silence;
};
