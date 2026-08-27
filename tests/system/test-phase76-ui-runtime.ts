/**
 * Phase 76 — Final UI Integration + Voice Runtime Tests
 *
 * Verifies:
 *   1. Voice providers search <userData>/runtime/ directories
 *   2. findWhisperModels() + findPiperVoices() discover model files
 *   3. [VOICE_RUNTIME] diagnostics in voice-find-binaries IPC
 *   4. NexLibraryPanel Voice tab uses unified installer
 *   5. Voice install progress subscription exists
 *   6. Source display in UI
 *   7. Manual import for voice components
 *   8. Installed tab shows voice components
 *   9. Spinner terminates on terminal states
 *  10. No old component-install IPC in Voice tab
 */
import '../__mocks__/install-electron-mock.js';

import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main(): Promise<void> {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Phase 76 — Final UI Integration + Voice Runtime Tests');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) Voice providers search NEX runtime directories
  // ═══════════════════════════════════════════════════════════════════════
  console.log('1) Voice providers search NEX runtime directories:');
  const whisperSrc = read('../../src/main/voice/local-whisper-provider.ts');
  const piperSrc = read('../../src/main/voice/local-piper-provider.ts');

  assert('Whisper: getNexWhisperRuntimeDir exists', whisperSrc.includes('function getNexWhisperRuntimeDir'));
  assert('Whisper: searches userData/runtime/whisper', whisperSrc.includes("'runtime', 'whisper'"));
  assert('Whisper: scans dir for executables', whisperSrc.includes('readdirSync'));
  assert('Whisper: finds whisper executables by name', whisperSrc.includes("name.includes('whisper')"));
  assert('Whisper: findWhisperModels function exists', whisperSrc.includes('export function findWhisperModels'));
  assert('Whisper: findWhisperModels scans models/whisper', whisperSrc.includes("'models', 'whisper'"));
  assert('Whisper: findWhisperModels returns .bin files', whisperSrc.includes(".endsWith('.bin')"));

  assert('Piper: getNexPiperRuntimeDir exists', piperSrc.includes('function getNexPiperRuntimeDir'));
  assert('Piper: searches userData/runtime/piper', piperSrc.includes("'runtime', 'piper'"));
  assert('Piper: scans dir for executables', piperSrc.includes('readdirSync'));
  assert('Piper: finds piper executables by name', piperSrc.includes("name.includes('piper')"));
  assert('Piper: findPiperVoices function exists', piperSrc.includes('export function findPiperVoices'));
  assert('Piper: findPiperVoices scans models/piper', piperSrc.includes("'models', 'piper'"));
  assert('Piper: findPiperVoices returns .onnx files', piperSrc.includes(".endsWith('.onnx')"));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) [VOICE_RUNTIME] diagnostics in main.ts
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) [VOICE_RUNTIME] diagnostics:');
  const mainSrc = read('../../src/main/main.ts');

  assert('[VOICE_RUNTIME] log in voice-find-binaries', mainSrc.includes('[VOICE_RUNTIME]'));
  assert('[VOICE_RUNTIME] logs whisperBinary', mainSrc.includes('whisperBinary='));
  assert('[VOICE_RUNTIME] logs whisperModel', mainSrc.includes('whisperModel='));
  assert('[VOICE_RUNTIME] logs piperBinary', mainSrc.includes('piperBinary='));
  assert('[VOICE_RUNTIME] logs piperVoice', mainSrc.includes('piperVoice='));
  assert('[VOICE_RUNTIME] logs exists flags', mainSrc.includes('Exists='));
  assert('voice-find-binaries returns whisperModels', mainSrc.includes('whisperModels'));
  assert('voice-find-binaries returns piperVoices', mainSrc.includes('piperVoices'));
  assert('voice-find-binaries returns whisperReady', mainSrc.includes('whisperReady'));
  assert('voice-find-binaries returns piperReady', mainSrc.includes('piperReady'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) NexLibraryPanel Voice tab uses unified installer
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) NexLibraryPanel Voice tab:');
  const libSrc = read('../../src/renderer/components/NexLibraryPanel.tsx');

  assert('Voice tab uses componentUnifiedVoiceList', libSrc.includes('componentUnifiedVoiceList'));
  assert('Voice tab calls componentUnifiedInstall', libSrc.includes('componentUnifiedInstall'));
  assert('handleInstallVoiceComponent exists', libSrc.includes('handleInstallVoiceComponent'));
  assert('handleImportVoiceComponent exists', libSrc.includes('handleImportVoiceComponent'));
  assert('voiceComponents state exists', libSrc.includes('voiceComponents'));
  assert('voiceInstallProgress state exists', libSrc.includes('voiceInstallProgress'));
  assert('voiceRuntimeStatus state exists', libSrc.includes('voiceRuntimeStatus'));
  assert('Subscribes to onComponentInstallProgress', libSrc.includes('onComponentInstallProgress'));
  assert('Voice tab shows STT section', libSrc.includes('تشخیص گفتار'));
  assert('Voice tab shows TTS section', libSrc.includes('تولید گفتار'));
  assert('Voice tab shows source labels', libSrc.includes('s.label'));
  assert('Voice tab shows runtime status', libSrc.includes('وضعیت رانتایم صوت'));
  assert('Voice tab shows Whisper status', libSrc.includes('whisperReady'));
  assert('Voice tab shows Piper status', libSrc.includes('piperReady'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Spinner terminates on terminal states
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Spinner terminates:');
  // Check that isActive excludes terminal states — the code uses:
  // !['completed', 'download-failed', 'cancelled', 'permission-denied'].includes(progress.state)
  assert('isActive excludes terminal states (completed/download-failed/cancelled/permission-denied)',
    libSrc.includes("'completed'") && libSrc.includes("'download-failed'") &&
    libSrc.includes("'cancelled'") && libSrc.includes("'permission-denied'") &&
    libSrc.includes('.includes(progress.state)'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) No old component-install in Voice tab
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) No old download paths in Voice tab:');
  // The old path was handleInstallModel(m.downloadUrl, m.name) — check it's not used in Voice section
  const voiceSectionStart = libSrc.indexOf('Voice (Phase 76');
  const voiceSectionEnd = libSrc.indexOf('Tools ═══', voiceSectionStart);
  if (voiceSectionStart > 0 && voiceSectionEnd > 0) {
    const voiceSection = libSrc.slice(voiceSectionStart, voiceSectionEnd);
    assert('Voice section does NOT use handleInstallModel', !voiceSection.includes('handleInstallModel'));
    assert('Voice section does NOT use old downloadUrl', !voiceSection.includes('m.downloadUrl'));
    assert('Voice section uses handleInstallVoiceComponent', voiceSection.includes('handleInstallVoiceComponent'));
  } else {
    assert('Voice section found', false, `start=${voiceSectionStart}, end=${voiceSectionEnd}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Preload + types include voice model discovery
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Preload + types:');
  const preloadSrc = read('../../src/main/preload.ts');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');

  assert('preload: voiceFindBinaries exists', preloadSrc.includes('voiceFindBinaries:'));
  assert('preload: componentUnifiedInstall exists', preloadSrc.includes('componentUnifiedInstall:'));
  assert('preload: onComponentInstallProgress exists', preloadSrc.includes('onComponentInstallProgress:'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Behavioral: findWhisperModels + findPiperVoices
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Behavioral: model discovery:');
  const { findWhisperModels } = await import('../../src/main/voice/local-whisper-provider');
  const { findPiperVoices } = await import('../../src/main/voice/local-piper-provider');

  // These should return arrays (empty if dir doesn't exist)
  const whisperModels = findWhisperModels();
  assert('findWhisperModels returns array', Array.isArray(whisperModels));

  const piperVoices = findPiperVoices();
  assert('findPiperVoices returns array', Array.isArray(piperVoices));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Security: no TLS bypass
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Security:');
  assert('NO rejectUnauthorized=false in whisper provider', !whisperSrc.includes('rejectUnauthorized'));
  assert('NO rejectUnauthorized=false in piper provider', !piperSrc.includes('rejectUnauthorized'));
  assert('NO rejectUnauthorized=false in unified installer', !read('../../src/main/runtime/unified-component-installer.ts').includes('rejectUnauthorized'));

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 76 Tests: ${pass} passed, ${fail} failed`);
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
