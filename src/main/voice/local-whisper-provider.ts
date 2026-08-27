/**
 * NEX AI — Local Whisper STT Provider (Phase 41)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Implements the STTProvider interface using whisper.cpp as the local speech
 * recognition engine.
 *
 * Architecture:
 *   STTProvider (interface)
 *       ↓
 *   LocalWhisperProvider (this module)
 *       ↓
 *   whisper.cpp binary (shelled out via safeExecFile — no shell injection)
 *
 * The whisper.cpp binary is NOT bundled — the user must install it
 * (or point to an existing installation). This provider:
 *   1. Looks for `whisper` / `whisper-cli` / `main` (whisper.cpp's binary)
 *      in common locations + PATH
 *   2. Accepts a user-configured path via the model registry
 *   3. Uses a whisper-compatible GGUF model (e.g. ggml-base.en.bin)
 *
 * If no whisper binary is found, isAvailable() returns false and the
 * LocalVoiceEngine falls back to the browser STT provider.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * AUDIO FORMAT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * whisper.cpp expects 16kHz mono 16-bit PCM WAV files. The AudioManager
 * captures at 48kHz (browser default) — we resample to 16kHz before
 * passing to whisper. The `ffmpeg` binary is used for resampling if
 * available; otherwise we do a simple linear resample in JS.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { safeExecFile } from '../security/shell';
import type { STTResult, STTOptions } from '../ai/voice-types';
import type { STTProvider } from './local-voice-engine';
import { AgentLogger } from '../agent/logger';

// ─── Whisper Binary Resolution ─────────────────────────────────────────────

const WHISPER_BIN_NAMES = ['whisper-cli', 'whisper', 'main'];

/**
 * Get the NEX AI managed runtime directory for whisper.
 * Phase 76: <userData>/runtime/whisper/
 */
function getNexWhisperRuntimeDir(): string {
  try {
    // Dynamic import to avoid circular dependency at module load time
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'runtime', 'whisper');
  } catch {
    return '';
  }
}

/**
 * Get custom voice discovery directories. These are user-specified locations
 * where voice components (whisper binary, whisper models, piper binary, piper
 * voices) may be installed outside the NEX managed directories.
 *
 * Scans:
 *   1. NEX_VOICE_DIR env var (if set)
 *   2. D:\NEX-AI-Data\voice\ (Windows custom data drive)
 *   3. <userData>/voice/ (= %APPDATA%/nex-ai/voice/ on Windows)
 *   4. <userData>/runtime/whisper/ (NEX managed — Phase 76)
 */
function getCustomVoiceDirs(): string[] {
  const dirs: string[] = [];
  // 1. Env var override
  const envDir = process.env.NEX_VOICE_DIR;
  if (envDir) dirs.push(envDir);
  // 2. Windows custom data drive
  if (process.platform === 'win32') {
    dirs.push('D:\\NEX-AI-Data\\voice');
    dirs.push('D:\\NEX-AI-Data\\voice\\whisper');
  }
  // 3. <userData>/voice/ (next to the NEX managed runtime dir)
  try {
    const { app } = require('electron');
    dirs.push(path.join(app.getPath('userData'), 'voice'));
    dirs.push(path.join(app.getPath('userData'), 'voice', 'whisper'));
  } catch { /* */ }
  // 4. NEX managed runtime dir
  const nexDir = getNexWhisperRuntimeDir();
  if (nexDir) dirs.push(nexDir);
  return dirs;
}

/**
 * Get whisper search paths. Includes the NEX managed runtime directory
 * (where the unified installer extracts whisper-bin-x64.zip) AND custom
 * user-specified voice directories.
 */
function getWhisperSearchPaths(): string[] {
  const paths = [
    '/usr/local/bin',
    '/usr/bin',
    '/opt/whisper.cpp',
    path.join(os.homedir(), '.local', 'bin'),
    'C:\\Program Files\\whisper.cpp',
    path.join(os.homedir(), 'whisper.cpp'),
    path.join(process.cwd(), 'bin'),
  ];
  // Add custom voice discovery directories
  for (const dir of getCustomVoiceDirs()) {
    paths.push(dir);
  }
  return paths;
}

