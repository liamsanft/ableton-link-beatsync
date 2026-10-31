// Web Worker: runs the Tracker off the main thread (UI jank cannot delay the analysis, and vice versa).
// main -> worker  { init: { hop, minBpm, maxBpm } } | { reset: true } | { t, v: Float32Array }  (audio-clock time + RMS batch)
// worker -> main  { t, lock, hop, result }  result = Tracker.analyse() output, `t` = audio time of its newest sample
import { Tracker } from './analyzer.js';

const ANALYSE_EVERY_S = 0.5;
let tracker, lastAnalysedT = 0;

onmessage = ({ data }) => {
  if (data.init) {
    const { hop, ...opts } = data.init;
    tracker = new Tracker(hop, opts);
    lastAnalysedT = 0;
    return;
  }
  if (!tracker) return;
  if (data.reset) { tracker.reset(); return; }
  tracker.push(data.v);
  if (data.t - lastAnalysedT < ANALYSE_EVERY_S) return;
  lastAnalysedT = data.t;
  const result = tracker.analyse();
  if (result) postMessage({ t: data.t, lock: tracker.lock, hop: tracker.hop, result });
};
