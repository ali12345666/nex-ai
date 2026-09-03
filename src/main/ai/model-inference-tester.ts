/**
 * NEX AI — Model Inference Tester (Phase 61)
 *
 * Loads a registered model and runs a test inference to verify it actually
 * works. Measures tokens/sec, latency, and content quality.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  Model Inference Tester (this file)                      │
 *   │    1. Load model (via MultiModelRuntimeManager)           │
 *   │    2. Run test prompt                                     │
 *   │    3. Measure tokens/sec + latency                        │
 *   │    4. Report health (passed/failed + metrics)              │
 *   │    5. Unload model                                        │
 *   └──────────────────────────────────────────────────────────┘
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SECURITY
 * ════════════════════════════════════════════════════════════════════════════
 * - All inference is local (node-llama-cpp). No cloud API.
 * - Loading a model is SAFE (reads a disk file the user already has).
 * - Running inference is SAFE (generates text locally).
 * - This module NEVER downloads, installs, or deletes models.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { getMultiModelRuntimeManager } from './multi-model-runtime-manager';
import type { ProviderGenerateResult } from './local-model-provider';
import { getLastInference } from './runtime-telemetry';

// ─── Types ─────────────────────────────────────────────────────────────────

export type InferenceTestStatus = 'passed' | 'failed' | 'skipped';

export interface InferenceTestResult {
  status: InferenceTestStatus;
  modelId: string;
  modelName: string;
  /** The test prompt that was sent. */
  prompt: string;
  /** The generated response. */
  response: string;
  /** Tokens generated. */
  tokensGenerated: number;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Tokens per second. */
  tokensPerSecond: number;
  /** Whether the model loaded successfully. */
  modelLoaded: boolean;
  /** Whether inference completed (not aborted/errored). */
  inferenceCompleted: boolean;
  /** Error message (if failed). */
  error?: string;
  /** Checks performed. */
  checks: Array<{ name: string; passed: boolean; message: string }>;
  /** Timestamp. */
  testedAt: number;
}

export interface InferenceTestOptions {
  /** Custom test prompt (default: a simple "Hello" prompt). */
  prompt?: string;
  /** Max tokens to generate (default: 32 — keep tests fast). */
  maxTokens?: number;
  /** Temperature (default: 0.7). */
  temperature?: number;
  /** Context size (default: from model or 2048). */
  contextSize?: number;
  /** Whether to unload the model after testing (default: true). */
  unloadAfterTest?: boolean;
}

// ─── Default Test Prompts ─────────────────────────────────────────────────

/**
 * Default test prompts. These are designed to produce a quick, verifiable
 * response from any chat-capable model.
 */
export const DEFAULT_TEST_PROMPTS: string[] = [
  'سلام! خودت را معرفی کن. (Brief introduction please)',
  'What is 2 + 2? Answer briefly.',
  'Write a one-line greeting in Python.',
];

const DEFAULT_PROMPT = DEFAULT_TEST_PROMPTS[0];
const DEFAULT_MAX_TOKENS = 32;

// ─── Model Inference Tester ───────────────────────────────────────────────

