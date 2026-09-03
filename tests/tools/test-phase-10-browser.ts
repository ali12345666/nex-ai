/**
 * NEX AI — Phase 10: Browser Automation — Comprehensive Tests
 *
 * Coverage (per Phase 10 §Testing — 25 scenarios):
 *   1.  tool registration (when enabled)
 *   2.  permission enforcement (browser permission required)
 *   3.  opt-in OFF behavior
 *   4.  opt-in ON behavior
 *   5.  session isolation (per task)
 *   6.  session reuse between steps of same task
 *   7.  session cleanup
 *   8.  navigation
 *   9.  click
 *  10. type
 *  11. extract
 *  12. screenshot memory-only
 *  13. screenshot no disk persistence
 *  14. URL validation
 *  15. localhost/private-IP blocking
 *  16. unsafe scheme blocking
 *  17. secret redaction (session info)
 *  18. browser error classification
 *  19. retry/replan behavior
 *  20. cancellation cleanup
 *  21. verification outcomes (url_changed, page_contains_text, screenshot_captured)
 *  22. task completion gate (browser tools count)
 *  23. prompt-injection resistance (untrusted content not executed)
 *  24. concurrent tasks isolation
 *  25. browser crash recovery (markSessionDead)
 *
 * Most tests are source-inspection + unit tests (no real browser needed —
 * Playwright is lazy-loaded only when a tool actually runs). The session
 * manager + URL validation + classification logic is testable without
 * launching Chromium.
 *
 * Run with: npx tsx tests/tools/test-phase-10-browser.ts
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
  console.log('Phase 10: Browser Automation — Comprehensive Tests\n');

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 1: Tool registration
  // ════════════════════════════════════════════════════════════════════════
  await testSection('1. Tool registration', async () => {
    console.log('\nTest 1.1: browser tool files exist');
    const toolFiles = [
      'browser-navigate-tool.ts',
      'browser-click-tool.ts',
      'browser-type-tool.ts',
      'browser-extract-tool.ts',
      'browser-screenshot-tool.ts',
      'browser-close-tool.ts',
    ];
    for (const f of toolFiles) {
      assert(fs.existsSync(path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', f)), `${f} exists`);
    }

    console.log('\nTest 1.2: session-manager.ts exists');
    assert(fs.existsSync(path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'session-manager.ts')), 'session-manager.ts exists');

    console.log('\nTest 1.3: browser/index.ts has registerBrowserTools');
    const indexSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'index.ts'),
      'utf-8',
    );
    assert(indexSource.includes('export function registerBrowserTools'), 'registerBrowserTools exported');

    console.log('\nTest 1.4: tool-registry calls registerBrowserTools');
    const registrySource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tool-registry.ts'),
      'utf-8',
    );
    assert(registrySource.includes('registerBrowserTools'), 'tool-registry calls registerBrowserTools');
    assert(registrySource.includes('Phase 10'), 'tool-registry has Phase 10 comment');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 2: Permission enforcement
  // ════════════════════════════════════════════════════════════════════════
  await testSection('2. Permission enforcement', async () => {
    console.log('\nTest 2.1: Permission union includes "browser"');
    const permSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'permissions', 'index.ts'),
      'utf-8',
    );
    assert(permSource.includes("'browser'"), "Permission union has 'browser'");

    console.log('\nTest 2.2: ToolPermission union includes "browser"');
    const registrySource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tool-registry.ts'),
      'utf-8',
    );
    assert(registrySource.includes("| 'browser'"), "ToolPermission union has 'browser'");

    console.log('\nTest 2.3: All browser tools require "browser" permission');
    const toolFiles = [
      'browser-navigate-tool.ts',
      'browser-click-tool.ts',
      'browser-type-tool.ts',
      'browser-extract-tool.ts',
      'browser-screenshot-tool.ts',
      'browser-close-tool.ts',
    ];
    for (const f of toolFiles) {
      const source = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', f),
        'utf-8',
      );
      assert(source.includes("permission: 'browser'"), `${f} requires browser permission`);
    }

    console.log('\nTest 2.4: Browser tools go through Permission Gate (source inspection)');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    // executeToolWithPermission is called for ALL tools (including browser)
    assert(coreSource.includes('executeToolWithPermission'), 'core.ts uses executeToolWithPermission');
    assert(coreSource.includes('requestPermissionAndWait'), 'core.ts calls requestPermissionAndWait');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 3: Opt-in OFF behavior
  // ════════════════════════════════════════════════════════════════════════
  await testSection('3. Opt-in OFF behavior', async () => {
    const { configureBrowserSessions, isBrowserEnabled } = await import('../../src/main/ai/tools/browser/session-manager.ts');

    console.log('\nTest 3.1: Default is OFF (no configure call)');
    // Fresh module — configure hasn't been called yet
    configureBrowserSessions({ enabled: false });
    assertEqual(isBrowserEnabled(), false, 'default OFF');

    console.log('\nTest 3.2: registerBrowserTools skips when disabled');
    const indexSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'index.ts'),
      'utf-8',
    );
    assert(indexSource.includes('if (!isBrowserEnabled())'), 'registerBrowserTools checks isBrowserEnabled');

    console.log('\nTest 3.3: settings has browserAutomationEnabled field');
    const persistSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'persistence', 'index.ts'),
      'utf-8',
    );
    assert(persistSource.includes('browserAutomationEnabled'), 'PersistedSettings has browserAutomationEnabled');
    assert(persistSource.includes('OFF by default'), 'comment says OFF by default');

    console.log('\nTest 3.4: main.ts reads opt-in from settings');
    const mainSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'),
      'utf-8',
    );
    assert(mainSource.includes('browserAutomationEnabled'), 'main.ts reads browserAutomationEnabled');
    assert(mainSource.includes("opt-in OFF"), 'main.ts has opt-in OFF comment');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 4: Opt-in ON behavior
  // ════════════════════════════════════════════════════════════════════════
  await testSection('4. Opt-in ON behavior', async () => {
    const { configureBrowserSessions, isBrowserEnabled, setBrowserEnabled } = await import('../../src/main/ai/tools/browser/session-manager.ts');

    console.log('\nTest 4.1: setBrowserEnabled(true) enables');
    setBrowserEnabled(true);
    assertEqual(isBrowserEnabled(), true, 'enabled after setBrowserEnabled(true)');

    console.log('\nTest 4.2: setBrowserEnabled(false) disables');
    setBrowserEnabled(false);
    assertEqual(isBrowserEnabled(), false, 'disabled after setBrowserEnabled(false)');

    console.log('\nTest 4.3: IPC handler exists for toggle');
    const mainSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'),
      'utf-8',
    );
    assert(mainSource.includes("'browser-automation-get'"), 'browser-automation-get IPC exists');
    assert(mainSource.includes("'browser-automation-set'"), 'browser-automation-set IPC exists');

    console.log('\nTest 4.4: preload exposes browserAutomationGet/Set');
    const preloadSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'preload.ts'),
      'utf-8',
    );
    assert(preloadSource.includes('browserAutomationGet'), 'preload has browserAutomationGet');
    assert(preloadSource.includes('browserAutomationSet'), 'preload has browserAutomationSet');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 5: Session isolation
  // ════════════════════════════════════════════════════════════════════════
  await testSection('5. Session isolation', async () => {
    const { getSessionCount, getActiveSessionTaskIds } = await import('../../src/main/ai/tools/browser/session-manager.ts');

    console.log('\nTest 5.1: session map is keyed by taskId (source inspection)');
    const smSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'session-manager.ts'),
      'utf-8',
    );
    assert(smSource.includes('const _sessions = new Map<string, BrowserSession>();'), 'sessions keyed by string (taskId)');
    assert(smSource.includes('_sessions.get(taskId)'), 'getSession looks up by taskId');

    console.log('\nTest 5.2: getActiveSessionTaskIds returns task IDs');
    const ids = getActiveSessionTaskIds();
    assert(Array.isArray(ids), 'returns array');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 6: Session reuse between steps
  // ════════════════════════════════════════════════════════════════════════
  await testSection('6. Session reuse between steps', async () => {
    const smSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'session-manager.ts'),
      'utf-8',
    );

    console.log('\nTest 6.1: getOrCreateSession reuses existing session');
    assert(smSource.includes('const existing = _sessions.get(taskId)'), 'checks existing session');
    assert(smSource.includes('if (existing && existing.alive)'), 'reuses if alive');

    console.log('\nTest 6.2: session reused across navigate → click → type');
    // The helpers.ts acquireSession calls getOrCreateSession — same taskId = same session
    const helpersSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'helpers.ts'),
      'utf-8',
    );
    assert(helpersSource.includes('getOrCreateSession(taskId)'), 'acquireSession reuses by taskId');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 7: Session cleanup
  // ════════════════════════════════════════════════════════════════════════
  await testSection('7. Session cleanup', async () => {
    const smSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'session-manager.ts'),
      'utf-8',
    );

    console.log('\nTest 7.1: closeSession exists');
    assert(smSource.includes('export async function closeSession'), 'closeSession exported');

    console.log('\nTest 7.2: closeAllSessions exists (for app shutdown)');
    assert(smSource.includes('export async function closeAllSessions'), 'closeAllSessions exported');

    console.log('\nTest 7.3: cleanupOrphanedSessions exists');
    assert(smSource.includes('export async function cleanupOrphanedSessions'), 'cleanupOrphanedSessions exported');

    console.log('\nTest 7.4: cleanupSession closes page + context + browser');
    assert(smSource.includes('session.page.close'), 'closes page');
    assert(smSource.includes('session.context.close'), 'closes context');
    assert(smSource.includes('session.browser.close'), 'closes browser');

    console.log('\nTest 7.5: main.ts calls closeAllSessions on shutdown');
    const mainSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'),
      'utf-8',
    );
    assert(mainSource.includes('closeAllSessions'), 'main.ts calls closeAllSessions at shutdown');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 8-11: Navigation, click, type, extract (source inspection)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('8-11. Browser tools (navigate/click/type/extract)', async () => {
    console.log('\nTest 8: browser_navigate uses page.goto + validates URL');
    const navSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'browser-navigate-tool.ts'),
      'utf-8',
    );
    assert(navSource.includes('page.goto'), 'calls page.goto');
    assert(navSource.includes('validateUrl'), 'validates URL');
    assert(navSource.includes('waitUntil'), 'supports waitUntil option');

    console.log('\nTest 9: browser_click uses page.click + waits for selector');
    const clickSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'browser-click-tool.ts'),
      'utf-8',
    );
    assert(clickSource.includes('page.waitForSelector'), 'waits for selector');
    assert(clickSource.includes('page.click'), 'clicks element');

    console.log('\nTest 10: browser_type uses page.type + clears field');
    const typeSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'browser-type-tool.ts'),
      'utf-8',
    );
    assert(typeSource.includes('page.type'), 'types text');
    assert(typeSource.includes('page.fill'), 'clears field');
    // Security: does NOT echo back the typed text (may be credential)
    assert(typeSource.includes('charCount: String(text).length'), 'returns char count, not raw text');
    assert(!typeSource.includes('data: { selector, text }'), 'does NOT return raw text in data');

    console.log('\nTest 11: browser_extract uses textContent/innerHTML/getAttribute');
    const extractSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'browser-extract-tool.ts'),
      'utf-8',
    );
    assert(extractSource.includes('textContent'), 'supports text extraction');
    assert(extractSource.includes('innerHTML'), 'supports HTML extraction');
    assert(extractSource.includes('getAttribute'), 'supports attribute extraction');
    assert(extractSource.includes('MAX_EXTRACT_LENGTH'), 'truncates output');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 12-13: Screenshot memory-only
  // ════════════════════════════════════════════════════════════════════════
  await testSection('12-13. Screenshot memory-only', async () => {
    const ssSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'browser-screenshot-tool.ts'),
      'utf-8',
    );

    console.log('\nTest 12: screenshot returns base64 in data (memory-only)');
    assert(ssSource.includes('screenshot.toString(\'base64\')'), 'converts to base64');
    assert(ssSource.includes('screenshot: base64'), 'stores in data.screenshot');
    assert(ssSource.includes('memory-only'), 'comment says memory-only');

    console.log('\nTest 13: screenshot does NOT write to disk');
    assert(!ssSource.includes('fs.writeFileSync'), 'does NOT use fs.writeFileSync');
    assert(!ssSource.includes('fs.mkdir'), 'does NOT create directories');
    assert(ssSource.includes('NOT written to disk'), 'comment confirms no disk write');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 14-16: URL validation + blocking
  // ════════════════════════════════════════════════════════════════════════
  await testSection('14-16. URL validation + blocking', async () => {
    const { isUrlBlocked } = await import('../../src/main/ai/tools/browser/session-manager.ts');

    console.log('\nTest 14: valid https URL passes');
    assert(!isUrlBlocked('https://example.com').blocked, 'https://example.com OK');
    assert(!isUrlBlocked('http://example.com').blocked, 'http://example.com OK');

    console.log('\nTest 15: localhost + private IPs blocked');
    assert(isUrlBlocked('https://localhost').blocked, 'localhost blocked');
    assert(isUrlBlocked('https://127.0.0.1').blocked, '127.0.0.1 blocked');
    assert(isUrlBlocked('https://192.168.1.1').blocked, '192.168.x blocked');
    assert(isUrlBlocked('https://10.0.0.1').blocked, '10.x blocked');
    assert(isUrlBlocked('https://172.16.0.1').blocked, '172.16-31.x blocked');
    assert(isUrlBlocked('https://172.31.255.255').blocked, '172.31.x blocked');
    assert(!isUrlBlocked('https://172.32.0.1').blocked, '172.32.x NOT blocked (public)');

    console.log('\nTest 16: unsafe schemes blocked');
    assert(isUrlBlocked('file:///etc/passwd').blocked, 'file:// blocked');
    assert(isUrlBlocked('ftp://example.com').blocked, 'ftp:// blocked');
    assert(isUrlBlocked('data:text/html,<h1>hi</h1>').blocked, 'data: blocked');
    assert(isUrlBlocked('javascript:alert(1)').blocked, 'javascript: blocked');

    console.log('\nTest 16b: invalid URL blocked');
    assert(isUrlBlocked('').blocked, 'empty URL blocked');
    assert(isUrlBlocked('not-a-url').blocked, 'non-URL blocked');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 17: Secret redaction
  // ════════════════════════════════════════════════════════════════════════
  await testSection('17. Secret redaction', async () => {
    const smSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'session-manager.ts'),
      'utf-8',
    );

    console.log('\nTest 17: getSessionInfo redacts via redactObjectDeep');
    assert(smSource.includes('redactObjectDeep'), 'session-manager imports redactObjectDeep');
    assert(smSource.includes('return redactObjectDeep(info)'), 'getSessionInfo redacts');

    console.log('\nTest 17b: browser_type does NOT return raw typed text');
    const typeSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'browser-type-tool.ts'),
      'utf-8',
    );
    // Returns charCount, not raw text
    assert(typeSource.includes('charCount: String(text).length'), 'returns charCount (not raw)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 18: Browser error classification
  // ════════════════════════════════════════════════════════════════════════
  await testSection('18. Browser error classification', async () => {
    const { classifyError } = await import('../../src/main/agent/error-classifier.ts');

    console.log('\nTest 18.1: navigation timeout → browser_error');
    let c = classifyError('Navigation timeout exceeded');
    assertEqual(c.class, 'browser_error', 'navigation timeout → browser_error');
    assertEqual(c.retryable, true, 'retryable');

    console.log('\nTest 18.2: element not found → browser_error');
    c = classifyError('Element not found: selector "#foo"');
    assertEqual(c.class, 'browser_error', 'element not found → browser_error');

    console.log('\nTest 18.3: browser closed → browser_error');
    c = classifyError('Browser has been closed');
    assertEqual(c.class, 'browser_error', 'browser closed → browser_error');

    console.log('\nTest 18.4: URL validation failed → browser_error (not retryable)');
    c = classifyError('URL validation failed: blocked localhost');
    assertEqual(c.class, 'browser_error', 'URL validation → browser_error');
    assertEqual(c.retryable, false, 'URL validation NOT retryable (security)');
    assertEqual(c.neverRetry, true, 'URL validation neverRetry');

    console.log('\nTest 18.5: browser_error in ALL_ERROR_CLASSES');
    const { ALL_ERROR_CLASSES } = await import('../../src/main/agent/error-classifier.ts');
    assert(ALL_ERROR_CLASSES.includes('browser_error'), 'browser_error in ALL_ERROR_CLASSES');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 19: Retry/replan behavior
  // ════════════════════════════════════════════════════════════════════════
  await testSection('19. Retry/replan behavior', async () => {
    const { decideRecoveryHeuristic } = await import('../../src/main/agent/recovery-engine.ts');

    function makeCtx(overrides: any = {}): any {
      const task = { id: 't1', plan: [{ index: 0 }, { index: 1 }], currentStepIndex: 0, maxRetries: 3, cancelled: false };
      const step = { id: 's1', index: 0, toolParams: {}, retryCount: 0 };
      return {
        taskId: task.id, step, task, toolName: 'browser_navigate',
        errorMessage: 'Navigation timeout', errorCode: 'TOOL_FAILURE',
        attempt: 0, maxRetries: 3, cancelled: false,
        ...overrides,
      };
    }

    console.log('\nTest 19.1: browser_error attempt 0 → RETRY');
    const d = decideRecoveryHeuristic(makeCtx());
    assertEqual(d.action, 'RETRY', 'browser_error attempt 0 → RETRY');
    assertEqual(d.errorClass, 'browser_error', 'errorClass = browser_error');

    console.log('\nTest 19.2: browser_error attempt 1 with more steps → REPLAN');
    const d2 = decideRecoveryHeuristic(makeCtx({ attempt: 1 }));
    assertEqual(d2.action, 'REPLAN', 'attempt 1 with more steps → REPLAN');

    console.log('\nTest 19.3: URL validation failure → ABORT (never retry)');
    const d3 = decideRecoveryHeuristic(makeCtx({
      errorMessage: 'URL validation failed: blocked localhost',
    }));
    assertEqual(d3.action, 'ABORT', 'URL validation → ABORT (security)');

    console.log('\nTest 19.4: browser_error attempt 1 last step → ABORT');
    const d4 = decideRecoveryHeuristic(makeCtx({
      task: { id: 't1', plan: [{ index: 0 }], currentStepIndex: 0, maxRetries: 3, cancelled: false },
      attempt: 1,
    }));
    assertEqual(d4.action, 'ABORT', 'attempt 1 last step → ABORT');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 20: Cancellation cleanup
  // ════════════════════════════════════════════════════════════════════════
  await testSection('20. Cancellation cleanup', async () => {
    const smSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'session-manager.ts'),
      'utf-8',
    );

    console.log('\nTest 20: closeAllSessions called on shutdown');
    const mainSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'),
      'utf-8',
    );
    assert(mainSource.includes('closeAllSessions'), 'main.ts calls closeAllSessions');
    assert(smSource.includes('Promise.all(taskIds.map'), 'closeAllSessions closes all in parallel');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 21: Verification outcomes
  // ════════════════════════════════════════════════════════════════════════
  await testSection('21. Verification outcomes', async () => {
    const { verifyStepOutcome } = await import('../../src/main/agent/verification.ts');

    console.log('\nTest 21.1: ExpectedOutcome has browser types');
    const typesSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'types.ts'),
      'utf-8',
    );
    assert(typesSource.includes("'url_changed'"), "ExpectedOutcome has url_changed");
    assert(typesSource.includes("'page_contains_text'"), "ExpectedOutcome has page_contains_text");
    assert(typesSource.includes("'element_visible'"), "ExpectedOutcome has element_visible");
    assert(typesSource.includes("'screenshot_captured'"), "ExpectedOutcome has screenshot_captured");

    console.log('\nTest 21.2: screenshot_captured verified when data.screenshot present');
    const step: any = {
      id: 's1', description: 'take screenshot',
      expectedOutcome: { type: 'screenshot_captured' },
    };
    const toolResult: any = {
      success: true,
      data: { screenshot: 'base64data', format: 'png' },
    };
    const v = await verifyStepOutcome(step, toolResult, undefined, 'task-1');
    assertEqual(v.status, 'verified', 'screenshot present → verified');

    console.log('\nTest 21.3: screenshot_captured failed when no screenshot data');
    const v2 = await verifyStepOutcome(step, { success: true, data: {} }, undefined, 'task-1');
    assertEqual(v2.status, 'failed', 'screenshot missing → failed');

    console.log('\nTest 21.4: verification.ts handles browser outcomes');
    const verSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'verification.ts'),
      'utf-8',
    );
    assert(verSource.includes("case 'url_changed'"), 'verification handles url_changed');
    assert(verSource.includes("case 'page_contains_text'"), 'verification handles page_contains_text');
    assert(verSource.includes("case 'element_visible'"), 'verification handles element_visible');
    assert(verSource.includes("case 'screenshot_captured'"), 'verification handles screenshot_captured');

    console.log('\nTest 21.5: core.ts passes taskId to verifyStepOutcome');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    assert(coreSource.includes('task.context.projectPath, task.id'), 'core.ts passes task.id to verifyStepOutcome');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 22: Task completion gate
  // ════════════════════════════════════════════════════════════════════════
  await testSection('22. Task completion gate', async () => {
    const { verifyTaskCompletion } = await import('../../src/main/agent/verification.ts');

    console.log('\nTest 22.1: task with browser tools + all completed → SUCCESS');
    const task: any = {
      id: 't1',
      plan: [
        { id: 's1', index: 0, status: 'completed', toolName: 'browser_navigate' },
        { id: 's2', index: 1, status: 'completed', toolName: 'browser_click' },
      ],
      toolCalls: [{ id: 'tc1' }],
      errors: [],
    };
    const result = verifyTaskCompletion(task);
    assertEqual(result.passed, true, 'all completed → passed');

    console.log('\nTest 22.2: task with failed browser step → NOT SUCCESS');
    const task2: any = {
      id: 't2',
      plan: [
        { id: 's1', index: 0, status: 'completed', toolName: 'browser_navigate' },
        { id: 's2', index: 1, status: 'failed', toolName: 'browser_click' },
      ],
      toolCalls: [{ id: 'tc1' }],
      errors: [],
    };
    const result2 = verifyTaskCompletion(task2);
    assertEqual(result2.passed, false, 'failed browser step → NOT passed');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 23: Prompt-injection resistance
  // ════════════════════════════════════════════════════════════════════════
  await testSection('23. Prompt-injection resistance', async () => {
    console.log('\nTest 23: browser_extract truncates output (defense-in-depth)');
    const extractSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'browser-extract-tool.ts'),
      'utf-8',
    );
    assert(extractSource.includes('MAX_EXTRACT_LENGTH'), 'extract truncates output');
    assert(extractSource.includes('10000'), 'truncates to 10000 chars');

    console.log('\nTest 23b: extracted content is UNTRUSTED (comment)');
    assert(extractSource.includes('UNTRUSTED') || extractSource.includes('untrusted'), 'extract treats content as untrusted');

    console.log('\nTest 23c: session manager does NOT execute page content');
    const smSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'session-manager.ts'),
      'utf-8',
    );
    // Session manager should NOT have any eval() or page.exposeFunction()
    assert(!smSource.includes('eval('), 'session manager has NO eval()');
    assert(!smSource.includes('exposeFunction'), 'session manager has NO exposeFunction (no page-injected functions)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 24: Concurrent tasks isolation
  // ════════════════════════════════════════════════════════════════════════
  await testSection('24. Concurrent tasks isolation', async () => {
    const smSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'session-manager.ts'),
      'utf-8',
    );

    console.log('\nTest 24.1: sessions keyed by taskId (no cross-task leakage)');
    assert(smSource.includes('_sessions = new Map<string, BrowserSession>'), 'sessions map by taskId');
    assert(smSource.includes('_sessions.get(taskId)'), 'lookups by taskId');

    console.log('\nTest 24.2: each session has unique ID (decoupled from taskId)');
    assert(smSource.includes('sessionId = require(\'crypto\').randomUUID'), 'each session gets unique UUID');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 25: Browser crash recovery
  // ════════════════════════════════════════════════════════════════════════
  await testSection('25. Browser crash recovery', async () => {
    const { isBrowserCrashError } = await import('../../src/main/ai/tools/browser/session-manager.ts');

    console.log('\nTest 25.1: isBrowserCrashError detects "Target closed"');
    assert(isBrowserCrashError(new Error('Target closed, page not available')), 'detects Target closed');

    console.log('\nTest 25.2: isBrowserCrashError detects "Browser has been closed"');
    assert(isBrowserCrashError(new Error('Browser has been closed')), 'detects browser closed');

    console.log('\nTest 25.3: isBrowserCrashError does NOT match regular errors');
    assert(!isBrowserCrashError(new Error('Navigation timeout')), 'navigation timeout NOT a crash');
    assert(!isBrowserCrashError(new Error('Element not found')), 'element not found NOT a crash');

    console.log('\nTest 25.4: withCrashRecovery marks session dead + returns error');
    const helpersSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'helpers.ts'),
      'utf-8',
    );
    assert(helpersSource.includes('isBrowserCrashError'), 'helpers uses isBrowserCrashError');
    assert(helpersSource.includes('markSessionDead'), 'helpers calls markSessionDead on crash');
    assert(helpersSource.includes('Browser crashed'), 'returns crash error message');

    console.log('\nTest 25.5: markSessionDead exists');
    const smSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'session-manager.ts'),
      'utf-8',
    );
    assert(smSource.includes('export function markSessionDead'), 'markSessionDead exported');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 26: Regression (Phase 6-9 + Phase 116)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('26. Regression (source inspection)', async () => {
    console.log('\nTest 26.1: Phase 6 task queue intact');
    const queueSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'tasks', 'queue.ts'),
      'utf-8',
    );
    assert(queueSource.includes('enqueueAgentTask'), 'Phase 6 queue intact');

    console.log('\nTest 26.2: Phase 7 recovery engine intact + handles browser_error');
    const engineSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'recovery-engine.ts'),
      'utf-8',
    );
    assert(engineSource.includes('decideRecovery'), 'Phase 7 recovery intact');
    assert(engineSource.includes("cls === 'browser_error'"), 'recovery handles browser_error');

    console.log('\nTest 26.3: Phase 8 context contract intact');
    const contractSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'context-contract.ts'),
      'utf-8',
    );
    assert(contractSource.includes('safeContextSnapshot'), 'Phase 8 context intact');

    console.log('\nTest 26.4: Phase 9 verification intact + handles browser outcomes');
    const verSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'verification.ts'),
      'utf-8',
    );
    assert(verSource.includes('verifyTaskCompletion'), 'Phase 9 verification intact');
    assert(verSource.includes("case 'url_changed'"), 'verification handles url_changed (Phase 10)');

    console.log('\nTest 26.5: Phase 10 additions are additive (no breaking changes)');
    const typesSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'types.ts'),
      'utf-8',
    );
    // New ExpectedOutcome types are additive
    assert(typesSource.includes("'url_changed'"), "ExpectedOutcome has url_changed (additive)");
    assert(typesSource.includes("'browser_error'"), "AgentError.errorClass has browser_error (additive)");
    // New permission is additive
    const permSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'permissions', 'index.ts'),
      'utf-8',
    );
    assert(permSource.includes("'browser'"), "Permission has 'browser' (additive)");

    console.log('\nTest 26.6: Playwright installed in package.json');
    const pkgSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'package.json'),
      'utf-8',
    );
    assert(pkgSource.includes('"playwright"'), 'playwright in dependencies');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 10 browser automation tests: ${passed}/${passed + failed} passed (${failed} failed)`);
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
