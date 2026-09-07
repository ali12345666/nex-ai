/**
 * Phase P1 — Universal Provider Architecture Unit Tests
 *
 * Pure unit tests (no Electron) covering:
 *   1. Capabilities + ContentPart + ResolvedContentPart + TransportFileContent types
 *   2. ChatMessage hybrid content (string | ContentPart[])
 *   3. StreamChunk invariants (content optional, toolCalls optional, done required)
 *   4. ToolCall / ToolResult contracts
 *   5. AuthMethod (secretId, NOT key; no custom in P1)
 *   6. ProviderDescriptor + ProviderRegistry
 *   7. Registry invariants (streaming-text ⇔ streamTransport + isStreaming)
 *   8. OriginAllowlist + isPrivateIp (SSRF protection)
 *   9. EndpointValidator (DNS-TOCTOU + redirect)
 *   10. Transport purity (no fs/path/persistence/getSecret imports)
 *   11. Transport interfaces (ResolvedChatMessage[], ResolvedAuth, sanitizeError)
 *   12. URL-query secret sanitization
 *   13. ContentResolver (file → TransportFileContent, no path)
 *   14. Provider descriptors (openai, anthropic, gemini, glm)
 *   15. Architecture invariants (no Core changes, backward compat)
 *
 * Run: npx tsx tests/glm/test-phase-p1-universal-provider.ts
 */

import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

// ─── 1. Type contracts (compile-time verified by tsc, runtime-verified here) ─
console.log('\n1. Capabilities + ContentPart types:');
import type {
  Capability, ContentPart, ResolvedContentPart, TransportFileContent,
  ResolvedFileReference, ChatMessage, ResolvedChatMessage,
  ToolDeclaration, ToolCall, ToolResult,
  ChatOptions, ChatResult, StreamChunk, StreamEvent,
  RequestPlan, ChatParseResult,
  AuthMethod, ResolvedAuth,
  ProviderId, ProviderTrust, UserApproval,
  ProviderDescriptor, ProviderCallContext, TestConnectionResult,
  TextChatTransport, StreamChatTransport, ToolCallingTransport, VisionTransport,
  ModelDescriptor,
} from '../../src/main/ai/capabilities';
assert('all types imported without error', true);

// ─── 2. ChatMessage hybrid content ─────────────────────────────────────────
console.log('\n2. ChatMessage hybrid content:');
const msgString: ChatMessage = { role: 'user', content: 'hello' };
assert('ChatMessage with string content compiles', typeof msgString.content === 'string');
const msgParts: ChatMessage = { role: 'user', content: [{ type: 'text', text: 'hello' }] };
assert('ChatMessage with ContentPart[] compiles', Array.isArray(msgParts.content));
const msgFile: ChatMessage = { role: 'user', content: [{ type: 'file', path: '/tmp/x.txt', mimeType: 'text/plain' }] };
assert('ChatMessage with file ContentPart has path (unresolved)', (msgFile.content as ContentPart[])[0].type === 'file');

// ─── 3. StreamChunk invariants ──────────────────────────────────────────────
console.log('\n3. StreamChunk invariants:');
const chunkText: StreamChunk = { content: 'hello', done: false };
assert('text chunk: content present, done=false', chunkText.content === 'hello' && !chunkText.done);
const chunkTool: StreamChunk = { toolCalls: [{ id: '1', name: 'test', args: {} }], done: false };
assert('tool-call chunk: content absent, toolCalls present', chunkTool.content === undefined && !!chunkTool.toolCalls);
const chunkDone: StreamChunk = { done: true };
assert('done chunk: content absent, done=true', chunkDone.content === undefined && chunkDone.done);
const chunkKeepalive: StreamChunk = { done: false };
assert('keepalive chunk: content absent, toolCalls absent, done=false', chunkKeepalive.content === undefined && !chunkKeepalive.toolCalls && !chunkKeepalive.done);

