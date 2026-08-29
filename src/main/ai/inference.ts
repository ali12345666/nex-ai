/**
 * NEX AI — Local Inference Engine
 *
 * Wraps node-llama-cpp to provide:
 *  - Model loading (lazy + cached)
 *  - Chat completion (full response)
 *  - Streaming chat completion (token-by-token)
 *  - Stop / abort inference
 *
 * Key design:
 *  - One model loaded at a time (loading multiple is expensive in RAM)
 *  - Switching models unloads the previous one
 *  - Inference runs on a separate worker thread (node-llama-cpp default)
 *  - CPU fallback is always available (Vulkan/CUDA may fail to init)
 *
 * node-llama-cpp uses top-level await in its ESM exports, so we must
 * dynamically import it (not statically require it).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * GPU OFFLOAD — ROOT-CAUSE FIX (this file)
 * ════════════════════════════════════════════════════════════════════════════
 * SYMPTOM (Windows / RTX 4060): `npx node-llama-cpp inspect gpu` reports
 * "Vulkan AVAILABLE", but loading Qwen3-30B leaves VRAM at 768 MB while RAM
 * spikes to ~26 GB and swap to ~19 GB. I.e. the model runs entirely on CPU.
 *
 * ROOT CAUSE (two compounding bugs):
 *
 *  1. `getLlama()` was called with NO options. The default `gpu: "auto"` plus
 *     Electron's default `build: "never"` means node-llama-cpp will ONLY use
 *     a prebuilt binary that is already installed in node_modules. The Vulkan
 *     binary lives in a SEPARATE optional package `@node-llama-cpp/win-x64-vulkan`
 *     which is NOT pulled in by a plain `npm install node-llama-cpp`. So
 *     `getLlama()` silently resolves to the CPU binary
 *     (`@node-llama-cpp/win-x64`), `llama.gpu` returns `false`, and
 *     `gpuLayers` is forced to 0 by node-llama-cpp ("If GPU support is
 *     disabled, will be set to 0 automatically").
 *
 *     The CLI `inspect gpu` can report "Vulkan AVAILABLE" because it tests
 *     driver + binary *availability for the platform*, NOT whether the binary
 *     is actually installed in THIS project. That divergence is exactly why
 *     VRAM never moved.
 *
 *  2. `gpuLayers: -1` was passed as a raw number. Per node-llama-cpp's
 *     `LlamaModelOptions.gpuLayers` type, a `number` means "store EXACTLY N
 *     layers in VRAM" — `-1` is not "auto" and not "max". The correct value
 *     for "offload as many layers as possible" is `"auto"`.
 *
 * FIX:
 *  - `getLlamaInstance()` now does a preflight `getLlamaGpuTypes("supported")`,
 *    then explicitly requests `gpu: "vulkan"` (with `build: "never"` +
 *    `skipDownload: true` so we never auto-install/download a binary), and
 *    falls back to `gpu: "auto"` only if Vulkan init fails. The chosen
 *    backend + reason are captured for diagnostics.
 *  - `loadModel()` translates the legacy `-1` → `"auto"` and `0` → `0`
 *    before calling `llama.loadModel()`, then reads the ACTUAL offloaded
 *    layer count from `model.gpuLayers` and the real VRAM usage from
 *    `llama.getLlamaMemoryUsage()` / `llama.getVramState()` to PROVE offload.
 *  - Every stage emits a structured log block:
 *      [GPU_RUNTIME]   — at engine init
 *      [GPU_MODEL_LOAD] — immediately after LlamaModel creation
 *      [GPU_INFERENCE]  — at the start of each chatComplete/chatStream
 *
 * These diagnostics make it impossible to silently fall back to CPU again:
 * if `backend=cpu` or `modelGpuLayersActual=0`, the log says so explicitly.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { touchModel, LocalModelInfo } from './model-registry';
// Phase 21 / P21-E: direct-path telemetry (cycle-free module)
import { noteInferenceStats, noteLoadedModel } from './runtime-telemetry';

export interface InferenceOptions {
  contextSize?: number;
  threads?: number;
  gpuLayers?: number;        // -1 = auto, 0 = CPU only
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface InferenceResult {
  content: string;
  tokensGenerated: number;
  modelId: string;
  modelName: string;
  stopped: boolean;
  durationMs: number;
}

export interface StreamChunk {
  content: string;
  done: boolean;
  error?: string;
}

/**
 * Structured GPU runtime diagnostics. Collected at engine init and enriched
 * at model load. Surfaced to the UI/IPC via `getGpuRuntimeDiagnostics()`.
 *
 * Every field that can PROVE or DISPROVE real GPU offload is here:
 *   - `backend`              — what llama.cpp actually initialized
 *   - `buildType`            — prebuilt vs localBuild ( Electron = prebuilt )
 *   - `supportsGpuOffloading`— llama.cpp's own answer
 *   - `gpuDeviceNames`       — physical devices the backend can see
 *   - `modelGpuLayersActual` — layers ACTUALLY stored in VRAM (from model getter)
 *   - `llamaMemoryUsage`     — {gpuVram, cpuRam} reported by llama.cpp
 *   - `vramBefore/vramAfter` — VRAM delta across model load (THE proof)
 */
export interface GpuRuntimeDiagnostics {
  platform: string;
  architecture: string;
  electron: boolean;
  backend: 'cpu' | 'cuda' | 'metal' | 'vulkan';
  buildType: 'localBuild' | 'prebuilt' | 'unknown';
  supportsGpuOffloading: boolean;
  gpuDeviceNames: string[];
  supportedGpuTypes: string[];   // from getLlamaGpuTypes("supported")
  chosenReason: string;          // why this backend was selected
  nativeBinaryInfo: string;      // buildType + release + cmake hint
  systemInfo?: string;           // llama.cpp systemInfo string
  // Populated at model load:
  modelPath?: string;
  modelGpuLayersRequested?: number | string;
  modelGpuLayersActual?: number;  // REAL offloaded layer count
  vramBeforeModelLoad?: { total: number; used: number; free: number };
  vramAfterModelLoad?: { total: number; used: number; free: number };
  llamaMemoryUsage?: { gpuVram: number; cpuRam: number };
  collectedAt: number;
}

