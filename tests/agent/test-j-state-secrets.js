/**
 * Phase 7 — Test J: State Machine + Secret Redaction
 *
 * Verifies:
 *   - State transition validation (legal and illegal transitions)
 *   - Crash recovery (interrupted tasks → 'failed')
 *   - Secret redaction in logs (API keys, tokens, passwords never persisted)
 *
 * Run with: node tests/agent/test-j-state-secrets.js
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
    console.log('\n=== Phase 7 Test J: State Machine + Secret Redaction ===\n');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-state-'));
    const { initPersistence } = require('../../dist/main/persistence');
    initPersistence(tmpDir);

    // ────────────────────────────────────────────────────────────────────
    // SECTION 1: State Machine
    // ────────────────────────────────────────────────────────────────────
    console.log('Section 1: State Machine\n');

    const { isValidTransition, transitionTaskStatus, isTerminalStatus, recoverInterruptedTask } =
      require('../../dist/main/agent/state-machine');

    // Legal transitions
    assert('pending → planning is legal', isValidTransition('pending', 'planning') === true);
    assert('planning → executing is legal', isValidTransition('planning', 'executing') === true);
    assert('executing → observing is legal', isValidTransition('executing', 'observing') === true);
    assert('observing → verifying is legal', isValidTransition('observing', 'verifying') === true);
    assert('verifying → completed is legal', isValidTransition('verifying', 'completed') === true);
    assert('executing → cancelled is legal', isValidTransition('executing', 'cancelled') === true);
    assert('planning → failed is legal', isValidTransition('planning', 'failed') === true);

    // Illegal transitions
    assert('completed → executing is illegal', isValidTransition('completed', 'executing') === false);
    assert('failed → executing is illegal', isValidTransition('failed', 'executing') === false);
    assert('cancelled → executing is illegal', isValidTransition('cancelled', 'executing') === false);
    assert('pending → executing is illegal (must plan first)', isValidTransition('pending', 'executing') === false);
    assert('completed → planning is illegal', isValidTransition('completed', 'planning') === false);

    // Terminal states
    assert('completed is terminal', isTerminalStatus('completed') === true);
    assert('failed is terminal', isTerminalStatus('failed') === true);
    assert('cancelled is terminal', isTerminalStatus('cancelled') === true);
    assert('executing is not terminal', isTerminalStatus('executing') === false);
    assert('planning is not terminal', isTerminalStatus('planning') === false);

    // transitionTaskStatus applies the change
    const task1 = { id: 'task-1', status: 'pending' };
    transitionTaskStatus(task1, 'planning');
    assert('transitionTaskStatus changes status', task1.status === 'planning');

    // Illegal transition throws
    let threw = false;
    try {
      const task2 = { id: 'task-2', status: 'completed' };
      transitionTaskStatus(task2, 'executing');
    } catch (err) {
      threw = true;
      assert('illegal transition throws with message', err.message.includes('Illegal state transition'));
    }
    assert('illegal transition throws', threw === true);

    // ────────────────────────────────────────────────────────────────────
    // SECTION 2: Crash Recovery
    // ────────────────────────────────────────────────────────────────────
    console.log('\nSection 2: Crash Recovery\n');

    // Simulate a task that was 'executing' when the agent crashed
    const interruptedTask = {
      id: 'task-crashed',
      status: 'executing',
      errors: [],
      completedAt: undefined,
    };
    const recovery = recoverInterruptedTask(interruptedTask);
    assert('recoverInterruptedTask recovers non-terminal task', recovery.recovered === true);
    assert('recovered task is failed', interruptedTask.status === 'failed');
    assert('recovered task has error message', interruptedTask.errors.length === 1);
    assert('recovered task has completedAt', !!interruptedTask.completedAt);
    assert('recovery reason is set', recovery.reason?.includes('executing'));

    // Terminal tasks are NOT recovered
    const completedTask = { id: 'task-done', status: 'completed', errors: [], completedAt: Date.now() };
    const recovery2 = recoverInterruptedTask(completedTask);
    assert('terminal task is not recovered', recovery2.recovered === false);
    assert('terminal task status unchanged', completedTask.status === 'completed');
    assert('terminal task has no new errors', completedTask.errors.length === 0);

    // ────────────────────────────────────────────────────────────────────
    // SECTION 3: Secret Redaction
    // ────────────────────────────────────────────────────────────────────
    console.log('\nSection 3: Secret Redaction\n');

    const { redactSecrets, redactObjectDeep, log, AgentLogger } = require('../../dist/main/agent/logger');

    // OpenAI key
    const r1 = redactSecrets('My key is sk-abc123def456ghi789jkl012mno345pqr678stu901vwx');
    assert('redacts OpenAI key (sk-...)', r1.redacted.includes('REDACTED'));
    assert('redacted value is not in output', !r1.redacted.includes('sk-abc123'));
    assert('redaction recorded', r1.redactions.includes('openai_key'));

    // Anthropic key
    const r2 = redactSecrets('sk-ant-api03-1234567890abcdefghijklmnopqrstuvwx');
    assert('redacts Anthropic key (sk-ant-...)', r2.redacted.includes('REDACTED'));
    assert('anthropic key value is gone', !r2.redacted.includes('sk-ant-api03-1234'));

    // GitHub PAT
    const r3 = redactSecrets('token: ghp_1234567890abcdefghijklmnopqrstuvwxyz');
    assert('redacts GitHub PAT (ghp_...)', r3.redacted.includes('REDACTED'));
    assert('github pat value is gone', !r3.redacted.includes('ghp_1234'));

    // Bearer token
    const r4 = redactSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIx');
    assert('redacts Bearer token', r4.redacted.includes('REDACTED'));

    // JWT
    const r5 = redactSecrets('jwt: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N5p');
    assert('redacts JWT', r5.redacted.includes('REDACTED'));

    // Connection string with password
    const r6 = redactSecrets('mongodb://user:secretpass@host:27017/db');
    assert('redacts connection string password', r6.redacted.includes('***'));

    // API key in env var format
    const r7 = redactSecrets('API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456');
    assert('redacts env var api_key', r7.redacted.includes('REDACTED'));

    // Plain password
    const r8 = redactSecrets('password=mySuperSecretPassword123');
    assert('redacts password', r8.redacted.includes('REDACTED'));

    // Object deep redaction
    const obj = {
      apiKey: 'sk-test123',
      config: {
        token: 'ghp_abcdefghijklmnopqrstuvwxyz',
        nested: { password: 'secret123' },
      },
      // 'sk-' prefix with 20+ alphanumeric chars will be redacted by openai_key pattern
      list: ['sk-abcdefghijklmnopqrstuvwxyz1234567890', 'public-value'],
      safeField: 'this is fine',
    };
    const redacted = redactObjectDeep(obj);
    assert('deep redaction hides apiKey field', redacted.apiKey === '***REDACTED***');
    assert('deep redaction hides nested token', redacted.config.token === '***REDACTED***');
    assert('deep redaction hides nested password', redacted.config.nested.password === '***REDACTED***');
    assert('deep redaction redacts strings in arrays', redacted.list[0].includes('REDACTED'));
    assert('deep redaction preserves safe strings in arrays', redacted.list[1] === 'public-value');
    assert('deep redaction preserves safe fields', redacted.safeField === 'this is fine');

    // ────────────────────────────────────────────────────────────────────
    // SECTION 4: Logger persists redacted entries
    // ────────────────────────────────────────────────────────────────────
    console.log('\nSection 4: Logger persistence\n');

    const taskId = 'test-task-secrets';
    AgentLogger.tool('Calling API with key sk-secretkey1234567890abcdef', taskId, {
      data: {
        apiKey: 'sk-secretkey1234567890abcdef',
        publicInfo: 'visible',
      },
    });

    // Wait a tick for fs write
    await new Promise((r) => setTimeout(r, 50));

    // Read the log file
    const { readTaskLog } = require('../../dist/main/agent/logger');
    const logEntries = readTaskLog(taskId);
    const lastEntry = logEntries[logEntries.length - 1];
    assert('log entry was persisted', !!lastEntry);
    assert('log entry message is redacted', !lastEntry.message.includes('sk-secretkey1234567890'));
    assert('log entry data is redacted', lastEntry.data?.apiKey === '***REDACTED***');
    assert('log entry preserves public info', lastEntry.data?.publicInfo === 'visible');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });

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
