import 'dotenv/config';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startLocalDatabase } from './portable-db.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const database = await startLocalDatabase();
const env = {
  ...process.env,
  DEV_DATABASE: 'portable',
  DATABASE_URL: database.url,
  ...(process.argv.includes('--verify')
    ? { JOB_SOURCE: 'fixtures', PROVIDER_MODE: 'fixture', OPENAI_NATIVE_API_KEY: '' }
    : {}),
};
let active,
  stopping = false;
const stop = () => {
  stopping = true;
  active?.kill('SIGINT');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
function run(args) {
  return new Promise((resolve, reject) => {
    if (stopping) return reject(Error('Startup cancelled.'));
    active = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
    active.once('error', reject);
    active.once('exit', (code, signal) => {
      active = undefined;
      if (stopping) resolve();
      else if (code === 0) resolve();
      else reject(Error(`Local command exited ${code ?? signal}.`));
    });
  });
}
try {
  await run(['node_modules/prisma/build/index.js', 'generate']);
  await run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
  if (process.argv.includes('--verify')) {
    await run(['node_modules/typescript/bin/tsc', '--noEmit']);
    await run(['--test', 'packages/matching/original.test.js']);
    await run(['node_modules/vitest/vitest.mjs', 'run']);
    await run(['node_modules/vite/bin/vite.js', 'build', '--config', 'apps/web/vite.config.ts']);
  } else {
    await run(['node_modules/vite/bin/vite.js', 'build', '--config', 'apps/web/vite.config.ts']);
    await run(['--import', 'tsx', 'apps/api/src/server.ts']);
  }
} catch (error) {
  if (!stopping) {
    console.error(error.message);
    process.exitCode = 1;
  }
} finally {
  await database.close();
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
