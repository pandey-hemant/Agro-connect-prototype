#!/usr/bin/env bash
# Convenience script: create venv, install deps, run the API.
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  python -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

pip install -q -r requirements.txt

exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
