import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Endpoint = `${Uppercase<HttpMethod>} ${string}`;
type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

const appSource = readFileSync(new URL('../apps/api/src/app.ts', import.meta.url), 'utf8');
const apiDocs = readFileSync(new URL('../docs/API.md', import.meta.url), 'utf8');

function sourceEndpoints(): Endpoint[] {
  const routePattern = /app\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g;

  return [
    ...new Set(
      [...appSource.matchAll(routePattern)]
        .filter((match) => match[2].startsWith('/api/'))
        .map((match) => `${match[1].toUpperCase()} ${match[2]}` as Endpoint),
    ),
  ].sort();
}

function documentedEndpoints(): Endpoint[] {
  const tableRowPattern = /\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`(\/api\/[^`]+)`\s*\|/g;

  return [
    ...new Set(
      [...apiDocs.matchAll(tableRowPattern)].map((match) => `${match[1]} ${match[2]}` as Endpoint),
    ),
  ].sort();
}

describe('API documentation contract', () => {
  it('documents every current Express API route', () => {
    const documented = new Set(documentedEndpoints());
    const missing = sourceEndpoints().filter((endpoint) => !documented.has(endpoint));

    expect(missing, `Undocumented API routes: ${missing.join(', ')}`).toEqual([]);
  });

  it('does not retain documented routes that no longer exist', () => {
    const implemented = new Set(sourceEndpoints());
    const stale = documentedEndpoints().filter((endpoint) => !implemented.has(endpoint));

    expect(stale, `Documented routes missing from app.ts: ${stale.join(', ')}`).toEqual([]);
  });

  it('keeps the PR #3 tools, reminders and application routes explicit', () => {
    expect(sourceEndpoints()).toEqual(
      expect.arrayContaining([
        'GET /api/tools/dashboard',
        'POST /api/missions/:id/tools',
        'GET /api/missions/:id/reminders/:reminderId/calendar',
        'GET /api/missions/:id/application',
        'POST /api/missions/:id/applications',
        'GET /api/missions/:id/jobs/:jobId/availability',
      ]),
    );
  });
});
