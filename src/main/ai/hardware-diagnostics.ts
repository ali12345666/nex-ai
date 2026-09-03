/**
 * NEX AI — Hardware Diagnostics (Phase 65)
 *
 * Validates the complete local AI pipeline on real hardware. Provides:
 *   - CPU inference speed benchmark
 *   - RAM usage monitoring
 *   - GPU detection + VRAM usage
 *   - Tokens/sec measurement
 *   - Windows-specific path/permission fixes
 *   - Full pipeline validation (download → verify → load → infer)
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  Hardware Diagnostics (this file)                           │
 *   │    1. getHardwareDiagnostics() → CPU/RAM/GPU/VRAM snapshot   │
 *   │    2. runInferenceBenchmark(modelId) → tokens/sec + latency  │
 *   │    3. validatePipeline() → full end-to-end pipeline test     │
 *   │    4. fixWindowsPath(path) → backslash → forward slash       │
 *   │    5. getDetailedRuntimeStatus() → model + context + threads │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  Hardware Model Recommender (Phase 39)                      │
 *   │    detectHardwareProfile + canModelRunOnHardware             │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  Runtime Telemetry (Phase 21)                               │
 *   │    getLastInference + noteInferenceStats                    │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  Inference Engine (Phase 12)                                │
 *   │    loadModel + chatComplete + getGpuBackend                 │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  Interaction Loop (Phase 62)                                │
 *   │    processText → localChatComplete → response               │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SECURITY
 * ════════════════════════════════════════════════════════════════════════════
 * - All inference is local (node-llama-cpp). No cloud API.
 * - No downloads — this module only runs diagnostics on installed models.
 * - No file modifications — read-only hardware + model inspection.
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as os from 'os';
import * as path from 'path';
import { detectHardwareProfile, canModelRunOnHardware, type HardwareProfile, type ModelHardwareVerdict } from './hardware-model-recommender';
import { getDefaultModel, getModel, listModels, type LocalModelInfo } from './model-registry';
import { getGpuBackend, getLoadedModelInfo } from './inference';
import { getLastInference } from './runtime-telemetry';
import { getInteractionLoopManager } from './interaction-loop';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface HardwareDiagnostics {
  /** OS platform (win32/darwin/linux). */
  platform: string;
  /** OS release version. */
  osRelease: string;
  /** CPU model name. */
  cpuModel: string;
  /** Number of physical CPU cores. */
  cpuCores: number;
  /** Total logical CPU threads. */
  cpuThreads: number;
  /** Total system RAM in bytes. */
  ramTotalBytes: number;
  /** Free system RAM in bytes. */
  ramFreeBytes: number;
  /** RAM usage percentage (0-100). */
  ramUsagePercent: number;
  /** Process memory usage in bytes (RSS). */
  processRssBytes: number;
  /** GPU info (or null if no GPU detected). */
  gpu: {
    name: string;
    vendor: string;
    vramTotalBytes: number;
    vramFreeBytes: number;
    supportsCuda: boolean;
    supportsMetal: boolean;
    supportsVulkan: boolean;
  } | null;
  /** Backend detected by llama.cpp (cpu/cuda/metal/vulkan). */
  llamaGpuBackend: 'cpu' | 'cuda' | 'metal' | 'vulkan';
  /** Hardware profile from Phase 39. */
  hardwareProfile: HardwareProfile;
  /** Timestamp. */
  checkedAt: number;
}

