/**
 * Phase 72 — Test Connection test
 *
 * Verifies the Test Connection logic works by testing 3 hosts:
 *   1. huggingface.co
 *   2. us.aws.cdn.hf.co
 *   3. modelscope.cn (alternative source)
 */
import * as https from 'https';
import { URL } from 'url';

const testHost = (url: string, timeoutMs = 10000): Promise<any> => {
  return new Promise((resolve) => {
    const start = Date.now();
    let u: URL;
    try { u = new URL(url); } catch { return resolve({ url, reachable: false, error: 'invalid URL' }); }
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'HEAD',
      timeout: timeoutMs,
    }, (res) => {
      res.resume();
      resolve({ url, host: u.hostname, reachable: res.statusCode !== undefined, statusCode: res.statusCode, latencyMs: Date.now() - start });
    });
    req.on('error', (err: any) => resolve({ url, host: u.hostname, reachable: false, error: err.code || err.message, latencyMs: Date.now() - start }));
    req.on('timeout', () => { req.destroy(); resolve({ url, host: u.hostname, reachable: false, error: 'TIMEOUT', latencyMs: Date.now() - start }); });
    req.end();
  });
};

async function main() {
  console.log('Testing 3 hosts...\n');
  const results = await Promise.all([
    testHost('https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf'),
    testHost('https://us.aws.cdn.hf.co'),
    testHost('https://modelscope.cn/api/v1/models/Qwen/Qwen2.5-0.5B-Instruct-GGUF/repo?Revision=master&FilePath=qwen2.5-0.5b-instruct-q4_k_m.gguf'),
  ]);

  console.log('huggingface.co:');
  console.log('  reachable:', results[0].reachable, '— status:', results[0].statusCode, '— latency:', results[0].latencyMs + 'ms');
  console.log('us.aws.cdn.hf.co:');
  console.log('  reachable:', results[1].reachable, '— status:', results[1].statusCode, '— error:', results[1].error || '(none)', '— latency:', results[1].latencyMs + 'ms');
  console.log('modelscope.cn:');
  console.log('  reachable:', results[2].reachable, '— status:', results[2].statusCode, '— latency:', results[2].latencyMs + 'ms');

  // Recommendation
  if (!results[1].reachable && results[2].reachable) {
    console.log('\nRECOMMENDATION: CDN blocked — use ModelScope alternative source');
  } else if (results[0].reachable && results[1].reachable) {
    console.log('\nRECOMMENDATION: All hosts reachable — HuggingFace should work');
  } else {
    console.log('\nRECOMMENDATION: Partial connectivity');
  }
}

main().catch(console.error);
