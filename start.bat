@echo off
cd /d "%~dp0"
if not exist .venv (
  python -m venv .venv
  .venv\Scripts\python -m pip install --no-user -r requirements.txt
)
.venv\Scripts\python server.py
