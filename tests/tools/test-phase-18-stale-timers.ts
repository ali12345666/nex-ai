/**
 * NEX AI — Phase 18 Stage 2: Stale Orb Condition Timer Tests (P2-1)
 *
 * Tests that:
 *   - NexChatPanel captures timer IDs for 'agent' + 'chat' condition auto-clears
 *   - AppShell captures timer IDs for 'queue' + 'engine' condition auto-clears
 *   - A stale timer from an old task is cleared before scheduling a new one
 *   - The 1500ms UX behavior is preserved
 *   - The invariant holds: a stale timer NEVER clears a newer task's condition
 *
 * Run with: npx tsx tests/tools/test-phase-18-stale-timers.ts
 */

import * as path from 'path';
import * as fs from 'fs';

let passed = 0, failed = 0;
const failures: string[] = [];

function assert(condition: boolean, name: string) {
  if (condition) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; failures.push(name); console.error(`  FAIL: ${name}`); }
}

async function testSection(name: string, fn: () => Promise<void> | void): Promise<void> {
  console.log(`\n=== ${name} ===`);
  try { await fn(); }
  catch (err) { failed++; failures.push(`${name} (threw: ${(err as Error).message})`); console.error(`  CRASH: ${name}:`, (err as Error).message); }
}

async function runTests() {
  console.log('Phase 18 Stage 2: Stale Orb Condition Timer Tests (P2-1)\n');

  const chatSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'chat', 'NexChatPanel.tsx'),
    'utf-8',
  );
  const appShellSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'layout', 'AppShell.tsx'),
    'utf-8',
  );

  // ════════════════════════════════════════════════════════════════════════
  // 1. NexChatPanel: 'agent' condition timer capture
  // ════════════════════════════════════════════════════════════════════════
  await testSection('1. NexChatPanel: agent condition timer capture', async () => {
    console.log('\nTest 1.1: agentClearTimerRef declared');
    assert(chatSource.includes('agentClearTimerRef'), 'agentClearTimerRef exists');

    console.log('\nTest 1.2: chatClearTimerRef declared');
    assert(chatSource.includes('chatClearTimerRef'), 'chatClearTimerRef exists');

    console.log('\nTest 1.3: scheduleConditionClear helper exists');
    assert(chatSource.includes('scheduleConditionClear'), 'scheduleConditionClear helper exists');

    console.log('\nTest 1.4: scheduleConditionClear clears previous timer before scheduling');
    const scheduleStart = chatSource.indexOf('const scheduleConditionClear = useCallback');
    assert(scheduleStart > 0, 'scheduleConditionClear defined');
    const scheduleEnd = chatSource.indexOf('},', scheduleStart + 100);
    const scheduleBody = chatSource.substring(scheduleStart, scheduleEnd + 5);
    assert(scheduleBody.includes('clearTimeout'), 'clears previous timer');
    assert(scheduleBody.includes('timerRef.current = null'), 'clears ref before scheduling');

    console.log('\nTest 1.5: all 3 agent condition auto-clears use scheduleConditionClear');
    // Find all "scheduleConditionClear('agent'" calls
    const agentClears = (chatSource.match(/scheduleConditionClear\('agent'/g) || []).length;
    assert(agentClears === 3, `3 agent condition auto-clears use scheduleConditionClear (found ${agentClears})`);

    console.log('\nTest 1.6: all 3 chat condition auto-clears use scheduleConditionClear');
    const chatClears = (chatSource.match(/scheduleConditionClear\('chat'/g) || []).length;
    assert(chatClears === 3, `3 chat condition auto-clears use scheduleConditionClear (found ${chatClears})`);

    console.log('\nTest 1.7: NO anonymous setTimeout clearCondition for agent/chat remain');
    // Code-line check (not comments)
    const anonymousLines = chatSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') &&
      l.includes("setTimeout(() => voiceController.clearCondition(")
    );
    assert(anonymousLines.length === 0, `no anonymous setTimeout clearCondition in NexChatPanel (found ${anonymousLines.length})`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. AppShell: 'queue' condition timer capture
  // ════════════════════════════════════════════════════════════════════════
  await testSection('2. AppShell: queue condition timer capture', async () => {
    console.log('\nTest 2.1: scheduleQueueClear helper exists');
    assert(appShellSource.includes('scheduleQueueClear'), 'scheduleQueueClear helper exists');

    console.log('\nTest 2.2: scheduleQueueClear clears previous timer before scheduling');
    const queueStart = appShellSource.indexOf('const scheduleQueueClear = () => {');
    assert(queueStart > 0, 'scheduleQueueClear defined');
    const queueEnd = appShellSource.indexOf('};', queueStart + 50);
    const queueBody = appShellSource.substring(queueStart, queueEnd + 2);
    assert(queueBody.includes('clearTimeout'), 'clears previous timer');
    assert(queueBody.includes('queueClearTimer = null'), 'clears ref before scheduling');

    console.log('\nTest 2.3: all 3 queue condition auto-clears use scheduleQueueClear');
    const queueClears = (appShellSource.match(/scheduleQueueClear\(\)/g) || []).length;
    assert(queueClears === 3, `3 queue condition auto-clears use scheduleQueueClear (found ${queueClears})`);

    console.log('\nTest 2.4: old queueTimers array REMOVED');
    // The old code used `const queueTimers: number[] = []` — should be gone
    const queueTimersCodeLines = appShellSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') && l.includes('queueTimers')
    );
    assert(queueTimersCodeLines.length === 0, `old queueTimers array removed from code (found ${queueTimersCodeLines.length})`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. AppShell: 'engine' condition timer capture
  // ════════════════════════════════════════════════════════════════════════
  await testSection('3. AppShell: engine condition timer capture', async () => {
    console.log('\nTest 3.1: scheduleEngineClear helper exists');
    assert(appShellSource.includes('scheduleEngineClear'), 'scheduleEngineClear helper exists');

    console.log('\nTest 3.2: scheduleEngineClear clears previous timer before scheduling');
    const engineStart = appShellSource.indexOf('const scheduleEngineClear = () => {');
    assert(engineStart > 0, 'scheduleEngineClear defined');
    const engineEnd = appShellSource.indexOf('};', engineStart + 50);
    const engineBody = appShellSource.substring(engineStart, engineEnd + 2);
    assert(engineBody.includes('clearTimeout'), 'clears previous timer');
    assert(engineBody.includes('engineClearTimer = null'), 'clears ref before scheduling');

    console.log('\nTest 3.3: engine error auto-clear uses scheduleEngineClear');
    const engineClears = (appShellSource.match(/scheduleEngineClear\(\)/g) || []).length;
    assert(engineClears >= 1, `engine error auto-clear uses scheduleEngineClear (found ${engineClears})`);

    console.log('\nTest 3.4: NO anonymous setTimeout clearCondition for engine remains');
    const anonymousEngineLines = appShellSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') &&
      l.includes("setTimeout(() => voiceController.clearCondition('engine')")
    );
    assert(anonymousEngineLines.length === 0, `no anonymous setTimeout clearCondition('engine') in AppShell (found ${anonymousEngineLines.length})`);

    console.log('\nTest 3.5: NO anonymous setTimeout clearCondition for queue remains');
    const anonymousQueueLines = appShellSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') &&
      l.includes("setTimeout(() => voiceController.clearCondition('queue')")
    );
    assert(anonymousQueueLines.length === 0, `no anonymous setTimeout clearCondition('queue') in AppShell (found ${anonymousQueueLines.length})`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4. Runtime: stale timer cannot clear newer task's condition
  // ════════════════════════════════════════════════════════════════════════
  await testSection('4. Runtime: stale timer cannot clear newer task condition', async () => {
    console.log('\nTest 4.1: stale timer is cleared before new timer fires');

    // Simulate the scheduleConditionClear logic from NexChatPanel
    let timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    let conditionCleared = false;
    let clearCount = 0;

    function scheduleClear() {
      // Clear any previously-scheduled timer
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      timerRef.current = setTimeout(() => {
        conditionCleared = true;
        clearCount++;
        timerRef.current = null;
      }, 100); // short timeout for test speed
    }

    // Scenario: Task A completes → schedule 100ms clear
    // Then Task B starts at 50ms → schedule another clear
    // The Task A timer should be CLEARED (not fire) when Task B's timer is scheduled
    conditionCleared = false;
    clearCount = 0;
    scheduleClear(); // Task A — schedule 100ms clear

    // Wait 50ms — Task A timer is still pending
    await new Promise((r) => setTimeout(r, 50));
    assert(clearCount === 0, 'Task A timer not fired yet (50ms < 100ms)');

    // Task B starts → schedule another clear (should clear Task A's timer)
    conditionCleared = false;
    scheduleClear(); // Task B — clears Task A's timer, schedules new 100ms

    // Wait 50ms — neither Task A nor Task B timer should have fired
    await new Promise((r) => setTimeout(r, 50));
    assert(clearCount === 0, 'no timer fired 50ms after Task B (both < 100ms)');

    // Wait 60ms more (total 110ms from Task B) — Task B's timer fires
    await new Promise((r) => setTimeout(r, 60));
    assert(clearCount === 1, 'Task B timer fired (110ms > 100ms)');
    assert(conditionCleared === true, 'condition was cleared by Task B timer, not Task A');

    console.log('\nTest 4.2: stale timer fires only ONCE (Task A cleared, not fired)');

    // If Task A's timer had NOT been cleared, it would fire at 100ms (50ms + 50ms).
    // Since it was cleared, only Task B's timer fires.
    // clearCount should be 1 (Task B), not 2 (Task A + Task B).
    assert(clearCount === 1, `only 1 timer fired (Task A was cleared, not fired) — clearCount=${clearCount}`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5. Runtime: rapid successive events don't accumulate stale timers
  // ════════════════════════════════════════════════════════════════════════
  await testSection('5. Runtime: rapid successive events do not accumulate', async () => {
    console.log('\nTest 5.1: 5 rapid events produce at most 1 timer firing');

    let timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    let clearCount = 0;

    function scheduleClear() {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      timerRef.current = setTimeout(() => {
        clearCount++;
        timerRef.current = null;
      }, 100);
    }

    // Fire 5 events in rapid succession (every 20ms)
    for (let i = 0; i < 5; i++) {
      scheduleClear();
      await new Promise((r) => setTimeout(r, 20));
    }

    // At this point, only the 5th timer is pending (previous 4 were cleared)
    // Wait 120ms for it to fire
    await new Promise((r) => setTimeout(r, 120));
    assert(clearCount === 1, `only 1 timer fired after 5 rapid events (clearCount=${clearCount})`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 6. Source-level: 1500ms UX behavior preserved
  // ════════════════════════════════════════════════════════════════════════
  await testSection('6. 1500ms UX behavior preserved', async () => {
    console.log('\nTest 6.1: NexChatPanel scheduleConditionClear uses 1500ms');
    // The scheduleConditionClear function should use 1500ms
    const scheduleStart = chatSource.indexOf('const scheduleConditionClear = useCallback');
    const scheduleEnd = chatSource.indexOf('},', scheduleStart + 200);
    const scheduleBody = chatSource.substring(scheduleStart, scheduleEnd);
    assert(scheduleBody.includes('1500'), 'uses 1500ms timeout');

    console.log('\nTest 6.2: AppShell scheduleQueueClear uses 1500ms');
    const queueStart = appShellSource.indexOf('const scheduleQueueClear = () => {');
    const queueEnd = appShellSource.indexOf('};', queueStart + 50);
    const queueBody = appShellSource.substring(queueStart, queueEnd);
    assert(queueBody.includes('1500'), 'uses 1500ms timeout');

    console.log('\nTest 6.3: AppShell scheduleEngineClear uses 1500ms');
    const engineStart = appShellSource.indexOf('const scheduleEngineClear = () => {');
    const engineEnd = appShellSource.indexOf('};', engineStart + 50);
    const engineBody = appShellSource.substring(engineStart, engineEnd);
    assert(engineBody.includes('1500'), 'uses 1500ms timeout');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 7. Source-level: unmount cleanup clears pending timers
  // ════════════════════════════════════════════════════════════════════════
  await testSection('7. Unmount cleanup clears pending timers', async () => {
    console.log('\nTest 7.1: AppShell queue useEffect cleanup clears queueClearTimer');
    // Find the return cleanup for the queue useEffect
    const queueCleanup = appShellSource.indexOf('if (queueClearTimer !== null) clearTimeout(queueClearTimer)');
    assert(queueCleanup > 0, 'queue cleanup clears queueClearTimer');

    console.log('\nTest 7.2: AppShell voice useEffect cleanup clears engineClearTimer');
    const engineCleanup = appShellSource.indexOf('if (engineClearTimer !== null) clearTimeout(engineClearTimer)');
    assert(engineCleanup > 0, 'voice cleanup clears engineClearTimer');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 18 Stage 2 stale timer tests: ${passed}/${passed + failed} passed (${failed} failed)`);
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
