/**
 * NEX AI — Unified Component Installer (Phase 75)
 *
 * ONE installer for ALL downloadable AI components. Delegates to
 * ModelDownloadManager — no separate download logic.
 *
 * Architecture:
 *
 *   UnifiedComponentCatalog (multi-source metadata)
 *         │
 *         ▼
 *   UnifiedComponentInstaller  ← THIS FILE
 *         │
 *         ├── PermissionGate (user confirmation)
 *         ├── ModelDownloadManager (multi-source download + .part resume)
 *         ├── Integrity Validator (GGUF magic OR file size + SHA-256)
 *         ├── Binary Extractor (for .zip archives — whisper/piper binaries)
 *         └── Component Registry (records installed components)
 *
 * Replaces the old ComponentInstaller which used SecureDownloader directly.
 *
 * Supported component types:
 *   - llm (GGUF models — validated with GGUF magic)
 *   - voice-stt (whisper .bin models — validated with size + hash)
 *   - voice-tts (piper .onnx models — validated with size + hash)
 *   - voice-stt-binary (whisper.cpp .zip — extracted after download)
 *   - voice-tts-binary (piper .zip — extracted after download)
 *   - vision (GGUF models — validated with GGUF magic)
 *   - embedding (GGUF models — validated with GGUF magic)
 */
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import {
  getModelDownloadManager,
  getModelsDir,
  getDownloadSandboxDir,
  validateGgufIntegrity,
  validateFileIntegrity,
  type ModelDownloadProgress,
  type DownloadState,
} from '../ai/model-download-manager';
import {
  UNIFIED_COMPONENT_CATALOG,
  getUnifiedComponent,
  type UnifiedComponent,
} from './unified-component-catalog';

// ─── Types ─────────────────────────────────────────────────────────────────────────

export interface ComponentInstallProgress {
  componentId: string;
  componentName: string;
  state: DownloadState;
  receivedBytes: number;
  totalBytes: number;
  percentage: number | null;
  currentSource: string | null;
  attempt: number;
  maxAttempts: number;
  stageMessage: string;
  stageMessageFa: string;
  failure?: any;
}

export interface ComponentInstallResult {
  success: boolean;
  componentId: string;
  componentName: string;
  installedPath?: string;
  hash?: string;
  bytesDownloaded: number;
  durationMs: number;
  state: DownloadState;
  failure?: any;
  error?: string;
}

// ─── Component Storage Directory ────────────────────────────────────────────────────

/**
 * Get the base directory for component installation.
 * All components are installed under <userData>/models/ or <userData>/runtime/.
 */
