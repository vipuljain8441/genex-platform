#!/bin/bash
set -e

# Start the GenEx sync server in the background
python3 /usr/local/bin/sandbox-sync-server.py &
SYNC_PID=$!
echo "[entrypoint] sync server started (pid $SYNC_PID)"

sleep 1

exec /usr/bin/entrypoint.sh "$@"
