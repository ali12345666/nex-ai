/**
 * Phase 78 — Install Fix + URL Display Tests
 *
 * Verifies:
 *   1. addModel does NOT throw "already registered" — upserts instead
 *   2. updateModel allows sizeBytes updates
 *   3. [MODEL_DOWNLOAD] log exists
 *   4. [MODEL_VERIFY] log exists (before + after validation)
 *   5. [MODEL_INSTALL] log shows partPath
 *   6. DownloadableModel has installationSubdir
 *   7. Qwen catalog has installationSubdir='llm'
 *   8. Model Details shows FULL URLs (not truncated)
 *   9. Source URL is in an input field (selectable, not just text)
 *  10. Open + Copy buttons per source
 *  11. Scanner recursively finds .gguf in subdirectories
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
  console.log('Phase 78 — Install Fix + URL Display Tests');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) addModel upsert (no throw on existing)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('1) addModel upsert:');
  const regSrc = read('../../src/main/ai/model-registry.ts');

  assert('addModel does NOT throw "already registered"', !regSrc.includes("throw new Error(`Model already registered"));
  assert('addModel does upsert (updateModel on existing)', regSrc.includes('Update the existing entry'));
  assert('addModel compares by resolved path', regSrc.includes('path.resolve(m.path)'));
  assert('addModel compares by basename', regSrc.includes('path.basename(m.path)'));
  assert('addModel logs [MODEL_REGISTRY]', regSrc.includes('[MODEL_REGISTRY]'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) updateModel allows sizeBytes
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) updateModel allows sizeBytes:');
  assert('updateModel Omit does NOT exclude sizeBytes', !regSrc.includes("'sizeBytes'") || !regSrc.includes("Omit<LocalModelInfo, 'id' | 'path' | 'sizeBytes'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) [MODEL_DOWNLOAD] log
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) [MODEL_DOWNLOAD] log:');
  const dlSrc = read('../../src/main/ai/model-download-manager.ts');

  assert('[MODEL_DOWNLOAD] log exists', dlSrc.includes('[MODEL_DOWNLOAD]'));
  assert('[MODEL_DOWNLOAD] logs status', dlSrc.includes('status=success'));
  assert('[MODEL_DOWNLOAD] logs bytesDownloaded', dlSrc.includes('bytesDownloaded='));
  assert('[MODEL_DOWNLOAD] logs partPath', dlSrc.includes('partPath='));
  assert('[MODEL_DOWNLOAD] logs source', dlSrc.includes('source='));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) [MODEL_VERIFY] log
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) [MODEL_VERIFY] log:');
  assert('[MODEL_VERIFY] log exists', dlSrc.includes('[MODEL_VERIFY]'));
  assert('[MODEL_VERIFY] logs before validation', dlSrc.includes('expectedSize='));
  assert('[MODEL_VERIFY] logs after validation', dlSrc.includes('passed='));
  assert('[MODEL_VERIFY] logs actualSize', dlSrc.includes('actualSize='));
  assert('[MODEL_VERIFY] logs ggufMagicValid', dlSrc.includes('ggufMagicValid='));
  assert('[MODEL_VERIFY] logs error if failed', dlSrc.includes('error='));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) [MODEL_INSTALL] log shows partPath
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) [MODEL_INSTALL] log:');
  assert('[MODEL_INSTALL] log exists', dlSrc.includes('[MODEL_INSTALL]'));
  assert('[MODEL_INSTALL] logs path', dlSrc.includes('path=${finalPath}'));
  assert('[MODEL_INSTALL] logs size', dlSrc.includes('size=${finalStat.size}'));
  assert('[MODEL_INSTALL] logs ggufValid', dlSrc.includes('ggufValid='));
  assert('[MODEL_INSTALL] logs partPath', dlSrc.includes('partPath=${partPath}'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) installationSubdir support
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) installationSubdir:');
  assert('DownloadableModel has installationSubdir', dlSrc.includes('installationSubdir?: string'));
  assert('executeDownload uses installationSubdir', dlSrc.includes('model.installationSubdir'));
  assert('executeDownload creates installDir', dlSrc.includes('fs.mkdirSync(installDir'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Qwen catalog has installationSubdir='llm'
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Qwen catalog:');
  const catSrc = read('../../src/main/ai/downloadable-models.ts');
  assert('Qwen has installationSubdir', catSrc.includes("installationSubdir: 'llm'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Model Details shows FULL URLs
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Model Details full URLs:');
  const libSrc = read('../../src/renderer/components/NexLibraryPanel.tsx');

  assert('URL NOT truncated to 50 chars', !libSrc.includes('s.url.slice(0, 50)'));
  assert('URL in input field (selectable)', libSrc.includes('readOnly') && libSrc.includes('value={s.url}'));
  assert('URL input has onClick select', libSrc.includes('(e.target as HTMLInputElement).select()'));
  assert('Source has Open button', libSrc.includes('handleOpenDownloadPage(s.url)'));
  assert('Source has Copy button', libSrc.includes('handleCopyUrl(s.url, s.label)'));
  assert('Source label displayed', libSrc.includes('{s.label}'));
  assert('Source priority displayed', libSrc.includes('s.priority'));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Scanner recursively finds .gguf in subdirectories
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Scanner recursive:');
  assert('findGgufFiles is recursive', regSrc.includes('findGgufFiles(fullPath)'));
  assert('Scanner skips hidden dirs', regSrc.includes("entry.name.startsWith('.')"));
  assert('Scanner validates GGUF magic', regSrc.includes("magic !== 'GGUF'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 10) Behavioral: addModel upsert
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) Behavioral: addModel upsert:');
  const { addModel, listModels, removeModel, _resetModelRegistry } = await import('../../src/main/ai/model-registry');
  _resetModelRegistry?.();

  // Create a test .gguf file
  const testDir = path.join(os.tmpdir(), `nex-phase78-test-${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });
  const testFile = path.join(testDir, 'test-model.gguf');
  const ggufMagic = Buffer.from('GGUF', 'ascii');
  const ggufVersion = Buffer.alloc(4);
  ggufVersion.writeUInt32LE(3, 0);
  fs.writeFileSync(testFile, Buffer.concat([ggufMagic, ggufVersion, Buffer.alloc(1000, 0)]));

  // First add — should succeed
  const model1 = addModel(testFile, { name: 'Test Model', source: 'local' });
  assert('First addModel succeeds', !!model1);

  // Second add — should NOT throw, should upsert
  let model2: any = null;
  try {
    model2 = addModel(testFile, { name: 'Test Model Updated', source: 'huggingface' });
    assert('Second addModel does NOT throw', true);
  } catch (err: any) {
    assert('Second addModel does NOT throw', false, `threw: ${err?.message}`);
  }

  // Verify the model was updated (not duplicated)
  const allModels = listModels();
  const matchingModels = allModels.filter(m => m.name === 'Test Model' || m.name === 'Test Model Updated');
  assert('Only ONE model exists (not duplicated)', matchingModels.length === 1,
    `found ${matchingModels.length} models`);

  // Cleanup
  for (const m of allModels) {
    try { removeModel(m.id); } catch {}
  }
  try { fs.unlinkSync(testFile); } catch {}
  try { fs.rmdirSync(testDir); } catch {}

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 78 Tests: ${pass} passed, ${fail} failed`);
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
