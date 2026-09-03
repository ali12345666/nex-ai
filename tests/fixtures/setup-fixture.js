#!/usr/bin/env node
/**
 * Fixture setup script — installs deterministic dependencies for test-project.
 *
 * This makes the test fixture self-contained: it doesn't depend on global
 * node_modules or accidental npm install state. Run this ONCE before tests.
 *
 * Idempotent: skips install if marker file exists.
 *
 * Run with: node tests/fixtures/setup-fixture.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const FIXTURE_DIR = path.join(__dirname, 'test-project');
const MARKER = path.join(FIXTURE_DIR, '.fixture-ready');

function log(msg) { console.log('[fixture] ' + msg); }
function err(msg) { console.error('[fixture] ERROR: ' + msg); }

// Find npm executable (might not be on PATH in some shells)
function findNpm() {
  const candidates = [
    process.env.npm_execpath,
    '/usr/bin/npm',
    '/usr/local/bin/npm',
    path.join(process.env.HOME || '', '.npm-global/bin/npm'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  // Fallback: use `npm` from PATH
  return 'npm';
}

if (fs.existsSync(MARKER)) {
  log('Already set up — skipping (delete ' + MARKER + ' to re-run)');
  process.exit(0);
}

log('Setting up test-project...');
log('  dir: ' + FIXTURE_DIR);

// Clean any stale state
try {
  if (fs.existsSync(path.join(FIXTURE_DIR, 'node_modules'))) {
    fs.rmSync(path.join(FIXTURE_DIR, 'node_modules'), { recursive: true, force: true });
  }
  if (fs.existsSync(path.join(FIXTURE_DIR, 'dist'))) {
    fs.rmSync(path.join(FIXTURE_DIR, 'dist'), { recursive: true, force: true });
  }
} catch (e) {
  // ignore
}

// Install typescript locally in the fixture
const npmBin = findNpm();
log('  npm: ' + npmBin);
log('  installing typescript@5.3.3...');

const installResult = spawnSync(npmBin, ['install', '--no-audit', '--no-fund'], {
  cwd: FIXTURE_DIR,
  stdio: 'pipe',
  timeout: 180000,
  encoding: 'utf-8',
});

if (installResult.status !== 0) {
  err('npm install failed (exit ' + installResult.status + ')');
  err('stdout: ' + (installResult.stdout || '').slice(-500));
  err('stderr: ' + (installResult.stderr || '').slice(-500));
  process.exit(1);
}
log('typescript installed');

// Verify
log('  verifying tsc...');
const verifyResult = spawnSync(npmBin, ['run', 'build'], {
  cwd: FIXTURE_DIR,
  stdio: 'pipe',
  timeout: 60000,
  encoding: 'utf-8',
});

if (verifyResult.status !== 0) {
  err('tsc build failed');
  err('stdout: ' + (verifyResult.stdout || '').slice(-500));
  err('stderr: ' + (verifyResult.stderr || '').slice(-500));
  process.exit(1);
}

// Run tests — expect 2 failures (intentional bug in add())
log('  verifying tests fail as expected...');
const testResult = spawnSync(npmBin, ['test'], {
  cwd: FIXTURE_DIR,
  stdio: 'pipe',
  timeout: 60000,
  encoding: 'utf-8',
});

if (testResult.status === 0) {
  err('Tests should fail (intentional bug) but they passed — fixture may be wrong');
  process.exit(1);
}
const testOutput = testResult.stdout || '';
const addFailures = (testOutput.match(/FAIL: add/g) || []).length;
if (addFailures < 2) {
  err('Expected 2 add() failures, got ' + addFailures);
  err('Test output: ' + testOutput.slice(-500));
  process.exit(1);
}
log('Tests fail as expected (' + addFailures + ' add() failures)');

// Mark as ready
fs.writeFileSync(MARKER, new Date().toISOString());
log('Setup complete — marker written to ' + MARKER);
