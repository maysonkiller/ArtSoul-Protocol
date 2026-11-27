// PCM16 capture for the local pilot. Audio never persists in browser storage.
class ArtSoulLiveCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(480);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      const value = Math.max(-1, Math.min(1, sample));
      this.samples[this.offset++] = Math.round(value * (value < 0 ? 32768 : 32767));
      if (this.offset === this.samples.length) {
        this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
        this.samples = new Int16Array(480);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('artsoul-live-capture', ArtSoulLiveCapture);
