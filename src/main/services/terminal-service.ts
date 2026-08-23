/**
 * NEX AI — Terminal Service (Phase 28)
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

export type TerminalState = 'starting' | 'running' | 'exited' | 'error' | 'killed';

export interface TerminalSession {
  id: string;
  process: ChildProcess | null;
  state: TerminalState;
  cwd: string;
  exitCode: number | null;
  createdAt: number;
  exitedAt?: number;
}

export class TerminalService {
  private sessions = new Map<string, TerminalSession>();
  private outputHandlers = new Map<string, (data: string) => void>();
  private exitHandlers = new Map<string, (code: number | null) => void>();
  private nextId = 1;

  /**
   * Spawn an interactive shell session in the given directory.
   */
  spawnSession(cwd: string, shell?: string): TerminalSession {
    const id = `term-${Date.now()}-${this.nextId++}`;
    const session: TerminalSession = {
      id,
      process: null,
      state: 'starting',
      cwd,
      exitCode: null,
      createdAt: Date.now(),
    };

    // Determine shell per platform
    const platform = process.platform;
    const shellBin = shell || (platform === 'win32' ? 'powershell.exe' : 'bash');
    const shellArgs = platform === 'win32' ? ['-NoLogo', '-NoProfile'] : ['-i'];

    const child = safeSpawn(shellBin, shellArgs, { cwd });
    session.process = child;
    session.state = 'running';

    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        this.outputHandlers.get(id)?.(text);
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        this.outputHandlers.get(id)?.(text);
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
    return [...this.sessions.values()];
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
