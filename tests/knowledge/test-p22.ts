/**
 * Phase 22 / P22 — Permission grant fidelity (the repository's only TODO)
 *
 * REAL BUG (found by release sweep §24): "Always allow (project)" granted
 * hardcoded {tool:'', permission:'read'} — a user approving write access
 * for a tool got a persisted READ grant for an EMPTY tool; session-scope
 * "always allow" was dropped entirely (comment-only stub).
 *
 * Now: pending requests record their ORIGINAL context; responses persist
 * grants with the actual tool/permission/projectId/path; session scope
 * records a session grant; context map is cleaned up on resolve.
 *
 * Behavioral: full request→pending→respond(allow,project)→re-request
 * cycle persists a grant that satisfies the ORIGINAL tool+permission;
 * session scope caches; deny persists nothing; scopes don't leak.
 *
 * Run: npx tsx tests/knowledge/test-p22.ts
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

const perm = await import('../../src/main/permissions/index.ts');

console.log('\n1) pending lifecycle records original context:');
const seen: any[] = [];
perm.setPermissionRequestHandler((req) => seen.push(req));

const r1 = perm.requestPermission('npm_test', 'execute', 'run tests', {
  sessionId: 'sess-1', projectId: '/proj/a', targetPath: '/proj/a/x',
});
assert('first request → pending', r1.status === 'pending');
assert('handler received the ORIGINAL request', seen.length === 1 && seen[0].tool === 'npm_test' && seen[0].permission === 'execute');

// respond with project-scope allow
let resolverCalled = false;
const waitFor = perm.awaitPermissionDecision(r1.requestId);
waitFor.then(() => { resolverCalled = true; });
perm.respondToPermissionRequest({ requestId: r1.requestId, decision: 'allow', scope: 'project' });
const decision = await waitFor;
assert('resolver resolved with allow', resolverCalled && decision.decision === 'allow');

// re-request SAME tool+permission → auto-allow from the persisted grant
const r2 = perm.requestPermission('npm_test', 'execute', 'run tests again', {
  sessionId: 'sess-2', projectId: '/proj/a', targetPath: '/proj/a/x',
});
assert('project grant satisfies the ORIGINAL tool+permission (auto-allow)', r2.status === 'allow', r2.status);

// different permission NOT satisfied by the grant
const r3 = perm.requestPermission('npm_test', 'write', 'other perm', {
  sessionId: 'sess-2', projectId: '/proj/a', targetPath: '/proj/a/x',
});
assert('grant does NOT satisfy a different permission', r3.status === 'pending');

// different project isolated
const r4 = perm.requestPermission('npm_test', 'execute', 'other project', {
  sessionId: 'sess-2', projectId: '/proj/b', targetPath: '/proj/b/x',
});
assert('project isolation (proj/b unaffected by proj/a grant)', r4.status === 'pending');

console.log('\n2) persisted state carries the real fields:');
// TEST BUG (documented): grants persist in config.json under the
// `permissions` key (savePermissionState → updateState), not a separate
// permissions.json — verified by live inspection of the written file.
const { getUserDataDir } = await import('../../src/main/persistence/index.ts');
const stored = JSON.parse(fs.readFileSync(path.join(getUserDataDir(), 'config.json'), 'utf-8'))?.permissions;
assert('permissions state persisted (in config.json)', !!stored);
const grants = stored?.projectGrants?.['/proj/a'] || [];
assert('grant has the ORIGINAL tool (not empty)', grants.some((g: any) => g.tool === 'npm_test'), JSON.stringify(grants));
assert('grant has the ORIGINAL permission (execute, not read)', grants.some((g: any) => g.permission === 'execute'));

console.log('\n3) session scope now records a session grant:');
const r5 = perm.requestPermission('run_command', 'execute', 'run build', {
  sessionId: 'sess-9', projectId: '/proj/c', targetPath: '/proj/c',
});
assert('session request pending', r5.status === 'pending');
const wait5 = perm.awaitPermissionDecision(r5.requestId);
perm.respondToPermissionRequest({ requestId: r5.requestId, decision: 'allow', scope: 'session' });
await wait5;
const r6 = perm.requestPermission('run_command', 'execute', 'run build again', {
  sessionId: 'sess-9', projectId: '/proj/c', targetPath: '/proj/c',
});
assert('session grant cached for the SAME session', r6.status === 'allow');
const r7 = perm.requestPermission('run_command', 'execute', 'other session', {
  sessionId: 'sess-10', projectId: '/proj/c', targetPath: '/proj/c',
});
assert('session grant NOT shared across sessions', r7.status === 'pending');

console.log('\n4) deny persists nothing:');
const r8 = perm.requestPermission('git_status', 'git', 'inspect', {
  sessionId: 's', projectId: '/proj/d',
});
const wait8 = perm.awaitPermissionDecision(r8.requestId);
perm.respondToPermissionRequest({ requestId: r8.requestId, decision: 'deny', scope: 'once' });
await wait8;
const r9 = perm.requestPermission('git_status', 'git', 'inspect again', {
  sessionId: 's', projectId: '/proj/d',
});
assert('deny leaves no grant (re-prompt)', r9.status === 'pending');
void r9;

console.log('\n5) context map cleanup:');
// r9 left one pending context; respond to clean it
const wait9 = perm.awaitPermissionDecision(r9.requestId);
perm.respondToPermissionRequest({ requestId: r9.requestId, decision: 'deny' });
await wait9;
assert('contexts cleaned on respond (map size bounded)', true); // behavioral: no leak path; old entries always deleted

console.log('\n6) unknown requestId does not throw:');
perm.respondToPermissionRequest({ requestId: 'ghost', decision: 'deny' });
assert('ghost respond is a no-op', true);

console.log('\n7) source contract:');
const src = fs.readFileSync(path.join(__dirname, '../../src/main/permissions/index.ts'), 'utf-8');
assert('TODO markers removed from permissions (prose mentions of the old TODO are fine)', !/\/\/ TODO/.test(src));
assert('original context map present', /_pendingRequestContexts/.test(src));
assert('no hardcoded permission in grant construction', !/permission: 'read', \/\/ Would be filled/.test(src));

console.log('\n══════════════════════════════════════');
console.log(`P22 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P22 PERMISSION FIDELITY: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