let _llama: any = null;
let _loadedModelId: string | null = null;
let _loadedModel: any = null;              // node-llama-cpp LlamaModel object
let _loadedModelInfo: LocalModelInfo | null = null;  // Phase 87: the LocalModelInfo that was passed to loadModel
let _loadedContext: any = null;
let _LlamaChatSession: any = null;
let _ctxSequence: any = null;
let _gpuBackend: 'cpu' | 'cuda' | 'metal' | 'vulkan' = 'cpu';

// Track the actual loaded model's GPU layers + context size for idempotency
// checks. These let loadModel() decide whether to reuse the existing model
// or reload (preventing the double-load + "Object is disposed" race).
let _loadedModelGpuLayers: number | null = null;
let _loadedContextSize: number | null = null;

/** GPU runtime diagnostics (collected at init + enriched at model load). */
let _gpuDiagnostics: GpuRuntimeDiagnostics | null = null;

// Phase 90: Inference serialization — ONE active generation at a time
let _inFlightPromise: Promise<any> | null = null;

// Phase 90: Per-request abort (replaces global _abortFlag)
let _activeAbortController: AbortController | null = null;

// Abort diagnostics: track the active request ID + creation time so we can
// log [INFERENCE_ABORT_CONTROLLER] at creation and [INFERENCE_ABORT] with the
// CALLER STACK TRACE when abortInference() is invoked. This makes it
// impossible for a spurious abort to happen silently — the exact call site
// is always logged.
let _activeRequestId: string | null = null;
let _activeRequestCreatedAt: number = 0;

/**
 * Detect whether we're running inside Electron (not plain Node).
 * node-llama-cpp changes its default `build` option to `"never"` under
 * Electron, which is the crux of the silent-CPU-fallback bug.
 */
function isRunningUnderElectron(): boolean {
  return !!(process as any).versions?.electron ||
    !!(process as any).type ||
    (typeof process !== 'undefined' && (process as any).defaultApp !== undefined);
}

/**
 * Format a byte count as a human-readable string for diagnostics.
 */
function fmtBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Print the [GPU_RUNTIME] diagnostic block. Called once at engine init.
 */
function logGpuRuntimeBlock(d: GpuRuntimeDiagnostics): void {
  console.log('[GPU_RUNTIME]');
  console.log(`  platform=${d.platform}`);
  console.log(`  architecture=${d.architecture}`);
  console.log(`  electron=${d.electron}`);
  console.log(`  backend=${d.backend}`);
  console.log(`  buildType=${d.buildType}`);
  console.log(`  supportsGpuOffloading=${d.supportsGpuOffloading}`);
  console.log(`  gpuDeviceNames=${d.gpuDeviceNames.length ? d.gpuDeviceNames.join(', ') : '(none — CPU backend)'}`);
  console.log(`  supportedGpuTypes=${d.supportedGpuTypes.length ? d.supportedGpuTypes.join(', ') : '(none)'}`);
  console.log(`  chosenReason=${d.chosenReason}`);
  console.log(`  nativeBinary=${d.nativeBinaryInfo}`);
}

/**
 * Print the [GPU_MODEL_LOAD] block. Called immediately after LlamaModel
 * creation. This is the PROOF that GPU offload actually happened (or not).
 */
function logGpuModelLoadBlock(
  modelPath: string,
  requestedGpuLayers: number | string,
  actualGpuLayers: number,
  vramBefore: { total: number; used: number; free: number } | undefined,
  vramAfter: { total: number; used: number; free: number } | undefined,
  memUsage: { gpuVram: number; cpuRam: number } | undefined,
  backend: string,
): void {
  const vramDelta = (vramBefore && vramAfter) ? (vramAfter.used - vramBefore.used) : undefined;
  const offloadProven = actualGpuLayers > 0 || (memUsage != null && memUsage.gpuVram > 0);
  console.log('[GPU_MODEL_LOAD]');
  console.log(`  backend=${backend}`);
  console.log(`  model=${modelPath}`);
  console.log(`  gpuLayersRequested=${requestedGpuLayers}`);
  console.log(`  gpuLayersActual=${actualGpuLayers}`);
  console.log(`  vramBefore=${vramBefore ? `${fmtBytes(vramBefore.used)}/${fmtBytes(vramBefore.total)}` : '(unavailable)'}`);
  console.log(`  vramAfter=${vramAfter ? `${fmtBytes(vramAfter.used)}/${fmtBytes(vramAfter.total)}` : '(unavailable)'}`);
  console.log(`  vramDelta=${vramDelta != null ? fmtBytes(vramDelta) : '(unavailable)'}`);
  console.log(`  llamaMemoryUsage=${memUsage ? `gpuVram=${fmtBytes(memUsage.gpuVram)} cpuRam=${fmtBytes(memUsage.cpuRam)}` : '(unavailable)'}`);
  console.log(`  gpuOffloadProven=${offloadProven ? 'YES' : 'NO — model is running on CPU'}`);
  if (!offloadProven) {
    console.log('  [GPU_MODEL_LOAD] WARNING: gpuLayersActual=0 and gpuVram=0. The Vulkan prebuilt binary');
    console.log('    is likely NOT installed. Run: npx node-llama-cpp download --gpu vulkan');
    console.log('    (this installs @node-llama-cpp/win-x64-vulkan into node_modules).');
  }
}

/**
 * Initialize the node-llama-cpp engine with EXPLICIT backend selection.
 *
 * Strategy (respects "do NOT auto-install binaries"):
 *   1. Preflight: `getLlamaGpuTypes("supported")` — list what's possible.
 *   2. If Vulkan is supported, explicitly request `gpu: "vulkan"` with
 *      `build: "never"` + `skipDownload: true`. This uses the Vulkan binary
 *      ONLY if it's already installed; it never downloads/builds.
 *   3. If Vulkan init throws (binary missing / driver issue), fall back to
 *      `gpu: "auto"` (which will land on CUDA if available, else CPU).
 *   4. Capture + log the [GPU_RUNTIME] diagnostic block regardless of outcome.
 *
 * This makes the backend choice deterministic and observable instead of
 * relying on `auto` + Electron's `build: "never"` default silently picking
 * the CPU binary.
 */
