@echo off
cd /d "%~dp0"
python -c "import sys; sys.exit(sys.version_info < (3, 9))" >nul 2>&1
if errorlevel 1 goto standalone

if not exist .venv python -m venv .venv || exit /b 1
fc /b requirements.txt .venv\requirements.installed >nul 2>&1
if errorlevel 1 (
  .venv\Scripts\python -m pip install --no-user -r requirements.txt || (pause & exit /b 1)
  copy /y requirements.txt .venv\requirements.installed >nul
)
.venv\Scripts\python server.py
exit /b

:standalone
rem No (recent) Python: use the prebuilt standalone exe, downloaded once from GitHub Releases.
if not exist bin\link-beat-sync-windows.exe (
  echo Python 3.9+ nicht gefunden - lade die eigenstaendige Version herunter ...
  if not exist bin mkdir bin
  curl.exe -fL --progress-bar -o bin\download.part https://github.com/liamsanft/ableton-link-beatsync/releases/latest/download/link-beat-sync-windows.exe
  if errorlevel 1 (
    del bin\download.part 2>nul
    echo Download fehlgeschlagen. Bitte Python 3.9+ installieren oder spaeter erneut versuchen.
    pause & exit /b 1
  )
  move /y bin\download.part bin\link-beat-sync-windows.exe >nul
)
bin\link-beat-sync-windows.exe
pause