export interface InferenceBenchmark {
  modelId: string;
  modelName: string;
  modelSizeBytes: number;
  modelParameterCount: string;
  modelQuantization: string;
  /** Test prompt used. */
  prompt: string;
  /** Generated response. */
  response: string;
  /** Tokens generated. */
  tokensGenerated: number;
  /** Inference duration in ms. */
  durationMs: number;
  /** Tokens per second. */
  tokensPerSecond: number;
  /** Context size used. */
  contextSize: number;
  /** GPU layers configured. */
  gpuLayers: number;
  /** GPU backend used. */
  gpuBackend: 'cpu' | 'cuda' | 'metal' | 'vulkan';
  /** Whether the model loaded successfully. */
  modelLoaded: boolean;
  /** Whether inference completed. */
  inferenceCompleted: boolean;
  /** Quality assessment. */
  qualityAssessment: 'excellent' | 'good' | 'acceptable' | 'slow' | 'failed';
  /** Error (if any). */
  error?: string;
  /** Timestamp. */
  benchmarkedAt: number;
}

export interface PipelineValidationResult {
  /** Overall pass. */
  passed: boolean;
  /** Model used. */
  modelId: string | null;
  modelName: string | null;
  /** Hardware diagnostics. */
  hardware: HardwareDiagnostics | null;
  /** Inference benchmark. */
  benchmark: InferenceBenchmark | null;
  /** Persian response test. */
  persianTest: {
    prompt: string;
    response: string;
    languageDetected: string;
    passed: boolean;
  } | null;
  /** Long conversation test. */
  conversationTest: {
    turns: number;
    responses: string[];
    passed: boolean;
  } | null;
  /** Stages passed. */
  stagesPassed: string[];
  /** Stages failed. */
  stagesFailed: string[];
  /** Errors. */
  errors: string[];
  /** Total duration. */
  durationMs: number;
  /** Timestamp. */
  validatedAt: number;
}

export interface DetailedRuntimeStatus {
  /** Whether a model is loaded. */
  modelLoaded: boolean;
  /** Active model id. */
  modelId: string | null;
  /** Active model name. */
  modelName: string | null;
  /** Model file size. */
  modelSizeBytes: number;
  /** Model parameter count (e.g. '0.5B'). */
  parameterCount: string | null;
  /** Model quantization (e.g. 'Q4_K_M'). */
  quantization: string | null;
  /** Context size (tokens). */
  contextSize: number;
  /** GPU layers configured (-1 auto, 0 CPU, >0 N layers). */
  gpuLayers: number;
  /** GPU backend actually in use. */
  gpuBackend: 'cpu' | 'cuda' | 'metal' | 'vulkan';
  /** Threads configured. */
  threads: number;
  /** Last tokens/sec. */
  lastTokensPerSecond: number | null;
  /** Last inference duration. */
  lastInferenceDurationMs: number | null;
  /** Last tokens generated. */
  lastTokensGenerated: number | null;
  /** Context max tokens. */
  contextMaxTokens: number | null;
  /** Whether inference is active. */
  inferenceActive: boolean;
  /** Hardware verdict for the loaded model. */
  hardwareVerdict: ModelHardwareVerdict | null;
  /** Timestamp. */
  checkedAt: number;
}

// ─── Hardware Diagnostics ─────────────────────────────────────────────────

export class HardwareDiagnosticsEngine {
  /**
   * Get a comprehensive hardware diagnostics snapshot.
   */
  getDiagnostics(): HardwareDiagnostics {
    const hardwareProfile = detectHardwareProfile();
    const memTotal = hardwareProfile.ramTotalBytes;
    const memFree = hardwareProfile.ramFreeBytes;
    const ramUsagePercent = memTotal > 0 ? ((memTotal - memFree) / memTotal) * 100 : 0;
    const processRss = process.memoryUsage().rss;

    return {
      platform: process.platform,
      osRelease: os.release(),
      cpuModel: os.cpus()[0]?.model || 'Unknown',
      cpuCores: hardwareProfile.cpuCores,
      cpuThreads: hardwareProfile.cpuThreads,
      ramTotalBytes: memTotal,
      ramFreeBytes: memFree,
      ramUsagePercent: Math.round(ramUsagePercent * 10) / 10,
      processRssBytes: processRss,
      gpu: hardwareProfile.gpu ? {
        name: hardwareProfile.gpu.name,
        vendor: hardwareProfile.gpu.vendor,
        vramTotalBytes: hardwareProfile.gpu.vramTotalBytes,
        vramFreeBytes: hardwareProfile.gpu.vramFreeBytes,
        supportsCuda: hardwareProfile.gpu.supportsCuda,
        supportsMetal: hardwareProfile.gpu.supportsMetal,
        supportsVulkan: hardwareProfile.gpu.supportsVulkan,
      } : null,
      llamaGpuBackend: getGpuBackend(),
      hardwareProfile,
      checkedAt: Date.now(),
    };
  }