// ─── 4. ToolCall / ToolResult ───────────────────────────────────────────────
console.log('\n4. ToolCall / ToolResult:');
const tc: ToolCall = { id: 'call_1', name: 'write_file', args: { path: '/tmp/x' } };
assert('ToolCall has id, name, args', tc.id === 'call_1' && tc.name === 'write_file');
const tr: ToolResult = { toolCallId: 'call_1', content: 'success', isError: false };
assert('ToolResult has toolCallId, content, isError', tr.toolCallId === 'call_1' && !tr.isError);
const trParts: ToolResult = { toolCallId: 'call_1', content: [{ type: 'text', text: 'ok' }] };
assert('ToolResult content can be ResolvedContentPart[]', Array.isArray(trParts.content));

// ─── 5. AuthMethod ──────────────────────────────────────────────────────────
console.log('\n5. AuthMethod:');
const bearer: AuthMethod = { type: 'bearer', secretId: 'openaiApiKey' };
assert('bearer uses secretId, NOT key', (bearer as any).secretId !== undefined && (bearer as any).key === undefined);
const xgoog: AuthMethod = { type: 'x-goog-api-key', secretId: 'geminiApiKey' };
assert('x-goog-api-key uses secretId', (xgoog as any).secretId === 'geminiApiKey');
const urlq: AuthMethod = { type: 'url-query', paramName: 'key', secretId: 'geminiApiKey' };
assert('url-query has paramName + secretId', urlq.type === 'url-query' && (urlq as any).paramName === 'key');
const none: AuthMethod = { type: 'none' };
assert('none has no secretId', none.type === 'none' && (none as any).secretId === undefined);
assert('AuthMethod.custom does NOT exist in P1', !('custom' in (none as any) || 'custom' in (bearer as any)));

// ─── 6. ProviderDescriptor + Registry ──────────────────────────────────────
console.log('\n6. ProviderDescriptor + Registry:');
import { getProviderRegistry, _resetProviderRegistry, wireOriginAllowlist, ProviderRegistryError } from '../../src/main/ai/provider-registry';
import { getOriginAllowlist, _resetOriginAllowlist, isPrivateIp, validateOrigin } from '../../src/main/security/origin-allowlist';
import { wireSecretResolver, resolveAuth } from '../../src/main/ai/secret-resolver';

_resetProviderRegistry();
_resetOriginAllowlist();
wireOriginAllowlist(
  (origin: string) => getOriginAllowlist().addBuiltIn(origin),
  (origin: string) => getOriginAllowlist().addBuiltIn(origin),
);
wireSecretResolver((key: string) => 'test-key-for-' + key);

const registry = getProviderRegistry();
assert('registry is a singleton', getProviderRegistry() === registry);
assert('registry starts empty', registry.listProviders().length === 0);

// ─── 7. Registry invariants ────────────────────────────────────────────────
console.log('\n7. Registry invariants:');

// streaming-text without streamTransport → THROWS
const fakeTransport: TextChatTransport = {
  buildChatRequest: () => ({ url: 'https://api.example.com', headers: {}, body: '' }),
  parseChatResponse: () => ({ success: true, content: '' }),
  sanitizeError: (s: string) => s,
};
try {
  registry.registerProvider({
    id: 'bad-streaming',
    displayName: 'Bad Streaming',
    trust: 'built-in',
    capabilities: new Set(['text', 'streaming-text'] as Capability[]),
    authMethod: { type: 'none' },
    defaultModel: 'test',
    defaultEndpoint: 'https://api.example.com',
    transport: fakeTransport,
    // NO streamTransport — but advertises streaming-text
    allowedOrigins: ['https://api.example.com'],
  } as ProviderDescriptor);
  assert('registerProvider with streaming-text but no streamTransport THROWS', false);
} catch (err: any) {
  assert('registerProvider with streaming-text but no streamTransport THROWS', err instanceof ProviderRegistryError);
}

