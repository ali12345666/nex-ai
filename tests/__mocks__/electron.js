/**
 * Minimal electron mock for pure-Node unit tests.
 * Only what persistence/index.ts and friends touch — no real electron needed.
 *
 * Hermeticity: getPath() returns a PER-PROCESS directory (pid-suffixed) so
 * parallel/sequential test runs never leak state (model registry entries,
 * config.json, secrets) into each other.
 */
const os = require('os');
const path = require('path');

module.exports = {
  app: {
    getPath: (_name) => path.join(os.tmpdir(), `nex-ai-test-ud-${process.pid}`),
    isPackaged: false,
    getName: () => 'NEX AI',
    getVersion: () => '1.0.0-test',
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`, 'utf-8'),
    decryptString: (b) => {
      const s = b.toString('utf-8');
      return s.startsWith('enc:') ? s.slice(4) : s;
    },
  },
  net: {
    request: () => {
      throw new Error('net.request must not be called in unit tests');
    },
  },
  ipcMain: {
    handle: () => {},
  },
  BrowserWindow: class {},
};
