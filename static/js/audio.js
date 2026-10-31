// Audio analysis: input device -> kick-band filter -> RMS worklet -> Tracker -> tempo/phase to the Link server.
// Everything is driven by the audio clock (worklet messages), never by timers: timers get throttled in background tabs.
import { $, store } from './util.js';
import { link, send, setBpm } from './link.js';
import { isTapHeld, resetTaps } from './tap.js';

const BLOCK = 128;                  // samples per worklet block
const PHASE_EVERY_MS = 2000;

const BPM_EPSILON = 0.05;
const KICK_BAND = { highpass: 45, lowpass: 120 };   // Hz
const KICK_CENTRE_HZ = 60;          // where the filter chain's group delay is measured

let ctx, stream, node, worker;
let filterDelayMs = 0;
let tOffset, lastPhaseSent = 0;
let level = 0, meterQueued = false;

/** Allow an immediate phase correction (called after tapping). */
export const resetPhaseTimer = () => { lastPhaseSent = 0; };

async function listDevices() {
  const keep = store.get('audioDev', '');
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
  $('aDev').innerHTML = '<option value="">Standard-Eingang</option>';
  devs.forEach(d => $('aDev').add(new Option(d.label || 'Eingang', d.deviceId)));
  $('aDev').value = keep;
}

// Group delay of a filter chain at one frequency, from the browser's own phase response: -dphi/domega.
function groupDelayMs(filters, hz) {
  const d = 1, freq = Float32Array.of(hz - d, hz + d), mag = new Float32Array(2), phase = new Float32Array(2);
  return filters.reduce((sum, f) => {
    f.getFrequencyResponse(freq, mag, phase);
    return sum - (phase[1] - phase[0]) / (2 * Math.PI * 2 * d) * 1000;
  }, 0);
}

// Shown next to the status text: off | search | locked | hold (locked, but no kick right now) | error
const setInfo = (text, state) => { $('aInfo').textContent = text; $('aInfo').dataset.state = state; };

async function start() {
  const id = $('aDev').value;
  stream = await navigator.mediaDevices.getUserMedia({ audio: {
    deviceId: id ? { exact: id } : undefined,
    echoCancellation: false, noiseSuppression: false, autoGainControl: false,
  } });
  await listDevices();
  stream.getAudioTracks()[0].onended = onInputLost;   // device unplugged or permission revoked
  ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.resume();   // Safari starts suspended when created after an await
  ctx.onstatechange = () => { if (ctx?.state === 'suspended' || ctx?.state === 'interrupted') ctx.resume().catch(() => {}); };
  await ctx.audioWorklet.addModule(new URL('./rms-worklet.js', import.meta.url));
  const filter = (type, frequency) => new BiquadFilterNode(ctx, { type, frequency, Q: 0.7 });
  node = new AudioWorkletNode(ctx, 'rms');
  // kick band only: high-pass + steep low-pass (2 stages)
  const chain = [filter('highpass', KICK_BAND.highpass), filter('lowpass', KICK_BAND.lowpass), filter('lowpass', KICK_BAND.lowpass)];
  filterDelayMs = groupDelayMs(chain, KICK_CENTRE_HZ);
  chain.reduce((from, to) => from.connect(to), ctx.createMediaStreamSource(stream)).connect(node);
  const [minBpm, maxBpm] = $('aRange').value.split(',').map(Number);
  worker = new Worker(new URL('./tracker-worker.js', import.meta.url), { type: 'module' });
  worker.postMessage({ init: { hop: BLOCK / ctx.sampleRate, minBpm, maxBpm } });
  worker.onmessage = e => onAnalysis(e.data);
  tOffset = Infinity;
  node.port.onmessage = e => onBlocks(e.data);
  setInfo('Höre zu…', 'search');
}

function stop() {
  node?.disconnect(); stream?.getTracks().forEach(t => t.stop()); ctx?.close(); worker?.terminate();
  ctx = stream = node = worker = null;
  level = 0; paintMeter();
  setInfo('Aus', 'off');
}

