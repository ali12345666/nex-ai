/**
 * Phase 46 — Local Runtime Setup Center Tests
 *
 * Verifies:
 *   1. Component catalog (recommended components with download info)
 *   2. RuntimeSetupManager (detects all components + OS + portable)
 *   3. Recommendations (hardware-aware, Persian text)
 *   4. IPC handlers registered
 *   5. Preload bridges present
 *   6. UI panel exists and renders
 *   7. NavigationRail includes 'runtime' view
 *   8. No autonomous download/install
 *
 * Run: npx tsx tests/system/test-phase46-runtime-setup.ts
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

  // ═══════════════════════════════════════════════════════════════════════
  // 1) Component Catalog
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) Component Catalog:');
  const ccSrc = read('../../src/main/runtime/component-catalog.ts');

  assert('component-catalog.ts exists', ccSrc.length > 0);
  assert('CatalogComponent interface', ccSrc.includes('interface CatalogComponent'));
  assert('ComponentType type (llm/voice-stt/voice-tts/vision/tool)', ccSrc.includes("'llm'") && ccSrc.includes("'voice-stt'") && ccSrc.includes("'vision'") && ccSrc.includes("'tool'"));
  assert('component has name', ccSrc.includes('name: string'));
  assert('component has purpose', ccSrc.includes('purpose: string'));
  assert('component has purposeFa (Persian)', ccSrc.includes('purposeFa'));
  assert('component has sizeBytes', ccSrc.includes('sizeBytes'));
  assert('component has downloadUrl', ccSrc.includes('downloadUrl'));
  assert('component has checksum', ccSrc.includes('checksum'));
  assert('component has requiredRAM', ccSrc.includes('requiredRAM'));
  assert('component has requiredVRAM', ccSrc.includes('requiredVRAM'));
  assert('component has recommendedRAM', ccSrc.includes('recommendedRAM'));
  assert('component has recommendedVRAM', ccSrc.includes('recommendedVRAM'));
  assert('component has targetDir', ccSrc.includes('targetDir'));
  assert('component has filename', ccSrc.includes('filename'));
  assert('component has isEssential', ccSrc.includes('isEssential'));
  assert('getCatalog function', ccSrc.includes('export function getCatalog'));
  assert('getCatalogByType function', ccSrc.includes('export function getCatalogByType'));
  assert('getCatalogEntry function', ccSrc.includes('export function getCatalogEntry'));
  assert('getEssentialComponents function', ccSrc.includes('export function getEssentialComponents'));

  // Catalog entries
  assert('has Qwen Coder 7B', ccSrc.includes('qwen2.5-coder-7b'));
  assert('has Qwen 7B', ccSrc.includes('qwen2.5-7b'));
  assert('has Qwen 0.5B', ccSrc.includes('qwen2.5-0.5b'));
  assert('has Whisper Base', ccSrc.includes('whisper-base'));
  assert('has Whisper Medium', ccSrc.includes('whisper-medium'));
  assert('has Piper voice', ccSrc.includes('piper'));
  assert('has LLaVA 7B', ccSrc.includes('llava-7b'));
  assert('has llama.cpp tool', ccSrc.includes('llama-cpp'));
  assert('has ffmpeg tool', ccSrc.includes('ffmpeg'));

  // Functional
  const { getCatalog, getCatalogByType, getCatalogEntry, getEssentialComponents } =
    await import('../../src/main/runtime/component-catalog');
  const catalog = getCatalog();
  assert('catalog has 9+ entries', catalog.length >= 9);
  assert('getCatalogByType(llm) returns LLMs', getCatalogByType('llm').length >= 3);
  assert('getCatalogByType(voice-stt) returns STT', getCatalogByType('voice-stt').length >= 2);
  assert('getCatalogByType(vision) returns vision', getCatalogByType('vision').length >= 1);
  assert('getCatalogByType(tool) returns tools', getCatalogByType('tool').length >= 2);
  assert('getCatalogEntry returns entry', getCatalogEntry('qwen2.5-7b-q4') !== null);
  assert('getCatalogEntry returns null for unknown', getCatalogEntry('nonexistent') === null);
  assert('getEssentialComponents returns essentials', getEssentialComponents().length >= 2);
  assert('essential components have isEssential=true', getEssentialComponents().every((c) => c.isEssential));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) RuntimeSetupManager
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) RuntimeSetupManager:');
  const rmSrc = read('../../src/main/runtime/runtime-setup-manager.ts');

  assert('runtime-setup-manager.ts exists', rmSrc.length > 0);
  assert('RuntimeSetupManager class exported', rmSrc.includes('export class RuntimeSetupManager'));
  assert('scanSystem method', rmSrc.includes('scanSystem'));
  assert('generateSetupSummary method', rmSrc.includes('generateSetupSummary'));
  assert('ComponentStatus type (installed/missing/partial/unknown)', rmSrc.includes("'installed'") && rmSrc.includes("'missing'") && rmSrc.includes("'partial'"));
  assert('DetectedComponent interface', rmSrc.includes('interface DetectedComponent'));
  assert('RuntimeSetupState interface', rmSrc.includes('interface RuntimeSetupState'));
  assert('ComponentRecommendation interface', rmSrc.includes('interface ComponentRecommendation'));
  assert('uses detectHardwareProfile (Phase 39)', rmSrc.includes('detectHardwareProfile'));
  assert('uses listModels (Phase 39)', rmSrc.includes('listModels'));
  assert('uses findWhisperBinary (Phase 41)', rmSrc.includes('findWhisperBinary'));
  assert('uses findPiperBinary (Phase 41)', rmSrc.includes('findPiperBinary'));
  assert('uses findLlamaBinary (Phase 42)', rmSrc.includes('findLlamaBinary'));
  assert('uses findFfmpegBinary (Phase 41)', rmSrc.includes('findFfmpegBinary'));
  assert('uses getCatalog', rmSrc.includes('getCatalog'));
  assert('detects OS', rmSrc.includes('process.platform'));
  assert('detects portable mode', rmSrc.includes('portable'));
  assert('has essentialMissing count', rmSrc.includes('essentialMissing'));
  assert('has optionalMissing count', rmSrc.includes('optionalMissing'));
  assert('has totalInstalled', rmSrc.includes('totalInstalled'));
  assert('has totalMissing', rmSrc.includes('totalMissing'));
  assert('has recommendations array', rmSrc.includes('recommendations'));
  assert('hardwareFit (perfect/good/tight/insufficient)', rmSrc.includes("'perfect'") && rmSrc.includes("'good'") && rmSrc.includes("'insufficient'"));
  assert('Persian setup text', rmSrc.includes('سلام، NEX AI'));
  assert('Persian component labels', rmSrc.includes('ضروری'));
  assert('getRuntimeSetupManager singleton', rmSrc.includes('export function getRuntimeSetupManager'));
  assert('NO download() calls', !rmSrc.includes('download('));
  assert('NO install() calls', !rmSrc.includes('install('));
  assert('NO removeModel() calls', !rmSrc.includes('removeModel'));
  assert('NO PermissionGate import (manager only scans)', !rmSrc.includes("import { PermissionGate }"));

  // Functional: scanSystem
  const { getRuntimeSetupManager } = await import('../../src/main/runtime/runtime-setup-manager');
  const manager = getRuntimeSetupManager();
  const state = manager.scanSystem();
  assert('scanSystem returns state', state !== null);
  assert('state has os', typeof state.os === 'string');
  assert('state has isPortable', typeof state.isPortable === 'boolean');
  assert('state has hardware', state.hardware !== null);
  assert('state has components array', Array.isArray(state.components));
  assert('state has essentialMissing', typeof state.essentialMissing === 'number');
  assert('state has optionalMissing', typeof state.optionalMissing === 'number');
  assert('state has totalInstalled', typeof state.totalInstalled === 'number');
  assert('state has totalMissing', typeof state.totalMissing === 'number');
  assert('state has recommendations', Array.isArray(state.recommendations));

  // Functional: generateSetupSummary
  const summary = manager.generateSetupSummary(state);
  assert('summary is string', typeof summary === 'string');
  assert('summary contains Persian greeting', summary.includes('سلام'));
  assert('summary contains CPU info', summary.includes('CPU'));
  assert('summary contains RAM info', summary.includes('RAM'));
  assert('summary contains OS info', summary.includes('OS'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) IPC handlers registered
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');
  assert('runtime-scan handler', mainSrc.includes("'runtime-scan'"));
  assert('runtime-setup-summary handler', mainSrc.includes("'runtime-setup-summary'"));
  assert('runtime-catalog handler', mainSrc.includes("'runtime-catalog'"));
  assert('runtime-recommendations handler', mainSrc.includes("'runtime-recommendations'"));
  assert('runtime-find-missing handler', mainSrc.includes("'runtime-find-missing'"));
  assert('Phase 46 comment in main.ts', mainSrc.includes('Phase 46'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Preload bridges
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Preload bridges:');
  const preSrc = read('../../src/main/preload.ts');
  assert('runtimeScan bridge', preSrc.includes('runtimeScan'));
  assert('runtimeSetupSummary bridge', preSrc.includes('runtimeSetupSummary'));
  assert('runtimeCatalog bridge', preSrc.includes('runtimeCatalog'));
  assert('runtimeRecommendations bridge', preSrc.includes('runtimeRecommendations'));
  assert('runtimeFindMissing bridge', preSrc.includes('runtimeFindMissing'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Type definitions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Type definitions:');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('runtimeScan type', typesSrc.includes('runtimeScan'));
  assert('runtimeSetupSummary type', typesSrc.includes('runtimeSetupSummary'));
  assert('runtimeCatalog type', typesSrc.includes('runtimeCatalog'));
  assert('runtimeRecommendations type', typesSrc.includes('runtimeRecommendations'));
  assert('runtimeFindMissing type', typesSrc.includes('runtimeFindMissing'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) UI Panel
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) UI Panel:');
  const panelSrc = read('../../src/renderer/components/layout/RuntimeSetupPanel.tsx');

  assert('RuntimeSetupPanel.tsx exists', panelSrc.length > 0);
  assert('default export', panelSrc.includes('export default function RuntimeSetupPanel'));
  assert('uses window.nexAPI.runtimeSetupSummary', panelSrc.includes('runtimeSetupSummary'));
  assert('shows System section', panelSrc.includes('سیستم'));
  assert('shows CPU', panelSrc.includes('cpuCores') || panelSrc.includes('CPU'));
  assert('shows RAM', panelSrc.includes('ramTotalBytes') || panelSrc.includes('RAM'));
  assert('shows GPU', panelSrc.includes('gpu'));
  assert('shows VRAM', panelSrc.includes('vramTotalBytes'));
  assert('shows OS', panelSrc.includes('os'));
  assert('shows Portable', panelSrc.includes('isPortable'));
  assert('shows component status (installed/missing)', panelSrc.includes('installed') || panelSrc.includes('CheckCircle2'));
  assert('shows missing icon (XCircle)', panelSrc.includes('XCircle'));
  assert('shows essential badge (ضروری)', panelSrc.includes('ضروری'));
  assert('shows essentialMissing warning', panelSrc.includes('essentialMissing'));
  assert('shows recommendations section', panelSrc.includes('پیشنهادات'));
  assert('shows recommendation name', panelSrc.includes('comp.name'));
  assert('shows recommendation purposeFa', panelSrc.includes('purposeFa'));
  assert('shows recommendation size', panelSrc.includes('sizeBytes'));
  assert('shows hardwareFit', panelSrc.includes('hardwareFit'));
  assert('shows Persian fit labels', panelSrc.includes('تطابق'));
  assert('shows scan button', panelSrc.includes('اسکن مجدد') || panelSrc.includes('RefreshCw'));
  assert('shows permission notice (Persian)', panelSrc.includes('بدون اجازه صریح'));
  assert('shows permission notice (تایید)', panelSrc.includes('تایید می‌کنم'));
  assert('uses loading state', panelSrc.includes('loading'));
  assert('uses error state', panelSrc.includes('error'));
  assert('imports lucide icons', panelSrc.includes('lucide-react'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) NavigationRail + AppShell
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) NavigationRail + AppShell:');
  const navSrc = read('../../src/renderer/components/layout/NavigationRail.tsx');
  assert('NexView includes runtime', navSrc.includes("'runtime'"));
  assert('NAV_ITEMS includes runtime', navSrc.includes("id: 'runtime'"));
  assert('runtime has Rocket icon', navSrc.includes('Rocket'));
  assert('runtime has Setup label', navSrc.includes("label: 'Setup'"));

  const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
  assert('lazy import RuntimeSetupPanel', shellSrc.includes('RuntimeSetupPanel'));
  assert('case runtime in leftPanel', shellSrc.includes("case 'runtime'"));
  assert('renders RuntimeSetupPanel', shellSrc.includes('<RuntimeSetupPanel'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) No autonomous download/install
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) No autonomous actions:');
  assert('NO download() in setup manager', !rmSrc.includes('download('));
  assert('NO install() in setup manager', !rmSrc.includes('install('));
  assert('NO updateDownload in panel', !panelSrc.includes('updateDownload'));
  assert('NO updateInstall in panel', !panelSrc.includes('updateInstall'));
  assert('NO modelAdd in panel', !panelSrc.includes('modelAdd'));
  assert('NO modelRemove in panel', !panelSrc.includes('modelRemove'));
  assert('panel shows permission notice', panelSrc.includes('بدون اجازه'));
  assert('panel shows "تایید می‌کنم" requirement', panelSrc.includes('تایید می‌کنم'));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Phase 43/44 integration check
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Phase 43/44 integration:');
  assert('main.ts still has permission-gate import (Phase 43)', mainSrc.includes("permission-gate"));
  assert('main.ts still has SecureDownloader (Phase 44)', mainSrc.includes('SecureDownloader'));
  assert('main.ts still has update-download IPC (Phase 44)', mainSrc.includes("'update-download'"));
  assert('main.ts still has update-install IPC (Phase 44)', mainSrc.includes("'update-install'"));
  assert('main.ts still has update-respond-permission IPC (Phase 43)', mainSrc.includes("'update-respond-permission'"));

  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 46 RUNTIME SETUP RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('PHASE 46 LOCAL RUNTIME SETUP CENTER: ALL PASS ✅');
  console.log('\nNOTE: Windows runtime QA is NOT VERIFIED by this test.');
  console.log('      The user MUST verify on Windows:');
  console.log('      1. Click "Setup" in nav rail → system scan + component status');
  console.log('      2. Missing components shown with Persian labels');
  console.log('      3. Recommendations show hardware fit');
  console.log('      4. NO download/install without "تایید می‌کنم"');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
