/**
 * Phase 36 — REAL Electron UI/E2E Tests
 *
 * APPROACH: The test itself is an Electron app that requires main.js.
 * The trick: we require main.js FIRST (before our whenReady handler),
 * so main.js's whenReady handler runs first and creates the window.
 * Then our handler runs and finds the already-created window.
 *
 * NO new dependencies — uses only existing Electron infrastructure.
 *
 * Run: DISPLAY=:99 node_modules/electron/dist/electron --no-sandbox tests/e2e/test-p36-ui.js
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const PWD = path.join(__dirname, '../..');

let pass = 0, fail = 0;
const failures = [];
function assert(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

// ── Capture the window created by main.js ──
let mainWindow = null;
const OriginalBW = BrowserWindow;
const PatchedBW = new Proxy(OriginalBW, {
  construct(target, args) {
    const win = new target(...args);
    if (!mainWindow) mainWindow = win;
    return win;
  },
  get(target, prop) {
    return Reflect.get(target, prop);
  },
});

let exec = async (code) => {
  if (!mainWindow) throw new Error('No main window');
  return mainWindow.webContents.executeJavaScript(code, true);
};

let pressKey = async (key, opts = {}) => {
  return exec(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: ${JSON.stringify(key)}, bubbles: true, cancelable: true,
      ctrlKey: ${opts.ctrl || false}, metaKey: ${opts.meta || false},
    }));
    return true;
  })()`);
};

async function waitFor(fn, timeout = 8000, interval = 300) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await fn()) return true; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

// ═══ LOAD MAIN.JS FIRST — its whenReady handler creates the window ═══
// Force production mode so it loads dist/renderer/index.html
Object.defineProperty(app, 'isPackaged', { value: true, writable: false });

const mainPath = path.join(PWD, 'dist/main/main.js');
if (!fs.existsSync(mainPath)) {
  console.error('FATAL: dist/main/main.js not found.');
  process.exit(1);
}

// Replace BrowserWindow BEFORE requiring main.js
require.cache[require.resolve('electron')] = { id: require.resolve('electron'), filename: require.resolve('electron'), loaded: true, exports: { ...require('electron'), BrowserWindow: PatchedBW } };
require(mainPath);

// ═══ OUR TESTS RUN AFTER MAIN.JS'S whenReady ═══
// We use a second whenReady which will fire after main.js's one
setTimeout(async () => {
  console.log('\n═══ Phase 36 — REAL Electron UI/E2E Tests (Full App) ═══\n');

  // Wait for window to be created and loaded
  const winReady = await waitFor(async () => {
    return mainWindow !== null && mainWindow.webContents.getURL().length > 0;
  }, 10000);
  assert('Main window created and loaded', winReady === true);

  if (!winReady) {
    console.log('P36 UI/E2E RESULT: BLOCKED — window did not load');
    app.exit(1);
    return;
  }

  // Wait for React to mount
  const reactReady = await waitFor(async () => {
    return exec(`document.getElementById('root') && document.getElementById('root').children.length > 0`);
  }, 10000);
  assert('React mounted', reactReady === true);

  // Extra wait for lazy components
  await new Promise((r) => setTimeout(r, 2000));

  // ═══ 1. Ctrl+K ═══
  console.log('\n1. Ctrl+K — Real UI:');

  const histClosed = await exec(`!document.querySelector('[role="dialog"][aria-label="Conversation history"]')`);
  assert('History initially closed', histClosed === true);

  await pressKey('k', { ctrl: true });
  await new Promise((r) => setTimeout(r, 500));

  const histOpen = await exec(`!!document.querySelector('[role="dialog"][aria-label="Conversation history"]')`);
  assert('Ctrl+K opens History', histOpen === true, 'History did not open');

  if (histOpen) {
    const searchFocused = await exec(`(() => {
      const s = document.querySelector('[aria-label="Search conversations"]');
      return s === document.activeElement;
    })()`);
    assert('Search focused after Ctrl+K', searchFocused === true);

    await exec('document.activeElement && document.activeElement.blur && document.activeElement.blur()');
    await pressKey('k', { ctrl: true });
    await new Promise((r) => setTimeout(r, 300));
    const refocused = await exec(`(() => {
      const s = document.querySelector('[aria-label="Search conversations"]');
      return s === document.activeElement;
    })()`);
    assert('Ctrl+K while open re-focuses Search', refocused === true);

    // ═══ 2. Escape ═══
    console.log('\n2. Escape:');
    await pressKey('Escape');
    await new Promise((r) => setTimeout(r, 300));
    const closed = await exec(`!document.querySelector('[role="dialog"][aria-label="Conversation history"]')`);
    assert('Escape closes History', closed === true);
  } else {
    console.log('  SKIP: Escape + re-focus (History did not open)');
  }

  // ═══ 3. isInput Guard ═══
  console.log('\n3. Ctrl+K isInput Guard:');
  const hasTA = await exec(`!!document.querySelector('textarea[data-chat-input]')`);
  if (hasTA) {
    // Focus textarea, then dispatch event FROM the element (bubbles to window)
    await exec(`(() => {
      const ta = document.querySelector('textarea[data-chat-input]');
      if (ta) {
        ta.focus();
        ta.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'k', bubbles: true, cancelable: true, ctrlKey: true,
        }));
      }
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 500));
    const guard = await exec(`!document.querySelector('[role="dialog"][aria-label="Conversation history"]')`);
    assert('Ctrl+K in textarea does NOT hijack', guard === true);
  } else {
    assert('Ctrl+K in textarea does NOT hijack', false, 'textarea not found');
  }

  // ═══ 4. UI Structure ═══
  console.log('\n4. UI Structure:');
  const orb = await exec(`!!document.querySelector('canvas')`);
  assert('Orb canvas rendered', orb === true);
  const nav = await exec(`!!document.querySelector('[role="navigation"]')`);
  assert('Navigation rail rendered', nav === true);
  const status = await exec(`!!document.querySelector('[role="status"]')`);
  assert('Status bar rendered', status === true);
  const branding = await exec(`document.body.textContent.includes('N E X') || document.body.textContent.includes('NEX')`);
  assert('NEX branding present', branding === true);
  const noAura = await exec(`!document.body.textContent.includes('AURA')`);
  assert('No AURA branding', noAura === true);

  // ═══ 5. Theme ═══
  console.log('\n5. Theme System:');
  const theme = await exec(`document.documentElement.getAttribute('data-theme')`);
  assert('data-theme exists', theme !== null && theme !== '');
  const token = await exec(`getComputedStyle(document.documentElement).getPropertyValue('--nex-accent').trim().length > 0`);
  assert('--nex-accent resolves', token === true);

  // ═══ 6. History States ═══
  console.log('\n6. History States:');
  await pressKey('k', { ctrl: true });
  await new Promise((r) => setTimeout(r, 500));
  const dialog = await exec(`!!document.querySelector('[role="dialog"][aria-label="Conversation history"]')`);
  if (dialog) {
    assert('History dialog rendered', true);
    const newBtn = await exec(`!!Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('New Conversation'))`);
    assert('New Conversation button', newBtn === true);

    await eval(0);
    await exec(`(() => {
      const s = document.querySelector('[aria-label="Search conversations"]');
      if (s) { s.value = 'zzz-nonexistent'; s.dispatchEvent(new Event('input', { bubbles: true })); }
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 600));
    const noResults = await exec(`document.body.textContent.includes('No results') || document.body.textContent.includes('No conversations')`);
    assert('Empty search shows no-results', noResults === true);
    await pressKey('Escape');
  } else {
    assert('History dialog rendered', false, 'History did not open');
  }

  // ═══ 7. ErrorBoundary ═══
  console.log('\n7. ErrorBoundary:');
  const noErr = await exec(`!document.querySelector('[role="alert"]')`);
  assert('No error state normally', noErr === true);

  // ═══ 8. Chat ═══
  console.log('\n8. Chat Input:');
  const writable = hasTA ? await eval(0) || await exec(`(() => {
    const ta = document.querySelector('textarea[data-chat-input]');
    ta.value = 'test';
    return ta.value === 'test';
  })()`) : false;
  assert('Chat textarea writable', writable === true);

  console.log('\n══════════════════════════════════════');
  console.log(`P36 UI/E2E RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); }

  app.exit(fail > 0 ? 1 : 0);
}, 3000); // Delay to let main.js's whenReady run first
