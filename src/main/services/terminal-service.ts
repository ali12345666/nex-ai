/**
 * NEX AI — Terminal Service (PTY Rewrite — ROOT CAUSE FIX)
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  ROOT CAUSE OF WWWWW / GARBLED TERMINAL (FINAL)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  The previous implementation spawned the shell with:
 *      child_process.spawn(shell, args, { stdio: ['pipe','pipe','pipe'] })
 *
 *  This connects PowerShell to ANONYMOUS PIPES, not a pseudo-terminal.
 *  On Windows the consequence is catastrophic for an interactive shell:
 *
 *    1. [Console]::IsInputRedirected == true  → PowerShell enters a
 *       degraded "non-interactive / redirected-input" mode.
 *    2. The Windows console host-side ECHO is gone → typed characters are
 *       never echoed back unless the shell does it (PowerShell does not,
 *       PSReadLine does but only when it detects a real console).
 *    3. Ctrl+C cannot be delivered as a real console signal — it arrives
 *       as a literal ^C byte on stdin and does not interrupt the process.
 *    4. Resize cannot be communicated to the child (no SIGWINCH equivalent
 *       through a pipe) → the shell keeps the original geometry forever.
 *    5. The prompt function may emit control bytes (title OSC, redraw
 *       sequences) that were designed for a real console; when they arrive
 *       fragmented through a pipe + xterm parser in a weird state, they
 *       can render as repeated printable characters — observed as the
 *       "WWWWWWW" artefact next to the prompt.
 *
 *  FIX: use `node-pty` which wraps ConPTY on Windows 10+ and forkpty on
 *  POSIX. This restores real TTY semantics: echo, signals, resize, clean
 *  prompt rendering. `node-pty` is the exact library VS Code's integrated
 *  terminal uses for the same reason.
 *
 *  RESILIENCE: node-pty is a native module. If it is not installed (e.g. in
 *  a CI sandbox without the prebuilt binary) we fall back to the legacy
 *  pipe path so the app still boots. The legacy path is marked degraded —
 *  the interactive experience will be poor, but nothing crashes. On the
 *  user's Windows machine `npm install` pulls the prebuilt binary and the
 *  real PTY path is used automatically.
 *
 *  ARCHITECTURE:
 *    Renderer → Preload API → IPC → TerminalService → node-pty (preferred)
 *                                                   → child_process (fallback)
 *
 *  SECURITY:
 *   - Shell path is resolved to a full absolute path (Phase 1 ENOENT fix).
 *   - Shell args are an array, never interpolated (-NoLogo -NoProfile).
 *   - Session IDs prevent cross-session interference.
 *   - All processes are killed on session close / app exit / workspace switch.
 *   - No remote execution capability.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { safeSpawn } from '../security/shell';
import type { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── node-pty (optional native module) ──────────────────────────────────────
//
// Minimal structural interface for the node-pty API surface we use. Defined
// locally (rather than `typeof import('node-pty')`) so that tsc passes even
// when node-pty is not installed (sandbox / CI without the prebuilt binary).
// At runtime the real module is required dynamically and falls back to pipe
// mode if missing.
interface IPtyProcess {
  onData(cb: (data: string) => void): void;
  onExit(cb: (ev: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  pid: number;
  process: string;
  cols: number;
  rows: number;
}
interface IPty {
  spawn(file: string, args: string[] | string, options: {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string>;
  }): IPtyProcess;
}

// Dynamically required. If the native binary is missing (sandbox / CI without
// prebuilds), `pty` stays null and we fall back to pipe mode. We do NOT throw
// — a degraded terminal is better than a crash on boot.
let pty: IPty | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  pty = require('node-pty') as IPty;
} catch {
  pty = null;
}

// ════════════════════════════════════════════════════════════════════════════
// DEBUG INSTRUMENTATION — TEMPORARY
// ════════════════════════════════════════════════════════════════════════════
// Goal: find the producer of the "WWWWW" characters that appear BEFORE the
// first PowerShell prompt on Windows.
//
// Enable: set env var NEX_TERM_DEBUG=1 before launching the app.
//   Windows (PowerShell):  $env:NEX_TERM_DEBUG='1'; npm run dev
//   Windows (cmd):         set NEX_TERM_DEBUG=1 && npm run dev
//
// This logs every byte flowing through the PTY in BOTH directions, with a
// sequence number, timestamp, source, length, escaped data, and hex. It does
// NOT filter, modify, or suppress any data.
//
// Cross-reference with the renderer logs ([NEX-XT ...]) to determine:
//   - If W's appear here ([NEX-TERM n OUT]) → they come from the PTY/shell.
//   - If W's appear ONLY in renderer logs → they come from a renderer write.
// ════════════════════════════════════════════════════════════════════════════
const TERM_DEBUG = process.env.NEX_TERM_DEBUG === '1';
let _termSeq = 0;
function _dbgTerm(
  dir: 'OUT' | 'IN',
  source: string,
  id: string,
  data: string,
): void {
  if (!TERM_DEBUG) return;
  _termSeq++;
  const hex = Array.from(data.slice(0, 64))
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join(' ');
  const esc = JSON.stringify(data).slice(0, 200);
  console.log(
    `[NEX-TERM ${_termSeq} ${dir}] t=${Date.now()} src=${source} id=${id} ` +
    `len=${data.length} esc=${esc} hex=${hex}`,
  );
}

export type TerminalState = 'starting' | 'running' | 'exited' | 'error' | 'killed';

export interface TerminalSession {
  id: string;
  /** node-pty IPtyProcess | ChildProcess — kept as unknown to avoid a hard
   *  type coupling to the native module. */
  process: unknown;
  ptyProcess: IPtyProcess | null;
  childProcess: ChildProcess | null;
  state: TerminalState;
  cwd: string;
  shellName: string;
  shellPath: string;
  cols: number;
  rows: number;
  exitCode: number | null;
  createdAt: number;
  exitedAt?: number;
  /** Buffer for output emitted BEFORE onOutput() attaches the handler.
   *  Without this, the first bytes from the PTY (including potentially
   *  the W's we're hunting) are silently dropped. Flushed in onOutput(). */
  earlyBuffer: string[];
}