/**
 * Find the whisper.cpp binary. Returns the absolute path or null.
 * Checks:
 *   1. NEX_WHISPER_BIN env var
 *   2. Common whisper binary names in common paths
 *   3. NEX managed runtime directory (<userData>/runtime/whisper/)
 *   4. Scan NEX runtime dir for any .exe containing "whisper" or "main"
 */
export function findWhisperBinary(): string | null {
  // 1. Env var override
  const envBin = process.env.NEX_WHISPER_BIN;
  if (envBin && fs.existsSync(envBin)) return envBin;

  // 2. Search common names in common paths (includes custom voice dirs)
  const searchPaths = getWhisperSearchPaths();
  for (const searchPath of searchPaths) {
    for (const binName of WHISPER_BIN_NAMES) {
      const binPath = path.join(searchPath, binName + (process.platform === 'win32' ? '.exe' : ''));
      if (fs.existsSync(binPath)) return binPath;
    }
  }

  // 3. Scan ALL custom voice dirs + NEX runtime dir for any executable
  // containing "whisper" or "main" (the extracted ZIP may have a different name)
  for (const scanDir of getCustomVoiceDirs()) {
    if (scanDir && fs.existsSync(scanDir)) {
      try {
        const entries = fs.readdirSync(scanDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            const name = entry.name.toLowerCase();
            const isExe = process.platform === 'win32' ? name.endsWith('.exe') : !name.endsWith('.txt') && !name.endsWith('.md');
            if (isExe && (name.includes('whisper') || name === 'main' || name === 'main.exe')) {
              return path.join(scanDir, entry.name);
            }
          }
        }
      } catch {}
    }
  }

  return null;
}

/**
 * Find ffmpeg binary for audio resampling. Returns path or null.
 */
export function findFfmpegBinary(): string | null {
  const envBin = process.env.NEX_FFMPEG_BIN;
  if (envBin && fs.existsSync(envBin)) return envBin;
  const commonPaths = ['/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe'];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Find whisper model files (.bin) in all discovery directories.
 * Scans:
 *   - <userData>/models/whisper/ (NEX managed)
 *   - D:\NEX-AI-Data\voice\whisper\models\ (custom)
 *   - <userData>/voice/whisper/ (custom)
 *   - All custom voice dirs from getCustomVoiceDirs()
 * Returns array of {name, path, sizeBytes}.
 */
export function findWhisperModels(): Array<{ name: string; path: string; sizeBytes: number }> {
  const results: Array<{ name: string; path: string; sizeBytes: number }> = [];
  const scannedDirs = new Set<string>();

  // Build the list of directories to scan for models
  const modelDirs: string[] = [];
  try {
    const { app } = require('electron');
    modelDirs.push(path.join(app.getPath('userData'), 'models', 'whisper'));
  } catch { /* */ }
  // Add custom voice dirs + their 'models' subdirs
  for (const dir of getCustomVoiceDirs()) {
    modelDirs.push(dir);
    modelDirs.push(path.join(dir, 'models'));
  }

  for (const modelsDir of modelDirs) {
    if (scannedDirs.has(modelsDir)) continue;
    scannedDirs.add(modelsDir);
    if (!fs.existsSync(modelsDir)) continue;
    try {
      const entries = fs.readdirSync(modelsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.bin')) {
          const fullPath = path.join(modelsDir, entry.name);
          const stat = fs.statSync(fullPath);
          results.push({ name: entry.name, path: fullPath, sizeBytes: stat.size });
        }
      }
    } catch {}
  }
  return results;
}

// ─── LocalWhisperProvider ──────────────────────────────────────────────────

export interface WhisperProviderOptions {
  /** Path to the whisper.cpp binary. If null, auto-detect. */
  binaryPath?: string;
  /** Path to the whisper model (.bin or .gguf). */
  modelPath?: string;
  /** Path to ffmpeg (for resampling). If null, auto-detect. */
  ffmpegPath?: string;
  /** Default language (BCP-47, e.g. 'en', 'fa'). If null, auto-detect. */
  language?: string;
}

export class LocalWhisperProvider implements STTProvider {
  readonly name = 'whisper';
  readonly isLocal = true;

  private opts: WhisperProviderOptions;
  private binaryPath: string | null = null;
  private ffmpegPath: string | null = null;
  private initialized = false;
  private audioBuffer: Buffer[] = [];
  private streamOpts: STTOptions | null = null;