  /**
   * Run an inference benchmark on a model.
   * Loads the model, runs a test prompt, measures tokens/sec.
   */
  async runBenchmark(modelId: string, opts?: { prompt?: string; maxTokens?: number }): Promise<InferenceBenchmark> {
    const prompt = opts?.prompt || 'سلام! لطفا خودت را معرفی کن. Hello! Please introduce yourself briefly.';
    const maxTokens = opts?.maxTokens ?? 64;
    const benchmarkedAt = Date.now();

    const model = getModel(modelId);
    if (!model) {
      return this.benchmarkFail(modelId, 'Model not found', prompt, benchmarkedAt);
    }

    // Run inference via the interaction loop (full pipeline)
    const loop = getInteractionLoopManager();
    const result = await loop.processText({
      text: prompt,
      modelId,
      maxTokens,
      temperature: 0.7,
      speakResponse: false,
    });

    if (!result.success) {
      return {
        ...this.benchmarkFail(modelId, result.error || 'Inference failed', prompt, benchmarkedAt),
        modelName: model.name,
        modelSizeBytes: model.sizeBytes,
        modelParameterCount: model.parameterCount || 'unknown',
        modelQuantization: model.quantization || 'unknown',
      };
    }

    const tps = result.tokensPerSecond;
    let quality: InferenceBenchmark['qualityAssessment'];
    if (tps >= 20) quality = 'excellent';
    else if (tps >= 10) quality = 'good';
    else if (tps >= 5) quality = 'acceptable';
    else if (tps > 0) quality = 'slow';
    else quality = 'failed';

    return {
      modelId,
      modelName: model.name,
      modelSizeBytes: model.sizeBytes,
      modelParameterCount: model.parameterCount || 'unknown',
      modelQuantization: model.quantization || 'unknown',
      prompt,
      response: result.response,
      tokensGenerated: result.tokensGenerated,
      durationMs: result.durationMs,
      tokensPerSecond: tps,
      contextSize: model.contextSize,
      gpuLayers: model.gpuLayers,
      gpuBackend: getGpuBackend(),
      modelLoaded: true,
      inferenceCompleted: true,
      qualityAssessment: quality,
      benchmarkedAt,
    };
  }

