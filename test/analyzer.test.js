// Synthetic techno scenarios: npm test. Exits non-zero when a scenario misses the limits below.
const LIMITS = { bpmErr: 0.3, phaseErrMs: 6, biasMs: 3, minValidShare: 0.8 };
let failed = 0;
import { Tracker } from '../static/js/analyzer.js';
const sr = 48000, hop = 128 / sr;
const KICK_GAP = 0.003;   // silence before the kick body: the audible onset is this long after the grid point
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// A deck plays kicks (sharp) and optional offbeat bass (soft attack) at a given tempo/offset, with gain over time.
const deck = (bpm, off, o = {}) => ({ bpm, off, kick: 0.6, bass: 0, drift: 0, every: 1, gain: () => 1, ...o });   // every: kick on every n-th beat
const env = (d, t) => {                                    // contribution of a deck at time t
  const g = d.gain(t); if (g <= 0) return 0;
  const u = t - d.off, bpm = d.bpm * (1 + d.drift * u / 60);
  const beats = u * d.bpm / 60 + d.bpm * d.drift * u * u / 7200, ph = beats - Math.floor(beats);
  const ts = ph * 60 / bpm;                                // seconds since last kick
  let v = ts < KICK_GAP || Math.floor(beats) % d.every ? 0 : d.kick * Math.exp(-ts / 0.07);
  if (d.bass) { const tb = ((ph + 0.5) % 1) * 60 / bpm; v += d.bass * (1 - Math.exp(-tb / 0.012)) * Math.exp(-tb / 0.15); }
  return v * g;
};

function run(name, decks, dur, opts, expectBpm, truth) {
  const tr = new Tracker(hop, opts);
  let clock = 0, buf = [], log = [], firstLock = null;
  while (clock < dur) {
    let v = 0.08 + rnd() * 0.02; for (const d of decks) v += env(d, clock);
    buf.push(v); clock += hop;
    if (buf.length === 16) {
      tr.push(buf); buf = [];
      if (Math.round(clock / (16 * hop)) % Math.round(1 / (16 * hop)) === 0) {
        const r = tr.analyse();
        if (r) {
          const d0 = decks[truth || 0], u = clock - hop - KICK_GAP - d0.off, bpm = d0.bpm * (1 + d0.drift * u / 60);
          const P = 60 / bpm / hop, beats = u * d0.bpm / 60 + d0.bpm * d0.drift * u * u / 7200;
          const trueAgo = (beats - Math.floor(beats)) * P;
          let e = r.valid ? (r.agoSamples - trueAgo) % P : NaN;
          if (e > P / 2) e -= P; if (e < -P / 2) e += P;
          log.push({ t: clock, ...r, errMs: e * hop * 1000, trueBpm: bpm });
          if (r.valid && firstLock === null) firstLock = clock;
        }
      }
    }
  }
  const tail = log.filter(x => x.t > dur - 10 && x.valid);
  const bpmErr = tail.length ? Math.max(...tail.map(x => Math.abs(x.bpm - (expectBpm ?? x.trueBpm)))) : NaN;
  const phErr = tail.length ? Math.max(...tail.map(x => Math.abs(x.errMs))) : NaN;
  const recent = log.filter(x => x.t > dur - 10).length;
  const bias = tail.reduce((a, x) => a + x.errMs, 0) / (tail.length || 1);
  const ok = bpmErr <= LIMITS.bpmErr && phErr <= LIMITS.phaseErrMs && Math.abs(bias) <= LIMITS.biasMs
    && tail.length >= LIMITS.minValidShare * recent;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(34)} lock@${firstLock?.toFixed(0) ?? '-'}s  bpmErr<=${bpmErr.toFixed(2)}  phaseErr<=${phErr.toFixed(0)}ms (mean ${bias.toFixed(1)}) valid=${tail.length}/${recent}`);
}

// Scenarios without a beat: the tracker must never report a lock. `noise` is the floor level (default in run()).
function runSilent(name, level, dur) {
  const tr = new Tracker(hop, T);
  let buf = [], valid = 0, total = 0;
  for (let i = 0; i < dur / hop; i++) {
    buf.push(level(i * hop)); 
    if (buf.length === 16) {
      tr.push(buf); buf = [];
      if ((i + 1) % Math.round(1 / (16 * hop)) === 0) { const r = tr.analyse(); if (r) { total++; if (r.valid) valid++; } }
    }
  }
  const ok = valid === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(34)} valid=${valid}/${total}`);
}

const T = {};
run('clean 133.7', [deck(133.7, 0.21)], 40, T, 133.7);
run('clean 128 (wide range)', [deck(128, 0.33)], 40, { minBpm: 70, maxBpm: 180 }, 128);
run('offbeat bass 0.5', [deck(135, 0.21, { bass: 0.5 })], 40, T, 135);
run('offbeat bass 0.9 (> kick)', [deck(135, 0.21, { bass: 0.9 })], 40, T, 135);
run('offbeat bass 0.9, wide range', [deck(135, 0.21, { bass: 0.9 })], 40, { minBpm: 70, maxBpm: 180 }, 135);
run('pitch drift +1%/min', [deck(132, 0.1, { drift: 0.01 })], 60, T);
run('transition 130 -> 131.5 (2 decks)', [
  deck(130, 0.21, { gain: t => Math.max(0, 1 - Math.max(0, t - 20) / 20) }),
  deck(131.5, 0.37, { gain: t => Math.min(1, Math.max(0, (t - 15) / 20)) }),
], 60, T, 131.5, 1);
run('breakdown 16s then return', [deck(138, 0.21, { gain: t => (t > 20 && t < 36 ? 0 : 1) })], 60, T, 138);

// Edge cases
run('half-time kick (every 2nd beat)', [deck(130, 0.21, { every: 2 })], 40, T, 130);
run('abrupt change 128 -> 140 (cut)', [
  deck(128, 0.21, { gain: t => (t < 25 ? 1 : 0) }),
  deck(140, 0.37, { gain: t => (t < 25 ? 0 : 1) }),
], 60, T, 140, 1);
run('quiet kick (0.05 over noise 0.08)', [deck(133, 0.21, { kick: 0.05 })], 40, T, 133);
runSilent('silence', () => 0, 30);
runSilent('noise floor only', () => 0.08 + rnd() * 0.02, 30);
runSilent('out of range 100 BPM (techno)', t => { // looks like a real kick track, just outside 120-150
  const ph = (t * 100 / 60) % 1; return 0.08 + 0.6 * Math.exp(-ph * 0.6 / 0.07);
}, 40);

if (failed) { console.error(`${failed} scenario(s) failed`); process.exit(1); }
