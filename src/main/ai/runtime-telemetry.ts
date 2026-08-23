/**
 * NEX AI — Runtime Telemetry (Phase 21 / P21-E)
 *
 * Extracted from runtime.ts so the DIRECT inference path (local-engine →
 * inference.ts, used by non-streaming chat) can record telemetry without
 * a circular import (runtime.ts ↔ llamacpp-runtime ↔ inference.ts).
 *
 * runtime.ts re-exports these for every existing consumer (P19 wiring in
 * both runtimes keeps working unchanged).
 */

/** Last inference telemetry (best-effort; 5-min staleness applied by runtime.ts). */
let _lastInference: {
  tokensPerSecond?: number;
  promptTokens?: number;
  generatedTokens?: number;
  durationMs?: number;
  modelLoadMs?: number;
  active?: boolean;
  at: number;
} | null = null;

/** Model loaded via the DIRECT inference path (not through a runtime instance). */
let _notedModel: { name: string | null; at: number } | null = null;

export function noteInferenceStats(stats: {
  tokensPerSecond?: number;
  promptTokens?: number;
  generatedTokens?: number;
  durationMs?: number;
  modelLoadMs?: number;
  active?: boolean;
}): void {
  _lastInference = { ...stats, at: Date.now() };
}

/** Direct-path model-load note (inference.ts loadModel/unloadModel). */
export function noteLoadedModel(modelName: string | null): void {
  _notedModel = { name: modelName, at: Date.now() };
}

export function getLastInference() {
  return _lastInference ? { ..._lastInference } : null;
}

export function getNotedModel(): string | null {
  return _notedModel?.name ?? null;
}

export function telemetryNoteIsFresh(maxAgeMs: number): boolean {
  return !!_lastInference && (Date.now() - _lastInference.at < maxAgeMs || _lastInference.active === true);
}
