# Link Beat Sync – Hinweise für Entwickler und KI-Agents

Browser-UI + kleiner Python-Server, der Tempo und Beat-Phase an Ableton Link schickt. Eingaben: Tap (Klick/Leertaste/MIDI) und Audioanalyse (Kick-Band, Techno).

## Aufbau
```
server.py               aiohttp + aalink. WebSocket /ws, statische Dateien. Protokoll steht im Docstring.
static/index.html       Markup (nur Struktur, deutsche UI-Texte)
static/css/style.css    Styles
static/js/app.js        Einstiegspunkt, verdrahtet die Module
static/js/link.js       WebSocket-Client, BPM-Anzeige, send()/setBpm()
static/js/tap.js        Tap-Tempo; isTapHeld() pausiert die Analyse 2 s nach dem letzten Tap
static/js/midi.js       Web MIDI, MIDI-Learn für Tap
static/js/audio.js      Eingang → Kick-Filter → Worklet → Tracker → Tempo/Phase an Server
static/js/rms-worklet.js  AudioWorklet: RMS pro 128-Samples-Block, in 16er-Batches
static/js/analyzer.js   Tracker (reine Logik, kein DOM/Audio – läuft auch in Node)
test/analyzer.test.js   Synthetische Techno-Szenarien, Exit-Code ≠ 0 bei Verfehlung
```

## Befehle
- `npm test` – Analyzer-Tests (Node, keine Abhängigkeiten)
- `./start.command` / `start.bat` – venv anlegen, Server starten, Browser öffnen (http://localhost:8765, Chrome/Edge)

## Regeln und Fallstricke
- **Ressourcen sparen**: Der Server sendet nur bei Zustandsänderung (≈ 1×/Beat) und schläft komplett, solange kein Client verbunden ist. Im Browser keine Timer für die Analyse (werden im Hintergrund gedrosselt) – alles läuft über die Audio-Uhr (Worklet-Nachrichten). Keine DOM-Arbeit in versteckten Tabs; Meter nur per `requestAnimationFrame` und `transform`. Im Analyzer keine Allokation pro Aufruf (Scratch-Puffer).
- **Latenzkette**: Phase = Beat-Alter im Analysefenster + Nachrichtenverzögerung + `baseLatency` + manueller Offset. Änderungen an `latencyHint` oder Blockgröße verschieben die Phase.
- **Tap hat Vorrang**: Der erste Tap setzt Beat 1 (`force_beat(0)`), die Analyse verschiebt später nie den Takt, nur die Phase innerhalb eines Beats (`shift_to_grid`, Gain 0.5).
- Analyzer-Konstanten (`MIN_CONF`, Lock-Logik in `track()`) sind gegen die Tests getunt; nach Änderungen `npm test` laufen lassen.
- Abhängigkeiten sind gepinnt (`requirements.txt`); der Startscript installiert nur bei Änderung neu.
- UI-Texte sind Deutsch, Code und Kommentare Englisch.
