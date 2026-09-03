/**
 * Phase 73 — Model Installation & Registration Tests
 *
 * Verifies:
 *   1. scanAndRegisterModels finds .gguf files in models/ and models/llm/
 *   2. Auto-registers unregistered .gguf files
 *   3. Skips already-registered files
 *   4. Validates GGUF magic before registering
 *   5. Does NOT delete files on validation failure
 *   6. [MODEL_INSTALL] logs are present
 *   7. scan-models IPC handler registered
 *   8. local-runtime-list-models calls scanner before listing
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
  console.log('Phase 73 — Model Installation & Registration Tests');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) scanAndRegisterModels function exists in model-registry.ts
  // ═══════════════════════════════════════════════════════════════════════
  console.log('1) scanAndRegisterModels in model-registry.ts:');
  const regSrc = read('../../src/main/ai/model-registry.ts');

  assert('scanAndRegisterModels function exists', regSrc.includes('export function scanAndRegisterModels'));
  assert('ScanResult interface exists', regSrc.includes('export interface ScanResult'));
  assert('ScanResult has scanned field', regSrc.includes('scanned: number'));
  assert('ScanResult has registered field', regSrc.includes('registered: number'));
  assert('ScanResult has alreadyRegistered field', regSrc.includes('alreadyRegistered: number'));
  assert('ScanResult has skipped field', regSrc.includes('skipped: number'));
  assert('ScanResult has newModels field', regSrc.includes('newModels: LocalModelInfo[]'));
  assert('Scanner recursively finds .gguf files', regSrc.includes('function findGgufFiles'));
  assert('Scanner skips hidden directories', regSrc.includes("entry.name.startsWith('.')"));
  assert('Scanner validates GGUF magic', regSrc.includes("magic !== 'GGUF'"));
  assert('Scanner does NOT delete on invalid magic', !regSrc.includes('unlinkSync') || regSrc.indexOf("magic !== 'GGUF'") < regSrc.indexOf('unlinkSync'));
  assert('Scanner logs [MODEL_SCAN]', regSrc.includes('[MODEL_SCAN]'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) [MODEL_INSTALL] logs in model-download-manager.ts
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) [MODEL_INSTALL] logs:');
  const dlSrc = read('../../src/main/ai/model-download-manager.ts');

  assert('[MODEL_INSTALL] log exists', dlSrc.includes('[MODEL_INSTALL]'));
  assert('[MODEL_INSTALL] logs path=', dlSrc.includes('path='));
  assert('[MODEL_INSTALL] logs size=', dlSrc.includes('size='));
  assert('[MODEL_INSTALL] logs ggufValid=', dlSrc.includes('ggufValid='));
  assert('[MODEL_INSTALL] logs registryUpdated=', dlSrc.includes('registryUpdated='));
  assert('[MODEL_INSTALL] logs visibleInLibrary=', dlSrc.includes('visibleInLibrary='));
  assert('[MODEL_INSTALL] verifies visibility via listModels', dlSrc.includes('listModels()'));
  assert('Does NOT delete .part on validation failure', dlSrc.includes('.part file preserved'));
  assert('Does NOT have unlinkSync on integrity failure', !dlSrc.includes('try { fs.unlinkSync(partPath); } catch {}'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) IPC handlers in main.ts
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');

  assert('scan-models IPC handler registered', mainSrc.includes("ipcMain.handle('scan-models'"));
  assert('local-runtime-list-models calls scanner', mainSrc.includes('scanAndRegisterModels') && mainSrc.includes('local-runtime-list-models'));
  assert('local-runtime-list-models logs [MODEL_INSTALL]', mainSrc.includes("[MODEL_INSTALL] Auto-registered"));
  assert('scan-models uses getModelsDir', mainSrc.includes('getModelsDir()'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Preload + types
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Preload + types:');
  const preloadSrc = read('../../src/main/preload.ts');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');

  assert('preload exposes scanModels', preloadSrc.includes('scanModels:') && preloadSrc.includes("ipcRenderer.invoke('scan-models')"));
  assert('types: scanModels declared', typesSrc.includes('scanModels: () => Promise'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Behavioral: scanAndRegisterModels finds and registers .gguf files
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Behavioral: scanAndRegisterModels:');

  const { scanAndRegisterModels, listModels, removeModel, _resetModelRegistry } = await import('../../src/main/ai/model-registry');
  _resetModelRegistry?.();

  // Create a temp models directory with test .gguf files
  const testModelsDir = path.join(os.tmpdir(), `nex-phase73-test-${Date.now()}`);
  const llmDir = path.join(testModelsDir, 'llm');
  fs.mkdirSync(llmDir, { recursive: true });

  // Create a valid GGUF file (magic + version)
  const ggufMagic = Buffer.from('GGUF', 'ascii');
  const ggufVersion = Buffer.alloc(4);
  ggufVersion.writeUInt32LE(3, 0);
  const validGguf = Buffer.concat([ggufMagic, ggufVersion, Buffer.alloc(1000, 0)]);
  fs.writeFileSync(path.join(llmDir, 'qwen2.5-0.5b-q4_k_m.gguf'), validGguf);

  // Create another valid GGUF in models/ root
  fs.writeFileSync(path.join(testModelsDir, 'test-model.gguf'), validGguf);

  // Create an invalid file (not GGUF)
  fs.writeFileSync(path.join(testModelsDir, 'bad-model.gguf'), Buffer.alloc(500, 0xFF));

  // Create a .downloads hidden dir (should be skipped)
  const dlDir = path.join(testModelsDir, '.downloads');
  fs.mkdirSync(dlDir, { recursive: true });
  fs.writeFileSync(path.join(dlDir, 'partial.gguf.part'), validGguf);

  // Scan
  const result = scanAndRegisterModels(testModelsDir);

  assert('Scan found 3 .gguf files (2 valid + 1 invalid, .downloads skipped)', result.scanned === 3,
    `scanned: ${result.scanned}`);
  assert('Scan registered 2 models', result.registered === 2,
    `registered: ${result.registered}`);
  assert('Scan skipped 1 invalid file', result.skipped === 1,
    `skipped: ${result.skipped}`);
  assert('Scan skipped .downloads directory', !result.newModels.some(m => m.name.includes('partial')),
    `newModels: ${result.newModels.map(m => m.name).join(', ')}`);

  // Verify the models are now in the registry
  const models = listModels();
  assert('Registered models appear in listModels()', models.length >= 2);
  assert('qwen2.5-0.5b-q4_k_m is registered', models.some(m => m.name.includes('qwen2.5-0.5b')));
  assert('test-model is registered', models.some(m => m.name === 'test-model'));

  // Scan again — should find all already registered
  const result2 = scanAndRegisterModels(testModelsDir);
  assert('Second scan registers 0 new models', result2.registered === 0,
    `registered: ${result2.registered}`);
  assert('Second scan reports alreadyRegistered=2 (valid files only)', result2.alreadyRegistered === 2,
    `alreadyRegistered: ${result2.alreadyRegistered}`);
  assert('Second scan still skips 1 invalid file', result2.skipped === 1,
    `skipped: ${result2.skipped}`);

  // Cleanup
  for (const m of models) {
    try { removeModel(m.id); } catch {}
  }
  try { fs.rmSync(testModelsDir, { recursive: true, force: true }); } catch {}

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Scanner does NOT delete invalid files
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Scanner does NOT delete invalid files:');

  const testDir2 = path.join(os.tmpdir(), `nex-phase73-nodelete-${Date.now()}`);
  fs.mkdirSync(testDir2, { recursive: true });
  const badFilePath = path.join(testDir2, 'corrupt.gguf');
  fs.writeFileSync(badFilePath, Buffer.alloc(500, 0xFF));

  scanAndRegisterModels(testDir2);

  assert('Invalid .gguf file is NOT deleted by scanner', fs.existsSync(badFilePath),
    'file should still exist after scan');

  // Cleanup
  try { fs.rmSync(testDir2, { recursive: true, force: true }); } catch {}

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 73 Tests: ${pass} passed, ${fail} failed`);
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
