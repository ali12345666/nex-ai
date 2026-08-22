#!/usr/bin/env bash
# Helper to run an Electron test script with Xvfb (for headless environments).
# Usage: ./scripts/run-electron-test.sh tests/agent/test-g-e2e-coding.js [timeout_seconds]
set -e

TEST_FILE="$1"
TIMEOUT="${2:-120}"

if [ -z "$TEST_FILE" ]; then
  echo "Usage: $0 <test-file.js> [timeout_seconds]"
  exit 1
fi

cd "$(dirname "$0")/.."

# Kill any stale Xvfb
pkill -9 Xvfb 2>/dev/null || true
rm -f /tmp/.X*-lock 2>/dev/null || true

# Start Xvfb
setsid bash -c "Xvfb :99 -screen 0 1280x800x24 -ac >/tmp/xvfb.log 2>&1" </dev/null &
disown
sleep 2

# Build first
npm run build:main >/dev/null 2>&1

# Run the test
DISPLAY=:99 timeout "$TIMEOUT" node_modules/electron/dist/electron --no-sandbox "$TEST_FILE"

# Capture exit code
EXIT_CODE=$?

# Cleanup
pkill -9 Xvfb 2>/dev/null || true

exit $EXIT_CODE
