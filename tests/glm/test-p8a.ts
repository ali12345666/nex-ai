/**
 * Phase 8 / P8-A — GLM 5.3 Provider Integration Tests
 *
 * Pure unit tests (no Electron, no network) covering:
 *   1. Endpoint normalization (glmEndpointUrl)
 *   2. Request building — key safety, model, params (buildGlmRequest)
 *   3. Response parsing — success / error envelope / malformed (parseGlmResponse)
 *   4. Security: origin allowlist accepts GLM endpoints, rejects unknowns
 *   5. Routing layer: ProviderType includes 'glm'; provider config selection
 *      (mirrors renderer logic without importing electron-bound modules)
 *
 * Run: npx tsx tests/glm/test-p8a.ts
 */

import {
  GLM_DEFAULT_ENDPOINT,
  GLM_CN_ENDPOINT,
  GLM_DEFAULT_MODEL,
  glmEndpointUrl,
  buildGlmRequest,
  buildGlmRequestForEndpoint,
  parseGlmResponse,
  isGlmModel,
} from '../../src/main/ai/glm';
import { isAllowedAIOrigin, ALLOWED_AI_ORIGINS } from '../../src/main/security';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

// ─── 1. Endpoint normalization ──────────────────────────────────────────────
console.log('\n1. glmEndpointUrl normalization:');
assert('bare origin → full path', glmEndpointUrl('https://api.z.ai') === 'https://api.z.ai/api/paas/v4/chat/completions');
assert('trailing slash stripped', glmEndpointUrl('https://api.z.ai/') === 'https://api.z.ai/api/paas/v4/chat/completions');
assert('v4 prefix not doubled', glmEndpointUrl('https://api.z.ai/api/paas/v4') === 'https://api.z.ai/api/paas/v4/chat/completions');
assert('full URL unchanged', glmEndpointUrl('https://api.z.ai/api/paas/v4/chat/completions') === 'https://api.z.ai/api/paas/v4/chat/completions');
assert('CN endpoint normalized', glmEndpointUrl(GLM_CN_ENDPOINT) === 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
assert('empty/undefined → default', glmEndpointUrl(undefined) === glmEndpointUrl(GLM_DEFAULT_ENDPOINT));
assert('whitespace endpoint → default', glmEndpointUrl('   ') === glmEndpointUrl(GLM_DEFAULT_ENDPOINT));

// ─── 2. Request building ────────────────────────────────────────────────────
console.log('\n2. buildGlmRequest:');
const msgs = [
  { role: 'system' as const, content: 'You are NEX AI.' },
  { role: 'user' as const, content: 'Write a function' },
];
const plan = buildGlmRequest('test-key-123', msgs, { model: 'glm-5.3', maxTokens: 1024, temperature: 0.2 });
const body = JSON.parse(plan.body);

assert('model defaults to glm-5.3', body.model === 'glm-5.3');
assert('GLM_DEFAULT_MODEL constant', GLM_DEFAULT_MODEL === 'glm-5.3');
assert('messages passed through in order', Array.isArray(body.messages) && body.messages.length === 2 && body.messages[0].role === 'system');
assert('maxTokens applied', body.max_tokens === 1024);
assert('temperature applied', body.temperature === 0.2);
assert('default maxTokens is 4096', JSON.parse(buildGlmRequest('k', msgs).body).max_tokens === 4096);
assert('Authorization header carries key', plan.headers.Authorization === 'Bearer test-key-123');
assert('API key NEVER in body', !plan.body.includes('test-key-123'));
assert('API key NEVER in URL', !plan.url.includes('test-key-123'));
assert('Content-Type json', plan.headers['Content-Type'] === 'application/json');

const planCN = buildGlmRequestForEndpoint(GLM_CN_ENDPOINT, 'k', msgs);
assert('custom endpoint builder targets CN', planCN.url.startsWith('https://open.bigmodel.cn/api/paas/v4/chat/completions'));

// ─── 3. Response parsing ────────────────────────────────────────────────────
console.log('\n3. parseGlmResponse:');
const ok = parseGlmResponse(JSON.stringify({
  choices: [{ message: { role: 'assistant', content: 'Here is your function' } }],
  usage: { total_tokens: 42 },
}));
assert('success parsed', ok.success === true);
assert('content extracted', ok.content === 'Here is your function');
assert('tokens extracted', ok.tokens === 42);

const errEnvelope = parseGlmResponse(JSON.stringify({ error: { message: 'invalid api key' } }));
assert('error envelope → success:false', errEnvelope.success === false);
assert('error message surfaced', (errEnvelope.error || '').includes('invalid api key'));

const badJson = parseGlmResponse('not-json{{{');
assert('malformed JSON → graceful failure', badJson.success === false && /not valid JSON/.test(badJson.error || ''));

const badShape = parseGlmResponse(JSON.stringify({ unexpected: true }));
assert('wrong shape → graceful failure', badShape.success === false);

const noUsage = parseGlmResponse(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }));
assert('missing usage tolerated', noUsage.success === true && noUsage.tokens === undefined);

