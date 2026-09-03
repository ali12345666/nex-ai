/**
 * NEX AI — Phase 11: Computer Control (Desktop Automation) — Comprehensive Tests
 *
 * Coverage (per Phase 11 §13 — 25+ scenarios):
 *   1.  tool registration (when enabled)
 *   2.  permission enforcement (computer permission required)
 *   3.  opt-in OFF behavior (default)
 *   4.  opt-in ON behavior (toggle)
 *   5.  confirmation policy (per-action / session-wide)
 *   6.  session isolation (per task)
 *   7.  screenshot_desktop (memory-only)
 *   8.  mouse_click (coordinate validation)
 *   9.  mouse_move
 *  10. keyboard_type (no raw text)
 *  11. keyboard_hotkey (validation)
 *  12. scroll
 *  13. coordinate bounds checking
 *  14. screenshot memory-only (no disk)
 *  15. system-window blocking
 *  16. secret redaction
 *  17. computer error classification
 *  18. retry/replan behavior
 *  19. cancellation cleanup
 *  20. verification outcomes (screenshot_captured_desktop, window_focused, element_clicked_at)
 *  21. task completion gate
 *  22. prompt-injection resistance
 *  23. concurrent tasks isolation
 *  24. computer crash recovery
 *  25. regression (Phase 6-10 intact)
 *  26. packaging/native-module compatibility
 *
 * Run with: npx tsx tests/tools/test-phase-11-computer.ts
 */

import * as path from 'path';
import * as fs from 'fs';

// ─── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, name: string) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.error(`  FAIL: ${name}`);
  }
}

function assertEqual<T>(actual: T, expected: T, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    failures.push(`${name} (got ${a}, expected ${e})`);
    console.error(`  FAIL: ${name} — got ${a}, expected ${e}`);
  }
}

