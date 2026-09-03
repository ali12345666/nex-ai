/**
 * Phase 80 — AI Storage Manager Tests
 *
 * Verifies:
 *   1. AIStorageManager module exists with all exports
 *   2. Directory structure created (models/llm, voice/whisper, etc.)
 *   3. getAIStoragePath returns configurable path
 *   4. setAIStoragePath persists and creates structure
 *   5. scanStorage finds .gguf, .bin, .onnx, .pdf, .txt files
 *   6. Auto-classification (llm, coder, voice-stt, voice-tts, document)
 *   7. Provider detection from filename (qwen, llama, mistral, deepseek)
 *   8. Registry persisted to models.json
 *   9. Second scan finds already-registered files (no duplicates)
 *  10. repairRegistry removes missing files
 *  11. IPC handlers registered
 *  12. Preload bindings exist
 *  13. Scanner does NOT delete or move files
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
  console.log('Phase 80 — AI Storage Manager Tests');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) Module exists with all exports
  // ═══════════════════════════════════════════════════════════════════════
  console.log('1) Module exports:');
  const src = read('../../src/main/ai/ai-storage-manager.ts');

  assert('getAIStoragePath exists', src.includes('export function getAIStoragePath'));
  assert('setAIStoragePath exists', src.includes('export function setAIStoragePath'));
  assert('getStorageInfo exists', src.includes('export function getStorageInfo'));
  assert('scanStorage exists', src.includes('export function scanStorage'));
  assert('readRegistry exists', src.includes('export function readRegistry'));
  assert('writeRegistry exists', src.includes('export function writeRegistry'));
  assert('repairRegistry exists', src.includes('export function repairRegistry'));
  assert('openStorageFolder exists', src.includes('export function openStorageFolder'));
  assert('ensureStorageStructure exists', src.includes('export function ensureStorageStructure'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Directory structure
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Directory structure:');
  assert('Has models/llm/qwen', src.includes("'models/llm/qwen'"));
  assert('Has models/llm/llama', src.includes("'models/llm/llama'"));
  assert('Has models/llm/mistral', src.includes("'models/llm/mistral'"));
  assert('Has models/coder/qwen-coder', src.includes("'models/coder/qwen-coder'"));
  assert('Has models/coder/deepseek-coder', src.includes("'models/coder/deepseek-coder'"));
  assert('Has models/vision/qwen-vl', src.includes("'models/vision/qwen-vl'"));
  assert('Has models/vision/llava', src.includes("'models/vision/llava'"));
  assert('Has models/embedding', src.includes("'models/embedding'"));
  assert('Has models/reranker', src.includes("'models/reranker'"));
  assert('Has voice/whisper', src.includes("'voice/whisper'"));
  assert('Has voice/piper/voices', src.includes("'voice/piper/voices'"));
  assert('Has documents/pdf', src.includes("'documents/pdf'"));
  assert('Has documents/knowledge', src.includes("'documents/knowledge'"));
  assert('Has registry', src.includes("'registry'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) File extensions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) File extensions:');
  assert('Scans .gguf', src.includes("'.gguf'"));
  assert('Scans .bin', src.includes("'.bin'"));
  assert('Scans .onnx', src.includes("'.onnx'"));
  assert('Scans .pdf', src.includes("'.pdf'"));
  assert('Scans .txt', src.includes("'.txt'"));
  assert('Scans .md', src.includes("'.md'"));
  assert('Scans .html', src.includes("'.html'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Auto-classification
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Auto-classification:');
  assert('classifyFile function exists', src.includes('function classifyFile'));
  assert('Classifies llm from folder', src.includes("parts.includes('llm')"));
  assert('Classifies coder from folder', src.includes("parts.includes('coder')"));
  assert('Classifies vision-llm from folder', src.includes("parts.includes('vision')"));
  assert('Classifies embedding from folder', src.includes("parts.includes('embedding')"));
  assert('Classifies reranker from folder', src.includes("parts.includes('reranker')"));
  assert('Classifies voice-stt from whisper folder', src.includes("parts.includes('whisper')"));
  assert('Classifies voice-tts from piper folder', src.includes("parts.includes('piper')"));
  assert('Detects Qwen provider', src.includes("filename.includes('qwen')"));
  assert('Detects Llama provider', src.includes("filename.includes('llama')"));
  assert('Detects Mistral provider', src.includes("filename.includes('mistral')"));
  assert('Detects DeepSeek provider', src.includes("filename.includes('deepseek')"));
  assert('Detects parameter count (e.g. 7B)', src.includes('paramMatch') && src.includes('parameterCount'));
  assert('Detects quantization (e.g. Q4_K_M)', src.includes('quantMatch'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Registry persistence
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Registry persistence:');
  assert('Registry path is registry/models.json', src.includes("'registry', 'models.json'"));
  assert('writeRegistry uses JSON.stringify', src.includes('JSON.stringify(assets'));
  assert('readRegistry parses JSON', src.includes('JSON.parse(data)'));
  assert('Registry logs [AI_STORAGE]', src.includes('[AI_STORAGE]'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) No file deletion/moving
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) No file deletion/moving:');
  assert('Scanner does NOT call unlinkSync', !src.includes('unlinkSync'));
  assert('Scanner does NOT call renameSync', !src.includes('renameSync'));
  assert('Scanner does NOT call copyFileSync', !src.includes('copyFileSync'));
  assert('Scanner does NOT move files', !src.toLowerCase().includes('movefile'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) IPC handlers
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');
  assert('ai-storage-info handler', mainSrc.includes("ipcMain.handle('ai-storage-info'"));
  assert('ai-storage-get-path handler', mainSrc.includes("ipcMain.handle('ai-storage-get-path'"));
  assert('ai-storage-set-path handler', mainSrc.includes("ipcMain.handle('ai-storage-set-path'"));
  assert('ai-storage-scan handler', mainSrc.includes("ipcMain.handle('ai-storage-scan'"));
  assert('ai-storage-list handler', mainSrc.includes("ipcMain.handle('ai-storage-list'"));
  assert('ai-storage-repair handler', mainSrc.includes("ipcMain.handle('ai-storage-repair'"));
  assert('ai-storage-open-folder handler', mainSrc.includes("ipcMain.handle('ai-storage-open-folder'"));
  assert('ai-storage-choose-folder handler', mainSrc.includes("ipcMain.handle('ai-storage-choose-folder'"));
  assert('choose-folder uses dialog.showOpenDialog', mainSrc.includes('dialog.showOpenDialog'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Preload + types
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Preload + types:');
  const preloadSrc = read('../../src/main/preload.ts');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('preload: aiStorageInfo', preloadSrc.includes('aiStorageInfo:'));
  assert('preload: aiStorageScan', preloadSrc.includes('aiStorageScan:'));
  assert('preload: aiStorageChooseFolder', preloadSrc.includes('aiStorageChooseFolder:'));
  assert('types: aiStorageInfo declared', typesSrc.includes('aiStorageInfo:'));
  assert('types: aiStorageScan declared', typesSrc.includes('aiStorageScan:'));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Behavioral: setAIStoragePath + scanStorage
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Behavioral: setAIStoragePath + scanStorage:');
  const {
    setAIStoragePath, getAIStoragePath, scanStorage, readRegistry, repairRegistry,
    ensureStorageStructure, getStorageInfo,
  } = await import('../../src/main/ai/ai-storage-manager');

  // Set a test storage path
  const testDir = path.join(os.tmpdir(), `nex-phase80-test-${Date.now()}`);
  const setResult = setAIStoragePath(testDir);
  assert('setAIStoragePath succeeds', setResult.success === true);

  // Verify directory structure created
  const modelsLlmDir = path.join(testDir, 'models', 'llm', 'qwen');
  assert('models/llm/qwen created', fs.existsSync(modelsLlmDir));
  const voiceWhisperDir = path.join(testDir, 'voice', 'whisper');
  assert('voice/whisper created', fs.existsSync(voiceWhisperDir));
  const registryDir = path.join(testDir, 'registry');
  assert('registry created', fs.existsSync(registryDir));

  // Place test files
  const ggufMagic = Buffer.from('GGUF', 'ascii');
  const ggufVersion = Buffer.alloc(4);
  ggufVersion.writeUInt32LE(3, 0);

  // Qwen GGUF in models/llm/qwen/
  const qwenFile = path.join(modelsLlmDir, 'qwen2.5-7b-q4_k_m.gguf');
  fs.writeFileSync(qwenFile, Buffer.concat([ggufMagic, ggufVersion, Buffer.alloc(1000, 0)]));

  // Whisper .bin in voice/whisper/
  const whisperFile = path.join(voiceWhisperDir, 'ggml-small.bin');
  fs.writeFileSync(whisperFile, Buffer.alloc(500, 0));

  // Document in documents/pdf/
  const pdfFile = path.join(testDir, 'documents', 'pdf', 'test.pdf');
  fs.writeFileSync(pdfFile, Buffer.alloc(200, 0));

  // Scan
  const scanResult = scanStorage();
  assert('Scan found 3 files', scanResult.scanned === 3, `scanned: ${scanResult.scanned}`);
  assert('Scan registered 3 new assets', scanResult.registered === 3, `registered: ${scanResult.registered}`);

  // Verify registry
  const registry = readRegistry();
  assert('Registry has 3 assets', registry.length === 3, `length: ${registry.length}`);

  // Verify classification
  const qwenAsset = registry.find(a => a.name.includes('qwen'));
  assert('Qwen found in registry', !!qwenAsset);
  assert('Qwen classified as llm', qwenAsset?.type === 'llm');
  assert('Qwen provider is Qwen', qwenAsset?.provider === 'Qwen');
  assert('Qwen parameterCount is 7B', qwenAsset?.parameterCount === '7B');
  assert('Qwen quantization detected', qwenAsset?.quantization?.includes('Q4'));

  const whisperAsset = registry.find(a => a.name.includes('ggml'));
  assert('Whisper found in registry', !!whisperAsset);
  assert('Whisper classified as voice-stt', whisperAsset?.type === 'voice-stt');

  const pdfAsset = registry.find(a => a.name.includes('test'));
  assert('PDF found in registry', !!pdfAsset);
  assert('PDF classified as document', pdfAsset?.type === 'document');

  // Scan again — should find all already registered
  const scanResult2 = scanStorage();
  assert('Second scan registers 0 new', scanResult2.registered === 0, `registered: ${scanResult2.registered}`);
  assert('Second scan finds 3 already registered', scanResult2.alreadyRegistered === 3, `already: ${scanResult2.alreadyRegistered}`);

  // Delete a file and repair
  fs.unlinkSync(qwenFile);
  const repairResult = repairRegistry();
  assert('Repair removes 1 missing file', repairResult.removed === 1, `removed: ${repairResult.removed}`);
  assert('Repair leaves 2 valid', repairResult.total === 2, `total: ${repairResult.total}`);

  // Verify scanner did NOT delete or move the remaining files
  assert('Whisper file still exists (not moved)', fs.existsSync(whisperFile));
  assert('PDF file still exists (not moved)', fs.existsSync(pdfFile));

  // Cleanup
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 80 Tests: ${pass} passed, ${fail} failed`);
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
