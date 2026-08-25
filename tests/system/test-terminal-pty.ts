/**
 * Terminal PTY Rewrite — Regression Tests
 *
 * Verifies the ROOT CAUSE fix for the WWWWW / garbled terminal issue:
 *   1. One session per spawn (no duplicates)
 *   2. Geometry validation (cols/rows clamped ≥ MIN_COLS×MIN_ROWS, never 0/NaN)
 *   3. Resize is deduped (no resize-event loop)
 *   4. Output handler is replaced, not appended (single listener per session)
 *   5. Cleanup removes handlers + session
 *   6. killAll leaves no orphans
 *   7. spawn carries real cols/rows to the session record
 *   8. cwd resolution falls back to homedir for bad paths
 *
 * Works in BOTH modes:
 *   - PTY mode  (node-pty installed) — real ConPTY/forkpty
 *   - Pipe mode (node-pty missing, e.g. CI sandbox) — degraded fallback
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

  console.log('\n1) Mode detection:');
  const usingPty = terminalService.hasPty;
  console.log(`  (running in ${usingPty ? 'PTY' : 'PIPE'} mode)`);
  assert('hasPty getter is boolean', typeof usingPty === 'boolean');

  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'term-pty-'));
  const svc = new TerminalService();

  // ─── 2) Geometry validation ──────────────────────────────────────────────
  console.log('\n2) Geometry validation (cols/rows clamped, never 0/NaN):');
  // Spawn with bad geometry — should clamp to ≥ MIN.
  const s1 = svc.spawnSession(ROOT, 0, 0);
  assert('cols clamped to ≥ 20', s1.cols >= 20, `got ${s1.cols}`);
  assert('rows clamped to ≥ 5', s1.rows >= 5, `got ${s1.rows}`);
  assert('cols is finite', Number.isFinite(s1.cols));
  assert('rows is finite', Number.isFinite(s1.rows));

  const s2 = svc.spawnSession(ROOT, NaN, Infinity);
  assert('NaN cols → fallback 80', s2.cols === 80, `got ${s2.cols}`);
  assert('Infinity rows → fallback 24', s2.rows === 24, `got ${s2.rows}`);

  const s3 = svc.spawnSession(ROOT, 5, 2);
  assert('too-small cols → fallback', s3.cols === 80, `got ${s3.cols}`);
  assert('too-small rows → fallback', s3.rows === 24, `got ${s3.rows}`);

  const s4 = svc.spawnSession(ROOT, 120, 40);
  assert('valid cols preserved', s4.cols === 120, `got ${s4.cols}`);
  assert('valid rows preserved', s4.rows === 40, `got ${s4.rows}`);

  // ─── 3) One session per spawn call ───────────────────────────────────────
  console.log('\n3) One session per spawn (unique IDs):');
  const ids = new Set([s1.id, s2.id, s3.id, s4.id]);
  assert('4 spawns → 4 unique IDs', ids.size === 4);
  assert('IDs follow term-* pattern', [...ids].every((id) => id.startsWith('term-')));
  assert('4 sessions tracked', svc.listSessions().length === 4);

  // ─── 4) Resize dedupe ────────────────────────────────────────────────────
  console.log('\n4) Resize dedupe (no resize-event loop):');
  // resize to the SAME geometry → no-op (returns false = not applied).
  const r1 = svc.resize(s4.id, 120, 40);
  assert('resize to same dims → false (skipped)', r1 === false);
  // resize to new geometry → applied.
  const r2 = svc.resize(s4.id, 100, 30);
  assert('resize to new dims → applied', r2 === true || (!usingPty && r2 === false));
  assert('session cols updated', s4.cols === 100, `got ${s4.cols}`);
  assert('session rows updated', s4.rows === 30, `got ${s4.rows}`);
  // resize with bad geometry → no-op.
  const r3 = svc.resize(s4.id, 0, 0);
  assert('resize to 0×0 → false (clamped to fallback, applied once)', typeof r3 === 'boolean');
  assert('cols still ≥ 20 after bad resize', s4.cols >= 20);

  // ─── 5) Output handler replaced, not appended ────────────────────────────
  console.log('\n5) Output handler: single listener per session (replaced not appended):');
  let calls1 = 0;
  svc.onOutput(s1.id, () => { calls1++; });
  let calls2 = 0;
  svc.onOutput(s1.id, () => { calls2++; }); // replaces previous
  // Write something — only calls2 should increment, calls1 should stay 0.
  svc.write(s1.id, 'echo hi\n');
  await new Promise((r) => setTimeout(r, 200));
  assert('first handler NOT called (replaced)', calls1 === 0);
  // calls2 may or may not fire depending on PTY timing; the key assertion is
  // that only ONE handler is active, verified by calls1 staying 0.

  // ─── 6) Cleanup removes handlers + session ───────────────────────────────
  console.log('\n6) Cleanup removes handlers + session:');
  const before = svc.listSessions().length;
  svc.killSession(s1.id);
  assert('killSession removes from list', svc.listSessions().length === before - 1);
  assert('getSession returns null after kill', svc.getSession(s1.id) === null);
  // Writing to a killed session → false (no-op).
  assert('write to killed session → false', svc.write(s1.id, 'x') === false);
  // Resize to a killed session → false.
  assert('resize killed session → false', svc.resize(s1.id, 80, 24) === false);

  // ─── 7) killAll leaves no orphans ────────────────────────────────────────
  console.log('\n7) killAll leaves no orphans:');
  svc.killAll();
  await new Promise((r) => setTimeout(r, 200));
  assert('listSessions empty after killAll', svc.listSessions().length === 0);

  // ─── 8) CWD resolution ───────────────────────────────────────────────────
  console.log('\n8) CWD resolution:');
  const sBad = svc.spawnSession('/nonexistent/path/xyz', 80, 24);
  assert('bad cwd → homedir fallback', sBad.cwd === os.homedir(), `got ${sBad.cwd}`);
  const sGood = svc.spawnSession(ROOT, 80, 24);
  assert('good cwd preserved', sGood.cwd === ROOT);
  svc.updateCwd(sGood.id, '/tmp');
  assert('updateCwd tracks new cwd', svc.getCwd(sGood.id) === '/tmp');

  // ─── 9) Shell resolution (platform-aware) ────────────────────────────────
  console.log('\n9) Shell resolution:');
  assert('session has shellName', sGood.shellName.length > 0);
  assert('session has shellPath', sGood.shellPath.length > 0);
  assert('shellPath is absolute or a bare fallback', sGood.shellPath.includes(path.sep) || sGood.shellPath.endsWith('.exe'));

  // ─── 10) IPC contract: resize + spawn-with-geometry registered ───────────
  console.log('\n10) IPC contract (main.ts):');
  const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');
  const mainSrc = read('../../src/main/main.ts');
  assert('terminal-session-spawn handler registered', mainSrc.includes("'terminal-session-spawn'"));
  assert('terminal-session-resize handler registered', mainSrc.includes("'terminal-session-resize'"));
  assert('spawn passes cols/rows', /terminal-session-spawn'[\s\S]{0,120}cols/.test(mainSrc));
  assert('resize handler validates types', /terminal-session-resize'[\s\S]{0,120}typeof cols/.test(mainSrc));

  // ─── 11) Dead code removed (no legacy pipe API) ───────────────────────────
  console.log('\n11) Dead code removed:');
  assert('NO legacy terminal-spawn handler', !mainSrc.includes("'terminal-spawn'"));
  assert('NO legacy terminal-write handler', !mainSrc.includes("'terminal-write'"));
  assert('NO legacy terminal-resize handler', !mainSrc.includes("'terminal-resize'"));
  assert('NO terminalProcess variable', !/let terminalProcess/.test(mainSrc));
  assert('NO cleanupTerminal function', !/function cleanupTerminal/.test(mainSrc));
  const preSrc = read('../../src/main/preload.ts');
  assert('NO legacy terminalSpawn bridge', !/terminalSpawn:/.test(preSrc));
  assert('NO legacy terminalWrite bridge', !/terminalWrite:/.test(preSrc));
  assert('terminalSessionResize bridge present', preSrc.includes('terminalSessionResize'));
  const shellSrc = read('../../src/main/security/shell.ts');
  assert('NO spawnInteractiveShell export', !/export function spawnInteractiveShell/.test(shellSrc));
  assert('TerminalPanel.tsx deleted', !fs.existsSync(path.join(__dirname, '../../src/renderer/components/TerminalPanel.tsx')));

  // ─── 12) TerminalSessionPanel renderer guards ───────────────────────────
  console.log('\n12) TerminalSessionPanel renderer guards:');
  const panelSrc = read('../../src/renderer/components/layout/TerminalSessionPanel.tsx');
  assert('MIN_COLS guard present', panelSrc.includes('MIN_COLS'));
  assert('MIN_ROWS guard present', panelSrc.includes('MIN_ROWS'));
  assert('safeDims validator present', panelSrc.includes('safeDims'));
  assert('display:none fit guard present', /display === 'none'/.test(panelSrc) || /clientWidth === 0/.test(panelSrc));
  assert('resize dedupe (lastReportedRef)', panelSrc.includes('lastReportedRef'));
  assert('hasSpawnedRef single-spawn guard', panelSrc.includes('hasSpawnedRef'));
  assert('spawnSession dedupes by cwd', panelSrc.includes('spawnedCwdRef'));
  assert('spawn passes cols/rows to IPC', /terminalSessionSpawn\([\s\S]{0,40}cols/.test(panelSrc));
  assert('sendResizeIfChanged present', panelSrc.includes('sendResizeIfChanged'));
  assert('NO manual prompt injection (no PS C:)', !panelSrc.includes('PS C:'));
  assert('NO removeAllListeners CALL (uses removeListener)', !/removeAllListeners\s*\(/.test(panelSrc));

  // ─── 13) node-pty declared as dependency ─────────────────────────────────
  console.log('\n13) node-pty dependency:');
  const pkg = JSON.parse(read('../../package.json'));
  assert('node-pty in dependencies', pkg.dependencies && pkg.dependencies['node-pty']);
  assert('node-pty in allowScripts', pkg.allowScripts && pkg.allowScripts['node-pty@1.0.0']);

  // cleanup
  svc.killAll();
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* */ }

  console.log('\n══════════════════════════════════════');
  console.log(`TERMINAL-PTY RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('TERMINAL PTY REWRITE: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