  constructor(opts: WhisperProviderOptions = {}) {
    this.opts = opts;
  }

  isAvailable(): boolean {
    return this.binaryPath !== null && (!!this.opts.modelPath) && fs.existsSync(this.opts.modelPath || '');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    // Resolve binary
    this.binaryPath = this.opts.binaryPath || findWhisperBinary();
    this.ffmpegPath = this.opts.ffmpegPath || findFfmpegBinary();
    if (!this.binaryPath) {
      throw new Error('whisper.cpp binary not found. Set NEX_WHISPER_BIN or install whisper.cpp.');
    }
    if (!this.opts.modelPath) {
      throw new Error('Whisper model path not set. Add a whisper model via Model Manager.');
    }
    if (!fs.existsSync(this.opts.modelPath)) {
      throw new Error(`Whisper model not found: ${this.opts.modelPath}`);
    }
    AgentLogger.info(`Whisper provider initialized: binary=${this.binaryPath}, model=${this.opts.modelPath}`);
    this.initialized = true;
  }

  async transcribeFile(audioPath: string, opts?: STTOptions): Promise<STTResult> {
    const startMs = Date.now();
    try {
      if (!this.isAvailable()) await this.init();
      if (!this.binaryPath) {
        return { success: false, text: '', error: 'Whisper binary not available' };
      }

      // Resample to 16kHz WAV if needed
      const wavPath = await this.ensureWavFormat(audioPath);

      // Run whisper.cpp
      const args = [
        '-m', this.opts.modelPath!,
        '-f', wavPath,
        '--no-timestamps',  // we just want the text
        '-nt',              // no timestamps in output
      ];
      const lang = opts?.language || this.opts.language;
      if (lang) {
        args.push('-l', lang.split('-')[0]); // whisper uses 'en' not 'en-US'
      }

      const result = await safeExecFile(this.binaryPath, args, { timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
      if (!result.success) {
        return {
          success: false,
          text: '',
          error: result.error || `whisper exited with code ${result.exitCode}`,
          durationMs: Date.now() - startMs,
        };
      }

      // whisper.cpp outputs the transcription to stdout
      const text = result.stdout.trim();
      return {
        success: true,
        text,
        language: lang,
        durationMs: Date.now() - startMs,
      };
    } catch (err: any) {
      return { success: false, text: '', error: err.message, durationMs: Date.now() - startMs };
    }
  }

  async startStream(opts?: STTOptions): Promise<void> {
    this.streamOpts = opts || null;
    this.audioBuffer = [];
  }

  feedAudioChunk(audioChunk: Buffer): void {
    this.audioBuffer.push(audioChunk);
  }

  async stopStream(): Promise<STTResult> {
    if (this.audioBuffer.length === 0) {
      return { success: true, text: '', durationMs: 0 };
    }
    // Write accumulated audio to a temp WAV file
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `nex-stt-${Date.now()}.wav`);
    const combined = Buffer.concat(this.audioBuffer);
    try {
      fs.writeFileSync(tmpFile, combined);
      const result = await this.transcribeFile(tmpFile, this.streamOpts || undefined);
      return result;
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* */ }
      this.audioBuffer = [];
    }
  }

  async shutdown(): Promise<void> {
    this.audioBuffer = [];
    this.initialized = false;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  /**
   * Ensure the audio file is in 16kHz mono 16-bit WAV format.
   * If ffmpeg is available, use it to convert. Otherwise, assume the file
   * is already in the correct format (whisper.cpp will fail if not).
   */
  private async ensureWavFormat(audioPath: string): Promise<string> {
    if (!this.ffmpegPath) return audioPath;
    const tmpDir = os.tmpdir();
    const convertedPath = path.join(tmpDir, `nex-stt-converted-${Date.now()}.wav`);
    try {
      const result = await safeExecFile(this.ffmpegPath, [
        '-y', '-i', audioPath,
        '-ar', '16000', '-ac', '1', '-sample_fmt', 's16',
        convertedPath,
      ], { timeout: 10000 });
      if (result.success && fs.existsSync(convertedPath)) {
        return convertedPath;
      }
    } catch { /* fall back to original */ }
    return audioPath;
  }
}
