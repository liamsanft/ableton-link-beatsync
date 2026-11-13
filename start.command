#!/bin/bash
cd "$(dirname "$0")"
REPO=liamsanft/ableton-link-beatsync

# No (recent) Python? Use the prebuilt standalone binary, downloading it once from GitHub Releases.
if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))' 2>/dev/null; then
  [ "$(uname -m)" = arm64 ] && ARCH=arm64 || ARCH=x64
  BIN="bin/link-beat-sync-macos-$ARCH"
  if [ ! -x "$BIN" ]; then
    echo "Python 3.9+ nicht gefunden – lade die eigenständige Version herunter ..."
    mkdir -p bin
    curl -fL --progress-bar -o "$BIN.part" "https://github.com/$REPO/releases/latest/download/link-beat-sync-macos-$ARCH" \
      || { rm -f "$BIN.part"; echo "Download fehlgeschlagen. Bitte Python 3.9+ installieren (python.org) oder später erneut versuchen."; exit 1; }
    chmod +x "$BIN.part" && mv "$BIN.part" "$BIN" || exit 1
  fi
  xattr -d com.apple.quarantine "$BIN" 2>/dev/null
  exec "$BIN"
fi

# (Re)install when the venv is new or requirements.txt changed
if [ ! -d .venv ] || ! cmp -s requirements.txt .venv/requirements.installed; then
  [ -d .venv ] || python3 -m venv .venv || exit 1
  .venv/bin/python -m pip install --no-user -r requirements.txt && cp requirements.txt .venv/requirements.installed || exit 1
fi
.venv/bin/python server.py
