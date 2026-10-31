#!/bin/bash
cd "$(dirname "$0")"
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/python -m pip install --no-user -r requirements.txt; }
.venv/bin/python server.py
