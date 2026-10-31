#!/bin/bash
cd "$(dirname "$0")"
python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))' || { echo "Python 3.9+ wird benötigt."; exit 1; }
# (Re)install when the venv is new or requirements.txt changed
if [ ! -d .venv ] || ! cmp -s requirements.txt .venv/requirements.installed; then
  [ -d .venv ] || python3 -m venv .venv || exit 1
  .venv/bin/python -m pip install --no-user -r requirements.txt && cp requirements.txt .venv/requirements.installed || exit 1
fi
.venv/bin/python server.py
