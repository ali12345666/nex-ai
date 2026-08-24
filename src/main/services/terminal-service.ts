/**
 * NEX AI — Terminal Service (Phase 28 + Windows Spawn Fix)
 *
 * Session-based terminal management with proper process lifecycle.
 * Uses safeSpawn (Phase 1 security — no shell, argv arrays only).
 *
 * Architecture:
 *   Renderer → Preload API → IPC → TerminalService → child_process
 *
 * Security:
 *  - Shell is spawned via safeSpawn (no shell interpolation)
 *  - Session IDs prevent cross-session interference
 *  - Processes are killed on: session close, app exit, workspace switch
 *  - No remote execution capability
 */

import { safeSpawn, type ExecOptions } from '../security/shell';
import type { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type TerminalState = 'starting' | 'running' | 'exited' | 'error' | 'killed';

export interface TerminalSession {
  id: string;
  process: ChildProcess | null;
  state: TerminalState;
  cwd: string;
  shellName: string;
  shellPath: string;
  exitCode: number | null;
  createdAt: number;
  exitedAt?: number;
}

/**
 * Windows shell resolution — resolves FULL PATH to executable.
 *
 * ROOT CAUSE of ENOENT: spawn('powershell.exe', ..., { shell: false }) does NOT
 * search PATH on Windows. It requires the exact executable path. 'powershell.exe'
 * alone is not a valid path when shell:false.
 *
 * Resolution order:
 *   1. PowerShell 5.1 at ${SystemRoot}\System32\WindowsPowerShell\v1.0\powershell.exe
 *   2. PowerShell 7 (pwsh.exe) — search common install paths
 *   3. cmd.exe at process.env.ComSpec
 *   4. Fallback: C:\Windows\System32\cmd.exe
 *
 * On Linux/macOS: uses process.env.SHELL || /bin/bash
 */
function resolveShell(): { bin: string; args: string[]; name: string } {
  const platform = process.platform;

  if (platform === 'win32') {
    // 1. Try PowerShell 5.1 at standard Windows path
    const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
    const ps51Path = path.join(
      systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
    );
    if (fs.existsSync(ps51Path)) {
      return {
        bin: ps51Path,
        args: ['-NoLogo', '-NoProfile'],
        name: 'PowerShell 5.1',
      };
    }

    // 2. Try PowerShell 7 (pwsh.exe) — common install locations
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pwshPaths = [
      path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
      path.join(systemRoot, 'System32', 'pwsh.exe'),
    ];
    for (const p of pwshPaths) {
      if (fs.existsSync(p)) {
        return {
          bin: p,
          args: ['-NoLogo', '-NoProfile'],
          name: 'PowerShell 7',
        };
      }
    }

    // 3. Try cmd.exe from ComSpec
    const comSpec = process.env.ComSpec;
    if (comSpec && fs.existsSync(comSpec)) {
      return {
        bin: comSpec,
        args: ['/K'], // keep interactive
        name: 'Command Prompt',
      };
    }

    // 4. Hard fallback to standard cmd.exe
    const cmdPath = path.join(systemRoot, 'System32', 'cmd.exe');
    if (fs.existsSync(cmdPath)) {
      return {
        bin: cmdPath,
        args: ['/K'],
        name: 'Command Prompt',
      };
    }

    // Last resort — let safeSpawn try bare name (may fail with ENOENT)
    return {
      bin: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile'],
      name: 'PowerShell (bare)',
    };
  }

  // Linux/macOS: use $SHELL, fallback to /bin/bash
  const shellEnv = process.env.SHELL || '/bin/bash';
  return {
    bin: shellEnv,
    args: ['-i'], // interactive mode
    name: path.basename(shellEnv),
  };
}

/**
 * Validate and resolve CWD before spawning.
 * Falls back to os.homedir() if the provided path doesn't exist.
 */
function resolveCwd(cwd: string): string {
  try {
    if (cwd && fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()) {
      return cwd;
    }
  } catch { /* path invalid */ }
  return os.homedir();
}

export class TerminalService {
  private sessions = new Map<string, TerminalSession>();
  private outputHandlers = new Map<string, (data: string) => void>();
  private exitHandlers = new Map<string, (code: number | null) => void>();
  private nextId = 1;

  /**
   * Spawn an interactive shell session in the given directory.
   */
  spawnSession(cwd: string, shellOverride?: string): TerminalSession {
    const id = `term-${Date.now()}-${this.nextId++}`;
    const resolvedCwd = resolveCwd(cwd);
    const { bin: shellBin, args: shellArgs, name: shellName } = resolveShell();

    // Allow explicit override (for testing or user preference)
    const finalBin = shellOverride || shellBin;
    const finalArgs = shellOverride ? [] : shellArgs;

    const session: TerminalSession = {
      id,
      process: null,
      state: 'starting',
      cwd: resolvedCwd,
      shellName,
      shellPath: finalBin,
      exitCode: null,
      createdAt: Date.now(),
    };

    const child = safeSpawn(finalBin, finalArgs, { cwd: resolvedCwd });
    session.process = child;
    session.state = 'running';

    // Set encoding to utf-8 so stdout/stderr emit strings (not Buffers).
    if (child.stdout) {
      child.stdout.setEncoding('utf-8');
      child.stdout.on('data', (data: string) => {
        this.outputHandlers.get(id)?.(data);
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding('utf-8');
      child.stderr.on('data', (data: string) => {
        this.outputHandlers.get(id)?.(data);
      });
    }
    child.on('exit', (code) => {
      session.state = 'exited';
      session.exitCode = code;
      session.exitedAt = Date.now();
      this.exitHandlers.get(id)?.(code);
    });
    child.on('error', (err) => {
      session.state = 'error';
      session.exitCode = -1;
      session.exitedAt = Date.now();
      this.outputHandlers.get(id)?.(`\r\n[error] ${err.message}\r\n`);
      this.exitHandlers.get(id)?.(-1);
    });

    this.sessions.set(id, session);
    return session;
  }

  /** Write data to a session's stdin. */
  write(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.process?.stdin || session.state !== 'running') return false;
    session.process.stdin.write(data);
    return true;
  }

  /** Send Ctrl+C (SIGINT equivalent) to a session. */
  sendSignal(sessionId: string, signal: 'SIGINT' | 'SIGTERM' | 'SIGKILL' = 'SIGINT'): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.process || session.state !== 'running') return false;
    try {
      session.process.kill(signal);
      return true;
    } catch { return false; }
  }

  /** Kill and cleanup a specific session. */
  killSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (session.process && session.state === 'running') {
      try { session.process.kill('SIGKILL'); } catch { /* already dead */ }
    }
    this.cleanupSession(sessionId);
    session.state = 'killed';
    return true;
  }

  /** Remove listeners + references for a session (after exit). */
  cleanupSession(sessionId: string): void {
    this.outputHandlers.delete(sessionId);
    this.exitHandlers.delete(sessionId);
    this.sessions.delete(sessionId);
  }

  /** Register output callback for a session. */
  onOutput(sessionId: string, handler: (data: string) => void): void {
    this.outputHandlers.set(sessionId, handler);
  }

  /** Register exit callback for a session. */
  onExit(sessionId: string, handler: (code: number | null) => void): void {
    this.exitHandlers.set(sessionId, handler);
  }

  /** Get session info. */
  getSession(sessionId: string): TerminalSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /** List active sessions. */
  listSessions(): TerminalSession[] {
    return [...this.sessions.values()].map(s => ({
      ...s,
      process: null, // don't expose ChildProcess to IPC
    }));
  }

  /** Kill ALL sessions (app exit, workspace switch). */
  killAll(): void {
    for (const [id] of this.sessions) {
      this.killSession(id);
    }
  }

  /** Get the current working directory by querying the process. */
  getCwd(sessionId: string): string | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== 'running') return session?.cwd || null;
    return session.cwd;
  }

  /** Update tracked cwd (called when cd command is detected). */
  updateCwd(sessionId: string, newCwd: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.cwd = newCwd;
  }
}

// Singleton
export const terminalService = new TerminalService();
