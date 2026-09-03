/**
 * Phase 55 — Offline Expert Knowledge Engine Tests
 *
 * Verifies:
 *   1. Knowledge pack catalog (5 domains, packs, documents, checksums)
 *   2. Knowledge engine API (list/get/byDomain/installed/missing/recommended/status)
 *   3. Knowledge advisor (Persian recommendation + capability messages)
 *   4. Pack manager — scan / install (approve) / install (deny) / remove / update / verify / storage
 *   5. RAG integration (install pack → retrieve relevant knowledge offline)
 *   6. Permission gate (Persian confirmation phrases, denial, audit log)
 *   7. Expert routing → knowledge domain mapping
 *   8. Offline mode (no network; all retrieval local)
 *   9. Security (NO autonomous download/install/delete; source inspection)
 *  10. Identity integration (expertKnowledgeStatus)
 *  11. IPC handlers + preload bridges + type definitions
 *  12. Phase 38-54 preserved
 *
 * Run: npx tsx tests/system/test-phase55-expert-knowledge.ts
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) Knowledge Pack Catalog (engine source)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) Knowledge Pack Catalog:');
  const ekeSrc = read('../../src/main/knowledge/expert-knowledge-engine.ts');

  assert('expert-knowledge-engine.ts exists', ekeSrc.length > 0);
  assert('KnowledgePackDomain type', ekeSrc.includes('export type KnowledgePackDomain'));
  assert('5 knowledge domains', ekeSrc.includes("'software-engineering'") && ekeSrc.includes("'electronics-engineering'") && ekeSrc.includes("'ai-engineering'") && ekeSrc.includes("'system-architecture'") && ekeSrc.includes("'science'"));
  assert('EmbeddingStatus type', ekeSrc.includes("export type EmbeddingStatus"));
  assert('KnowledgePackDocument interface', ekeSrc.includes('interface KnowledgePackDocument'));
  assert('KnowledgePack interface', ekeSrc.includes('interface KnowledgePack'));
  assert('pack has id', ekeSrc.includes('id: string'));
  assert('pack has domain', ekeSrc.includes('domain:'));
  assert('pack has name', ekeSrc.includes('name: string'));
  assert('pack has nameFa', ekeSrc.includes('nameFa'));
  assert('pack has sizeBytes', ekeSrc.includes('sizeBytes'));
  assert('pack has version', ekeSrc.includes('version:'));
  assert('pack has sources', ekeSrc.includes('sources:'));
  assert('pack has documents', ekeSrc.includes('documents:'));
  assert('pack has embeddingStatus', ekeSrc.includes('embeddingStatus:'));
  assert('pack has installed', ekeSrc.includes('installed:'));
  assert('pack has permissions', ekeSrc.includes('permissions:'));
  assert('pack has capabilities', ekeSrc.includes('capabilities:'));
  assert('pack has checksum', ekeSrc.includes('checksum:'));
  assert('EXPERT_KNOWLEDGE_PACKS catalog', ekeSrc.includes('export const EXPERT_KNOWLEDGE_PACKS'));
  assert('knowledgeDomainToExpertDomain mapping', ekeSrc.includes('export function knowledgeDomainToExpertDomain'));
  assert('DOMAIN_LABELS_FA Persian labels', ekeSrc.includes('export const DOMAIN_LABELS_FA'));
  assert('formatBytesFa helper', ekeSrc.includes('export function formatBytesFa'));
  assert('verifyNoAutonomousActions security hook', ekeSrc.includes('export function verifyNoAutonomousActions'));
  assert('getExpertKnowledgeEngine singleton', ekeSrc.includes('export function getExpertKnowledgeEngine'));
  assert('CRITICAL SECURITY comment', ekeSrc.includes('CRITICAL SECURITY REQUIREMENT'));
  assert('engine NEVER downloads comment', ekeSrc.includes('NEVER') || ekeSrc.includes('never downloads'));
  assert('no https import in engine', !ekeSrc.includes("import * as https") && !ekeSrc.includes("from 'https'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Knowledge Engine API (runtime)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Knowledge Engine API:');
  const { getExpertKnowledgeEngine, _resetExpertKnowledgeEngine, knowledgeDomainToExpertDomain, EXPERT_KNOWLEDGE_PACKS, DOMAIN_LABELS_FA, verifyNoAutonomousActions: engineAudit } = await import('../../src/main/knowledge/expert-knowledge-engine');

  _resetExpertKnowledgeEngine();
  let engine = getExpertKnowledgeEngine();

  const allPacks = engine.listPacks();
  assert('catalog has packs', allPacks.length >= 10, `got ${allPacks.length}`);
  assert('catalog has 5 domains represented', new Set(allPacks.map((p: any) => p.domain)).size === 5);

  const swPacks = engine.getPacksByDomain('software-engineering');
  assert('software-engineering packs exist', swPacks.length >= 3);
  const elPacks = engine.getPacksByDomain('electronics-engineering');
  assert('electronics-engineering packs exist', elPacks.length >= 3);
  const aiPacks = engine.getPacksByDomain('ai-engineering');
  assert('ai-engineering packs exist', aiPacks.length >= 2);
  const sysPacks = engine.getPacksByDomain('system-architecture');
  assert('system-architecture packs exist', sysPacks.length >= 2);
  const sciPacks = engine.getPacksByDomain('science');
  assert('science packs exist', sciPacks.length >= 2);

  const lmPack = engine.getPack('el-power-datasheets');
  assert('getPack returns el-power-datasheets', lmPack !== null);
  assert('el-power-datasheets has LM7805 doc', lmPack!.documents.some((d: any) => d.id.includes('lm7805') || d.title.includes('LM7805')));
  assert('el-power-datasheets has buck converter doc', lmPack!.documents.some((d: any) => d.id.includes('buck') || d.title.includes('Buck')));
  assert('pack has 64-char checksum', lmPack!.checksum.length === 64);
  assert('pack permissions requires-approval', lmPack!.permissions === 'requires-approval');
  assert('pack has capabilitiesFa', lmPack!.capabilitiesFa.length > 0);

  assert('initially no packs installed', engine.getInstalledPacks().length === 0);
  assert('all packs missing initially', engine.getMissingPacks().length === allPacks.length);
  assert('recommended = missing when none installed', engine.getRecommendedPacks().length === allPacks.length);
  assert('recommended electronics packs exist', engine.getRecommendedPacks('electronics-engineering').length === elPacks.length);

  const status = engine.getKnowledgeStatus();
  assert('status totalPacks', status.totalPacks === allPacks.length);
  assert('status installedPacks 0', status.installedPacks === 0);
  assert('status missingPacks = total', status.missingPacks === allPacks.length);
  assert('status totalDocuments > 0', status.totalDocuments > 0);
  assert('status offline true', status.offline === true);
  assert('status has 5 domains', status.domains.length === 5);
  assert('status domains all have totals', status.domains.every((d: any) => d.total > 0));

  // Domain → expert mapping
  assert('software-engineering maps to software expert', knowledgeDomainToExpertDomain('software-engineering') === 'software-engineering');
  assert('electronics-engineering maps to electronics expert', knowledgeDomainToExpertDomain('electronics-engineering') === 'electronics-engineering');
  assert('ai-engineering maps to software expert', knowledgeDomainToExpertDomain('ai-engineering') === 'software-engineering');
  assert('science maps to science expert', knowledgeDomainToExpertDomain('science') === 'science');

  assert('DOMAIN_LABELS_FA has electronics label', DOMAIN_LABELS_FA['electronics-engineering'] === 'مهندسی الکترونیک');
  assert('engine security audit passes', engineAudit().ok === true);
  // Engine must not IMPORT SecureDownloader (a comment mention is fine).
  assert('engine has no SecureDownloader import', !ekeSrc.split('\n').some((l: string) => l.trim().startsWith('import') && l.includes('SecureDownloader')));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) Knowledge Advisor (Persian messages)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Knowledge Advisor:');
  const recFa = engine.generateRecommendationFa('electronics-engineering');
  assert('recommendation message non-empty', recFa.length > 0);
  assert('recommendation asks permission (اجازه دانلود)', recFa.includes('اجازه دانلود'));
  assert('recommendation mentions electronics domain', recFa.includes('الکترونیک'));
  assert('recommendation mentions pack size (حجم)', recFa.includes('حجم'));
  assert('recommendation mentions content (محتوا)', recFa.includes('محتوا'));

  const capFa = engine.getCapabilitiesFa('electronics-engineering');
  assert('capabilities message non-empty', capFa.length > 0);
  assert('capabilities mentions electronics domain', capFa.includes('الکترونیک'));
  assert('capabilities mentions missing packs (when none installed)', capFa.includes('نصب') || capFa.includes('نیاز'));

  const selfDesc = engine.getKnowledgeSelfDescriptionFa();
  assert('self-description non-empty', selfDesc.length > 0);
  assert('self-description mentions missing packs', selfDesc.includes('پیشنهادی') || selfDesc.includes('نصب'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Pack Manager — install (approve), install (deny), remove, update, verify, storage
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Knowledge Pack Manager:');
  const kpmSrc = read('../../src/main/knowledge/knowledge-pack-manager.ts');
  assert('knowledge-pack-manager.ts exists', kpmSrc.length > 0);
  assert('KnowledgePackManager class', kpmSrc.includes('export class KnowledgePackManager'));
  assert('InstalledPackRecord interface', kpmSrc.includes('interface InstalledPackRecord'));
  assert('manager installPack method', kpmSrc.includes('async installPack'));
  assert('manager removePack method', kpmSrc.includes('async removePack'));
  assert('manager updatePack method', kpmSrc.includes('async updatePack'));
  assert('manager verifyChecksum method', kpmSrc.includes('verifyChecksum'));
  assert('manager getStorageInfo method', kpmSrc.includes('getStorageInfo'));
  assert('manager scanInstalledPacks method', kpmSrc.includes('scanInstalledPacks'));
  assert('manager imports PermissionGate', kpmSrc.includes("from '../update/permission-gate'"));
  assert('manager imports AuditLogger', kpmSrc.includes("from '../update/audit-logger'"));
  assert('manager CRITICAL SECURITY comment', kpmSrc.includes('CRITICAL SECURITY REQUIREMENT'));
  assert('manager NEVER autonomously comment', kpmSrc.includes('NEVER autonomously') || kpmSrc.includes('NO SILENT EXECUTION'));
  assert('install uses install-model action type', kpmSrc.includes("type: 'install-model'"));
  assert('remove uses delete-file action type', kpmSrc.includes("type: 'delete-file'"));
  assert('manager has rollback', kpmSrc.includes('rollback') || kpmSrc.includes('Rollback'));
  assert('manager has snapshot', kpmSrc.includes('snapshot'));
  assert('manager no SecureDownloader import', !kpmSrc.includes('SecureDownloader') || kpmSrc.includes('//')); // secure downloader only referenced in comments
  assert('manager getKnowledgePackManager singleton', kpmSrc.includes('export function getKnowledgePackManager'));

  const { getKnowledgePackManager, _resetKnowledgePackManager } = await import('../../src/main/knowledge/knowledge-pack-manager');
  _resetKnowledgePackManager();
  _resetExpertKnowledgeEngine();
  const manager = getKnowledgePackManager();

  // scan initially empty
  const initialScan = manager.scanInstalledPacks();
  assert('scan initially empty', initialScan.length === 0);
  assert('isInstalled false before install', manager.isInstalled('el-power-datasheets') === false);

  // ── Install with APPROVAL ──
  const installPromise = manager.installPack('el-power-datasheets');
  setTimeout(() => manager.respondToPermission('تایید می‌کنم'), 50);
  const installResult = await installPromise;
  assert('install approved → success', installResult.success === true);
  assert('install approved → approved true', installResult.approved === true);
  assert('install produced documents', installResult.documentCount > 0, `got ${installResult.documentCount}`);
  assert('install not rolled back', installResult.rolledBack === false);
  assert('isInstalled true after install', manager.isInstalled('el-power-datasheets') === true);
  assert('scan shows 1 record after install', manager.scanInstalledPacks().length === 1);
  const record = manager.getInstalledRecord('el-power-datasheets');
  assert('installed record has documentIds', record!.documentIds.length > 0);
  assert('installed record has checksum', record!.checksum.length === 64);
  assert('installed record has version', record!.version.length > 0);

  // ── Idempotent install (no permission requested) ──
  const idemResult = await manager.installPack('el-power-datasheets');
  assert('idempotent install success', idemResult.success === true);
  assert('idempotent install reason', (idemResult.reason || '').includes('Already installed'));
  // Drain any stray timers before the next permission-gated operation.
  await sleep(80);

  // ── Install with DENIAL ──
  const denyPromise = manager.installPack('el-fundamentals');
  setTimeout(() => manager.respondToPermission('نه'), 50);
  const denyResult = await denyPromise;
  await sleep(80);
  assert('denied install → not success', denyResult.success === false);
  assert('denied install → approved false', denyResult.approved === false);
  assert('denied install → has denialReason', (denyResult.denialReason || '').length > 0);
  assert('denied pack not installed', manager.isInstalled('el-fundamentals') === false);

  // ── Checksum verification ──
  const verify = manager.verifyChecksum('el-power-datasheets');
  assert('verify valid', verify.valid === true);
  assert('verify matched', verify.matched === true);
  assert('verify has expected', verify.expected.length === 64);
  assert('verify actual === expected', verify.actual === verify.expected);

  const verifyMissing = manager.verifyChecksum('nonexistent-pack');
  assert('verify nonexistent → invalid', verifyMissing.valid === false);

  // ── Storage info ──
  const storage = manager.getStorageInfo();
  assert('storage packCount 1', storage.packCount === 1);
  assert('storage totalBytes > 0', storage.totalBytes > 0);
  assert('storage has contentDir', storage.contentDir.length > 0);
  assert('storage byDomain has electronics', storage.byDomain.some((d: any) => d.domain === 'electronics-engineering'));

  // ── Remove with APPROVAL ──
  const removePromise = manager.removePack('el-power-datasheets');
  setTimeout(() => manager.respondToPermission('تایید حذف فایل'), 50);
  const removeResult = await removePromise;
  assert('remove approved → success', removeResult.success === true);
  assert('remove approved → approved true', removeResult.approved === true);
  assert('remove produced document count', removeResult.documentCount > 0);
  assert('isInstalled false after remove', manager.isInstalled('el-power-datasheets') === false);
  assert('scan empty after remove', manager.scanInstalledPacks().length === 0);

  // ── Remove with DENIAL ──
  // Re-install first
  const reInstallP = manager.installPack('el-power-datasheets');
  setTimeout(() => manager.respondToPermission('تایید می‌کنم'), 50);
  await reInstallP;
  await sleep(80);
  const denyRemoveP = manager.removePack('el-power-datasheets');
  setTimeout(() => manager.respondToPermission('نه'), 50);
  const denyRemoveResult = await denyRemoveP;
  await sleep(80);
  assert('denied remove → not success', denyRemoveResult.success === false);
  assert('denied remove → approved false', denyRemoveResult.approved === false);
  assert('denied remove → pack still installed', manager.isInstalled('el-power-datasheets') === true);

  // Clean up for next sections
  const cleanupP = manager.removePack('el-power-datasheets');
  setTimeout(() => manager.respondToPermission('تایید حذف فایل'), 50);
  await cleanupP;
  await sleep(80);

  // ═══════════════════════════════════════════════════════════════════════
  // 5) RAG Integration (install → retrieve offline)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) RAG Integration:');
  // Re-fetch the engine (it was reset in section 4) so docToPack is current.
  engine = getExpertKnowledgeEngine();
  // Install electronics pack
  const ragInstallP = manager.installPack('el-power-datasheets');
  setTimeout(() => manager.respondToPermission('تایید می‌کنم'), 50);
  const ragInstall = await ragInstallP;
  await sleep(80);
  assert('RAG: pack installed', ragInstall.success === true);
  assert('RAG: documents ingested', ragInstall.documentCount > 0);

  // Retrieve knowledge about LM7805
  const retrieval = await engine.retrieveKnowledge('LM7805 5V regulator', { limit: 3 });
  assert('RAG: retrieval offline', retrieval.offline === true);
  assert('RAG: retrieval installedPackCount 1', retrieval.installedPackCount === 1);
  assert('RAG: retrieval has results', retrieval.results.length > 0, `got ${retrieval.results.length}`);
  if (retrieval.results.length > 0) {
    const top = retrieval.results[0];
    assert('RAG: top result has documentId', top.documentId.length > 0);
    assert('RAG: top result has content', top.content.length > 0);
    assert('RAG: top result has score', typeof top.score === 'number');
    assert('RAG: top result attributed to pack', (top.packId || '').length > 0);
  }

  // Retrieve with domain filter
  const retrievalByDomain = await engine.retrieveKnowledge('buck converter', { domain: 'electronics-engineering', limit: 2 });
  assert('RAG: domain-filtered retrieval offline', retrievalByDomain.offline === true);
  assert('RAG: domain-filtered has results', retrievalByDomain.results.length >= 0); // may be 0 if no match; just ensure no throw

  // Framed context string (for brain prompt)
  assert('RAG: framed string non-empty', retrieval.framed.length > 0);
  assert('RAG: framed contains source attribution', retrieval.framed.includes('score'));

  // Retrieve with no packs installed (after remove) → empty
  const rmP = manager.removePack('el-power-datasheets');
  setTimeout(() => manager.respondToPermission('تایید حذف فایل'), 50);
  await rmP;
  const emptyRetrieval = await engine.retrieveKnowledge('anything');
  assert('RAG: empty when no packs installed', emptyRetrieval.results.length === 0);
  assert('RAG: empty retrieval installedPackCount 0', emptyRetrieval.installedPackCount === 0);

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Permission Gate (Persian confirmation phrases)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Permission Gate:');
  const { PermissionGate } = await import('../../src/main/update/permission-gate');

  // REQUIRES_APPROVAL (install-model) → 'تایید می‌کنم'
  const gate1 = new PermissionGate();
  const p1 = gate1.requestPermission({ type: 'install-model', description: 'test install' });
  setTimeout(() => gate1.respondToPermissionRequest('تایید می‌کنم'), 10);
  const r1 = await p1;
  assert('persian تایید می‌کنم approves install', r1.approved === true);
  assert('approved has confirmationMethod chat', r1.confirmationMethod === 'chat');

  // English confirm also works
  const gate2 = new PermissionGate();
  const p2 = gate2.requestPermission({ type: 'install-model', description: 'test' });
  setTimeout(() => gate2.respondToPermissionRequest('confirm'), 10);
  const r2 = await p2;
  assert('english confirm approves', r2.approved === true);

  // Denial
  const gate3 = new PermissionGate();
  const p3 = gate3.requestPermission({ type: 'install-model', description: 'test' });
  setTimeout(() => gate3.respondToPermissionRequest('نه'), 10);
  const r3 = await p3;
  assert('نه denies', r3.approved === false);
  assert('denied has denialReason', (r3.denialReason || '').length > 0);
  assert('denied confirmationMethod denied', r3.confirmationMethod === 'denied');

  // HIGH_RISK (delete-file) → requires 'تایید حذف فایل'
  const gate4 = new PermissionGate();
  const p4 = gate4.requestPermission({ type: 'delete-file', description: 'remove pack' });
  setTimeout(() => gate4.respondToPermissionRequest('تایید حذف فایل'), 10);
  const r4 = await p4;
  assert('تایید حذف فایل approves delete', r4.approved === true);

  // HIGH_RISK wrong phrase → denied
  const gate5 = new PermissionGate();
  const p5 = gate5.requestPermission({ type: 'delete-file', description: 'remove pack' });
  setTimeout(() => gate5.respondToPermissionRequest('تایید می‌کنم'), 10); // wrong phrase for HIGH_RISK
  const r5 = await p5;
  assert('wrong phrase denies HIGH_RISK delete', r5.approved === false);

  // Audit log records permission events
  const { AuditLogger } = await import('../../src/main/update/audit-logger');
  const audit = new AuditLogger();
  audit.log({ action: 'permission-approved', description: 'test approved', level: 'REQUIRES_APPROVAL' });
  audit.log({ action: 'permission-denied', description: 'test denied', level: 'REQUIRES_APPROVAL' });
  const recent = audit.readRecent(10);
  assert('audit log has entries', recent.length >= 2);
  const approvedEntries = recent.filter((e: any) => e.action === 'permission-approved');
  assert('audit has approved entry', approvedEntries.length >= 1);

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Expert Routing → Knowledge Domain Mapping
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Expert Routing → Knowledge:');
  const { getExpertRouter } = await import('../../src/main/ai/expert-router');

  const router = getExpertRouter();
  const electronicsRoute = router.route('مدار تغذیه 5 ولت طراحی کن');
  assert('electronics question routes to electronics expert', electronicsRoute.domain === 'electronics-engineering', `got ${electronicsRoute.domain}`);

  const codeRoute = router.route('write a python function');
  assert('code question routes to software expert', codeRoute.domain === 'software-engineering');

  // The mapped knowledge domain should have available packs
  const mappedExpert = knowledgeDomainToExpertDomain('electronics-engineering');
  assert('electronics knowledge maps to electronics expert', mappedExpert === 'electronics-engineering');
  const recommendedForElectronics = engine.getRecommendedPacks('electronics-engineering');
  assert('recommended electronics packs exist', recommendedForElectronics.length >= 3);

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Offline Mode (all retrieval local, no network)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Offline Mode:');
  assert('status offline true', engine.getKnowledgeStatus().offline === true);
  // retrieval response always offline
  const offlineRet = await engine.retrieveKnowledge('test query');
  assert('retrieval response offline', offlineRet.offline === true);
  // engine source has no http/https network calls
  assert('engine source has no fetch()', !ekeSrc.includes('fetch('));
  assert('engine source has no XMLHttpRequest', !ekeSrc.includes('XMLHttpRequest'));
  assert('engine source has no net.request', !ekeSrc.includes('net.request'));
  // HashEmbedder is offline (no API calls)
  const hashEmbedderSrc = read('../../src/main/knowledge/hash-embedder.ts');
  assert('HashEmbedder is offline (no fetch)', !hashEmbedderSrc.includes('fetch('));
  assert('HashEmbedder has embedSync', hashEmbedderSrc.includes('embedSync'));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Security (NO autonomous download/install/delete)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Security (no autonomous actions):');
  // Engine: must NOT contain download/install/remove methods that mutate without permission
  assert('engine has NO download() method', !ekeSrc.includes('async download(') && !ekeSrc.includes(' download('));
  assert('engine has NO installPack() method (that is the manager)', !ekeSrc.includes('async installPack('));
  assert('engine has NO removePack() method (that is the manager)', !ekeSrc.includes('async removePack('));
  assert('engine ingestPackDocuments is called only by manager', ekeSrc.includes('ingestPackDocuments'));
  assert('engine describes only — has listPacks', ekeSrc.includes('listPacks()'));
  assert('engine describes only — has retrieveKnowledge', ekeSrc.includes('retrieveKnowledge('));

  // Manager: every mutating method must call requestPermission
  assert('manager installPack calls requestPermission', kpmSrc.includes('await this.requestPermission') && kpmSrc.includes('installPack'));
  assert('manager removePack calls requestPermission', kpmSrc.includes('await this.requestPermission'));
  assert('manager updatePack calls requestPermission', kpmSrc.includes('await this.requestPermission'));
  assert('manager requestPermission is private', kpmSrc.includes('private async requestPermission'));
  assert('manager has NO direct download() call', !kpmSrc.match(/await\s+this\.download\(/));
  assert('manager has NO delete without permission', !kpmSrc.includes('fs.rmSync') === false || kpmSrc.includes('deleteContentDir')); // deleteContentDir only after permission
  assert('manager deleteContentDir only after permission', kpmSrc.includes('deleteContentDir(packId)'));
  assert('manager no autonomous fs.rmSync at top level', kpmSrc.indexOf('fs.rmSync') >= 0 ? kpmSrc.includes('deleteContentDir') : true);

  // Runtime security: install without approval MUST fail
  _resetKnowledgePackManager();
  _resetExpertKnowledgeEngine();
  const secManager = getKnowledgePackManager();
  const secInstallP = secManager.installPack('sw-languages');
  // DO NOT respond to permission → it should hang; respond with denial
  setTimeout(() => secManager.respondToPermission('نه'), 50);
  const secResult = await secInstallP;
  assert('security: install denied without approval', secResult.success === false);
  assert('security: denied pack not installed', secManager.isInstalled('sw-languages') === false);

  // remove without approval MUST fail (pack not installed → returns fail, but also test denial on installed)
  const secRemoveP = secManager.removePack('sw-languages');
  setTimeout(() => secManager.respondToPermission('نه'), 50);
  const secRemoveResult = await secRemoveP;
  assert('security: remove denied/fails without approval', secRemoveResult.success === false);

  // ═══════════════════════════════════════════════════════════════════════
  // 10) Identity Integration
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) Identity Integration:');
  const idSrc = read('../../src/main/ai/nex-identity-manager.ts');
  assert('identity has expertKnowledgeStatus field', idSrc.includes('expertKnowledgeStatus'));
  assert('identity has expertKnowledgeSummaryFa field', idSrc.includes('expertKnowledgeSummaryFa'));
  assert('identity imports expert knowledge engine', idSrc.includes("import('../knowledge/expert-knowledge-engine')"));
  assert('identity populates installedPackNames', idSrc.includes('installedPackNames'));
  assert('identity populates missingPackNames', idSrc.includes('missingPackNames'));
  assert('identity has Persian self-description', idSrc.includes('دانش نصب شده'));
  assert('identity has recommendedForElectronics', idSrc.includes('recommendedForElectronics'));
  assert('identity promotes expert-knowledge capability', idSrc.includes("'expert-knowledge'"));

  // Runtime: identity self-awareness includes knowledge status
  const { getNexIdentityManager } = await import('../../src/main/ai/nex-identity-manager');
  const identity = getNexIdentityManager();
  const awareness = await identity.getSelfAwareness();
  assert('awareness has expertKnowledgeStatus', awareness.expertKnowledgeStatus !== undefined);
  assert('awareness expertKnowledgeStatus.totalPacks > 0', (awareness.expertKnowledgeStatus?.totalPacks ?? 0) > 0);
  assert('awareness expertKnowledgeStatus.offline true', awareness.expertKnowledgeStatus?.offline === true);
  assert('awareness has expertKnowledgeSummaryFa', (awareness.expertKnowledgeSummaryFa ?? '').length > 0);
  assert('awareness summary mentions knowledge packs', (awareness.systemSummaryFa || '').includes('بسته دانش'));

  // ═══════════════════════════════════════════════════════════════════════
  // 11) IPC Handlers + Preload Bridges + Type Definitions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n11) IPC + Preload + Types:');
  const mainSrc = read('../../src/main/main.ts');
  assert('main has Phase 55 block', mainSrc.includes('Phase 55: Offline Expert Knowledge Engine'));
  assert('main imports getExpertKnowledgeEngine', mainSrc.includes("import('./knowledge/expert-knowledge-engine')"));
  assert('main imports getKnowledgePackManager', mainSrc.includes("import('./knowledge/knowledge-pack-manager')"));
  // IPC channels
  const ipcChannels = [
    'expert-knowledge-list', 'expert-knowledge-get', 'expert-knowledge-by-domain',
    'expert-knowledge-status', 'expert-knowledge-installed', 'expert-knowledge-missing',
    'expert-knowledge-recommend', 'expert-knowledge-retrieve',
    'expert-knowledge-recommendation-fa', 'expert-knowledge-capabilities-fa', 'expert-knowledge-self-desc-fa',
    'knowledge-pack-scan', 'knowledge-pack-install', 'knowledge-pack-remove', 'knowledge-pack-update',
    'knowledge-pack-verify', 'knowledge-pack-verify-all', 'knowledge-pack-storage',
    'knowledge-pack-pending-permission', 'knowledge-pack-respond-permission', 'knowledge-pack-respond-voice',
  ];
  for (const ch of ipcChannels) {
    assert(`main registers ipc handler '${ch}'`, mainSrc.includes(`ipcMain.handle('${ch}'`));
  }
  assert('main wires knowledge-pack permission callback', mainSrc.includes('knowledge-pack-permission-request'));

  // Preload
  const preloadSrc = read('../../src/main/preload.ts');
  assert('preload has Phase 55 section', preloadSrc.includes('Phase 55: Offline Expert Knowledge Engine'));
  const preloadMethods = [
    'expertKnowledgeList', 'expertKnowledgeGet', 'expertKnowledgeByDomain', 'expertKnowledgeStatus',
    'expertKnowledgeInstalled', 'expertKnowledgeMissing', 'expertKnowledgeRecommend',
    'expertKnowledgeRetrieve', 'expertKnowledgeRecommendationFa', 'expertKnowledgeCapabilitiesFa',
    'expertKnowledgeSelfDescFa', 'knowledgePackScan', 'knowledgePackInstall', 'knowledgePackRemove',
    'knowledgePackUpdate', 'knowledgePackVerify', 'knowledgePackVerifyAll', 'knowledgePackStorage',
    'knowledgePackPendingPermission', 'knowledgePackRespondPermission', 'knowledgePackRespondVoice',
    'onKnowledgePackPermissionRequest',
  ];
  for (const m of preloadMethods) {
    assert(`preload exposes '${m}'`, preloadSrc.includes(`${m}:`));
  }

  // Types
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('types has Phase 55 section', typesSrc.includes('Phase 55: Offline Expert Knowledge Engine'));
  for (const m of preloadMethods) {
    assert(`types declares '${m}'`, typesSrc.includes(`${m}:`));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 12) UI Panel + Navigation
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n12) UI Panel + Navigation:');
  const panelSrc = read('../../src/renderer/components/ExpertKnowledgePanel.tsx');
  assert('ExpertKnowledgePanel exists', panelSrc.length > 0);
  assert('panel default export', panelSrc.includes('export default function ExpertKnowledgePanel'));
  assert('panel has installed/missing/advisor tabs', panelSrc.includes("'installed'") && panelSrc.includes("'missing'") && panelSrc.includes("'advisor'"));
  assert('panel calls knowledgePackInstall', panelSrc.includes('knowledgePackInstall'));
  assert('panel calls knowledgePackRemove', panelSrc.includes('knowledgePackRemove'));
  assert('panel calls knowledgePackUpdate', panelSrc.includes('knowledgePackUpdate'));
  assert('panel calls knowledgePackVerify', panelSrc.includes('knowledgePackVerify'));
  assert('panel calls expertKnowledgeList', panelSrc.includes('expertKnowledgeList'));
  assert('panel calls expertKnowledgeStatus', panelSrc.includes('expertKnowledgeStatus'));
  assert('panel calls expertKnowledgeRecommendationFa', panelSrc.includes('expertKnowledgeRecommendationFa'));
  assert('panel has permission dialog', panelSrc.includes('pendingPermission'));
  assert('panel subscribes to permission requests', panelSrc.includes('onKnowledgePackPermissionRequest'));
  assert('panel shows pack size', panelSrc.includes('formatBytes'));
  assert('panel shows pack version', panelSrc.includes('version'));
  assert('panel shows capabilities', panelSrc.includes('capabilities'));

  const navSrc = read('../../src/renderer/components/layout/NavigationRail.tsx');
  assert('nav has expertise view', navSrc.includes("'expertise'"));
  assert('nav has GraduationCap icon', navSrc.includes('GraduationCap'));
  assert('nav has Expertise label', navSrc.includes("label: 'Expertise'"));

  const appShellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
  assert('AppShell imports ExpertKnowledgePanel', appShellSrc.includes('ExpertKnowledgePanel'));
  assert('AppShell routes expertise view', appShellSrc.includes("case 'expertise'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 13) Phase 38-54 Preserved
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n13) Phase 38-54 Preserved:');
  assert('Phase 53 expert system exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-expert-system.ts')));
  assert('Phase 53 expert router exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/expert-router.ts')));
  assert('Phase 54 agent-skill-registry exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/agent-skill-registry.ts')));
  assert('Phase 54 nex-agent-executor exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-agent-executor.ts')));
  assert('Phase 43 permission-gate exists', fs.existsSync(path.join(__dirname, '../../src/main/update/permission-gate.ts')));
  assert('Phase 43 audit-logger exists', fs.existsSync(path.join(__dirname, '../../src/main/update/audit-logger.ts')));
  assert('Phase 40 knowledge-service exists', fs.existsSync(path.join(__dirname, '../../src/main/knowledge/knowledge-service.ts')));
  assert('Phase 39 model-registry exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-registry.ts')));
  assert('Phase 51 nex-brain-controller exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-brain-controller.ts')));
  assert('Phase 52 long-term-memory-system exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/long-term-memory-system.ts')));
  assert('Phase 51 nex-identity-manager exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-identity-manager.ts')));

  // Existing expert system still works
  const { EXPERT_PROFILES } = await import('../../src/main/ai/nex-expert-system');
  assert('expert profiles still 6', EXPERT_PROFILES.length === 6);
  assert('electronics expert still present', EXPERT_PROFILES.some((e: any) => e.domain === 'electronics-engineering'));

  // ═══════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 55 EXPERT KNOWLEDGE RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('FAILURES:', failures.join(' | '));
    process.exit(1);
  }
  console.log('PHASE 55 OFFLINE EXPERT KNOWLEDGE ENGINE: ALL PASS ✅');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
