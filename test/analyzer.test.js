// Synthetic techno check: node test/analyzer.test.js
const { Tracker } = require('../static/analyzer.js');
const sr = 48000, hop = 128 / sr;
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// segments: {bpm, dur, kick} ; returns rms-per-block generator
function run(name, segs, opts, expect) {
  const tr = new Tracker(hop, opts);
  let t = 0.21, nextKick = t, bpmNow = segs[0].bpm, buf = [], clock = 0, kicks = [], log = [];
  let tEnd = 0;
  for (const seg of segs) {
    tEnd += seg.dur;
    while (clock < tEnd) {
      if (clock >= nextKick) { if (seg.kick) kicks.push(nextKick); nextKick += 60 / seg.bpm; }
      const sinceKick = kicks.length ? clock - kicks[kicks.length - 1] : 9;
      const kick = seg.kick ? Math.exp(-sinceKick / 0.07) * 0.6 : 0;
      const offHat = Math.abs(((clock - 0.21) * seg.bpm / 60) % 1 - 0.5) < 0.01 ? 0.03 : 0;
      buf.push(0.08 + kick + offHat + rnd() * 0.02);
      clock += hop;
      if (buf.length === 16) { tr.push(buf); buf = []; if (Math.round(clock * 100) % 100 < 3) { const r = tr.analyse(); if (r) log.push({ t: clock, ago: (clock - kicks[kicks.length - 1]) / hop, ...r }); } }
    }
  }
  const last = log[log.length - 1];
  const lastKick = kicks[kicks.length - 1], seg0 = segs.every(x => x.kick);
  console.log(`${name}: bpm=${last.bpm.toFixed(2)} (expect ${expect}) conf=${last.conf.toFixed(2)} valid=${last.valid}`);
  if (seg0) { const ago = last.ago, P = 60 / segs[segs.length-1].bpm / hop;
    let d = (last.agoSamples - ago) % P; if (d > P / 2) d -= P; if (d < -P / 2) d += P;
    console.log(`  phase error: ${(d * hop * 1000).toFixed(1)} ms`); }
  return { tr, log, last };
}

run('steady 133.7', [{ bpm: 133.7, dur: 40, kick: true }], {}, 133.7);
run('steady 128', [{ bpm: 128, dur: 40, kick: true }], {}, 128);
run('steady 146', [{ bpm: 146, dur: 40, kick: true }], {}, 146);
const r = run('tempo change 130->141', [{ bpm: 130, dur: 30, kick: true }, { bpm: 141, dur: 40, kick: true }], {}, 141);
const b = run('breakdown holds lock', [{ bpm: 135, dur: 30, kick: true }, { bpm: 135, dur: 10, kick: false }], {}, 135);
console.log('  breakdown valid flags (last 5):', b.log.slice(-5).map(x => x.valid + '/' + x.conf.toFixed(1)).join(' '));
