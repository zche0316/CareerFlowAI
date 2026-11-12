// Runs the Playwright suite against a fixture-mode app on a disposable portable database.
// The developer's own data in .runtime/pglite is never opened.
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = fileURLToPath(new URL('../.runtime/pglite-e2e', import.meta.url));
await rm(dataDir, { recursive: true, force: true });

// PORT and LOCAL_DB_PORT move the test app off the defaults when another instance holds them.
const origin = `http://localhost:${process.env.PORT || 8787}`;
const env = {
  ...process.env,
  APP_ORIGIN: origin,
  PLAYWRIGHT_BASE_URL: origin,
  LOCAL_DB_DIR: dataDir,
  PROVIDER_MODE: 'fixture',
  JOB_SOURCE: 'fixtures',
  // Defined-but-empty values stop dotenv from loading live keys.
  OPENAI_API_KEY: '',
  OPENAI_NATIVE_API_KEY: '',
};
const app = spawn(process.execPath, ['scripts/local-run.mjs'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
let appExited = false;
app.once('exit', () => (appExited = true));
const stopApp = () =>
  new Promise((resolve) => {
    if (appExited) return resolve();
    app.once('exit', resolve);
    app.kill('SIGINT');
  });
process.on('SIGINT', () => stopApp().then(() => process.exit(130)));

async function ready() {
  for (let i = 0; i < 240; i++) {
    if (appExited) throw Error('The app stopped before it became ready.');
    try {
      const r = await fetch(origin + '/api/health');
      if (r.ok && (await r.json()).mode === 'fixture') return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error('CareerFlow did not become ready within 120 seconds.');
}

let code = 1;
try {
  await ready();
  code = await new Promise((resolve, reject) => {
    const test = spawn(
      process.execPath,
      ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)],
      { cwd: root, env, stdio: 'inherit' },
    );
    test.once('error', reject);
    test.once('exit', (c) => resolve(c ?? 1));
  });
} catch (error) {
  console.error(error.message);
} finally {
  await stopApp();
}
process.exit(code);
