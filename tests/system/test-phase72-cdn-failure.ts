/**
 * Phase 72 — CDN Failure Detection + Alternative Source Tests
 *
 * Verifies:
 *   1. CDN failure classification (ECONNRESET/ETIMEDOUT on known CDN hosts)
 *   2. isKnownCdnHost function
 *   3. isCdnConnectionFailure function
 *   4. classifyDownloadError returns 'cdn-connection-failure' for CDN hosts
 *   5. CDN failures are non-transient (no infinite retry)
 *   6. DownloadResult includes errorClassification/cdnHost/hasAlternativeSource
 *   7. RECOMMENDED_FIRST_MODEL_ALTERNATIVE exists (ModelScope URL)
 *   8. KNOWN_CDN_HOSTS includes us.aws.cdn.hf.co
 *   9. Test Connection IPC handler registered
 *  10. Alternative source IPC handlers registered
 *  11. Preload exposes test connection + alternative source
 *  12. Type declarations include new IPC methods
 *  13. UI has Test Connection button
 *  14. UI has alternative source button (shown on CDN failure)
 *  15. UI shows CDN-specific error message
 *  16. failDownload stores CDN fields
 *  17. No security disabled (TLS still on, no infinite retry)
 *
 * Run: npx tsx tests/system/test-phase72-cdn-failure.ts
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

  // ═══════════════════════════════════════════════════════════════════════
  // 1) CDN failure classification
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) CDN failure classification:');
  const sdSrc = read('../../src/main/update/secure-downloader.ts');

  assert('DownloadErrorInfo has cdn-connection-failure classification', sdSrc.includes("'cdn-connection-failure'"));
  assert('DownloadErrorInfo has cdnHost field', sdSrc.includes('cdnHost?: string'));
  assert('DownloadErrorInfo has hasAlternativeSource field', sdSrc.includes('hasAlternativeSource?: boolean'));
  assert('KNOWN_CDN_HOSTS includes us.aws.cdn.hf.co', sdSrc.includes("'us.aws.cdn.hf.co'"));
  assert('KNOWN_CDN_HOSTS includes cas-server.xethub.hf.co', sdSrc.includes("'cas-server.xethub.hf.co'"));
  assert('isKnownCdnHost function exists', sdSrc.includes('export function isKnownCdnHost'));
  assert('isCdnConnectionFailure function exists', sdSrc.includes('export function isCdnConnectionFailure'));
  assert('isCdnConnectionFailure checks ECONNRESET', sdSrc.includes("code.includes('ECONNRESET')"));
  assert('isCdnConnectionFailure checks ETIMEDOUT', sdSrc.includes("code.includes('ETIMEDOUT')"));
  assert('isCdnConnectionFailure checks socket hang up', sdSrc.includes("message.includes('socket hang up')"));
  assert('classifyDownloadError accepts host param', sdSrc.includes('classifyDownloadError(err: any, hasPartialFile: boolean, host?: string)'));
  assert('classifyDownloadError checks CDN failure first', sdSrc.includes("if (host && isCdnConnectionFailure(err, host))"));
  assert('CDN failure is non-transient', sdSrc.includes("isTransient: false,  // CDN blocks are typically persistent"));
  assert('CDN failure message mentions Hugging Face CDN', sdSrc.includes('Hugging Face CDN connection failed'));
  assert('CDN failure message mentions blocked/reset', sdSrc.includes('blocked/reset'));
  assert('CDN failure message does NOT claim model unavailable', !sdSrc.includes('model is unavailable') && !sdSrc.includes('Model is unavailable'));
  assert('DownloadResult has errorClassification', sdSrc.includes('errorClassification?: string'));
  assert('DownloadResult has cdnHost', sdSrc.includes('cdnHost?: string'));
  assert('DownloadResult has hasAlternativeSource', sdSrc.includes('hasAlternativeSource?: boolean'));
  assert('final failure logs CDN_HOST', sdSrc.includes('console.log(`  CDN_HOST=${errInfo.cdnHost}`)'));
  assert('final failure logs SUGGESTION for alternative', sdSrc.includes('SUGGESTION: Use ModelScope'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Alternative source (ModelScope)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Alternative source (ModelScope):');
  const wizSrc = read('../../src/main/ai/first-run-wizard.ts');

  assert('RECOMMENDED_FIRST_MODEL_ALTERNATIVE exists', wizSrc.includes('RECOMMENDED_FIRST_MODEL_ALTERNATIVE'));
  assert('Alternative uses ModelScope URL', wizSrc.includes('modelscope.cn'));
  assert('Alternative URL points to Qwen GGUF', wizSrc.includes('Qwen2.5-0.5B-Instruct-GGUF/repo'));
  assert('Alternative mentions ModelScope in reason', wizSrc.includes('ModelScope'));
  assert('KNOWN_CDN_HOSTS exported', wizSrc.includes('export const KNOWN_CDN_HOSTS'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) Behavioral: isKnownCdnHost + isCdnConnectionFailure
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Behavioral: isKnownCdnHost + isCdnConnectionFailure:');
  const { isKnownCdnHost, isCdnConnectionFailure, classifyDownloadError } = await import('../../src/main/update/secure-downloader');

  assert('isKnownCdnHost(us.aws.cdn.hf.co) = true', isKnownCdnHost('us.aws.cdn.hf.co') === true);
  assert('isKnownCdnHost(cas-server.xethub.hf.co) = true', isKnownCdnHost('cas-server.xethub.hf.co') === true);
  assert('isKnownCdnHost(huggingface.co) = false', isKnownCdnHost('huggingface.co') === false);
  assert('isKnownCdnHost(modelscope.cn) = false', isKnownCdnHost('modelscope.cn') === false);

  // ECONNRESET on CDN host = CDN failure
  assert('isCdnConnectionFailure(ECONNRESET, us.aws.cdn.hf.co) = true',
    isCdnConnectionFailure({ code: 'ECONNRESET', message: 'socket hang up' }, 'us.aws.cdn.hf.co') === true);
  // ECONNRESET on non-CDN host = NOT CDN failure
  assert('isCdnConnectionFailure(ECONNRESET, huggingface.co) = false',
    isCdnConnectionFailure({ code: 'ECONNRESET', message: 'socket hang up' }, 'huggingface.co') === false);
  // Non-network error on CDN host = NOT CDN failure
  assert('isCdnConnectionFailure(EACCES, us.aws.cdn.hf.co) = false',
    isCdnConnectionFailure({ code: 'EACCES', message: 'permission denied' }, 'us.aws.cdn.hf.co') === false);

  // classifyDownloadError returns CDN failure classification
  const cdnErr = classifyDownloadError({ code: 'ECONNRESET', message: 'socket hang up' }, false, 'us.aws.cdn.hf.co');
  assert('classifyDownloadError returns cdn-connection-failure for CDN host',
    cdnErr.classification === 'cdn-connection-failure');
  assert('CDN failure isTransient = false', cdnErr.isTransient === false);
  assert('CDN failure has cdnHost', cdnErr.cdnHost === 'us.aws.cdn.hf.co');
  assert('CDN failure hasAlternativeSource = true', cdnErr.hasAlternativeSource === true);
  assert('CDN failure message includes host name', cdnErr.userMessage.includes('us.aws.cdn.hf.co'));

  // classifyDownloadError without host = generic transient (backward compat)
  const genericErr = classifyDownloadError({ code: 'ECONNRESET', message: 'socket hang up' }, false);
  assert('classifyDownloadError without host = network-interrupted (not CDN)',
    genericErr.classification === 'network-interrupted');
  assert('Generic ECONNRESET isTransient = true', genericErr.isTransient === true);

  // ═══════════════════════════════════════════════════════════════════════
  // 4) IPC handlers registered
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) IPC handlers registered:');
  const mainSrc = read('../../src/main/main.ts');

  assert('download-test-connection handler registered', mainSrc.includes("ipcMain.handle('download-test-connection'"));
  assert('download-get-alternative-model handler registered', mainSrc.includes("ipcMain.handle('download-get-alternative-model'"));
  assert('download-start-alternative handler registered', mainSrc.includes("ipcMain.handle('download-start-alternative'"));
  assert('test-connection tests huggingface.co', mainSrc.includes('testHost(RECOMMENDED_FIRST_MODEL.downloadUrl)'));
  assert('test-connection tests us.aws.cdn.hf.co', mainSrc.includes("testHost('https://us.aws.cdn.hf.co')"));
  assert('test-connection tests modelscope.cn', mainSrc.includes('testHost(RECOMMENDED_FIRST_MODEL_ALTERNATIVE.downloadUrl)'));
  assert('test-connection recommends alternative when CDN blocked', mainSrc.includes("'CDN blocked — use ModelScope alternative source'"));
  assert('download-start-alternative requests permission first', mainSrc.includes('await requestDownloadPermission(RECOMMENDED_FIRST_MODEL_ALTERNATIVE.downloadUrl'));
  assert('download-start-alternative uses permissionPreApproved', mainSrc.includes('permissionPreApproved: true'));
  assert('main.ts stores errorClassification from result', mainSrc.includes('errorClassification: result.errorClassification'));
  assert('main.ts stores cdnHost from result', mainSrc.includes('cdnHost: result.cdnHost'));
  assert('main.ts stores hasAlternativeSource from result', mainSrc.includes('hasAlternativeSource: result.hasAlternativeSource'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Preload + type declarations
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Preload + type declarations:');
  const preloadSrc = read('../../src/main/preload.ts');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');

  assert('preload exposes downloadTestConnection', preloadSrc.includes('downloadTestConnection:') && preloadSrc.includes("ipcRenderer.invoke('download-test-connection'"));
  assert('preload exposes downloadGetAlternativeModel', preloadSrc.includes('downloadGetAlternativeModel:') && preloadSrc.includes("ipcRenderer.invoke('download-get-alternative-model'"));
  assert('preload exposes downloadStartAlternative', preloadSrc.includes('downloadStartAlternative:') && preloadSrc.includes("ipcRenderer.invoke('download-start-alternative'"));
  assert('types: downloadTestConnection declared', typesSrc.includes('downloadTestConnection: () => Promise'));
  assert('types: downloadGetAlternativeModel declared', typesSrc.includes('downloadGetAlternativeModel: () => Promise'));
  assert('types: downloadStartAlternative declared', typesSrc.includes('downloadStartAlternative: () => Promise'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) UI: Test Connection + Alternative Source
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) UI: Test Connection + Alternative Source:');
  const libSrc = read('../../src/renderer/components/NexLibraryPanel.tsx');
  const storeSrc = read('../../src/renderer/store/download-store.ts');

  assert('UI has handleTestConnection function', libSrc.includes('const handleTestConnection'));
  assert('UI has handleInstallAlternative function', libSrc.includes('const handleInstallAlternative'));
  assert('UI has connectionTest state', libSrc.includes('connectionTest'));
  assert('UI has testingConnection state', libSrc.includes('testingConnection'));
  assert('UI has Test Connection button', libSrc.includes('تست اتصال به HuggingFace و CDN'));
  assert('UI shows huggingface.co result', libSrc.includes('huggingface.co:'));
  assert('UI shows us.aws.cdn.hf.co result', libSrc.includes('us.aws.cdn.hf.co:'));
  assert('UI shows modelscope.cn result', libSrc.includes('modelscope.cn:'));
  assert('UI shows recommendation', libSrc.includes('recommendation'));
  assert('UI shows alternative source button on CDN blocked', libSrc.includes("connectionTest?.recommendation?.includes('CDN blocked')"));
  assert('UI calls downloadStartAlternative', libSrc.includes('window.nexAPI.downloadStartAlternative()'));
  assert('UI shows CDN-specific toast', libSrc.includes("classification === 'cdn-connection-failure'"));
  assert('UI shows CDN warning on failed download', libSrc.includes('CDN هاگینگ‌فیس مسدود است'));
  assert('UI shows alternative button on CDN failure', libSrc.includes("dl.errorClassification === 'cdn-connection-failure'"));
  assert('UI does NOT claim model unavailable', !libSrc.includes('model is unavailable'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Download Store: CDN fields
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Download Store: CDN fields:');
  assert('DownloadEntry has errorClassification', storeSrc.includes('errorClassification?: string'));
  assert('DownloadEntry has cdnHost', storeSrc.includes('cdnHost?: string'));
  assert('DownloadEntry has hasAlternativeSource', storeSrc.includes('hasAlternativeSource?: boolean'));
  assert('failDownload accepts classification', storeSrc.includes('classification?: string'));
  assert('failDownload accepts cdnHost', storeSrc.includes('cdnHost?: string'));
  assert('failDownload accepts hasAlternativeSource', storeSrc.includes('hasAlternativeSource?: boolean'));
  assert('failDownload stores errorClassification', storeSrc.includes('errorClassification: details?.classification'));
  assert('failDownload stores cdnHost', storeSrc.includes('cdnHost: details?.cdnHost'));
  assert('failDownload stores hasAlternativeSource', storeSrc.includes('hasAlternativeSource: details?.hasAlternativeSource'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Security: no shortcuts
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Security: no shortcuts:');
  assert('NO maxRetries increased to 20', !sdSrc.includes('maxRetries ?? 20'));
  assert('NO maxRetries = Infinity', !sdSrc.includes('Infinity'));
  assert('NO ignore ECONNRESET', !sdSrc.includes('ignoreECONNRESET') && !sdSrc.includes("ignore 'ECONNRESET'"));
  assert('NO rejectUnauthorized: false', !sdSrc.includes('rejectUnauthorized: false'));
  assert('NO NODE_TLS_REJECT_UNAUTHORIZED', !sdSrc.includes('NODE_TLS_REJECT_UNAUTHORIZED'));
  assert('NO fake progress', !sdSrc.includes('fakeProgress') && !sdSrc.includes('fake progress'));
  assert('CDN failure is non-transient (stops retry)', sdSrc.includes('isTransient: false,  // CDN blocks are typically persistent'));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Diagnostic scripts exist
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Diagnostic scripts exist:');
  assert('test-connection.ts exists', fs.existsSync(path.join(__dirname, '../../diagnostics/test-connection.ts')));
  assert('test-modelscope-download.ts exists', fs.existsSync(path.join(__dirname, '../../diagnostics/test-modelscope-download.ts')));

  const tcSrc = read('../../diagnostics/test-connection.ts');
  assert('test-connection tests 3 hosts', tcSrc.includes('huggingface.co') && tcSrc.includes('us.aws.cdn.hf.co') && tcSrc.includes('modelscope.cn'));
  assert('test-connection gives recommendation', tcSrc.includes('RECOMMENDATION'));

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 72 Tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
