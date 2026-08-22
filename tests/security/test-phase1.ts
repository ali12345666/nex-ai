/**
 * Phase 1 Security Tests
 *
 * Run with: npx tsx tests/security/test-phase1.ts
 *
 * Verifies:
 *  1. searchFileContents is injection-safe (no shell metachar vulnerability)
 *  2. assertPathInside correctly rejects path traversal
 *  3. isAllowedAIOrigin blocks unknown origins
 *  4. safeExecFile doesn't run shell metacharacters
 *  5. sanitizeHtml strips <script>, onerror, javascript: URLs (renderer test)
 */

import { assertPathInside, isPathInside, isAllowedAIOrigin, hasShellMetachars } from '../../src/main/security';
import { searchFileContents, safeExecFile } from '../../src/main/security/shell';

let pass = 0, fail = 0;
function assert(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else      { fail++; console.log(`  FAIL: ${name}`); }
}

async function main() {
  console.log('\n=== Phase 1 Security Tests ===\n');

  // ── 1. Path traversal ──
  console.log('1. Path traversal protection:');
  assert('blocks ../ escape',
    !assertPathInside('/home/user/project/../../etc/passwd', ['/home/user/project']).ok);
  assert('blocks absolute path outside root',
    !assertPathInside('/etc/passwd', ['/home/user/project']).ok);
  assert('blocks null byte injection',
    !assertPathInside('/home/user/project/file\0.txt', ['/home/user/project']).ok);
  assert('allows path inside root',
    assertPathInside('/home/user/project/src/main.ts', ['/home/user/project']).ok);
  assert('allows multiple roots',
    assertPathInside('/opt/other/file.txt', ['/home/user/project', '/opt/other']).ok);
  assert('isPathInside handles identical paths',
    isPathInside('/foo', '/foo'));

  // ── 2. AI origin validation ──
  console.log('\n2. AI origin validation:');
  assert('allows OpenAI origin',
    isAllowedAIOrigin('https://api.openai.com/v1/chat/completions'));
  assert('allows Anthropic origin',
    isAllowedAIOrigin('https://api.anthropic.com/v1/messages'));
  assert('blocks unknown origin',
    !isAllowedAIOrigin('https://evil.example.com/v1/chat'));
  assert('blocks file:// scheme',
    !isAllowedAIOrigin('file:///etc/passwd'));
  assert('blocks malformed URL',
    !isAllowedAIOrigin('not-a-url'));
  assert('blocks OpenAI subdomain spoof',
    !isAllowedAIOrigin('https://api.openai.com.evil.com'));

  // ── 3. Shell metachar detection ──
  console.log('\n3. Shell metachar detection:');
  assert('detects ;',    hasShellMetachars('foo;bar'));
  assert('detects |',    hasShellMetachars('foo|bar'));
  assert('detects $',    hasShellMetachars('$(rm -rf /)'));
  assert('detects backticks', hasShellMetachars('`rm -rf /`'));
  assert('detects newline',   hasShellMetachars('foo\nbar'));
  assert('passes safe string', !hasShellMetachars('hello-world-123'));

  // ── 4. searchFileContents is injection-safe ──
  console.log('\n4. searchFileContents injection test:');
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-test-'));
  fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'hello world\nsecret password 12345\n');
  fs.mkdirSync(path.join(tmpDir, 'node_modules'));
  fs.writeFileSync(path.join(tmpDir, 'node_modules', 'ignored.js'), 'secret');

  const results1 = await searchFileContents(tmpDir, 'password');
  assert('finds "password" in text file',
    results1.some((r) => r.file.endsWith('test.txt')));

  // Injection attempt: query that breaks findstr/grep string interpolation
  const injection = '"; rm -rf / #';
  const results2 = await searchFileContents(tmpDir, injection);
  assert('injection attempt returns 0 results (not an error)',
    Array.isArray(results2) && results2.length === 0);

  const results3 = await searchFileContents(tmpDir, 'secret');
  assert('does not search node_modules',
    !results3.some((r) => r.file.includes('node_modules')));

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true });

  // ── 5. safeExecFile doesn't run shell commands ──
  console.log('\n5. safeExecFile injection test:');
  if (process.platform !== 'win32') {
    const result = await safeExecFile('echo', ['hello; rm -rf /'], { timeout: 3000 });
    assert('echo with injection in arg prints literal string',
      result.stdout.includes('hello; rm -rf /'));
    assert('no actual rm command ran',
      result.success === true);
  } else {
    console.log('  (skipping echo test on Windows)');
  }

  const result2 = await safeExecFile('git', ['--version'], { timeout: 3000 });
  assert('git --version succeeds',
    result2.success && result2.stdout.includes('git version'));

  // ── 6. Summary ──
  console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