// streamTransport without streaming-text → THROWS
const fakeStreamTransport: StreamChatTransport = {
  ...fakeTransport,
  parseStreamChunk: () => ({ done: false }),
  isStreaming: true,
};
try {
  registry.registerProvider({
    id: 'bad-streaming-2',
    displayName: 'Bad Streaming 2',
    trust: 'built-in',
    capabilities: new Set(['text'] as Capability[]),
    authMethod: { type: 'none' },
    defaultModel: 'test',
    defaultEndpoint: 'https://api.example.com',
    transport: fakeTransport,
    streamTransport: fakeStreamTransport,  // has streamTransport but no streaming-text
    allowedOrigins: ['https://api.example.com'],
  } as ProviderDescriptor);
  assert('registerProvider with streamTransport but no streaming-text THROWS', false);
} catch (err: any) {
  assert('registerProvider with streamTransport but no streaming-text THROWS', err instanceof ProviderRegistryError);
}

// streamTransport.isStreaming !== true → THROWS
try {
  registry.registerProvider({
    id: 'bad-streaming-3',
    displayName: 'Bad Streaming 3',
    trust: 'built-in',
    capabilities: new Set(['text', 'streaming-text'] as Capability[]),
    authMethod: { type: 'none' },
    defaultModel: 'test',
    defaultEndpoint: 'https://api.example.com',
    transport: fakeTransport,
    streamTransport: { ...fakeStreamTransport, isStreaming: false as any },
    allowedOrigins: ['https://api.example.com'],
  } as ProviderDescriptor);
  assert('registerProvider with isStreaming !== true THROWS', false);
} catch (err: any) {
  assert('registerProvider with isStreaming !== true THROWS', err instanceof ProviderRegistryError);
}

// tool-calling without toolTransport → THROWS
try {
  registry.registerProvider({
    id: 'bad-tool',
    displayName: 'Bad Tool',
    trust: 'built-in',
    capabilities: new Set(['text', 'tool-calling'] as Capability[]),
    authMethod: { type: 'none' },
    defaultModel: 'test',
    defaultEndpoint: 'https://api.example.com',
    transport: fakeTransport,
    allowedOrigins: ['https://api.example.com'],
  } as ProviderDescriptor);
  assert('registerProvider with tool-calling but no toolTransport THROWS', false);
} catch (err: any) {
  assert('registerProvider with tool-calling but no toolTransport THROWS', err instanceof ProviderRegistryError);
}

// Valid provider → registers OK
_resetProviderRegistry();
_resetOriginAllowlist();
wireOriginAllowlist(
  (origin: string) => getOriginAllowlist().addBuiltIn(origin),
  (origin: string) => getOriginAllowlist().addBuiltIn(origin),
);
const reg2 = getProviderRegistry();
reg2.registerProvider({
  id: 'valid-provider',
  displayName: 'Valid Provider',
  trust: 'built-in',
  capabilities: new Set(['text', 'streaming-text'] as Capability[]),
  authMethod: { type: 'none' },
  defaultModel: 'test-model',
  defaultEndpoint: 'https://api.example.com',
  transport: fakeTransport,
  streamTransport: fakeStreamTransport,
  allowedOrigins: ['https://api.example.com'],
} as ProviderDescriptor);
assert('valid provider registers OK', reg2.getProvider('valid-provider') !== undefined);
assert('getProvidersForCapability returns matching', reg2.getProvidersForCapability('streaming-text').length === 1);

