/**
 * Phase 36 — CDP-based E2E test client
 * Connects to the REAL running Electron app via Chrome DevTools Protocol.
 * No mocking — tests the actual production app.
 *
 * Run: node tests/e2e/test-p36-cdp.js (after starting app with run-e2e.sh)
 */
const http = require('http');
const WebSocket = require('ws');

const CDP_PORT = 9222;

let ws = null;
let msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalInPage(expr) {
  const result = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: false,
  });
  if (result.exceptionDetails) {
    throw new Error(`Eval error: ${result.exceptionDetails.text}`);
  }
  return result.result.value;
}

let pass = 0, fail = 0;
const failures = [];
function assert(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function pressKey(key, opts = {}) {
  return evalInPage(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: ${JSON.stringify(key)}, bubbles: true, cancelable: true,
      ctrlKey: ${opts.ctrl || false}, metaKey: ${opts.meta || false},
    }));
    return true;
  })()`);
}

async function main() {
  // Get the page target from CDP
  const targets = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const page = targets.find((t) => t.type === 'page');
  if (!page) {
    console.error('FATAL: No page target found. Is the app running with --remote-debugging-port?');
    process.exit(1);
  }

  console.log(`Connected to: ${page.title || page.url}`);

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.on('open', resolve));

  console.log('\n═══ Phase 36 — REAL CDP E2E Tests ═══\n');

  // ═══ 1. Ctrl+K ═══
  console.log('\n1. Ctrl+K — Real UI:');

  const historyClosed = await evalInPage(`!document.querySelector('[role="dialog"][aria-label="Conversation history"]')`);
  assert('History initially closed', historyClosed === true);

  await pressKey('k', { ctrl: true });
  await new Promise((r) => setTimeout(r, 500));

  const historyOpen = await evalInPage(`!!document.querySelector('[role="dialog"][aria-label="Conversation history"]')`);
  assert('Ctrl+K opens History', historyOpen === true, 'History did not open');

  if (historyOpen) {
    const searchFocused = await evalInPage(`(() => {
      const s = document.querySelector('[aria-label="Search conversations"]');
      return s === document.activeElement;
    })()`);
    assert('Search focused after Ctrl+K', searchFocused === true);

    // Re-focus
    await evalInPage('document.activeElement && document.activeElement.blur && document.activeElement.blur()');
    await pressKey('k', { ctrl: true });
    await new Promise((r) => setTimeout(r, 300));
    const refocused = await evalInPage(`(() => {
      const s = document.querySelector('[aria-label="Search conversations"]');
      return s === document.activeElement;
    })()`);
    assert('Ctrl+K while open re-focuses Search', refocused === true);

    // ═══ 2. Escape ═══
    console.log('\n2. Escape:');
    await pressKey('Escape');
    await new Promise((r) => setTimeout(r, 300));
    const closed = await evalInPage(`!document.querySelector('[role="dialog"][aria-label="Conversation history"]')`);
    assert('Escape closes History', closed === true);
  }

  // ═══ 3. isInput Guard ═══
  console.log('\n3. isInput Guard:');
  const hasTextarea = await evalInPage(`!!document.querySelector('textarea[data-chat-input]')`);
  if (hasTextarea) {
    await evalInPage(`document.querySelector('textarea[data-chat-input]').focus()`);
    await pressKey('k', { ctrl: true });
    await new Promise((r) => setTimeout(r, 300));
    const guard = await evalInPage(`!document.querySelector('[role="dialog"][aria-label="Conversation history"]')`);
    assert('Ctrl+K in textarea does NOT hijack', guard === true);
  } else {
    assert('Ctrl+K in textarea does NOT hijack', false, 'textarea not found');
  }

  // ═══ 4. UI Structure ═══
  console.log('\n4. UI Structure:');
  const orb = await evalInPage(`!!document.querySelector('canvas')`);
  assert('Orb canvas rendered', orb === true);
  const nav = await evalInPage(`!!document.querySelector('[role="navigation"]')`);
  assert('Navigation rail rendered', nav === true);
  const status = await evalInPage(`!!document.querySelector('[role="status"]')`);
  assert('Status bar rendered', status === true);
  const branding = await evalInPage(`document.body.textContent.includes('N E X') || document.body.textContent.includes('NEX')`);
  assert('NEX branding present', branding === true);
  const noAura = await evalInPage(`!document.body.textContent.includes('AURA')`);
  assert('No AURA branding', noAura === true);

  // ═══ 5. Theme ═══
  console.log('\n5. Theme System:');
  const theme = await evalInPage(`document.documentElement.getAttribute('data-theme')`);
  assert('data-theme exists', theme !== null && theme !== '');
  const token = await evalInPage(`getComputedStyle(document.documentElement).getPropertyValue('--nex-accent').trim().length > 0`);
  assert('--nex-accent resolves', token === true);

  // ═══ 6. History States ═══
  console.log('\n6. History States:');
  await pressKey('k', { ctrl: true });
  await new Promise((r) => setTimeout(r, 500));
  const dialog = await evalInPage(`!!document.querySelector('[role="dialog"][aria-label="Conversation history"]')`);
  if (dialog) {
    assert('History dialog rendered', true);
    const newBtn = await evalInPage(`!!Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('New Conversation'))`);
    assert('New Conversation button', newBtn === true);

    // Search no-results
    await evalInPage(`(() => {
      const s = document.querySelector('[aria-label="Search conversations"]');
      if (s) { s.value = 'zzz-nonexistent'; s.dispatchEvent(new Event('input', { bubbles: true })); }
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 600));
    const noResults = await evalInPage(`document.body.textContent.includes('No results') || document.body.textContent.includes('No conversations')`);
    assert('Empty search shows no-results', noResults === true);
    await pressKey('Escape');
  } else {
    assert('History dialog rendered', false, 'History did not open');
  }

  // ═══ 7. ErrorBoundary ═══
  console.log('\n7. ErrorBoundary:');
  const noErr = await evalInPage(`!document.querySelector('[role="alert"]')`);
  assert('No error state normally', noErr === true);

  // ═══ 8. Chat ═══
  console.log('\n8. Chat Input:');
  if (hasTextarea) {
    const writable = await evalInPage(`(() => {
      const ta = document.querySelector('textarea[data-chat-input]');
      ta.value = 'test';
      return ta.value === 'test';
    })()`);
    assert('Chat textarea writable', writable === true);
  } else {
    assert('Chat textarea writable', false, 'textarea not found');
  }

  console.log('\n══════════════════════════════════════');
  console.log(`P36 CDP E2E RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); }

  ws.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
