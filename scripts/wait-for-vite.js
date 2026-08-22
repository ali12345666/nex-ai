const http = require('http');
const { spawn } = require('child_process');

const VITE_URL = 'http://localhost:5173';
const MAX_WAIT = 30000; // 30 seconds
const CHECK_INTERVAL = 500;

function checkVite() {
  return new Promise((resolve) => {
    const req = http.get(VITE_URL, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForVite() {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT) {
    if (await checkVite()) {
      console.log('[NEX AI] Vite dev server is ready!');
      return true;
    }
    await new Promise((r) => setTimeout(r, CHECK_INTERVAL));
  }
  console.error('[NEX AI] Vite dev server did not start in time');
  return false;
}

async function main() {
  const ready = await waitForVite();
  if (!ready) {
    process.exit(1);
  }

  // Start Electron
  const electron = spawn('npx', ['electron', '.'], {
    stdio: 'inherit',
    shell: true,
  });

  electron.on('close', (code) => {
    process.exit(code || 0);
  });
}

main();
