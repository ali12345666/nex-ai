/**
 * Phase 7 — Test H part 2: cancelTask prevents step execution WITH a model.
 *
 * This requires a registered local model. The agent will create a task,
 * then we cancel BEFORE planning starts, ensuring the cancellation is
 * detected at checkpoint 1 (before any step).
 *
 * Run with: node tests/agent/test-h-cancel-with-model.js
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MODEL_PATH = '/home/z/my-project/repos/nex-ai/models/qwen2.5-0.5b-q4_k_m.gguf';

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else      { fail++; console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

app.whenReady().then(async () => {
  try {
    console.log('\n=== Phase 7 Test H.2: cancelTask with model ===\n');

    if (!fs.existsSync(MODEL_PATH)) {
      console.error('Model file not found:', MODEL_PATH);
      app.exit(1);
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-cxl2-'));
    const { initPersistence } = require('../../dist/main/persistence');
    initPersistence(tmpDir);

    const { addModel } = require('../../dist/main/ai/model-registry');
    const model = addModel(MODEL_PATH, {
      name: 'Qwen2.5-0.5B-Instruct',
      contextSize: 2048,
      category: 'fast',
    });

    const { createTask, cancelTask, getTask, runTask } = require('../../dist/main/agent/core');

    // Create a task and cancel it before runTask is called
    const task = await createTask({
      userRequest: 'Long task that should be cancelled before any work begins',
      intent: 'general',
      projectPath: tmpDir,
      modelId: model.id,
      limits: { maxSteps: 5, maxToolCalls: 5, maxRetries: 1, maxExecutionTimeMs: 30000 },
    });

    // Cancel BEFORE runTask
    const cancelOk = cancelTask(task.id, 'cancelled before run');
    assert('cancelTask returns true', cancelOk === true);

    // Now run — should immediately detect cancellation
    await runTask(task.id);
    const finalTask = getTask(task.id);
    assert('task status is cancelled', finalTask.status === 'cancelled', `status: ${finalTask.status}`);
    assert('task has cancelReason', !!finalTask.cancelReason);
    assert('task has cancelled=true', finalTask.cancelled === true);
    assert('task did not execute any tool calls', finalTask.toolCalls.length === 0);
    assert('task did not produce observations', finalTask.observations.length === 0);
    assert('task has no errors', finalTask.errors.length === 0);
    assert('task has completedAt set', !!finalTask.completedAt);

    // Cleanup
    const { shutdownLlama } = require('../../dist/main/ai/inference');
    await shutdownLlama();
    fs.rmSync(tmpDir, { recursive: true });

    console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===\n`);
    setTimeout(() => app.exit(fail > 0 ? 1 : 0), 200);
  } catch (err) {
    console.error('Top-level error:', err);
    console.error(err.stack);
    setTimeout(() => app.exit(1), 200);
  }
});
