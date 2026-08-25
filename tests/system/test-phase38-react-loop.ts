/**
 * Phase 38 — ReAct Closed-Loop Brain Regression Tests
 *
 * Verifies the agent's new closed-loop architecture:
 *   1. Verification is wired (verifyToolResult is actually called)
 *   2. ReAct decision types exist
 *   3. rePlanAfterObservation function exists and is imported by core
 *   4. shouldInvokeRePlanner fast-path heuristic works
 *   5. Safety rails are preserved (maxSteps, maxToolCalls, cancellation)
 *   6. ReAct events are emitted (react_decision, replan_started, replan_completed)
 *
 * These are STATIC/STRUCTURAL tests — they verify the closed-loop is
 * present in source. Windows runtime QA is NOT VERIFIED here.
 *
 * Run: npx tsx tests/system/test-phase38-react-loop.ts
 */
import '../__mocks__/install-electron-mock.js';

import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main(): Promise<void> {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) ReAct types exist in types.ts
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) ReAct types in types.ts:');
  const typesSrc = read('../../src/main/agent/types.ts');

  assert('ReActAction type exists', typesSrc.includes("export type ReActAction = 'continue' | 'replan' | 'complete' | 'abort'"));
  assert('ReActDecision interface exists', typesSrc.includes('export interface ReActDecision'));
  assert('ReActDecision has action field', /interface ReActDecision[\s\S]{0,100}action:/.test(typesSrc));
  assert('ReActDecision has reason field', /interface ReActDecision[\s\S]{0,200}reason:/.test(typesSrc));
  assert('ReActDecision has confidence field', /interface ReActDecision[\s\S]{0,300}confidence:/.test(typesSrc));
  assert('ReActDecision has newSteps field', /interface ReActDecision[\s\S]{0,400}newSteps/.test(typesSrc));
  assert('ReActDecision has finalAnswer field', /finalAnswer\?: string/.test(typesSrc));
  assert('ReActRequest interface exists', typesSrc.includes('export interface ReActRequest'));
  assert('ReActRequest has userRequest', /interface ReActRequest[\s\S]{0,100}userRequest/.test(typesSrc));
  assert('ReActRequest has observation', /observation: Observation/.test(typesSrc));
  assert('ReActRequest has remainingSteps', /remainingSteps: Array/.test(typesSrc));
  assert('ReActRequest has recentObservations', /recentObservations: Observation\[\]/.test(typesSrc));
  assert('ReActRequest has tools', /tools: ToolDefinition\[\]/.test(typesSrc));

  // AgentStep has verificationCriteria (Phase 38)
  assert('AgentStep has verificationCriteria', typesSrc.includes('verificationCriteria?:'));
  assert('AgentStep has injectedByReAct', typesSrc.includes('injectedByReAct?:'));

  // New event types
  assert('react_decision event type', typesSrc.includes("'react_decision'"));
  assert('replan_started event type', typesSrc.includes("'replan_started'"));
  assert('replan_completed event type', typesSrc.includes("'replan_completed'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) react-loop.ts module exists with correct exports
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) react-loop.ts module:');
  const reactSrc = read('../../src/main/agent/react-loop.ts');

  assert('react-loop.ts file exists', reactSrc.length > 0);
  assert('rePlanAfterObservation exported', reactSrc.includes('export async function rePlanAfterObservation'));
  assert('shouldInvokeRePlanner exported', reactSrc.includes('export function shouldInvokeRePlanner'));
  assert('REACT_SYSTEM_PROMPT present', reactSrc.includes('REACT_SYSTEM_PROMPT'));
  assert('uses buildContext', reactSrc.includes('buildContext'));
  assert('uses runtime.chat', reactSrc.includes('runtime.chat'));
  assert('uses runtime.chatStream (for streaming)', reactSrc.includes('runtime.chatStream'));
  assert('parseReActResponse function', reactSrc.includes('function parseReActResponse'));
  assert('buildReActContextMessage function', reactSrc.includes('function buildReActContextMessage'));
  assert('max 10 steps per replan cap', reactSrc.includes('slice(0, 10)'));
  assert('defaults to continue on failure', /return\s*\{[^}]*action:\s*'continue'/.test(reactSrc));
  assert('low temperature (0.2) for decisions', reactSrc.includes('temperature: 0.2'));
  assert('replan without newSteps → abort', reactSrc.includes("decision.action = 'abort'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) core.ts imports and uses ReAct
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) core.ts wiring:');
  const coreSrc = read('../../src/main/agent/core.ts');

  assert('core imports rePlanAfterObservation', coreSrc.includes('rePlanAfterObservation'));
  assert('core imports shouldInvokeRePlanner', coreSrc.includes('shouldInvokeRePlanner'));
  assert('core imports from react-loop', coreSrc.includes("from './react-loop'"));
  assert('core imports ReActDecision type', coreSrc.includes('type ReActDecision'));
  assert('verifyToolResult is CALLED (not just imported)', /verifyToolResult\(\{/.test(coreSrc));
  assert('verification_criteria check in executeStep', coreSrc.includes('step.verificationCriteria'));
  assert('verification_started event emitted', coreSrc.includes("type: 'verification_started'"));
  assert('verification_completed event emitted', coreSrc.includes("type: 'verification_completed'"));
  assert('react_decision event emitted', coreSrc.includes("type: 'react_decision'"));
  assert('replan_started event emitted', coreSrc.includes("type: 'replan_started'"));
  assert('replan_completed event emitted', coreSrc.includes("type: 'replan_completed'"));
  assert('shouldInvokeRePlanner called', coreSrc.includes('shouldInvokeRePlanner(result, step, observation'));
  assert('rePlanAfterObservation called', coreSrc.includes('await rePlanAfterObservation(runtime, model'));
  assert('ReAct abort handling', coreSrc.includes("reactDecision.action === 'abort'"));
  assert('ReAct complete handling', coreSrc.includes("reactDecision.action === 'complete'"));
  assert('ReAct replan handling', coreSrc.includes("reactDecision.action === 'replan'"));
  assert('ReAct replan injects new steps', coreSrc.includes('injectedByReAct: true'));
  assert('ReAct replan re-indexes steps', coreSrc.includes('index: task.currentStepIndex + 1 + idx'));
  assert('ReAct complete marks remaining as skipped', /for \(let i = task\.currentStepIndex \+ 1/.test(coreSrc));
  assert('cancellation checkpoint before ReAct LLM', /shouldInvokeRePlanner[\s\S]{0,200}token\.throwIfCancelled/.test(coreSrc));
  assert('cancellation checkpoint after ReAct LLM', /rePlanAfterObservation[\s\S]{0,800}token\.throwIfCancelled/.test(coreSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) shouldInvokeRePlanner heuristic logic
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) shouldInvokeRePlanner fast-path logic:');
  assert('invokes on last step', /isLastStep\) return true/.test(reactSrc));
  assert('invokes on tool failure', /toolResult && !toolResult\.success\) return true/.test(reactSrc));
  assert('invokes on error signals', /s\.type === 'error' \|\| s\.type === 'needs-attention'/.test(reactSrc));
  assert('invokes on complex verification', /expectedOutputRegex/.test(reactSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Safety rails preserved (maxSteps, maxToolCalls, cancellation)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Safety rails preserved:');
  assert('maxSteps check still present', coreSrc.includes('task.maxSteps'));
  assert('maxToolCalls check still present', coreSrc.includes('task.maxToolCalls'));
  assert('maxExecutionTimeMs check still present', coreSrc.includes('task.maxExecutionTimeMs'));
  assert('CancellationToken still used', coreSrc.includes('token.throwIfCancelled'));
  assert('handleStepFailure still present', coreSrc.includes('async function handleStepFailure'));
  assert('permission system still used', coreSrc.includes('requestPermissionAndWait'));
  assert('diff approval still used', coreSrc.includes('proposeChange'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Verification wired (verifyToolResult actually called, not dead code)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Verification wired (not dead code):');
  assert('verifyToolResult CALL in executeStep', /verifyToolResult\(\{[\s\S]{0,200}stepId: step\.id/.test(coreSrc));
  assert('verification result pushed to task.verification', coreSrc.includes('task.verification.push(verification)'));
  assert('verificationPassed tracked', coreSrc.includes('verificationPassed'));
  assert('verification gates step completion', /verificationPassed[\s\S]{0,100}step\.status = 'completed'/.test(coreSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Closed-loop architecture (ReAct loop is the canonical loop)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Closed-loop architecture:');
  // The FOUR canonical ReAct actions
  assert('continue action handled', coreSrc.includes("'continue'") || reactSrc.includes("'continue'"));
  assert('replan action handled', coreSrc.includes("'replan'"));
  assert('complete action handled', coreSrc.includes("'complete'"));
  assert('abort action handled', coreSrc.includes("'abort'"));
  // The LLM is called BETWEEN steps (not just at planning time)
  assert('LLM called mid-loop (rePlanAfterObservation)', coreSrc.includes('await rePlanAfterObservation'));
  // Observations are fed back to the LLM
  assert('recentObservations passed to re-planner', coreSrc.includes('recentObservations: task.observations.slice(-5)'));
  // Remaining steps are passed to the re-planner
  assert('remainingSteps passed to re-planner', coreSrc.includes('remainingSteps'));
  // The decision can modify the plan
  assert('replan replaces remaining steps', coreSrc.includes('task.plan = ['));
  assert('replan slices plan', coreSrc.includes('task.plan.slice(0, task.currentStepIndex + 1)'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Agent flow documented in comments
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Architecture documented:');
  assert('react-loop.ts has Phase 38 header', reactSrc.includes('Phase 38'));
  assert('react-loop.ts documents closed loop', reactSrc.includes('closed loop') || reactSrc.includes('CLOSED-LOOP'));
  assert('core.ts has Phase 38 verification comment', coreSrc.includes('Phase 38: VERIFICATION'));
  assert('core.ts has Phase 38 ReAct comment', coreSrc.includes('Phase 38: ReAct'));

  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 38 REACT LOOP RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('PHASE 38 REACT CLOSED-LOOP: ALL PASS ✅');
  console.log('\nNOTE: Windows runtime QA is NOT VERIFIED by this test.');
  console.log('      The user MUST verify the 3 test scenarios on Windows:');
  console.log('      Test 1: Analyze → Modify → Test → Verify → Report');
  console.log('      Test 2: Error → Analyze → Replan → Retry');
  console.log('      Test 3: Cancellation → Immediate Stop → Clean State');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
