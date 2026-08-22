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
  return new Promise((resolve) => {
    const child = execFile(bin, args, {
      cwd: opts.cwd || os.homedir(),
      timeout: opts.timeout || 30000,
      maxBuffer: opts.maxBuffer || 10 * 1024 * 1024,
      env: { ...process.env, ...opts.env } as any,
      encoding: 'utf-8',
      shell: false, // CRITICAL: never use a shell
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
  return spawn(bin, args, {
    cwd: opts.cwd || os.homedir(),
    env: { ...process.env, ...opts.env } as any,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
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