/** Minimum sane terminal geometry — never spawn / resize below this. */
const MIN_COLS = 20;
const MIN_ROWS = 5;

/** Clamp geometry into a safe range; guards against 0 / NaN / Infinity. */
function safeDims(cols: number, rows: number): { cols: number; rows: number } {
  const c = Math.floor(Number(cols));
  const r = Math.floor(Number(rows));
  return {
    cols: Number.isFinite(c) && c >= MIN_COLS ? c : 80,
    rows: Number.isFinite(r) && r >= MIN_ROWS ? r : 24,
  };
}

/**
 * Windows shell resolution — resolves FULL PATH to executable.
 *
 * Resolution order:
 *   1. PowerShell 5.1 at ${SystemRoot}\System32\WindowsPowerShell\v1.0\powershell.exe
 *   2. PowerShell 7 (pwsh.exe) — common install paths
 *   3. cmd.exe at process.env.ComSpec
 *   4. Fallback: C:\Windows\System32\cmd.exe
 *
 * On Linux/macOS: uses process.env.SHELL || /bin/bash
 *
 * -NoLogo suppresses the startup banner.
 * -NoProfile prevents user/PSReadLine profiles from loading — those profiles
 *   are the most common source of extra prompt output / OSC sequences that
 *   produce garbled rendering through pipes.
 */
function resolveShell(): { bin: string; args: string[]; name: string } {
  const platform = process.platform;

  if (platform === 'win32') {
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

    const comSpec = process.env.ComSpec;
    if (comSpec && fs.existsSync(comSpec)) {
      return { bin: comSpec, args: ['/K'], name: 'Command Prompt' };
    }

    const cmdPath = path.join(systemRoot, 'System32', 'cmd.exe');
    if (fs.existsSync(cmdPath)) {
      return { bin: cmdPath, args: ['/K'], name: 'Command Prompt' };
    }

    return { bin: 'powershell.exe', args: ['-NoLogo', '-NoProfile'], name: 'PowerShell (bare)' };
  }

  // Linux/macOS
  const shellEnv = process.env.SHELL || '/bin/bash';
  return { bin: shellEnv, args: ['-i'], name: path.basename(shellEnv) };
}