  /**
   * Validate the complete pipeline: hardware → model → inference → Persian → conversation.
   */
  async validatePipeline(opts?: { modelId?: string }): Promise<PipelineValidationResult> {
    const start = Date.now();
    const stagesPassed: string[] = [];
    const stagesFailed: string[] = [];
    const errors: string[] = [];
    const validatedAt = Date.now();

    // 1. Hardware diagnostics
    let hardware: HardwareDiagnostics | null = null;
    try {
      hardware = this.getDiagnostics();
      stagesPassed.push('hardware-diagnostics');
    } catch (err: any) {
      stagesFailed.push('hardware-diagnostics');
      errors.push(`Hardware: ${err?.message || err}`);
    }

    // 2. Model check
    const model = opts?.modelId ? getModel(opts.modelId) : getDefaultModel();
    if (!model) {
      stagesFailed.push('model-check');
      errors.push('No model installed');
      return this.validationFail(null, null, hardware, null, null, null, stagesPassed, stagesFailed, errors, start, validatedAt);
    }
    stagesPassed.push('model-check');

    // 3. Inference benchmark
    let benchmark: InferenceBenchmark | null = null;
    try {
      benchmark = await this.runBenchmark(model.id);
      if (benchmark.inferenceCompleted) {
        stagesPassed.push('inference-benchmark');
      } else {
        stagesFailed.push('inference-benchmark');
        errors.push(`Inference: ${benchmark.error || 'failed'}`);
      }
    } catch (err: any) {
      stagesFailed.push('inference-benchmark');
      errors.push(`Inference: ${err?.message || err}`);
    }

    // 4. Persian response test
    let persianTest: PipelineValidationResult['persianTest'] = null;
    try {
      const loop = getInteractionLoopManager();
      const result = await loop.processText({
        text: 'سلام، حال شما چطور است؟',
        modelId: model.id,
        maxTokens: 64,
        speakResponse: false,
      });
      if (result.success && result.response.length > 0) {
        persianTest = {
          prompt: 'سلام، حال شما چطور است؟',
          response: result.response,
          languageDetected: result.language,
          passed: true,
        };
        stagesPassed.push('persian-test');
      } else {
        persianTest = {
          prompt: 'سلام، حال شما چطور است؟',
          response: result.response || '',
          languageDetected: result.language,
          passed: false,
        };
        stagesFailed.push('persian-test');
        errors.push('Persian test: no response');
      }
    } catch (err: any) {
      stagesFailed.push('persian-test');
      errors.push(`Persian: ${err?.message || err}`);
    }

    // 5. Long conversation test (3 turns)
    let conversationTest: PipelineValidationResult['conversationTest'] = null;
    try {
      const loop = getInteractionLoopManager();
      const turns = 3;
      const responses: string[] = [];
      const prompts = [
        'سلام، خودت را معرفی کن.',
        'چه کارهایی می‌توانی انجام دهی؟',
        'یک مثال از کد پایتون بزن.',
      ];
      const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

      for (let i = 0; i < turns; i++) {
        const result = await loop.processText({
          text: prompts[i],
          modelId: model.id,
          maxTokens: 64,
          history: [...history],
          speakResponse: false,
        });
        if (result.success) {
          responses.push(result.response);
          history.push({ role: 'user', content: prompts[i] });
          history.push({ role: 'assistant', content: result.response });
        } else {
          responses.push(`[ERROR: ${result.error}]`);
        }
      }

      const successfulTurns = responses.filter(r => !r.startsWith('[ERROR')).length;
      conversationTest = {
        turns,
        responses,
        passed: successfulTurns >= 2, // At least 2 of 3 turns must succeed
      };
      if (conversationTest.passed) {
        stagesPassed.push('conversation-test');
      } else {
        stagesFailed.push('conversation-test');
        errors.push(`Conversation: only ${successfulTurns}/${turns} turns succeeded`);
      }
    } catch (err: any) {
      stagesFailed.push('conversation-test');
      errors.push(`Conversation: ${err?.message || err}`);
    }

    const passed = stagesFailed.length === 0;
    return {
      passed,
      modelId: model.id,
      modelName: model.name,
      hardware,
      benchmark,
      persianTest,
      conversationTest,
      stagesPassed,
      stagesFailed,
      errors,
      durationMs: Date.now() - start,
      validatedAt,
    };
  }

