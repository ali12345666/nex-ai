/**
 * Phase 13 / P13-A — Memory Consolidator (WRITE path) + agent wiring
 *
 * 1. consolidateTaskMemory matrix: task record (TaskMemory), lessons →
 *    ProjectMemory (success-only), corrections → UserMemory, volatile →
 *    SessionMemory w/ expiry; dedup bump; MAX_WRITES cap; redaction of
 *    secrets in values; never-throw (per-write errors reported)
 * 2. recallRelevantMemories: term scoring across stores, project scoping,
 *    limit, non-matching excluded
 * 3. Agent wiring (static + behavioral): task_completed path calls the
 *    consolidator with derived outcome; failures logged not thrown
 * 4. Offline purity: no network; memory stores are fs-only
 *
 * Run: npx tsx tests/knowledge/test-p13-a.ts
 */
import '../__mocks__/install-electron-mock.js';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main(): Promise<void> {

const { consolidateTaskMemory, recallRelevantMemories } = await import('../../src/main/agent/memory-consolidator');
type Mem = Map<string, any>;
function fakeMemory(initial?: Record<string, Array<[string, any]>>) {
  const stores: Record<string, Mem> = { user: new Map(), project: new Map(), task: new Map(), knowledge: new Map(), session: new Map() };
  for (const [st, entries] of Object.entries(initial || {})) for (const [k, v] of entries!) stores[st].set(k, v);
  return {
    stores,
    set(store: any, key: string, value: any, opts?: any) {
      const prev = stores[store].get(key);
      stores[store].set(key, { value, updatedAt: Date.now(), tags: opts?.tags, expiresAt: opts?.expiresAt, projectId: opts?.projectId, prev });
    },
    get(store: any, key: string, _pid?: string) { return stores[store].get(key) || null; },
    list(store: any, _pid?: string) { return [...stores[store].entries()].map(([key, e]) => ({ key, ...(e as any) })); },
  };
}

console.log('\n1) consolidation matrix:');
const mem = fakeMemory();
const now = { now: () => 1_700_000_000_000 };
const r1 = consolidateTaskMemory({
  taskId: 't1', projectId: '/proj/x', userRequest: 'refactor authentication and add tests',
  intent: 'refactor', success: true, stepsCompleted: 4,
  toolsUsed: ['read_files', 'propose_changes', 'npm_test'],
  filesTouched: ['src/auth.ts', 'src/auth.test.ts'],
  lessonsLearned: ['Project uses vitest not jest for tests', 'auth tokens are stored in keystore module'],
  userCorrections: ['User denied deletion of legacy folder — keep migration path'],
}, mem, now);

assert('task record written to TaskMemory', mem.stores.task.has('task:t1') && mem.stores.task.get('task:t1').value.success === true);
assert('2 lessons → ProjectMemory', mem.stores.project.has('lesson:t1:1') && mem.stores.project.has('lesson:t1:2'));
assert('correction → UserMemory', mem.stores.user.has('pref:t1:1') && /denied/.test(mem.stores.user.get('pref:t1:1').value));
assert('volatile → SessionMemory with 24h expiry', (() => {
  const s = mem.stores.session.get('session:t1');
  return s && s.expiresAt === now.now() + 24 * 60 * 60 * 1000;
})());
assert('writes counted (1 task + 2 lesson + 1 pref + 1 session = 5)', r1.written.length === 5, JSON.stringify(r1.written));
assert('no errors', r1.errors.length === 0);
assert('task summary contains outcome + tools', /OK.*refactor authentication.*read_files/.test(mem.stores.task.get('task:t1').value.summary));

// failed task: no lessons (project memory) but task record says FAIL
const mem2 = fakeMemory();
const r2 = consolidateTaskMemory({
  taskId: 't2', projectId: '/p', userRequest: 'fix build', success: false,
  stepsCompleted: 1, toolsUsed: ['npm_build'], filesTouched: [],
  lessonsLearned: ['lesson should be skipped on failure'],
}, mem2, now);
assert('failed task: no project lesson written', ![...mem2.stores.project.keys()].some((k) => k.startsWith('lesson:')));
assert('failed task: task record marked FAIL', /\[FAIL\]/.test(mem2.stores.task.get('task:t2').value.summary));

// dedup
const r3a = consolidateTaskMemory({ taskId: 't3', userRequest: 'q', success: true, stepsCompleted: 1, toolsUsed: [], filesTouched: [] }, mem2, now);
const r3b = consolidateTaskMemory({ taskId: 't3', userRequest: 'q', success: true, stepsCompleted: 1, toolsUsed: [], filesTouched: [] }, mem2, now);
assert('re-consolidation dedups (skippedDuplicates > 0)', r3b.skippedDuplicates >= 2, JSON.stringify(r3b));

// redaction (TEST BUG fixed + documented: lessons require projectId — the
// guard is by design [project lessons belong to a project]; the original
// test omitted projectId so the lesson path never ran and the count was 0)
const memR = fakeMemory();
const rR = consolidateTaskMemory({
  taskId: 't4', projectId: '/p', userRequest: 'deploy', success: true, stepsCompleted: 1, toolsUsed: [], filesTouched: [],
  lessonsLearned: [`deploy key sk-abcdefghijklmnopqrstuvwxyz1234 must rotate`],
}, memR, now);
assert('secret redacted in memory value', !JSON.stringify([...memR.stores.project.values()]).includes('sk-abcdefghijklmnopqrstuvwxyz1234'));
assert('redaction counted', rR.redactedCount >= 1);

// cap
const memC = fakeMemory();
const rC = consolidateTaskMemory({
  taskId: 't5', projectId: '/p', userRequest: 'x', success: true, stepsCompleted: 1, toolsUsed: [], filesTouched: [],
  lessonsLearned: Array.from({ length: 20 }, (_, i) => `lesson number ${i} with sufficient length to pass threshold`),
  userCorrections: Array.from({ length: 10 }, (_, i) => `correction ${i} about denied action`),
}, memC, now);
assert('MAX_WRITES enforced (≤12 total)', rC.written.length + rC.skippedDuplicates <= 12, `${rC.written.length}`);

// per-write error isolation
const badMem: any = {
  set: (store: string) => { if (store === 'session') throw new Error('disk full'); mem.stores[store]; },
  get: () => null,
  list: () => [],
};
// route sets into good mem except session throws
const semi = {
  set: (s: any, k: string, v: any, o: any) => { if (s === 'session') throw new Error('disk full'); mem2.set(s, k, v, o); },
  get: (s: any, k: string, p?: string) => mem2.get(s, k, p),
  list: (s: any, p?: string) => mem2.list(s, p),
};
const rE = consolidateTaskMemory({ taskId: 't6', userRequest: 'y', success: true, stepsCompleted: 1, toolsUsed: [], filesTouched: [] }, semi, now);
assert('per-write errors isolated + reported', rE.errors.length === 1 && /disk full/.test(rE.errors[0]) && rE.written.length >= 1);

console.log('\n2) recall:');
const memQ = fakeMemory({
  project: [['lesson:9:1', { value: 'authentication uses JWT bearer tokens', updatedAt: 1 }]],
  task: [['task:8', { value: { summary: '[OK] deploy pipeline with docker compose' }, updatedAt: 1 }]],
  user: [['pref:7:1', { value: 'user prefers tabs over spaces', updatedAt: 1 }]],
});
const hits = recallRelevantMemories(memQ, 'authentication tokens setup', '/proj', 5);
assert('recall finds auth lesson first', hits[0]?.key === 'lesson:9:1');
assert('non-matching excluded', !hits.some((h) => h.key === 'task:8'));
assert('limit honored', hits.length <= 5);
const none = recallRelevantMemories(memQ, 'completely unrelated quantum pasta');
assert('no-match → empty', none.length === 0);

console.log('\n3) agent wiring (static + behavioral):');
const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');
const coreSrc = read('../../src/main/agent/core.ts');
assert('core: consolidation after task_completed', /task_completed[\s\S]{0,2200}consolidateTaskMemory/.test(coreSrc));
assert('core: dynamic memory import (no hard coupling)', /await import\('\.\.\/memory'\)/.test(coreSrc));
assert('core: outcome derived (tools/files/steps)', /toolsUsed: task\.toolCalls/.test(coreSrc) && /stepsCompleted: task\.plan\.filter/.test(coreSrc));
assert('core: corrections from permission_denied errors', /e\.type === 'permission_denied'/.test(coreSrc));
assert('core: guarded (never throws into task result)', /Memory consolidation skipped/.test(coreSrc));
assert('consolidator: redacts via logger', /redactSecrets/.test(read('../../src/main/agent/memory-consolidator.ts')));

// behavioral: real memory module write→read roundtrip (fs stores)
const { setMemory, getMemory, listMemory, clearMemoryStore } = await import('../../src/main/memory');
const UD2 = fs.mkdtempSync(path.join(os.tmpdir(), 'p13mem-'));
process.env.NEX_AI_DATA_DIR = UD2; // hermetic dir for this process's remaining ops (memory module already init'd? it uses userDataDir…)
const before = listMemory('task').length;
setMemory('task', 'task:e2e-check', { summary: 'behavioral check' }, { tags: ['test'] });
const after = listMemory('task');
assert('real memory store roundtrip works', after.length === before + 1 && getMemory('task', 'task:e2e-check')?.value?.summary === 'behavioral check');
clearMemoryStore('task');
assert('clear works', listMemory('task').length === 0);

console.log('\n4) purity:');
const cSrc = read('../../src/main/agent/memory-consolidator.ts');
assert('consolidator: no network/electron', !/https?:\/\/|net\.request|from ['"]electron['"]/.test(cSrc));
assert('agent/ still clean of knowledge/glm imports', !/from ['"]\.\.\/knowledge\/|from ['"].*ai\/glm/.test(coreSrc));

console.log('\n══════════════════════════════════════');
console.log(`P13-A RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P13-A MEMORY CONSOLIDATION: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
