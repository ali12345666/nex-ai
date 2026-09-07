/**
 * Phase O / O4 — Gemini Settings + Test Connection Tests
 *
 * Pure unit tests (no Electron, no network) covering:
 *   1. buildGeminiPingRequest — URL, headers, body shape
 *   2. API key placement security — key in header ONLY, never in body, never in URL query
 *   3. Minimal ping body — single user turn, maxOutputTokens=1, temperature=0
 *   4. Settings UI wiring — 'gemini' option in provider dropdown (source grep)
 *   5. IPC wiring — gemini-test-connection in main.ts, preload, electron.d.ts (source grep)
 *   6. No API key in config.json — geminiApiKey NOT persisted to settings (source grep)
 *   7. Security: ALLOWED_AI_ORIGINS includes generativelanguage.googleapis.com
 *
 * Run: npx tsx tests/glm/test-phase-o4-gemini.ts
 */

import {
  GEMINI_DEFAULT_ENDPOINT,
  GEMINI_DEFAULT_MODEL,
  GEMINI_MODELS,
  geminiEndpointUrl,
  buildGeminiPingRequest,
  parseGeminiResponse,
} from '../../src/main/ai/gemini';
import { isAllowedAIOrigin, ALLOWED_AI_ORIGINS } from '../../src/main/security';
import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

