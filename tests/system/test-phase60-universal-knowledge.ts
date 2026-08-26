/**
 * Phase 60 — Universal Knowledge Brain Expansion Tests
 *
 * Verifies:
 *   1. Universal knowledge catalog module structure + security
 *   2. Expanded domains (9 domains: 5 Phase 55 + 4 Phase 60 new)
 *   3. Knowledge graph (domain → subdomain → concept → documents)
 *   4. Phase 60 new knowledge packs (architecture/mechanical/business/economics + SW expansion)
 *   5. Universal knowledge brain module structure + security
 *   6. Expert knowledge routing (Expert + KnowledgePack + Model)
 *   7. Advanced RAG (multilingual/Persian search + normalization)
 *   8. Knowledge graph queries
 *   9. Domain detection
 *  10. Identity update (multidisciplinary knowledge self-awareness)
 *  11. IPC handlers + preload bridges + type declarations
 *  12. UI panel + navigation
 *  13. Security (no auto-download, no cloud, offline only, audit)
 *  14. Phase 51-59 preserved (regression)
 *
 * Run: npx tsx tests/system/test-phase60-universal-knowledge.ts
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
  // 1) Universal Knowledge Catalog Module Structure
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) Universal Knowledge Catalog Module Structure:');
  const catSrc = read('../../src/main/knowledge/universal-knowledge-catalog.ts');

  assert('universal-knowledge-catalog.ts exists', catSrc.length > 0);
  assert('UniversalKnowledgeDomain type', catSrc.includes('export type UniversalKnowledgeDomain'));
  assert('DomainInfo interface', catSrc.includes('interface DomainInfo'));
  assert('SubdomainInfo interface', catSrc.includes('interface SubdomainInfo'));
  assert('KnowledgeGraphNode interface', catSrc.includes('interface KnowledgeGraphNode'));
  assert('KnowledgeGraphEdge interface', catSrc.includes('interface KnowledgeGraphEdge'));
  assert('KnowledgeGraph interface', catSrc.includes('interface KnowledgeGraph'));
  assert('UniversalKnowledgePack interface', catSrc.includes('interface UniversalKnowledgePack'));
  assert('UNIVERSAL_DOMAINS const', catSrc.includes('export const UNIVERSAL_DOMAINS'));
  assert('PHASE60_KNOWLEDGE_PACKS const', catSrc.includes('export const PHASE60_KNOWLEDGE_PACKS'));
  assert('getKnowledgeGraph function', catSrc.includes('export function getKnowledgeGraph'));
  assert('getUniversalDomains function', catSrc.includes('export function getUniversalDomains'));
  assert('getUniversalDomain function', catSrc.includes('export function getUniversalDomain'));
  assert('getPhase60Packs function', catSrc.includes('export function getPhase60Packs'));
  assert('getPhase60PacksByDomain function', catSrc.includes('export function getPhase60PacksByDomain'));
  assert('getPhase60Pack function', catSrc.includes('export function getPhase60Pack'));
  assert('universalDomainToExpertDomain function', catSrc.includes('export function universalDomainToExpertDomain'));
  assert('UNIVERSAL_DOMAIN_LABELS_FA const', catSrc.includes('export const UNIVERSAL_DOMAIN_LABELS_FA'));
  assert('detectDomainForQuery function', catSrc.includes('export function detectDomainForQuery'));
  assert('verifyCatalogSecurity function', catSrc.includes('export function verifyCatalogSecurity'));

  // Phase 60 new domains
  assert('has architecture domain', catSrc.includes("'architecture'"));
  assert('has mechanical domain', catSrc.includes("'mechanical'"));
  assert('has business domain', catSrc.includes("'business'"));
  assert('has economics domain', catSrc.includes("'economics'"));
  // Phase 55 preserved domains
  assert('has software-engineering domain', catSrc.includes("'software-engineering'"));
  assert('has electronics-engineering domain', catSrc.includes("'electronics-engineering'"));
  assert('has ai-engineering domain', catSrc.includes("'ai-engineering'"));
  assert('has system-architecture domain', catSrc.includes("'system-architecture'"));
  assert('has science domain', catSrc.includes("'science'"));

  // Phase 60 new subdomains
  assert('has building-design subdomain', catSrc.includes("'building-design'"));
  assert('has structures subdomain', catSrc.includes("'structures'"));
  assert('has materials subdomain', catSrc.includes("'materials'"));
  assert('has cad-concepts subdomain', catSrc.includes("'cad-concepts'"));
  assert('has mechanics subdomain', catSrc.includes("'mechanics'"));
  assert('has machines subdomain', catSrc.includes("'machines'"));
  assert('has manufacturing subdomain', catSrc.includes("'manufacturing'"));
  assert('has microeconomics subdomain', catSrc.includes("'microeconomics'"));
  assert('has macroeconomics subdomain', catSrc.includes("'macroeconomics'"));
  assert('has cybersecurity subdomain', catSrc.includes("'cybersecurity'"));
  assert('has devops subdomain', catSrc.includes("'devops'"));

  // Security
  assert('SECURITY comment', catSrc.includes('SECURITY'));
  assert('no fetch() call', !catSrc.includes('fetch('));
  assert('no net.request call (code)', !catSrc.split('\n').some((l: string) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && l.includes('net.request')));
  assert('no SecureDownloader import', !catSrc.split('\n').some((l: string) => l.trim().startsWith('import') && l.includes('SecureDownloader')));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Expanded Domains (runtime)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Expanded Domains:');
  const { getUniversalDomains, getUniversalDomain, universalDomainToExpertDomain, UNIVERSAL_DOMAIN_LABELS_FA, verifyCatalogSecurity: verifyCatSec } = await import('../../src/main/knowledge/universal-knowledge-catalog');

  const domains = getUniversalDomains();
  assert('9 domains total', domains.length === 9, `got ${domains.length}`);
  assert('all domains have nameFa', domains.every((d: any) => d.nameFa.length > 0));
  assert('all domains have subdomains', domains.every((d: any) => d.subdomains.length > 0));
  assert('all domains have expertDomain', domains.every((d: any) => d.expertDomain !== undefined));

  // New Phase 60 domains present
  const archDomain = getUniversalDomain('architecture');
  assert('architecture domain exists', archDomain !== null);
  assert('architecture has 4 subdomains', archDomain!.subdomains.length === 4);
  assert('architecture has building-design', archDomain!.subdomains.some((s: any) => s.id === 'building-design'));

  const mechDomain = getUniversalDomain('mechanical');
  assert('mechanical domain exists', mechDomain !== null);
  assert('mechanical has 3 subdomains', mechDomain!.subdomains.length === 3);

  const bizDomain = getUniversalDomain('business');
  assert('business domain exists', bizDomain !== null);

  const econDomain = getUniversalDomain('economics');
  assert('economics domain exists', econDomain !== null);

  // Domain → expert mapping
  assert('architecture → general expert', universalDomainToExpertDomain('architecture') === 'general');
  assert('mechanical → general expert', universalDomainToExpertDomain('mechanical') === 'general');
  assert('business → business expert', universalDomainToExpertDomain('business') === 'business');
  assert('economics → business expert', universalDomainToExpertDomain('economics') === 'business');
  assert('software-engineering → software expert', universalDomainToExpertDomain('software-engineering') === 'software-engineering');

  // Persian labels
  assert('architecture labelFa', UNIVERSAL_DOMAIN_LABELS_FA['architecture'] === 'معماری و عمران');
  assert('mechanical labelFa', UNIVERSAL_DOMAIN_LABELS_FA['mechanical'] === 'مهندسی مکانیک');
  assert('economics labelFa', UNIVERSAL_DOMAIN_LABELS_FA['economics'] === 'اقتصاد');

  // Catalog security
  const catSec = verifyCatSec();
  assert('catalog security audit passes', catSec.ok === true);

  // ═══════════════════════════════════════════════════════════════════════
  // 3) Knowledge Graph
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Knowledge Graph:');
  const { getKnowledgeGraph } = await import('../../src/main/knowledge/universal-knowledge-catalog');
  const graph = getKnowledgeGraph();
  assert('graph has nodes', graph.nodes.length > 0);
  assert('graph has edges', graph.edges.length > 0);
  assert('graph has domain nodes', graph.nodes.some((n: any) => n.type === 'domain'));
  assert('graph has subdomain nodes', graph.nodes.some((n: any) => n.type === 'subdomain'));
  assert('graph has concept nodes', graph.nodes.some((n: any) => n.type === 'concept'));
  assert('graph has contains edges', graph.edges.some((e: any) => e.relationship === 'contains'));
  assert('graph nodes have parentId', graph.nodes.every((n: any) => 'parentId' in n));
  assert('graph concept count > 20', graph.nodes.filter((n: any) => n.type === 'concept').length > 20);

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Phase 60 New Knowledge Packs
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Phase 60 New Knowledge Packs:');
  const { getPhase60Packs, getPhase60PacksByDomain, getPhase60Pack } = await import('../../src/main/knowledge/universal-knowledge-catalog');
  const packs = getPhase60Packs();
  assert('Phase 60 has packs', packs.length >= 6, `got ${packs.length}`);
  assert('all packs have isPhase60New', packs.every((p: any) => p.isPhase60New === true));
  assert('all packs have nameFa', packs.every((p: any) => p.nameFa.length > 0));
  assert('all packs have capabilities', packs.every((p: any) => p.capabilities.length > 0));
  assert('all packs have languages', packs.every((p: any) => p.languages.length > 0));
  assert('all packs have persianSupport', packs.every((p: any) => typeof p.persianSupport === 'boolean'));

  // Architecture packs
  const archPacks = getPhase60PacksByDomain('architecture');
  assert('architecture has 2 packs', archPacks.length === 2, `got ${archPacks.length}`);
  assert('has arch-building-design pack', !!getPhase60Pack('arch-building-design'));
  assert('has arch-structures-materials pack', !!getPhase60Pack('arch-structures-materials'));

  // Mechanical packs
  const mechPacks = getPhase60PacksByDomain('mechanical');
  assert('mechanical has 1 pack', mechPacks.length === 1);
  assert('has mech-fundamentals pack', !!getPhase60Pack('mech-fundamentals'));

  // Business packs
  const bizPacks = getPhase60PacksByDomain('business');
  assert('business has 1 pack', bizPacks.length === 1);
  assert('has biz-management pack', !!getPhase60Pack('biz-management'));

  // Economics packs
  const econPacks = getPhase60PacksByDomain('economics');
  assert('economics has 1 pack', econPacks.length === 1);
  assert('has econ-fundamentals pack', !!getPhase60Pack('econ-fundamentals'));

  // SW expansion packs
  const swPacks = getPhase60PacksByDomain('software-engineering');
  assert('SW expansion has 2 packs', swPacks.length === 2, `got ${swPacks.length}`);
  assert('has sw-cybersecurity pack', !!getPhase60Pack('sw-cybersecurity'));
  assert('has sw-databases-devops pack', !!getPhase60Pack('sw-databases-devops'));

  // No duplicate IDs
  const packIds = new Set<string>();
  let packDup = 0;
  for (const p of packs) { if (packIds.has(p.id)) packDup++; packIds.add(p.id); }
  assert('no duplicate pack IDs', packDup === 0);

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Universal Knowledge Brain Module Structure
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Universal Knowledge Brain Module Structure:');
  const brainSrc = read('../../src/main/knowledge/universal-knowledge-brain.ts');

  assert('universal-knowledge-brain.ts exists', brainSrc.length > 0);
  assert('ExpertKnowledgeRoute interface', brainSrc.includes('interface ExpertKnowledgeRoute'));
  assert('MultilingualSearchResult interface', brainSrc.includes('interface MultilingualSearchResult'));
  assert('KnowledgeGraphQuery interface', brainSrc.includes('interface KnowledgeGraphQuery'));
  assert('UniversalKnowledgeStatus interface', brainSrc.includes('interface UniversalKnowledgeStatus'));
  assert('UniversalKnowledgeBrain class', brainSrc.includes('export class UniversalKnowledgeBrain'));
  assert('routeQuery method', brainSrc.includes('async routeQuery('));
  assert('searchMultilingual method', brainSrc.includes('async searchMultilingual('));
  assert('queryKnowledgeGraph method', brainSrc.includes('queryKnowledgeGraph('));
  assert('getStatus method', brainSrc.includes('getStatus()'));
  assert('verifyUniversalKnowledgeSecurity function', brainSrc.includes('export function verifyUniversalKnowledgeSecurity'));
  assert('getUniversalKnowledgeBrain singleton', brainSrc.includes('export function getUniversalKnowledgeBrain'));
  assert('_resetUniversalKnowledgeBrain for tests', brainSrc.includes('export function _resetUniversalKnowledgeBrain'));

  // Imports — connects to all subsystems
  assert('imports ExpertRouter', brainSrc.includes("from '../ai/expert-router'"));
  assert('imports ExpertKnowledgeEngine', brainSrc.includes("from './expert-knowledge-engine'"));
  assert('imports universal-knowledge-catalog', brainSrc.includes("from './universal-knowledge-catalog'"));
  assert('imports ExpertDomain type', brainSrc.includes('ExpertDomain'));

  // Security
  assert('SECURITY comment', brainSrc.includes('SECURITY'));
  assert('no automatic downloads comment', brainSrc.includes('No automatic downloads') || brainSrc.includes('automatic downloads'));
  assert('offline only comment', brainSrc.includes('Offline only') || brainSrc.includes('offline'));
  assert('audit logs comment', brainSrc.includes('audit') || brainSrc.includes('Audit'));
  assert('no fetch() call', !brainSrc.includes('fetch('));
  assert('no net.request call (code)', !brainSrc.split('\n').some((l: string) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && l.includes('net.request')));
  assert('no SecureDownloader import', !brainSrc.split('\n').some((l: string) => l.trim().startsWith('import') && l.includes('SecureDownloader')));
  assert('no async download() method', !brainSrc.includes('async download('));
  assert('no async install() method', !brainSrc.includes('async install('));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Expert Knowledge Routing
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Expert Knowledge Routing:');
  const { getUniversalKnowledgeBrain, _resetUniversalKnowledgeBrain, verifyUniversalKnowledgeSecurity } = await import('../../src/main/knowledge/universal-knowledge-brain');
  _resetUniversalKnowledgeBrain();
  const brain = getUniversalKnowledgeBrain();

  // Electronics routing
  const elRoute = await brain.routeQuery('طراحی مدار تغذیه ۱۲ ولت');
  assert('electronics route returns result', elRoute !== null);
  assert('electronics route has expertDomain', elRoute.expertDomain === 'electronics-engineering', `got ${elRoute.expertDomain}`);
  assert('electronics route has knowledgeDomain', elRoute.knowledgeDomain !== null);
  assert('electronics route has expertRoute', elRoute.expertRoute !== null);
  assert('electronics route has recommendedPack', elRoute.recommendedPack !== null);
  assert('electronics route has packInstalled boolean', typeof elRoute.packInstalled === 'boolean');
  assert('electronics route has recommendedModelType', elRoute.recommendedModelType.length > 0);
  assert('electronics route has summaryFa', elRoute.summaryFa.length > 0);
  assert('electronics route has hasKnowledge boolean', typeof elRoute.hasKnowledge === 'boolean');
  assert('electronics route has missingKnowledge boolean', typeof elRoute.missingKnowledge === 'boolean');

  // Software routing
  const swRoute = await brain.routeQuery('ساخت API با React');
  assert('software route returns result', swRoute !== null);
  assert('software route expertDomain', swRoute.expertDomain === 'software-engineering', `got ${swRoute.expertDomain}`);

  // Vision routing
  const visRoute = await brain.routeQuery({ request: 'تحلیل تصویر', hasImage: true });
  assert('vision route returns result', visRoute !== null);
  assert('vision route recommends vision model', visRoute.recommendedModelType === 'vision');

  // Coding routing
  const codeRoute = await brain.routeQuery('یک تابع پایتون بنویس');
  assert('coding route returns result', codeRoute !== null);
  assert('coding route recommends coding model', codeRoute.recommendedModelType === 'coding');

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Advanced RAG (multilingual/Persian search)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Advanced RAG:');
  _resetUniversalKnowledgeBrain();
  const brain2 = getUniversalKnowledgeBrain();

  // Persian search with ZWNJ
  const persianSearch = await brain2.searchMultilingual('مدار\u200cهای الکترونیکی');
  assert('persian search returns result', persianSearch !== null);
  assert('persian search detects fa', persianSearch.detectedLanguage === 'fa');
  assert('persian search normalizes ZWNJ', persianSearch.persianNormalized === true);
  assert('persian search normalized query has no ZWNJ', !persianSearch.normalizedQuery.includes('\u200c'));

  // Mixed language
  const mixedSearch = await brain2.searchMultilingual('React framework برای frontend');
  assert('mixed search detects mixed', mixedSearch.detectedLanguage === 'mixed');

  // English
  const enSearch = await brain2.searchMultilingual('buck converter design');
  assert('english search detects en', enSearch.detectedLanguage === 'en');
  assert('english search not persian normalized', enSearch.persianNormalized === false);

  // Arabic → Persian letter normalization
  const arabicYeh = await brain2.searchMultilingual('مدار يك'); // Arabic Yeh
  assert('arabic yeh normalized to persian', arabicYeh.normalizedQuery.includes('ی') && !arabicYeh.normalizedQuery.includes('ي'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Knowledge Graph Queries
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Knowledge Graph Queries:');
  const graphQ1 = brain2.queryKnowledgeGraph({ domain: 'electronics-engineering' });
  assert('graph query by domain returns nodes', graphQ1.nodes.length > 0);
  assert('all nodes match domain', graphQ1.nodes.every((n: any) => n.domain === 'electronics-engineering'));
  assert('graph query has relatedConcepts', Array.isArray(graphQ1.relatedConcepts));

  const graphQ2 = brain2.queryKnowledgeGraph({ concept: 'React' });
  assert('graph query by concept returns nodes', graphQ2.nodes.length > 0);
  assert('concept nodes are type concept', graphQ2.nodes.every((n: any) => n.type === 'concept'));

  const graphQ3 = brain2.queryKnowledgeGraph({});
  assert('graph query empty returns all nodes', graphQ3.nodes.length > 20);

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Domain Detection
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Domain Detection:');
  const { detectDomainForQuery } = await import('../../src/main/knowledge/universal-knowledge-catalog');

  assert('detect electronics for مدار', detectDomainForQuery('طراحی مدار') === 'electronics-engineering');
  assert('detect software for React', detectDomainForQuery('React API') === 'software-engineering');
  assert('detect science for physics', detectDomainForQuery('quantum physics') === 'science');
  assert('detect architecture for building', detectDomainForQuery('building design floor plan') === 'architecture');
  assert('detect mechanical for gear', detectDomainForQuery('gear bearing machining') === 'mechanical');
  assert('detect business for agile', detectDomainForQuery('agile scrum project') === 'business');

  // ═══════════════════════════════════════════════════════════════════════
  // 10) Identity Update
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) Identity Update:');
  const idSrc = read('../../src/main/ai/nex-identity-manager.ts');
  assert('identity has Phase 60 knowledge brain ability', idSrc.includes('Universal multidisciplinary knowledge brain'));
  assert('identity has expert knowledge routing ability', idSrc.includes('Expert knowledge routing'));
  assert('identity has knowledge graph ability', idSrc.includes('Knowledge graph navigation'));
  assert('identity has multilingual RAG ability', idSrc.includes('Multilingual RAG with Persian'));
  assert('identity has Persian knowledge brain ability', idSrc.includes('مغز دانش همه‌جانبه چندرشته‌ای'));
  assert('identity has Persian routing ability', idSrc.includes('مسیریابی دانش تخصصی'));
  assert('identity has multidisciplinary rule', idSrc.includes('I have multidisciplinary knowledge'));
  assert('identity has knowledge packs rule', idSrc.includes('I use specialized knowledge packs'));
  assert('identity has request missing rule', idSrc.includes('I can request missing knowledge'));
  assert('identity has Persian multidisciplinary rule', idSrc.includes('دانش همه‌جانبه در حوزه‌های متعدد'));
  assert('identity has Persian knowledge packs rule', idSrc.includes('بسته‌های دانش تخصصی'));
  assert('identity has Persian request missing rule', idSrc.includes('درخواست نصب آن را بدهم'));

  // Runtime identity check
  const { getNexIdentityManager } = await import('../../src/main/ai/nex-identity-manager');
  const identity = getNexIdentityManager().getIdentity();
  assert('identity has Phase 60 ability', identity.abilities.some((a: string) => a.includes('Universal multidisciplinary')));
  assert('identity has multidisciplinary rule', identity.rules.some((r: string) => r.includes('multidisciplinary knowledge')));

  // ═══════════════════════════════════════════════════════════════════════
  // 11) IPC + Preload + Types
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n11) IPC + Preload + Types:');
  const mainSrc = read('../../src/main/main.ts');
  assert('main has Phase 60 block', mainSrc.includes('Phase 60: Universal Knowledge Brain'));
  assert('main imports UniversalKnowledgeBrain', mainSrc.includes("import('./knowledge/universal-knowledge-brain')"));
  assert('main imports universal-knowledge-catalog', mainSrc.includes("import('./knowledge/universal-knowledge-catalog')"));

  const ipcChannels = [
    'universal-knowledge-domains', 'universal-knowledge-packs', 'universal-knowledge-packs-by-domain',
    'universal-knowledge-route', 'universal-knowledge-search', 'universal-knowledge-graph',
    'universal-knowledge-status', 'universal-knowledge-detect-domain', 'universal-knowledge-security-audit',
  ];
  for (const ch of ipcChannels) {
    assert(`main registers ipc handler '${ch}'`, mainSrc.includes(`ipcMain.handle('${ch}'`));
  }

  // Preload
  const preloadSrc = read('../../src/main/preload.ts');
  assert('preload has Phase 60 section', preloadSrc.includes('Phase 60: Universal Knowledge'));
  const preloadMethods = [
    'universalKnowledgeDomains', 'universalKnowledgePacks', 'universalKnowledgePacksByDomain',
    'universalKnowledgeRoute', 'universalKnowledgeSearch', 'universalKnowledgeGraph',
    'universalKnowledgeStatus', 'universalKnowledgeDetectDomain', 'universalKnowledgeSecurityAudit',
  ];
  for (const m of preloadMethods) {
    assert(`preload exposes '${m}'`, preloadSrc.includes(`${m}:`));
  }

  // Types
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('types has Phase 60 section', typesSrc.includes('Phase 60: Universal Knowledge'));
  for (const m of preloadMethods) {
    assert(`types declares '${m}'`, typesSrc.includes(`${m}:`));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 12) UI Panel + Navigation
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n12) UI Panel + Navigation:');
  const panelSrc = read('../../src/renderer/components/UniversalKnowledgePanel.tsx');
  assert('UniversalKnowledgePanel exists', panelSrc.length > 0);
  assert('panel default export', panelSrc.includes('export default function UniversalKnowledgePanel'));
  assert('panel has tabs (domains/search/graph/status)', panelSrc.includes("'domains'") && panelSrc.includes("'search'") && panelSrc.includes("'graph'") && panelSrc.includes("'status'"));
  assert('panel calls universalKnowledgeDomains', panelSrc.includes('universalKnowledgeDomains'));
  assert('panel calls universalKnowledgePacks', panelSrc.includes('universalKnowledgePacks'));
  assert('panel calls universalKnowledgeStatus', panelSrc.includes('universalKnowledgeStatus'));
  assert('panel calls universalKnowledgeRoute', panelSrc.includes('universalKnowledgeRoute'));
  assert('panel calls universalKnowledgeSearch', panelSrc.includes('universalKnowledgeSearch'));
  assert('panel calls universalKnowledgeGraph', panelSrc.includes('universalKnowledgeGraph'));
  assert('panel shows domains', panelSrc.includes('domains'));
  assert('panel shows route result', panelSrc.includes('routeResult'));
  assert('panel shows search result', panelSrc.includes('searchResult'));
  assert('panel shows graph result', panelSrc.includes('graphResult'));
  assert('panel has security note', panelSrc.includes('اجازه') || panelSrc.includes('PermissionGate') || panelSrc.includes('permission'));

  const navSrc = read('../../src/renderer/components/layout/NavigationRail.tsx');
  assert('nav has uknowledge view', navSrc.includes("'uknowledge'"));
  assert('nav has Globe icon', navSrc.includes('Globe'));
  assert('nav has Univ. Knowledge label', navSrc.includes("label: 'Univ. Knowledge'"));

  const appShellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
  assert('AppShell imports UniversalKnowledgePanel', appShellSrc.includes('UniversalKnowledgePanel'));
  assert('AppShell routes uknowledge view', appShellSrc.includes("case 'uknowledge'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 13) Security
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n13) Security:');
  const brainSec = verifyUniversalKnowledgeSecurity();
  assert('brain security audit passes', brainSec.ok === true);
  assert('catalog security audit passes', verifyCatSec().ok === true);

  // No cloud imports
  assert('catalog source no fetch()', !catSrc.includes('fetch('));
  assert('brain source no fetch()', !brainSrc.includes('fetch('));
  assert('catalog source no XMLHttpRequest', !catSrc.includes('XMLHttpRequest'));
  assert('brain source no XMLHttpRequest', !brainSrc.includes('XMLHttpRequest'));

  // No download/install/delete methods
  assert('brain no async download() method', !brainSrc.includes('async download('));
  assert('brain no async install() method', !brainSrc.includes('async install('));
  assert('brain no async delete() method', !brainSrc.includes('async delete('));

  // The brain only ROUTES and RETRIEVES — never executes models
  assert('brain never calls runtime.loadModel', !brainSrc.includes('runtime.loadModel'));
  assert('brain never imports inference', !brainSrc.includes("from '../inference'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 14) Phase 51-59 Preserved (Regression)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n14) Phase 51-59 Preserved:');
  assert('Phase 55 expert-knowledge-engine exists', fs.existsSync(path.join(__dirname, '../../src/main/knowledge/expert-knowledge-engine.ts')));
  assert('Phase 55 knowledge-pack-manager exists', fs.existsSync(path.join(__dirname, '../../src/main/knowledge/knowledge-pack-manager.ts')));
  assert('Phase 53 nex-expert-system exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-expert-system.ts')));
  assert('Phase 53 expert-router exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/expert-router.ts')));
  assert('Phase 57 nex-executive-planner exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-executive-planner.ts')));
  assert('Phase 58 multi-model-runtime-manager exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/multi-model-runtime-manager.ts')));
  assert('Phase 58 local-model-provider exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/local-model-provider.ts')));
  assert('Phase 59 model-ecosystem-manager exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-intelligence/model-ecosystem-manager.ts')));
  assert('Phase 59 model-profiles exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-intelligence/model-profiles.ts')));
  assert('Phase 59 ModelEcosystemPanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/ModelEcosystemPanel.tsx')));
  assert('Phase 58 LocalRuntimePanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/LocalRuntimePanel.tsx')));
  assert('Phase 57 PlannerPanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/PlannerPanel.tsx')));
  assert('Phase 55 ExpertKnowledgePanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/ExpertKnowledgePanel.tsx')));

  // Existing subsystems still work
  const { getExpertKnowledgeEngine } = await import('../../src/main/knowledge/expert-knowledge-engine');
  assert('Phase 55 engine singleton still works', typeof getExpertKnowledgeEngine === 'function');
  const { getExpertRouter } = await import('../../src/main/ai/expert-router');
  assert('Phase 53 router singleton still works', typeof getExpertRouter === 'function');
  const { getExpertProfiles } = await import('../../src/main/ai/nex-expert-system');
  assert('expert profiles still 6', getExpertProfiles().length === 6);
  const { getNexExecutivePlanner } = await import('../../src/main/ai/nex-executive-planner');
  assert('Phase 57 planner singleton still works', typeof getNexExecutivePlanner === 'function');
  const { getMultiModelRuntimeManager } = await import('../../src/main/ai/multi-model-runtime-manager');
  assert('Phase 58 runtime manager singleton still works', typeof getMultiModelRuntimeManager === 'function');
  const { getModelEcosystemManager } = await import('../../src/main/ai/model-intelligence/model-ecosystem-manager');
  assert('Phase 59 ecosystem manager singleton still works', typeof getModelEcosystemManager === 'function');

  // Phase 55 engine's 12 packs still intact
  const { EXPERT_KNOWLEDGE_PACKS } = await import('../../src/main/knowledge/expert-knowledge-engine');
  assert('Phase 55 engine still has 12 packs', EXPERT_KNOWLEDGE_PACKS.length === 12);

  // ═══════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 60 UNIVERSAL KNOWLEDGE RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('FAILURES:', failures.join(' | '));
    process.exit(1);
  }
  console.log('PHASE 60 UNIVERSAL KNOWLEDGE BRAIN EXPANSION: ALL PASS ✅');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
