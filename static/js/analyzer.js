// Beat tracker for kick-driven music (techno). Pure logic, no DOM/audio APIs (runs in browser and Node).
// Input:  RMS of the kick band, one value per audio block (see rms-worklet.js).
// Output: { bpm, conf, valid, agoSamples } from analyse().
// Pipeline: onset strength -> coarse tempo (autocorrelation) -> fine tempo + phase (beat-grid fit)
//           -> lock logic (stable through breakdowns, follows slow drift, switches on real tempo changes).

const MIN_CONF = 1.8;           // grid score vs. average phase; below this the estimate is ignored
const DRIFT_TOLERANCE = 0.03;   // relative BPM deviation still treated as pitch drift of the locked tempo
const DRIFT_FOLLOW = 0.7;       // how fast the lock follows drift (0..1 per analysis)

export class Tracker {
  /** @param hop seconds per input value (128 / sampleRate) */
  constructor(hop, { minBpm = 120, maxBpm = 150, windowS = 10 } = {}) {
    Object.assign(this, { hop, minBpm, maxBpm, capacity: Math.ceil(windowS / hop) });
    // Scratch buffers are allocated once; analyse() runs twice a second and must not churn the GC.
    this.env = new Float64Array(this.capacity);
    this.tmp = new Float64Array(this.capacity);
    this.s = new Float64Array(this.capacity);
    this.x = new Float64Array(this.capacity);
    this.reset();
  }

  reset() {
    this.n = 0;           // valid samples in env
    this.prev = 0;
    this.lock = 0;        // locked BPM, 0 = searching
    this.cands = [];      // consecutive off-lock estimates
  }

  push(values) {
    const k = values.length, cap = this.capacity;
    if (this.n + k > cap) {                          // drop the oldest samples in one move
      const drop = Math.min(this.n, this.n + k - cap);
      this.env.copyWithin(0, drop, this.n);
      this.n -= drop;
    }
    for (let i = Math.max(0, k - cap); i < k; i++) {
      const l = Math.log1p(1000 * values[i]);
      this.env[this.n++] = Math.max(0, l - this.prev);   // half-wave flux of log energy
      this.prev = l;
    }
  }

  // Returns { bpm, conf, valid, agoSamples } or null while there is too little signal.
  analyse() {
    const n = this.n, hop = this.hop;
    if (n < 4 / hop) return null;
    const s = this.s, x = this.x;
    smooth(this.env, this.tmp, n);
    smooth(this.tmp, s, n);
    const lo = Math.floor(60 / this.maxBpm / hop), hi = Math.ceil(60 / this.minBpm / hop);

    const bestLag = this.coarseLag(n, lo, hi);
    if (!bestLag) return { bpm: this.lock, conf: 0, valid: false };

    const { period: bp, phase: bphi, score: bscore } = fitGrid(s, n, bestLag);
    // confidence: how much stronger is the best grid than an average phase of the same period
    let avg = 0, m = 0;
    for (let phi = 0; phi < bp; phi += 2) { avg += gridScore(s, n, bp, phi); m++; }
    const conf = bscore / (avg / m + 1e-9);
    if (conf < MIN_CONF) return { bpm: this.lock, conf, valid: false };

    this.track(60 / (bp * hop), conf);
    const lastBeat = bphi + Math.floor((n - 1 - bphi) / bp) * bp;
    return { bpm: this.lock, conf, valid: this.lock > 0, agoSamples: n - 1 - lastBeat };
  }

  // Coarse tempo: autocorrelation of the onset curve, reinforced by multiples of the lag
  // (a kick grid repeats every bar too), weighted towards the middle of the BPM range.
  coarseLag(n, lo, hi) {
    const { s, x, hop } = this;
    let mean = 0; for (let i = 0; i < n; i++) mean += s[i]; mean /= n;
    for (let i = 0; i < n; i++) x[i] = s[i] - mean;
    const ac = lag => {
      if (lag >= n / 2) return 0;
      let sum = 0; for (let i = lag; i < n; i++) sum += x[i] * x[i - lag];
      return sum / (n - lag);
    };
    const comb = [];
    for (let lag = lo - 1; lag <= hi + 1; lag++) comb[lag] = ac(lag) + 0.5 * ac(2 * lag) + 0.25 * ac(4 * lag);
    const centre = Math.sqrt(this.minBpm * this.maxBpm);
    let bestLag = 0, best = 0;
    for (let lag = lo; lag <= hi; lag++) {
      if (comb[lag] < comb[lag - 1] || comb[lag] < comb[lag + 1]) continue;
      const w = Math.exp(-0.5 * (Math.log2(60 / (lag * hop) / centre) / 0.5) ** 2);
      if (comb[lag] * w > best) { best = comb[lag] * w; bestLag = lag; }
    }
    return bestLag;
  }

  // Lock logic. Small deviations follow smoothly; real tempo changes need several consistent estimates.
  track(bpm, conf) {
    const L = this.lock;
    if (L && Math.abs(bpm - L) / L < DRIFT_TOLERANCE) {
      this.lock = L + DRIFT_FOLLOW * (bpm - L);
      this.cands = [];
      return;
    }
    const last = this.cands[this.cands.length - 1];
    this.cands = last && Math.abs(bpm - last) / last < 0.01 ? [...this.cands, bpm] : [bpm];
    if (this.cands.length >= (L ? 4 : conf >= 6 ? 2 : 3)) {
      this.lock = this.cands.reduce((a, b) => a + b) / this.cands.length;
      this.cands = [];
    }
  }
}

// Mean onset energy on a beat grid (period p, phase phi, both in samples; linear interpolation).
function gridScore(s, n, p, phi) {
  let sum = 0, cnt = 0;
  for (let k = phi; k < n - 1; k += p) {
    const i = Math.floor(k), f = k - i;
    sum += s[i] * (1 - f) + s[i + 1] * f; cnt++;
  }
  return cnt ? sum / cnt : 0;
}

// Fit period and phase of a beat grid around the coarse lag: coarse sweep of +-2%, then a fine sweep around the best.
function fitGrid(s, n, lag) {
  let best = { period: lag, phase: 0, score: -1 };
  const sweep = (from, to, step) => {
    for (let p = from; p <= to; p += step) {
      for (let phi = 0; phi < p; phi += 1) {
        const score = gridScore(s, n, p, phi);
        if (score > best.score) best = { period: p, phase: phi, score };
      }
    }
  };
  sweep(lag * 0.98, lag * 1.02, lag * 0.004);
  const c = best.period;
  sweep(c - lag * 0.004, c + lag * 0.004, lag * 0.0004);
  return best;
}

// [1 2 1] / 4 smoothing of src[0..n) into dst.
function smooth(src, dst, n) {
  for (let i = 0; i < n; i++) dst[i] = (src[i > 0 ? i - 1 : 0] + 2 * src[i] + src[i < n - 1 ? i + 1 : n - 1]) / 4;
}
