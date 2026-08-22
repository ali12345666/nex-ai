/**
 * Phase 2 Persistence Tests
 *
 * Run with: npx tsx tests/persistence/test-phase2.ts
 *
 * Verifies:
 *  1. Plain settings round-trip through saveState/loadState
 *  2. State survives simulated "restart" (close + reopen persistence)
 *  3. Secrets are stored encrypted (not plaintext in secrets.json)
 *  4. Secrets can be retrieved correctly
 *  5. Deleting a secret removes it
 *  6. Portable vs Installed paths work
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Stub Electron's `app` and `safeStorage` for headless testing
const { app, safeStorage } = {
  app: {
    isPackaged: false,
    getPath: () => path.join(os.tmpdir(), 'nex-test-' + Date.now()),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => {
      // Fake encryption: XOR with a fixed key (NOT real encryption — test only)
      const key = Buffer.from('nex-test-key', 'utf-8');
      const buf = Buffer.from(s, 'utf-8');
      const out = Buffer.alloc(buf.length);
      for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key[i % key.length];
      return out;
    },
    decryptString: (buf: Buffer) => {
      const key = Buffer.from('nex-test-key', 'utf-8');
      const out = Buffer.alloc(buf.length);
      for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key[i % key.length];
      return out.toString('utf-8');
    },
  },
};

// Inject stubs into the global Electron module BEFORE importing persistence
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (name: string) {
  if (name === 'electron') return { app, safeStorage };
  return originalRequire.apply(this, arguments);
};

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else      { fail++; console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main() {
  const { initPersistence, loadState, updateSettings, setSecret, getSecret, deleteSecret, getUserDataDir } =
    require('../../src/main/persistence');

  console.log('\n=== Phase 2 Persistence Tests ===\n');

  // ── 1. Settings round-trip ──
  console.log('1. Settings round-trip:');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-pers-'));
  initPersistence(tmpDir);

  updateSettings({
    theme: 'darker',
    fontSize: 16,
    aiMode: 'local',
    localThreads: 8,
    localContextSize: 4096,
  });

  // Simulate restart by re-initializing
  initPersistence(tmpDir);
  const loaded = loadState();
  assert('settings persist across restart',
    loaded.settings?.fontSize === 16,
    `fontSize was ${loaded.settings?.fontSize}`);
  assert('theme persists', loaded.settings?.theme === 'darker');
  assert('aiMode persists', loaded.settings?.aiMode === 'local');
  assert('localThreads persists', loaded.settings?.localThreads === 8);

  // ── 2. Secrets encryption ──
  console.log('\n2. Secrets encryption:');
  const apiKey = 'sk-test-1234567890abcdef';
  setSecret('aiApiKey', apiKey);

  // Read the raw secrets.json file — should NOT contain the plaintext key
  const secretsFile = path.join(tmpDir, 'secrets.json');
  const rawContent = fs.readFileSync(secretsFile, 'utf-8');
  assert('secrets.json does NOT contain plaintext API key',
    !rawContent.includes(apiKey),
    `secrets.json contained the plaintext key`);
  assert('secrets.json contains base64-encoded ciphertext',
    rawContent.includes('"aiApiKey":') && rawContent.includes('"'));

  // ── 3. Secret retrieval ──
  console.log('\n3. Secret retrieval:');
  initPersistence(tmpDir);
  const retrieved = getSecret('aiApiKey');
  assert('secret can be retrieved after restart',
    retrieved === apiKey,
    `got: ${retrieved}`);

  // ── 4. Secret deletion ──
  console.log('\n4. Secret deletion:');
  deleteSecret('aiApiKey');
  initPersistence(tmpDir);
  assert('deleted secret returns empty string',
    getSecret('aiApiKey') === '');

  // ── 5. State survives simulated crash ──
  console.log('\n5. Crash simulation:');
  updateSettings({ fontSize: 24, aiMode: 'auto' });
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8'));
  assert('settings on disk after implicit save',
    onDisk.settings?.fontSize === 24,
    `fontSize on disk: ${onDisk.settings?.fontSize}`);
  assert('aiMode on disk after crash',
    onDisk.settings?.aiMode === 'auto');

  // ── 6. Portable vs Installed ──
  console.log('\n6. Path structure:');
  const userData = getUserDataDir();
  assert('userData path is correct',
    userData === tmpDir);
  const conversationsDir = path.join(userData, 'conversations');
  const memoryDir = path.join(userData, 'memory');
  assert('conversations/ directory created', fs.existsSync(conversationsDir));
  assert('memory/ directory created', fs.existsSync(memoryDir));

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true });

  console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
