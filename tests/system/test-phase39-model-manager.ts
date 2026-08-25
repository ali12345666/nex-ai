/**
 * Phase 39 — Professional Model Manager Regression Tests
 *
 * Verifies the new model management architecture:
 *   1. Schema versioning (v1 → v2 migration)
 *   2. Hash computation + integrity verification
 *   3. Backup + rollback (no data loss)
 *   4. Portable path resolution
 *   5. Hardware-aware model recommendation
 *   6. IPC handlers registered
 *   7. Preload bridges present
 *
 * Run: npx tsx tests/system/test-phase39-model-manager.ts
 */
import '../__mocks__/install-electron-mock.js';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main(): Promise<void> {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) model-versioning.ts module exists with correct exports
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) model-versioning.ts module:');
  const mvSrc = read('../../src/main/ai/model-versioning.ts');

  assert('model-versioning.ts exists', mvSrc.length > 0);
  assert('CURRENT_MODEL_SCHEMA_VERSION = 2', mvSrc.includes('CURRENT_MODEL_SCHEMA_VERSION = 2'));
  assert('computeFileHash exported', mvSrc.includes('export function computeFileHash'));
  assert('verifyModelIntegrity exported', mvSrc.includes('export async function verifyModelIntegrity'));
  assert('backupModelRegistry exported', mvSrc.includes('export function backupModelRegistry'));
  assert('rollbackModelRegistry exported', mvSrc.includes('export function rollbackModelRegistry'));
  assert('hasModelRegistryBackup exported', mvSrc.includes('export function hasModelRegistryBackup'));
  assert('getModelRegistryBackupInfo exported', mvSrc.includes('export function getModelRegistryBackupInfo'));
  assert('migrateModelRegistry exported', mvSrc.includes('export function migrateModelRegistry'));
  assert('resolveModelPath exported', mvSrc.includes('export function resolveModelPath'));
  assert('normalizeModelPathForStorage exported', mvSrc.includes('export function normalizeModelPathForStorage'));
  assert('verifyAllModelsIntegrity exported', mvSrc.includes('export async function verifyAllModelsIntegrity'));
  assert('uses SHA-256', mvSrc.includes("crypto.createHash('sha256')"));
  assert('uses streaming (createReadStream)', mvSrc.includes('fs.createReadStream'));
  assert('ModelIntegrityInfo interface', mvSrc.includes('interface ModelIntegrityInfo'));
  assert('IntegrityCheckResult interface', mvSrc.includes('interface IntegrityCheckResult'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) hardware-model-recommender.ts module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) hardware-model-recommender.ts module:');
  const hmrSrc = read('../../src/main/ai/hardware-model-recommender.ts');

  assert('hardware-model-recommender.ts exists', hmrSrc.length > 0);
  assert('HardwareProfile interface', hmrSrc.includes('interface HardwareProfile'));
  assert('ModelHardwareVerdict interface', hmrSrc.includes('interface ModelHardwareVerdict'));
  assert('ModelRecommendation interface', hmrSrc.includes('interface ModelRecommendation'));
  assert('detectHardwareProfile exported', hmrSrc.includes('export function detectHardwareProfile'));
  assert('canModelRunOnHardware exported', hmrSrc.includes('export function canModelRunOnHardware'));
  assert('recommendModelsForHardware exported', hmrSrc.includes('export function recommendModelsForHardware'));
  assert('recommendBestModel exported', hmrSrc.includes('export function recommendBestModel'));
  assert('checks RAM headroom (2GB)', hmrSrc.includes('2 * 1024 * 1024 * 1024'));
  assert('checks VRAM headroom (15%)', hmrSrc.includes('0.15'));
  assert('suggests GPU offload (-1 for all)', hmrSrc.includes('suggestedGpuLayers = -1'));
  assert('suggests CPU-only fallback', hmrSrc.includes('suggestedGpuLayers = 0'));
  assert('suggests threads (min cores, 8)', hmrSrc.includes('Math.min(hw.cpuCores, 8)'));
  assert('scoring includes capability match', hmrSrc.includes('score += 0.3'));
  assert('scoring includes category match', hmrSrc.includes('score += 0.2'));
  assert('scoring includes GPU fit bonus', hmrSrc.includes('score += 0.1'));
  assert('excludes models that cant run', hmrSrc.includes('if (!verdict.canRun) continue'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) model-registry.ts integration
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) model-registry.ts Phase 39 integration:');
  const mrSrc = read('../../src/main/ai/model-registry.ts');

  assert('imports from model-versioning', mrSrc.includes("from './model-versioning'"));
  assert('imports backupModelRegistry', mrSrc.includes('backupModelRegistry'));
  assert('imports resolveModelPath', mrSrc.includes('resolveModelPath'));
  assert('imports normalizeModelPathForStorage', mrSrc.includes('normalizeModelPathForStorage'));
  assert('imports CURRENT_MODEL_SCHEMA_VERSION', mrSrc.includes('CURRENT_MODEL_SCHEMA_VERSION'));
  assert('LocalModelInfo has schemaVersion field', mrSrc.includes('schemaVersion'));
  assert('LocalModelInfo has hash field', mrSrc.includes('hash?: string'));
  assert('LocalModelInfo has hashAlgorithm field', mrSrc.includes("hashAlgorithm?: 'sha256'"));
  assert('LocalModelInfo has verifiedAt field', mrSrc.includes('verifiedAt'));
  assert('LocalModelInfo has integrityStatus field', mrSrc.includes("integrityStatus?: 'verified' | 'mismatch' | 'pending' | 'unknown'"));
  assert('addModel calls backupModelRegistry', /addModel[\s\S]{0,1000}backupModelRegistry/.test(mrSrc));
  assert('removeModel calls backupModelRegistry', /removeModel[\s\S]{0,500}backupModelRegistry/.test(mrSrc));
  assert('updateModel calls backupModelRegistry', /updateModel[\s\S]{0,500}backupModelRegistry/.test(mrSrc));
  assert('addModel normalizes path for storage', mrSrc.includes('normalizeModelPathForStorage(absPath)'));
  assert('listModels resolves path', mrSrc.includes('resolveModelPath(m.path)'));
  assert('addModel sets schemaVersion', /addModel[\s\S]{0,2000}schemaVersion: CURRENT_MODEL_SCHEMA_VERSION/.test(mrSrc));
  assert('addModel sets integrityStatus pending', /addModel[\s\S]{0,2000}integrityStatus: 'pending'/.test(mrSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Persistence state has new fields
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Persistence state schema:');
  const pSrc = read('../../src/main/persistence/index.ts');
  assert('PersistedState.localModels has schemaVersion', pSrc.includes('schemaVersion?: number'));
  assert('PersistedState.localModels has hash', pSrc.includes('hash?: string'));
  assert('PersistedState.localModels has hashAlgorithm', pSrc.includes('hashAlgorithm?: string'));
  assert('PersistedState.localModels has verifiedAt', pSrc.includes('verifiedAt?: number'));
  assert('PersistedState.localModels has integrityStatus', pSrc.includes('integrityStatus?: string'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) IPC handlers registered in main.ts
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');
  assert('model-compute-hash handler', mainSrc.includes("'model-compute-hash'"));
  assert('model-verify-integrity handler', mainSrc.includes("'model-verify-integrity'"));
  assert('model-verify-all-integrity handler', mainSrc.includes("'model-verify-all-integrity'"));
  assert('model-registry-rollback handler', mainSrc.includes("'model-registry-rollback'"));
  assert('model-registry-backup-info handler', mainSrc.includes("'model-registry-backup-info'"));
  assert('model-registry-migrate handler', mainSrc.includes("'model-registry-migrate'"));
  assert('model-detect-hardware handler', mainSrc.includes("'model-detect-hardware'"));
  assert('model-recommend handler', mainSrc.includes("'model-recommend'"));
  assert('model-can-run handler', mainSrc.includes("'model-can-run'"));
  assert('setupIPC is async', mainSrc.includes('async function setupIPC'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Preload bridges
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Preload bridges:');
  const preSrc = read('../../src/main/preload.ts');
  assert('modelComputeHash bridge', preSrc.includes('modelComputeHash'));
  assert('modelVerifyIntegrity bridge', preSrc.includes('modelVerifyIntegrity'));
  assert('modelVerifyAllIntegrity bridge', preSrc.includes('modelVerifyAllIntegrity'));
  assert('modelRegistryRollback bridge', preSrc.includes('modelRegistryRollback'));
  assert('modelRegistryBackupInfo bridge', preSrc.includes('modelRegistryBackupInfo'));
  assert('modelRegistryMigrate bridge', preSrc.includes('modelRegistryMigrate'));
  assert('modelDetectHardware bridge', preSrc.includes('modelDetectHardware'));
  assert('modelRecommend bridge', preSrc.includes('modelRecommend'));
  assert('modelCanRun bridge', preSrc.includes('modelCanRun'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Type definitions in electron.d.ts
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Type definitions:');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('modelComputeHash type', typesSrc.includes('modelComputeHash'));
  assert('modelVerifyIntegrity type', typesSrc.includes('modelVerifyIntegrity'));
  assert('modelVerifyAllIntegrity type', typesSrc.includes('modelVerifyAllIntegrity'));
  assert('modelRegistryRollback type', typesSrc.includes('modelRegistryRollback'));
  assert('modelDetectHardware type', typesSrc.includes('modelDetectHardware'));
  assert('modelRecommend type', typesSrc.includes('modelRecommend'));
  assert('modelCanRun type', typesSrc.includes('modelCanRun'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) FUNCTIONAL TESTS — hash computation, backup, migration
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Functional tests (hash, backup, migration):');

  // Create a temp file and compute its hash
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase39-'));
  const tmpFile = path.join(tmpDir, 'test.gguf');
  const testContent = Buffer.from('NEX AI Phase 39 test content');
  fs.writeFileSync(tmpFile, testContent);
  const expectedHash = crypto.createHash('sha256').update(testContent).digest('hex');

  // Test computeFileHash
  const { computeFileHash, verifyModelIntegrity, backupModelRegistry, rollbackModelRegistry, hasModelRegistryBackup, migrateModelRegistry, resolveModelPath } =
    await import('../../src/main/ai/model-versioning');

  const computedHash = await computeFileHash(tmpFile);
  assert('computeFileHash returns correct SHA-256', computedHash === expectedHash,
    `got ${computedHash.slice(0, 16)}... expected ${expectedHash.slice(0, 16)}...`);

  // Test verifyModelIntegrity — matching hash
  const matchStatus = await verifyModelIntegrity(tmpFile, expectedHash);
  assert('verifyModelIntegrity returns verified for matching hash', matchStatus === 'verified');

  // Test verifyModelIntegrity — mismatched hash
  const mismatchStatus = await verifyModelIntegrity(tmpFile, 'deadbeef');
  assert('verifyModelIntegrity returns mismatch for wrong hash', mismatchStatus === 'mismatch');

  // Test verifyModelIntegrity — no stored hash
  const unknownStatus = await verifyModelIntegrity(tmpFile, undefined);
  assert('verifyModelIntegrity returns unknown for no hash', unknownStatus === 'unknown');

  // Test verifyModelIntegrity — missing file
  const missingStatus = await verifyModelIntegrity(path.join(tmpDir, 'nonexistent.gguf'), expectedHash);
  assert('verifyModelIntegrity returns missing for absent file', missingStatus === 'missing');

  // Test backup + rollback
  const backedUp = backupModelRegistry();
  assert('backupModelRegistry returns true', backedUp === true);
  assert('hasModelRegistryBackup returns true after backup', hasModelRegistryBackup() === true);

  const rolledBack = rollbackModelRegistry();
  assert('rollbackModelRegistry returns true', rolledBack === true);

  // Test migration (idempotent)
  const migration = migrateModelRegistry();
  assert('migrateModelRegistry returns fromVersion', typeof migration.fromVersion === 'number');
  assert('migrateModelRegistry returns toVersion', migration.toVersion === 2);

  // Test resolveModelPath — absolute path that exists
  const resolved = resolveModelPath(tmpFile);
  assert('resolveModelPath returns existing absolute path', resolved === tmpFile);

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Hardware detection
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Hardware detection:');
  const { detectHardwareProfile, canModelRunOnHardware, recommendModelsForHardware } =
    await import('../../src/main/ai/hardware-model-recommender');

  const hw = detectHardwareProfile(
    {
      cpu: { cores: 8, threads: 16 },
      memory: { totalBytes: 32 * 1e9, freeBytes: 16 * 1e9 },
      gpus: [{ name: 'RTX 4070', vendor: 'nvidia', vramTotalBytes: 12 * 1e9, vramUsedBytes: 2 * 1e9 }],
    },
    'cuda',
  );
  assert('detectHardwareProfile returns cpuCores', hw.cpuCores === 8);
  assert('detectHardwareProfile returns ramTotalBytes', hw.ramTotalBytes === 32 * 1e9);
  assert('detectHardwareProfile detects GPU', hw.gpu !== null);
  assert('detectHardwareProfile GPU vendor nvidia', hw.gpu?.vendor === 'nvidia');
  assert('detectHardwareProfile GPU supportsCuda', hw.gpu?.supportsCuda === true);

  // Test canModelRunOnHardware — small model on good hardware
  const smallModel = {
    id: 'test-1', name: 'Test 7B', path: '/tmp/test.gguf',
    sizeBytes: 4 * 1e9, contextSize: 2048, gpuLayers: -1,
    category: 'general' as const, addedAt: 0, fileExists: true,
    minRamBytes: 6 * 1e9, minVramBytes: 5 * 1e9,
  };
  const verdict = canModelRunOnHardware(smallModel as any, hw);
  assert('7B model on 32GB RAM + 12GB VRAM: canRun=true', verdict.canRun === true);
  assert('verdict suggests full GPU offload (-1)', verdict.suggestedGpuLayers === -1);
  assert('verdict suggests 8 threads', verdict.suggestedThreads === 8);

  // Test canModelRunOnHardware — large model on limited hardware
  const largeModel = {
    id: 'test-2', name: 'Test 70B', path: '/tmp/large.gguf',
    sizeBytes: 40 * 1e9, contextSize: 2048, gpuLayers: -1,
    category: 'reasoning' as const, addedAt: 0, fileExists: true,
    minRamBytes: 48 * 1e9, minVramBytes: 40 * 1e9,
  };
  const verdict2 = canModelRunOnHardware(largeModel as any, hw);
  assert('70B model on 32GB RAM: canRun=false', verdict2.canRun === false);
  assert('verdict2 has reason explaining RAM shortage', verdict2.reason.includes('RAM'));

  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 39 MODEL MANAGER RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('PHASE 39 MODEL MANAGER: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
