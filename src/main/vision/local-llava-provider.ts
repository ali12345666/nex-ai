/**
 * NEX AI — Local LLaVA Vision Provider (Phase 42)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Implements the VisionProvider interface using llama.cpp's multimodal
 * support (LLaVA, BakLLaVA, Qwen2.5-VL).
 *
 * Architecture:
 *   VisionProvider (interface)
 *       ↓
 *   LocalLlavaProvider (this module)
 *       ↓
 *   llama.cpp binary (shelled out via safeExecFile — no shell injection)
 *
 * The llama.cpp binary supports vision via:
 *   llama-cli -m model.gguf --mmproj mmproj.gguf -i image.png -p "prompt"
 *
 * This provider:
 *   1. Looks for `llama-cli` / `main` (llama.cpp's binary)
 *   2. Accepts a vision model GGUF + mmproj file
 *   3. Supports image analysis, OCR, screenshot understanding
 *
 * If no llama.cpp binary is found, isAvailable() returns false.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { safeExecFile } from '../security/shell';
import type { VisionInput, VisionResult } from '../ai/vision-types';
import type { VisionProvider } from './vision-engine';
import { AgentLogger } from '../agent/logger';

// ─── llama.cpp Binary Resolution ───────────────────────────────────────────

const LLAMA_BIN_NAMES = ['llama-cli', 'llama', 'main'];
const LLAMA_SEARCH_PATHS = [
  '/usr/local/bin',
  '/usr/bin',
  '/opt/llama.cpp',
  path.join(os.homedir(), '.local', 'bin'),
  'C:\\Program Files\\llama.cpp',
  path.join(os.homedir(), 'llama.cpp'),
  path.join(process.cwd(), 'bin'),
];

export function findLlamaBinary(): string | null {
  const envBin = process.env.NEX_LLAMA_BIN;
  if (envBin && fs.existsSync(envBin)) return envBin;
  for (const searchPath of LLAMA_SEARCH_PATHS) {
    for (const binName of LLAMA_BIN_NAMES) {
      const binPath = path.join(searchPath, binName + (process.platform === 'win32' ? '.exe' : ''));
      if (fs.existsSync(binPath)) return binPath;
    }
  }
  return null;
}

// ─── LocalLlavaProvider ────────────────────────────────────────────────────

export interface LlavaProviderOptions {
  binaryPath?: string;
  modelPath?: string;
  mmprojPath?: string;
  /** Default temperature for generation (0.0-1.0). */
  temperature?: number;
  /** Max tokens to generate. */
  maxTokens?: number;
}

export class LocalLlavaProvider implements VisionProvider {
  readonly name = 'llava';
  readonly isLocal = true;

  private opts: LlavaProviderOptions;
  private binaryPath: string | null = null;
  private initialized = false;

  constructor(opts: LlavaProviderOptions = {}) {
    this.opts = opts;
  }

  isAvailable(): boolean {
    return this.binaryPath !== null &&
      (!!this.opts.modelPath) &&
      fs.existsSync(this.opts.modelPath || '') &&
      (!this.opts.mmprojPath || fs.existsSync(this.opts.mmprojPath));
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.binaryPath = this.opts.binaryPath || findLlamaBinary();
    if (!this.binaryPath) {
      throw new Error('llama.cpp binary not found. Set NEX_LLAMA_BIN or install llama.cpp.');
    }
    if (!this.opts.modelPath) {
      throw new Error('Vision model path not set. Add a vision model via Model Manager.');
    }
    if (!fs.existsSync(this.opts.modelPath)) {
      throw new Error(`Vision model not found: ${this.opts.modelPath}`);
    }
    AgentLogger.info(`Llava provider initialized: binary=${this.binaryPath}, model=${this.opts.modelPath}`);
    this.initialized = true;
  }

  async analyzeImage(input: VisionInput): Promise<VisionResult> {
    const startMs = Date.now();
    try {
      if (!this.isAvailable()) await this.init();
      if (!this.binaryPath) {
        return { success: false, error: 'llama.cpp binary not available' };
      }

      // Resolve image to a file path
      const imagePath = await this.resolveImagePath(input);
      if (!imagePath) {
        return { success: false, error: 'No image provided (need imagePath, imageBase64, or imageUrl)' };
      }

      // Build prompt
      const prompt = input.question || input.prompt || 'Describe this image in detail.';

      // Run llama.cpp with vision
      const args = [
        '-m', this.opts.modelPath!,
        '-i', // interactive image mode
        '--image', imagePath,
        '-p', prompt,
        '--temp', String(this.opts.temperature ?? 0.3),
        '-n', String(this.opts.maxTokens ?? 512),
        '--no-warmup',
        '--simple',
      ];

      // Add mmproj if available
      if (this.opts.mmprojPath && fs.existsSync(this.opts.mmprojPath)) {
        args.unshift('--mmproj', this.opts.mmprojPath);
      }

      const result = await safeExecFile(this.binaryPath, args, {
        timeout: 60000,
        maxBuffer: 5 * 1024 * 1024,
      });

      if (!result.success) {
        return {
          success: false,
          error: result.error || `llama.cpp exited with code ${result.exitCode}`,
          durationMs: Date.now() - startMs,
        };
      }

      const text = result.stdout.trim();
      return {
        success: true,
        text,
        durationMs: Date.now() - startMs,
      };
    } catch (err: any) {
      return { success: false, error: err.message, durationMs: Date.now() - startMs };
    }
  }

  async analyzeScreenshot(prompt?: string): Promise<VisionResult> {
    // Screenshot capture requires Electron's desktopCapturer — handled by the
    // IPC layer (main.ts). Here we just expect an imagePath to be provided
    // by the caller (the IPC handler captures the screenshot and saves it).
    return {
      success: false,
      error: 'Screenshot capture must be initiated via the IPC handler (main.ts desktopCapturer)',
    };
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private async resolveImagePath(input: VisionInput): Promise<string | null> {
    // Direct path
    if (input.imagePath && fs.existsSync(input.imagePath)) {
      return input.imagePath;
    }

    // Base64-encoded image
    if (input.imageBase64) {
      const tmpDir = os.tmpdir();
      const tmpFile = path.join(tmpDir, `nex-vision-${Date.now()}.png`);
      try {
        const buffer = Buffer.from(input.imageBase64, 'base64');
        fs.writeFileSync(tmpFile, buffer);
        return tmpFile;
      } catch {
        return null;
      }
    }

    // Image URL — download to temp file
    if (input.imageUrl) {
      // For local-only operation, we only support file:// URLs or local paths.
      // Remote URLs require network access — not supported offline.
      if (input.imageUrl.startsWith('file://')) {
        const localPath = input.imageUrl.replace('file://', '');
        if (fs.existsSync(localPath)) return localPath;
      }
      return null;
    }

    return null;
  }
}
