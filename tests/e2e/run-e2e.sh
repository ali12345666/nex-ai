#!/bin/bash
# Phase 36 E2E test runner
# Starts the real app with remote debugging, runs assertions via CDP
set -e
cd "$(dirname "$0")/.."

# Build if needed
npx tsc -p tsconfig.main.json 2>/dev/null || true
npx vite build --config vite.config.ts 2>/dev/null | tail -1

# Kill stale processes
pkill -9 Xvfb 2>/dev/null || true
pkill -f "electron.*main.js" 2>/dev/null || true
rm -f /tmp/.X99-lock 2>/dev/null || true

# Start Xvfb
(Xvfb :99 -screen 0 1400x900x24 -ac &>/dev/null &)
sleep 1.5

# Start the REAL app with remote debugging
DISPLAY=:99 ELECTRON_DISABLE_SECURITY_WARNINGS=1 \
  node_modules/electron/dist/electron --no-sandbox \
  --remote-debugging-port=9222 \
  dist/main/main.js &
ELECTRON_PID=$!

# Wait for the app to start
sleep 5

# Run the CDP test script
node tests/e2e/test-p36-cdp.js

EXIT_CODE=$?

# Cleanup
kill $ELECTRON_PID 2>/dev/null || true
pkill -9 Xvfb 2>/dev/null || true

exit $EXIT_CODE
