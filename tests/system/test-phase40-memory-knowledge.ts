/**
 * Phase 40 — Memory + Knowledge System Architecture Upgrade Tests
 *
 * Verifies the new memory intelligence system:
 *   1. SemanticMemoryStore (embedding + importance + access tracking)
 *   2. MemoryRetrievalEngine (hybrid: semantic + keyword + importance + recency)
 *   3. VectorStore interface abstraction
 *   4. PDF parser support
 *   5. Agent integration (memory retrieval before planning)
 *   6. Automatic memory creation (lessonsLearned extraction)
 *   7. context-manager relevantMemories wiring
 *
 * Run: npx tsx tests/system/test-phase40-memory-knowledge.ts
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
  const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) SemanticMemoryStore module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) SemanticMemoryStore:');
  const smsSrc = read('../../src/main/memory/semantic-memory-store.ts');

  assert('semantic-memory-store.ts exists', smsSrc.length > 0);
  assert('SemanticMemoryType includes session', smsSrc.includes("| 'session'"));
  assert('SemanticMemoryItem interface', smsSrc.includes('interface SemanticMemoryItem'));
  assert('SemanticMemoryItem has embedding field', smsSrc.includes('embedding: number[] | null'));
  assert('SemanticMemoryItem has importance field', smsSrc.includes('importance: number'));
  assert('SemanticMemoryItem has lastAccess field', smsSrc.includes('lastAccess: number'));
  assert('SemanticMemoryItem has accessCount field', smsSrc.includes('accessCount: number'));
  assert('SemanticSearchResult interface', smsSrc.includes('interface SemanticSearchResult'));
  assert('SemanticMemoryStore class exported', smsSrc.includes('export class SemanticMemoryStore'));
  assert('upsert method', smsSrc.includes('async upsert('));
  assert('search method', smsSrc.includes('async search('));
  assert('touch method (access tracking)', smsSrc.includes('touch('));
  assert('flush method (persistence)', smsSrc.includes('flush(): void'));
  assert('uses cosineSimilarity', smsSrc.includes('cosineSimilarity'));
  assert('hybrid scoring (semantic + keyword + importance + recency)', smsSrc.includes('0.4 * semanticScore + 0.2 * keywordScore + 0.2 * importanceScore + 0.2 * recencyScore'));
  assert('recency decay (exponential)', smsSrc.includes('Math.exp(-ageDays / 7)'));
  assert('JSON persistence (INDEX_FILE)', smsSrc.includes('INDEX_FILE'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) MemoryRetrievalEngine module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) MemoryRetrievalEngine:');
  const mreSrc = read('../../src/main/memory/memory-retrieval-engine.ts');

  assert('memory-retrieval-engine.ts exists', mreSrc.length > 0);
  assert('MemoryRetrievalEngine class exported', mreSrc.includes('export class MemoryRetrievalEngine'));
  assert('retrieve method', mreSrc.includes('async retrieve('));
  assert('uses SemanticMemoryStore', mreSrc.includes('SemanticMemoryStore'));
  assert('keyword fallback (scans existing k-v store)', mreSrc.includes('listMemory'));
  assert('dedup by key', mreSrc.includes('dedup by key') || /results\.has\(key\)/.test(mreSrc));
  assert('getMemoryRetrievalEngine singleton getter', mreSrc.includes('export function getMemoryRetrievalEngine'));
  assert('setMemoryRetrievalEngine singleton setter', mreSrc.includes('export function setMemoryRetrievalEngine'));
  assert('RetrievedMemory interface', mreSrc.includes('interface RetrievedMemory'));
  assert('MemoryRetrievalResult interface', mreSrc.includes('interface MemoryRetrievalResult'));
  assert('usedSemantic flag', mreSrc.includes('usedSemantic'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) VectorStore interface abstraction
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) VectorStore interface:');
  const vsiSrc = read('../../src/main/knowledge/vector-store-interface.ts');

  assert('vector-store-interface.ts exists', vsiSrc.length > 0);
  assert('VectorStore interface exported', vsiSrc.includes('export interface VectorStore'));
  assert('add method', vsiSrc.includes('add(record: VectorRecord)'));
  assert('addBatch method', vsiSrc.includes('addBatch(records: VectorRecord[])'));
  assert('remove method', vsiSrc.includes('remove(id: string)'));
  assert('update method', vsiSrc.includes('update(id: string'));
  assert('search method', vsiSrc.includes('search('));
  assert('count method', vsiSrc.includes('count(): Promise<number>'));
  assert('flush method', vsiSrc.includes('flush(): Promise<void>'));
  assert('load method', vsiSrc.includes('load(): Promise<void>'));
  assert('clear method', vsiSrc.includes('clear(): Promise<void>'));
  assert('dispose method', vsiSrc.includes('dispose(): Promise<void>'));
  assert('InMemoryVectorStore reference impl', vsiSrc.includes('class InMemoryVectorStore'));
  assert('cosineSimilarity exported', vsiSrc.includes('export function cosineSimilarity'));
  assert('VectorRecord interface', vsiSrc.includes('interface VectorRecord'));
  assert('VectorSearchResult interface', vsiSrc.includes('interface VectorSearchResult'));
  assert('supports cosine metric', vsiSrc.includes("'cosine'"));
  assert('supports euclidean metric', vsiSrc.includes("'euclidean'"));
  assert('supports dot metric', vsiSrc.includes("'dot'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) PDF parser
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) PDF Parser:');
  const pdfSrc = read('../../src/main/knowledge/pdf-parser.ts');

  assert('pdf-parser.ts exists', pdfSrc.length > 0);
  assert('PdfParser class exported', pdfSrc.includes('export class PdfParser'));
  assert('implements DocumentParser', pdfSrc.includes('implements DocumentParser'));
  assert('canHandle pdf', pdfSrc.includes("return format === 'pdf'"));
  assert('extractPdfText function', pdfSrc.includes('function extractPdfText'));
  assert('BT/ET extraction', pdfSrc.includes('BT') && pdfSrc.includes('ET'));
  assert('Tj operator extraction', pdfSrc.includes('Tj'));
  assert('TJ array extraction', pdfSrc.includes('TJ'));
  assert('FlateDecode (zlib) fallback', pdfSrc.includes('zlib') || pdfSrc.includes('inflate'));
  assert('unescapePdfString function', pdfSrc.includes('function unescapePdfString'));
  assert('extractPdfMetadata function', pdfSrc.includes('function extractPdfMetadata'));
  assert('metadata fields (Title, Author)', pdfSrc.includes('Title') && pdfSrc.includes('Author'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) PDF parser registered in parsers.ts
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) PDF registered in parsers:');
  const parsersSrc = read('../../src/main/knowledge/parsers.ts');
  assert('PdfParser imported', parsersSrc.includes("import { PdfParser }"));
  assert('PdfParser in registry', parsersSrc.includes('new PdfParser()'));
  assert('isSupportedFormat allows pdf', !/format !== 'pdf'/.test(parsersSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Agent integration (memory retrieval before planning)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Agent integration:');
  const coreSrc = read('../../src/main/agent/core.ts');

  assert('core imports memory-retrieval-engine', /import.*memory-retrieval-engine/.test(coreSrc) || /getMemoryRetrievalEngine/.test(coreSrc));
  assert('core calls getMemoryRetrievalEngine', coreSrc.includes('getMemoryRetrievalEngine()'));
  assert('core retrieves memories before generatePlan', /getMemoryRetrievalEngine[\s\S]{0,1500}generatePlan/.test(coreSrc));
  assert('core passes relevantMemories to generatePlan', coreSrc.includes('relevantMemories,'));
  assert('memory retrieval is non-blocking (try/catch)', /try[\s\S]{0,200}getMemoryRetrievalEngine[\s\S]{0,1500}catch/.test(coreSrc));
  assert('memory retrieval emits log event', coreSrc.includes("type: 'log'"));
  assert('extractLessonsFromTask function exists', coreSrc.includes('function extractLessonsFromTask'));
  assert('lessonsLearned passed to consolidateTaskMemory', coreSrc.includes('lessonsLearned: extractLessonsFromTask'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) context-manager relevantMemories wiring
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Context manager wiring:');
  const cmSrc = read('../../src/main/agent/context-manager.ts');

  assert('BuildContextOptions has relevantMemories', cmSrc.includes('relevantMemories?:'));
  assert('context-manager uses relevantMemories if provided', cmSrc.includes('opts.relevantMemories'));
  assert('falls back to list() when no relevantMemories', /else[\s\S]{0,500}list\(\)/.test(cmSrc));
  assert('relevantMemories formatted as system message', /## Relevant Memories/.test(cmSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) planner.ts passes relevantMemories
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Planner wiring:');
  const plannerSrc = read('../../src/main/agent/planner.ts');

  assert('PlanRequest has relevantMemories', plannerSrc.includes('relevantMemories?:'));
  assert('planner passes relevantMemories to buildContext', plannerSrc.includes('relevantMemories: request.relevantMemories'));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) main.ts initialization (SemanticMemoryStore + MemoryRetrievalEngine)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) main.ts initialization:');
  const mainSrc = read('../../src/main/main.ts');

  assert('main imports SemanticMemoryStore', mainSrc.includes('SemanticMemoryStore'));
  assert('main imports MemoryRetrievalEngine', mainSrc.includes('MemoryRetrievalEngine'));
  assert('main calls setMemoryRetrievalEngine', mainSrc.includes('setMemoryRetrievalEngine'));
  assert('Phase 40 log message', mainSrc.includes('Phase 40'));

  // ═══════════════════════════════════════════════════════════════════════
  // 10) FUNCTIONAL TESTS — SemanticMemoryStore + MemoryRetrievalEngine
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) Functional tests:');

  // Create a temporary userData dir for testing
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase40-'));
  process.env.NEX_USER_DATA = tmpDir;

  // Import the modules
  const { HashEmbedder } = await import('../../src/main/knowledge/hash-embedder');
  const { SemanticMemoryStore } = await import('../../src/main/memory/semantic-memory-store');
  const { MemoryRetrievalEngine, setMemoryRetrievalEngine, getMemoryRetrievalEngine } =
    await import('../../src/main/memory/memory-retrieval-engine');

  // Create embedder + store
  const embedder = new HashEmbedder({ dimensions: 64 });
  const store = new SemanticMemoryStore(embedder, tmpDir);

  // Add some memories
  await store.upsert('user-pref-1', 'user', 'User prefers TypeScript over JavaScript', { importance: 0.9 });
  await store.upsert('project-arch-1', 'project', 'This project uses Next.js with Tailwind CSS', { importance: 0.8, projectId: 'test-project' });
  await store.upsert('task-lesson-1', 'task', 'Fixed authentication bug by updating JWT secret', { importance: 0.7 });
  await store.upsert('user-pref-2', 'user', 'User likes dark mode themes', { importance: 0.5 });

  assert('store has 4 items', store.list().length === 4);
  assert('store has embeddings', store.getStats().withEmbeddings === 4);

  // Search for "TypeScript preference"
  const results = await store.search('TypeScript user preference', { limit: 5 });
  assert('search returns results', results.length > 0);
  assert('top result is about TypeScript', results[0].item.content.includes('TypeScript'));
  assert('top result has semantic score > 0', results[0].semanticScore > 0);
  assert('top result has recency score > 0', results[0].recencyScore > 0);
  assert('search touches accessed items', store.get('user-pref-1')!.accessCount > 0);

  // Search for "authentication"
  const authResults = await store.search('authentication JWT bug fix', { limit: 3 });
  assert('auth search returns results', authResults.length > 0);
  assert('auth search finds the JWT memory', authResults.some((r) => r.item.content.includes('authentication')));

  // Create retrieval engine
  const engine = new MemoryRetrievalEngine(store, embedder);
  setMemoryRetrievalEngine(engine);
  assert('getMemoryRetrievalEngine returns engine', getMemoryRetrievalEngine() === engine);

  // Test retrieval
  const retrieval = await engine.retrieve({
    query: 'TypeScript preferences',
    limit: 5,
  });
  assert('retrieval returns memories', retrieval.memories.length > 0);
  assert('retrieval used semantic search', retrieval.usedSemantic === true);
  assert('retrieval scanned items', retrieval.totalScanned > 0);

  // Test flush + reload
  store.flush();
  const store2 = new SemanticMemoryStore(embedder, tmpDir);
  assert('store persists across reload', store2.list().length === 4);

  // Cleanup
  store.dispose();
  store2.dispose();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }

  // ═══════════════════════════════════════════════════════════════════════
  // 11) VectorStore functional test
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n11) VectorStore functional test:');
  const { InMemoryVectorStore, cosineSimilarity } =
    await import('../../src/main/knowledge/vector-store-interface');

  const vs = new InMemoryVectorStore({ dimension: 3 });
  await vs.add({ id: 'v1', embedding: [1, 0, 0], metadata: { label: 'x-axis' } });
  await vs.add({ id: 'v2', embedding: [0, 1, 0], metadata: { label: 'y-axis' } });
  await vs.add({ id: 'v3', embedding: [0.9, 0.1, 0], metadata: { label: 'near-x' } });

  assert('vector store count = 3', await vs.count() === 3);

  const searchResults = await vs.search([1, 0, 0], { limit: 2 });
  assert('search returns 2 results', searchResults.length === 2);
  assert('top result is v1 (exact match)', searchResults[0].record.id === 'v1');
  assert('top result score = 1.0', Math.abs(searchResults[0].score - 1.0) < 0.01);
  assert('second result is v3 (near-x)', searchResults[1].record.id === 'v3');

  await vs.remove('v1');
  assert('after remove count = 2', await vs.count() === 2);

  await vs.clear();
  assert('after clear count = 0', await vs.count() === 0);

  // cosineSimilarity test
  assert('cosineSimilarity identical = 1', Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 0.01);
  assert('cosineSimilarity orthogonal = 0', Math.abs(cosineSimilarity([1, 0], [0, 1]) - 0) < 0.01);

  // ═══════════════════════════════════════════════════════════════════════
  // 12) PDF parser functional test
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n12) PDF parser functional test:');
  const { PdfParser } = await import('../../src/main/knowledge/pdf-parser');
  const { isSupportedFormat } = await import('../../src/main/knowledge/parsers');

  assert('isSupportedFormat(pdf) = true', isSupportedFormat('pdf') === true);
  assert('isSupportedFormat(image) = false', isSupportedFormat('image') === false);
  assert('isSupportedFormat(office-doc) = false', isSupportedFormat('office-doc') === false);

  const pdfParser = new PdfParser();
  assert('PdfParser canHandle pdf', pdfParser.canHandle('pdf') === true);
  assert('PdfParser cannot handle docx', pdfParser.canHandle('docx') === false);

  // Create a minimal PDF file for testing (basic text)
  const tmpPdf = path.join(os.tmpdir(), `test-${Date.now()}.pdf`);
  // Minimal PDF with "BT (Hello World) Tj ET" text
  const minimalPdf = `%PDF-1.0
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 100 700 Td (Hello World from PDF) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000196 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
290
%%EOF`;
  fs.writeFileSync(tmpPdf, minimalPdf, 'latin1');

  const parsed = await pdfParser.parse(tmpPdf);
  assert('PDF parser extracts text', parsed.text.length > 0);
  assert('PDF parser finds Hello World', parsed.text.includes('Hello') || parsed.text.includes('World'));

  // Cleanup
  try { fs.unlinkSync(tmpPdf); } catch { /* */ }

  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 40 MEMORY+KNOWLEDGE RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('PHASE 40 MEMORY + KNOWLEDGE UPGRADE: ALL PASS ✅');
  console.log('\nNOTE: Windows runtime QA is NOT VERIFIED by this test.');
  console.log('      The user MUST verify on Windows:');
  console.log('      1. Memory retrieval works before planning');
  console.log('      2. PDF files can be imported into knowledge');
  console.log('      3. Semantic search finds relevant memories');
  console.log('      4. Lessons are saved to ProjectMemory after tasks');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
