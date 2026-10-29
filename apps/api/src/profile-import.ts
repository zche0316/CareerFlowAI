import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db.js';
import { json } from './domain.js';
import { AppError, requireValue } from './errors.js';
import {
  extractFile,
  pageImage,
  type SourcePage,
} from '../../../packages/documents/src/extract.js';
import {
  importModel,
  groundImportedRecords,
  importResultSchema,
} from '../../../packages/agents/src/import-model.js';
import { configuredMode } from '../../../packages/agents/src/provider.js';
import { routerSettings } from '../../../packages/agents/src/router.js';
const upload = z.object({
  filename: z.string().min(1).max(180),
  mime: z.enum(['application/pdf', 'text/plain', 'image/png', 'image/jpeg']),
  base64: z
    .string()
    .min(4)
    .max(5600000)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
});
const owner = (userId: string, id: string) =>
  db.profileImport.findFirst({ where: { id, userId } }).then((r) => requireValue(r));
function publicImport(r: any) {
  const { file, userId, ...rest } = r;
  return { ...rest, router: routerSettings(), mode: configuredMode() };
}
export function registerProfileImports(app: Express) {
  app.get('/api/profiles/imports', async (req, res) =>
    res.json(
      await db.profileImport.findMany({
        where: { userId: req.actor!.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, filename: true, status: true, createdAt: true, error: true },
      }),
    ),
  );
  app.get('/api/profiles/imports/:id', async (req, res) =>
    res.json(publicImport(await owner(req.actor!.id, String(req.params.id)))),
  );
  app.post('/api/profiles/imports', async (req, res) => {
    const input = upload.parse(req.body);
    if (
      (await db.profileImport.count({
        where: { userId: req.actor!.id, createdAt: { gte: new Date(Date.now() - 3600000) } },
      })) >= 10
    )
      throw new AppError(429, 'IMPORT_LIMIT', 'Up to ten files may be imported per hour.');
    const bytes = Buffer.from(input.base64, 'base64');
    let pages;
    try {
      pages = await extractFile(bytes, input.mime);
    } catch {
      throw new AppError(
        422,
        'INVALID_FILE',
        'Cannot read this file. Use an unencrypted PDF up to 10 pages, UTF-8 TXT, PNG or JPEG, up to 4 MB.',
      );
    }
    const r = await db.profileImport.create({
      data: {
        userId: req.actor!.id,
        filename: input.filename.replace(/[\x00-\x1F]/g, ''),
        mime: input.mime,
        file: bytes,
        status: pages.some((p) => p.route === 'vision') ? 'NEEDS_VISION' : 'EXTRACTED',
        pages: json(pages),
        proposed: json({ records: [], questions: [], rejected: [] }),
        events: json([
          {
            at: new Date().toISOString(),
            agent: 'Router',
            action: 'local-extraction',
            detail: 'Local text extraction completed. No external model called.',
          },
        ]),
      },
    });
    res.status(201).json(publicImport(r));
  });
  for (const action of ['recognize', 'structure'] as const)
    app.post(`/api/profiles/imports/:id/${action}`, async (req, res) => {
      z.object({
        consent: z.literal(true),
        pages: z.array(z.number().int().min(1).max(10)).max(3).optional(),
      }).parse(req.body);
      const r = await owner(req.actor!.id, String(req.params.id));
      if (configuredMode() !== 'openai')
        throw new AppError(
          422,
          'LIVE_IMPORT_REQUIRED',
          'AI import requires PROVIDER_MODE=openai. Local extraction and manual entry remain available; no fixture content will be invented.',
        );
      if (r.status === 'PROCESSING' && Date.now() - r.updatedAt.getTime() < 120000)
        throw new AppError(409, 'IMPORT_BUSY', 'This import is already processing.');
      if (r.calls >= 8)
        throw new AppError(
          409,
          'IMPORT_BUDGET',
          'This import reached its eight-call budget. Continue manually.',
        );
      const pages = structuredClone(r.pages) as SourcePage[];
      const selected =
        action === 'recognize'
          ? pages
              .filter(
                (p) =>
                  req.body.pages?.includes(p.page) || (!req.body.pages && p.route === 'vision'),
              )
              .slice(0, 3)
          : [];
      if (action === 'recognize' && !selected.length)
        throw new AppError(422, 'NO_PAGES', 'Select up to three pages for visual transcription.');
      if (action === 'structure' && !pages.some((p) => p.text.trim()))
        throw new AppError(422, 'NO_TEXT', 'Extract or transcribe text before organizing records.');
      if (action === 'structure' && pages.reduce((n, p) => n + p.text.length, 0) > 16000)
        throw new AppError(
          422,
          'TEXT_LIMIT',
          'AI organization accepts up to 16,000 extracted characters. Use a shorter resume or continue manually.',
        );
      const cost = action === 'recognize' ? selected.length : 1;
      if (r.calls + cost > 8)
        throw new AppError(409, 'IMPORT_BUDGET', 'Not enough calls remain for these pages.');
      const locked = await db.profileImport.updateMany({
        where: { id: r.id, userId: r.userId, updatedAt: r.updatedAt },
        data: { status: 'PROCESSING', error: null, calls: { increment: cost } },
      });
      if (!locked.count)
        throw new AppError(409, 'IMPORT_CHANGED', 'Import changed. Reload before retrying.');
      const events = [...(r.events as any[])];
      let proposed = json(r.proposed);
      try {
        if (action === 'recognize')
          for (const page of selected) {
            const { result, usage } = await importModel(
              'vision',
              await pageImage(r.file, r.mime, page.page),
            );
            page.text = (result as any).text;
            page.method = 'qwen-vision';
            page.route = 'text';
            page.warning =
              'Visual transcription is unverified. ' + (result as any).uncertainties.join('; ');
            events.push({
              at: new Date().toISOString(),
              agent: 'Vision',
              action: 'transcribed',
              page: page.page,
              ...usage,
            });
          }
        else {
          const { result, usage } = await importModel(
            'light',
            pages.map(({ page, text }) => ({ page, text })) as SourcePage[],
          );
          const grounded = groundImportedRecords(importResultSchema.parse(result), pages);
          proposed = json({
            ...grounded,
            records: grounded.records.map((record) => ({
              ...record,
              id: randomUUID(),
              evidence: record.evidence.map((e) => ({ ...e, importId: r.id })),
            })),
          });
          events.push({
            at: new Date().toISOString(),
            agent: 'Profile Organizer',
            action: 'proposed',
            ...usage,
            rejected: grounded.rejected.length,
          });
        }
        const saved = await db.profileImport.update({
          where: { id: r.id },
          data: {
            pages: json(pages),
            proposed,
            status:
              action === 'structure'
                ? 'READY_FOR_REVIEW'
                : pages.some((p) => p.route === 'vision')
                  ? 'NEEDS_VISION'
                  : 'EXTRACTED',
            events: json(events),
          },
        });
        res.json(publicImport(saved));
      } catch (error: any) {
        const wait = error.headers?.get?.('retry-after');
        const limited = error.status === 429;
        const rateMessage = `Model provider rate limit reached.${wait && /^\d+(?:\.\d+)?$/.test(wait) ? ' Retry after ' + Math.ceil(Number(wait)) + ' seconds.' : ' Wait before retrying.'} Saved extraction and your approved profile are unchanged.`;
        const message = limited
          ? rateMessage
          : 'Model processing failed, timed out or returned an invalid result. Saved extraction and approved profile are unchanged. Retry explicitly or continue manually.';
        events.push({
          at: new Date().toISOString(),
          agent: 'Router',
          action: 'failed',
          status: limited ? 429 : 503,
        });
        await db.profileImport.update({
          where: { id: r.id },
          data: { status: 'FAILED', pages: json(pages), events: json(events), error: message },
        });
        throw new AppError(
          limited ? 429 : 503,
          limited ? 'IMPORT_RATE_LIMITED' : 'IMPORT_MODEL_FAILED',
          message,
        );
      }
    });
}
