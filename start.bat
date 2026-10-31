@echo off
cd /d "%~dp0"
python -c "import sys; sys.exit(sys.version_info < (3, 9))" || (echo Python 3.9+ wird benoetigt. & pause & exit /b 1)
if not exist .venv python -m venv .venv || exit /b 1
fc /b requirements.txt .venv\requirements.installed >nul 2>&1
if errorlevel 1 (
  .venv\Scripts\python -m pip install --no-user -r requirements.txt || (pause & exit /b 1)
  copy /y requirements.txt .venv\requirements.installed >nul
)
.venv\Scripts\python server.py
