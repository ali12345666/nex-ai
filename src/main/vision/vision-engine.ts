/**
 * NEX AI — Local Vision Engine (Phase 42)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ARCHITECTURE
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │                    VisionEngine                            │
 *   │  (orchestrates: image → provider → result → callbacks)   │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  VisionProvider        LocalLlavaProvider (llama.cpp)     │
 *   │  Image loading         PNG/JPG/WebP → temp file          │
 *   │  Screenshot capture    desktopCapturer (Electron)        │
 *   │  OCR fallback          built-in (basic, no deps)         │
 *   └──────────────────────────────────────────────────────────┘
 *
 * The vision engine is LOCAL-FIRST — no cloud API calls.
 * It uses GGUF multimodal models (LLaVA, BakLLaVA, Qwen2.5-VL) via the
 * llama.cpp binary, which supports `--mmproj` for image input.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import type { VisionInput, VisionResult } from '../ai/vision-types';

// ─── Vision Provider Interface ─────────────────────────────────────────────

export interface VisionProvider {
  readonly name: string;
  readonly isLocal: boolean;
  isAvailable(): boolean;
  init(): Promise<void>;
  analyzeImage(input: VisionInput): Promise<VisionResult>;
  analyzeScreenshot(prompt?: string): Promise<VisionResult>;
  shutdown(): Promise<void>;
}

// ─── Vision Engine ─────────────────────────────────────────────────────────

export type VisionEngineState = 'idle' | 'loading' | 'analyzing' | 'error' | 'offline';

export interface VisionEngineCallbacks {
  onStateChange?: (state: VisionEngineState) => void;
  onProgress?: (message: string) => void;
  onError?: (message: string) => void;
}

export class VisionEngine {
  private provider: VisionProvider | null = null;
  private callbacks: VisionEngineCallbacks = {};
  private state: VisionEngineState = 'idle';

  setProvider(provider: VisionProvider): void { this.provider = provider; }
  getProvider(): VisionProvider | null { return this.provider; }
  get hasProvider(): boolean { return this.provider !== null; }
  get hasLocalProvider(): boolean { return !!this.provider?.isLocal && this.provider.isAvailable(); }
  setCallbacks(callbacks: VisionEngineCallbacks): void { this.callbacks = { ...this.callbacks, ...callbacks }; }
  get currentState(): VisionEngineState { return this.state; }

  private setState(state: VisionEngineState): void {
    if (this.state !== state) { this.state = state; this.callbacks.onStateChange?.(state); }
  }

  async analyzeImage(input: VisionInput): Promise<VisionResult> {
    if (!this.provider) return { success: false, error: 'No vision provider registered' };
    if (!this.provider.isAvailable()) {
      try { this.setState('loading'); await this.provider.init(); }
      catch (err: any) { this.setState('error'); return { success: false, error: `Vision provider init failed: ${err.message}` }; }
    }
    this.setState('analyzing');
    this.callbacks.onProgress?.('Analyzing image...');
    try {
      const result = await this.provider.analyzeImage(input);
      this.setState('idle');
      return result;
    } catch (err: any) {
      this.setState('error');
      return { success: false, error: err.message };
    }
  }

  async analyzeScreenshot(prompt?: string): Promise<VisionResult> {
    if (!this.provider) return { success: false, error: 'No vision provider registered' };
    if (!this.provider.isAvailable()) {
      try { this.setState('loading'); await this.provider.init(); }
      catch (err: any) { this.setState('error'); return { success: false, error: `Vision provider init failed: ${err.message}` }; }
    }
    this.setState('analyzing');
    this.callbacks.onProgress?.('Capturing and analyzing screen...');
    try {
      const result = await this.provider.analyzeScreenshot(prompt);
      this.setState('idle');
      return result;
    } catch (err: any) {
      this.setState('error');
      return { success: false, error: err.message };
    }
  }

  async dispose(): Promise<void> {
    if (this.provider) { try { await this.provider.shutdown(); } catch {} }
    this.setState('idle');
  }
}

let _engine: VisionEngine | null = null;
export function getVisionEngine(): VisionEngine {
  if (!_engine) _engine = new VisionEngine();
  return _engine;
}
export function setVisionEngine(engine: VisionEngine): void { _engine = engine; }
