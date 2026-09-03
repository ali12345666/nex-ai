/**
 * Electron mock installer — MUST be the first import in unit tests.
 * Redirects `require('electron')` / `import 'electron'` to our fake before
 * any module in the persistence chain loads the real (binary-less) package.
 *
 * Usage (top of test file, before other imports):
 *   import '../__mocks__/install-electron-mock.js';
 */
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') {
    return require.resolve('./electron');
  }
  return origResolve.call(this, request, ...args);
};