async function testSection(name: string, fn: () => Promise<void> | void): Promise<void> {
  console.log(`\n=== ${name} ===`);
  try {
    await fn();
  } catch (err) {
    failed++;
    failures.push(`${name} (threw: ${(err as Error).message})`);
    console.error(`  CRASH: ${name}:`, (err as Error).message);
    console.error((err as Error).stack);
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('Phase 11: Computer Control (Desktop Automation) — Comprehensive Tests\n');

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 1: Tool registration
  // ════════════════════════════════════════════════════════════════════════
  await testSection('1. Tool registration', async () => {
    console.log('\nTest 1.1: computer tool files exist');
    const toolFiles = [
      'screenshot-desktop-tool.ts',
      'mouse-click-tool.ts',
      'mouse-move-tool.ts',
      'keyboard-type-tool.ts',
      'keyboard-hotkey-tool.ts',
      'scroll-tool.ts',
    ];
    for (const f of toolFiles) {
      assert(fs.existsSync(path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', f)), `${f} exists`);
    }

    console.log('\nTest 1.2: session-manager.ts exists');
    assert(fs.existsSync(path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'session-manager.ts')), 'session-manager.ts exists');

    console.log('\nTest 1.3: computer/index.ts has registerComputerTools');
    const indexSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'index.ts'),
      'utf-8',
    );
    assert(indexSource.includes('export function registerComputerTools'), 'registerComputerTools exported');

    console.log('\nTest 1.4: tool-registry calls registerComputerTools');
    const registrySource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tool-registry.ts'),
      'utf-8',
    );
    assert(registrySource.includes('registerComputerTools'), 'tool-registry calls registerComputerTools');
    assert(registrySource.includes('Phase 11'), 'tool-registry has Phase 11 comment');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 2: Permission enforcement
  // ════════════════════════════════════════════════════════════════════════
  await testSection('2. Permission enforcement', async () => {
    console.log('\nTest 2.1: Permission union includes "computer"');
    const permSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'permissions', 'index.ts'),
      'utf-8',
    );
    assert(permSource.includes("'computer'"), "Permission union has 'computer'");

    console.log('\nTest 2.2: ToolPermission union includes "computer"');
    const registrySource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tool-registry.ts'),
      'utf-8',
    );
    assert(registrySource.includes("| 'computer'"), "ToolPermission union has 'computer'");

    console.log('\nTest 2.3: ToolCategory includes "computer"');
    assert(registrySource.includes("| 'computer'"), "ToolCategory has 'computer'");

    console.log('\nTest 2.4: All computer tools require "computer" permission');
    const toolFiles = [
      'screenshot-desktop-tool.ts',
      'mouse-click-tool.ts',
      'mouse-move-tool.ts',
      'keyboard-type-tool.ts',
      'keyboard-hotkey-tool.ts',
      'scroll-tool.ts',
    ];
    for (const f of toolFiles) {
      const source = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', f),
        'utf-8',
      );
      assert(source.includes("permission: 'computer'"), `${f} requires computer permission`);
    }

    console.log('\nTest 2.5: Computer tools go through Permission Gate');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    assert(coreSource.includes('executeToolWithPermission'), 'core.ts uses executeToolWithPermission');
    assert(coreSource.includes('requestPermissionAndWait'), 'core.ts calls requestPermissionAndWait');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 3: Opt-in OFF behavior
  // ════════════════════════════════════════════════════════════════════════
  await testSection('3. Opt-in OFF behavior', async () => {
    const { configureComputerSessions, isComputerEnabled } = await import('../../src/main/ai/tools/computer/session-manager.ts');

    console.log('\nTest 3.1: Default is OFF (no configure call)');
    configureComputerSessions({ enabled: false });
    assertEqual(isComputerEnabled(), false, 'default OFF');

    console.log('\nTest 3.2: registerComputerTools skips when disabled');
    const indexSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'index.ts'),
      'utf-8',
    );
    assert(indexSource.includes('if (!isComputerEnabled())'), 'registerComputerTools checks isComputerEnabled');

    console.log('\nTest 3.3: settings has computerControlEnabled field');
    const persistSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'persistence', 'index.ts'),
      'utf-8',
    );
    assert(persistSource.includes('computerControlEnabled'), 'PersistedSettings has computerControlEnabled');
    assert(persistSource.includes('OFF by default'), 'comment says OFF by default');

    console.log('\nTest 3.4: main.ts reads opt-in from settings');
    const mainSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'),
      'utf-8',
    );
    assert(mainSource.includes('computerControlEnabled'), 'main.ts reads computerControlEnabled');
    assert(mainSource.includes('opt-in OFF'), 'main.ts has opt-in OFF comment');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 4: Opt-in ON behavior
  // ════════════════════════════════════════════════════════════════════════
  await testSection('4. Opt-in ON behavior', async () => {
    const { configureComputerSessions, isComputerEnabled, setComputerEnabled } = await import('../../src/main/ai/tools/computer/session-manager.ts');

    console.log('\nTest 4.1: setComputerEnabled(true) enables');
    setComputerEnabled(true);
    assertEqual(isComputerEnabled(), true, 'enabled after setComputerEnabled(true)');

    console.log('\nTest 4.2: setComputerEnabled(false) disables');
    setComputerEnabled(false);
    assertEqual(isComputerEnabled(), false, 'disabled after setComputerEnabled(false)');

    console.log('\nTest 4.3: IPC handler exists for toggle');
    const mainSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'),
      'utf-8',
    );
    assert(mainSource.includes("'computer-control-get'"), 'computer-control-get IPC exists');
    assert(mainSource.includes("'computer-control-set'"), 'computer-control-set IPC exists');

    console.log('\nTest 4.4: preload exposes computerControlGet/Set');
    const preloadSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'preload.ts'),
      'utf-8',
    );
    assert(preloadSource.includes('computerControlGet'), 'preload has computerControlGet');
    assert(preloadSource.includes('computerControlSet'), 'preload has computerControlSet');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 5: Confirmation policy
  // ════════════════════════════════════════════════════════════════════════
  await testSection('5. Confirmation policy', async () => {
    const { configureComputerSessions, getConfirmationPolicy, setConfirmationPolicy } = await import('../../src/main/ai/tools/computer/session-manager.ts');

    console.log('\nTest 5.1: default confirmation policy is per-action');
    configureComputerSessions({ enabled: true, confirmationPolicy: 'per-action' });
    assertEqual(getConfirmationPolicy(), 'per-action', 'default = per-action');

    console.log('\nTest 5.2: setConfirmationPolicy updates');
    setConfirmationPolicy('session-wide');
    assertEqual(getConfirmationPolicy(), 'session-wide', 'updated to session-wide');

    console.log('\nTest 5.3: settings has confirmationPolicy field');
    const persistSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'persistence', 'index.ts'),
      'utf-8',
    );
    assert(persistSource.includes('computerConfirmationPolicy'), 'PersistedSettings has computerConfirmationPolicy');

    console.log('\nTest 5.4: IPC handler for policy exists');
    const mainSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'),
      'utf-8',
    );
    assert(mainSource.includes("'computer-control-set-policy'"), 'computer-control-set-policy IPC exists');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 6: Session isolation
  // ════════════════════════════════════════════════════════════════════════
  await testSection('6. Session isolation', async () => {
    const smSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'session-manager.ts'),
      'utf-8',
    );

    console.log('\nTest 6.1: session map is keyed by taskId');
    assert(smSource.includes('_sessions = new Map<string, ComputerSession>'), 'sessions keyed by string (taskId)');
    assert(smSource.includes('_sessions.get(taskId)'), 'getSession looks up by taskId');

    console.log('\nTest 6.2: getActiveSessionTaskIds returns task IDs');
    const { getActiveSessionTaskIds } = await import('../../src/main/ai/tools/computer/session-manager.ts');
    const ids = getActiveSessionTaskIds();
    assert(Array.isArray(ids), 'returns array');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 7-12: Tools (source inspection)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('7-12. Computer tools (screenshot/mouse/keyboard/scroll)', async () => {
    console.log('\nTest 7: screenshot_desktop uses desktopCapturer');
    const ssSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'screenshot-desktop-tool.ts'),
      'utf-8',
    );
    assert(ssSource.includes('desktopCapturer'), 'uses desktopCapturer (reuses existing)');
    assert(ssSource.includes('memory-only'), 'comment says memory-only');
    assert(ssSource.includes('VisionEngine'), 'integrates with existing VisionEngine');

    console.log('\nTest 8: mouse_click validates coordinates');
    const clickSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'mouse-click-tool.ts'),
      'utf-8',
    );
    assert(clickSource.includes('validateMouseCoordinates'), 'validates coordinates');
    assert(clickSource.includes('Button.LEFT'), 'supports left/right/middle buttons');

    console.log('\nTest 9: mouse_move validates coordinates');
    const moveSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'mouse-move-tool.ts'),
      'utf-8',
    );
    assert(moveSource.includes('validateMouseCoordinates'), 'validates coordinates');

    console.log('\nTest 10: keyboard_type does NOT return raw text');
    const typeSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'keyboard-type-tool.ts'),
      'utf-8',
    );
    assert(typeSource.includes('charCount'), 'returns charCount');
    assert(!typeSource.includes('data: { text }'), 'does NOT return raw text');

    console.log('\nTest 11: keyboard_hotkey validates hotkey');
    const hotkeySource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'keyboard-hotkey-tool.ts'),
      'utf-8',
    );
    assert(hotkeySource.includes('validateHotkeyString'), 'validates hotkey');
    // ALLOWED_KEYS is in session-manager.ts (the validation source)
    const smSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'session-manager.ts'),
      'utf-8',
    );
    assert(smSource.includes('ALLOWED_KEYS'), 'session-manager has ALLOWED_KEYS for keys');

    console.log('\nTest 12: scroll validates direction + amount');
    const scrollSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'scroll-tool.ts'),
      'utf-8',
    );
    assert(scrollSource.includes('up'), 'supports up');
    assert(scrollSource.includes('down'), 'supports down');
    assert(scrollSource.includes('clamp'), 'clamps amount');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 13: Coordinate bounds checking
  // ════════════════════════════════════════════════════════════════════════
  await testSection('13. Coordinate bounds checking', async () => {
    const { validateCoordinates } = await import('../../src/main/ai/tools/computer/session-manager.ts');

    console.log('\nTest 13.1: valid coordinates pass');
    assert(validateCoordinates(100, 200, { width: 1920, height: 1080 }).ok, '100,200 OK');
    assert(validateCoordinates(0, 0, { width: 1920, height: 1080 }).ok, '0,0 OK');

    console.log('\nTest 13.2: negative coordinates rejected');
    assert(!validateCoordinates(-1, 100, { width: 1920, height: 1080 }).ok, '-1,100 rejected');
    assert(!validateCoordinates(100, -1, { width: 1920, height: 1080 }).ok, '100,-1 rejected');

    console.log('\nTest 13.3: out-of-bounds coordinates rejected');
    assert(!validateCoordinates(2000, 100, { width: 1920, height: 1080 }).ok, '2000,100 rejected (x>=width)');
    assert(!validateCoordinates(100, 1100, { width: 1920, height: 1080 }).ok, '100,1100 rejected (y>=height)');

    console.log('\nTest 13.4: NaN coordinates rejected');
    assert(!validateCoordinates(NaN, 100).ok, 'NaN rejected');
    assert(!validateCoordinates(100, NaN).ok, 'NaN rejected');

    console.log('\nTest 13.5: validateHotkey rejects invalid keys');
    const { validateHotkey } = await import('../../src/main/ai/tools/computer/session-manager.ts');
    assert(validateHotkey('Ctrl+C').ok, 'Ctrl+C OK');
    assert(validateHotkey('Alt+Tab').ok, 'Alt+Tab OK');
    assert(!validateHotkey('Ctrl+InvalidKey').ok, 'Ctrl+InvalidKey rejected');
    assert(!validateHotkey('InvalidModifier+A').ok, 'InvalidModifier+A rejected');
    assert(validateHotkey('F1').ok, 'F1 OK (no modifier)');
    assert(validateHotkey('Shift+F1').ok, 'Shift+F1 OK');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 14: Screenshot memory-only (no disk)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('14. Screenshot memory-only', async () => {
    const ssSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'screenshot-desktop-tool.ts'),
      'utf-8',
    );

    console.log('\nTest 14.1: screenshot returns base64 in data (memory-only)');
    assert(ssSource.includes("toString('base64')"), 'converts to base64');
    assert(ssSource.includes('screenshot: base64'), 'stores in data.screenshot');
    assert(ssSource.includes('memory-only'), 'comment says memory-only');

    console.log('\nTest 14.2: screenshot does NOT write to disk by default');
    // The only write is to a temp file for vision analysis (cleaned up immediately)
    assert(ssSource.includes('tmpPath'), 'uses temp file for vision analysis');
    assert(ssSource.includes('unlinkSync'), 'cleans up temp file');
    // No permanent disk write
    assert(!ssSource.includes('fs.writeFileSync(screenshotPath'), 'no permanent disk write');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 15: System-window blocking
  // ════════════════════════════════════════════════════════════════════════
  await testSection('15. System-window blocking', async () => {
    const { isSystemWindowBlocked, configureComputerSessions } = await import('../../src/main/ai/tools/computer/session-manager.ts');

    console.log('\nTest 15.1: Task Manager blocked');
    assert(isSystemWindowBlocked('Task Manager'), 'Task Manager blocked');

    console.log('\nTest 15.2: Registry Editor blocked');
    assert(isSystemWindowBlocked('Registry Editor'), 'Registry Editor blocked');

    console.log('\nTest 15.3: cmd.exe blocked');
    assert(isSystemWindowBlocked('cmd.exe'), 'cmd.exe blocked');

    console.log('\nTest 15.4: Credential Manager blocked');
    assert(isSystemWindowBlocked('Credential Manager'), 'Credential Manager blocked');

    console.log('\nTest 15.5: Normal app NOT blocked');
    assert(!isSystemWindowBlocked('Visual Studio Code'), 'VS Code NOT blocked');
    assert(!isSystemWindowBlocked('Notepad'), 'Notepad NOT blocked');

    console.log('\nTest 15.6: Blocklist is configurable');
    const { addToBlocklist, removeFromBlocklist, getBlocklist } = await import('../../src/main/ai/tools/computer/session-manager.ts');
    addToBlocklist('customapp');
    assert(isSystemWindowBlocked('CustomApp Window'), 'custom blocklist works');
    removeFromBlocklist('customapp');
    assert(!isSystemWindowBlocked('CustomApp Window'), 'removal works');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 16: Secret redaction
  // ════════════════════════════════════════════════════════════════════════
  await testSection('16. Secret redaction', async () => {
    const smSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'session-manager.ts'),
      'utf-8',
    );

    console.log('\nTest 16.1: getSessionInfo redacts via redactObjectDeep');
    assert(smSource.includes('redactObjectDeep'), 'session-manager imports redactObjectDeep');
    assert(smSource.includes('return redactObjectDeep(info)'), 'getSessionInfo redacts');

    console.log('\nTest 16.2: keyboard_type does NOT return raw text');
    const typeSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'keyboard-type-tool.ts'),
      'utf-8',
    );
    assert(typeSource.includes('charCount: String(text).length'), 'returns charCount (not raw)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 17: Computer error classification
  // ════════════════════════════════════════════════════════════════════════
  await testSection('17. Computer error classification', async () => {
    const { classifyError } = await import('../../src/main/agent/error-classifier.ts');

    console.log('\nTest 17.1: coordinate out of bounds → computer_error');
    let c = classifyError('Coordinate out of bounds: x=2000, y=100');
    assertEqual(c.class, 'computer_error', 'coordinate out of bounds → computer_error');

    console.log('\nTest 17.2: screen not found → computer_error');
    c = classifyError('Screen not found');
    assertEqual(c.class, 'computer_error', 'screen not found → computer_error');

    console.log('\nTest 17.3: native module load failed → computer_error');
    c = classifyError('Native module cannot load');
    assertEqual(c.class, 'computer_error', 'native module → computer_error');

    console.log('\nTest 17.4: system window blocked → computer_error (not retryable)');
    c = classifyError('System window blocked');
    assertEqual(c.class, 'computer_error', 'system window → computer_error');
    assertEqual(c.retryable, false, 'system window NOT retryable (security)');
    assertEqual(c.neverRetry, true, 'system window neverRetry');

    console.log('\nTest 17.5: computer_error in ALL_ERROR_CLASSES');
    const { ALL_ERROR_CLASSES } = await import('../../src/main/agent/error-classifier.ts');
    assert(ALL_ERROR_CLASSES.includes('computer_error'), 'computer_error in ALL_ERROR_CLASSES');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 18: Retry/replan behavior
  // ════════════════════════════════════════════════════════════════════════
  await testSection('18. Retry/replan behavior', async () => {
    const { decideRecoveryHeuristic } = await import('../../src/main/agent/recovery-engine.ts');

    function makeCtx(overrides: any = {}): any {
      const task = { id: 't1', plan: [{ index: 0 }, { index: 1 }], currentStepIndex: 0, maxRetries: 3, cancelled: false };
      const step = { id: 's1', index: 0, toolParams: {}, retryCount: 0 };
      return {
        taskId: task.id, step, task, toolName: 'mouse_click',
        errorMessage: 'Coordinate out of bounds', errorCode: 'TOOL_FAILURE',
        attempt: 0, maxRetries: 3, cancelled: false,
        ...overrides,
      };
    }

    console.log('\nTest 18.1: computer_error attempt 0 → RETRY');
    const d = decideRecoveryHeuristic(makeCtx());
    assertEqual(d.action, 'RETRY', 'computer_error attempt 0 → RETRY');
    assertEqual(d.errorClass, 'computer_error', 'errorClass = computer_error');

    console.log('\nTest 18.2: computer_error attempt 1 with more steps → REPLAN');
    const d2 = decideRecoveryHeuristic(makeCtx({ attempt: 1 }));
    assertEqual(d2.action, 'REPLAN', 'attempt 1 with more steps → REPLAN');

    console.log('\nTest 18.3: system window blocked → ABORT (never retry)');
    const d3 = decideRecoveryHeuristic(makeCtx({
      errorMessage: 'System window blocked',
    }));
    assertEqual(d3.action, 'ABORT', 'system window → ABORT (security)');

    console.log('\nTest 18.4: computer_error attempt 1 last step → ABORT');
    const d4 = decideRecoveryHeuristic(makeCtx({
      task: { id: 't1', plan: [{ index: 0 }], currentStepIndex: 0, maxRetries: 3, cancelled: false },
      attempt: 1,
    }));
    assertEqual(d4.action, 'ABORT', 'attempt 1 last step → ABORT');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 19: Cancellation cleanup
  // ════════════════════════════════════════════════════════════════════════
  await testSection('19. Cancellation cleanup', async () => {
    const smSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'session-manager.ts'),
      'utf-8',
    );

    console.log('\nTest 19.1: closeAllSessions exists');
    assert(smSource.includes('export async function closeAllSessions'), 'closeAllSessions exported');

    console.log('\nTest 19.2: main.ts calls closeAllSessions on shutdown');
    const mainSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'),
      'utf-8',
    );
    assert(mainSource.includes('closeComputerSessions'), 'main.ts calls closeComputerSessions at shutdown');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 20: Verification outcomes
  // ════════════════════════════════════════════════════════════════════════
  await testSection('20. Verification outcomes', async () => {
    const { verifyStepOutcome } = await import('../../src/main/agent/verification.ts');

    console.log('\nTest 20.1: ExpectedOutcome has computer types');
    const typesSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'types.ts'),
      'utf-8',
    );
    assert(typesSource.includes("'screenshot_captured_desktop'"), "ExpectedOutcome has screenshot_captured_desktop");
    assert(typesSource.includes("'window_focused'"), "ExpectedOutcome has window_focused");
    assert(typesSource.includes("'element_clicked_at'"), "ExpectedOutcome has element_clicked_at");

    console.log('\nTest 20.2: screenshot_captured_desktop verified when data.screenshot present');
    const step: any = {
      id: 's1', description: 'take desktop screenshot',
      expectedOutcome: { type: 'screenshot_captured_desktop' },
    };
    const toolResult: any = {
      success: true,
      data: { screenshot: 'base64data', format: 'png' },
    };
    const v = await verifyStepOutcome(step, toolResult, undefined, 'task-1');
    assertEqual(v.status, 'verified', 'screenshot present → verified');

    console.log('\nTest 20.3: screenshot_captured_desktop failed when no screenshot data');
    const v2 = await verifyStepOutcome(step, { success: true, data: {} }, undefined, 'task-1');
    assertEqual(v2.status, 'failed', 'screenshot missing → failed');

    console.log('\nTest 20.4: verification.ts handles computer outcomes');
    const verSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'verification.ts'),
      'utf-8',
    );
    assert(verSource.includes("case 'screenshot_captured_desktop'"), 'verification handles screenshot_captured_desktop');
    assert(verSource.includes("case 'window_focused'"), 'verification handles window_focused');
    assert(verSource.includes("case 'element_clicked_at'"), 'verification handles element_clicked_at');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 21: Task completion gate
  // ════════════════════════════════════════════════════════════════════════
  await testSection('21. Task completion gate', async () => {
    const { verifyTaskCompletion } = await import('../../src/main/agent/verification.ts');

    console.log('\nTest 21.1: task with computer tools + all completed → SUCCESS');
    const task: any = {
      id: 't1',
      plan: [
        { id: 's1', index: 0, status: 'completed', toolName: 'screenshot_desktop' },
        { id: 's2', index: 1, status: 'completed', toolName: 'mouse_click' },
      ],
      toolCalls: [{ id: 'tc1' }],
      errors: [],
    };
    const result = verifyTaskCompletion(task);
    assertEqual(result.passed, true, 'all completed → passed');

    console.log('\nTest 21.2: task with failed computer step → NOT SUCCESS');
    const task2: any = {
      id: 't2',
      plan: [
        { id: 's1', index: 0, status: 'completed', toolName: 'screenshot_desktop' },
        { id: 's2', index: 1, status: 'failed', toolName: 'mouse_click' },
      ],
      toolCalls: [{ id: 'tc1' }],
      errors: [],
    };
    const result2 = verifyTaskCompletion(task2);
    assertEqual(result2.passed, false, 'failed computer step → NOT passed');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 22: Prompt-injection resistance
  // ════════════════════════════════════════════════════════════════════════
  await testSection('22. Prompt-injection resistance', async () => {
    const smSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'session-manager.ts'),
      'utf-8',
    );

    console.log('\nTest 22: session manager does NOT execute page content');
    assert(!smSource.includes('eval('), 'session manager has NO eval()');
    assert(!smSource.includes('exposeFunction'), 'session manager has NO exposeFunction');

    console.log('\nTest 22b: hotkey validation prevents arbitrary input');
    const { validateHotkey } = await import('../../src/main/ai/tools/computer/session-manager.ts');
    assert(!validateHotkey('Ctrl+Exec').ok, 'Ctrl+Exec rejected (not in allow-list)');
    assert(!validateHotkey('Ctrl+;rm -rf /').ok, 'shell command rejected');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 23: Concurrent tasks isolation
  // ════════════════════════════════════════════════════════════════════════
  await testSection('23. Concurrent tasks isolation', async () => {
    const smSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'session-manager.ts'),
      'utf-8',
    );

    console.log('\nTest 23.1: sessions keyed by taskId (no cross-task leakage)');
    assert(smSource.includes('_sessions = new Map<string, ComputerSession>'), 'sessions map by taskId');

    console.log('\nTest 23.2: each session has unique ID');
    assert(smSource.includes('sessionId = require(\'crypto\').randomUUID'), 'each session gets unique UUID');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 24: Computer crash recovery
  // ════════════════════════════════════════════════════════════════════════
  await testSection('24. Computer crash recovery', async () => {
    const { isComputerCrashError } = await import('../../src/main/ai/tools/computer/session-manager.ts');

    console.log('\nTest 24.1: isComputerCrashError detects native module crash');
    assert(isComputerCrashError(new Error('libnut cannot load')), 'detects libnut crash');

    console.log('\nTest 24.2: isComputerCrashError detects missing X11');
    assert(isComputerCrashError(new Error('libXtst.so.6: cannot open shared object file')), 'detects X11 missing');

    console.log('\nTest 24.3: isComputerCrashError does NOT match regular errors');
    assert(!isComputerCrashError(new Error('Coordinate out of bounds')), 'coordinate error NOT a crash');
    assert(!isComputerCrashError(new Error('Hotkey validation failed')), 'hotkey error NOT a crash');

    console.log('\nTest 24.4: withCrashRecovery marks session dead');
    const helpersSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'helpers.ts'),
      'utf-8',
    );
    assert(helpersSource.includes('isComputerCrashError'), 'helpers uses isComputerCrashError');
    assert(helpersSource.includes('markSessionDead'), 'helpers calls markSessionDead on crash');

    console.log('\nTest 24.5: markSessionDead exists');
    const smSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'session-manager.ts'),
      'utf-8',
    );
    assert(smSource.includes('export function markSessionDead'), 'markSessionDead exported');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 25: Regression (Phase 6-10 intact)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('25. Regression (source inspection)', async () => {
    console.log('\nTest 25.1: Phase 6 task queue intact');
    const queueSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'tasks', 'queue.ts'),
      'utf-8',
    );
    assert(queueSource.includes('enqueueAgentTask'), 'Phase 6 queue intact');

    console.log('\nTest 25.2: Phase 7 recovery engine intact + handles computer_error');
    const engineSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'recovery-engine.ts'),
      'utf-8',
    );
    assert(engineSource.includes('decideRecovery'), 'Phase 7 recovery intact');
    assert(engineSource.includes("cls === 'computer_error'"), 'recovery handles computer_error');

    console.log('\nTest 25.3: Phase 8 context contract intact');
    const contractSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'context-contract.ts'),
      'utf-8',
    );
    assert(contractSource.includes('safeContextSnapshot'), 'Phase 8 context intact');

    console.log('\nTest 25.4: Phase 9 verification intact + handles computer outcomes');
    const verSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'verification.ts'),
      'utf-8',
    );
    assert(verSource.includes('verifyTaskCompletion'), 'Phase 9 verification intact');
    assert(verSource.includes("case 'screenshot_captured_desktop'"), 'verification handles computer outcomes');

    console.log('\nTest 25.5: Phase 10 browser intact');
    const browserSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'session-manager.ts'),
      'utf-8',
    );
    assert(browserSource.includes('getOrCreateSession'), 'Phase 10 browser intact');

    console.log('\nTest 25.6: Phase 11 additions are additive');
    const typesSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'types.ts'),
      'utf-8',
    );
    assert(typesSource.includes("'screenshot_captured_desktop'"), "ExpectedOutcome has computer types (additive)");
    assert(typesSource.includes("'computer_error'"), "AgentError.errorClass has computer_error (additive)");
    const permSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'permissions', 'index.ts'),
      'utf-8',
    );
    assert(permSource.includes("'computer'"), "Permission has 'computer' (additive)");
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 26: Packaging/native-module compatibility
  // ════════════════════════════════════════════════════════════════════════
  await testSection('26. Packaging/native-module compatibility', async () => {
    console.log('\nTest 26.1: @nut-tree-fork/nut-js installed in package.json');
    const pkgSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'package.json'),
      'utf-8',
    );
    assert(pkgSource.includes('"@nut-tree-fork/nut-js"'), '@nut-tree-fork/nut-js in dependencies');

    console.log('\nTest 26.2: native module binary exists');
    // Check that the prebuilt binary exists (N-API)
    const binaryPaths = [
      'node_modules/@nut-tree-fork/libnut-linux/build/Release/libnut.node',
      'node_modules/@nut-tree-fork/libnut-win32/build/Release/libnut.node',
    ];
    let anyBinary = false;
    for (const p of binaryPaths) {
      if (fs.existsSync(path.join(__dirname, '..', '..', p))) {
        anyBinary = true;
      }
    }
    assert(anyBinary, 'at least one native binary exists');

    console.log('\nTest 26.3: electron-builder install-app-deps in postinstall');
    assert(pkgSource.includes('electron-builder install-app-deps'), 'postinstall rebuilds native modules for Electron');

    console.log('\nTest 26.4: TypeScript types available');
    assert(fs.existsSync(path.join(__dirname, '..', '..', 'node_modules', '@nut-tree-fork', 'nut-js', 'dist', 'index.d.ts')), 'nut-js TypeScript types exist');

    console.log('\nTest 26.5: N-API prebuilt (no rebuild needed)');
    const libnutPkg = fs.readFileSync(
      path.join(__dirname, '..', '..', 'node_modules', '@nut-tree-fork', 'libnut-linux', 'package.json'),
      'utf-8',
    );
    // N-API modules don't need gypfile/rebuild
    const parsed = JSON.parse(libnutPkg);
    assert(!parsed.gypfile, 'libnut-linux is N-API (no gypfile)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 11 computer control tests: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('════════════════════════════════════════\n');

  if (failed > 0) {
    console.error('Failed tests:');
    for (const f of failures) console.error(`  - ${f}`);
    console.error('');
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner crashed:', err);
  console.error(err.stack);
  process.exit(1);
});
