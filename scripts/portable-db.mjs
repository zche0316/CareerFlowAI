import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createConnection } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function startLocalDatabase() {
  if (process.env.NODE_ENV === 'production')
    throw Error(
      'The portable database is for local development only. Use PostgreSQL for production.',
    );
  const port = Number(process.env.LOCAL_DB_PORT || 55432);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid LOCAL_DB_PORT.');
  const occupied = await new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
  if (occupied)
    throw Error(
      `Local database port ${port} is already in use. Stop the existing database/app before starting another portable instance, or use native PostgreSQL with npm start.`,
    );
  const dataDir = fileURLToPath(new URL('../.runtime/pglite', import.meta.url));
  await mkdir(dataDir, { recursive: true });
  const db = await PGlite.create({ dataDir });
  // App consumers share one pg client. Extra sessions are reserved for migrations
  // before app startup; do not run parallel application/test processes on this DB.
  const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port, maxConnections: 16 });
  try {
    await server.start();
  } catch (error) {
    await db.close();
    throw error;
  }
  console.log(`Persistent local development database ready on 127.0.0.1:${port}`);
  return {
    // The loopback-only portable server does not implement TLS negotiation.
    url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`,
    async close() {
      await server.stop();
      await db.close();
    },
  };
}
