/**
 * NEX AI — Local Piper TTS Provider (Phase 41)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Implements the TTSProvider interface using Piper as the local text-to-speech
 * engine. Piper is a fast, local neural TTS that runs on CPU.
 *
 * Architecture:
 *   TTSProvider (interface)
 *       ↓
 *   LocalPiperProvider (this module)
 *       ↓
 *   piper binary (shelled out via safeExecFile — no shell injection)
 *
 * The piper binary is NOT bundled — the user must install it. This provider:
 *   1. Looks for `piper` in common locations + PATH
 *   2. Accepts a user-configured path via the model registry
 *   3. Uses Piper voice models (.onnx + .onnx.json)
 *
 * If no piper binary is found, isAvailable() returns false and the
 * LocalVoiceEngine falls back to the browser TTS provider.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * USAGE
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   const provider = new LocalPiperProvider({
 *     binaryPath: '/usr/local/bin/piper',
 *     voiceModelPath: '/path/to/en_US-lessac-medium.onnx',
 *   });
 *   await provider.init();
 *   const result = await provider.synthesize('Hello world');
 *   // result.audioFilePath = '/tmp/nex-tts-12345.wav'
 *   // → play this file via the audio pipeline
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { safeExecFile } from '../security/shell';
import type { TTSResult, TTSOptions } from '../ai/voice-types';
import type { TTSProvider } from './local-voice-engine';
import { AgentLogger } from '../agent/logger';

// ─── Piper Binary Resolution ───────────────────────────────────────────────

const PIPER_BIN_NAMES = ['piper', 'piper.exe'];
const PIPER_SEARCH_PATHS = [
  '/usr/local/bin',
  '/usr/bin',
  '/opt/piper',
  path.join(os.homedir(), '.local', 'bin'),
  'C:\\Program Files\\piper',
  path.join(process.cwd(), 'bin'),
];

/**
 * Find the piper binary. Returns the absolute path or null.
 */
export function findPiperBinary(): string | null {
  const envBin = process.env.NEX_PIPER_BIN;
  if (envBin && fs.existsSync(envBin)) return envBin;
  for (const searchPath of PIPER_SEARCH_PATHS) {
    for (const binName of PIPER_BIN_NAMES) {
      const binPath = path.join(searchPath, binName);
      if (fs.existsSync(binPath)) return binPath;
    }
  }
  return null;
}

// ─── LocalPiperProvider ────────────────────────────────────────────────────

export interface PiperProviderOptions {
  /** Path to the piper binary. If null, auto-detect. */
  binaryPath?: string;
  /** Path to the voice model (.onnx). */
  voiceModelPath?: string;
  /** Path to the espeak-ng data directory (for phonemization). */
  espeakDataPath?: string;
  /** Default voice name. */
  defaultVoice?: string;
  /** Default speaking rate (0.5-2.0). */
  defaultRate?: number;
  /** Default pitch (-12 to +12). */
  defaultPitch?: number;
}

export class LocalPiperProvider implements TTSProvider {
  readonly name = 'piper';
  readonly isLocal = true;

  private opts: PiperProviderOptions;
  private binaryPath: string | null = null;
  private initialized = false;

  constructor(opts: PiperProviderOptions = {}) {
    this.opts = opts;
  }

  isAvailable(): boolean {
    return this.binaryPath !== null && (!!this.opts.voiceModelPath) && fs.existsSync(this.opts.voiceModelPath || '');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.binaryPath = this.opts.binaryPath || findPiperBinary();
    if (!this.binaryPath) {
      throw new Error('piper binary not found. Set NEX_PIPER_BIN or install piper.');
    }
    if (!this.opts.voiceModelPath) {
      throw new Error('Piper voice model path not set. Add a voice model via Model Manager.');
    }
    if (!fs.existsSync(this.opts.voiceModelPath)) {
      throw new Error(`Piper voice model not found: ${this.opts.voiceModelPath}`);
    }
    AgentLogger.info(`Piper provider initialized: binary=${this.binaryPath}, voice=${this.opts.voiceModelPath}`);
    this.initialized = true;
  }

