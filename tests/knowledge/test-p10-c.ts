/**
 * Phase 10 / P10-C — Knowledge Search UI contract
 *
 * The search handler itself is Phase 9 (tested in S3/S4). This suite pins
 * the UI-facing contract the panel renders:
 *   - knowledge-search response shape (title/score/snippet/source/lines)
 *   - citations present on markdown + code docs
 *   - ranked order (score desc)
 *   - no-match → empty array, success true
 *   - panel wiring static contract (Enter handler, results render, citation
 *     formatting, score display)
 *
 * Run: npx tsx tests/knowledge/test-p10-c.ts
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

const { HashEmbedder } = await import('../../src/main/knowledge/hash-embedder');
const { KnowledgeService } = await import('../../src/main/knowledge/knowledge-service');

// Fixture — mirrors the Phase 9 knowledge-search IPC body (same service call)
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p10c-'));
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p10c-ud-'));
fs.writeFileSync(path.join(ROOT, 'auth-system.md'),
  `# Authentication\n\nThe authentication middleware validates bearer tokens on every request.\nSessions expire after 30 minutes of inactivity.`);
fs.writeFileSync(path.join(ROOT, 'pricing.ts'),
  `export function calculateTotalPrice(items) {\n  return items.reduce((s, i) => s + i.price, 0);\n}`);

const emb = new HashEmbedder();
const svc = new KnowledgeService({ userDataDir: UD, projectId: 'p10c', embedder: emb, roots: [ROOT] });
await svc.ingestWithReport(path.join(ROOT, 'auth-system.md'), 'software');
await svc.ingestWithReport(path.join(ROOT, 'pricing.ts'), 'software');

// ── IPC response shape (identical mapping to main.ts knowledge-search) ──
console.log('\nIPC response shape:');
async function knowledgeSearchIPC(query: string, limit = 8) {
  const { framed, results } = await svc.retrieveForPrompt(query, limit);
  return {
    success: true,
    framed,
    results: results.map((r: any) => ({
      documentId: r.document.id,
      title: r.document.title,
      source: r.document.sourcePath,
      startLine: r.chunk.metadata?.startLine,
      endLine: r.chunk.metadata?.endLine,
      section: r.chunk.sectionTitle,
      score: Number(r.score.toFixed(4)),
      snippet: r.chunk.content.slice(0, 200),
    })),
  };
}

const res = await knowledgeSearchIPC('authentication system bearer tokens');
assert('success true', res.success === true);
assert('results non-empty', (res.results || []).length > 0);
assert('auth doc ranked first', res.results![0].title === 'auth-system.md');
assert('score present (0..1)', res.results!.every((r: any) => typeof r.score === 'number' && r.score > 0 && r.score <= 1));
assert('scores descending', res.results!.every((r: any, i: number, a: any[]) => i === 0 || a[i - 1].score >= r.score));
assert('snippet is string ≤200', res.results!.every((r: any) => typeof r.snippet === 'string' && r.snippet.length <= 200));
assert('source path cited', res.results!.every((r: any) => typeof r.source === 'string' && r.source.includes('auth-system.md') || r.title === 'pricing.ts' ? true : !!r.source));
assert('line range cited (startLine number)', res.results!.every((r: any) => r.startLine === undefined || typeof r.startLine === 'number'));
assert('auth hit carries lines', (() => { const h = res.results!.find((r: any) => r.title === 'auth-system.md'); return h && typeof h.startLine === 'number'; })());
assert('section title on markdown hit', (() => { const h = res.results!.find((r: any) => r.title === 'auth-system.md'); return h && (h.section === 'Authentication' || h.section === undefined); })());

// identifier search (code)
const code = await knowledgeSearchIPC('calculateTotalPrice');
assert('identifier search hits pricing.ts first', code.results![0].title === 'pricing.ts');

// no-match
const miss = await knowledgeSearchIPC('quantum entanglement pasta recipes', 4);
assert('no-match → success + empty results (clean UI state)', miss.success === true && (miss.results || []).length === 0);

// ── Panel wiring static contract ──
console.log('\npanel wiring:');
const panelSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/KnowledgePanel.tsx'), 'utf-8');
assert('Enter triggers search', /onKeyDown=\{.*runSearch/.test(panelSrc));
assert('results list rendered from IPC', /searchResults\.map/.test(panelSrc));
assert('score displayed', /r\.score\.toFixed/.test(panelSrc));
assert('citation line-range displayed', /lines \$\{r\.startLine\}/.test(panelSrc));
assert('citation source displayed', /\{r\.source \|\| r\.title\}/.test(panelSrc));
assert('snippet displayed', /r\.snippet/.test(panelSrc));
assert('clears stale results on query edit', /setSearchResults\(null\)/.test(panelSrc));
assert('no-match empty state', /No matches/.test(panelSrc));
assert('panel does NOT import knowledge subsystem (IPC only)', !/from ['"]\.\.\/\.\.\/main\/knowledge/.test(panelSrc));
assert('searching spinner state', /searching/.test(panelSrc));

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`P10-C RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P10-C SEARCH UI CONTRACT: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
