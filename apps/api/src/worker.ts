import 'dotenv/config';
import { initQueue, closeQueue } from './queue.js';
import { db } from './db.js';
import { initScout, closeScout } from './scout.js';
await initQueue(true);
await initScout(true);
console.log('CareerFlow worker is running.');
process.on('SIGTERM', async () => {
  await closeScout();
  await closeQueue();
  await db.$disconnect();
  process.exit(0);
});