// ─── 4. Security: origin allowlist ──────────────────────────────────────────
console.log('\n4. Origin allowlist (security layer):');
assert('api.z.ai allowed', isAllowedAIOrigin('https://api.z.ai/api/paas/v4/chat/completions'));
assert('open.bigmodel.cn allowed', isAllowedAIOrigin('https://open.bigmodel.cn/api/paas/v4/chat/completions'));
assert('openai still allowed (no regression)', isAllowedAIOrigin('https://api.openai.com/v1/chat/completions'));
assert('anthropic still allowed (no regression)', isAllowedAIOrigin('https://api.anthropic.com/v1/messages'));
assert('evil lookalike blocked', !isAllowedAIOrigin('https://api.z.ai.evil.com/api/paas/v4/chat/completions'));
assert('http (non-tls) blocked', !isAllowedAIOrigin('http://api.z.ai/api/paas/v4/chat/completions'));
assert('localhost blocked', !isAllowedAIOrigin('http://localhost:9999/x'));
assert('allowlist size is exactly 4', ALLOWED_AI_ORIGINS.size === 4);

// ─── 5. Routing layer contract ──────────────────────────────────────────────
console.log('\n5. Provider abstraction contract:');
// provider.ts imports electron transitively via ai-service (net), so we verify
// the source contract statically instead of importing it.
import * as fs from 'fs';
import * as path from 'path';
const providerSrc = fs.readFileSync(path.join(__dirname, '../../src/main/ai/provider.ts'), 'utf-8');
const agentDir = path.join(__dirname, '../../src/main/agent');
const agentFiles = fs.readdirSync(agentDir).filter((f) => f.endsWith('.ts'));

assert("ProviderType includes 'glm'", /export type ProviderType = 'local' \| 'openai' \| 'claude' \| 'glm'/.test(providerSrc));
assert("routeChat message mentions GLM", /GLM \(Z\.ai\/BigModel\)/.test(providerSrc));
assert('ARCHITECTURE: agent core has ZERO direct GLM imports', (() => {
  let violation = '';
  for (const f of agentFiles) {
    const src = fs.readFileSync(path.join(agentDir, f), 'utf-8');
    if (/from ['"].*ai\/glm|import.*glm/i.test(src)) { violation = f; break; }
  }
  return violation === '';
})(), 'agent/ must not import ai/glm directly');
assert('ARCHITECTURE: agent core has ZERO direct ai-service imports', (() => {
  let violation = '';
  for (const f of agentFiles) {
    const src = fs.readFileSync(path.join(agentDir, f), 'utf-8');
    if (/from ['"]\.\.\/ai-service['"]/.test(src)) { violation = f; break; }
  }
  return violation === '';
})(), 'agent/ must not import ai-service directly');

// ai-service must route glm provider
const aiServiceSrc = fs.readFileSync(path.join(__dirname, '../../src/main/ai-service.ts'), 'utf-8');
assert("ai-service routes 'glm' → callGLM", /config\.provider === 'glm'/.test(aiServiceSrc));
assert('ai-service reuses pure glm helpers', /buildGlmRequestForEndpoint, parseGlmResponse/.test(aiServiceSrc));

// isGlmModel sanity
assert('isGlmModel(glm-5.3) true', isGlmModel('glm-5.3'));
assert('isGlmModel(gpt-4o) false', !isGlmModel('gpt-4o'));

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`P8-A RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('ALL GLM 5.3 P8-A TESTS PASS ✅');
