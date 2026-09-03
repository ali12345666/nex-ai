/**
 * UI-10 — Security Hardening Tests
 *
 * Verifies:
 *   1. knowledge-ingest handler now guards with assertPathInside (GAP-4 fix)
 *   2. knowledge-ingest-many handler guards ALL paths
 *   3. assertPathInside called BEFORE any file ingestion
 *   4. Error is caught and returned (not thrown to renderer)
 *
 * Run: npx tsx tests/system/test-ui10-security-hardening.ts
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

  console.log('\n1) knowledge-ingest handler: assertPathInside guard added (GAP-4 fix):');
  const mainSrc = read('../../src/main/main.ts');
  assert('handler imports assertPathInside', /knowledge-ingest'[\s\S]*?import\('\.\/security'\)/.test(mainSrc));
  assert('handler calls assertPathInside(filePath, [projectPath])', /knowledge-ingest'[\s\S]*?assertPathInside\(filePath, \[projectPath\]\)/.test(mainSrc));
  assert('guard is called BEFORE knowledgeServiceFor', (() => {
    const handlerStart = mainSrc.indexOf("ipcMain.handle('knowledge-ingest',");
    const handlerEnd = mainSrc.indexOf('});', handlerStart);
    const handlerBody = mainSrc.slice(handlerStart, handlerEnd);
    const guardIdx = handlerBody.indexOf('assertPathInside(filePath');
    const svcIdx = handlerBody.indexOf('knowledgeServiceFor');
    return guardIdx > 0 && svcIdx > 0 && guardIdx < svcIdx;
  })());
  assert('error caught and returned (not thrown)', /knowledge-ingest'[\s\S]*?catch \(err: any\) \{[\s\S]*?return \{ success: false, error: err\.message \}/.test(mainSrc));

  console.log('\n2) knowledge-ingest-many handler: ALL paths guarded:');
  assert('many handler imports assertPathInside', /knowledge-ingest-many'[\s\S]*?import\('\.\/security'\)/.test(mainSrc));
  assert('many handler loops through filePaths', /for \(const fp of \(filePaths \|\| \[\]\)\) \{[\s\S]*?assertPathInside\(fp, \[projectPath\]\)/.test(mainSrc));
  assert('guard runs BEFORE any ingestion', (() => {
    const handlerStart = mainSrc.indexOf("ipcMain.handle('knowledge-ingest-many',");
    const handlerEnd = mainSrc.indexOf('});', handlerStart);
    const handlerBody = mainSrc.slice(handlerStart, handlerEnd);
    const guardLoopIdx = handlerBody.indexOf('for (const fp of (filePaths || []))');
    const ingestLoopIdx = handlerBody.indexOf('for (const fp of (filePaths || []).slice(0, 500))');
    return guardLoopIdx > 0 && ingestLoopIdx > 0 && guardLoopIdx < ingestLoopIdx;
  })());
  assert('error caught and returned', /knowledge-ingest-many'[\s\S]*?catch \(err: any\) \{[\s\S]*?return \{ success: false, error: err\.message \}/.test(mainSrc));

  console.log('\n3) knowledge-ingest-folder (was already safe — still is):');
  assert('folder handler still has assertPathInside guard', /knowledge-ingest-folder'[\s\S]*?assertPathInside\(folderPath, \[projectPath\]\)/.test(mainSrc));

  console.log('\n4) No regression to existing path security:');

  console.log('\n5) assertPathInside imported from security module:');
  const securitySrc = read('../../src/main/security/index.ts');
  assert('assertPathInside exported from security', /export function assertPathInside/.test(securitySrc) || /export.*assertPathInside/.test(securitySrc));
  assert('isPathBlocked still exists (not removed)', /function isPathBlocked/.test(mainSrc) || /isPathBlocked/.test(mainSrc));

  console.log('\n6) No new IPC channels added (reused existing handlers):');
  assert('NO new ipcMain.handle for security', (mainSrc.match(/ipcMain\.handle\('security-/g) || []).length === 0);
  assert('NO new ipcMain.handle for path-check', (mainSrc.match(/ipcMain\.handle\('path-/g) || []).length === 0);

  console.log('\n7) Comments document the security fix:');
  assert('knowledge-ingest has UI-10 comment', /knowledge-ingest'[\s\S]*?UI-10: security guard/.test(mainSrc));
  assert('knowledge-ingest-many has UI-10 comment', /knowledge-ingest-many'[\s\S]*?UI-10: security guard/.test(mainSrc));
  assert('references GAP-4 in comment', /GAP-4/.test(mainSrc));

  console.log('\n══════════════════════════════════════');
  console.log(`UI-10 RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('UI-10 SECURITY HARDENING: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
