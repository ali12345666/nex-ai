/**
 * Phase 14 / P14-A+B — Trust levels, corroboration, classified retries
 *
 * A: trustLevelForTool mapping; assessTrust (model-generated success →
 *    corroboration required); corroborate (modifiedFiles/okCount/
 *    resultCount/exitCode as structural evidence)
 * B: classifyFailure (permanent/transient/unknown patterns); decideRetry
 *    (permanent → never; unknown → max 1; transient → budget with
 *    exponential backoff 400ms→5s + jitter); sleep(0) immediate
 * Core wiring statics: trust gate emits verification entries;
 *    handleStepFailure uses decideRetry + backoff.
 * Regression: agent/ remains free of forbidden imports.
 *
 * Run: npx tsx tests/knowledge/test-p14.ts
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

const { trustLevelForTool, assessTrust, corroborate, classifyFailure, decideRetry, sleep } = await import('../../src/main/agent/trust-retry');

console.log('\nA) trust levels:');
assert('npm_test = deterministic', trustLevelForTool('npm_test') === 'deterministic');
assert('run_command = deterministic', trustLevelForTool('run_command') === 'deterministic');
assert('propose_changes = model-generated', trustLevelForTool('propose_changes') === 'model-generated');
assert('knowledge_search = model-generated', trustLevelForTool('knowledge_search') === 'model-generated');
assert('read_files = normal', trustLevelForTool('read_files') === 'normal');
assert('unknown tool = normal', trustLevelForTool('mystery') === 'normal');

const tDet = assessTrust('npm_test', { success: true, data: {} });
assert('deterministic success needs NO corroboration', tDet.requiresCorroboration === false);
const tModel = assessTrust('propose_changes', { success: true, data: {} });
assert('model-generated SUCCESS needs corroboration', tModel.requiresCorroboration === true);
const tModelFail = assessTrust('propose_changes', { success: false, data: {} });
assert('model-generated FAILURE does not', tModelFail.requiresCorroboration === false);

// corroboration evidence paths
const cNone = corroborate({ success: true, modifiedFiles: undefined, data: {} }, tModel);
assert('no evidence → NOT corroborated', cNone.corroborated === false && cNone.evidence.length === 0);
const cFiles = corroborate({ success: true, modifiedFiles: [{ path: 'a.ts', after: 'x' }] as any, data: {} }, tModel);
assert('modifiedFiles evidence works', cFiles.corroborated === true && /file change/.test(cFiles.evidence[0]));
const cData = corroborate({ success: true, modifiedFiles: undefined, data: { okCount: 3 } }, tModel);
assert('okCount evidence works', cData.corroborated === true);
const cSearch = corroborate({ success: true, modifiedFiles: undefined, data: { resultCount: 5 } }, assessTrust('knowledge_search', { success: true, data: {} }));
assert('resultCount evidence works', cSearch.corroborated === true);
const cDet = corroborate({ success: true, modifiedFiles: undefined, data: {} }, tDet);
assert('non-required corroboration trivially true', cDet.corroborated === true);

console.log('\nB) retry policy:');
assert('permission denied = permanent', classifyFailure('Permission denied for tool') === 'permanent');
assert('blocked by security = permanent', classifyFailure('Blocked: path outside allowed roots') === 'permanent');
assert('unsupported format = permanent', classifyFailure('Unsupported format: pdf') === 'permanent');
assert('validation failed = permanent', classifyFailure('parameter validation failed: path required') === 'permanent');
assert('timeout = transient', classifyFailure('Tool timed out after 30s') === 'transient');
assert('EBUSY = transient', classifyFailure('write EBUSY on resource') === 'transient');
assert('weird error = unknown', classifyFailure('something odd happened') === 'unknown');

const dPerm = decideRetry({ errorMessage: 'Permission denied', attempt: 0, maxRetries: 3 });
assert('permanent → NO retry ever', dPerm.shouldRetry === false && dPerm.classification === 'permanent');
const dTrans = decideRetry({ errorMessage: 'timed out', attempt: 0, maxRetries: 3 });
assert('transient within budget → retry w/ backoff', dTrans.shouldRetry === true && dTrans.backoffMs >= 400 && dTrans.backoffMs <= 620);
const dTrans2 = decideRetry({ errorMessage: 'timed out', attempt: 2, maxRetries: 3 });
assert('transient backoff grows (≈1600+jitter)', dTrans2.backoffMs >= 1600 && dTrans2.backoffMs <= 1820, String(dTrans2.backoffMs));
const dTransCap = decideRetry({ errorMessage: 'timed out', attempt: 5, maxRetries: 10 });
assert('backoff capped at 5s+jitter', dTransCap.backoffMs <= 5120 && dTransCap.backoffMs >= 5000);
const dUnknown0 = decideRetry({ errorMessage: 'strange failure', attempt: 0, maxRetries: 3 });
assert('unknown → exactly one retry allowed', dUnknown0.shouldRetry === true);
const dUnknown1 = decideRetry({ errorMessage: 'strange failure', attempt: 1, maxRetries: 3 });
assert('unknown second failure → stop', dUnknown1.shouldRetry === false && /exhausted/.test(dUnknown1.reason));
const dBudget = decideRetry({ errorMessage: 'timed out', attempt: 3, maxRetries: 3 });
assert('budget exhausted → stop', dBudget.shouldRetry === false);
await sleep(0); // immediate — no hang
assert('sleep(0) resolves instantly', true);

console.log('\ncore wiring statics:');
const coreSrc = fs.readFileSync(path.join(__dirname, '../../src/main/agent/core.ts'), 'utf-8');
assert('core: trust gate on successful tool calls', /assessTrust\(step\.toolName/.test(coreSrc) && /corroborate\(result/.test(coreSrc));
assert('core: verification entries recorded via trust-gate', /'trust-gate'/.test(coreSrc) && /task\.verification\.push/.test(coreSrc));
assert('core: unverified claim surfaces as observation', /Unverified claim/.test(coreSrc));
assert('core: handleStepFailure uses decideRetry', /decideRetry\(\{ errorMessage/.test(coreSrc));
assert('core: backoff applied (await sleep)', /await sleep\(decision\.backoffMs\)/.test(coreSrc));
assert('core: retry event carries classification', /classification: decision\.classification/.test(coreSrc));
assert('agent/ still clean (no glm/knowledge-service imports)', !/from ['"]\.\.\/knowledge\/knowledge-service|from ['"].*ai\/glm/.test(coreSrc));

console.log('\n══════════════════════════════════════');
console.log(`P14 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P14 TRUST + RETRY: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
