#!/usr/bin/env bash
set -euo pipefail

cd /workspace/genex-platform/backend
python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

cd /workspace/genex-platform/frontend
npm install
