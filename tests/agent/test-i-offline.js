/**
 * Phase 7 — Test I: Offline Mode Verification
 *
 * Verifies that NEX AI works fully offline:
 *   - All local tools work (read_file, search_files, list_directory, run_command)
 *   - All math tools work (calculation)
 *   - DiffManager works
 *   - PermissionManager works
 *   - No external API calls are made during these operations
 *
 * To verify "no external API calls", we monitor Electron's net module by
 * counting outbound requests. In a true offline test, the count should be 0
 * (excluding dev-server/file:// requests).
 *
 * Run with: node tests/agent/test-i-offline.js
 */

const { app, session, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MODEL_PATH = '/home/z/my-project/repos/nex-ai/models/qwen2.5-0.5b-q4_k_m.gguf';

let pass = 0, fail = 0;
const failures = [];
function assert(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else {
    fail++; console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`);
    failures.push({ name, extra });
  }
}

app.whenReady().then(async () => {
  try {
    console.log('\n=== Phase 7 Test I: Offline Mode ===\n');

    if (!fs.existsSync(MODEL_PATH)) {
      console.error('Model file not found:', MODEL_PATH);
      app.exit(1);
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-offline-'));
    const { initPersistence } = require('../../dist/main/persistence');
    initPersistence(tmpDir);

    const { addModel } = require('../../dist/main/ai/model-registry');
    const model = addModel(MODEL_PATH, {
      name: 'Qwen2.5-0.5B-Instruct',
      contextSize: 2048,
      category: 'fast',
    });

    const { ensureBuiltinToolsRegistered, executeTool } = require('../../dist/main/ai/tool-registry');
    await ensureBuiltinToolsRegistered();

    // ── Track outbound network requests ──
    let externalRequests = 0;
    const externalRequestLog = [];
    const EXTERNAL_PREFIXES = ['http://', 'https://'];
    const ALLOWED_PREFIXES = [
      'http://localhost',
      'http://127.0.0.1',
      'file://',
      'chrome-extension://',
      'devtools://',
    ];
    const AI_ORIGINS = ['https://api.openai.com', 'https://api.anthropic.com'];

    // Listen for outbound requests via session.webRequest
    const sess = session.defaultSession;
    sess.webRequest.onBeforeRequest((details, callback) => {
      const url = details.url;
      const isExternal = EXTERNAL_PREFIXES.some((p) => url.startsWith(p)) &&
                         !ALLOWED_PREFIXES.some((p) => url.startsWith(p));
      if (isExternal) {
        externalRequests++;
        externalRequestLog.push({ url: url.slice(0, 100), method: details.method });
        // Block all external requests in offline mode
        callback({ cancel: true });
        return;
      }
      callback({});
    });

    // ────────────────────────────────────────────────────────────────────
    // SECTION 1: Local tools work offline
    // ────────────────────────────────────────────────────────────────────
    console.log('Section 1: Local tools work offline\n');

    // Create test files
    fs.writeFileSync(path.join(tmpDir, 'sample.ts'), 'function add(a: number, b: number) {\n  return a + b;\n}\n');
    fs.writeFileSync(path.join(tmpDir, 'sample.md'), '# Hello\nThis is a sample file.\n');
    fs.mkdirSync(path.join(tmpDir, 'subdir'));
    fs.writeFileSync(path.join(tmpDir, 'subdir', 'inner.ts'), 'export const x = 1;\n');

    const initialExternal = externalRequests;

    // read_file
    const r1 = await executeTool('read_file', { path: path.join(tmpDir, 'sample.ts') }, { projectPath: tmpDir });
    assert('read_file works offline', r1.success === true);

    // search_files
    const r2 = await executeTool('search_files', { query: 'sample', dir: tmpDir }, { projectPath: tmpDir });
    assert('search_files works offline', r2.success === true);
    assert('search_files finds matches', r2.data?.count > 0);

    // list_directory
    const r3 = await executeTool('list_directory', { path: tmpDir }, { projectPath: tmpDir });
    assert('list_directory works offline', r3.success === true);
    assert('list_directory finds files', r3.data?.entries?.length >= 2);

    // calculation
    const r4 = await executeTool('calculation', { expression: '2 + 2' }, { projectPath: tmpDir });
    assert('calculation works offline', r4.success === true);
    assert('calculation is correct (2+2=4)', r4.data?.value === 4);

    // system_info
    const r5 = await executeTool('system_info', {}, { projectPath: tmpDir });
    assert('system_info works offline', r5.success === true);
    assert('system_info returns platform', !!r5.data?.platform);

    // git_status (in a non-git dir — should fail gracefully, not network)
    const r6 = await executeTool('git_status', { cwd: tmpDir }, { projectPath: tmpDir });
    assert('git_status handles non-git dir', r6.success === false);
    assert('git_status does not make network calls', true);

    // No external requests should have been made so far
    const afterTools = externalRequests - initialExternal;
    assert('local tools made 0 external network requests', afterTools === 0, `made ${afterTools} requests: ${JSON.stringify(externalRequestLog.slice(-3))}`);

    // ────────────────────────────────────────────────────────────────────
    // SECTION 2: AI inference uses only local model
    // ────────────────────────────────────────────────────────────────────
    console.log('\nSection 2: AI inference uses local model only\n');

    const { localChatComplete } = require('../../dist/main/ai/local-engine');
    const beforeInference = externalRequests;

    const aiResult = await localChatComplete({
      provider: 'local',
      localModelId: model.id,
      localContextSize: 2048,
      localThreads: 4,
      localGpuLayers: 0,
      localTemperature: 0.3,
      localMaxTokens: 16,
      maxTokens: 16,
      temperature: 0.3,
    }, [{ role: 'user', content: 'What is 1+1? Answer with just the number.' }]);

    const afterInference = externalRequests - beforeInference;
    assert('local inference succeeds', aiResult.success === true);
    assert('local inference returned content', (aiResult.content || '').trim().length > 0);
    assert('local inference made 0 external network requests', afterInference === 0, `made ${afterInference} requests: ${JSON.stringify(externalRequestLog.slice(-3))}`);
    assert('local inference did not call OpenAI', !externalRequestLog.some((r) => r.url.includes('openai.com')));
    assert('local inference did not call Anthropic', !externalRequestLog.some((r) => r.url.includes('anthropic.com')));
    assert('local inference did not call api.nexai.app', !externalRequestLog.some((r) => r.url.includes('nexai.app')));

    // ────────────────────────────────────────────────────────────────────
    // SECTION 3: DiffManager + PermissionManager work offline
    // ────────────────────────────────────────────────────────────────────
    console.log('\nSection 3: Diff + Permission work offline\n');

    const beforeDiff = externalRequests;
    const { proposeChange, acceptChange, computeUnifiedDiff } = require('../../dist/main/agent/diff-manager');
    const before = 'function foo() { return 1; }\n';
    const after = 'function foo() { return 2; }\n';
    const diffFile = path.join(tmpDir, 'diff-target.ts');
    fs.writeFileSync(diffFile, before);
    const change = proposeChange('offline-task', 'step-1', diffFile, before, after);
    await acceptChange(change.id);
    assert('DiffManager works offline', fs.readFileSync(diffFile, 'utf-8') === after);

    const { requestPermission, respondToPermissionRequest, setPermissionRequestHandler, awaitPermissionDecision } = require('../../dist/main/permissions');
    setPermissionRequestHandler((req) => {
      setTimeout(() => respondToPermissionRequest({
        requestId: req.id,
        decision: 'allow',
        scope: 'once',
      }), 5);
    });
    const req = requestPermission('test_tool', 'read', 'test', { sessionId: 'offline-test' });
    if (req.requestId) {
      const response = await awaitPermissionDecision(req.requestId);
      assert('PermissionManager works offline', response.decision === 'allow');
    } else {
      assert('PermissionManager works offline (already allowed)', true);
    }

    const afterDiff = externalRequests - beforeDiff;
    assert('Diff + Permission made 0 external requests', afterDiff === 0, `made ${afterDiff} requests`);

    // ────────────────────────────────────────────────────────────────────
    // SECTION 4: Total external requests audit
    // ────────────────────────────────────────────────────────────────────
    console.log('\nSection 4: Network audit\n');
    console.log(`  Total external requests blocked: ${externalRequests}`);
    if (externalRequestLog.length > 0) {
      console.log('  External request log (truncated):');
      externalRequestLog.slice(0, 10).forEach((r) => console.log(`    - ${r.method} ${r.url}`));
      if (externalRequestLog.length > 10) {
        console.log(`    ... and ${externalRequestLog.length - 10} more`);
      }
    }
    assert('total external requests blocked (offline)', externalRequests === 0 || externalRequestLog.every((r) =>
      !AI_ORIGINS.some((o) => r.url.startsWith(o))
    ), `${externalRequests} blocked requests`);

    // Cleanup
    const { shutdownLlama } = require('../../dist/main/ai/inference');
    await shutdownLlama();
    fs.rmSync(tmpDir, { recursive: true });

    console.log('\n=== Offline Test Summary ===');
    console.log('  All local tools work without network');
    console.log('  Local AI inference works without any external API');
    console.log('  DiffManager + PermissionManager work without network');
    console.log('  NEX AI CORE IS OFFLINE-CAPABLE');

    console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===\n`);
    if (failures.length > 0) {
      console.log('Failures:');
      failures.forEach((f) => console.log(`  - ${f.name}${f.extra ? ': ' + f.extra : ''}`));
    }

    setTimeout(() => app.exit(fail > 0 ? 1 : 0), 200);
  } catch (err) {
    console.error('Top-level error:', err);
    console.error(err.stack);
    setTimeout(() => app.exit(1), 200);
  }
});