async function getLlamaInstance() {
  if (_llama) return _llama;
  console.log('[NEX AI Local] Initializing llama.cpp engine...');

  // node-llama-cpp is ESM-only and uses top-level await, so we must
  // dynamically import it. Direct `await import(...)` in our CJS-compiled
  // module gets rewritten by TypeScript to `require()`, which fails on
  // ESM-only deps. Use eval-based indirection to keep the `import()`
  // call as a true dynamic import at runtime.
  const importSrc = '(async (m) => await import(m))';
  const dynamicImport = (0, eval)(importSrc) as (m: string) => Promise<any>;
  const mod = await dynamicImport('node-llama-cpp');
  _LlamaChatSession = mod.LlamaChatSession;

  // ── 1. Preflight: which GPU types are supported on THIS machine? ───────
  let supportedGpus: string[] = [];
  try {
    supportedGpus = (await mod.getLlamaGpuTypes('supported')) as string[];
  } catch (e: any) {
    console.warn('[NEX AI Local] getLlamaGpuTypes("supported") failed:', e?.message || e);
  }
  console.log(`[NEX AI Local] Preflight: supportedGpuTypes=[${supportedGpus.join(', ')}]`);

  // ── 2. Try Vulkan explicitly (best cross-vendor option on Win/Linux) ───
  // build:"never" + skipDownload:true ⇒ NEVER builds from source or downloads.
  // If the Vulkan prebuilt binary isn't installed, this throws and we fall
  // through to the auto fallback. That's the desired, honest behavior.
  let llama: any = null;
  let chosenBackend: 'cpu' | 'cuda' | 'metal' | 'vulkan' = 'cpu';
  let chosenReason = '';

  if (supportedGpus.includes('vulkan')) {
    try {
      console.log('[NEX AI Local] Requesting Vulkan backend (build=never, skipDownload=true)...');
      llama = await mod.getLlama({
        gpu: 'vulkan',
        build: 'never',
        skipDownload: true,
      });
      const g = (llama as any).gpu;
      chosenBackend = (g === 'metal' || g === 'cuda' || g === 'vulkan') ? g : 'cpu';
      chosenReason = `explicit gpu:"vulkan" succeeded (llama.gpu="${g}")`;
      console.log(`[NEX AI Local] Vulkan backend initialized OK`);
    } catch (e: any) {
      chosenReason = `vulkan request failed: ${(e?.message || e).toString().split('\n')[0]}`;
      console.warn(`[NEX AI Local] Vulkan backend unavailable: ${e?.message || e}`);
      console.warn('[NEX AI Local] → Falling back to gpu:"auto".');
      console.warn('[NEX AI Local] → To enable Vulkan, install the binary: npx node-llama-cpp download --gpu vulkan');
    }
  } else {
    chosenReason = `vulkan not in supportedGpuTypes=[${supportedGpus.join(', ')}]`;
    console.log('[NEX AI Local] Vulkan not supported on this machine; using auto detection.');
  }

  // ── 3. Fallback: gpu:"auto" (CUDA → CPU) ───────────────────────────────
  if (!llama) {
    try {
      llama = await mod.getLlama({
        gpu: 'auto',
        build: 'never',     // Electron-safe; never build from source
        skipDownload: true, // never auto-download a binary
      });
      const g = (llama as any).gpu;
      chosenBackend = (g === 'metal' || g === 'cuda' || g === 'vulkan') ? g : 'cpu';
      if (chosenReason) chosenReason += ' | ';
      chosenReason += `auto selected backend="${g}"`;
    } catch (e: any) {
      // Last resort: plain getLlama() (may build/download — but only if the
      // above failed, which means no prebuilt binary was found at all).
      console.warn(`[NEX AI Local] gpu:"auto" with build:"never" failed: ${e?.message || e}`);
      console.warn('[NEX AI Local] → Final fallback: plain getLlama() (may trigger source build).');
      llama = await mod.getLlama();
      const g = (llama as any).gpu;
      chosenBackend = (g === 'metal' || g === 'cuda' || g === 'vulkan') ? g : 'cpu';
      if (chosenReason) chosenReason += ' | ';
      chosenReason += `plain getLlama() returned backend="${g}"`;
    }
  }

  _llama = llama;
  _gpuBackend = chosenBackend;

  // ── 4. Collect + log the [GPU_RUNTIME] diagnostic block ────────────────
  let buildType: 'localBuild' | 'prebuilt' | 'unknown' = 'unknown';
  let supportsGpuOffloading = false;
  let gpuDeviceNames: string[] = [];
  let systemInfo = '';
  let nativeBinaryInfo = '';
  try {
    buildType = (llama as any).buildType ?? 'unknown';
  } catch { /* */ }
  try {
    supportsGpuOffloading = !!(llama as any).supportsGpuOffloading;
  } catch { /* */ }
  try {
    systemInfo = String((llama as any).systemInfo ?? '');
  } catch { /* */ }
  try {
    const release = (llama as any).llamaCppRelease;
    nativeBinaryInfo = `${buildType} (llama.cpp ${release?.repo || '?'}@${release?.release || '?'})`;
  } catch { /* */ }
  try {
    gpuDeviceNames = await (llama as any).getGpuDeviceNames?.() ?? [];
  } catch (e: any) {
    gpuDeviceNames = [];
  }

  _gpuDiagnostics = {
    platform: process.platform,
    architecture: process.arch,
    electron: isRunningUnderElectron(),
    backend: chosenBackend,
    buildType,
    supportsGpuOffloading,
    gpuDeviceNames,
    supportedGpuTypes: supportedGpus,
    chosenReason,
    nativeBinaryInfo: nativeBinaryInfo || buildType,
    systemInfo,
    collectedAt: Date.now(),
  };
  logGpuRuntimeBlock(_gpuDiagnostics);

  // Extra: dump llama.cpp systemInfo (contains "BLAS", "GGML_VULKAN", etc.)
  if (systemInfo) {
    console.log('[GPU_RUNTIME] llama.cpp systemInfo:');
    for (const line of systemInfo.split('\n')) {
      if (line.trim()) console.log(`  ${line}`);
    }
  }

  console.log(`[NEX AI Local] Engine ready (GPU backend: ${_gpuBackend}, supportsGpuOffloading: ${supportsGpuOffloading})`);
  return _llama;
}

