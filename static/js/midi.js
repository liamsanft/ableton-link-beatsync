// Web MIDI: pick a device, learn one note/CC that triggers a tap.
import { $, store } from './util.js';
import { tap } from './tap.js';

const NO_DEVICE = '<option value="">MIDI: kein Gerät</option>';
let midi, learning = false, mapping = store.get('midiMap', null);

const showMap = () => $('midiMap').textContent = mapping
  ? `Zuweisung: ${mapping.cc ? 'CC' : 'Note'} ${mapping.d1} (Kanal ${mapping.ch + 1})` : 'Keine Zuweisung';

function onMidi(e) {
  const [st, d1, d2] = e.data;
  const type = st & 0xf0, ch = st & 0x0f;
  const isNote = type === 0x90 && d2 > 0, isCC = type === 0xb0 && d2 > 0;
  if (!isNote && !isCC) return;
  if (learning) {
    mapping = { cc: isCC, d1, ch };
    store.set('midiMap', mapping);
    learning = false; $('learn').textContent = 'MIDI Learn'; showMap();
  } else if (mapping && mapping.cc === isCC && mapping.d1 === d1 && mapping.ch === ch) tap();
}

function bindDevice() {
  const id = $('midiDev').value;
  store.set('midiDev', id);
  midi.inputs.forEach(i => { i.onmidimessage = i.id === id ? onMidi : null; });
}

function listDevices() {
  const keep = store.get('midiDev', '');
  $('midiDev').innerHTML = NO_DEVICE;
  midi.inputs.forEach(i => $('midiDev').add(new Option(i.name, i.id)));
  $('midiDev').value = keep;
  bindDevice();
}

export function initMidi() {
  showMap();
  $('learn').onclick = () => {
    learning = !learning;
    $('learn').textContent = learning ? 'Warte auf MIDI…' : 'MIDI Learn';
  };
  if (!navigator.requestMIDIAccess) {
    $('midiMap').textContent = 'Web MIDI nicht verfügbar – bitte Chrome oder Edge nutzen';
    return;
  }
  $('midiDev').onchange = () => midi && bindDevice();
  navigator.requestMIDIAccess()
    .then(m => { midi = m; m.onstatechange = listDevices; listDevices(); })
    .catch(() => $('midiMap').textContent = 'MIDI-Zugriff verweigert');
}
