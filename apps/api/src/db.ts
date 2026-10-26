import pg from 'pg';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export const databaseUrl = process.env.DATABASE_URL || '';
if (!databaseUrl)
  throw new Error('DATABASE_URL is required. Copy .env.example to .env and configure PostgreSQL.');

if (process.env.DEV_DATABASE === 'portable' && process.env.NODE_ENV === 'production')
  throw Error('Portable database mode is for local development only.');

// PGlite exposes one PostgreSQL session. Share one client across all consumers so
// prepared statements and transactions cannot interleave across virtual sessions.
export const portablePool =
  process.env.DEV_DATABASE === 'portable'
    ? new pg.Pool({ connectionString: databaseUrl, max: 1, idleTimeoutMillis: 0 })
    : undefined;
export const db = new PrismaClient({
  adapter: portablePool
    ? new PrismaPg(portablePool, { disposeExternalPool: true })
    : new PrismaPg({ connectionString: databaseUrl }),
});