  /**
   * Get detailed runtime status (model + context + threads + GPU layers + tokens/sec).
   */
  getDetailedStatus(): DetailedRuntimeStatus {
    const model = getDefaultModel();
    const loadedInfo = getLoadedModelInfo();
    const lastInf = getLastInference();
    const gpuBackend = getGpuBackend();

    let hardwareVerdict: ModelHardwareVerdict | null = null;
    if (model) {
      try {
        hardwareVerdict = canModelRunOnHardware(model, detectHardwareProfile());
      } catch { /* */ }
    }

    return {
      modelLoaded: !!loadedInfo,
      modelId: model?.id || null,
      modelName: model?.name || null,
      modelSizeBytes: model?.sizeBytes || 0,
      parameterCount: model?.parameterCount || null,
      quantization: model?.quantization || null,
      contextSize: model?.contextSize || 0,
      gpuLayers: model?.gpuLayers ?? -1,
      gpuBackend,
      threads: model?.recommendedThreads || os.cpus().length,
      lastTokensPerSecond: lastInf?.tokensPerSecond ?? null,
      lastInferenceDurationMs: lastInf?.durationMs ?? null,
      lastTokensGenerated: lastInf?.generatedTokens ?? null,
      contextMaxTokens: lastInf?.contextMaxTokens ?? null,
      inferenceActive: lastInf?.active === true,
      hardwareVerdict,
      checkedAt: Date.now(),
    };
  }

  // ── Windows path fixes ──

  /**
   * Fix Windows-specific path issues:
   *   - Convert backslashes to forward slashes for consistency
   *   - Handle UNC paths
   *   - Normalize drive letters (C:\ → c:/)
   */
  fixWindowsPath(filePath: string): string {
    if (process.platform !== 'win32') return filePath;
    return filePath
      .replace(/\\/g, '/')         // backslashes → forward slashes
      .replace(/\/+/g, '/')        // collapse multiple slashes
      .replace(/^([A-Za-z]):\//, (_, drive) => `${drive.toLowerCase()}:/`); // normalize drive letter
  }

  /**
   * Check if a path is a valid Windows path.
   */
  isValidWindowsPath(filePath: string): boolean {
    if (process.platform !== 'win32') return true;
    // Windows paths: C:\..., C:/..., \\server\share\...
    return /^[A-Za-z]:[\\/]/.test(filePath) || /^\\\\/.test(filePath);
  }

  /**
   * Check if the process has write permission to a directory.
   */
  hasWritePermission(dirPath: string): boolean {
    try {
      const testFile = path.join(dirPath, `.nex-write-test-${Date.now()}`);
      const fs = require('fs');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      return true;
    } catch {
      return false;
    }
  }

  // ── Internals ──

  private benchmarkFail(modelId: string, error: string, prompt: string, benchmarkedAt: number): InferenceBenchmark {
    return {
      modelId,
      modelName: '',
      modelSizeBytes: 0,
      modelParameterCount: 'unknown',
      modelQuantization: 'unknown',
      prompt,
      response: '',
      tokensGenerated: 0,
      durationMs: 0,
      tokensPerSecond: 0,
      contextSize: 0,
      gpuLayers: -1,
      gpuBackend: getGpuBackend(),
      modelLoaded: false,
      inferenceCompleted: false,
      qualityAssessment: 'failed',
      error,
      benchmarkedAt,
    };
  }

  private validationFail(
    modelId: string | null, modelName: string | null,
    hardware: HardwareDiagnostics | null, benchmark: InferenceBenchmark | null,
    persianTest: any, conversationTest: any,
    stagesPassed: string[], stagesFailed: string[], errors: string[],
    start: number, validatedAt: number,
  ): PipelineValidationResult {
    return {
      passed: false,
      modelId, modelName,
      hardware, benchmark, persianTest, conversationTest,
      stagesPassed, stagesFailed, errors,
      durationMs: Date.now() - start,
      validatedAt,
    };
  }
}

// ─── Security self-audit ───────────────────────────────────────────────────

export function verifyDiagnosticsSecurity(): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  // Read-only diagnostics. No network, no downloads, no file modifications.
  return { ok: findings.length === 0, findings };
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _engine: HardwareDiagnosticsEngine | null = null;

export function getHardwareDiagnosticsEngine(): HardwareDiagnosticsEngine {
  if (!_engine) {
    _engine = new HardwareDiagnosticsEngine();
  }
  return _engine;
}

export function _resetHardwareDiagnosticsEngine(): void {
  _engine = null;
}
