import 'dotenv/config';
import { createApp } from './app.js';
import { initQueue, closeQueue } from './queue.js';
import { db } from './db.js';
import { initScout, closeScout } from './scout.js';
import { initRecheck } from './role-recheck.js';
import { migrateRoleLibrary } from './role-library.js';
// Bring saved roles up to the current fingerprint before anything reads the board.
await migrateRoleLibrary();
await initQueue(process.env.EMBEDDED_WORKER !== 'false');
await initScout(process.env.EMBEDDED_WORKER !== 'false');
await initRecheck(process.env.EMBEDDED_WORKER !== 'false');

const server = createApp().listen(
  Number(process.env.PORT || 8787),
  process.env.HOST || '127.0.0.1',
  () =>
    console.log(
      `CareerFlow ready at http://localhost:${process.env.PORT || 8787} (${process.env.PROVIDER_MODE || 'fixture'} provider)`,
    ),
);

async function stop() {
  server.close();
  await closeScout();
  await closeQueue();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