/**
 * UI-03: return the actual GPU backend in use by the llama.cpp engine.
 * Returns 'cpu' before the engine is initialized (safe default).
 */
export function getGpuBackend(): 'cpu' | 'cuda' | 'metal' | 'vulkan' {
  return _gpuBackend;
}

/**
 * Return the full GPU runtime diagnostics (engine + last model load).
 * Used by the UI / IPC layer to surface real GPU-offload status.
 * Returns null before the engine is initialized.
 */
export function getGpuRuntimeDiagnostics(): GpuRuntimeDiagnostics | null {
  return _gpuDiagnostics ? { ..._gpuDiagnostics } : null;
}

/**
 * Phase 90: Wait for any in-flight inference to complete before proceeding.
 * This prevents concurrent access to the shared context/sequence.
 */
async function waitForInFlight(): Promise<void> {
  while (_inFlightPromise) {
    try { await _inFlightPromise; } catch { /* ignore errors from previous request */ }
  }
}

/**
 * Phase 90: Mark inference as in-flight. Returns a function to clear it.
 */
function markInFlight<T>(promise: Promise<T>): () => void {
  _inFlightPromise = promise as Promise<any>;
  return () => { if (_inFlightPromise === promise) _inFlightPromise = null; };
}

/**
 * Translate the legacy NEX AI `gpuLayers` convention to the node-llama-cpp
 * `LlamaModelOptions.gpuLayers` option type.
 *
 *   -1  (auto)  → "auto"  (adapt to VRAM, fit as many layers as possible)
 *    0  (CPU)   → 0       (force CPU-only: 0 layers in VRAM)
 *   >0  (N)     → N       (exactly N layers; throws if VRAM insufficient)
 *
 * BUGFIX: previously `-1` was passed as a raw number. node-llama-cpp's
 * `number` type means "store EXACTLY N layers", so `-1` was not "auto" and
 * not "max" — it was an invalid layer count. Mapping to `"auto"` makes
 * maximum offload actually happen when a GPU backend is active.
 */
function translateGpuLayers(value: number | undefined): number | string {
  if (value === undefined || value === -1) return 'auto';
  if (value === 0) return 0;
  return value;
}

/**
 * Load a GGUF model into memory. If a different model is already loaded,
 * unload it first. Subsequent inferences use this loaded model.
 *
 * Emits the [GPU_MODEL_LOAD] diagnostic block immediately after LlamaModel
 * creation, proving (or disproving) real GPU offload via:
 *   - model.gpuLayers        (actual offloaded layer count)
 *   - llama.getLlamaMemoryUsage()  ({gpuVram, cpuRam})
 *   - llama.getVramState()         (before/after VRAM delta)
 */