/** Validate and resolve CWD before spawning. Falls back to homedir. */
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
  private exitHandlers = new Map<string, (code: number) => void>();
  private resizeHandlers = new Map<string, () => void>();
  private nextId = 1;

  /** True when node-pty is available (real PTY path). */
  get hasPty(): boolean {
    return pty !== null;
  }

  /**
   * Spawn an interactive shell session.
   *
   * Preferred path: node-pty (ConPTY on Windows, forkpty on POSIX).
   * Fallback path: child_process pipes (degraded — no echo / no signals).
   *
   * @param cwd       Working directory.
   * @param cols      Initial columns (clamped ≥ MIN_COLS).
   * @param rows      Initial rows (clamped ≥ MIN_ROWS).
   * @param override  Optional shell override (testing only).
   */
  spawnSession(
    cwd: string,
    cols: number = 80,
    rows: number = 24,
    override?: string
  ): TerminalSession {
    const id = `term-${Date.now()}-${this.nextId++}`;
    const resolvedCwd = resolveCwd(cwd);
    const { bin: shellBin, args: shellArgs, name: shellName } = resolveShell();
    const finalBin = override || shellBin;
    const finalArgs = override ? [] : shellArgs;
    const { cols: safeCols, rows: safeRows } = safeDims(cols, rows);

    const session: TerminalSession = {
      id,
      process: null,
      ptyProcess: null,
      childProcess: null,
      state: 'starting',
      cwd: resolvedCwd,
      shellName,
      shellPath: finalBin,
      cols: safeCols,
      rows: safeRows,
      exitCode: null,
      createdAt: Date.now(),
      earlyBuffer: [],
    };

    // ── Preferred: node-pty (real PTY) ────────────────────────────────────
    if (pty) {
      try {
        const ptyProc = pty.spawn(finalBin, finalArgs, {
          name: 'xterm-256color',
          cols: safeCols,
          rows: safeRows,
          cwd: resolvedCwd,
          env: process.env as Record<string, string>,
        });
        session.ptyProcess = ptyProc;
        session.process = ptyProc;
        session.state = 'running';

        if (TERM_DEBUG) {
          console.log(
            `[NEX-TERM SPAWN] t=${Date.now()} id=${id} bin=${finalBin} ` +
            `args=${JSON.stringify(finalArgs)} cwd=${resolvedCwd} ` +
            `cols=${safeCols} rows=${safeRows} pid=${ptyProc.pid}`,
          );
        }

        // node-pty emits strings when encoding is utf-8 (default on v1+).
        // Log every chunk AND buffer early output until onOutput() attaches.
        ptyProc.onData((data: string) => {
          _dbgTerm('OUT', 'pty-onData', id, data);
          const handler = this.outputHandlers.get(id);
          if (handler) {
            handler(data);
          } else {
            // Handler not attached yet — buffer so the first bytes (which
            // may include the W's we're hunting) are NOT lost.
            session.earlyBuffer.push(data);
          }
        });
        ptyProc.onExit(({ exitCode }) => {
          if (TERM_DEBUG) {
            console.log(`[NEX-TERM EXIT] t=${Date.now()} id=${id} code=${exitCode}`);
          }
          session.state = 'exited';
          session.exitCode = exitCode;
          session.exitedAt = Date.now();
          this.exitHandlers.get(id)?.(exitCode);
        });

        this.sessions.set(id, session);
        return session;
      } catch {
        // Fall through to pipe path if PTY spawn fails at runtime.
      }
    }

    // ── Fallback: child_process pipes (DEGRADED) ──────────────────────────
    //
    // Used when node-pty is unavailable (sandbox). Echo / Ctrl+C / resize are
    // impaired here — this is NOT a production terminal path.
    const child = safeSpawn(finalBin, finalArgs, { cwd: resolvedCwd });
    session.childProcess = child;
    session.process = child;
    session.state = 'running';

    if (child.stdout) {
      child.stdout.setEncoding('utf-8');
      child.stdout.on('data', (data: string) => {
        _dbgTerm('OUT', 'pipe-stdout', id, data);
        const handler = this.outputHandlers.get(id);
        if (handler) handler(data); else session.earlyBuffer.push(data);
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding('utf-8');
      child.stderr.on('data', (data: string) => {
        _dbgTerm('OUT', 'pipe-stderr', id, data);
        const handler = this.outputHandlers.get(id);
        if (handler) handler(data); else session.earlyBuffer.push(data);
      });
    }
    child.on('exit', (code) => {
      if (TERM_DEBUG) console.log(`[NEX-TERM EXIT] t=${Date.now()} id=${id} code=${code}`);
      session.state = 'exited';
      session.exitCode = code ?? -1;
      session.exitedAt = Date.now();
      this.exitHandlers.get(id)?.(session.exitCode);
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

  /** Write data to a session's stdin (PTY or pipe). */
  write(sessionId: string, data: string): boolean {
    _dbgTerm('IN', 'terminalService.write', sessionId, data);
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== 'running') return false;
    try {
      if (session.ptyProcess) {
        session.ptyProcess.write(data);
        return true;
      }
      if (session.childProcess?.stdin) {
        session.childProcess.stdin.write(data);
        return true;
      }
    } catch { /* process gone */ }
    return false;
  }

  /**
   * Resize a session's PTY. Only node-pty supports real resize; pipe mode
   * is a no-op (the shell cannot be told about a resize through a pipe).
   *
   * Returns true when the resize was actually applied.
   */
  resize(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== 'running') return false;
    const { cols: safeCols, rows: safeRows } = safeDims(cols, rows);
    // Skip if no actual change (prevents resize-event loops).
    if (session.cols === safeCols && session.rows === safeRows) return false;
    session.cols = safeCols;
    session.rows = safeRows;
    if (session.ptyProcess) {
      try {
        session.ptyProcess.resize(safeCols, safeRows);
        return true;
      } catch { /* pty gone */ }
    }
    // Pipe mode: cannot resize — silently ignore.
    return false;
  }

  /** Send a signal to a session (SIGINT / SIGTERM / SIGKILL). */
  sendSignal(sessionId: string, signal: 'SIGINT' | 'SIGTERM' | 'SIGKILL' = 'SIGINT'): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== 'running') return false;
    // With a real PTY the child receives Ctrl+C as a console signal automatically
    // when the user types it — but this API is still useful for the toolbar ^C
    // button and explicit programmatic interrupts.
    try {
      if (session.childProcess) {
        session.childProcess.kill(signal);
        return true;
      }
      // node-pty: try to pass the signal to the PTY process.
      // node-pty's kill() accepts a signal name on some platforms.
      // On Windows, kill() always terminates the process (no signal support),
      // but on POSIX we can try to send the specific signal.
      if (session.ptyProcess) {
        if (process.platform !== 'win32') {
          // POSIX: try to send the specific signal
          try {
            session.ptyProcess.kill(signal);
            return true;
          } catch {
            // Fallback: if kill(signal) fails, use default kill()
            session.ptyProcess.kill();
            return true;
          }
        } else {
          // Windows: kill() doesn't support signals — always force-kills.
          // For SIGINT, write Ctrl+C character to the PTY input instead.
          if (signal === 'SIGINT') {
            try {
              session.ptyProcess.write('\x03'); // Ctrl+C
              return true;
            } catch {
              // Fallback to kill
              session.ptyProcess.kill();
              return true;
            }
          } else {
            session.ptyProcess.kill();
            return true;
          }
        }
      }
    } catch { /* already dead */ }
    return false;
  }

  /** Kill and cleanup a specific session. */
  killSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (session.state === 'running') {
      try {
        if (session.ptyProcess) session.ptyProcess.kill();
        else if (session.childProcess) session.childProcess.kill('SIGKILL');
      } catch { /* already dead */ }
    }
    this.cleanupSession(sessionId);
    return true;
  }

  /** Remove listeners + references for a session (after exit). */
  cleanupSession(sessionId: string): void {
    this.outputHandlers.delete(sessionId);
    this.exitHandlers.delete(sessionId);
    this.resizeHandlers.delete(sessionId);
    this.sessions.delete(sessionId);
  }

  /** Register output callback (single handler per session — last one wins).
   *  Flushes any early-buffered output that arrived before this call. */
  onOutput(sessionId: string, handler: (data: string) => void): void {
    this.outputHandlers.set(sessionId, handler);
    // Flush early buffer — output that arrived between spawn and this call.
    const session = this.sessions.get(sessionId);
    if (session && session.earlyBuffer.length > 0) {
      if (TERM_DEBUG) {
        console.log(
          `[NEX-TERM FLUSH] t=${Date.now()} id=${sessionId} ` +
          `chunks=${session.earlyBuffer.length} totalLen=${session.earlyBuffer.reduce((a, c) => a + c.length, 0)}`,
        );
      }
      for (const chunk of session.earlyBuffer) {
        _dbgTerm('OUT', 'earlyBuffer-flush', sessionId, chunk);
        handler(chunk);
      }
      session.earlyBuffer = [];
    }
  }

  /** Register exit callback (single handler per session — last one wins). */
  onExit(sessionId: string, handler: (code: number) => void): void {
    this.exitHandlers.set(sessionId, handler);
  }

  /** Get session info. */
  getSession(sessionId: string): TerminalSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /** List active sessions (without exposing process handles). */
  listSessions(): TerminalSession[] {
    return [...this.sessions.values()].map((s) => ({
      ...s,
      process: null,
      ptyProcess: null,
      childProcess: null,
    }));
  }

  /** Kill ALL sessions (app exit / workspace switch). */
  killAll(): void {
    for (const [id] of this.sessions) {
      this.killSession(id);
    }
  }

  /** Current tracked cwd. */
  getCwd(sessionId: string): string | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return session.cwd;
  }

  /** Update tracked cwd (called when cd is detected). */
  updateCwd(sessionId: string, newCwd: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.cwd = newCwd;
  }
}

// Singleton
export const terminalService = new TerminalService();
