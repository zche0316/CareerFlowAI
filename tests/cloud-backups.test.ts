import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
vi.mock('../apps/api/src/db.js', () => ({ db: { approvedResume: { findFirst: vi.fn() } } }));
vi.mock('../packages/documents/src/resume.js', () => ({
  resumePdf: vi.fn(async () => Buffer.from('%PDF fictional approved resume')),
}));
import { db } from '../apps/api/src/db.js';
import {
  registerCloudBackups,
  backupId,
  backupPrefix,
  type BackupStore,
} from '../apps/api/src/cloud-backups.js';

let server: Server;
afterEach(async () => {
  vi.clearAllMocks();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});
async function setup(store?: BackupStore) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = { id: req.headers['x-test-user'] || 'alice' } as any;
    next();
  });
  registerCloudBackups(app, store);
  app.use((error: any, _req: any, res: any, _next: any) =>
    res.status(error.status || 500).json({ code: error.code }),
  );
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as any).port}`;
}
const fake = (): BackupStore => ({
  put: vi.fn(async () => {}),
  list: vi.fn(async () => []),
  download: vi.fn(async () => 'https://example.test/private.pdf'),
});
describe('optional approved resume backups', () => {
  it('is disabled without configuration', async () => {
    vi.stubEnv('S3_BACKUP_BUCKET', '');
    const base = await setup();
    expect(await (await fetch(base + '/api/cloud-backups')).json()).toEqual({
      enabled: false,
      backups: [],
    });
    vi.unstubAllEnvs();
  });
  it('exports persisted content under a stable owner-scoped opaque key', async () => {
    const store = fake(),
      base = await setup(store);
    vi.mocked(db.approvedResume.findFirst).mockResolvedValue({
      id: 'approved-1',
      content: {},
    } as any);
    const response = await fetch(base + '/api/resumes/approved-1/cloud-backup', { method: 'POST' });
    expect(response.status).toBe(201);
    expect(db.approvedResume.findFirst).toHaveBeenCalledWith({
      where: { id: 'approved-1', userId: 'alice' },
    });
    expect(store.put).toHaveBeenCalledWith(
      `${backupPrefix('alice')}${backupId('approved-1')}.pdf`,
      expect.any(Buffer),
    );
  });
  it('rejects unapproved or other-user resumes before uploading', async () => {
    const store = fake(),
      base = await setup(store);
    vi.mocked(db.approvedResume.findFirst).mockResolvedValue(null);
    expect(
      (await fetch(base + '/api/resumes/foreign/cloud-backup', { method: 'POST' })).status,
    ).toBe(404);
    expect(store.put).not.toHaveBeenCalled();
  });
  it('scopes lists and downloads to the current user and rejects arbitrary keys', async () => {
    const store = fake(),
      base = await setup(store);
    await fetch(base + '/api/cloud-backups', { headers: { 'x-test-user': 'bob' } });
    expect(store.list).toHaveBeenCalledWith(backupPrefix('bob'));
    const id = backupId('approved-1');
    await fetch(base + `/api/cloud-backups/${id}/download`, {
      headers: { 'x-test-user': 'bob' },
      redirect: 'manual',
    });
    expect(store.download).toHaveBeenCalledWith(`${backupPrefix('bob')}${id}.pdf`);
    expect(backupPrefix('bob')).not.toBe(backupPrefix('alice'));
    expect((await fetch(base + '/api/cloud-backups/arbitrary/download')).status).toBe(404);
  });
  it('hides storage errors and credentials from responses', async () => {
    const store = fake();
    vi.mocked(store.list).mockRejectedValue(new Error('private credentials'));
    const base = await setup(store),
      response = await fetch(base + '/api/cloud-backups');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'CLOUD_BACKUP_UNAVAILABLE' });
  });
});
