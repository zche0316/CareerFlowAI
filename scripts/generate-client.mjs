import 'dotenv/config';
import { spawnSync } from 'node:child_process';

// Generation reads the schema but never connects to this placeholder database.
// Keep migrations and application startup strict about their real connection URL.
const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'generate'], {
  cwd: new URL('../', import.meta.url),
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable',
  },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
