# Link Beat Sync
Tap-Tempo (Klick / Leertaste / MIDI) und optionale Audioanalyse (BPM + Beat-Phase) → Ableton Link.

Start: macOS `start.command` (Doppelklick), Windows `start.bat`. Beim ersten Start wird `.venv` angelegt (Python 3.9+ nötig).
Die UI öffnet sich auf http://localhost:8765 – bitte Chrome oder Edge (Web MIDI).
Loopback-Audio: macOS BlackHole, Windows VB-Cable als Eingang wählen.

Bedienung: Der erste Tap ist Beat 1 von Takt 1, weitere Taps setzen das Tempo und richten die Phase aus (Leertaste, Klick oder MIDI). Hörst du auf zu tappen (2 s), übernimmt die Audioanalyse: Feinkorrektur von Tempo, Drift und Phase, ohne den Takt zu verschieben.
Tests: `node test/analyzer.test.js`
