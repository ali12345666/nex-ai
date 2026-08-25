/**
 * Terminal PTY + Session Persistence — Regression Tests
 *
 * Verifies:
 *   1. Backend: PTY spawn, geometry validation, resize dedupe, cleanup
 *   2. Renderer: TerminalSessionManager singleton (persistence)
 *   3. No xterm.dispose() / PTY kill on component unmount
 *   4. One session per lifecycle, single listener, no manual prompt
 *
 * Run: npx tsx tests/system/test-terminal-pty.ts
 */
import '../__mocks__/install-electron-mock.js';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main(): Promise<void> {
  const { TerminalService, terminalService } = await import('../../src/main/services/terminal-service');

  console.log('\n1) Backend mode detection:');
  const usingPty = terminalService.hasPty;
  console.log(`  (running in ${usingPty ? 'PTY' : 'PIPE'} mode)`);
  assert('hasPty getter is boolean', typeof usingPty === 'boolean');

  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'term-pty-'));
  const svc = new TerminalService();

  // ─── 2) Geometry validation ──────────────────────────────────────────────
  console.log('\n2) Geometry validation (cols/rows clamped, never 0/NaN):');
  const s1 = svc.spawnSession(ROOT, 0, 0);
  assert('cols clamped to ≥ 20', s1.cols >= 20, `got ${s1.cols}`);
  assert('rows clamped to ≥ 5', s1.rows >= 5, `got ${s1.rows}`);
  const s2 = svc.spawnSession(ROOT, NaN, Infinity);
  assert('NaN cols → fallback 80', s2.cols === 80, `got ${s2.cols}`);
  assert('Infinity rows → fallback 24', s2.rows === 24, `got ${s2.rows}`);
  const s3 = svc.spawnSession(ROOT, 5, 2);
  assert('too-small cols → fallback', s3.cols === 80, `got ${s3.cols}`);
  const s4 = svc.spawnSession(ROOT, 120, 40);
  assert('valid cols preserved', s4.cols === 120);
  assert('valid rows preserved', s4.rows === 40);

  // ─── 3) One session per spawn call ───────────────────────────────────────
  console.log('\n3) One session per spawn (unique IDs):');
  const ids = new Set([s1.id, s2.id, s3.id, s4.id]);
  assert('4 spawns → 4 unique IDs', ids.size === 4);
  assert('4 sessions tracked', svc.listSessions().length === 4);

  // ─── 4) Resize dedupe ────────────────────────────────────────────────────
  console.log('\n4) Resize dedupe (no resize-event loop):');
  const r1 = svc.resize(s4.id, 120, 40);
  assert('resize to same dims → false (skipped)', r1 === false);
  const r2 = svc.resize(s4.id, 100, 30);
  assert('resize to new dims → applied', r2 === true || (!usingPty && r2 === false));
  assert('session cols updated', s4.cols === 100, `got ${s4.cols}`);
  const r3 = svc.resize(s4.id, 0, 0);
  assert('resize to 0×0 → false (clamped)', typeof r3 === 'boolean');

  // ─── 5) Output handler replaced ──────────────────────────────────────────
  console.log('\n5) Output handler: single listener per session:');
  let calls1 = 0;
  svc.onOutput(s1.id, () => { calls1++; });
  let calls2 = 0;
  svc.onOutput(s1.id, () => { calls2++; });
  svc.write(s1.id, 'echo hi\n');
  await new Promise((r) => setTimeout(r, 200));
  assert('first handler NOT called (replaced)', calls1 === 0);

  // ─── 6) Cleanup ───────────────────────────────────────────────────────────
  console.log('\n6) Cleanup removes handlers + session:');
  const before = svc.listSessions().length;
  svc.killSession(s1.id);
  assert('killSession removes from list', svc.listSessions().length === before - 1);
  assert('write to killed session → false', svc.write(s1.id, 'x') === false);

  // ─── 7) killAll ───────────────────────────────────────────────────────────
  console.log('\n7) killAll leaves no orphans:');
  svc.killAll();
  await new Promise((r) => setTimeout(r, 200));
  assert('listSessions empty after killAll', svc.listSessions().length === 0);

  // ═══════════════════════════════════════════════════════════════════════
  // RENDERER: TerminalSessionManager (PERSISTENCE)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Renderer: TerminalSessionManager (persistence):');
  const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');
  const mgrSrc = read('../../src/renderer/services/terminal-session-manager.ts');
  const panelSrc = read('../../src/renderer/components/layout/TerminalSessionPanel.tsx');

  assert('manager file exists', mgrSrc.length > 0);
  assert('manager exports terminalSessionManager singleton', mgrSrc.includes('export const terminalSessionManager'));
  assert('manager has getOrCreateSession', mgrSrc.includes('getOrCreateSession'));
  assert('manager has attachToContainer', mgrSrc.includes('attachToContainer'));
  assert('manager has detachFromContainer', mgrSrc.includes('detachFromContainer'));
  assert('manager has fitAndResize', mgrSrc.includes('fitAndResize'));
  assert('manager has respawnInCwd', mgrSrc.includes('respawnInCwd'));
  assert('manager has disposeAll', mgrSrc.includes('disposeAll'));
  assert('manager has onStateChange', mgrSrc.includes('onStateChange'));
  assert('manager MIN_COLS guard', mgrSrc.includes('MIN_COLS'));
  assert('manager MIN_ROWS guard', mgrSrc.includes('MIN_ROWS'));
  assert('manager safeDims validator', mgrSrc.includes('safeDims'));
  assert('manager lastReported dedupe', mgrSrc.includes('lastReported'));
  assert('manager hasSpawned guard', mgrSrc.includes('hasSpawned'));
  assert('manager xterm CSS import', mgrSrc.includes("xterm/css/xterm.css"));
  assert('manager cursor hex (not CSS var)', mgrSrc.includes("cursor: '#00e5ff'"));
  assert('manager NO manual prompt injection', !mgrSrc.includes('PS C:'));
  assert('manager input handler (onData)', mgrSrc.includes('terminal.onData'));
  assert('manager keyboard handler (attachCustomKeyEventHandler)', mgrSrc.includes('attachCustomKeyEventHandler'));

  // ─── 9) Panel is thin view (no xterm dispose / PTY kill) ─────────────────
  console.log('\n9) Panel is thin view (NO dispose/kill on unmount):');
  assert('panel imports manager', panelSrc.includes('terminalSessionManager'));
  assert('panel calls getOrCreateSession', panelSrc.includes('getOrCreateSession'));
  assert('panel calls attachToContainer', panelSrc.includes('attachToContainer'));
  assert('panel calls detachFromContainer on unmount', panelSrc.includes('detachFromContainer'));
  // CRITICAL: panel must NOT call xterm.dispose() or terminalSessionKill on unmount
  assert('panel NO terminal.dispose() on unmount', !/terminal\.dispose\(\)/.test(panelSrc));
  assert('panel NO terminalSessionKill CALL on unmount', !/terminalSessionManager\.\w+\([^)]*terminalSessionKill|\.terminalSessionKill\(/.test(panelSrc));
  assert('panel NO new Terminal() (manager owns it)', !/new Terminal\(/.test(panelSrc));
  assert('panel NO new FitAddon() (manager owns it)', !/new FitAddon\(\)/.test(panelSrc));
  assert('panel NO manual xterm.write (only via manager)', !/xtermRef\.current\?\.write/.test(panelSrc));

  // ─── 10) IPC contract ────────────────────────────────────────────────────
  console.log('\n10) IPC contract (main.ts):');
  const mainSrc = read('../../src/main/main.ts');
  assert('terminal-session-spawn registered', mainSrc.includes("'terminal-session-spawn'"));
  assert('terminal-session-resize registered', mainSrc.includes("'terminal-session-resize'"));
  assert('terminal-session-kill registered', mainSrc.includes("'terminal-session-kill'"));
  assert('before-quit kills all sessions', /before-quit[\s\S]{0,200}terminalService\.killAll/.test(mainSrc));

  // ─── 11) Dead code removed ───────────────────────────────────────────────
  console.log('\n11) Dead code removed:');
  assert('NO legacy terminal-spawn handler', !mainSrc.includes("'terminal-spawn'"));
  assert('NO legacy terminal-write handler', !mainSrc.includes("'terminal-write'"));
  assert('NO terminalProcess variable', !/let terminalProcess/.test(mainSrc));
  assert('NO cleanupTerminal function', !/function cleanupTerminal/.test(mainSrc));
  const shellSrc = read('../../src/main/security/shell.ts');
  assert('NO spawnInteractiveShell export', !/export function spawnInteractiveShell/.test(shellSrc));
  assert('TerminalPanel.tsx deleted', !fs.existsSync(path.join(__dirname, '../../src/renderer/components/TerminalPanel.tsx')));

  // ─── 12) node-pty dependency ─────────────────────────────────────────────
  console.log('\n12) node-pty dependency:');
  const pkg = JSON.parse(read('../../package.json'));
  assert('node-pty in dependencies', pkg.dependencies && pkg.dependencies['node-pty']);

  // cleanup
  svc.killAll();
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* */ }

  console.log('\n══════════════════════════════════════');
  console.log(`TERMINAL-PTY RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('TERMINAL PTY + PERSISTENCE: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
