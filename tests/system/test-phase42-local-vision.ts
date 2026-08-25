/**
 * Phase 42 — Local Vision Intelligence Architecture Tests
 *
 * Verifies the new local vision system:
 *   1. VisionEngine (orchestrator)
 *   2. VisionProvider interface + LocalLlavaProvider
 *   3. IPC handlers registered
 *   4. Preload bridges present
 *   5. Type definitions present
 *   6. No cloud API calls anywhere
 *   7. Model Manager integration (vision category)
 *   8. Persistence (visionModelPath in settings)
 *
 * Run: npx tsx tests/system/test-phase42-local-vision.ts
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

  // ═══════════════════════════════════════════════════════════════════════
  // 1) VisionEngine module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) VisionEngine module:');
  const engineSrc = read('../../src/main/vision/vision-engine.ts');

  assert('vision-engine.ts exists', engineSrc.length > 0);
  assert('VisionProvider interface exported', engineSrc.includes('export interface VisionProvider'));
  assert('VisionProvider has isLocal field', engineSrc.includes('readonly isLocal: boolean'));
  assert('VisionProvider has analyzeImage', engineSrc.includes('analyzeImage'));
  assert('VisionProvider has analyzeScreenshot', engineSrc.includes('analyzeScreenshot'));
  assert('VisionProvider has init/shutdown', engineSrc.includes('init()') && engineSrc.includes('shutdown()'));
  assert('VisionEngine class exported', engineSrc.includes('export class VisionEngine'));
  assert('engine has setProvider', engineSrc.includes('setProvider'));
  assert('engine has getProvider', engineSrc.includes('getProvider'));
  assert('engine has analyzeImage', engineSrc.includes('analyzeImage'));
  assert('engine has analyzeScreenshot', engineSrc.includes('analyzeScreenshot'));
  assert('engine has hasProvider', engineSrc.includes('hasProvider'));
  assert('engine has hasLocalProvider', engineSrc.includes('hasLocalProvider'));
  assert('engine has state management', engineSrc.includes('VisionEngineState'));
  assert('engine states (idle/loading/analyzing/error)', engineSrc.includes("'idle'") && engineSrc.includes("'analyzing'"));
  assert('getVisionEngine singleton', engineSrc.includes('export function getVisionEngine'));
  assert('VisionEngineCallbacks interface', engineSrc.includes('interface VisionEngineCallbacks'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) LocalLlavaProvider module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) LocalLlavaProvider module:');
  const llavaSrc = read('../../src/main/vision/local-llava-provider.ts');

  assert('local-llava-provider.ts exists', llavaSrc.length > 0);
  assert('LocalLlavaProvider class exported', llavaSrc.includes('export class LocalLlavaProvider'));
  assert('implements VisionProvider', llavaSrc.includes('implements VisionProvider'));
  assert('isLocal = true', llavaSrc.includes('readonly isLocal = true'));
  assert('name = llava', llavaSrc.includes("readonly name = 'llava'"));
  assert('findLlamaBinary exported', llavaSrc.includes('export function findLlamaBinary'));
  assert('uses safeExecFile (no shell)', llavaSrc.includes('safeExecFile'));
  assert('llama binary search paths', llavaSrc.includes('LLAMA_SEARCH_PATHS'));
  assert('checks NEX_LLAMA_BIN env', llavaSrc.includes('NEX_LLAMA_BIN'));
  assert('analyzeImage method', llavaSrc.includes('analyzeImage'));
  assert('analyzeScreenshot method', llavaSrc.includes('analyzeScreenshot'));
  assert('supports --mmproj flag', llavaSrc.includes('--mmproj'));
  assert('supports --image flag', llavaSrc.includes('--image'));
  assert('supports prompt via -p', llavaSrc.includes("'-p'"));
  assert('temperature control', llavaSrc.includes('--temp'));
  assert('max tokens control', llavaSrc.includes("'-n'"));
  assert('init checks binary exists', llavaSrc.includes('binary not found'));
  assert('init checks model exists', llavaSrc.includes('model not found'));
  assert('resolveImagePath handles imagePath', llavaSrc.includes('input.imagePath'));
  assert('resolveImagePath handles imageBase64', llavaSrc.includes('input.imageBase64'));
  assert('resolveImagePath handles file:// URLs', llavaSrc.includes("file://"));
  assert('NO remote URL download (offline)', !llavaSrc.includes('http.get') && !llavaSrc.includes('fetch('));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) IPC handlers registered in main.ts
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');
  assert('vision-status handler', mainSrc.includes("'vision-status'"));
  assert('vision-load-model handler', mainSrc.includes("'vision-load-model'"));
  assert('vision-analyze-image handler', mainSrc.includes("'vision-analyze-image'"));
  assert('vision-analyze-screen handler', mainSrc.includes("'vision-analyze-screen'"));
  assert('vision-unload-model handler', mainSrc.includes("'vision-unload-model'"));
  assert('vision-find-binary handler', mainSrc.includes("'vision-find-binary'"));
  assert('Phase 42 log message', mainSrc.includes('Phase 42'));
  assert('uses desktopCapturer for screenshots', mainSrc.includes('desktopCapturer'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Preload bridges
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Preload bridges:');
  const preSrc = read('../../src/main/preload.ts');
  assert('visionStatus bridge', preSrc.includes('visionStatus'));
  assert('visionLoadModel bridge', preSrc.includes('visionLoadModel'));
  assert('visionAnalyzeImage bridge', preSrc.includes('visionAnalyzeImage'));
  assert('visionAnalyzeScreen bridge', preSrc.includes('visionAnalyzeScreen'));
  assert('visionUnloadModel bridge', preSrc.includes('visionUnloadModel'));
  assert('visionFindBinary bridge', preSrc.includes('visionFindBinary'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Type definitions in electron.d.ts
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Type definitions:');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('visionStatus type', typesSrc.includes('visionStatus'));
  assert('visionLoadModel type', typesSrc.includes('visionLoadModel'));
  assert('visionAnalyzeImage type', typesSrc.includes('visionAnalyzeImage'));
  assert('visionAnalyzeScreen type', typesSrc.includes('visionAnalyzeScreen'));
  assert('visionUnloadModel type', typesSrc.includes('visionUnloadModel'));
  assert('visionFindBinary type', typesSrc.includes('visionFindBinary'));
  assert('vision types has hasProvider', typesSrc.includes('hasProvider'));
  assert('vision types has hasLocalProvider', typesSrc.includes('hasLocalProvider'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) No cloud API calls in vision modules
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) No cloud API calls:');
  const allVisionSrc = engineSrc + llavaSrc;
  assert('NO fetch() calls in vision modules', !allVisionSrc.includes('fetch('));
  assert('NO XMLHttpRequest in vision modules', !allVisionSrc.includes('XMLHttpRequest'));
  assert('NO https.request in vision modules', !allVisionSrc.includes('https.request'));
  assert('NO cloud endpoints', !allVisionSrc.includes('api.openai.com') && !allVisionSrc.includes('api.anthropic.com') && !allVisionSrc.includes('googleapis.com'));
  assert('NO OpenAI Vision API', !allVisionSrc.includes('openai') && !allVisionSrc.includes('gpt-4-vision'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Model Manager integration (vision category)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Model Manager integration:');
  const mrSrc = read('../../src/main/ai/model-registry.ts');
  assert('model-registry has vision category', mrSrc.includes("| 'vision'"));
  assert('model-registry has vision capability', mrSrc.includes("'vision'"));
  assert('vision category gets chat+vision capabilities', /case 'vision'[\s\S]{0,60}return \['chat', 'vision'\]/.test(mrSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Persistence (visionModelPath in settings)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Persistence:');
  assert('main.ts persists visionModelPath', mainSrc.includes('visionModelPath'));
  assert('main.ts persists visionMmprojPath', mainSrc.includes('visionMmprojPath'));
  assert('main.ts loads persistence for vision', /loadState[\s\S]{0,200}visionModel/.test(mainSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Existing vision-types.ts interfaces
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Existing vision-types.ts interfaces:');
  const vtSrc = read('../../src/main/ai/vision-types.ts');
  assert('VisionInput interface exists', vtSrc.includes('export interface VisionInput'));
  assert('VisionResult interface exists', vtSrc.includes('export interface VisionResult'));
  assert('VisionModelInfo interface exists', vtSrc.includes('export interface VisionModelInfo'));
  assert('VisionCapability type exists', vtSrc.includes('export type VisionCapability'));
  assert('VisionCapability has image-understanding', vtSrc.includes("'image-understanding'"));
  assert('VisionCapability has ocr', vtSrc.includes("'ocr'"));
  assert('VisionCapability has screenshot-analysis', vtSrc.includes("'screenshot-analysis'"));
  assert('VisionInput has imagePath', vtSrc.includes('imagePath'));
  assert('VisionInput has imageBase64', vtSrc.includes('imageBase64'));
  assert('VisionInput has prompt', vtSrc.includes('prompt'));
  assert('VisionInput has question', vtSrc.includes('question'));

  // ═══════════════════════════════════════════════════════════════════════
  // 10) FUNCTIONAL TESTS — VisionEngine
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) VisionEngine functional tests:');

  const { VisionEngine } = await import('../../src/main/vision/vision-engine');
  const engine = new VisionEngine();

  let stateChanges: string[] = [];
  let progressMsgs: string[] = [];

  engine.setCallbacks({
    onStateChange: (s) => stateChanges.push(s),
    onProgress: (m) => progressMsgs.push(m),
    onError: () => {},
  });

  assert('engine starts in idle state', engine.currentState === 'idle');
  assert('engine has no provider initially', engine.hasProvider === false);
  assert('engine hasLocalProvider = false initially', engine.hasLocalProvider === false);

  // analyzeImage without provider → returns error
  const result = await engine.analyzeImage({ imagePath: '/tmp/nonexistent.png' });
  assert('analyzeImage without provider returns error', result.success === false);
  assert('error message mentions "No vision provider"', result.error?.includes('No vision provider'));

  // analyzeScreenshot without provider → returns error
  const screenResult = await engine.analyzeScreenshot('test');
  assert('analyzeScreenshot without provider returns error', screenResult.success === false);

  // ═══════════════════════════════════════════════════════════════════════
  // 11) Binary detection (findLlamaBinary)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n11) Binary detection:');
  const { findLlamaBinary } = await import('../../src/main/vision/local-llava-provider');
  const llamaBin = findLlamaBinary();
  assert('findLlamaBinary returns string or null', llamaBin === null || typeof llamaBin === 'string');

  // ═══════════════════════════════════════════════════════════════════════
  // 12) Offline verification — no external calls
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n12) Offline verification:');
  assert('NO fetch() calls in vision modules', !allVisionSrc.includes('fetch('));
  assert('NO XMLHttpRequest in vision modules', !allVisionSrc.includes('XMLHttpRequest'));
  assert('NO https.request in vision modules', !allVisionSrc.includes('https.request'));
  assert('NO cloud endpoints in vision modules', !allVisionSrc.includes('api.openai.com') && !allVisionSrc.includes('api.anthropic.com') && !allVisionSrc.includes('googleapis.com'));
  assert('NO remote URL download (only file://)', llavaSrc.includes('file://') && !llavaSrc.includes('http.get'));

  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 42 LOCAL VISION RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('PHASE 42 LOCAL VISION INTELLIGENCE: ALL PASS ✅');
  console.log('\nNOTE: Windows runtime QA is NOT VERIFIED by this test.');
  console.log('      The user MUST verify on Windows:');
  console.log('      1. Install llama.cpp binary → vision-status returns hasProvider=true');
  console.log('      2. Add LLaVA model → vision-load-model works');
  console.log('      3. vision-analyze-image on a sample image → returns text description');
  console.log('      4. vision-analyze-screen → captures + analyzes screenshot');
  console.log('      5. Disconnect internet → vision still works (offline)');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