export function getComponentBaseDir(): string {
  const dir = path.join(app.getPath('userData'));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get the installation directory for a component.
 * Combines userData + component.installationPath.
 */
export function getComponentInstallDir(component: UnifiedComponent): string {
  const dir = path.join(getComponentBaseDir(), component.installationPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get the final installed file path for a component.
 */
export function getComponentInstallPath(component: UnifiedComponent): string {
  return path.join(getComponentInstallDir(component), component.filename);
}

// ─── Binary Extraction (for .zip files) ─────────────────────────────────────────────

/**
 * Extract a .zip file to a directory.
 * Uses Node's built-in zlib + a simple ZIP parser (no external dependency).
 * For production, this should use a proper ZIP library, but for now we
 * delegate to the OS's unzip command or PowerShell on Windows.
 */
async function extractZip(zipPath: string, destDir: string): Promise<void> {
  console.log(`[COMPONENT_INSTALL] Extracting ${zipPath} → ${destDir}`);

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Use platform-appropriate extraction
  const { execFile } = await import('child_process');
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    let cmd: string;
    let args: string[];

    if (platform === 'win32') {
      // Windows: use PowerShell's Expand-Archive
      cmd = 'powershell.exe';
      args = [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`,
      ];
    } else if (platform === 'darwin') {
      // macOS: use built-in unzip
      cmd = 'unzip';
      args = ['-o', zipPath, '-d', destDir];
    } else {
      // Linux: use unzip
      cmd = 'unzip';
      args = ['-o', zipPath, '-d', destDir];
    }

    execFile(cmd, args, { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        console.error(`[COMPONENT_INSTALL] Extract failed: ${err.message}`);
        console.error(`  stderr: ${stderr}`);
        reject(new Error(`Extract failed: ${err.message}`));
      } else {
        console.log(`[COMPONENT_INSTALL] Extracted successfully`);
        resolve();
      }
    });
  });
}

// ─── Unified Component Installer ────────────────────────────────────────────────────

type ProgressCallback = (progress: ComponentInstallProgress) => void;

class UnifiedComponentInstallerClass {
  private progressCallback: ProgressCallback | null = null;
  private activeInstalls = new Map<string, { abortController: { aborted: boolean } }>();

  setProgressCallback(cb: ProgressCallback): void {
    this.progressCallback = cb;
  }

  private emitProgress(component: UnifiedComponent, state: DownloadState, extra?: Partial<ComponentInstallProgress>): void {
    if (!this.progressCallback) return;
    this.progressCallback({
      componentId: component.id,
      componentName: component.name,
      state,
      receivedBytes: 0,
      totalBytes: 0,
      percentage: null,
      currentSource: null,
      attempt: 0,
      maxAttempts: 5,
      stageMessage: this.getStateMessage(state),
      stageMessageFa: this.getStateMessageFa(state),
      ...extra,
    });
  }

  private getStateMessage(state: DownloadState): string {
    const messages: Record<DownloadState, string> = {
      'queued': 'Queued',
      'resolving': 'Resolving source URL...',
      'connecting': 'Connecting to server...',
      'downloading': 'Downloading...',
      'retrying': 'Retrying...',
      'verifying': 'Verifying integrity...',
      'installing': 'Installing component...',
      'completed': 'Installation complete',
      'download-failed': 'Installation failed',
      'cancelled': 'Installation cancelled',
      'permission-denied': 'Permission denied',
    };
    return messages[state] || state;
  }

  private getStateMessageFa(state: DownloadState): string {
    const messages: Record<DownloadState, string> = {
      'queued': 'در صف',
      'resolving': 'در حال حل منبع...',
      'connecting': 'در حال اتصال...',
      'downloading': 'در حال دانلود...',
      'retrying': 'در حال تلاش مجدد...',
      'verifying': 'در حال بررسی...',
      'installing': 'در حال نصب...',
      'completed': 'نصب کامل شد',
      'download-failed': 'نصب ناموفق بود',
      'cancelled': 'لغو شد',
      'permission-denied': 'اجازه داده نشد',
    };
    return messages[state] || state;
  }

  /**
   * Install a component. Uses ModelDownloadManager for the download,
   * then validates and installs to the component's installationPath.
   */
  async installComponent(componentId: string): Promise<ComponentInstallResult> {
    const startMs = Date.now();
    const component = getUnifiedComponent(componentId);

    if (!component) {
      return {
        success: false,
        componentId,
        componentName: 'Unknown',
        bytesDownloaded: 0,
        durationMs: 0,
        state: 'download-failed',
        error: 'Component not found in catalog',
      };
    }

    console.log(`[COMPONENT_DOWNLOAD] Starting: ${component.name} (${component.id})`);
    console.log(`  type: ${component.type}`);
    console.log(`  filename: ${component.filename}`);
    console.log(`  installPath: ${component.installationPath}`);
    console.log(`  sources: ${component.sources.length}`);

    const abortController = { aborted: false };
    this.activeInstalls.set(componentId, { abortController });

    try {
      // ── Step 1: Check if already installed ──
      const finalPath = getComponentInstallPath(component);
      if (fs.existsSync(finalPath)) {
        console.log(`[COMPONENT_INSTALL] Already installed: ${finalPath}`);
        this.emitProgress(component, 'completed');
        return {
          success: true,
          componentId,
          componentName: component.name,
          installedPath: finalPath,
          bytesDownloaded: 0,
          durationMs: Date.now() - startMs,
          state: 'completed',
        };
      }

      // ── Step 2: Download via ModelDownloadManager ──
      // Convert UnifiedComponent to DownloadableModel format
      const downloadableModel = {
        id: component.id,
        name: component.name,
        nameFa: component.nameFa,
        provider: component.type,
        parameterCount: component.parameterCount || '',
        quantization: component.quantization || '',
        architecture: component.architecture || '',
        category: 'general' as const,
        requiredRAM: component.requiredRAM,
        requiredVRAM: component.requiredVRAM,
        persianSupport: false,
        sources: component.sources,
        filename: component.filename,
        description: component.purpose,
        descriptionFa: component.purposeFa,
      };

      const mgr = getModelDownloadManager();

      // Wire progress callback
      const originalCallback = (mgr as any).progressCallback;
      (mgr as any).progressCallback = (progress: ModelDownloadProgress) => {
        if (this.progressCallback) {
          this.progressCallback({
            componentId: component.id,
            componentName: component.name,
            state: progress.state,
            receivedBytes: progress.receivedBytes,
            totalBytes: progress.totalBytes,
            percentage: progress.percentage,
            currentSource: progress.currentSource?.label || null,
            attempt: progress.attempt,
            maxAttempts: progress.maxAttempts,
            stageMessage: progress.stageMessage,
            stageMessageFa: progress.stageMessageFa,
            failure: progress.failure,
          });
        }
      };

      const downloadId = mgr.startDownload(downloadableModel);

      // Wait for download to complete
      const result = await this.waitForDownload(mgr, downloadId, component, abortController);

      // Restore original callback
      (mgr as any).progressCallback = originalCallback;

      if (!result.success) {
        console.log(`[COMPONENT_DOWNLOAD] Failed: ${component.name} — ${result.failure?.message || 'unknown'}`);
        return {
          success: false,
          componentId,
          componentName: component.name,
          bytesDownloaded: result.bytesDownloaded || 0,
          durationMs: Date.now() - startMs,
          state: 'download-failed',
          failure: result.failure,
          error: result.failure?.message,
        };
      }

      // ── Step 3: Integrity validation ──
      this.emitProgress(component, 'verifying');
      const partPath = path.join(getDownloadSandboxDir(), `${component.filename}.part`);

      // Use GGUF validation for .gguf files, general validation for others
      const isGguf = component.filename.toLowerCase().endsWith('.gguf');
      let integrity;
      if (isGguf) {
        integrity = await validateGgufIntegrity(partPath, component.sha256, component.expectedSize);
      } else {
        const fileIntegrity = await validateFileIntegrity(partPath, component.sha256, component.expectedSize);
        integrity = {
          passed: fileIntegrity.passed,
          actualSize: fileIntegrity.actualSize,
          expectedSize: fileIntegrity.expectedSize,
          actualHash: fileIntegrity.actualHash,
          expectedHash: fileIntegrity.expectedHash,
          ggufMagicValid: true,  // N/A for non-GGUF
          error: fileIntegrity.error,
        };
      }

      console.log(`[COMPONENT_VERIFY] ${component.name}:`);
      console.log(`  passed: ${integrity.passed}`);
      console.log(`  actualSize: ${integrity.actualSize}`);
      console.log(`  actualHash: ${integrity.actualHash.slice(0, 16)}...`);
      if (integrity.error) {
        console.log(`  error: ${integrity.error}`);
      }

      if (!integrity.passed) {
        console.log(`[COMPONENT_VERIFY] FAILED — .part file preserved at: ${partPath}`);
        return {
          success: false,
          componentId,
          componentName: component.name,
          bytesDownloaded: integrity.actualSize,
          durationMs: Date.now() - startMs,
          state: 'download-failed',
          error: `Integrity check failed: ${integrity.error}`,
        };
      }

      // ── Step 4: Install (atomic rename to final path) ──
      this.emitProgress(component, 'installing');

      // Ensure install directory exists
      getComponentInstallDir(component);

      // For .zip files (binaries), extract instead of rename
      if (component.filename.toLowerCase().endsWith('.zip')) {
        console.log(`[COMPONENT_INSTALL] Extracting ZIP: ${component.filename}`);
        await extractZip(partPath, getComponentInstallDir(component));

        // Delete the .zip after extraction
        try { fs.unlinkSync(partPath); } catch {}

        // Find the extracted binary
        const extractedPath = path.join(getComponentInstallDir(component), component.filename.replace(/\.zip$/i, '.exe'));
        console.log(`[COMPONENT_INSTALL] Extracted to: ${getComponentInstallDir(component)}`);

        this.emitProgress(component, 'completed');
        console.log(`[COMPONENT_INSTALL] Complete: ${component.name}`);
        return {
          success: true,
          componentId,
          componentName: component.name,
          installedPath: getComponentInstallDir(component),
          hash: integrity.actualHash,
          bytesDownloaded: integrity.actualSize,
          durationMs: Date.now() - startMs,
          state: 'completed',
        };
      }

      // For non-zip files: atomic rename
      if (fs.existsSync(finalPath)) {
        fs.unlinkSync(finalPath);
      }
      fs.renameSync(partPath, finalPath);

      console.log(`[COMPONENT_INSTALL] Installed: ${finalPath}`);

      this.emitProgress(component, 'completed');
      console.log(`[COMPONENT_INSTALL] Complete: ${component.name}`);

      return {
        success: true,
        componentId,
        componentName: component.name,
        installedPath: finalPath,
        hash: integrity.actualHash,
        bytesDownloaded: integrity.actualSize,
        durationMs: Date.now() - startMs,
        state: 'completed',
      };
    } catch (err: any) {
      console.error(`[COMPONENT_INSTALL] Error: ${err?.message}`);
      return {
        success: false,
        componentId,
        componentName: component.name,
        bytesDownloaded: 0,
        durationMs: Date.now() - startMs,
        state: 'download-failed',
        error: err?.message || String(err),
      };
    } finally {
      this.activeInstalls.delete(componentId);
    }
  }

  /**
   * Wait for a download to complete by polling the manager's state.
   */
  private async waitForDownload(
    mgr: any,
    downloadId: string,
    component: UnifiedComponent,
    abortController: { aborted: boolean },
  ): Promise<any> {
    return new Promise((resolve) => {
      const check = () => {
        const state = mgr.getDownloadState(downloadId);
        if (!state) {
          resolve({ success: false, bytesDownloaded: 0, failure: { message: 'Download not found' } });
          return;
        }
        if (state.state === 'completed') {
          resolve({ success: true, bytesDownloaded: state.receivedBytes });
          return;
        }
        if (state.state === 'download-failed' || state.state === 'cancelled') {
          resolve({ success: false, bytesDownloaded: state.receivedBytes, failure: state.failure });
          return;
        }
        setTimeout(check, 200);
      };
      check();
    });
  }

  /**
   * Cancel an active installation.
   */
  cancelInstall(componentId: string): void {
    const active = this.activeInstalls.get(componentId);
    if (active) {
      active.abortController.aborted = true;
    }
  }

  /**
   * Check if a component is already installed on disk.
   */
  isInstalled(componentId: string): boolean {
    const component = getUnifiedComponent(componentId);
    if (!component) return false;
    const installPath = getComponentInstallPath(component);
    return fs.existsSync(installPath);
  }

  /**
   * List all installed components by scanning the catalog.
   */
  listInstalledComponents(): UnifiedComponent[] {
    return UNIFIED_COMPONENT_CATALOG.filter(c => this.isInstalled(c.id));
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────────────

let _instance: UnifiedComponentInstallerClass | null = null;

export function getUnifiedComponentInstaller(): UnifiedComponentInstallerClass {
  if (!_instance) {
    _instance = new UnifiedComponentInstallerClass();
  }
  return _instance;
}

export function _resetUnifiedComponentInstaller(): void {
  _instance = null;
}
