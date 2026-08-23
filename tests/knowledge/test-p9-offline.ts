/**
 * Phase 9 / P9-J — OFFLINE / NETWORK AUDIT (the serious one — Section M)
 *
 * Blocks and MONITORS every outbound path BEFORE loading any knowledge
 * module, then executes the FULL required pipeline:
 *
 *   1. document ingest        4. indexing (vector store persist)
 *   2. chunk                  5. retrieval (hybrid)
 *   3. embedding (local)      6. agent query (createTask via KnowledgePort)
 *
 * PASS criteria: ZERO network attempts across all six stages. Explicitly
 * asserts none of the forbidden intelligence endpoints appear anywhere in
 * the knowledge subsystem sources: OpenAI / Anthropic / Gemini / GLM API /
 * api.nexai.app.
 *
 * Additional static audits:
 *   - knowledge/ has ZERO imports of net/http/https/fetch/axios/electron
 *   - agent/ still has ZERO knowledge/ imports (regression)
 *   - package.json gained NO new dependencies in Phase 9
 *
 * Run: npx tsx tests/knowledge/test-p9-offline.ts
 */
import '../__mocks__/install-electron-mock.js';

// ── BLOCK + MONITOR all network before ANY knowledge module loads ──────────
import * as netMod from 'net';
import * as httpMod from 'http';
import * as httpsMod from 'https';
import * as dnsMod from 'dns';
import * as tlsMod from 'tls';

const attempts: string[] = [];
function poison(mod: any, name: string): void {
  if (typeof mod.request === 'function') {
    mod.request = (..._a: any[]) => { attempts.push(`${name}.request`); throw new Error(`BLOCKED ${name}.request`); };
  }
  if (typeof mod.get === 'function') {
    mod.get = (..._a: any[]) => { attempts.push(`${name}.get`); throw new Error(`BLOCKED ${name}.get`); };
  }
  if (typeof mod.connect === 'function') {
    mod.connect = (..._a: any[]) => { attempts.push(`${name}.connect`); throw new Error(`BLOCKED ${name}.connect`); };
  }
}
poison(netMod, 'net'); poison(httpMod, 'http'); poison(httpsMod, 'https'); poison(dnsMod, 'dns'); poison(tlsMod, 'tls');
const origFetch = (globalThis as any).fetch;
(globalThis as any).fetch = (..._a: any[]) => { attempts.push('fetch'); throw new Error('BLOCKED fetch'); };
if ((globalThis as any).WebSocket) {
  const OrigWS = (globalThis as any).WebSocket;
  (globalThis as any).WebSocket = class { constructor(..._a: any[]) { attempts.push('WebSocket'); throw new Error('BLOCKED WebSocket'); } } as any;
  void OrigWS;
}

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

const FORBIDDEN_ENDPOINTS = [
  'api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com',
  'api.z.ai', 'open.bigmodel.cn', 'api.nexai.app',
];

// ─── Stage fixtures ─────────────────────────────────────────────────────────
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p9off-'));
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p9off-ud-'));
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'runbook.md'),
  `# Incident Runbook\n\nWhen the database primary fails, promote the replica with dbctl promote.\nPage the on-call engineer if replication lag exceeds 60 seconds.`);
fs.writeFileSync(path.join(ROOT, 'docs', 'cache.ts'),
  `export function cacheKey(scope: string, id: string): string {\n  return scope + ':' + id;\n}`);

console.log('\nOFFLINE PIPELINE (network blocked+monitored):');
console.log('  stage 1+2+3+4: ingest → chunk → embed → index');
const { HashEmbedder } = await import('../../src/main/knowledge/hash-embedder');
const { KnowledgeService } = await import('../../src/main/knowledge/knowledge-service');
const { projectIdFromPath } = await import('../../src/main/knowledge/project-id');
const core = await import('../../src/main/agent/core');

const emb = new HashEmbedder();
const pid = projectIdFromPath(ROOT);
const svc = new KnowledgeService({ userDataDir: UD, projectId: pid, embedder: emb, roots: [ROOT] });

const r1 = await svc.ingestWithReport(path.join(ROOT, 'docs', 'runbook.md'), 'software');
const r2 = await svc.ingestWithReport(path.join(ROOT, 'docs', 'cache.ts'), 'software');
assert('stage 1-4: runbook indexed', r1.status === 'indexed');
assert('stage 1-4: code indexed', r2.status === 'indexed');
assert('zero network attempts after ingest/chunk/embed/index', attempts.length === 0, attempts.join(','));

console.log('  stage 5: retrieval');
const { framed, results } = await svc.retrieveForPrompt('database primary fails what do I do', 3);
assert('stage 5: retrieval returns cited results', results.length > 0 && framed.includes('runbook.md'));
assert('zero network attempts after retrieval', attempts.length === 0, attempts.join(','));

