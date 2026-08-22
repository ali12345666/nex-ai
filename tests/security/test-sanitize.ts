/**
 * Phase 1 Sanitizer Tests (browser-side)
 *
 * Run with: npx tsx tests/security/test-sanitize.ts
 *
 * Verifies that sanitizeHtml strips:
 *  - <script> tags
 *  - onerror / onload event handlers
 *  - javascript: URLs
 *  - <iframe>, <object>, <embed> tags
 *  - HTML comments
 *  - non-allowed attributes
 */

// Use jsdom to provide a real browser-like DOM with proper HTML parsing
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as any).document = dom.window.document;
(globalThis as any).DOMParser = dom.window.DOMParser;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).Element = dom.window.Element;

// Use require for sync import in CJS mode
const { sanitizeHtml } = require('../../src/renderer/lib/sanitize');

let pass = 0, fail = 0;
function assert(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else      { fail++; console.log(`  FAIL: ${name}`); }
}

function test(name: string, input: string, mustNotContain: string[], mustContain: string[] = []) {
  const out = sanitizeHtml(input);
  const lowerOut = out.toLowerCase();
  for (const bad of mustNotContain) {
    if (lowerOut.includes(bad.toLowerCase())) {
      assert(`${name} (must not contain "${bad}") — got: ${out}`, false);
      return;
    }
  }
  for (const good of mustContain) {
    if (!lowerOut.includes(good.toLowerCase())) {
      assert(`${name} (must contain "${good}") — got: ${out}`, false);
      return;
    }
  }
  assert(name, true);
}

console.log('\n=== Phase 1 HTML Sanitizer Tests ===\n');

// 1. Script stripping
test('strips <script> tag',
  '<p>hello</p><script>alert(1)</script>',
  ['<script', 'alert(1)'], ['<p>hello</p>']);

test('strips <script src=...>',
  '<p>x</p><script src="evil.js"></script>',
  ['script', 'evil.js']);

test('strips <img onerror>',
  '<img src=x onerror=alert(1)>',
  ['onerror', 'alert']);

test('strips <a href=javascript:>',
  '<a href="javascript:alert(1)">click</a>',
  ['javascript:']);

test('strips <iframe>',
  '<iframe src="evil.com"></iframe>',
  ['iframe']);

test('strips <object>',
  '<object data="evil.swf"></object>',
  ['object']);

test('strips inline style attribute',
  '<p style="background:url(javascript:alert(1))">x</p>',
  ['style=', 'javascript:']);

test('strips onclick handler',
  '<button onclick="alert(1)">x</button>',
  ['onclick', 'alert']);

test('strips HTML comments',
  '<p>x</p><!-- secret comment -->',
  ['secret comment']);

// 2. Allowed tags pass through
test('keeps <p>',
  '<p>hello</p>',
  [], ['<p>hello</p>']);

test('keeps <strong>',
  '<strong>bold</strong>',
  [], ['<strong>bold</strong>']);

test('keeps <code>',
  '<code>const x = 1</code>',
  [], ['<code>const x = 1</code>']);

test('keeps <pre>',
  '<pre>line1\nline2</pre>',
  [], ['<pre>']);

// 3. <a> href validation
test('keeps http <a>',
  '<a href="https://example.com">link</a>',
  [], ['<a href="https://example.com"']);

test('keeps mailto <a>',
  '<a href="mailto:x@y.com">mail</a>',
  [], ['mailto:x@y.com']);

test('keeps relative <a>',
  '<a href="/page">link</a>',
  [], ['href="/page"']);

test('strips javascript: from <a>',
  '<a href="javascript:alert(1)">x</a>',
  ['javascript:']);

console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===\n`);
if (fail > 0) process.exit(1);