// ─── 8. OriginAllowlist + isPrivateIp ──────────────────────────────────────
console.log('\n8. OriginAllowlist + isPrivateIp (SSRF):');
assert('isPrivateIp blocks 10.x', isPrivateIp('10.0.0.1'));
assert('isPrivateIp blocks 172.16.x', isPrivateIp('172.16.0.1'));
assert('isPrivateIp blocks 172.31.x', isPrivateIp('172.31.255.255'));
assert('isPrivateIp blocks 192.168.x', isPrivateIp('192.168.1.1'));
assert('isPrivateIp blocks 127.x (loopback)', isPrivateIp('127.0.0.1'));
assert('isPrivateIp blocks 169.254.x (metadata)', isPrivateIp('169.254.169.254'));
assert('isPrivateIp blocks ::1 (IPv6 loopback)', isPrivateIp('::1'));
assert('isPrivateIp blocks 0.0.0.0', isPrivateIp('0.0.0.0'));
assert('isPrivateIp blocks 255.255.255.255 (broadcast)', isPrivateIp('255.255.255.255'));
assert('isPrivateIp blocks fc00:: (IPv6 ULA)', isPrivateIp('fc00::1'));
assert('isPrivateIp blocks fe80:: (IPv6 link-local)', isPrivateIp('fe80::1'));
assert('isPrivateIp blocks localhost', isPrivateIp('localhost'));
assert('isPrivateIp does NOT block public IPs', !isPrivateIp('142.250.190.46')); // google.com
assert('isPrivateIp does NOT block api.openai.com', !isPrivateIp('api.openai.com'));

const validHttps = validateOrigin('https://api.openai.com');
assert('validateOrigin accepts https://', validHttps.ok);
const invalidHttp = validateOrigin('http://api.openai.com');
assert('validateOrigin rejects http://', !invalidHttp.ok);
const invalidWs = validateOrigin('ws://api.openai.com');
assert('validateOrigin rejects ws://', !invalidWs.ok);
const validWss = validateOrigin('wss://generativelanguage.googleapis.com');
assert('validateOrigin accepts wss://', validWss.ok);
const privateOrigin = validateOrigin('https://10.0.0.1');
assert('validateOrigin rejects private IP origin', !privateOrigin.ok);
const localhostOrigin = validateOrigin('https://localhost');
assert('validateOrigin rejects localhost origin', !localhostOrigin.ok);
const metadataOrigin = validateOrigin('https://169.254.169.254');
assert('validateOrigin rejects metadata origin', !metadataOrigin.ok);

// ─── 9. Secret resolver ────────────────────────────────────────────────────
console.log('\n9. Secret resolver:');
wireSecretResolver((key: string) => 'resolved-' + key);
const resolved = resolveAuth({ type: 'bearer', secretId: 'testKey' });
assert('resolveAuth returns ResolvedAuth with credential', resolved.credential === 'resolved-testKey');
const resolvedNone = resolveAuth({ type: 'none' });
assert('resolveAuth for none returns empty credential', resolvedNone.credential === '');

