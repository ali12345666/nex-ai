/**
 * Phase 58 — Local AI Runtime & Model Activation Tests
 *
 * Verifies:
 *   1. LocalModelProvider module structure + security
 *   2. MultiModelRuntimeManager module structure + security
 *   3. Runtime initialization (provider, manager)
 *   4. GGUF detection
 *   5. Model loading / unloading (SAFE — no permission needed)
 *   6. Multi-model routing (Brain integration)
 *   7. Brain integration (routeTask → BrainDecision → load)
 *   8. Hardware detection (CPU/RAM/GPU/VRAM)
 *   9. Offline security (no cloud, no download, no external service)
 *  10. Identity update (local AI runtime self-awareness)
 *  11. IPC handlers + preload bridges + type declarations
 *  12. UI panel + navigation
 *  13. Phase 51-57 preserved (regression)
 *
 * Run: npx tsx tests/system/test-phase58-local-runtime.ts
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) LocalModelProvider Module Structure + Security
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) LocalModelProvider Module Structure:');
  const providerSrc = read('../../src/main/ai/local-model-provider.ts');

  assert('local-model-provider.ts exists', providerSrc.length > 0);
  assert('ProviderBackend type', providerSrc.includes('export type ProviderBackend'));
  assert('supports llamacpp backend', providerSrc.includes("'llamacpp'"));
  assert('supports onnx backend (future)', providerSrc.includes("'onnx'"));
  assert('supports tensorrt backend (future)', providerSrc.includes("'tensorrt'"));
  assert('ProviderGenerateOptions interface', providerSrc.includes('interface ProviderGenerateOptions'));
  assert('has contextSize option', providerSrc.includes('contextSize'));
  assert('has threads option', providerSrc.includes('threads'));
  assert('has gpuLayers option', providerSrc.includes('gpuLayers'));
  assert('has temperature option', providerSrc.includes('temperature'));
  assert('has maxTokens option', providerSrc.includes('maxTokens'));
  assert('has topP option', providerSrc.includes('topP'));
  assert('has systemPrompt option', providerSrc.includes('systemPrompt'));
  assert('ProviderGenerateResult interface', providerSrc.includes('interface ProviderGenerateResult'));
  assert('result has tokensPerSecond', providerSrc.includes('tokensPerSecond'));
  assert('ProviderStreamChunk interface', providerSrc.includes('interface ProviderStreamChunk'));
  assert('ProviderInfo interface', providerSrc.includes('interface ProviderInfo'));
  assert('ProviderHealthCheck interface', providerSrc.includes('interface ProviderHealthCheck'));
  assert('LocalModelProvider class', providerSrc.includes('export class LocalModelProvider'));
  assert('load method', providerSrc.includes('async load('));
  assert('unload method', providerSrc.includes('async unload('));
  assert('generate method', providerSrc.includes('async generate('));
  assert('stream method', providerSrc.includes('async stream('));
  assert('abort method', providerSrc.includes('abort()'));
  assert('getInfo method', providerSrc.includes('getInfo()'));
  assert('healthCheck method', providerSrc.includes('healthCheck()'));
  assert('createLocalModelProvider factory', providerSrc.includes('export function createLocalModelProvider'));
  assert('verifyProviderSecurity function', providerSrc.includes('export function verifyProviderSecurity'));

  // Imports — delegates to existing inference engine (no duplication)
  assert('imports inference loadModel', providerSrc.includes('loadModel as inferenceLoadModel'));
  assert('imports inference unloadModel', providerSrc.includes('unloadModel as inferenceUnloadModel'));
  assert('imports inference chatComplete', providerSrc.includes('chatComplete as inferenceChatComplete'));
  assert('imports inference chatStream', providerSrc.includes('chatStream as inferenceChatStream'));
  assert('imports abortInference', providerSrc.includes('abortInference'));
  assert('imports getGpuBackend', providerSrc.includes('getGpuBackend'));
  assert('imports hardware recommender', providerSrc.includes('canModelRunOnHardware'));
  assert('imports detectHardwareProfile', providerSrc.includes('detectHardwareProfile'));
  assert('imports telemetry', providerSrc.includes('getLastInference'));
  assert('imports model-registry getModel', providerSrc.includes("getModel"));

  // Security
  assert('SECURITY comment', providerSrc.includes('SECURITY'));
  assert('no cloud API comment', providerSrc.includes('No cloud API') || providerSrc.includes('no cloud'));
  assert('no automatic download comment', providerSrc.includes('No automatic model download') || providerSrc.includes('automatic download'));
  assert('no fetch() call', !providerSrc.includes('fetch('));
  assert('no net.request call (code)', !providerSrc.split('\n').some((l: string) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && l.includes('net.request')));
  assert('no https import', !providerSrc.includes("from 'https'"));
  assert('no SecureDownloader import', !providerSrc.split('\n').some((l: string) => l.trim().startsWith('import') && l.includes('SecureDownloader')));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) MultiModelRuntimeManager Module Structure + Security
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) MultiModelRuntimeManager Module Structure:');
  const managerSrc = read('../../src/main/ai/multi-model-runtime-manager.ts');

  assert('multi-model-runtime-manager.ts exists', managerSrc.length > 0);
  assert('InstalledModelSummary interface', managerSrc.includes('interface InstalledModelSummary'));
  assert('RuntimeStatus interface', managerSrc.includes('interface RuntimeStatus'));
  assert('TaskRouteResult interface', managerSrc.includes('interface TaskRouteResult'));
  assert('MultiModelRuntimeManager class', managerSrc.includes('export class MultiModelRuntimeManager'));
  assert('listInstalledModels method', managerSrc.includes('listInstalledModels()'));
  assert('loadModel method', managerSrc.includes('async loadModel('));
  assert('unloadModel method', managerSrc.includes('async unloadModel()'));
  assert('generate method', managerSrc.includes('async generate('));
  assert('stream method', managerSrc.includes('async stream('));
  assert('abort method', managerSrc.includes('abort()'));
  assert('routeTask method', managerSrc.includes('async routeTask('));
  assert('routeAndGenerate method', managerSrc.includes('async routeAndGenerate('));
  assert('detectHardware method', managerSrc.includes('detectHardware()'));
  assert('recommendBest method', managerSrc.includes('recommendBest('));
  assert('canRun method', managerSrc.includes('canRun('));
  assert('getProviderInfo method', managerSrc.includes('getProviderInfo()'));
  assert('healthCheck method', managerSrc.includes('healthCheck()'));
  assert('getStatus method', managerSrc.includes('getStatus()'));
  assert('isGgufFile method', managerSrc.includes('isGgufFile('));
  assert('getInstalledGgufModels method', managerSrc.includes('getInstalledGgufModels()'));
  assert('getModelsByCategory method', managerSrc.includes('getModelsByCategory()'));
  assert('countModelsByCategory method', managerSrc.includes('countModelsByCategory()'));
  assert('verifyRuntimeSecurity function', managerSrc.includes('export function verifyRuntimeSecurity'));
  assert('getMultiModelRuntimeManager singleton', managerSrc.includes('export function getMultiModelRuntimeManager'));
  assert('_resetMultiModelRuntimeManager for tests', managerSrc.includes('export function _resetMultiModelRuntimeManager'));

  // Imports — connects to all subsystems
  assert('imports LocalModelProvider', managerSrc.includes("from './local-model-provider'"));
  assert('imports model-registry', managerSrc.includes("from './model-registry"));
  assert('imports BrainController', managerSrc.includes("from './nex-brain-controller'"));
  assert('imports hardware recommender', managerSrc.includes("from './hardware-model-recommender'"));
  assert('imports telemetry', managerSrc.includes("from './runtime-telemetry'"));

  // Security
  assert('SECURITY comment', managerSrc.includes('SECURITY'));
  assert('no cloud API comment', managerSrc.includes('No cloud API') || managerSrc.includes('no cloud'));
  assert('no automatic download comment', managerSrc.includes('No automatic model download') || managerSrc.includes('automatic download'));
  assert('never downloads comment', managerSrc.includes('downloads a model') || managerSrc.includes('NEVER'));
  assert('no fetch() call', !managerSrc.includes('fetch('));
  assert('no net.request call (code)', !managerSrc.split('\n').some((l: string) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && l.includes('net.request')));
  assert('no SecureDownloader import', !managerSrc.split('\n').some((l: string) => l.trim().startsWith('import') && l.includes('SecureDownloader')));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) Runtime Initialization
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Runtime Initialization:');
  const { LocalModelProvider, createLocalModelProvider, verifyProviderSecurity } = await import('../../src/main/ai/local-model-provider');
  const { MultiModelRuntimeManager, getMultiModelRuntimeManager, _resetMultiModelRuntimeManager, verifyRuntimeSecurity } = await import('../../src/main/ai/multi-model-runtime-manager');

  _resetMultiModelRuntimeManager();

  // Provider
  const provider = new LocalModelProvider('llamacpp');
  assert('provider constructs with llamacpp backend', provider.backend === 'llamacpp');
  assert('provider loadedModelId null initially', provider.loadedModelId === null);

  const provider2 = createLocalModelProvider('onnx');
  assert('createLocalModelProvider creates onnx backend', provider2.backend === 'onnx');

  // Manager
  const manager = new MultiModelRuntimeManager(provider);
  assert('manager constructs', manager !== null);
  assert('manager.getProvider returns provider', manager.getProvider() === provider);

  // Provider security audit
  const provSec = verifyProviderSecurity();
  assert('provider security audit passes', provSec.ok === true);

  // Manager security audit
  const mgrSec = verifyRuntimeSecurity();
  assert('manager security audit passes', mgrSec.ok === true);

  // ═══════════════════════════════════════════════════════════════════════
  // 4) GGUF Detection
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) GGUF Detection:');
  assert('isGgufFile detects .gguf', manager.isGgufFile('/path/to/model.gguf') === true);
  assert('isGgufFile detects .GGUF (case insensitive)', manager.isGgufFile('/path/to/MODEL.GGUF') === true);
  assert('isGgufFile rejects .bin', manager.isGgufFile('/path/to/model.bin') === false);
  assert('isGgufFile rejects .onnx', manager.isGgufFile('/path/to/model.onnx') === false);
  assert('isGgufFile rejects no extension', manager.isGgufFile('/path/to/model') === false);

  // getInstalledGgufModels (returns array — may be empty in test env)
  const ggufModels = manager.getInstalledGgufModels();
  assert('getInstalledGgufModels returns array', Array.isArray(ggufModels));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Model Loading / Unloading (SAFE — no permission needed)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Model Loading / Unloading:');
  // Loading a nonexistent model throws (not found in registry)
  try {
    await manager.loadModel('nonexistent-model-id');
    assert('load nonexistent model throws', false);
  } catch (err: any) {
    assert('load nonexistent model throws', err.message.includes('not found') || err.message.includes('Model'));
  }

  // isModelLoaded false for nonexistent
  assert('isModelLoaded false for unknown model', manager.isModelLoaded('nonexistent') === false);
  assert('getLoadedModelId null initially', manager.getLoadedModelId() === null);

  // Unload (no model loaded — should not throw)
  try {
    await manager.unloadModel();
    assert('unload with no model loaded does not throw', true);
  } catch {
    assert('unload with no model loaded does not throw', false);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Multi-Model Routing
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Multi-Model Routing:');
  // listInstalledModels returns array with runtime metadata
  const installed = manager.listInstalledModels();
  assert('listInstalledModels returns array', Array.isArray(installed));
  for (const m of installed) {
    assert(`model ${m.id} has loaded boolean`, typeof m.loaded === 'boolean');
    assert(`model ${m.id} has canRun boolean`, typeof m.canRun === 'boolean');
    assert(`model ${m.id} has hardwareVerdict`, m.hardwareVerdict !== undefined);
    assert(`model ${m.id} has category`, typeof m.category === 'string');
  }

  // getModelsByCategory returns a grouped object
  const grouped = manager.getModelsByCategory();
  assert('getModelsByCategory returns object', typeof grouped === 'object');
  assert('getModelsByCategory values are arrays', Object.values(grouped).every((v) => Array.isArray(v)));

  // countModelsByCategory
  const counts = manager.countModelsByCategory();
  assert('countModelsByCategory returns object', typeof counts === 'object');
  const totalFromCounts = Object.values(counts).reduce((s: number, n) => s + (n as number), 0);
  assert('countModelsByCategory total matches installed', totalFromCounts === installed.length);

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Brain Integration (routeTask → BrainDecision → load)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Brain Integration:');
  _resetMultiModelRuntimeManager();
  const mgr2 = getMultiModelRuntimeManager();

  // routeTask delegates to BrainController.decide()
  const route = await mgr2.routeTask({ request: 'یک تابع پایتون بنویس', intent: 'coding' });
  assert('routeTask returns TaskRouteResult', route !== null && route !== undefined);
  assert('routeTask has brainDecision', route.brainDecision !== null);
  assert('routeTask has selectedModel field', 'selectedModel' in route);
  assert('routeTask has loaded boolean', typeof route.loaded === 'boolean');
  assert('routeTask has reason', typeof route.reason === 'string');
  assert('routeTask has reasonFa', typeof route.reasonFa === 'string');

  // If no model installed, route returns selectedModel: null
  if (!route.selectedModel) {
    assert('no model → reason explains gap', route.reason.includes('No suitable') || route.reasonFa.includes('نصب'));
  } else {
    assert('model selected → brainDecision has modelId', !!route.brainDecision.modelId);
  }

  // Manager source wires brain.decide()
  assert('manager source calls brain.decide', managerSrc.includes('brain.decide(request)'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Hardware Detection
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Hardware Detection:');
  const hw = manager.detectHardware();
  assert('detectHardware returns HardwareProfile', hw !== null);
  assert('hardware has cpuCores', typeof hw.cpuCores === 'number' && hw.cpuCores > 0);
  assert('hardware has cpuThreads', typeof hw.cpuThreads === 'number' && hw.cpuThreads > 0);
  assert('hardware has ramTotalBytes', typeof hw.ramTotalBytes === 'number' && hw.ramTotalBytes > 0);
  assert('hardware has ramFreeBytes', typeof hw.ramFreeBytes === 'number');
  assert('hardware has detectedBackend', typeof hw.detectedBackend === 'string');
  assert('hardware has platform', typeof hw.platform === 'string');

  // Status includes hardware
  const status = manager.getStatus();
  assert('getStatus returns RuntimeStatus', status !== null);
  assert('status has backend', typeof status.backend === 'string');
  assert('status has gpuBackend', typeof status.gpuBackend === 'string');
  assert('status has installedModels', typeof status.installedModels === 'number');
  assert('status has modelsByCategory', typeof status.modelsByCategory === 'object');
  assert('status has healthy boolean', typeof status.healthy === 'boolean');
  assert('status has hardware field', 'hardware' in status);

  // Provider info
  const info = manager.getProviderInfo();
  assert('getProviderInfo returns ProviderInfo', info !== null);
  assert('info has backend', typeof info.backend === 'string');
  assert('info has available boolean', typeof info.available === 'boolean');
  assert('info has capabilities array', Array.isArray(info.capabilities));
  assert('info has gpuBackend', typeof info.gpuBackend === 'string');

  // Health check
  const health = manager.healthCheck();
  assert('healthCheck returns ProviderHealthCheck', health !== null);
  assert('health has healthy boolean', typeof health.healthy === 'boolean');
  assert('health has backend', typeof health.backend === 'string');
  assert('health has available boolean', typeof health.available === 'boolean');
  assert('health has modelLoaded boolean', typeof health.modelLoaded === 'boolean');
  assert('health has canInfer boolean', typeof health.canInfer === 'boolean');
  assert('health has issues array', Array.isArray(health.issues));
  assert('health has checkedAt', typeof health.checkedAt === 'number');

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Offline Security (no cloud, no download, no external service)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Offline Security:');
  assert('provider security audit ok', verifyProviderSecurity().ok === true);
  assert('manager security audit ok', verifyRuntimeSecurity().ok === true);

  // No cloud imports anywhere
  assert('provider no fetch()', !providerSrc.includes('fetch('));
  assert('manager no fetch()', !managerSrc.includes('fetch('));
  assert('provider no XMLHttpRequest', !providerSrc.includes('XMLHttpRequest'));
  assert('manager no XMLHttpRequest', !managerSrc.includes('XMLHttpRequest'));

  // No download/install/delete methods on the manager (those go through PermissionGate elsewhere)
  assert('manager no async download() method', !managerSrc.includes('async download('));
  assert('manager no async install() method', !managerSrc.includes('async install('));
  assert('manager no async delete() method', !managerSrc.includes('async delete('));

  // The manager only ACTIVATES models already on disk
  assert('manager verifies model.fileExists', managerSrc.includes('model.fileExists') || providerSrc.includes('model.fileExists'));
  assert('provider throws on missing file', providerSrc.includes('Model file not found'));

  // ═══════════════════════════════════════════════════════════════════════
  // 10) Identity Update (local AI runtime self-awareness)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) Identity Update:');
  const idSrc = read('../../src/main/ai/nex-identity-manager.ts');
  assert('identity has Local AI runtime ability', idSrc.includes('Local AI runtime execution'));
  assert('identity has Multi-model activation ability', idSrc.includes('Multi-model activation'));
  assert('identity has GGUF loading ability', idSrc.includes('GGUF model loading'));
  assert('identity has hardware optimization ability', idSrc.includes('Hardware-aware model optimization'));
  assert('identity has Persian local AI ability', idSrc.includes('اجرای زمان‌اجراهای محلی'));
  assert('identity has Persian multi-model ability', idSrc.includes('فعال‌سازی چندمدلی'));
  assert('identity has Persian GGUF ability', idSrc.includes('بارگذاری مدل GGUF'));
  assert('identity has cannot-use-unavailable limitation', idSrc.includes('Cannot use models that are not installed'));
  assert('identity has Persian cannot-use limitation', idSrc.includes('نصب‌نشده یا غیرقابل‌اجرا'));
  assert('identity has offline rule', idSrc.includes('I can run local AI models offline'));
  assert('identity has best-model rule', idSrc.includes('I choose the best installed model'));
  assert('identity has Persian offline rule', idSrc.includes('مدل‌های هوش مصنوعی محلی را آفلاین اجرا کنم'));
  assert('identity has Persian best-model rule', idSrc.includes('بهترین مدل نصب‌شده را برای هر وظیفه'));

  // Runtime identity check
  const { getNexIdentityManager } = await import('../../src/main/ai/nex-identity-manager');
  const identity = getNexIdentityManager().getIdentity();
  assert('identity has Phase 58 ability', identity.abilities.some((a: string) => a.includes('Local AI runtime')));
  assert('identity has GGUF ability', identity.abilities.some((a: string) => a.includes('GGUF')));
  assert('identity has offline rule', identity.rules.some((r: string) => r.includes('run local AI models offline')));
  assert('identity has best-model rule', identity.rules.some((r: string) => r.includes('best installed model')));

  // ═══════════════════════════════════════════════════════════════════════
  // 11) IPC + Preload + Types
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n11) IPC + Preload + Types:');
  const mainSrc = read('../../src/main/main.ts');
  assert('main has Phase 58 block', mainSrc.includes('Phase 58: Local AI Runtime'));
  assert('main imports MultiModelRuntimeManager', mainSrc.includes("import('./ai/multi-model-runtime-manager')"));

  const ipcChannels = [
    'local-runtime-list-models', 'local-runtime-status', 'local-runtime-load-model',
    'local-runtime-unload-model', 'local-runtime-abort', 'local-runtime-route-task',
    'local-runtime-generate', 'local-runtime-provider-info', 'local-runtime-health-check',
    'local-runtime-hardware', 'local-runtime-models-by-category', 'local-runtime-is-gguf',
    'local-runtime-security-audit',
  ];
  for (const ch of ipcChannels) {
    assert(`main registers ipc handler '${ch}'`, mainSrc.includes(`ipcMain.handle('${ch}'`));
  }

  // Preload
  const preloadSrc = read('../../src/main/preload.ts');
  assert('preload has Phase 58 section', preloadSrc.includes('Phase 58: Local AI Runtime'));
  const preloadMethods = [
    'localRuntimeListModels', 'localRuntimeStatus', 'localRuntimeLoadModel',
    'localRuntimeUnloadModel', 'localRuntimeAbort', 'localRuntimeRouteTask',
    'localRuntimeGenerate', 'localRuntimeProviderInfo', 'localRuntimeHealthCheck',
    'localRuntimeHardware', 'localRuntimeModelsByCategory', 'localRuntimeIsGguf',
    'localRuntimeSecurityAudit',
  ];
  for (const m of preloadMethods) {
    assert(`preload exposes '${m}'`, preloadSrc.includes(`${m}:`));
  }

  // Types
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('types has Phase 58 section', typesSrc.includes('Phase 58: Local AI Runtime'));
  for (const m of preloadMethods) {
    assert(`types declares '${m}'`, typesSrc.includes(`${m}:`));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 12) UI Panel + Navigation
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n12) UI Panel + Navigation:');
  const panelSrc = read('../../src/renderer/components/LocalRuntimePanel.tsx');
  assert('LocalRuntimePanel exists', panelSrc.length > 0);
  assert('panel default export', panelSrc.includes('export default function LocalRuntimePanel'));
  assert('panel shows installed models', panelSrc.includes('models'));
  assert('panel shows loaded model', panelSrc.includes('loadedModel'));
  assert('panel shows tokens/sec', panelSrc.includes('tokensPerSec'));
  assert('panel shows runtime status', panelSrc.includes('status'));
  assert('panel has load button', panelSrc.includes('loadModel'));
  assert('panel has unload button', panelSrc.includes('unloadModel'));
  assert('panel has abort button', panelSrc.includes('abortInference'));
  assert('panel calls localRuntimeListModels', panelSrc.includes('localRuntimeListModels'));
  assert('panel calls localRuntimeStatus', panelSrc.includes('localRuntimeStatus'));
  assert('panel calls localRuntimeLoadModel', panelSrc.includes('localRuntimeLoadModel'));
  assert('panel calls localRuntimeUnloadModel', panelSrc.includes('localRuntimeUnloadModel'));
  assert('panel calls localRuntimeAbort', panelSrc.includes('localRuntimeAbort'));
  assert('panel shows hardware', panelSrc.includes('hardware'));
  assert('panel shows categories', panelSrc.includes('modelsByCategory'));
  assert('panel has security note', panelSrc.includes('محلی') || panelSrc.includes('offline'));
  assert('panel has health badge', panelSrc.includes('healthy'));
  assert('panel polls for telemetry', panelSrc.includes('setInterval'));

  const navSrc = read('../../src/renderer/components/layout/NavigationRail.tsx');
  assert('nav has localai view', navSrc.includes("'localai'"));
  assert('nav has Cpu icon', navSrc.includes('Cpu'));
  assert('nav has Local AI label', navSrc.includes("label: 'Local AI'"));

  const appShellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
  assert('AppShell imports LocalRuntimePanel', appShellSrc.includes('LocalRuntimePanel'));
  assert('AppShell routes localai view', appShellSrc.includes("case 'localai'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 13) Phase 51-57 Preserved (Regression)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n13) Phase 51-57 Preserved:');
  assert('Phase 39 model-registry exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-registry.ts')));
  assert('Phase 39 hardware-model-recommender exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/hardware-model-recommender.ts')));
  assert('Phase 12 inference.ts exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/inference.ts')));
  assert('Phase 12 runtime.ts exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/runtime.ts')));
  assert('Phase 12 llamacpp-runtime.ts exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/runtimes/llamacpp-runtime.ts')));
  assert('Phase 43 permission-gate exists', fs.existsSync(path.join(__dirname, '../../src/main/update/permission-gate.ts')));
  assert('Phase 49 advanced-model-catalog exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-intelligence/advanced-model-catalog.ts')));
  assert('Phase 45 smart-model-router exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-intelligence/smart-model-router.ts')));
  assert('Phase 46 runtime-setup-manager exists', fs.existsSync(path.join(__dirname, '../../src/main/runtime/runtime-setup-manager.ts')));
  assert('Phase 51 nex-brain-controller exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-brain-controller.ts')));
  assert('Phase 52 nex-personality-engine exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-personality-engine.ts')));
  assert('Phase 52 long-term-memory-system exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/long-term-memory-system.ts')));
  assert('Phase 53 nex-expert-system exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-expert-system.ts')));
  assert('Phase 54 nex-agent-executor exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-agent-executor.ts')));
  assert('Phase 54 agent-skill-registry exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/agent-skill-registry.ts')));
  assert('Phase 55 expert-knowledge-engine exists', fs.existsSync(path.join(__dirname, '../../src/main/knowledge/expert-knowledge-engine.ts')));
  assert('Phase 56 nex-voice-conversation exists', fs.existsSync(path.join(__dirname, '../../src/main/voice/nex-voice-conversation.ts')));
  assert('Phase 56 wake-word-detector exists', fs.existsSync(path.join(__dirname, '../../src/main/voice/wake-word-detector.ts')));
  assert('Phase 57 nex-executive-planner exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-executive-planner.ts')));
  assert('Phase 57 PlannerPanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/PlannerPanel.tsx')));

  // Existing subsystems still work
  const { listModels } = await import('../../src/main/ai/model-registry');
  assert('model-registry listModels still works', typeof listModels === 'function');
  const { getNexBrainController } = await import('../../src/main/ai/nex-brain-controller');
  assert('brain controller still decides', typeof getNexBrainController().decide === 'function');
  const { detectHardwareProfile: detectHw } = await import('../../src/main/ai/hardware-model-recommender');
  const hwCheck = detectHw();
  assert('hardware recommender still detects', hwCheck.cpuCores > 0);
  const { getAdvancedCatalog } = await import('../../src/main/ai/model-intelligence/advanced-model-catalog');
  assert('advanced catalog still returns entries', getAdvancedCatalog().length > 0);
  const { getExpertProfiles } = await import('../../src/main/ai/nex-expert-system');
  assert('expert profiles still 6', getExpertProfiles().length === 6);
  const { getNexExecutivePlanner } = await import('../../src/main/ai/nex-executive-planner');
  assert('executive planner singleton still works', typeof getNexExecutivePlanner === 'function');

  // ═══════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 58 LOCAL RUNTIME RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('FAILURES:', failures.join(' | '));
    process.exit(1);
  }
  console.log('PHASE 58 LOCAL AI RUNTIME & MODEL ACTIVATION: ALL PASS ✅');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
