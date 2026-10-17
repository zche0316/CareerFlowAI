import 'dotenv/config';
import { initQueue, closeQueue } from './queue.js';
import { db } from './db.js';
await initQueue(true);
console.log('CareerFlow worker is running.');
process.on('SIGTERM', async () => {
  await closeQueue();
  await db.$disconnect();
  process.exit(0);
});
