import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.js';
import { AppError } from './errors.js';

export const hashToken = (s: string) => createHash('sha256').update(s).digest('hex');

export function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}

export function verifyPassword(password: string, stored: string) {
  const [salt, h] = stored.split(':');
  const expected = Buffer.from(h, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

declare global {
  namespace Express {
    interface Request {
      actor?: { id: string; name: string; email: string };
      session?: { id: string; csrf: string };
    }
  }
}

// Store only a token hash in the database; the raw session token stays in the HTTP-only cookie.
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const raw = req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('cf_session='))
      ?.slice(11);
    if (raw) {
      const s = await db.session.findUnique({
        where: { tokenHash: hashToken(raw) },
        include: { user: true },
      });
      if (s && s.expiresAt > new Date()) {
        req.actor = { id: s.user.id, name: s.user.name, email: s.user.email };
        req.session = { id: s.id, csrf: s.csrf };
      }
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function needAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.actor) return next(new AppError(401, 'SIGN_IN_REQUIRED', 'Sign in to your workspace.'));
  next();
}

// Cookies authenticate the session; origin and CSRF checks protect state-changing requests.
export function verifyWrite(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  const allowed = [
    process.env.APP_ORIGIN || 'http://localhost:8787',
    ...(process.env.NODE_ENV === 'production'
      ? []
      : ['http://localhost:5173', 'http://127.0.0.1:8787', 'http://127.0.0.1:5173']),
  ];
  if (origin && !allowed.includes(origin))
    return next(new AppError(403, 'ORIGIN_DENIED', 'This request origin is not permitted.'));
  if (req.actor && req.headers['x-csrf-token'] !== req.session?.csrf)
    return next(new AppError(403, 'CSRF_DENIED', 'Refresh the page and retry this action.'));
  next();
}

export async function createSession(userId: string, res: Response) {
  const token = randomBytes(32).toString('hex');
  const csrf = randomBytes(24).toString('hex');
  await db.session.create({
    data: { userId, tokenHash: hashToken(token), csrf, expiresAt: new Date(Date.now() + 86400000) },
  });
  res.setHeader(
    'Set-Cookie',
    `cf_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  );
  return csrf;
}
