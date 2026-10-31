// Tap tempo. The first tap is beat 1 of the bar; later taps set tempo and align the phase.
// While tapping (and TAP_HOLD_MS after), the audio analysis must not interfere: see isTapHeld().
import { $ } from './util.js';
import { send } from './link.js';

const TAP_HOLD_MS = 2000;   // = tap sequence timeout; analysis takes over once tapping stops
const MAX_TAPS = 9;
let taps = [], holdUntil = 0;
const listeners = [];

export const isTapHeld = () => performance.now() < holdUntil;
export const onTap = fn => listeners.push(fn);

export function tap() {
  const now = performance.now();
  holdUntil = now + TAP_HOLD_MS;
  if (taps.length && now - taps[taps.length - 1] > TAP_HOLD_MS) taps = [];
  taps = [...taps, now].slice(-MAX_TAPS);
  const bpm = taps.length >= 2 ? 60000 / ((now - taps[0]) / (taps.length - 1)) : null;
  send({ type: 'tap', bpm, first: taps.length === 1 });
  listeners.forEach(fn => fn());
}

export function initTap() {
  $('tap').onpointerdown = tap;
  addEventListener('keydown', e => {
    if (e.code === 'Space' && !e.repeat && !/INPUT|SELECT/.test(e.target.tagName)) { e.preventDefault(); tap(); }
  });
}
