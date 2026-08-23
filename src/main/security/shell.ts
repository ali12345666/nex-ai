/**
 * Safe Shell Execution
 *
 * All shell invocations in NEX AI must go through this module.
 * Strictly uses execFile / spawn with argument arrays — never string commands.
 *
 * This eliminates the entire class of command injection vulnerabilities
 * that plagued v1.0's `fs-search-content` and `exec-command` handlers.
 */

import { execFile, spawn, ChildProcess } from 'child_process';
import * as os from 'os';

export interface ExecOptions {
  cwd?: string;
  timeout?: number;       // ms
  maxBuffer?: number;     // bytes
  env?: Record<string, string>;
}

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

// ─── Windows Command Resolution (Phase 8 / P8-D) ────────────────────────────

/**
 * Commands that exist as `.cmd` shims on Windows (npm ships npm.cmd, not npm.exe).
 * execFile() cannot execute .cmd batch files directly — the spawn fails with
 * ENOENT/EINVAL. We resolve to the .cmd name and keep `shell:false` by using
 * Node's built-in .cmd handling via `{ shell: true }` ONLY for these whitelisted
 * shims with a STRICTLY ARGUMENT-ARRAY call surface.
 */
const WINDOWS_CMD_SHIMS = new Set(['npm', 'npx', 'yarn', 'pnpm', 'bun']);

/**
 * Resolve a binary name for the current (or injected) platform.
 * Pure function — unit-testable without a Windows machine.
 *
 * - On win32, whitelisted JS-package-manager shims get '.cmd' appended and
 *   must be spawned with shell semantics (Node cannot execFile a .cmd).
 * - Everything else returns the name unchanged.
 */
export function resolveCommandForPlatform(
  bin: string,
  platform: NodeJS.Platform = process.platform
): { bin: string; useShell: boolean } {
  if (platform === 'win32' && WINDOWS_CMD_SHIMS.has(bin.toLowerCase())) {
    return { bin: `${bin}.cmd`, useShell: true };
  }
  return { bin, useShell: false };
}

/**
 * cmd.exe metacharacters that enable command injection when args are
 * stringified for a shell. When useShell is forced (Windows .cmd shims),
 * ANY argument containing these is rejected outright — no escaping games.
 * Pure function — unit-testable.
 */
const SHELL_META = /[&|<>^%"\r\n]/;

export function isShellSafeArg(arg: string): boolean {
  return typeof arg === 'string' && !SHELL_META.test(arg);
}

/**
 * Run a binary with explicit argument array. No shell interpolation.
 *
 * Example:
 *   safeExecFile('git', ['status', '--porcelain'], { cwd })
 *
 * Even if an attacker controls one of the args, the OS will pass it as a
 * single argv entry — no shell parsing happens.
 */
export function safeExecFile(
  bin: string,
  args: string[],
  opts: ExecOptions = {}
): Promise<ExecResult> {
  // Phase 8 / P8-D: npm/npx/etc are .cmd shims on Windows — resolve first.
  const resolved = resolveCommandForPlatform(bin);
  // Injection guard: when a shell is forced (.cmd shims), reject any arg
  // carrying cmd.exe metacharacters. Plain-argv path stays shell-free.
  if (resolved.useShell && args.some((a) => !isShellSafeArg(a))) {
    return Promise.resolve({
      success: false,
      stdout: '',
      stderr: '',
      exitCode: null,
      error: 'Blocked: argument contains shell metacharacters',
    });
  }
  return new Promise((resolve) => {
    const child = execFile(resolved.bin, args, {
      cwd: opts.cwd || os.homedir(),
      timeout: opts.timeout || 30000,
      maxBuffer: opts.maxBuffer || 10 * 1024 * 1024,
      env: { ...process.env, ...opts.env } as any,
      encoding: 'utf-8',
      // CRITICAL: never use a shell — EXCEPT for the whitelisted .cmd shims
      // above where Node requires it (binary name is ours, args stay an array)
      shell: resolved.useShell,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) {
        resolve({
          success: false,
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: (err as any).code ?? null,
          error: err.message,
        });
      } else {
        resolve({
          success: true,
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: 0,
        });
      }
    });
  });
}

/**
 * Spawn a long-running process (terminal PTY replacement).
 * Returns the ChildProcess so caller can write to stdin and listen to stdout.
 */
export function safeSpawn(
  bin: string,
  args: string[],
  opts: ExecOptions = {}
): ChildProcess {
  // Phase 8 / P8-D: resolve Windows .cmd shims transparently
  const resolved = resolveCommandForPlatform(bin);
  if (resolved.useShell && args.some((a) => !isShellSafeArg(a))) {
    // Emit an immediately-exited child mirroring a spawn failure — callers
    // already handle non-zero exit/error events.
    const fake = spawn(process.execPath, ['-e', 'process.exit(1)'], { stdio: ['pipe', 'pipe', 'pipe'] });
    (fake as any).nexBlocked = 'argument contains shell metacharacters';
    return fake;
  }
  return spawn(resolved.bin, args, {
    cwd: opts.cwd || os.homedir(),
    env: { ...process.env, ...opts.env } as any,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: resolved.useShell,
    windowsHide: false,
  });
}

/**
 * On Windows: spawn a PowerShell instance suitable for terminal use.
 * On POSIX: spawn bash.
 *
 * Uses safeSpawn internally — never string commands.
 */
export function spawnInteractiveShell(cwd: string): ChildProcess {
  if (os.platform() === 'win32') {
    return safeSpawn('powershell.exe', ['-NoLogo', '-NoProfile'], { cwd });
  }
  return safeSpawn('bash', ['-i'], { cwd });
}

/**
 * Native content search (replaces findstr/grep shell-out).
 * Walks the directory tree in pure Node, no shell invocation.
 *
 * Returns up to `maxResults` matches, each as { file, line, content }.
 */
export async function searchFileContents(
  rootDir: string,
  query: string,
  opts: { maxResults?: number; maxFileSize?: number; ignoreDirs?: string[] } = {}
): Promise<Array<{ file: string; line: number; content: string }>> {
  const max = opts.maxResults || 100;
  const maxFileSize = opts.maxFileSize || 2 * 1024 * 1024; // 2 MB
  const ignoreDirs = new Set(opts.ignoreDirs || [
    'node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.cache',
    '.vscode', '.idea', 'release',
  ]);

  if (!query) return [];

  const results: Array<{ file: string; line: number; content: string }> = [];
  const queue: string[] = [rootDir];

  while (queue.length > 0 && results.length < max) {
    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (results.length >= max) break;
      const fullPath = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = await fs.promises.stat(fullPath);
        if (stat.size > maxFileSize) continue;
      } catch {
        continue;
      }
      try {
        const content = await fs.promises.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        const lowerQuery = query.toLowerCase();
        for (let i = 0; i < lines.length && results.length < max; i++) {
          if (lines[i].toLowerCase().includes(lowerQuery)) {
            results.push({ file: fullPath, line: i + 1, content: lines[i] });
          }
        }
      } catch {
        // skip binary / unreadable
      }
    }
  }
  return results;
}

import * as fs from 'fs';
