/**
 * Phase 11 / P11-B — PDF decision guard
 *
 * Evaluation outcome (documented in the Phase 11 report): every PDF parsing
 * candidate fails at least one hard gate on THIS project's runtime
 * (Electron 28 / Node 18.18):
 *   - pdf-parse@2   → native @napi-rs/canvas dep            ❌ native/Windows
 *   - unpdf         → engines Node ≥22                      ❌ runtime mismatch
 *   - pdfjs-dist@6  → modern-Node requirement               ❌ runtime mismatch
 *   - pdfjs-dist@3  → works, but +34MB installer + frozen v3 ⚠️ needs approval
 *   - pdf2json      → engines ≥20.18 advisory, weak guarantee ⚠️ needs approval
 *
 * DECISION: PDF stays DETECTED-but-UNSUPPORTED until explicit approval.
 * This suite PINS that decision so it cannot silently change:
 *   - .pdf detected as 'pdf', isSupportedFormat false, getParser null
 *   - ingestion rejects with a clear reason
 *   - NO pdf package may appear in dependencies (guard against accidental add)
 *
 * Run: npx tsx tests/knowledge/test-p11-b.ts
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

const { detectFormat, getParser, isSupportedFormat } = await import('../../src/main/knowledge/parsers');
const { ingestFile } = await import('../../src/main/knowledge/ingester');

console.log('\nPDF decision (PENDING APPROVAL — pinned):');
assert('.pdf detected as pdf format', detectFormat('report.pdf') === 'pdf');
assert('pdf NOT in supported formats', isSupportedFormat('pdf') === false);
assert('no parser for pdf', getParser('pdf') === null);

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p11b-'));
const pdfPath = path.join(ROOT, 'doc.pdf');
fs.writeFileSync(pdfPath, '%PDF-1.4\nfake content');
const res = await ingestFile(pdfPath, { projectId: 'p11b', roots: [ROOT] });
assert('pdf ingestion → unsupported', res.status === 'unsupported' && /Unsupported format: pdf/.test((res as any).reason || ''));

// Guard: no pdf package may be silently added to dependencies
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));
const depNames = Object.keys(pkg.dependencies || {});
const pdfPkgs = depNames.filter((d) => /pdf/i.test(d));
assert('NO pdf package in dependencies (decision intact — flip this test ONLY with explicit approval)', pdfPkgs.length === 0, pdfPkgs.join(','));

console.log('\n══════════════════════════════════════');
console.log(`P11-B RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P11-B PDF DECISION GUARD: ALL PASS ✅ (pdf = pending approval)');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
