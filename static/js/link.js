// WebSocket connection to server.py: shows the Link state and sends commands.
// Server -> client: { bpm, beat (int, position in bar), quantum, peers }. Client -> server: see server.py handle().
import { $ } from './util.js';

const RECONNECT_MS = 1000;
let ws, lastState = null;

export const link = { bpm: 120 };   // latest tempo reported by the server

export const send = msg => ws?.readyState === 1 && ws.send(JSON.stringify(msg));
export const setBpm = bpm => send({ type: 'tempo', bpm });

function render(s) {
  $('bpm').textContent = s.bpm.toFixed(1);
  [...$('dots').children].forEach((d, i) => d.classList.toggle('on', i === s.beat));
  $('peers').textContent = `${s.peers} Peer${s.peers === 1 ? '' : 's'} im Link-Netzwerk`;
}

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = e => {
    lastState = JSON.parse(e.data);
    link.bpm = lastState.bpm;
    if (!document.hidden) render(lastState);   // nothing to paint in a background tab
  };
  ws.onclose = () => {
    lastState = null;
    $('bpm').textContent = '--';   // do not show a stale tempo while the server is away
    $('peers').textContent = 'Getrennt – verbinde neu…';
    setTimeout(connect, RECONNECT_MS);
  };
}

export function initLink() {
  for (let i = 0; i < 4; i++) { const d = document.createElement('div'); d.className = 'dot'; $('dots').append(d); }
  $('minus').onclick = () => setBpm(link.bpm - 1);
  $('plus').onclick = () => setBpm(link.bpm + 1);
  $('bpmIn').onchange = e => e.target.value && setBpm(+e.target.value);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && lastState) render(lastState); });
  connect();
}
