import type { Express } from 'express';
import { createHash } from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { db } from './db.js';
import { AppError, requireValue } from './errors.js';
import { resumePdf } from '../../../packages/documents/src/resume.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const backupPrefix = (userId: string) => `approved-resumes/${hash(userId)}/`;
export const backupId = (resumeId: string) => hash(resumeId);
export interface BackupStore {
  put(key: string, body: Buffer): Promise<void>;
  list(prefix: string): Promise<{ id: string; createdAt: string; size: number }[]>;
  download(key: string): Promise<string>;
}
export function s3BackupStore(): BackupStore | undefined {
  const bucket = process.env.S3_BACKUP_BUCKET?.trim();
  if (!bucket) return undefined;
  const client = new S3Client({
    region: process.env.AWS_REGION || 'ap-southeast-2',
    credentials: fromNodeProviderChain({ profile: process.env.AWS_PROFILE || undefined }),
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 15000 },
  });
  return {
    async put(key, body) {
      // Approved resumes are immutable. Repeated backups use the same object key.
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: 'application/pdf',
          ServerSideEncryption: 'AES256',
          ContentDisposition: 'attachment; filename="careerflow-approved-resume.pdf"',
        }),
      );
    },
    async list(prefix) {
      const rows: { id: string; createdAt: string; size: number }[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const object of page.Contents || []) {
          const name = object.Key?.slice(prefix.length);
          if (name && /^[a-f0-9]{64}\.pdf$/.test(name))
            rows.push({
              id: name.slice(0, -4),
              createdAt: object.LastModified?.toISOString() || '',
              size: object.Size || 0,
            });
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async download(key) {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: 'attachment; filename="careerflow-approved-resume.pdf"',
        }),
        { expiresIn: 60 },
      );
    },
  };
}
export function registerCloudBackups(app: Express, store = s3BackupStore()) {
  const available = () => {
    if (!store)
      throw new AppError(
        503,
        'CLOUD_BACKUP_DISABLED',
        'Cloud backup is not configured. Local downloads are available.',
      );
    return store;
  };
  const storage = async <T>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (error: any) {
      if (['NotFound', 'NoSuchKey'].includes(error?.name))
        throw new AppError(404, 'NOT_FOUND', 'Backup not found.');
      throw new AppError(
        503,
        'CLOUD_BACKUP_UNAVAILABLE',
        'Cloud backup is unavailable. Local downloads are available; please retry later.',
      );
    }
  };
  app.get('/api/cloud-backups', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      enabled: !!store,
      backups: store ? await storage(() => store.list(backupPrefix(req.actor!.id))) : [],
    });
  });
  app.post('/api/resumes/:id/cloud-backup', async (req, res) => {
    const resume = requireValue(
      await db.approvedResume.findFirst({
        where: { id: String(req.params.id), userId: req.actor!.id },
      }),
    );
    const target = available();
    const id = backupId(resume.id);
    const body = await resumePdf(resume.content as any);
    await storage(() => target.put(`${backupPrefix(req.actor!.id)}${id}.pdf`, body));
    res.status(201).json({ id });
  });
  app.get('/api/cloud-backups/:id/download', async (req, res) => {
    const id = String(req.params.id);
    if (!/^[a-f0-9]{64}$/.test(id)) throw new AppError(404, 'NOT_FOUND', 'Backup not found.');
    const target = available();
    const url = await storage(() => target.download(`${backupPrefix(req.actor!.id)}${id}.pdf`));
    res.setHeader('Cache-Control', 'private, no-store');
    res.redirect(302, url);
  });
}
