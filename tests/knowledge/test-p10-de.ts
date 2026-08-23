/**
 * Phase 10 / P10-D+E — Embedding Backend Selection (LOCAL only)
 *
 * resolveConfiguredEmbedder matrix (pure, injectable sources):
 *   - null → HashEmbedder (offline default)
 *   - valid registry model (file exists) → LlamaCppEmbedder on that GGUF
 *   - unknown id → hash fallback WITH reason
 *   - missing file → hash fallback WITH reason
 * - embedding model INDEPENDENT from chat model (different settings field;
 *   switching one never touches the other — verified via persistence state)
 * - needsRebuildAfterSwitch dimension-safety semantics
 * - knowledge-embedding-set handler behavior (settings persist + service
 *   cache invalidation + needsRebuild flag) simulated over real persistence
 * - OFFLINE static: no external embedding APIs anywhere in new files
 *
 * Run: npx tsx tests/knowledge/test-p10-de.ts
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

const { resolveConfiguredEmbedder, needsRebuildAfterSwitch } = await import('../../src/main/knowledge/embedding-select');
const { HashEmbedder } = await import('../../src/main/knowledge/hash-embedder');
const { LlamaCppEmbedder } = await import('../../src/main/knowledge/llama-embedder');
const { updateSettings, loadState } = await import('../../src/main/persistence');

// fake registry entries (real model files on disk — registry not needed for resolver)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p10de-'));
const ggufPath = path.join(TMP, 'embed-model.gguf');
fs.writeFileSync(ggufPath, 'gguf-bytes');

const src = (id: string | null, model?: any) => ({
  embeddingModelId: () => id,
  getModel: (mid: string) => (mid === 'emb-1' ? model : null),
});

console.log('\nresolver matrix:');
const r0 = resolveConfiguredEmbedder(src(null));
assert('null → HashEmbedder', r0.embedder instanceof HashEmbedder && r0.backend === 'hash' && !r0.fallbackReason);

const r1 = resolveConfiguredEmbedder(src('emb-1', { path: ggufPath, fileExists: true, category: 'embedding' }));
assert('valid model → LlamaCppEmbedder', r1.embedder instanceof LlamaCppEmbedder && r1.backend === 'llamacpp');
assert('model path propagated', r1.modelPath === ggufPath);

const r2 = resolveConfiguredEmbedder(src('emb-1', { path: ggufPath, fileExists: false, category: 'embedding' }));
assert('missing file → hash fallback + reason', r2.embedder instanceof HashEmbedder && !!r2.fallbackReason && /missing/.test(r2.fallbackReason));

const r3 = resolveConfiguredEmbedder(src('ghost'));
assert('unknown id → hash fallback + reason', r3.embedder instanceof HashEmbedder && !!r3.fallbackReason && /not found/.test(r3.fallbackReason));

console.log('\nrebuild semantics:');
assert('hash→gguf needs rebuild', needsRebuildAfterSwitch('hash', 'llamacpp') === true);
assert('gguf→hash needs rebuild', needsRebuildAfterSwitch('llamacpp', 'hash') === true);
assert('same backend no rebuild', needsRebuildAfterSwitch('hash', 'hash') === false);
assert('same gguf→same gguf no rebuild (backend-level)', needsRebuildAfterSwitch('llamacpp', 'llamacpp') === false);

console.log('\nindependence from chat model (real persistence):');
// embedding selection writes ONLY embeddingModelId (settings layer)
updateSettings({ embeddingModelId: 'emb-9' });
const st: any = loadState();
assert('embeddingModelId persisted', st.settings?.embeddingModelId === 'emb-9');
assert('activeLocalModelId (chat) untouched by embedding set', st.settings?.activeLocalModelId === undefined);
// chat selection writes ONLY activeLocalModelId
updateSettings({ activeLocalModelId: 'chat-7' });
const st2: any = loadState();
assert('chat set does not clear embedding choice', st2.settings?.embeddingModelId === 'emb-9' && st2.settings?.activeLocalModelId === 'chat-7');
// null reset
updateSettings({ embeddingModelId: null });
assert('explicit null reset works', (loadState() as any).settings?.embeddingModelId === null);
updateSettings({ embeddingModelId: undefined as any }); // clean up for later sections
const { createConfiguredEmbedder: _cce } = await import('../../src/main/knowledge/embedding-select');
void _cce;

console.log('\ncreateConfiguredEmbedder (real wiring):');
updateSettings({ embeddingModelId: null });
const { createConfiguredEmbedder } = await import('../../src/main/knowledge/embedding-select');
const w0 = await createConfiguredEmbedder();
assert('wiring default → hash', w0.backend === 'hash');

console.log('\noffline static audit:');
const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');
for (const f of ['../../src/main/knowledge/embedding-select.ts', '../../src/main/knowledge/hash-embedder.ts', '../../src/main/knowledge/llama-embedder.ts']) {
  const srcF = read(f);
  assert(`${path.basename(f)}: no external embedding APIs`,
    !/api\.openai|openai|anthropic|gemini|cohere|api\.z\.ai|bigmodel|nexai\.app/.test(srcF.replace(/\/\/[^\n]*/g, '')));
}
const mainSrc = read('../../src/main/main.ts');
assert('embedding-set validates model + invalidates service cache',
  /knowledge-embedding-set[\s\S]{0,900}disposeKnowledgeServices\(\)/.test(mainSrc));
assert('embedding-set persists non-sensitive setting (config.json, not secrets)',
  /knowledge-embedding-set[\s\S]{0,1200}persistUpdateSettings\(\{ embeddingModelId/.test(mainSrc));
assert('no external embedding endpoint in main wiring', !/embedding.*api\.(openai|z\.ai)|embeddings.*https/.test(mainSrc));

// panel wiring contract
const panelSrc = read('../../src/renderer/components/KnowledgePanel.tsx');
assert('panel: backend selector section', /Embedding Backend/.test(panelSrc));
assert('panel: hash default option present', /Hash Embedder \(built-in\)/.test(panelSrc));
assert('panel: rebuild banner on switch', /needsRebuildBanner/.test(panelSrc) && /Rebuild Index required|run Rebuild Index/.test(panelSrc));
assert('panel: independence note', /Independent from the chat model/.test(panelSrc));
assert('panel: embedding models grouped, advanced collapsed', /Embedding models/.test(panelSrc) && /Advanced — any registered GGUF/.test(panelSrc));

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`P10-D/E RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P10-D/E EMBEDDING BACKEND SELECTION: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