console.log('  stage 6: agent query (KnowledgePort → createTask)');
// FULLY-LOCAL posture: register a local GGUF model (dummy file — createTask
// only validates availability; runTask is never called so no llama load).
const modelFile = path.join(ROOT, 'local-model.gguf');
fs.writeFileSync(modelFile, 'dummy-gguf-not-loaded');
const { addModel } = await import('../../src/main/ai/model-registry');
addModel(modelFile, { name: 'Offline Test Model' });
const events: any[] = [];
const unsub = core.onAgentEvent((e) => events.push(e));
const task = await core.createTask({
  userRequest: 'How do I handle a database primary failure and cache invalidation?',
  intent: 'chat',
  projectPath: ROOT,
  knowledgeLimit: 3,
  onlineEnvironment: { available: false }, // fully local posture
  knowledgePort: {
    available: () => true,
    retrieve: async (query: string, _pp?: string, limit?: number) => {
      const { results } = await svc.retrieveForPrompt(query, limit);
      return results.map((r: any) => ({
        documentId: r.document.id, documentTitle: r.document.title, chunkId: r.chunk.id,
        content: r.chunk.content, score: r.score, source: r.document.sourcePath,
        startLine: r.chunk.metadata?.startLine, endLine: r.chunk.metadata?.endLine,
      }));
    },
  },
});
assert('stage 6: task created with knowledge (LOCAL backend)', task.context.relevantKnowledge.length > 0 && task.backend === 'local');
assert('stage 6: knowledge cites sources', task.context.relevantKnowledge.every((k) => !!k.source));
assert('knowledge event logged', events.some((e) => e.type === 'log' && /Knowledge:/.test(e.message)));
core.deleteTask(task.id);
unsub();
assert('zero network attempts after agent query', attempts.length === 0, attempts.join(','));

// ─── Static source audit: no forbidden endpoints anywhere in knowledge/ ────
console.log('\nstatic endpoint audit:');
const kdir = path.join(__dirname, '../../src/main/knowledge');
const kfiles = fs.readdirSync(kdir).filter((f) => f.endsWith('.ts'));
let endpointViolation = '';
for (const f of kfiles) {
  const src = fs.readFileSync(path.join(kdir, f), 'utf-8');
  for (const ep of FORBIDDEN_ENDPOINTS) {
    // allow mentions ONLY inside comments explaining they are forbidden
    const noComments = src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    if (noComments.includes(ep)) { endpointViolation = `${f}:${ep}`; break; }
  }
  if (endpointViolation) break;
}
assert('knowledge/ sources contain ZERO forbidden endpoints', endpointViolation === '', endpointViolation);
assert('all forbidden endpoints explicitly listed for the audit', FORBIDDEN_ENDPOINTS.length === 6);

// knowledge/ has no network/electron machinery at all
let netImportViolation = '';
for (const f of kfiles) {
  const src = fs.readFileSync(path.join(kdir, f), 'utf-8');
  if (/from ['"](net|http|https|dns|tls|electron|axios|node-fetch|undici)['"]/.test(src)) {
    netImportViolation = f; break;
  }
}
assert('knowledge/ imports ZERO network/electron modules', netImportViolation === '', netImportViolation);

// agent/ still clean of knowledge imports
const agentDir = path.join(__dirname, '../../src/main/agent');
let agentViolation = '';
for (const f of fs.readdirSync(agentDir)) {
  if (!f.endsWith('.ts')) continue;
  if (/from ['"]\.\.\/knowledge\//.test(fs.readFileSync(path.join(agentDir, f), 'utf-8'))) { agentViolation = f; break; }
}
assert('agent/ still has ZERO knowledge/ imports', agentViolation === '', agentViolation);

// dependency allowlist — updated in Phase 11 / P11-C with documented cause:
// 'mammoth' added for local DOCX text extraction (BSD-2-Clause, pure JS,
// zero native deps, no install scripts — evaluation in the Phase 11 report;
// decision pinned by tests/knowledge/test-p11-c.ts). Phase 9's INTENT
// (no accidental/silent deps) is preserved: the list is still EXACT.
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));
const expectedDeps = ['@monaco-editor/react', 'chokidar', 'glob', 'lucide-react', 'mammoth', 'node-llama-cpp', 'react', 'react-dom', 'xterm', 'xterm-addon-fit', 'xterm-addon-web-links', 'zustand'];
assert('package.json deps EXACT allowlist (no silent additions)', JSON.stringify(Object.keys(pkg.dependencies).sort()) === JSON.stringify(expectedDeps.sort()), JSON.stringify(Object.keys(pkg.dependencies)));

// main.ts wiring uses dynamic imports only (no static coupling)
const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main/main.ts'), 'utf-8');
const dynamicKnowledge = (mainSrc.match(/await import\('\.\/knowledge\//g) || []).length;
const staticKnowledge = /import .* from '\.\/knowledge\//.test(mainSrc);
assert('main.ts wires knowledge via DYNAMIC imports only', dynamicKnowledge >= 3 && staticKnowledge === false);

// ─── Final tally ────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`TOTAL NETWORK ATTEMPTS: ${attempts.length} ${attempts.length === 0 ? '✅' : '❌ ' + attempts.join(',')}`);
console.log(`P9-OFFLINE RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0 || attempts.length > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('OFFLINE GUARANTEE VERIFIED: full pipeline, 0 external AI requests ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
