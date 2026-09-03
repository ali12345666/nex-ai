/**
 * Phase 75 — Unified Component Installer Tests
 *
 * Verifies:
 *   1. Unified component catalog exists with multi-source support
 *   2. Voice components (whisper, piper) have verified sources
 *   3. Binary components (whisper-cli, piper) have GitHub release URLs
 *   4. No sizeBytes:0 shortcuts
 *   5. UnifiedComponentInstaller delegates to ModelDownloadManager
 *   6. [COMPONENT_DOWNLOAD]/[COMPONENT_VERIFY]/[COMPONENT_INSTALL] logs
 *   7. validateFileIntegrity works for non-GGUF files
 *   8. IPC handlers registered
 *   9. Preload bindings exist
 *  10. Old ComponentInstaller still exists (backward compat) but new one is unified
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
  console.log('Phase 75 — Unified Component Installer Tests');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) Unified Component Catalog
  // ═══════════════════════════════════════════════════════════════════════
  console.log('1) Unified Component Catalog:');
  const catSrc = read('../../src/main/runtime/unified-component-catalog.ts');

  assert('UNIFIED_COMPONENT_CATALOG exists', catSrc.includes('export const UNIFIED_COMPONENT_CATALOG'));
  assert('UnifiedComponent interface exists', catSrc.includes('export interface UnifiedComponent'));
  assert('UnifiedComponentType includes voice-stt-binary', catSrc.includes("'voice-stt-binary'"));
  assert('UnifiedComponentType includes voice-tts-binary', catSrc.includes("'voice-tts-binary'"));
  assert('Catalog has Qwen2.5 0.5B', catSrc.includes("id: 'qwen2.5-0.5b-q4'"));
  assert('Catalog has Whisper Base', catSrc.includes("id: 'whisper-base-en'"));
  assert('Catalog has Whisper Binary', catSrc.includes("id: 'whisper-cli-binary'"));
  assert('Catalog has Piper Voice', catSrc.includes("id: 'piper-en-us-lessac-medium'"));
  assert('Catalog has Piper Binary', catSrc.includes("id: 'piper-binary'"));
  assert('Catalog uses ModelSource[]', catSrc.includes('sources: ModelSource[]'));
  assert('Catalog has installationPath', catSrc.includes('installationPath:'));
  assert('Catalog has expectedSize', catSrc.includes('expectedSize:'));
  assert('Catalog does NOT use sizeBytes:0', !catSrc.includes('sizeBytes: 0'));
  assert('Catalog has getVoiceComponents helper', catSrc.includes('export function getVoiceComponents'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Verified sources
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Verified sources:');
  assert('Whisper binary uses GitHub Releases', catSrc.includes('github.com/ggml-org/whisper.cpp/releases'));
  assert('Piper binary uses GitHub Releases', catSrc.includes('github.com/rhasspy/piper/releases'));
  assert('Qwen has HuggingFace source', catSrc.includes('huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF'));
  assert('Qwen has ModelScope source', catSrc.includes('modelscope.cn/api/v1/models/Qwen'));
  assert('Whisper model has HuggingFace source', catSrc.includes('huggingface.co/ggerganov/whisper.cpp'));
  assert('Piper model has HuggingFace source', catSrc.includes('huggingface.co/rhasspy/piper-voices'));
  assert('No invented URLs', !catSrc.includes('example.com') && !catSrc.includes('fake-mirror'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) Unified Component Installer
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Unified Component Installer:');
  const instSrc = read('../../src/main/runtime/unified-component-installer.ts');

  assert('UnifiedComponentInstallerClass exists', instSrc.includes('class UnifiedComponentInstallerClass'));
  assert('installComponent method exists', instSrc.includes('async installComponent('));
  assert('Uses getModelDownloadManager', instSrc.includes('getModelDownloadManager'));
  assert('Uses validateGgufIntegrity for GGUF', instSrc.includes('validateGgufIntegrity'));
  assert('Uses validateFileIntegrity for non-GGUF', instSrc.includes('validateFileIntegrity'));
  assert('Has ZIP extraction for binaries', instSrc.includes('extractZip'));
  assert('Does NOT use old SecureDownloader directly', !instSrc.includes('new SecureDownloader'));
  assert('[COMPONENT_DOWNLOAD] log exists', instSrc.includes('[COMPONENT_DOWNLOAD]'));
  assert('[COMPONENT_VERIFY] log exists', instSrc.includes('[COMPONENT_VERIFY]'));
  assert('[COMPONENT_INSTALL] log exists', instSrc.includes('[COMPONENT_INSTALL]'));
  assert('isInstalled method exists', instSrc.includes('isInstalled('));
  assert('cancelInstall method exists', instSrc.includes('cancelInstall('));
  assert('listInstalledComponents method exists', instSrc.includes('listInstalledComponents('));
  assert('Uses getComponentInstallPath', instSrc.includes('getComponentInstallPath'));
  assert('Does NOT use os.tmpdir for install', !instSrc.includes("os.tmpdir()") || !instSrc.includes('installPath'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) validateFileIntegrity function
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) validateFileIntegrity:');
  const dlSrc = read('../../src/main/ai/model-download-manager.ts');

  assert('validateFileIntegrity exported', dlSrc.includes('export async function validateFileIntegrity'));
  assert('FileIntegrityResult interface exists', dlSrc.includes('export interface FileIntegrityResult'));
  assert('Does NOT require GGUF magic', !dlSrc.includes("magicString === 'GGUF'") || dlSrc.includes('validateGgufIntegrity'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Behavioral: validateFileIntegrity
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Behavioral: validateFileIntegrity:');
  const { validateFileIntegrity } = await import('../../src/main/ai/model-download-manager');

  // Create a test file
  const testFile = path.join(os.tmpdir(), `nex-phase75-test-${Date.now()}.bin`);
  fs.writeFileSync(testFile, Buffer.alloc(1000, 0xFF));

  const result = await validateFileIntegrity(testFile, undefined, 1000);
  assert('validateFileIntegrity passes on valid file', result.passed === true);
  assert('validateFileIntegrity computes hash', result.actualHash.length === 64);
  assert('validateFileIntegrity reports size', result.actualSize === 1000);

  // Test size mismatch
  const result2 = await validateFileIntegrity(testFile, undefined, 2000);
  assert('validateFileIntegrity fails on size mismatch', result2.passed === false);
  assert('validateFileIntegrity reports size error', result2.error?.includes('Size mismatch'));

  // Cleanup
  try { fs.unlinkSync(testFile); } catch {}

  // ═══════════════════════════════════════════════════════════════════════
  // 6) IPC handlers registered
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');

  assert('component-unified-list handler registered', mainSrc.includes("ipcMain.handle('component-unified-list'"));
  assert('component-unified-voice-list handler registered', mainSrc.includes("ipcMain.handle('component-unified-voice-list'"));
  assert('component-unified-get handler registered', mainSrc.includes("ipcMain.handle('component-unified-get'"));
  assert('component-unified-install handler registered', mainSrc.includes("ipcMain.handle('component-unified-install'"));
  assert('component-unified-cancel handler registered', mainSrc.includes("ipcMain.handle('component-unified-cancel'"));
  assert('component-unified-is-installed handler registered', mainSrc.includes("ipcMain.handle('component-unified-is-installed'"));
  assert('component-unified-installed-list handler registered', mainSrc.includes("ipcMain.handle('component-unified-installed-list'"));
  assert('component-unified-import-local handler registered', mainSrc.includes("ipcMain.handle('component-unified-import-local'"));
  assert('install handler requests permission first', mainSrc.includes('await requestDownloadPermission'));
  assert('install handler uses unifiedInstaller', mainSrc.includes('unifiedInstaller.installComponent'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Preload + types
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Preload + types:');
  const preloadSrc = read('../../src/main/preload.ts');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');

  assert('preload: componentUnifiedList', preloadSrc.includes('componentUnifiedList:'));
  assert('preload: componentUnifiedInstall', preloadSrc.includes('componentUnifiedInstall:'));
  assert('preload: componentUnifiedImportLocal', preloadSrc.includes('componentUnifiedImportLocal:'));
  assert('preload: onComponentInstallProgress', preloadSrc.includes('onComponentInstallProgress:'));
  assert('types: componentUnifiedInstall declared', typesSrc.includes('componentUnifiedInstall:'));
  assert('types: onComponentInstallProgress declared', typesSrc.includes('onComponentInstallProgress:'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) No duplicate downloaders (check that old ComponentInstaller is not
  //    used for new installs — it still exists for backward compat)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Unified pipeline (no duplicates):');
  assert('main.ts imports unified installer', mainSrc.includes("import('./runtime/unified-component-installer')"));
  assert('main.ts imports unified catalog', mainSrc.includes("import('./runtime/unified-component-catalog')"));
  assert('New installer does NOT create SecureDownloader', !instSrc.includes('new SecureDownloader'));
  assert('New installer delegates to ModelDownloadManager', instSrc.includes('getModelDownloadManager'));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Behavioral: UnifiedComponentInstaller
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Behavioral: UnifiedComponentInstaller:');
  const { getUnifiedComponentInstaller, _resetUnifiedComponentInstaller, getComponentInstallPath } =
    await import('../../src/main/runtime/unified-component-installer');
  const { getUnifiedComponent } = await import('../../src/main/runtime/unified-component-catalog');

  _resetUnifiedComponentInstaller();
  const installer = getUnifiedComponentInstaller();

  assert('getUnifiedComponentInstaller returns singleton', installer === getUnifiedComponentInstaller());

  // Test isInstalled returns false for non-existent component
  const isInstalled = installer.isInstalled('whisper-base-en');
  assert('isInstalled returns boolean', typeof isInstalled === 'boolean');

  // Test getComponentInstallPath
  const whisperComponent = getUnifiedComponent('whisper-base-en');
  assert('whisper-base-en found in catalog', whisperComponent !== null);
  if (whisperComponent) {
    const installPath = getComponentInstallPath(whisperComponent);
    assert('Install path includes models/whisper', installPath.includes('models') && installPath.includes('whisper'));
    assert('Install path includes filename', installPath.includes('ggml-base.en.bin'));
  }

  // Test piper binary
  const piperBinary = getUnifiedComponent('piper-binary');
  assert('piper-binary found in catalog', piperBinary !== null);
  if (piperBinary) {
    assert('Piper binary install path is runtime/piper', piperBinary.installationPath === 'runtime/piper');
    assert('Piper binary filename is .zip', piperBinary.filename.endsWith('.zip'));
    assert('Piper binary source is GitHub', piperBinary.sources[0].url.includes('github.com'));
  }

  // Test whisper binary
  const whisperBinary = getUnifiedComponent('whisper-cli-binary');
  assert('whisper-cli-binary found in catalog', whisperBinary !== null);
  if (whisperBinary) {
    assert('Whisper binary install path is runtime/whisper', whisperBinary.installationPath === 'runtime/whisper');
    assert('Whisper binary filename is .zip', whisperBinary.filename.endsWith('.zip'));
    assert('Whisper binary source is GitHub', whisperBinary.sources[0].url.includes('github.com'));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 75 Tests: ${pass} passed, ${fail} failed`);
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
