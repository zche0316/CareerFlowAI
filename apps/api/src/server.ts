import 'dotenv/config';
import { createApp } from './app.js';
import { initQueue, closeQueue } from './queue.js';
import { db } from './db.js';
if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEMO_LOGIN === 'true')
  throw Error('Disable the public demo login before production deployment.');
await initQueue(process.env.EMBEDDED_WORKER !== 'false');

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
  await closeQueue();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