  async synthesize(text: string, opts?: TTSOptions): Promise<TTSResult> {
    const startMs = Date.now();
    try {
      if (!this.isAvailable()) await this.init();
      if (!this.binaryPath) {
        return { success: false, error: 'Piper binary not available' };
      }

      // Generate output file path
      const tmpDir = os.tmpdir();
      const outputFile = opts?.outputFilePath || path.join(tmpDir, `nex-tts-${Date.now()}.wav`);

      // Build piper args
      // piper --model voice.onnx --output_file output.wav
      const args = [
        '--model', this.opts.voiceModelPath!,
        '--output_file', outputFile,
      ];

      // Rate (piper uses length scale: 1.0 = normal, >1 = slower, <1 = faster)
      const rate = opts?.rate ?? this.opts.defaultRate ?? 1.0;
      args.push('--length-scale', String(1.0 / rate)); // invert: faster rate = lower length scale

      // Pitch (piper uses noise scale for pitch variation)
      const pitch = opts?.pitch ?? this.opts.defaultPitch ?? 0;
      if (pitch !== 0) {
        args.push('--noise-scale', String(0.667 + (pitch / 24))); // rough mapping
      }

      // Espeak data path (for phonemization)
      if (this.opts.espeakDataPath) {
        args.push('--espeak-data', this.opts.espeakDataPath);
      }

      // Pipe text via stdin
      const result = await this.execPiperWithStdin(args, text);
      if (!result.success) {
        return {
          success: false,
          error: result.error || 'piper failed',
          durationMs: Date.now() - startMs,
        };
      }

      // Get audio duration (rough estimate from file size)
      let duration: number | undefined;
      try {
        const stat = fs.statSync(outputFile);
        // WAV at 22kHz mono 16-bit = 44100 bytes/sec
        duration = stat.size / 44100;
      } catch { /* */ }

      return {
        success: true,
        audioFilePath: outputFile,
        duration,
        sampleRate: 22050, // piper default
        durationMs: Date.now() - startMs,
      };
    } catch (err: any) {
      return { success: false, error: err.message, durationMs: Date.now() - startMs };
    }
  }

  async listVoices(): Promise<Array<{ name: string; language: string; gender?: string }>> {
    // Voice models are .onnx files. We scan the voice model directory for .onnx files.
    if (!this.opts.voiceModelPath) return [];
    const dir = path.dirname(this.opts.voiceModelPath);
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.onnx'));
      return files.map((f) => {
        // Voice name format: en_US-lessac-medium.onnx
        const match = f.match(/^([a-z]{2})_([A-Z]{2})-([a-z]+)-([a-z]+)\.onnx$/);
        if (match) {
          return {
            name: f.replace('.onnx', ''),
            language: `${match[1]}-${match[2]}`,
            gender: match[4] === 'male' ? 'male' : (match[4] === 'female' ? 'female' : undefined),
          };
        }
        return { name: f.replace('.onnx', ''), language: 'unknown' };
      });
    } catch {
      return [];
    }
  }

  stop(): void {
    // Piper runs as a subprocess — we can't easily kill it mid-synthesis.
    // The subprocess will complete and the result will be discarded by the engine.
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  /**
   * Execute piper with text piped via stdin.
   * piper reads text from stdin when no --text-file is provided.
   */
  private async execPiperWithStdin(args: string[], text: string): Promise<{ success: boolean; error?: string }> {
    // safeExecFile doesn't support stdin piping — we use a temp file instead
    const tmpDir = os.tmpdir();
    const textFile = path.join(tmpDir, `nex-tts-text-${Date.now()}.txt`);
    try {
      fs.writeFileSync(textFile, text, 'utf-8');
      const result = await safeExecFile(this.binaryPath!, [...args, '--text-file', textFile], {
        timeout: 30000,
        maxBuffer: 1 * 1024 * 1024,
      });
      if (!result.success) {
        return { success: false, error: result.error || result.stderr || 'piper failed' };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      try { fs.unlinkSync(textFile); } catch { /* */ }
    }
  }
}
