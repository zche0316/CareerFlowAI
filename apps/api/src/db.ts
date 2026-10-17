import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export const databaseUrl = process.env.DATABASE_URL || '';
if (!databaseUrl)
  throw new Error('DATABASE_URL is required. Copy .env.example to .env and configure PostgreSQL.');

export const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
