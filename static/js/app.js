// Entry point: wires the UI modules together.
import { initLink } from './link.js';
import { initTap, onTap } from './tap.js';
import { initMidi } from './midi.js';
import { initAudio, resetPhaseTimer } from './audio.js';

initLink();
initTap();
initMidi();
initAudio();
onTap(resetPhaseTimer);   // after tapping, let the analysis correct the phase right away