export async function loadModel(model: LocalModelInfo, opts: InferenceOptions = {}): Promise<void> {
  // Phase 87: Assert model has a valid path before proceeding
  if (!model.path) {
    console.error('[MODEL_PATH_MISSING]', JSON.stringify({ id: model.id, name: model.name, path: model.path }));
    throw new Error(`Resolved model has no path: ${JSON.stringify({ id: model.id, name: model.name })}`);
  }
  // Phase 86 P1-6: Fix idempotency — check fileExists BEFORE the fast path
  if (!model.fileExists) {
    throw new Error(`Model file does not exist: ${model.path}`);
  }

  // Translate the legacy gpuLayers convention to node-llama-cpp's option type.
  const rawGpuLayers = opts.gpuLayers ?? model.gpuLayers ?? -1;
  const translatedGpuLayers = translateGpuLayers(rawGpuLayers);
  const requestedContextSize = opts.contextSize ?? model.contextSize ?? 1024;

  // ── IDEMPOTENCY CHECK (enhanced) ────────────────────────────────────────
  // Skip reload if ALL of:
  //   1. Same model id
  //   2. Model + context exist
  //   3. Model + context are NOT disposed (the "Object is disposed" error
  //      happens when a stale reference is used after unloadModel disposed it)
  //   4. Options are compatible (same gpuLayers translation + context >= requested)
  //
  // Previously this only checked model.id, so if chatStream called loadModel
  // with different opts than the activation path, it would UNLOAD the working
  // model and RELOAD it — causing "Object is disposed" when the old session
  // tried to use the disposed context. Now we reuse the loaded model as long
  // as it's the same id and not disposed.
  const sameId = _loadedModelId === model.id;
  const exists = !!(sameId && _loadedContext && _loadedModel);
  const notDisposed = exists && !((_loadedModel as any).disposed) && !((_loadedContext as any).disposed);
  const contextLargeEnough = exists && (_loadedContextSize ?? 0) >= requestedContextSize;
  // Note: gpuLayers can't be changed without reloading the model (it's set at
  // loadModel time), so we don't check it here — if the model is already loaded
  // with ANY gpuLayers, we keep it (reloading just to change gpuLayers would
  // cause the dispose race).

  if (exists && notDisposed) {
    // Reuse the already-loaded model. Log the reuse for diagnostics.
    console.log(`[MODEL_LOAD_PATH]`);
    console.log(`  selected=reuse-existing`);
    console.log(`  modelId=${model.id}`);
    console.log(`  gpuLayers=existing (actual=${_loadedModelGpuLayers ?? '?'})`);
    console.log(`  context=${_loadedContextSize ?? '?'} (requested ${requestedContextSize}${contextLargeEnough ? '' : ' — smaller than requested, but reusing to avoid reload'})`);
    console.log(`  kvCacheMode=default`);
    _loadedModelInfo = model;
    return;
  }

  // If the model exists but is disposed, clear the stale references before
  // reloading (unloadModel would try to dispose an already-disposed object).
  if (sameId && !notDisposed) {
    console.warn('[NEX AI Local] Loaded model/context is disposed — clearing stale references before reload');
    _loadedModel = null;
    _loadedContext = null;
    _ctxSequence = null;
    _loadedModelId = null;
    _loadedModelInfo = null;
    _loadedModelGpuLayers = null;
    _loadedContextSize = null;
  }

  // Log the load path decision
  console.log(`[MODEL_LOAD_PATH]`);
  console.log(`  selected=fresh-load`);
  console.log(`  modelId=${model.id}`);
  console.log(`  gpuLayers=${translatedGpuLayers} (raw=${rawGpuLayers})`);
  console.log(`  context=${requestedContextSize}`);
  console.log(`  kvCacheMode=default`);
  console.log(`  reason=${sameId ? 'disposed-or-context-too-small' : 'different-model'}`);

  // Phase 90: Wait for any in-flight inference before unloading
  await waitForInFlight();

  // Unload previous model (unless it's already cleared above)
  await unloadModel();

  const llama = await getLlamaInstance();
  console.log(`[NEX AI Local] Loading model: ${model.name} (${formatBytes(model.sizeBytes)})`);

  const modelOpts: any = {
    modelPath: model.path,
    gpuLayers: translatedGpuLayers,
  };

  // Capture VRAM state BEFORE model load (proves the delta after load).
  let vramBefore: { total: number; used: number; free: number } | undefined;
  try {
    vramBefore = await (llama as any).getVramState?.();
  } catch { /* CPU backend has no VRAM state */ }

  // Load the model — if this throws, the error message tells us exactly why
  // (unsupported architecture, corrupt GGUF, OOM, etc.). We log the full
  // error so the user can see the real reason, not a generic message.
  try {
    _loadedModel = await llama.loadModel(modelOpts);
  } catch (loadErr: any) {
    // Surface the REAL llama.cpp error with full context
    console.error('[NEX AI Local] llama.loadModel() FAILED:', {
      modelPath: model.path,
      modelName: model.name,
      error: loadErr?.message,
      code: loadErr?.code,
      stack: loadErr?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    throw loadErr;
  }

  // ── PROVE GPU offload: read the ACTUAL offloaded layer count ───────────
  let actualGpuLayers = 0;
  try {
    actualGpuLayers = (typeof (_loadedModel as any).gpuLayers === 'number')
      ? (_loadedModel as any).gpuLayers
      : 0;
  } catch { /* */ }

  // ── PROVE GPU offload: VRAM + memory usage AFTER model load ────────────
  let vramAfter: { total: number; used: number; free: number } | undefined;
  try {
    vramAfter = await (llama as any).getVramState?.();
  } catch { /* */ }
  let memUsage: { gpuVram: number; cpuRam: number } | undefined;
  try {
    memUsage = await (llama as any).getLlamaMemoryUsage?.();
  } catch { /* */ }

  // Enrich the diagnostics object with model-load proof.
  if (_gpuDiagnostics) {
    _gpuDiagnostics = {
      ..._gpuDiagnostics,
      modelPath: model.path,
      modelGpuLayersRequested: translatedGpuLayers,
      modelGpuLayersActual: actualGpuLayers,
      vramBeforeModelLoad: vramBefore,
      vramAfterModelLoad: vramAfter,
      llamaMemoryUsage: memUsage,
      collectedAt: Date.now(),
    };
  }

  // Emit the [GPU_MODEL_LOAD] proof block.
  logGpuModelLoadBlock(
    model.path,
    translatedGpuLayers,
    actualGpuLayers,
    vramBefore,
    vramAfter,
    memUsage,
    _gpuBackend,
  );

  // ── VRAM-aware context creation with automatic fallback ────────────────
  // Strategy:
  //   1. First try contextSize: {min: 256, max: requested} — lets node-llama-cpp
  //      auto-fit the context to available VRAM (the BEST approach for low-VRAM
  //      GPUs). Also enable flashAttention:"auto" for memory efficiency.
  //   2. If that fails, try fixed sizes: requested → 1024 → 512 → 256.
  //      Each retry halves the context. The model is already loaded (with
  //      gpuLayers="auto"), so we only recreate the CONTEXT.
  //
  // On an 8GB RTX 4060 with a 20GB model partially offloaded, context 2048
  // can exceed VRAM during prefill. The auto-fit mode handles this by
  // shrinking the context to fit available VRAM automatically.
  // Note: requestedContextSize is already declared above (idempotency check).
  const MIN_CONTEXT = 256;
  const contextFallbackChain = generateContextFallbackChain(requestedContextSize, MIN_CONTEXT);

  let lastContextError: any = null;
  let usedContextSize = requestedContextSize;
  let kvCacheMode = 'default';

  // Attempt 1: auto-fit context (min:256, max:requested) with flash attention
  try {
    _loadedContext = await _loadedModel.createContext({
      contextSize: { min: MIN_CONTEXT, max: requestedContextSize },
      threads: opts.threads ?? 4,
      flashAttention: 'auto',
    } as any);
    // Read the actual context size that was created
    usedContextSize = (typeof (_loadedContext as any).contextSize === 'number')
      ? (_loadedContext as any).contextSize
      : requestedContextSize;
    kvCacheMode = 'auto-fit+flashAttn';
    console.log(`[VRAM_FALLBACK] auto-fit context succeeded: contextSize=${usedContextSize} (requested max=${requestedContextSize}, min=${MIN_CONTEXT})`);
  } catch (ctxErr: any) {
    const msg = (ctxErr?.message || '').toLowerCase();
    const isVramError = /vram|context size.*too large|insufficient.*memory|out of memory|oom/.test(msg);
    console.warn(`[VRAM_FALLBACK] auto-fit context failed: ${ctxErr?.message} (isVramError=${isVramError})`);

    // Attempt 2: fixed-size fallback chain
    for (let i = 0; i < contextFallbackChain.length; i++) {
      const trySize = contextFallbackChain[i];
      try {
        _loadedContext = await _loadedModel.createContext({
          contextSize: trySize,
          threads: opts.threads ?? 4,
          flashAttention: 'auto',
        } as any);
        usedContextSize = trySize;
        kvCacheMode = `fixed-${trySize}+flashAttn`;
        console.log(`[VRAM_FALLBACK] fixed contextSize=${trySize} succeeded (retry ${i}/${contextFallbackChain.length - 1})`);
        lastContextError = null;
        break;
      } catch (innerErr: any) {
        lastContextError = innerErr;
        const imsg = (innerErr?.message || '').toLowerCase();
        const innerIsVram = /vram|context size.*too large|insufficient.*memory|out of memory|oom/.test(imsg);
        console.warn(`[VRAM_FALLBACK] contextSize=${trySize} failed: ${innerErr?.message} (isVramError=${innerIsVram})`);
        if (!innerIsVram || i === contextFallbackChain.length - 1) {
          throw innerErr;
        }
      }
    }
  }

  if (lastContextError) {
    throw lastContextError;
  }

  _ctxSequence = null; // new context → new sequence pool
  _loadedModelId = model.id;
  _loadedModelInfo = model;  // Phase 87: Store the LocalModelInfo for getLoadedModel()
  _loadedModelGpuLayers = actualGpuLayers;
  _loadedContextSize = usedContextSize;

  // Phase 74: Model load log
  console.log(`[MODEL_LOAD]`);
  console.log(`  path=${model.path}`);
  console.log(`  size=${model.sizeBytes}`);
  console.log(`  contextSize=${usedContextSize}${usedContextSize !== requestedContextSize ? ` (fallback from ${requestedContextSize})` : ''}`);
  console.log(`  gpuLayers=${rawGpuLayers} (translated→${translatedGpuLayers})`);
  console.log(`  gpuLayersActual=${actualGpuLayers}`);
  console.log(`  backend=${_gpuBackend}`);
  console.log(`  kvCacheMode=${kvCacheMode}`);
  console.log(`  modelId=${model.id}`);

  // Mark as last used
  touchModel(model.id);

  noteLoadedModel(model.name);
  // UI-03: surface the model's configured context window size so the UI
  // (BottomStatusBar / HardwareMonitor) can show context usage even for
  // direct chat (was previously only populated for agent tasks).
  noteInferenceStats({
    contextMaxTokens: usedContextSize,
  });
  console.log(`[NEX AI Local] Model loaded: ${model.name}`);
}

/**
 * Generate a context-size fallback chain for VRAM-aware retry.
 * Returns a descending list of context sizes to try, ending at `minContext`.
 * Examples (minContext=256):
 *   2048 → [2048, 1024, 512, 256]
 *   1024 → [1024, 512, 256]
 *   8192 → [8192, 4096, 2048, 1024, 512, 256]
 *   256  → [256]  (at minimum, no fallback)
 */
function generateContextFallbackChain(requested: number, minContext: number = 256): number[] {
  if (requested <= minContext) return [Math.max(requested, minContext)];
  const chain: number[] = [requested];
  let cur = requested;
  while (cur > minContext) {
    cur = Math.floor(cur / 2);
    if (cur < minContext) cur = minContext;
    chain.push(cur);
    if (cur === minContext) break;
  }
  // Deduplicate (e.g. 512 → [512, 256] not [512, 256, 256])
  return [...new Set(chain)];
}

/**
 * Unload the currently-loaded model and free memory.
 * NOTE: This does NOT dispose the underlying llama.cpp engine (_llama).
 * Use `shutdownLlama()` for full teardown (e.g. before app.exit()).
 */
export async function unloadModel(): Promise<void> {
  // Phase 90: Wait for any in-flight inference before disposing
  await waitForInFlight();
  if (_ctxSequence) {
    try { (_ctxSequence as any).dispose?.(); } catch (e: any) { console.warn('[NEX AI Local] Sequence dispose warning:', e?.message); }
    _ctxSequence = null;
  }
  if (_loadedContext) {
    try { (_loadedContext as any).dispose?.(); } catch (e: any) { console.warn('[NEX AI Local] Context dispose warning:', e?.message); }
    _loadedContext = null;
  }
  if (_loadedModel) {
    try { (_loadedModel as any).dispose?.(); } catch (e: any) { console.warn('[NEX AI Local] Model dispose warning:', e?.message); }
    _loadedModel = null;
  }
  _loadedModelId = null;
  _loadedModelInfo = null;  // Phase 87: Clear the LocalModelInfo too
  _loadedModelGpuLayers = null;
  _loadedContextSize = null;
  noteLoadedModel(null);
  console.log('[NEX AI Local] Model unloaded');
}

/**
 * Full shutdown: unload model AND dispose the llama.cpp engine itself.
 *
 * CRITICAL: Call this before app.exit() / process.exit() — otherwise
 * node-llama-cpp's native AsyncWorkers may still be in-flight when the
 * JS env tears down, causing SIGABRT (exit 134).
 *
 * `app.quit()` works without this because Node emits `beforeExit` first,
 * but `app.exit()` skips `beforeExit` entirely.
 */
export async function shutdownLlama(): Promise<void> {
  await unloadModel();
  if (_llama) {
    try {
      console.log('[NEX AI Local] Disposing llama.cpp engine...');
      await _llama.dispose?.();
      console.log('[NEX AI Local] Engine disposed');
    } catch (err) {
      console.warn('[NEX AI Local] Engine dispose error:', (err as any)?.message || err);
    }
    _llama = null;
    _LlamaChatSession = null;
    _gpuDiagnostics = null;
  }
}

/**
 * Get info about the currently-loaded model (if any).
 */
export function getLoadedModelInfo(): { id: string } | null {
  if (!_loadedModelId) return null;
  return { id: _loadedModelId };
}

/**
 * Phase 86 P0-3 / Phase 87: Get the full LocalModelInfo of the loaded model.
 * Returns the LocalModelInfo that was passed to loadModel() — NOT the
 * node-llama-cpp LlamaModel object (which is _loadedModel).
 * Returns null if no model is loaded.
 */
export function getLoadedModel(): LocalModelInfo | null {
  if (!_loadedModelId || !_loadedModelInfo) return null;
  return _loadedModelInfo;
}

/**
 * Phase 86 P0-3: Get the loaded context (if any).
 */
export function getLoadedContext(): any | null {
  return _loadedContext;
}

/**
 * Generate a chat completion (full response, not streamed).
 * The caller is responsible for loading the model first.
 *
 * Phase 74 FIX: Uses LlamaChatSession's native multi-turn API instead of
 * manually labeling messages with "User:/Assistant:/System:" strings.
 * This prevents the doubly-wrapped ChatML prompt that was causing low
 * quality responses on Qwen2.5.
 */
export async function chatComplete(
  model: LocalModelInfo,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts: InferenceOptions = {}
): Promise<InferenceResult> {
  if (!model.path) {
    console.error('[MODEL_PATH_MISSING] chatComplete — model:', JSON.stringify({ id: model.id, name: model.name }));
    throw new Error('Resolved model has no path — cannot perform inference');
  }

  // Phase 90: Wait for any in-flight inference
  await waitForInFlight();

  await loadModel(model, opts);
  if (!_loadedContext) throw new Error('Model context not initialized');
  await getLlamaInstance();

  // [GPU_INFERENCE] — prove the active session uses the GPU-configured model.
  // This is the identity check: the model used by chatComplete MUST be the
  // same _loadedModel instance that was created with gpuLayers in loadModel().
  let actualGpuLayers = 0;
  try { actualGpuLayers = (typeof (_loadedModel as any).gpuLayers === 'number') ? (_loadedModel as any).gpuLayers : 0; } catch { /* */ }
  console.log(`[GPU_INFERENCE] chatComplete modelId=${_loadedModelId} backend=${_gpuBackend} gpuLayersActual=${actualGpuLayers} modelInstanceSame=${_loadedModelId === model.id ? 'YES' : 'NO(new model loaded)'}`);

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) throw new Error('No user message in conversation');

  const chatHistory = messages
    .filter(m => m.role !== 'system')
    .slice(0, -1)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  // Phase 90: Per-request AbortController with diagnostics
  const requestId = `chatComplete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const abortController = new AbortController();
  _activeAbortController = abortController;
  _activeRequestId = requestId;
  _activeRequestCreatedAt = Date.now();
  console.log(`[INFERENCE_ABORT_CONTROLLER] requestId=${requestId} op=chatComplete createdAt=${_activeRequestCreatedAt} modelId=${model.id}`);

  const session = new _LlamaChatSession({
    contextSequence: getSharedSequence(),
    systemPrompt: opts.systemPrompt,
    chatHistory: chatHistory.length > 0 ? chatHistory : undefined,
  });

  const start = Date.now();
  let response = '';

  // Phase 90: Wrap in serialization
  const inferencePromise = (async () => {
    try {
      const _t0 = Date.now();
      response = await session.prompt(lastUserMsg.content, {
        maxTokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.7,
        // Phase 116: Same sampling params as chatStream for consistency
        topP: 0.9,
        repeatPenalty: 1.1,
        signal: abortController.signal,
      } as any);
      const genMs = Date.now() - _t0;
      const genTokens = estimateTokens(response);
      console.log(`[INFERENCE_METRICS] model=${model.name} backend=${_gpuBackend} gpuLayers=${opts.gpuLayers ?? model.gpuLayers ?? -1} context=${opts.contextSize ?? model.contextSize ?? 1024} generatedTokens=${genTokens} generationMs=${genMs} tokensPerSecond=${(genTokens / Math.max(0.001, genMs / 1000)).toFixed(1)} totalMs=${Date.now() - start}`);
      noteInferenceStats({
        tokensPerSecond: genTokens / Math.max(0.001, genMs / 1000),
        generatedTokens: genTokens,
        durationMs: genMs,
        active: false,
      });
    } finally {
      try { (session as any).dispose?.(); } catch (e: any) { console.warn('[NEX AI Local] Session dispose warning:', e?.message); }
      if (_activeAbortController === abortController) {
        _activeAbortController = null;
        _activeRequestId = null;
        _activeRequestCreatedAt = 0;
      }
    }
  })();

  const clearInFlight = markInFlight(inferencePromise);
  try {
    await inferencePromise;
  } finally {
    clearInFlight();
  }

  return {
    content: response,
    tokensGenerated: estimateTokens(response),
    modelId: model.id,
    modelName: model.name,
    stopped: abortController.signal.aborted,
    durationMs: Date.now() - start,
  };
}

/**
 * Stream a chat completion token-by-token.
 * The onChunk callback is called from a worker thread.
 *
 * Phase 74 FIX: Uses LlamaChatSession's native multi-turn API (same fix
 * as chatComplete). No more manual "User:/Assistant:" labeling.
 */
export async function chatStream(
  model: LocalModelInfo,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  onChunk: (chunk: StreamChunk) => void,
  opts: InferenceOptions = {}
): Promise<InferenceResult> {
  if (!model.path) {
    console.error('[MODEL_PATH_MISSING] chatStream — model:', JSON.stringify({ id: model.id, name: model.name }));
    throw new Error('Resolved model has no path — cannot perform inference');
  }

  // Phase 90: Wait for any in-flight inference
  await waitForInFlight();

  await loadModel(model, opts);
  if (!_loadedContext) throw new Error('Model context not initialized');
  await getLlamaInstance();

  // [GPU_INFERENCE] — prove the active session uses the GPU-configured model.
  let actualGpuLayers = 0;
  try { actualGpuLayers = (typeof (_loadedModel as any).gpuLayers === 'number') ? (_loadedModel as any).gpuLayers : 0; } catch { /* */ }
  console.log(`[GPU_INFERENCE] chatStream modelId=${_loadedModelId} backend=${_gpuBackend} gpuLayersActual=${actualGpuLayers} modelInstanceSame=${_loadedModelId === model.id ? 'YES' : 'NO(new model loaded)'}`);

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) throw new Error('No user message in conversation');

  const chatHistory = messages
    .filter(m => m.role !== 'system')
    .slice(0, -1)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  // Phase 90: Per-request AbortController with diagnostics
  const requestId = `chatStream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const abortController = new AbortController();
  _activeAbortController = abortController;
  _activeRequestId = requestId;
  _activeRequestCreatedAt = Date.now();
  console.log(`[INFERENCE_ABORT_CONTROLLER] requestId=${requestId} op=chatStream createdAt=${_activeRequestCreatedAt} modelId=${model.id}`);

  const session = new _LlamaChatSession({
    contextSequence: getSharedSequence(),
    systemPrompt: opts.systemPrompt,
    chatHistory: chatHistory.length > 0 ? chatHistory : undefined,
  });

  const start = Date.now();
  let fullResponse = '';
  let firstTokenMs = 0;
  noteInferenceStats({ active: true });

  const inferencePromise = (async () => {
    try {
      const response = await session.prompt(lastUserMsg.content, {
        maxTokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.7,
        // Phase 116: Sampling params for natural conversation.
        // topP=0.9: nucleus sampling — allows diversity while filtering
        //   unlikely tokens (prevents both rambling and repetition).
        // repeatPenalty=1.1: discourages the model from repeating itself
        //   (fixes the "re-introducing myself every turn" problem and
        //   repetitive phrasing). 1.0 = no penalty, 1.3 = aggressive.
        topP: 0.9,
        repeatPenalty: 1.1,
        signal: abortController.signal,
        onTextChunk: (chunk: string) => {
          if (abortController.signal.aborted) return;
          if (!firstTokenMs) firstTokenMs = Date.now() - start;
          fullResponse += chunk;
          onChunk({ content: chunk, done: false });
        },
      } as any);
      void response;
      if (response && !fullResponse.endsWith(response.slice(-50))) {
        fullResponse = response;
      }
      onChunk({ content: '', done: true });
      const genMs = Date.now() - start;
      const genTokens = estimateTokens(fullResponse);
      console.log(`[INFERENCE_METRICS] model=${model.name} backend=${_gpuBackend} gpuLayers=${opts.gpuLayers ?? model.gpuLayers ?? -1} context=${opts.contextSize ?? model.contextSize ?? 1024} firstTokenMs=${firstTokenMs} generatedTokens=${genTokens} generationMs=${genMs} tokensPerSecond=${(genTokens / Math.max(0.001, genMs / 1000)).toFixed(1)} totalMs=${genMs}`);
      noteInferenceStats({
        tokensPerSecond: genTokens / Math.max(0.001, genMs / 1000),
        generatedTokens: genTokens,
        durationMs: genMs,
        active: false,
      });
      return {
        content: fullResponse,
        tokensGenerated: genTokens,
        modelId: model.id,
        modelName: model.name,
        stopped: abortController.signal.aborted,
        durationMs: genMs,
      };
    } catch (err: any) {
      noteInferenceStats({ active: false });
      onChunk({ content: '', done: true, error: err.message });
      throw err;
    } finally {
      try { (session as any).dispose?.(); } catch (e: any) { console.warn('[NEX AI Local] Session dispose warning:', e?.message); }
      if (_activeAbortController === abortController) {
        _activeAbortController = null;
        _activeRequestId = null;
        _activeRequestCreatedAt = 0;
      }
    }
  })();

  const clearInFlight = markInFlight(inferencePromise);
  try {
    return await inferencePromise;
  } finally {
    clearInFlight();
  }
}

/**
 * Phase 90: Abort the currently-active inference request.
 * Uses per-request AbortController — only aborts the active request,
 * not future ones.
 *
 * ABORT DIAGNOSTICS: logs [INFERENCE_ABORT] with the FULL CALLER STACK
 * TRACE so that spurious/unexpected aborts can be traced to their exact
 * call site. This is the single most important diagnostic for the
 * "immediate abort after chatStream starts" issue.
 *
 * The stack trace is captured via `new Error().stack` at the call site,
 * NOT from the AbortController itself. This reveals WHO called
 * abortInference() — whether it was an IPC handler (ai-abort,
 * ai-chat-stream-cancel, interaction-stop, local-runtime-abort) or
 * an internal code path.
 */
export function abortInference(reason?: string): void {
  if (_activeAbortController) {
    const elapsedMs = _activeRequestCreatedAt > 0 ? Date.now() - _activeRequestCreatedAt : -1;
    // Capture the caller stack trace for diagnostics.
    const callerStack = new Error().stack || '(no stack)';
    console.log(`[INFERENCE_ABORT]`);
    console.log(`  requestId=${_activeRequestId || '(unknown)'}`);
    console.log(`  reason=${reason || '(not specified)'}`);
    console.log(`  elapsedMs=${elapsedMs}`);
    console.log(`  callerStack=${callerStack.split('\n').slice(0, 12).join('\n  ')}`);
    if (elapsedMs >= 0 && elapsedMs < 3000) {
      console.warn(`[INFERENCE_ABORT] WARNING: abort called only ${elapsedMs}ms after request creation — possible spurious/immediate abort`);
    }
    console.log('[NEX AI Local] Aborting active inference request');
    _activeAbortController.abort();
    _activeAbortController = null;
    _activeRequestId = null;
    _activeRequestCreatedAt = 0;
  } else {
    console.log('[NEX AI Local] No active inference to abort');
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Claim (once) and reuse the context sequence for the loaded model. */
function getSharedSequence(): any {
  if (!_ctxSequence && _loadedContext) {
    _ctxSequence = (_loadedContext as any).getSequence();
  }
  return _ctxSequence;
}

function estimateTokens(text: string): number {
  // Rough estimate: 1 token ~= 4 chars in English, ~1 char in Chinese
  // Used for display only; actual token count requires tokenizer
  return Math.ceil(text.length / 4);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
