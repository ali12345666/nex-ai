/**
 * NEX AI — Phase 6: Background Task Queue — Comprehensive Tests
 *
 * Coverage (per Phase 6 §13):
 *   1. enqueue/dequeue
 *   2. priority ordering
 *   3. lifecycle (queued → running → completed/failed/cancelled/paused)
 *   4. concurrency limit
 *   5. cancellation (propagates to function + agent)
 *   6. failure isolation (one task fails, others continue)
 *   7. persistence/recovery (queued survives reload, running → failed)
 *   8. agent integration (mock agent)
 *   9. orb integration (event → state mapping)
 *  10. permission enforcement (source inspection — agent path goes through permissions)
 *  11. race conditions (concurrent enqueue/cancel)
 *
 * Run with: npx tsx tests/tools/test-phase-6-task-queue.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

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

// ─── Imports (deferred so we can reset module state between sections) ─────────

async function freshQueue(tmpDir: string, opts?: any) {
  // Reset module state by re-importing. tsx caches modules, so we use a
  // unique query string to force a fresh load.
  const suffix = Math.random().toString(36).slice(2, 8);
  const mod = await import(`../../src/main/tasks/queue.ts?${suffix}`);
  const types = await import(`../../src/main/tasks/types.ts?${suffix}`);
  const persist = await import(`../../src/main/tasks/persistence.ts?${suffix}`);
  const orb = await import(`../../src/main/tasks/orb-bridge.ts?${suffix}`);

  // Initialize persistence with a temp dir
  persist.initTaskQueuePersistence(tmpDir);
  persist.clearQueueState();

  // Wire a mock agent for the queue
  const agentTasks = new Map<string, { status: string; events: any[] }>();
  const agentListeners = new Set<(event: any) => void>();
  mod.initTaskQueue({
    userDataDir: tmpDir,
    config: { maxConcurrent: 2, historyLimit: 50, defaultMaxRetries: 1, defaultPriority: 'normal' },
    agentRunTask: async (taskId: string) => {
      // Simulate agent work. The mock waits up to 2s for a status change,
      // checking every 10ms. This lets tests cancel/fail the agent task
      // by mutating agentTasks AFTER the runTask starts.
      const t = agentTasks.get(taskId) || { status: 'executing', events: [] };
      agentTasks.set(taskId, t);
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const current = agentTasks.get(taskId);
        if (current?.status === 'cancelled') {
          for (const l of agentListeners) l({ type: 'task_cancelled', taskId });
          return { status: 'cancelled' } as any;
        }
        if (current?.status === 'failed') {
          for (const l of agentListeners) l({ type: 'task_failed', taskId });
          throw new Error('Agent task failed (mock)');
        }
        if (current?.status === 'completed') {
          for (const l of agentListeners) l({ type: 'task_completed', taskId });
          return { status: 'completed' } as any;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      // Timeout — mark completed by default
      for (const l of agentListeners) l({ type: 'task_completed', taskId });
      return { status: 'completed' } as any;
    },
    agentCancelTask: (taskId: string, _reason?: string) => {
      const t = agentTasks.get(taskId);
      if (t) { t.status = 'cancelled'; return true; }
      return false;
    },
    agentGetTaskStatus: (taskId: string) => agentTasks.get(taskId)?.status || null,
    agentOnEvent: (listener) => {
      agentListeners.add(listener);
      return () => agentListeners.delete(listener);
    },
    onInterruptedRecovery: () => {},
    memoryRecord: () => {},
    ...opts,
  });

  return { mod, types, persist, orb, agentTasks, agentListeners };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('Phase 6: Background Task Queue — Comprehensive Tests\n');

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 1: Types & Constants
  // ════════════════════════════════════════════════════════════════════════
  await testSection('1. Types & Constants', async () => {
    const types = await import('../../src/main/tasks/types.ts');

    console.log('\nTest 1.1: All 4 priorities defined');
    assertEqual(types.PRIORITY_WEIGHT.critical, 0, 'critical = 0');
    assertEqual(types.PRIORITY_WEIGHT.high, 1, 'high = 1');
    assertEqual(types.PRIORITY_WEIGHT.normal, 2, 'normal = 2');
    assertEqual(types.PRIORITY_WEIGHT.low, 3, 'low = 3');

    console.log('\nTest 1.2: isValidPriority');
    assert(types.isValidPriority('critical'), 'critical is valid');
    assert(types.isValidPriority('low'), 'low is valid');
    assert(!types.isValidPriority('urgent'), 'urgent is invalid');
    assert(!types.isValidPriority(42), 'number is invalid');

    console.log('\nTest 1.3: isTerminalStatus');
    assert(types.isTerminalStatus('completed'), 'completed is terminal');
    assert(types.isTerminalStatus('failed'), 'failed is terminal');
    assert(types.isTerminalStatus('cancelled'), 'cancelled is terminal');
    assert(!types.isTerminalStatus('queued'), 'queued is not terminal');
    assert(!types.isTerminalStatus('running'), 'running is not terminal');
    assert(!types.isTerminalStatus('paused'), 'paused is not terminal');

    console.log('\nTest 1.4: DEFAULT_QUEUE_CONFIG');
    assertEqual(types.DEFAULT_QUEUE_CONFIG.maxConcurrent, 2, 'default maxConcurrent = 2');
    assertEqual(types.DEFAULT_QUEUE_CONFIG.historyLimit, 50, 'default historyLimit = 50');
    assertEqual(types.DEFAULT_QUEUE_CONFIG.defaultMaxRetries, 1, 'default maxRetries = 1');
    assertEqual(types.DEFAULT_QUEUE_CONFIG.defaultPriority, 'normal', 'default priority = normal');

    console.log('\nTest 1.5: PERSISTABLE_STATUSES includes running (for crash detection)');
    assert(types.PERSISTABLE_STATUSES.includes('queued'), 'queued is persistable');
    assert(types.PERSISTABLE_STATUSES.includes('running'), 'running is persistable (for crash detection)');
    assert(types.PERSISTABLE_STATUSES.includes('paused'), 'paused is persistable');
    assert(!types.PERSISTABLE_STATUSES.includes('completed'), 'completed is NOT in PERSISTABLE_STATUSES (history only)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 2: enqueue/dequeue
  // ════════════════════════════════════════════════════════════════════════
  await testSection('2. enqueue/dequeue', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-tq-1-'));
    // Use maxConcurrent=0 to keep items queued until we're ready to verify
    const { mod } = await freshQueue(tmpDir, {
      config: { maxConcurrent: 0, historyLimit: 50, defaultMaxRetries: 0, defaultPriority: 'normal' },
    });

    console.log('\nTest 2.1: enqueueFunction returns item with id + status=queued');
    mod.registerTaskFunction('test:fast', async () => 'fast-result');
    const item = mod.enqueueFunction('test:fast', { name: 'Fast task' });
    assert(!!item.id, 'item has id');
    assertEqual(item.status, 'queued', 'initial status is queued');
    assertEqual(item.priority, 'normal', 'default priority is normal');
    assert(!!item.enqueuedAt, 'item has enqueuedAt timestamp');

    console.log('\nTest 2.2: enqueue unregistered function throws');
    let threw = false;
    try { mod.enqueueFunction('nonexistent:fn'); } catch { threw = true; }
    assert(threw, 'should throw for unregistered function');

    console.log('\nTest 2.3: getTask returns the enqueued item');
    const got = mod.getTask(item.id);
    assert(!!got, 'getTask returns the item');
    assertEqual(got?.id, item.id, 'id matches');

    console.log('\nTest 2.4: listTasks includes the item');
    const list = mod.listTasks();
    assert(list.some((t: any) => t.id === item.id), 'listTasks includes the item');

    console.log('\nTest 2.5: dequeue + run + complete (after bumping maxConcurrent)');
    // Now allow the worker to run
    mod.updateConfig({ maxConcurrent: 2 });
    await new Promise((r) => setTimeout(r, 200));
    const final = mod.getTask(item.id);
    assertEqual(final?.status, 'completed', 'task completed after run');
    assertEqual(final?.progress, 100, 'progress is 100% after completion');
    assert(!!final?.completedAt, 'has completedAt timestamp');

    mod.shutdownTaskQueue();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 3: Priority ordering
  // ════════════════════════════════════════════════════════════════════════
  await testSection('3. Priority ordering', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-tq-3-'));
    // Use maxConcurrent=0 to enqueue ALL items first, then bump to 1 to run
    const { mod } = await freshQueue(tmpDir, {
      config: { maxConcurrent: 0, historyLimit: 50, defaultMaxRetries: 0, defaultPriority: 'normal' },
    });

    console.log('\nTest 3.1: high priority runs before low (maxConcurrent=1)');
    const order: string[] = [];
    mod.registerTaskFunction('test:record', async (ctx: any) => {
      order.push(ctx.metadata?.label);
      await new Promise((r) => setTimeout(r, 30));
      return 'ok';
    });
    // Enqueue low first, then critical, then high — they should run critical → high → low
    mod.enqueueFunction('test:record', { name: 'low', priority: 'low', metadata: { label: 'low' } });
    mod.enqueueFunction('test:record', { name: 'critical', priority: 'critical', metadata: { label: 'critical' } });
    mod.enqueueFunction('test:record', { name: 'high', priority: 'high', metadata: { label: 'high' } });
    // Now bump to maxConcurrent=1 — the queue is priority-sorted, so critical runs first
    mod.updateConfig({ maxConcurrent: 1 });

    await new Promise((r) => setTimeout(r, 200));
    assertEqual(order[0], 'critical', 'critical ran first');
    assertEqual(order[1], 'high', 'high ran second');
    assertEqual(order[2], 'low', 'low ran last');

    console.log('\nTest 3.2: same priority preserves FIFO order');
    const order2: string[] = [];
    mod.registerTaskFunction('test:record2', async (ctx: any) => {
      order2.push(ctx.metadata?.label);
      await new Promise((r) => setTimeout(r, 20));
      return 'ok';
    });
    // Set maxConcurrent back to 0 to enqueue all first
    mod.updateConfig({ maxConcurrent: 0 });
    mod.enqueueFunction('test:record2', { name: 'a', priority: 'normal', metadata: { label: 'a' } });
    mod.enqueueFunction('test:record2', { name: 'b', priority: 'normal', metadata: { label: 'b' } });
    mod.enqueueFunction('test:record2', { name: 'c', priority: 'normal', metadata: { label: 'c' } });
    mod.updateConfig({ maxConcurrent: 1 });

    await new Promise((r) => setTimeout(r, 200));
    assertEqual(order2[0], 'a', 'a ran first (FIFO)');
    assertEqual(order2[1], 'b', 'b ran second (FIFO)');
    assertEqual(order2[2], 'c', 'c ran third (FIFO)');

    mod.shutdownTaskQueue();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 4: Lifecycle (queued → running → completed/failed/cancelled/paused)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('4. Lifecycle', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-tq-4-'));
    const { mod } = await freshQueue(tmpDir);

    console.log('\nTest 4.1: completed transition');
    mod.registerTaskFunction('test:ok', async () => 'done');
    const item = mod.enqueueFunction('test:ok', { name: 'ok' });
    await new Promise((r) => setTimeout(r, 200));
    const final = mod.getTask(item.id);
    assertEqual(final?.status, 'completed', 'completed');
    assert(!!final?.result, 'has result');

    console.log('\nTest 4.2: failed transition (no retries)');
    mod.registerTaskFunction('test:fail', async () => { throw new Error('boom'); });
    const item2 = mod.enqueueFunction('test:fail', { name: 'fail', maxRetries: 0 });
    await new Promise((r) => setTimeout(r, 200));
    const final2 = mod.getTask(item2.id);
    assertEqual(final2?.status, 'failed', 'failed');
    assert(!!final2?.error, 'has error');
    assert(final2?.error?.message.includes('boom'), 'error message preserved');

    console.log('\nTest 4.3: cancelled transition (queued → cancelled)');
    mod.registerTaskFunction('test:slow', async () => { await new Promise((r) => setTimeout(r, 500)); return 'slow'; });
    // Enqueue with low priority so it stays queued (maxConcurrent=2 default, but other tests may have running tasks)
    const item3 = mod.enqueueFunction('test:slow', { name: 'slow', priority: 'low' });
    // Cancel immediately (it might be running or queued — both should work)
    const ok = mod.cancelTask(item3.id, 'test cancel');
    assert(ok, 'cancelTask returned true');
    await new Promise((r) => setTimeout(r, 100));
    const final3 = mod.getTask(item3.id);
    assertEqual(final3?.status, 'cancelled', 'cancelled');
    assert(!!final3?.cancelReason, 'has cancelReason');

    console.log('\nTest 4.4: paused transition (queued → paused)');
    mod.registerTaskFunction('test:pausable', async () => 'ok');
    // Pause requires the item to be queued — use maxConcurrent=1 + a blocking task
    mod.shutdownTaskQueue();
    fs.rmSync(tmpDir, { recursive: true, force: true });

    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-tq-4b-'));
    const { mod: mod2 } = await freshQueue(tmpDir2, {
      config: { maxConcurrent: 1, historyLimit: 50, defaultMaxRetries: 0, defaultPriority: 'normal' },
    });
    // Block the single worker with a long task
    mod2.registerTaskFunction('test:blocking', async () => {
      await new Promise((r) => setTimeout(r, 300));
      return 'blocked';
    });
    mod2.registerTaskFunction('test:pausable', async () => 'ok');
    mod2.enqueueFunction('test:blocking', { name: 'blocking' });
    // Enqueue a second item — it should stay queued
    const itemP = mod2.enqueueFunction('test:pausable', { name: 'pausable' });
    await new Promise((r) => setTimeout(r, 50)); // let blocking start
    const queuedState = mod2.getTask(itemP.id);
    assertEqual(queuedState?.status, 'queued', 'second item is queued (worker busy)');

    const pauseOk = mod2.pauseTask(itemP.id);
    assert(pauseOk, 'pauseTask returned true');
    const pausedState = mod2.getTask(itemP.id);
    assertEqual(pausedState?.status, 'paused', 'paused');

    console.log('\nTest 4.5: resume (paused → queued → running → completed)');
    const resumeOk = mod2.resumeTask(itemP.id);
    assert(resumeOk, 'resumeTask returned true');
    const resumedState = mod2.getTask(itemP.id);
    assertEqual(resumedState?.status, 'queued', 'resumed to queued');

    await new Promise((r) => setTimeout(r, 500)); // wait for blocking + pausable
    const finalState = mod2.getTask(itemP.id);
    assertEqual(finalState?.status, 'completed', 'resumed task completed');

    mod2.shutdownTaskQueue();
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 5: Concurrency limit
  // ════════════════════════════════════════════════════════════════════════
  await testSection('5. Concurrency limit', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-tq-5-'));
    const { mod } = await freshQueue(tmpDir, {
      config: { maxConcurrent: 2, historyLimit: 50, defaultMaxRetries: 0, defaultPriority: 'normal' },
    });

    console.log('\nTest 5.1: maxConcurrent=2 limits running tasks');
    let activeCount = 0;
    let maxActive = 0;
    mod.registerTaskFunction('test:count', async () => {
      activeCount++;
      maxActive = Math.max(maxActive, activeCount);
      await new Promise((r) => setTimeout(r, 100));
      activeCount--;
      return 'ok';
    });
    // Enqueue 5 tasks
    for (let i = 0; i < 5; i++) {
      mod.enqueueFunction('test:count', { name: `t${i}` });
    }
    await new Promise((r) => setTimeout(r, 400));
    assert(maxActive <= 2, `max concurrent <= 2 (got ${maxActive})`);
    assert(maxActive === 2, `max concurrent reached 2 (got ${maxActive})`);

    console.log('\nTest 5.2: updateConfig changes maxConcurrent');
    mod.updateConfig({ maxConcurrent: 3 });
    const state = mod.getQueueState();
    assertEqual(state.config.maxConcurrent, 3, 'config updated to 3');

    mod.shutdownTaskQueue();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 6: Cancellation
  // ════════════════════════════════════════════════════════════════════════
  await testSection('6. Cancellation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-tq-6-'));
    const { mod } = await freshQueue(tmpDir, {
      config: { maxConcurrent: 2, historyLimit: 50, defaultMaxRetries: 0, defaultPriority: 'normal' },
    });

    console.log('\nTest 6.1: cancel running function-kind task');
    let cancelledObserved = false;
    mod.registerTaskFunction('test:cancellable', async (ctx: any) => {
      // Wait until cancelled
      await new Promise<void>((resolve) => {
        ctx.cancellationToken.onCancel(() => { cancelledObserved = true; resolve(); });
        // Also resolve after 5s as a safety net
        setTimeout(resolve, 5000);
      });
      if (ctx.cancellationToken.cancelled) {
        return { cancelled: true };
      }
      return { cancelled: false };
    });
    const item = mod.enqueueFunction('test:cancellable', { name: 'cancellable' });
    await new Promise((r) => setTimeout(r, 50)); // let it start
    const ok = mod.cancelTask(item.id, 'user requested');
    assert(ok, 'cancelTask returned true');
    await new Promise((r) => setTimeout(r, 100));
    assert(cancelledObserved, 'function observed cancellation via onCancel');
    const final = mod.getTask(item.id);
    assertEqual(final?.status, 'cancelled', 'task is cancelled');

    console.log('\nTest 6.2: cancel queued task (never started)');
    mod.registerTaskFunction('test:never', async () => 'should-not-run');
    // Block the workers
    mod.registerTaskFunction('test:block2', async () => {
      await new Promise((r) => setTimeout(r, 500));
      return 'blocked';
    });
    mod.enqueueFunction('test:block2', { name: 'block1' });
    mod.enqueueFunction('test:block2', { name: 'block2' });
    const item2 = mod.enqueueFunction('test:never', { name: 'never' });
    await new Promise((r) => setTimeout(r, 50));
    const ok2 = mod.cancelTask(item2.id);
    assert(ok2, 'cancel queued task returned true');
    const final2 = mod.getTask(item2.id);
    assertEqual(final2?.status, 'cancelled', 'queued task cancelled');

    console.log('\nTest 6.3: cancel already-terminal task is a no-op');
    const ok3 = mod.cancelTask(item.id, 'second cancel');
    assert(!ok3, 'cancelling a cancelled task returns false');

    console.log('\nTest 6.4: cancelAllTasks cancels everything');
    const item4 = mod.enqueueFunction('test:block2', { name: 'block3' });
    const item5 = mod.enqueueFunction('test:block2', { name: 'block4' });
    await new Promise((r) => setTimeout(r, 50));
    const count = mod.cancelAllTasks('cancel all');
    assert(count >= 2, `cancelAll cancelled at least 2 (got ${count})`);
    const f4 = mod.getTask(item4.id);
    const f5 = mod.getTask(item5.id);
    assertEqual(f4?.status, 'cancelled', 'item4 cancelled');
    assertEqual(f5?.status, 'cancelled', 'item5 cancelled');

    mod.shutdownTaskQueue();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 7: Failure isolation
  // ════════════════════════════════════════════════════════════════════════
  await testSection('7. Failure isolation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-tq-7-'));
    const { mod } = await freshQueue(tmpDir, {
      config: { maxConcurrent: 1, historyLimit: 50, defaultMaxRetries: 0, defaultPriority: 'normal' },
    });

    console.log('\nTest 7.1: a failing task does not stop subsequent tasks');
    mod.registerTaskFunction('test:fail-isolated', async () => { throw new Error('isolated failure'); });
    mod.registerTaskFunction('test:ok-after', async () => 'ok-after');
    const f = mod.enqueueFunction('test:fail-isolated', { name: 'fail' });
    const o = mod.enqueueFunction('test:ok-after', { name: 'ok-after' });
    await new Promise((r) => setTimeout(r, 200));
    const fState = mod.getTask(f.id);
    const oState = mod.getTask(o.id);
    assertEqual(fState?.status, 'failed', 'first task failed');
    assertEqual(oState?.status, 'completed', 'second task still completed');
    assertEqual(oState?.result, 'ok-after', 'second task result preserved');

    console.log('\nTest 7.2: queue is still usable after a failure');
    mod.registerTaskFunction('test:after-failure', async () => 'still-works');
    const a = mod.enqueueFunction('test:after-failure', { name: 'after' });
    await new Promise((r) => setTimeout(r, 200));
    const aState = mod.getTask(a.id);
    assertEqual(aState?.status, 'completed', 'queue still processes tasks');

    mod.shutdownTaskQueue();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 8: Persistence / Recovery
  // ════════════════════════════════════════════════════════════════════════
  await testSection('8. Persistence / Recovery', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-tq-8-'));

    console.log('\nTest 8.1: persistence module — save + load');
    const persist = await import('../../src/main/tasks/persistence.ts');
    persist.initTaskQueuePersistence(tmpDir);
    persist.clearQueueState();
    const types = await import('../../src/main/tasks/types.ts');

    // Save a state with a queued item
    const queuedItem: any = {
      id: 'test-id-1',
      name: 'test',
      priority: 'high',
      status: 'queued',
      kind: 'function',
      functionKey: 'test:fn',
      enqueuedAt: 1000,
      progress: 0,
      cancellationKey: 'test-id-1',
      maxRetries: 1,
      retryCount: 0,
    };
    persist.saveQueueState([queuedItem], { maxConcurrent: 2, historyLimit: 50 });
    const loaded = persist.loadQueueState();
    assert(!!loaded, 'state loaded');
    assertEqual(loaded?.version, 1, 'version is 1');
    assertEqual(loaded?.items.length, 1, 'one item loaded');
    assertEqual(loaded?.items[0].id, 'test-id-1', 'id preserved');

    console.log('\nTest 8.2: recovery — queued item preserved');
    const { items, recoveredInterruptedIds } = persist.recoverQueueState();
    const queuedRecover = items.find((i: any) => i.id === 'test-id-1');
    assert(!!queuedRecover, 'queued item recovered');
    assertEqual(queuedRecover?.status, 'queued', 'queued status preserved');
    assertEqual(recoveredInterruptedIds.length, 0, 'no interrupted items (none were running)');

    console.log('\nTest 8.3: recovery — running item marked failed (NOT completed)');
    persist.clearQueueState();
    const runningItem: any = {
      id: 'test-id-running',
      name: 'running',
      priority: 'normal',
      status: 'running',
      kind: 'function',
      functionKey: 'test:fn',
      enqueuedAt: 2000,
      startedAt: 2100,
      progress: 50,
      cancellationKey: 'test-id-running',
      maxRetries: 1,
      retryCount: 0,
    };
    persist.saveQueueState([runningItem], { maxConcurrent: 2, historyLimit: 50 });
    const { items: items2, recoveredInterruptedIds: r2 } = persist.recoverQueueState();
    const runningRecover = items2.find((i: any) => i.id === 'test-id-running');
    assert(!!runningRecover, 'running item recovered');
    assertEqual(runningRecover?.status, 'failed', 'running item → failed (NOT fake completion)');
    assert(!!runningRecover?.error, 'has error');
    assert(runningRecover?.error?.message.includes('Interrupted'), 'error mentions interruption');
    assertEqual(r2.length, 1, 'one interrupted id reported');
    assertEqual(r2[0], 'test-id-running', 'interrupted id is correct');

    console.log('\nTest 8.4: recovery — paused item preserved');
    persist.clearQueueState();
    const pausedItem: any = {
      id: 'test-id-paused',
      name: 'paused',
      priority: 'normal',
      status: 'paused',
      kind: 'function',
      functionKey: 'test:fn',
      enqueuedAt: 3000,
      progress: 0,
      cancellationKey: 'test-id-paused',
      maxRetries: 1,
      retryCount: 0,
    };
    persist.saveQueueState([pausedItem], { maxConcurrent: 2, historyLimit: 50 });
    const { items: items3 } = persist.recoverQueueState();
    const pausedRecover = items3.find((i: any) => i.id === 'test-id-paused');
    assertEqual(pausedRecover?.status, 'paused', 'paused status preserved');

    console.log('\nTest 8.5: queue re-enqueues recovered queued items on init');
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-tq-8b-'));
    const { mod } = await freshQueue(tmpDir2);
    // The freshQueue already cleared the state. Let's save a queued item and
    // re-init to verify recovery.
    mod.shutdownTaskQueue();
    // Save a queued item directly to disk
    persist.initTaskQueuePersistence(tmpDir2);
    const persistMod = await import('../../src/main/tasks/persistence.ts');
    persistMod.initTaskQueuePersistence(tmpDir2);
    persistMod.clearQueueState();
    persistMod.saveQueueState([{
      id: 'recovered-id',
      name: 'recovered',
      priority: 'high',
      status: 'queued',
      kind: 'function',
      functionKey: 'noop:echo',
      enqueuedAt: 4000,
      progress: 0,
      cancellationKey: 'recovered-id',
      maxRetries: 0,
      retryCount: 0,
    } as any], { maxConcurrent: 2, historyLimit: 50 });

    // Re-init the queue (fresh import)
    const suffix = Math.random().toString(36).slice(2, 8);
    const mod2 = await import(`../../src/main/tasks/queue.ts?${suffix}`);
    mod2.registerTaskFunction('noop:echo', async () => 'recovered-ok');
    mod2.initTaskQueue({
      userDataDir: tmpDir2,
      config: { maxConcurrent: 2, historyLimit: 50, defaultMaxRetries: 0, defaultPriority: 'normal' },
      agentRunTask: async () => ({}),
      agentCancelTask: () => true,
      agentGetTaskStatus: () => 'completed',
      agentOnEvent: () => () => {},
    });
    // The recovered item should be in the queue (queued or already running —
    // both indicate it was re-enqueued). Let it run and verify completion.
    await new Promise((r) => setTimeout(r, 200));
    const recovered = mod2.getTask('recovered-id');
    assert(!!recovered, 'recovered item is in the queue');
    // It should be running, completed, or queued (depending on worker timing).
    // The KEY assertion is that it's NOT lost — it survived the restart.
    assert(
      recovered?.status === 'queued' || recovered?.status === 'running' || recovered?.status === 'completed',
      `recovered item survived restart (status=${recovered?.status})`,
    );

    // Let it complete
    await new Promise((r) => setTimeout(r, 300));
    const finalRecovered = mod2.getTask('recovered-id');
    assertEqual(finalRecovered?.status, 'completed', 'recovered item ran and completed');

    mod2.shutdownTaskQueue();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 9: Agent integration
  // ════════════════════════════════════════════════════════════════════════
  await testSection('9. Agent integration', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-tq-9-'));
    const { mod, agentTasks } = await freshQueue(tmpDir);

    console.log('\nTest 9.1: enqueueAgentTask wraps an agent task id');
    // Register a fake agent task — set status to 'executing' so the mock
    // runs the polling loop (not completed yet)
    agentTasks.set('agent-123', { status: 'executing', events: [] });
    const item = mod.enqueueAgentTask('agent-123', { name: 'Agent task' });
    assertEqual(item.kind, 'agent', 'kind is agent');
    assertEqual(item.agentTaskId, 'agent-123', 'agentTaskId preserved');

    console.log('\nTest 9.2: agent task completes → queue item completes');
    // Set status to 'completed' so the mock's poll loop detects it
    agentTasks.get('agent-123')!.status = 'completed';
    await new Promise((r) => setTimeout(r, 200));
    const final = mod.getTask(item.id);
    assertEqual(final?.status, 'completed', 'queue item completed when agent did');

    console.log('\nTest 9.3: agent task fails → queue item fails');
    // Set status to 'failed' BEFORE enqueue so the mock detects it immediately
    agentTasks.set('agent-fail', { status: 'failed', events: [] });
    const item2 = mod.enqueueAgentTask('agent-fail', { name: 'failing agent', maxRetries: 0 });
    await new Promise((r) => setTimeout(r, 200));
    const final2 = mod.getTask(item2.id);
    // The agent mock throws when status='failed' — queue should mark as failed
    assertEqual(final2?.status, 'failed', `queue item failed (got ${final2?.status})`);

    console.log('\nTest 9.4: cancel agent-kind task propagates to agent');
    agentTasks.set('agent-cancel', { status: 'executing', events: [] });
    const item3 = mod.enqueueAgentTask('agent-cancel', { name: 'cancellable agent' });
    // Wait for the mock to start polling
    await new Promise((r) => setTimeout(r, 50));
    // Cancel — should set agentTasks status to 'cancelled' via agentCancelTask
    mod.cancelTask(item3.id, 'user cancelled');
    // Wait for the mock to detect the status change (polls every 10ms)
    await new Promise((r) => setTimeout(r, 200));
    const agentState = agentTasks.get('agent-cancel');
    assertEqual(agentState?.status, 'cancelled', 'agent task was cancelled via cancelTask propagation');
    const final3 = mod.getTask(item3.id);
    assertEqual(final3?.status, 'cancelled', 'queue item is cancelled');

    mod.shutdownTaskQueue();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 10: Orb integration
  // ════════════════════════════════════════════════════════════════════════
  await testSection('10. Orb integration', async () => {
    const orb = await import('../../src/main/tasks/orb-bridge.ts');

    console.log('\nTest 10.1: task_started → working');
    const r1 = orb.orbStateForTaskEvent({ type: 'task_started', taskId: 't1', timestamp: 0 });
    assertEqual(r1.state, 'working', 'task_started → working');
    assert(r1.clearAfterMs === undefined, 'no clear for working');

    console.log('\nTest 10.2: task_progress → working');
    const r2 = orb.orbStateForTaskEvent({ type: 'task_progress', taskId: 't1', timestamp: 0 });
    assertEqual(r2.state, 'working', 'task_progress → working');

    console.log('\nTest 10.3: task_completed → success + clearAfterMs');
    const r3 = orb.orbStateForTaskEvent({ type: 'task_completed', taskId: 't1', timestamp: 0 });
    assertEqual(r3.state, 'success', 'task_completed → success');
    assertEqual(r3.clearAfterMs, 1500, 'clearAfterMs = 1500');

    console.log('\nTest 10.4: task_failed → error + clearAfterMs');
    const r4 = orb.orbStateForTaskEvent({ type: 'task_failed', taskId: 't1', timestamp: 0 });
    assertEqual(r4.state, 'error', 'task_failed → error');
    assertEqual(r4.clearAfterMs, 1500, 'clearAfterMs = 1500');

    console.log('\nTest 10.5: task_cancelled → cancelled + clearAfterMs');
    const r5 = orb.orbStateForTaskEvent({ type: 'task_cancelled', taskId: 't1', timestamp: 0 });
    assertEqual(r5.state, 'cancelled', 'task_cancelled → cancelled');
    assertEqual(r5.clearAfterMs, 1500, 'clearAfterMs = 1500');

    console.log('\nTest 10.6: task_recovered → error + clearAfterMs (2000)');
    const r6 = orb.orbStateForTaskEvent({ type: 'task_recovered', taskId: 't1', timestamp: 0 });
    assertEqual(r6.state, 'error', 'task_recovered → error');
    assertEqual(r6.clearAfterMs, 2000, 'clearAfterMs = 2000');

    console.log('\nTest 10.7: task_enqueued/paused → no Orb change');
    const r7 = orb.orbStateForTaskEvent({ type: 'task_enqueued', taskId: 't1', timestamp: 0 });
    assertEqual(r7.state, null, 'task_enqueued → no change');
    const r8 = orb.orbStateForTaskEvent({ type: 'task_paused', taskId: 't1', timestamp: 0 });
    assertEqual(r8.state, null, 'task_paused → no change');

    console.log('\nTest 10.8: orb-bridge does NOT define its own state machine');
    // Verify by source inspection — orb-bridge.ts should only RETURN existing NexOrbState values
    const orbSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'tasks', 'orb-bridge.ts'),
      'utf-8',
    );
    assert(orbSource.includes("'working'"), 'uses working state');
    assert(orbSource.includes("'success'"), 'uses success state');
    assert(orbSource.includes("'error'"), 'uses error state');
    assert(orbSource.includes("'cancelled'"), 'uses cancelled state');
    assert(!orbSource.includes('VALID_TRANSITIONS'), 'does NOT define its own transition map');
    assert(!orbSource.includes('isValidOrbTransition'), 'does NOT define its own transition validator');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 11: Permission enforcement (source inspection)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('11. Permission enforcement', async () => {
    console.log('\nTest 11.1: queue.ts does NOT call executeTool directly');
    const queueSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'tasks', 'queue.ts'),
      'utf-8',
    );
    assert(!queueSource.includes('executeTool('), 'queue does not call executeTool() directly');
    assert(!queueSource.includes('executeToolWithPermission('), 'queue does not call executeToolWithPermission()');
    // The queue runs agent tasks via runTask() — which internally goes through permissions

    console.log('\nTest 11.2: queue.ts runs agent tasks via injected agentRunTask (no direct tool calls)');
    assert(queueSource.includes('_agentRunTaskFn'), 'uses injected agentRunTask');
    assert(queueSource.includes('_agentCancelTaskFn'), 'uses injected agentCancelTask');

    console.log('\nTest 11.3: agent core still uses executeToolWithPermission');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    assert(coreSource.includes('executeToolWithPermission'), 'agent core uses executeToolWithPermission');

    console.log('\nTest 11.4: main.ts wires the queue with the agent core (which has permissions)');
    const mainSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'),
      'utf-8',
    );
    assert(mainSource.includes('initTaskQueue'), 'main.ts calls initTaskQueue');
    assert(mainSource.includes('agentRunTask'), 'wires agentRunTask');
    assert(mainSource.includes('agentCancelTask'), 'wires agentCancelTask');
    assert(mainSource.includes('task-queue-enqueue'), 'exposes enqueue IPC');

    console.log('\nTest 11.5: function-kind tasks have NO automatic permission bypass');
    // The queue passes a TaskExecutionContext to functions — they must call
    // the permission API themselves if they do privileged operations.
    const typesSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'tasks', 'types.ts'),
      'utf-8',
    );
    assert(typesSource.includes('TaskExecutionContext'), 'TaskExecutionContext type defined');
    // Verify the context does NOT include any permission-granting field
    assert(!typesSource.includes('bypassPermission'), 'no bypassPermission field');
    assert(!typesSource.includes('grantAllPermissions'), 'no grantAllPermissions field');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 12: Race conditions
  // ════════════════════════════════════════════════════════════════════════
  await testSection('12. Race conditions', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-tq-12-'));
    const { mod } = await freshQueue(tmpDir, {
      config: { maxConcurrent: 4, historyLimit: 50, defaultMaxRetries: 0, defaultPriority: 'normal' },
    });

    console.log('\nTest 12.1: concurrent enqueues are all handled');
    mod.registerTaskFunction('test:concurrent', async () => 'ok');
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const item = mod.enqueueFunction('test:concurrent', { name: `c${i}` });
      ids.push(item.id);
    }
    await new Promise((r) => setTimeout(r, 500));
    let allCompleted = true;
    for (const id of ids) {
      const state = mod.getTask(id);
      if (state?.status !== 'completed') { allCompleted = false; break; }
    }
    assert(allCompleted, 'all 20 concurrent enqueues completed');

    console.log('\nTest 12.2: cancel + enqueue simultaneously (no crashes)');
    mod.registerTaskFunction('test:long', async () => {
      await new Promise((r) => setTimeout(r, 1000));
      return 'long';
    });
    const item1 = mod.enqueueFunction('test:long', { name: 'long1' });
    const item2 = mod.enqueueFunction('test:long', { name: 'long2' });
    // Cancel item1 while enqueueing more
    mod.cancelTask(item1.id);
    mod.enqueueFunction('test:concurrent', { name: 'more1' });
    mod.enqueueFunction('test:concurrent', { name: 'more2' });
    mod.cancelTask(item2.id);
    mod.enqueueFunction('test:concurrent', { name: 'more3' });
    await new Promise((r) => setTimeout(r, 300));
    // No crashes — queue still responds
    const state = mod.getQueueState();
    assert(typeof state.counts.completed === 'number', 'queue state still accessible');

    console.log('\nTest 12.3: rapid pause/resume cycles (no double-run)');
    mod.shutdownTaskQueue();
    fs.rmSync(tmpDir, { recursive: true, force: true });

    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-tq-12b-'));
    const { mod: mod2 } = await freshQueue(tmpDir2, {
      config: { maxConcurrent: 1, historyLimit: 50, defaultMaxRetries: 0, defaultPriority: 'normal' },
    });
    let runCount = 0;
    mod2.registerTaskFunction('test:pr', async () => {
      runCount++;
      await new Promise((r) => setTimeout(r, 50));
      return 'ok';
    });
    // Block the worker
    mod2.registerTaskFunction('test:blocker', async () => {
      await new Promise((r) => setTimeout(r, 300));
      return 'blocked';
    });
    mod2.enqueueFunction('test:blocker', { name: 'blocker' });
    const item = mod2.enqueueFunction('test:pr', { name: 'pr' });
    // Rapid pause/resume
    mod2.pauseTask(item.id);
    mod2.resumeTask(item.id);
    mod2.pauseTask(item.id);
    mod2.resumeTask(item.id);
    await new Promise((r) => setTimeout(r, 500));
    const final = mod2.getTask(item.id);
    assertEqual(final?.status, 'completed', 'task completed after rapid pause/resume');
    assertEqual(runCount, 1, 'task ran exactly once (no double-run)');

    mod2.shutdownTaskQueue();
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 13: Retry policy
  // ════════════════════════════════════════════════════════════════════════
  await testSection('13. Retry policy', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-tq-13-'));
    const { mod } = await freshQueue(tmpDir, {
      config: { maxConcurrent: 1, historyLimit: 50, defaultMaxRetries: 0, defaultPriority: 'normal' },
    });

    console.log('\nTest 13.1: retryable error re-enqueues (maxRetries=2)');
    let attempts = 0;
    mod.registerTaskFunction('test:retry', async () => {
      attempts++;
      if (attempts < 3) throw Object.assign(new Error('retryable'), { code: 'RETRY' });
      return 'success-on-3rd';
    });
    const item = mod.enqueueFunction('test:retry', { name: 'retry', maxRetries: 2 });
    await new Promise((r) => setTimeout(r, 500));
    const final = mod.getTask(item.id);
    assertEqual(final?.status, 'completed', 'task eventually completed after retries');
    assertEqual(final?.retryCount, 2, 'retryCount = 2');
    assertEqual(attempts, 3, 'function ran 3 times (1 + 2 retries)');

    console.log('\nTest 13.2: maxRetries=0 means no retries');
    let attempts2 = 0;
    mod.registerTaskFunction('test:no-retry', async () => {
      attempts2++;
      throw new Error('always-fails');
    });
    const item2 = mod.enqueueFunction('test:no-retry', { name: 'no-retry', maxRetries: 0 });
    await new Promise((r) => setTimeout(r, 200));
    const final2 = mod.getTask(item2.id);
    assertEqual(final2?.status, 'failed', 'task failed without retries');
    assertEqual(attempts2, 1, 'function ran only once');

    mod.shutdownTaskQueue();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 14: Event emission
  // ════════════════════════════════════════════════════════════════════════
  await testSection('14. Event emission', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-tq-14-'));
    const { mod } = await freshQueue(tmpDir, {
      config: { maxConcurrent: 1, historyLimit: 50, defaultMaxRetries: 0, defaultPriority: 'normal' },
    });

    console.log('\nTest 14.1: events fire for full lifecycle');
    const events: any[] = [];
    mod.onTaskQueueEvent((event: any) => events.push(event));
    mod.registerTaskFunction('test:events', async (ctx: any) => {
      ctx.reportProgress(50);
      return 'done';
    });
    const item = mod.enqueueFunction('test:events', { name: 'events' });
    await new Promise((r) => setTimeout(r, 300));

    const types = events.map((e) => e.type);
    assert(types.includes('task_enqueued'), 'task_enqueued fired');
    assert(types.includes('task_started'), 'task_started fired');
    assert(types.includes('task_progress'), 'task_progress fired');
    assert(types.includes('task_completed'), 'task_completed fired');

    console.log('\nTest 14.2: events include taskId + timestamp');
    for (const e of events) {
      assert(!!e.taskId, `event ${e.type} has taskId`);
      assert(typeof e.timestamp === 'number', `event ${e.type} has timestamp`);
    }

    console.log('\nTest 14.3: failure event includes error data');
    const failEvents: any[] = [];
    mod.onTaskQueueEvent((event: any) => failEvents.push(event));
    mod.registerTaskFunction('test:fail-evt', async () => { throw new Error('evt-fail'); });
    const item2 = mod.enqueueFunction('test:fail-evt', { name: 'fail-evt' });
    await new Promise((r) => setTimeout(r, 200));
    const failEvt = failEvents.find((e) => e.type === 'task_failed');
    assert(!!failEvt, 'task_failed event fired');
    assert(!!failEvt?.data?.error, 'failed event has error data');

    mod.shutdownTaskQueue();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 15: History pruning
  // ════════════════════════════════════════════════════════════════════════
  await testSection('15. History pruning', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-tq-15-'));
    const { mod } = await freshQueue(tmpDir, {
      config: { maxConcurrent: 1, historyLimit: 3, defaultMaxRetries: 0, defaultPriority: 'normal' },
    });

    console.log('\nTest 15.1: pruneHistory removes old terminal items');
    mod.registerTaskFunction('test:fast', async () => 'ok');
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const item = mod.enqueueFunction('test:fast', { name: `f${i}` });
      ids.push(item.id);
      await new Promise((r) => setTimeout(r, 50));
    }
    // All 5 should be completed
    const beforePrune = mod.listTasks();
    const completedBefore = beforePrune.filter((t: any) => t.status === 'completed');
    assertEqual(completedBefore.length, 5, 'all 5 completed before prune');

    const prunedCount = mod.pruneHistory();
    assertEqual(prunedCount, 2, 'pruned 2 items (historyLimit=3)');

    const afterPrune = mod.listTasks().filter((t: any) => t.status === 'completed');
    assertEqual(afterPrune.length, 3, '3 completed items remain after prune');

    mod.shutdownTaskQueue();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 6 task queue tests: ${passed}/${passed + failed} passed (${failed} failed)`);
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
