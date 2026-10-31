// Beat tracker for kick-driven music (techno). Input: RMS of the kick band, one value per audio block.
// Pipeline: onset strength -> coarse tempo (autocorrelation) -> fine tempo + phase (beat-grid fit)
//           -> lock logic (stable through breakdowns, follows slow drift, switches on real tempo changes).
class Tracker {
  constructor(hop, { minBpm = 120, maxBpm = 150, windowS = 10 } = {}) {
    Object.assign(this, { hop, minBpm, maxBpm, max: Math.ceil(windowS / hop) });
    this.reset();
  }

  reset() {
    this.env = [];
    this.prev = 0;
    this.lock = 0;        // locked BPM, 0 = searching
    this.cands = [];      // consecutive off-lock estimates
  }

  push(values) {
    for (const x of values) {
      const l = Math.log1p(1000 * x);
      this.env.push(Math.max(0, l - this.prev));   // half-wave flux of log energy
      this.prev = l;
    }
    if (this.env.length > this.max) this.env.splice(0, this.env.length - this.max);
  }

  // Returns { bpm, conf, valid, agoSamples } or null while there is too little signal.
  analyse() {
    const n = this.env.length, hop = this.hop;
    if (n < 4 / hop) return null;
    const s = smooth(smooth(this.env));
    const lo = Math.floor(60 / this.maxBpm / hop), hi = Math.ceil(60 / this.minBpm / hop);

    // coarse: autocorrelation, reinforced by multiples of the lag (a kick grid repeats every bar too)
    let mean = 0; for (const v of s) mean += v; mean /= n;
    const x = s.map(v => v - mean);
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
    if (!bestLag) return { bpm: this.lock, conf: 0, valid: false };

    // fine: fit period and phase of a beat grid to the onset curve (mean energy on the grid)
    const gridScore = (p, phi) => {
      let sum = 0, cnt = 0;
      for (let k = phi; k < n - 1; k += p) {
        const i = Math.floor(k), f = k - i;
        sum += s[i] * (1 - f) + s[i + 1] * f; cnt++;
      }
      return cnt ? sum / cnt : 0;
    };
    let bp = bestLag, bphi = 0, bscore = -1;
    for (let p = bestLag * 0.98; p <= bestLag * 1.02; p += bestLag * 0.0004) {
      for (let phi = 0; phi < p; phi += 1) {
        const sc = gridScore(p, phi);
        if (sc > bscore) { bscore = sc; bp = p; bphi = phi; }
      }
    }
    // confidence: how much stronger is the best grid than an average phase of the same period
    let avg = 0, m = 0;
    for (let phi = 0; phi < bp; phi += 2) { avg += gridScore(bp, phi); m++; }
    const conf = bscore / (avg / m + 1e-9);
    const bpm = 60 / (bp * hop);
    const valid = conf >= 1.8;
    if (!valid) return { bpm: this.lock, conf, valid: false };

    this.track(bpm, conf);
    const lastBeat = bphi + Math.floor((n - 1 - bphi) / bp) * bp;
    return { bpm: this.lock, conf, valid: this.lock > 0, agoSamples: n - 1 - lastBeat };
  }

  track(bpm, conf) {
    const L = this.lock;
    if (L && Math.abs(bpm - L) / L < 0.03) {         // small deviation = pitch drift: follow smoothly
      this.lock = L + 0.7 * (bpm - L);
      this.cands = [];
      return;
    }
    // search / tempo change: need several consistent estimates before switching
    const last = this.cands[this.cands.length - 1];
    this.cands = last && Math.abs(bpm - last) / last < 0.01 ? [...this.cands, bpm] : [bpm];
    if (this.cands.length >= (L ? 4 : conf >= 6 ? 2 : 3)) {
      this.lock = this.cands.reduce((a, b) => a + b) / this.cands.length;
      this.cands = [];
    }
  }
}

function smooth(a) {
  const o = new Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = (a[Math.max(0, i - 1)] + 2 * a[i] + a[Math.min(a.length - 1, i + 1)]) / 4;
  return o;
}

if (typeof module !== 'undefined') module.exports = { Tracker };