// The input vanished (USB interface unplugged, ...): tear down and wait for a device to show up again.
function onInputLost() {
  if (!stream) return;
  stop();
  setInfo('Eingang getrennt – warte auf Gerät…', 'error');
}

// A device was plugged in: resume the analysis if we are waiting for one (switched on, but not running).
let reconnecting = false;
async function onDeviceChange() {
  if (!$('aOn').checked || ctx || reconnecting) return;
  reconnecting = true;
  try { await start(); } catch { setInfo('Eingang getrennt – warte auf Gerät…', 'error'); }
  reconnecting = false;
}

const restart = async () => { if ($('aOn').checked) { stop(); await start(); } };

function onBlocks({ t, v }) {
  // map audio clock -> performance clock (min tracks the least-delayed message)
  tOffset = Math.min(tOffset, performance.now() - t * 1000);
  level = Math.max(...v);
  queueMeter();
  worker.postMessage({ t, v }, [v.buffer]);   // the worker buffers and analyses on its own schedule
}

// The level meter repaints at most once per frame, and not at all while the tab is hidden (rAF is paused there).
function queueMeter() {
  if (meterQueued) return;
  meterQueued = true;
  requestAnimationFrame(() => { meterQueued = false; paintMeter(); });
}
const paintMeter = () => { $('level').style.transform = `scaleX(${Math.min(1, level * 4)})`; };

function onAnalysis({ t, lock, hop, result: r }) {
  if (!worker) return;   // stale message after stop()
  const pct = Math.min(100, Math.round(r.conf / 6 * 100));
  if (!r.valid) {
    if (lock) setInfo(`Gelockt ${lock.toFixed(1)} BPM – kein Kick (Breakdown?), halte Tempo`, 'hold');
    else setInfo(`Suche Tempo… (Sicherheit ${pct}%)`, 'search');
    return;
  }
  const held = isTapHeld();
  setInfo(`Gelockt: ${r.bpm.toFixed(1)} BPM · Sicherheit ${pct}%` + (held ? ' · pausiert (Tap)' : ''), 'locked');
  if (held) return;
  if (Math.abs(r.bpm - link.bpm) > BPM_EPSILON) setBpm(Math.round(r.bpm * 100) / 100);
  if ($('aPhase').checked && performance.now() - lastPhaseSent > PHASE_EVERY_MS) {
    const agoMs = r.agoSamples * hop * 1000
      + (performance.now() - (tOffset + t * 1000))   // delay: worklet -> main -> worker -> main
      + (ctx.baseLatency || 0) * 1000 + filterDelayMs + (+$('aLat').value || 0);
    send({ type: 'phase', ago_ms: agoMs });
    lastPhaseSent = performance.now();
  }
}

/** Forget the locked tempo and the tap sequence and search again. Tempo and bar position in Link stay as they are. */
export function resetSync() {
  resetTaps();
  lastPhaseSent = 0;
  if (worker) { worker.postMessage({ reset: true }); setInfo('Suche Tempo…', 'search'); }
}

export function initAudio() {
  $('resetSync').onclick = resetSync;
  navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);
  $('aLat').value = store.get('lat', 0);
  $('aLat').onchange = e => store.set('lat', +e.target.value);
  $('aDev').onchange = e => { store.set('audioDev', e.target.value); restart(); };
  $('aRange').value = store.get('range', '120,150');
  $('aRange').onchange = e => { store.set('range', e.target.value); restart(); };
  $('aOn').onchange = async e => {
    if (!e.target.checked) return stop();
    try { await start(); } catch (err) {
      e.target.checked = false;
      setInfo(err.name === 'NotAllowedError'
        ? 'Mikrofon-Zugriff blockiert. Schloss-Symbol in der Adressleiste → Mikrofon erlauben, und in den Systemeinstellungen → Datenschutz → Mikrofon den Browser freigeben. Danach Seite neu laden.'
        : 'Audio-Fehler: ' + err.message, 'error');
    }
  };
}
