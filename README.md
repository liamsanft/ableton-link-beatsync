# Link Beat Sync
Tap-Tempo (Klick / Leertaste / MIDI) und optionale Audioanalyse (BPM + Beat-Phase) → Ableton Link.

Start: macOS `start.command` (Doppelklick), Windows `start.bat`. Beim ersten Start wird `.venv` angelegt (Python 3.9+ nötig).
Die UI öffnet sich auf http://localhost:8765 – bitte Chrome oder Edge (Web MIDI).
Loopback-Audio: macOS BlackHole, Windows VB-Cable als Eingang wählen.

Bedienung: Der erste Tap ist Beat 1 von Takt 1, weitere Taps setzen das Tempo und richten die Phase aus (Leertaste, Klick oder MIDI). Hörst du auf zu tappen (2 s), übernimmt die Audioanalyse: Feinkorrektur von Tempo, Drift und Phase, ohne den Takt zu verschieben.

## Einrichtung auf einem neuen Gerät

### 1. Voraussetzungen
- **Python 3.9+** – macOS: `brew install python` oder von [python.org](https://www.python.org/downloads/); Windows: von python.org, beim Installieren „Add Python to PATH" anhaken.
- **Chrome oder Edge** (wegen Web MIDI).
- **Git** (zum Klonen) und optional **Node.js** (nur für `npm test`).
- Eine **Link-fähige App** (Ableton Live, Traktor, Bitwig, …) im selben Netzwerk – Link muss dort aktiviert sein.

### 2. Projekt holen
```
git clone https://github.com/liamsanft/ableton-link-beatsync.git
cd ableton-link-beatsync
```

### 3. Starten
- macOS: `start.command` doppelklicken. Beim ersten Mal ggf. Rechtsklick → „Öffnen" (Gatekeeper); falls das Skript nicht ausführbar ist: `chmod +x start.command`.
- Windows: `start.bat` doppelklicken.

Das Skript legt `.venv` an, installiert die Abhängigkeiten aus `requirements.txt`, startet den Server und öffnet http://localhost:8765. Manuell:
```
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt    # Windows: .venv\Scripts\python
.venv/bin/python server.py
```

### Pakete
- **Python** (`requirements.txt`: `aalink`, `aiohttp`): Das Startskript installiert sie automatisch in `.venv` und wieder neu, sobald sich `requirements.txt` ändert. Manuell siehe oben; zum Neuaufbau `.venv` löschen und das Skript erneut starten.
- **Node/npm**: keine Pakete nötig. `npm test` läuft ohne `npm install`.
- **Browser**: keine Bibliotheken, alles liegt in `static/` (kein Build-Schritt, kein Internet nötig).

### 4. Audio (optional, für die Analyse)
- Mikrofon-Zugriff im Browser erlauben (macOS: Systemeinstellungen → Datenschutz & Sicherheit → Mikrofon → Browser aktivieren).
- Für den Mix direkt abgreifen: macOS [BlackHole](https://existential.audio/blackhole/), Windows [VB-Cable](https://vb-audio.com/Cable/) installieren, den Player/DJ-Mixer darauf ausgeben und in der UI als Eingang wählen. Zum gleichzeitigen Mithören in macOS ein Multi-Output-Gerät anlegen.

### 5. Prüfen
1. In der Link-App Link einschalten – die Peers-Anzahl in der UI sollte steigen.
2. Ein paar Mal tappen: BPM und Beat-Position in der Link-App folgen.
3. Optional MIDI: Controller anschließen, in der UI „MIDI-Learn" für Tap nutzen.

### Fehlersuche
- **Keine Peers**: Firewall muss UDP/Multicast für Python erlauben; beide Geräte im selben Netz/WLAN (kein Gast-WLAN mit Client-Isolation).
- **Port 8765 belegt**: anderen Prozess beenden (`lsof -i :8765`).
- **Installation von aalink schlägt fehl**: Python-Version prüfen (`python3 --version`); unter Windows ggf. die „Build Tools for Visual Studio" installieren, falls kein fertiges Wheel verfügbar ist.
- **Kein Mikrofon-/MIDI-Zugriff**: Seite in Chrome/Edge öffnen und die Berechtigung für localhost erlauben.

„Sync zurücksetzen“ verwirft Tap-Folge und gelocktes Tempo und startet die Suche neu; Tempo und Takt in Link bleiben unverändert. Der Status der Analyse hat eine Farbanzeige (grau aus, gelb Suche, grün gelockt, blau Breakdown/Tempo halten, rot Eingang weg). Wird der Audio-Eingang getrennt, wartet die Analyse und startet selbst neu, sobald ein Gerät auftaucht.

Tests: `npm test` (Analyzer) und `npm run test:server` (Server, braucht `.venv`). Architektur und Konventionen: [AGENTS.md](AGENTS.md).
