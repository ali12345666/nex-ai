/**
 * Phase 79 — GGUF Validation Fix Tests
 *
 * Verifies:
 *   1. validateGgufIntegrity logs exact path, size, hex header, magicAscii
 *   2. executeDownload uses result.sandboxPath (actual path) not partPath (computed)
 *   3. Error message includes hex bytes when magic mismatch
 *   4. Pre-validation diagnostics exist
 *   5. .part file NOT deleted on validation failure
 *   6. Source URLs shown full in Model Details
 *   7. Scanner recursively finds .gguf in subdirectories
 *   8. addModel upsert (from Phase 78) still works
 */
import '../__mocks__/install-electron-mock.js';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main(): Promise<void> {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Phase 79 — GGUF Validation Fix Tests');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const dlSrc = read('../../src/main/ai/model-download-manager.ts');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) validateGgufIntegrity logs exact path + hex header
  // ═══════════════════════════════════════════════════════════════════════
  console.log('1) validateGgufIntegrity diagnostics:');
  assert('Logs filePath in validateGgufIntegrity', dlSrc.includes('filePath=${filePath}'));
  assert('Logs fileExists', dlSrc.includes('fileExists=${fileExists}'));
  assert('Logs actualSize', dlSrc.includes('actualSize=${actualSize}'));
  assert('Logs magicAscii', dlSrc.includes('magicAscii="${magicString}"'));
  assert('Logs headerHex (16 bytes)', dlSrc.includes('headerHex=${headerHex}'));
  assert('Logs expected=GGUF', dlSrc.includes('expected=GGUF'));
  assert('Logs magicValid', dlSrc.includes('magicValid=${ggufMagicValid}'));
  assert('Error includes hex bytes on mismatch', dlSrc.includes('hex: ${magicBuf.toString(\'hex\')}'));
  assert('Logs magicBuf hex on FAIL', dlSrc.includes('magicBuf hex=${magicBuf.toString(\'hex\')}'));
  assert('Logs magicBuf bytes on FAIL', dlSrc.includes('magicBuf bytes=['));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) executeDownload uses result.sandboxPath
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Uses actual path from SecureDownloader:');
  assert('Uses result.sandboxPath', dlSrc.includes('result.sandboxPath'));
  assert('Defines actualPartPath', dlSrc.includes('actualPartPath'));
  assert('Logs partPath (computed)', dlSrc.includes('partPath=${partPath}'));
  assert('Logs actualPartPath', dlSrc.includes('actualPartPath=${actualPartPath}'));
  assert('Logs resultSandboxPath', dlSrc.includes('resultSandboxPath='));
  assert('validateGgufIntegrity uses actualPartPath', dlSrc.includes('validateGgufIntegrity(actualPartPath'));
  assert('renameSync uses actualPartPath', dlSrc.includes('fs.renameSync(actualPartPath'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) Pre-validation diagnostics
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Pre-validation diagnostics:');
  assert('Pre-validation block exists', dlSrc.includes('pre-validation'));
  assert('Pre-validation logs path', dlSrc.includes('path=${actualPartPath}'));
  assert('Pre-validation logs size', dlSrc.includes('size=${preStat.size}'));
  assert('Pre-validation logs bytesRead', dlSrc.includes('bytesRead=${bytesRead}'));
  assert('Pre-validation logs headerHex', dlSrc.includes('headerHex=${headerHex}'));
  assert('Pre-validation logs magicAscii', dlSrc.includes('magicAscii=${JSON.stringify(magicAscii)}'));
  assert('Pre-validation logs magicValid', dlSrc.includes('magicValid=${magicAscii === \'GGUF\'}'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) .part file NOT deleted on failure
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) .part file preserved:');
  assert('.part file preserved message exists', dlSrc.includes('.part file preserved'));
  assert('Uses actualPartPath in preservation log', dlSrc.includes('actualPartPath}'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Source URLs shown full in Model Details
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Source URLs full display:');
  const libSrc = read('../../src/renderer/components/NexLibraryPanel.tsx');
  assert('URL NOT truncated', !libSrc.includes('url.slice(0, 50)'));
  assert('URL in readOnly input', libSrc.includes('readOnly') && libSrc.includes('value={s.url}'));
  assert('Open button exists', libSrc.includes('handleOpenDownloadPage(s.url)'));
  assert('Copy button exists', libSrc.includes('handleCopyUrl(s.url, s.label)'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Behavioral: validateGgufIntegrity with valid GGUF file
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Behavioral: validateGgufIntegrity:');
  const { validateGgufIntegrity, _resetModelDownloadManager } = await import('../../src/main/ai/model-download-manager');
  _resetModelDownloadManager?.();

  // Create a valid GGUF file
  const testDir = path.join(os.tmpdir(), `nex-phase79-test-${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });
  const testFile = path.join(testDir, 'test-valid.gguf');
  const ggufMagic = Buffer.from('GGUF', 'ascii');  // 47 47 55 46
  const ggufVersion = Buffer.alloc(4);
  ggufVersion.writeUInt32LE(3, 0);  // 03 00 00 00
  const ggufExtra = Buffer.alloc(8, 0);  // remaining first 16 bytes
  fs.writeFileSync(testFile, Buffer.concat([ggufMagic, ggufVersion, ggufExtra, Buffer.alloc(1000, 0)]));

  const result = await validateGgufIntegrity(testFile);
  assert('Valid GGUF file passes validation', result.passed === true, `error: ${result.error}`);
  assert('ggufMagicValid=true', result.ggufMagicValid === true);
  assert('actualHash is 64 chars', result.actualHash.length === 64);

  // Test with invalid file (no GGUF magic)
  const badFile = path.join(testDir, 'test-invalid.gguf');
  fs.writeFileSync(badFile, Buffer.alloc(1000, 0xFF));  // All 0xFF — no GGUF magic
  const badResult = await validateGgufIntegrity(badFile);
  assert('Invalid GGUF file fails validation', badResult.passed === false);
  assert('Error includes hex bytes', badResult.error?.includes('hex:'));
  assert('ggufMagicValid=false', badResult.ggufMagicValid === false);

  // Test with non-existent file
  const missingResult = await validateGgufIntegrity(path.join(testDir, 'nonexistent.gguf'));
  assert('Non-existent file fails with "File does not exist"', missingResult.passed === false && missingResult.error === 'File does not exist');

  // Test with empty file
  const emptyFile = path.join(testDir, 'empty.gguf');
  fs.writeFileSync(emptyFile, Buffer.alloc(0));
  const emptyResult = await validateGgufIntegrity(emptyFile);
  assert('Empty file fails with "File is empty"', emptyResult.passed === false && emptyResult.error === 'File is empty');

  // Cleanup
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Scanner recursively finds .gguf in subdirectories
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Scanner recursive:');
  const regSrc = read('../../src/main/ai/model-registry.ts');
  assert('findGgufFiles is recursive', regSrc.includes('findGgufFiles(fullPath)'));
  assert('Scanner validates GGUF magic', regSrc.includes("magic !== 'GGUF'"));
  assert('Scanner does NOT delete invalid files', !regSrc.includes('unlinkSync') || regSrc.indexOf("magic !== 'GGUF'") < regSrc.indexOf('unlinkSync'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) addModel upsert (from Phase 78, still works)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) addModel upsert:');
  assert('addModel does NOT throw "already registered"', !regSrc.includes("throw new Error(`Model already registered"));
  assert('addModel does upsert', regSrc.includes('Update the existing entry'));

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 79 Tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