// ─── 1. buildGeminiPingRequest — URL, headers, body shape ──────────────────
console.log('\n1. buildGeminiPingRequest shape:');
const plan = buildGeminiPingRequest(undefined, 'AIzaTestKeyFakeForUnitTesting123', 'gemini-2.0-flash');
assert('returns URL ending in :generateContent', plan.url.endsWith(':generateContent'));
assert('URL includes the model name', plan.url.includes('gemini-2.0-flash'));
assert('URL uses default endpoint when undefined', plan.url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/'));
assert('Content-Type header is application/json', plan.headers['Content-Type'] === 'application/json');
assert('API key is in x-goog-api-key header', plan.headers['x-goog-api-key'] === 'AIzaTestKeyFakeForUnitTesting123');
assert('no Authorization header (Gemini uses x-goog-api-key, NOT Bearer)', !plan.headers['Authorization']);
assert('body is valid JSON', (() => { try { JSON.parse(plan.body); return true; } catch { return false; } })());

const body = JSON.parse(plan.body);
assert('body has contents array', Array.isArray(body.contents));
assert('body has exactly 1 content entry', body.contents.length === 1);
assert('content[0].role is user', body.contents[0].role === 'user');
assert('content[0].parts is array', Array.isArray(body.contents[0].parts));
assert('content[0].parts[0].text is ping', body.contents[0].parts[0].text === 'ping');
assert('body has generationConfig', typeof body.generationConfig === 'object');
assert('generationConfig.maxOutputTokens is 1 (minimal ping)', body.generationConfig.maxOutputTokens === 1);
assert('generationConfig.temperature is 0 (deterministic)', body.generationConfig.temperature === 0);

// ─── 2. API key placement security ──────────────────────────────────────────
console.log('\n2. API key placement security:');
const TEST_KEY = 'AIzaSyAFAKEKEYFORUNITTEST1234567890ab';
const securePlan = buildGeminiPingRequest(undefined, TEST_KEY, 'gemini-2.0-flash');
assert('API key in x-goog-api-key header', securePlan.headers['x-goog-api-key'] === TEST_KEY);
assert('API key NEVER in body', !securePlan.body.includes(TEST_KEY));
assert('API key NEVER in URL query string', !securePlan.url.includes(`key=${TEST_KEY}`));
assert('API key NEVER in URL path', !securePlan.url.includes(TEST_KEY));

// ─── 3. Custom endpoint support ─────────────────────────────────────────────
console.log('\n3. Custom endpoint:');
const customPlan = buildGeminiPingRequest('https://generativelanguage.googleapis.com', 'k', 'gemini-1.5-pro');
assert('custom endpoint URL targets 1.5-pro', customPlan.url.includes('/v1beta/models/gemini-1.5-pro:generateContent'));
assert('custom endpoint URL starts with official host', customPlan.url.startsWith('https://generativelanguage.googleapis.com/'));

// ─── 4. parseGeminiResponse — success + error (reused by test-connection) ──
console.log('\n4. parseGeminiResponse (used by test-connection):');
const okResp = parseGeminiResponse(JSON.stringify({
  candidates: [{ content: { parts: [{ text: 'pong' }], role: 'model' }, finishReason: 'STOP' }],
  usageMetadata: { totalTokenCount: 5 },
}));
assert('success parsed', okResp.success === true);
assert('content extracted', okResp.content === 'pong');
assert('tokens extracted', okResp.tokens === 5);

const errResp = parseGeminiResponse(JSON.stringify({
  error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' },
}));
assert('error envelope → success:false', errResp.success === false);
assert('error message surfaces without the key', (errResp.error || '').includes('API key not valid'));

const badJson = parseGeminiResponse('not-json{{{');
assert('malformed JSON → graceful failure', badJson.success === false);

// ─── 5. Security: origin allowlist (defense-in-depth for test-connection) ──
console.log('\n5. Origin allowlist (Gemini):');
assert('generativelanguage.googleapis.com allowed', isAllowedAIOrigin('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'));
assert('evil lookalike blocked', !isAllowedAIOrigin('https://generativelanguage.googleapis.com.evil.com/v1beta/models/x:generateContent'));
assert('http (non-tls) blocked', !isAllowedAIOrigin('http://generativelanguage.googleapis.com/v1beta/models/x:generateContent'));
assert('localhost blocked', !isAllowedAIOrigin('http://localhost:9999/v1beta/models/x:generateContent'));
assert('allowlist size is exactly 5 (4 + Gemini)', ALLOWED_AI_ORIGINS.size === 5);
assert('GEMINI_DEFAULT_ENDPOINT constant', GEMINI_DEFAULT_ENDPOINT === 'https://generativelanguage.googleapis.com');
assert('GEMINI_DEFAULT_MODEL constant', GEMINI_DEFAULT_MODEL === 'gemini-2.0-flash');
assert('GEMINI_MODELS includes gemini-2.0-flash', (GEMINI_MODELS as readonly string[]).includes('gemini-2.0-flash'));
assert('geminiEndpointUrl builds official URL', geminiEndpointUrl(undefined, 'gemini-2.0-flash') === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent');

// ─── 6. Source-contract: IPC + UI wiring ────────────────────────────────────
console.log('\n6. Source-contract wiring:');

const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main/main.ts'), 'utf-8');
assert("main.ts registers 'gemini-test-connection' IPC", /ipcMain\.handle\(['"]gemini-test-connection['"]/.test(mainSrc));
assert('main.ts imports buildGeminiPingRequest', /buildGeminiPingRequest/.test(mainSrc));
assert('main.ts reads geminiApiKey from secure storage', /getSecret\(['"]geminiApiKey['"]\)/.test(mainSrc));
assert('main.ts NEVER logs the API key in test-connection', !/\[GEMINI_TEST\].*apiKey/.test(mainSrc) && !/\[GEMINI_TEST\].*x-goog-api-key.*[A-Za-z0-9]/.test(mainSrc));
assert('main.ts test-connection validates against allowlist', /isAllowedAIOrigin/.test(mainSrc));
assert('main.ts uses Electron net (not renderer fetch)', /net\.request/.test(mainSrc));

const preloadSrc = fs.readFileSync(path.join(__dirname, '../../src/main/preload.ts'), 'utf-8');
assert("preload.ts exposes geminiTestConnection", /geminiTestConnection:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]gemini-test-connection['"]\)/.test(preloadSrc));

const typesSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/types/electron.d.ts'), 'utf-8');
assert('electron.d.ts types geminiTestConnection return shape', /geminiTestConnection:\s*\(\)\s*=>\s*Promise<\{/.test(typesSrc) && /success:\s*boolean/.test(typesSrc) && /latencyMs\?:\s*number/.test(typesSrc));
assert('electron.d.ts types geminiTestConnection NEVER returns apiKey', !/geminiTestConnection[\s\S]*apiKey/.test(typesSrc));

const settingsSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/SettingsPanel.tsx'), 'utf-8');
assert("SettingsPanel has 'gemini' option in provider dropdown", /\{\s*value:\s*['"]gemini['"]\s*,\s*label:\s*['"]Google Gemini['"]\s*\}/.test(settingsSrc));
assert('SettingsPanel has Gemini API Key input (password)', /Gemini API Key/.test(settingsSrc) && /type=\{showGeminiKey \? 'text' : 'password'\}/.test(settingsSrc));
assert('SettingsPanel has Gemini model selector', /gemini-2\.0-flash/.test(settingsSrc) && /<Select[\s\S]*geminiModel/.test(settingsSrc));
assert('SettingsPanel has Gemini endpoint field', /geminiEndpoint/.test(settingsSrc) && /placeholder="https:\/\/generativelanguage\.googleapis\.com"/.test(settingsSrc));
assert('SettingsPanel has Test Connection button', /Test Connection/.test(settingsSrc) && /handleTestGemini/.test(settingsSrc));
assert('SettingsPanel passes localGeminiApiKey to settingsSave', /settingsSave\(localSettings,\s*localApiKey,\s*localGlmApiKey,\s*localGeminiApiKey\)/.test(settingsSrc));
assert('SettingsPanel test-connection calls IPC (not a fake local check)', /window\.nexAPI\.geminiTestConnection\(\)/.test(settingsSrc));
assert('SettingsPanel test result is bounded type (no raw key/headers)', /geminiTestResult/.test(settingsSrc) && !/geminiTestResult[\s\S]*apiKey/.test(settingsSrc));

// ─── 7. No API key in config.json ───────────────────────────────────────────
console.log('\n7. API key never in config.json:');
const persistenceSrc = fs.readFileSync(path.join(__dirname, '../../src/main/persistence/index.ts'), 'utf-8');
// The PersistedSettings interface (config.json schema) must NOT include
// geminiApiKey — the key goes to secrets.json via setSecret('geminiApiKey').
// Only geminiModel + geminiEndpoint (non-secret) are persisted.
assert('PersistedSettings has geminiModel (non-secret)', /geminiModel\?:\s*string/.test(persistenceSrc));
assert('PersistedSettings has geminiEndpoint (non-secret)', /geminiEndpoint\?:\s*string/.test(persistenceSrc));
assert('PersistedSettings does NOT have geminiApiKey field', !/^\s*geminiApiKey\??:\s*string/m.test(persistenceSrc));
assert('main.ts persists Gemini key via setSecret (encrypted secrets.json)', /setSecret\(['"]geminiApiKey['"]/.test(mainSrc));
assert('main.ts loads Gemini key via getSecret at test-connection time', /getSecret\(['"]geminiApiKey['"]\)/.test(mainSrc));

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`PHASE O4 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('ALL PHASE O4 GEMINI TESTS PASS ✅');
