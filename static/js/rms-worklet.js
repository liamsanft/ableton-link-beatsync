// AudioWorklet: RMS per 128-sample block, posted in batches of BATCH blocks (~43 ms at 48 kHz).
// Batching keeps main-thread wakeups low; `t` is the audio-clock time of the batch end.
const BATCH = 16;

class Rms extends AudioWorkletProcessor {
  constructor() { super(); this.reset(); }

  reset() { this.buf = new Float32Array(BATCH); this.n = 0; }

  process(inputs) {
    const ch = inputs[0][0];
    if (!ch) return true;
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    this.buf[this.n++] = Math.sqrt(sum / ch.length);
    if (this.n === BATCH) {
      this.port.postMessage({ t: currentTime, v: this.buf }, [this.buf.buffer]);
      this.reset();
    }
    return true;
  }
}
registerProcessor('rms', Rms);