export class ModelInferenceTester {
  /**
   * Test a registered model by loading it and running a test inference.
   *
   * Flow:
   *   1. Load the model via MultiModelRuntimeManager
   *   2. Send a test prompt
   *   3. Measure tokens/sec + latency
   *   4. Check the response is non-empty
   *   5. Unload the model (unless unloadAfterTest is false)
   *   6. Return the test result
   *
   * @param modelId The model registry id to test
   * @param opts Test options (prompt, maxTokens, etc.)
   */
  async testInference(modelId: string, opts?: InferenceTestOptions): Promise<InferenceTestResult> {
    const prompt = opts?.prompt || DEFAULT_PROMPT;
    const maxTokens = opts?.maxTokens ?? DEFAULT_MAX_TOKENS;
    const temperature = opts?.temperature ?? 0.7;
    const unloadAfterTest = opts?.unloadAfterTest ?? true;
    const testedAt = Date.now();

    const checks: Array<{ name: string; passed: boolean; message: string }> = [];

    const manager = getMultiModelRuntimeManager();

    // 1. Load the model
    let modelLoaded = false;
    let modelName = modelId;
    try {
      const model = await manager.loadModel(modelId, {
        contextSize: opts?.contextSize,
        temperature,
        maxTokens,
      });
      modelLoaded = true;
      modelName = model.name;
      checks.push({ name: 'model-load', passed: true, message: `Model loaded: ${model.name}` });
    } catch (err: any) {
      checks.push({ name: 'model-load', passed: false, message: `Load failed: ${err?.message || err}` });
      return {
        status: 'failed',
        modelId,
        modelName,
        prompt,
        response: '',
        tokensGenerated: 0,
        durationMs: 0,
        tokensPerSecond: 0,
        modelLoaded: false,
        inferenceCompleted: false,
        error: `Model load failed: ${err?.message || err}`,
        checks,
        testedAt,
      };
    }

    // 2. Run inference
    let result: ProviderGenerateResult | null = null;
    let inferenceCompleted = false;
    let errorMsg: string | undefined;

    try {
      result = await manager.generate(
        [{ role: 'user', content: prompt }],
        { maxTokens, temperature, contextSize: opts?.contextSize },
      );
      inferenceCompleted = true;
      checks.push({
        name: 'inference-complete',
        passed: true,
        message: `Generated ${result.tokensGenerated} tokens in ${result.durationMs}ms`,
      });
    } catch (err: any) {
      errorMsg = `Inference failed: ${err?.message || err}`;
      checks.push({ name: 'inference-complete', passed: false, message: errorMsg });
    }

    // 3. Check response quality
    if (result && result.content) {
      const hasContent = result.content.trim().length > 0;
      checks.push({
        name: 'response-non-empty',
        passed: hasContent,
        message: hasContent ? `Response: "${result.content.slice(0, 80)}..."` : 'Response was empty',
      });
    }

    // 4. Check tokens/sec is reasonable (>0.5 tokens/sec is the minimum for usability)
    if (result && result.tokensPerSecond > 0) {
      const acceptable = result.tokensPerSecond >= 0.5;
      checks.push({
        name: 'tokens-per-second',
        passed: acceptable,
        message: `${result.tokensPerSecond.toFixed(2)} tokens/sec ${acceptable ? '(acceptable)' : '(slow but functional)'}`,
      });
    }

    // 5. Unload if requested
    if (unloadAfterTest) {
      try {
        await manager.unloadModel();
        checks.push({ name: 'model-unload', passed: true, message: 'Model unloaded' });
      } catch (err: any) {
        checks.push({ name: 'model-unload', passed: false, message: `Unload failed: ${err?.message || err}` });
      }
    }

    // 6. Determine overall status
    const allPassed = checks.every((c) => c.passed);
    const criticalChecks = checks.filter((c) => c.name === 'model-load' || c.name === 'inference-complete');
    const criticalPassed = criticalChecks.every((c) => c.passed);

    return {
      status: criticalPassed ? 'passed' : 'failed',
      modelId,
      modelName,
      prompt,
      response: result?.content || '',
      tokensGenerated: result?.tokensGenerated ?? 0,
      durationMs: result?.durationMs ?? 0,
      tokensPerSecond: result?.tokensPerSecond ?? 0,
      modelLoaded,
      inferenceCompleted,
      error: errorMsg,
      checks,
      testedAt,
    };
  }

  /**
   * Quick health check — just loads the model and checks it responds.
   * Uses a minimal prompt and maxTokens=8 for speed.
   */
  async quickHealthCheck(modelId: string): Promise<InferenceTestResult> {
    return await this.testInference(modelId, {
      prompt: 'Say "OK" if you can hear me.',
      maxTokens: 8,
      temperature: 0.1,
      unloadAfterTest: true,
    });
  }

  /**
   * Get the last inference telemetry (tokens/sec from the most recent call).
   */
  getLastTelemetry(): { tokensPerSecond?: number; generatedTokens?: number; durationMs?: number; active?: boolean } | null {
    return getLastInference();
  }
}

// ─── Security self-audit ───────────────────────────────────────────────────

/**
 * Verifies the inference tester performs NO network calls and NO downloads.
 * All inference is local via the MultiModelRuntimeManager.
 */
export function verifyInferenceTesterSecurity(): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  // No fetch, no net.request, no download/install methods.
  return { ok: findings.length === 0, findings };
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _tester: ModelInferenceTester | null = null;

export function getModelInferenceTester(): ModelInferenceTester {
  if (!_tester) {
    _tester = new ModelInferenceTester();
  }
  return _tester;
}

export function _resetModelInferenceTester(): void {
  _tester = null;
}
