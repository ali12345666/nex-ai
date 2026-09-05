/**
 * NEX AI — Phase 14: Voice Response Loop Completion — Tests
 *
 * Tests that voice-origin requests trigger TTS playback after response,
 * while text-origin requests do not.
 *
 * Run with: npx tsx tests/tools/test-phase-14-voice-response.ts
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
  console.log('Phase 14: Voice Response Loop Completion Tests\n');

  const appShellSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'layout', 'AppShell.tsx'),
    'utf-8',
  );
  const chatSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'chat', 'NexChatPanel.tsx'),
    'utf-8',
  );

  // ════════════════════════════════════════════════════════════════════════
  // 1. AppShell: source='voice' in nex:voice-transcript events
  // ════════════════════════════════════════════════════════════════════════
  await testSection('1. AppShell: voice transcript source', async () => {
    console.log('\nTest 1.1: Browser STT path has source=voice');
    assert(appShellSource.includes("detail: { text, source: 'voice' }"), 'browser STT → source=voice');

    console.log('\nTest 1.2: Wake word path has source=voice');
    assert(appShellSource.includes("detail: { text: 'بله?', source: 'voice' }"), 'wake word → source=voice');

    console.log('\nTest 1.3: Whisper path has source=voice');
    assert(appShellSource.includes("detail: { text: text.trim(), source: 'voice' }"), 'whisper → source=voice');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. NexChatPanel: wasVoiceInputRef tracking
  // ════════════════════════════════════════════════════════════════════════
  await testSection('2. NexChatPanel: voice input tracking', async () => {
    console.log('\nTest 2.1: wasVoiceInputRef declared');
    assert(chatSource.includes('wasVoiceInputRef'), 'wasVoiceInputRef exists');

    console.log('\nTest 2.2: wasVoiceInputRef set to true when source=voice');
    assert(chatSource.includes("wasVoiceInputRef.current = detail.source === 'voice'"), 'sets true for voice');

    console.log('\nTest 2.3: ttsCancelledRef declared');
    assert(chatSource.includes('ttsCancelledRef'), 'ttsCancelledRef exists');

    console.log('\nTest 2.4: ttsCancelledRef reset on new request');
    assert(chatSource.includes('ttsCancelledRef.current = false'), 'resets on new request');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. speakResponseIfVoice function
  // ════════════════════════════════════════════════════════════════════════
  await testSection('3. speakResponseIfVoice function', async () => {
    console.log('\nTest 3.1: speakResponseIfVoice function exists');
    assert(chatSource.includes('speakResponseIfVoice'), 'function exists');

    console.log('\nTest 3.2: checks wasVoiceInputRef before speaking');
    assert(chatSource.includes("if (!wasVoiceInputRef.current) return"), 'guards on voice flag');

    console.log('\nTest 3.3: checks ttsCancelledRef before speaking');
    assert(chatSource.includes("if (ttsCancelledRef.current) return"), 'guards on cancel flag');

    console.log('\nTest 3.4: checks empty text');
    assert(chatSource.includes("if (!text) return"), 'skips empty text');

    console.log('\nTest 3.5: calls voiceConversationSpeak');
    assert(chatSource.includes('voiceConversationSpeak'), 'calls TTS IPC');

    console.log('\nTest 3.6: resets wasVoiceInputRef after speaking (one-shot)');
    assert(chatSource.includes('wasVoiceInputRef.current = false'), 'resets after speak');

    console.log('\nTest 3.7: TTS errors are non-blocking (catch)');
    assert(chatSource.includes('.catch((err: any)'), 'catch on TTS failure');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4. TTS called after agent task_completed
  // ════════════════════════════════════════════════════════════════════════
  await testSection('4. TTS after agent task_completed', async () => {
    console.log('\nTest 4.1: speakResponseIfVoice called in task_completed');
    const completedSection = chatSource.substring(
      chatSource.indexOf("case 'task_completed'"),
      chatSource.indexOf("case 'task_failed'"),
    );
    assert(completedSection.includes('speakResponseIfVoice'), 'TTS called after task_completed');

    console.log('\nTest 4.2: uses spokenText (not raw event data)');
    assert(completedSection.includes('spokenText'), 'uses clean spokenText variable');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5. TTS called after chat stream completion
  // ════════════════════════════════════════════════════════════════════════
  await testSection('5. TTS after chat stream completion', async () => {
    console.log('\nTest 5.1: speakResponseIfVoice called in chat stream success');
    const streamSection = chatSource.substring(
      chatSource.indexOf('const stream = await window.nexAPI.aiChatStream'),
      chatSource.indexOf('} else if (stream.error'),
    );
    assert(streamSection.includes('speakResponseIfVoice'), 'TTS called after chat stream');

    console.log('\nTest 5.2: speakResponseIfVoice called in non-streaming fallback');
    const fallbackSection = chatSource.substring(
      chatSource.indexOf('const result = await window.nexAPI.aiChat('),
      chatSource.indexOf('} else {'),
    );
    assert(fallbackSection.includes('speakResponseIfVoice'), 'TTS called after non-streaming chat');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 6. Cancellation prevents TTS
  // ════════════════════════════════════════════════════════════════════════
  await testSection('6. Cancellation prevents TTS', async () => {
    console.log('\nTest 6.1: handleStop sets ttsCancelledRef = true');
    const stopSection = chatSource.substring(
      chatSource.indexOf('const handleStop'),
      chatSource.indexOf('}, []);\n\n  // Phase 115'),
    );
    assert(stopSection.includes('ttsCancelledRef.current = true'), 'stop sets cancel flag');

    console.log('\nTest 6.2: handleStop resets wasVoiceInputRef');
    assert(stopSection.includes('wasVoiceInputRef.current = false'), 'stop resets voice flag');

    console.log('\nTest 6.3: handleStop stops TTS playback');
    assert(stopSection.includes('voiceConversationStopSpeaking'), 'stop calls TTS stop');

    console.log('\nTest 6.4: task_cancelled resets voice flags');
    const cancelledSection = chatSource.substring(
      chatSource.indexOf("case 'task_cancelled'"),
      chatSource.indexOf("case 'permission_request'"),
    );
    assert(cancelledSection.includes('wasVoiceInputRef.current = false'), 'cancelled resets voice flag');
    assert(cancelledSection.includes('ttsCancelledRef.current = true'), 'cancelled sets cancel flag');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 7. No duplicate TTS
  // ════════════════════════════════════════════════════════════════════════
  await testSection('7. No duplicate TTS', async () => {
    console.log('\nTest 7.1: speakResponseIfVoice appears exactly 3 times');
    const count = (chatSource.match(/speakResponseIfVoice/g) || []).length;
    // 1: definition, 2: agent task_completed, 3: chat stream, 4: non-streaming fallback = 4
    assert(count === 4, `exactly 4 occurrences (def + agent + stream + fallback), got ${count}`);

    console.log('\nTest 7.2: speakResponseIfVoice NOT in task_failed');
    const failedSection = chatSource.substring(
      chatSource.indexOf("case 'task_failed'"),
      chatSource.indexOf("case 'task_cancelled'"),
    );
    assert(!failedSection.includes('speakResponseIfVoice'), 'no TTS on task_failed');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 8. TTS not called for intermediate events
  // ════════════════════════════════════════════════════════════════════════
  await testSection('8. TTS not for intermediate events', async () => {
    console.log('\nTest 8.1: speakResponseIfVoice NOT in planning_started');
    const planningSection = chatSource.substring(
      chatSource.indexOf("case 'planning_started'"),
      chatSource.indexOf("case 'planning_completed'"),
    );
    assert(!planningSection.includes('speakResponseIfVoice'), 'no TTS on planning_started');

    console.log('\nTest 8.2: speakResponseIfVoice NOT in step_started');
    const stepSection = chatSource.substring(
      chatSource.indexOf("case 'step_started'"),
      chatSource.indexOf("case 'step_completed'"),
    );
    assert(!stepSection.includes('speakResponseIfVoice'), 'no TTS on step_started');

    console.log('\nTest 8.3: speakResponseIfVoice NOT in permission_request');
    const permSection = chatSource.substring(
      chatSource.indexOf("case 'permission_request'"),
      chatSource.indexOf("default:"),
    );
    assert(!permSection.includes('speakResponseIfVoice'), 'no TTS on permission_request');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 9. Security
  // ════════════════════════════════════════════════════════════════════════
  await testSection('9. Security', async () => {
    console.log('\nTest 9.1: Only response text passed to TTS (not tool params)');
    // The speakResponseIfVoice only takes responseText — no tool params
    assert(chatSource.includes('speakResponseIfVoice(spokenText)'), 'agent uses spokenText');
    assert(chatSource.includes('speakResponseIfVoice(finalContent)'), 'chat uses finalContent');
    assert(chatSource.includes('speakResponseIfVoice(result.content'), 'fallback uses result.content');

    console.log('\nTest 9.2: TTS call is best-effort (catch)');
    assert(chatSource.includes("console.warn('[TTS]"), 'TTS failure logged but non-blocking');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 10. Regression
  // ════════════════════════════════════════════════════════════════════════
  await testSection('10. Regression', async () => {
    console.log('\nTest 10.1: Phase 6 task queue intact');
    assert(fs.existsSync(path.join(__dirname, '..', '..', 'src', 'main', 'tasks', 'queue.ts')), 'Phase 6 intact');

    console.log('\nTest 10.2: Phase 7 recovery intact');
    assert(fs.existsSync(path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'recovery-engine.ts')), 'Phase 7 intact');

    console.log('\nTest 10.3: Phase 13 wiring intact');
    const mainSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'),
      'utf-8',
    );
    assert(mainSource.includes('wireAgentRequest'), 'Phase 13 wireAgentRequest intact');

    console.log('\nTest 10.4: Orb state transitions preserved');
    assert(chatSource.includes("voiceController.setCondition('agent', 'success')"), 'SUCCESS transition');
    assert(chatSource.includes("voiceController.setCondition('agent', 'error')"), 'ERROR transition');
    assert(chatSource.includes("voiceController.setCondition('agent', 'cancelled')"), 'CANCELLED transition');
    assert(chatSource.includes("voiceController.setCondition('agent', 'thinking')"), 'THINKING transition');
    assert(chatSource.includes("voiceController.setCondition('agent', 'working')"), 'WORKING transition');

    console.log('\nTest 10.5: Phase 14 changes are additive (no breaking changes)');
    // Voice transcript handler still works (just adds source tracking)
    assert(chatSource.includes("window.addEventListener('nex:voice-transcript'"), 'voice transcript listener exists');
    // handleStop still cancels chat + agent
    assert(chatSource.includes('aiChatStreamCancel'), 'chat cancel preserved');
    assert(chatSource.includes('agentCancelTask'), 'agent cancel preserved');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 14 voice response tests: ${passed}/${passed + failed} passed (${failed} failed)`);
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