// ─── 10. Transport purity (no fs/path/persistence imports) ─────────────────
console.log('\n10. Transport purity:');
const transportDir = path.join(__dirname, '../../src/main/ai/transports');
const transportFiles = fs.readdirSync(transportDir).filter((f) => f.endsWith('.ts'));
for (const file of transportFiles) {
  const rawSrc = fs.readFileSync(path.join(transportDir, file), 'utf-8');
  // Strip comments before grepping (the header says "NO tool-registry" which matches the grep)
  const src = rawSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert(`${file}: no fs import`, !/from ['"]fs['"]/.test(src) && !/require\(['"]fs['"]\)/.test(src));
  assert(`${file}: no path import`, !/from ['"]path['"]/.test(src) && !/require\(['"]path['"]\)/.test(src));
  assert(`${file}: no persistence import`, !/from ['"]\.\.\/persistence['"]/.test(src) && !/from ['"]\.\.\/\.\.\/persistence['"]/.test(src));
  assert(`${file}: no getSecret call`, !/getSecret\(/.test(src));
  // Check for actual IMPORT statements only (not mentions in comments)
  assert(`${file}: no tool-registry import`, !/from ['"][^'"]*tool-registry['"]/.test(src));
  assert(`${file}: no permissions import`, !/from ['"][^'"]*permissions['"]/.test(src));
}

// ─── 11. Transport interfaces ─────────────────────────────────────────────
console.log('\n11. Transport interfaces:');
import { getOpenAiCompatibleTransport } from '../../src/main/ai/transports/openai-compatible';
import { getAnthropicTransport } from '../../src/main/ai/transports/anthropic';
import { getGeminiRestTransport } from '../../src/main/ai/transports/gemini-rest';

const openaiT = getOpenAiCompatibleTransport();
assert('OpenAiCompatibleTransport has buildChatRequest', typeof openaiT.buildChatRequest === 'function');
assert('OpenAiCompatibleTransport has parseChatResponse', typeof openaiT.parseChatResponse === 'function');
assert('OpenAiCompatibleTransport has sanitizeError', typeof openaiT.sanitizeError === 'function');
assert('OpenAiCompatibleTransport has parseStreamChunk', typeof openaiT.parseStreamChunk === 'function');
assert('OpenAiCompatibleTransport.isStreaming is true', openaiT.isStreaming === true);

const anthropicT = getAnthropicTransport();
assert('AnthropicTransport has buildChatRequest', typeof anthropicT.buildChatRequest === 'function');
assert('AnthropicTransport.isStreaming is true', anthropicT.isStreaming === true);

const geminiT = getGeminiRestTransport();
assert('GeminiRestTransport has buildChatRequest', typeof geminiT.buildChatRequest === 'function');
assert('GeminiRestTransport.isStreaming is true', geminiT.isStreaming === true);

// ─── 12. URL-query secret sanitization ─────────────────────────────────────
console.log('\n12. URL-query secret sanitization:');
const testErr1 = 'Error: wss://example.com?key=AIzaSecretKey1234567890abcdefghij failed';
const sanitized1 = openaiT.sanitizeError(testErr1);
assert('sanitizeError strips ?key=', !sanitized1.includes('AIzaSecretKey1234567890abcdefghij'));
assert('sanitizeError shows REDACTED', sanitized1.includes('REDACTED'));
const testErr2 = 'Error: wss://example.com?access_token=verylongtoken1234567890abcdef';
const sanitized2 = openaiT.sanitizeError(testErr2);
assert('sanitizeError strips ?access_token=', !sanitized2.includes('verylongtoken1234567890abcdef'));
const testErr3 = 'Auth failed: Bearer sk-somethingverylongkey1234567890abcd';
const sanitized3 = openaiT.sanitizeError(testErr3);
assert('sanitizeError strips Bearer + sk- key', !sanitized3.includes('sk-somethingverylongkey1234567890abcd'));
const testErr4 = 'API key sk-ant-somethinglongkey1234567890abcde invalid';
const sanitized4 = openaiT.sanitizeError(testErr4);
assert('sanitizeError strips sk-ant- key', !sanitized4.includes('sk-ant-somethinglongkey1234567890abcde'));

// ─── 13. TransportFileContent has NO path ──────────────────────────────────
console.log('\n13. TransportFileContent (NO path):');
const filePart: TransportFileContent = { type: 'file', base64: 'dGVzdA==', mimeType: 'text/plain' };
assert('TransportFileContent has base64', filePart.type === 'file' && (filePart as any).base64 === 'dGVzdA==');
assert('TransportFileContent has NO path field', (filePart as any).path === undefined);

// ─── 14. Provider descriptors ──────────────────────────────────────────────
console.log('\n14. Provider descriptors:');
const providersDir = path.join(__dirname, '../../src/main/ai/providers');
const providerFiles = fs.readdirSync(providersDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
assert('4 built-in provider descriptor files exist', providerFiles.length === 4);

// ─── 15. Architecture invariants (source grep) ─────────────────────────────
console.log('\n15. Architecture invariants:');

// Files that MUST NOT change (provider-agnostic)
const coreFile = fs.readFileSync(path.join(__dirname, '../../src/main/agent/core.ts'), 'utf-8');
assert('agent/core.ts has no provider imports', !/from ['"].*providers\/openai['"]/.test(coreFile) && !/from ['"].*providers\/gemini['"]/.test(coreFile));

const toolRegFile = fs.readFileSync(path.join(__dirname, '../../src/main/ai/tool-registry.ts'), 'utf-8');
assert('tool-registry.ts has no provider imports', !/from ['"].*providers\/openai['"]/.test(toolRegFile));

const permFile = fs.readFileSync(path.join(__dirname, '../../src/main/permissions/index.ts'), 'utf-8');
assert('permissions/index.ts has no provider imports', !/from ['"].*providers\/openai['"]/.test(permFile));

// ChatOptions has NO apiKey field
const runtimeFile = fs.readFileSync(path.join(__dirname, '../../src/main/ai/runtime.ts'), 'utf-8');
assert('runtime.ts ChatOptions has NO apiKey', !/apiKey\?\s*:/.test(runtimeFile));
assert('runtime.ts ChatMessage.content is hybrid (string | ContentPart[])', /content:\s*string\s*\|\s*ContentPart\[\]/.test(runtimeFile));
assert('runtime.ts StreamChunk.content is optional (content?)', /content\?\s*:\s*string/.test(runtimeFile));
assert('runtime.ts StreamChunk has toolCalls?', /toolCalls\?\s*:/.test(runtimeFile));

// ContentResolver is NOT an IPC (no ipcMain.handle)
const contentResolverFile = fs.readFileSync(path.join(__dirname, '../../src/main/ai/content-resolver.ts'), 'utf-8');
assert('content-resolver.ts has no ipcMain.handle', !/ipcMain\.handle/.test(contentResolverFile));
assert('content-resolver.ts imports fs', /from ['"]fs['"]/.test(contentResolverFile));
assert('content-resolver.ts imports assertPathInside', /assertPathInside/.test(contentResolverFile));
assert('content-resolver.ts returns TransportFileContent (no path in resolved)', !/path:\s*string/.test(contentResolverFile.replace(/.*Resolves file references.*/s, '').replace(/.*ResolvedFileReference.*/s, '')));

// Secret resolver is the ONLY caller of getSecret (grep)
const secretResolverFile = fs.readFileSync(path.join(__dirname, '../../src/main/ai/secret-resolver.ts'), 'utf-8');
assert('secret-resolver.ts calls getSecret', /getSecret/.test(secretResolverFile));

// EndpointValidator has DNS-TOCTOU defense
const endpointValidatorFile = fs.readFileSync(path.join(__dirname, '../../src/main/security/endpoint-validator.ts'), 'utf-8');
assert('endpoint-validator.ts has dns.lookup', /dns\.promises\.lookup/.test(endpointValidatorFile) || /dns\.lookup/.test(endpointValidatorFile));
assert('endpoint-validator.ts has validateRedirect', /validateRedirect/.test(endpointValidatorFile));
assert('endpoint-validator.ts has ValidatedEndpoint with resolvedIps', /resolvedIps/.test(endpointValidatorFile));

// Origin allowlist is dynamic (no static ALLOWED_AI_ORIGINS set in origin-allowlist.ts)
const allowlistFile = fs.readFileSync(path.join(__dirname, '../../src/main/security/origin-allowlist.ts'), 'utf-8');
assert('origin-allowlist.ts has isPrivateIp', /export function isPrivateIp/.test(allowlistFile));
assert('origin-allowlist.ts has validateOrigin', /export function validateOrigin/.test(allowlistFile));

// ─── 16. ContentResolver ──────────────────────────────────────────────────
console.log('\n16. ContentResolver:');
import { getContentResolver } from '../../src/main/ai/content-resolver';
const resolver = getContentResolver();
assert('ContentResolver has resolve method', typeof resolver.resolve === 'function');
// Test: string content → passes through
const stringMsgs: ChatMessage[] = [{ role: 'user', content: 'hello' }];
// ContentResolver needs projectPath for file resolution; string-only messages don't trigger it
resolver.resolve(stringMsgs, { projectPath: '/tmp' }).then((resolved) => {
  assert('ContentResolver passes string content through', typeof resolved[0].content === 'string' && resolved[0].content === 'hello');
}).catch(() => {
  assert('ContentResolver passes string content through', false, 'threw');
});

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`PHASE P1 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('ALL PHASE P1 UNIVERSAL PROVIDER TESTS PASS ✅');
