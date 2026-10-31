import { JobRepository, manualListing, employerBoards } from './repository.js';
import { postingIdentity, verifyPosting } from './tavily.js';
import { JobSourceError } from './source-error.js';

function corporateIdentity(u) {
  const source = employerBoards.find((s) => s.hosts.includes(u.hostname));
  const id =
    u.searchParams.get('gh_jid') || /\/(?:jobs?|careers\/jobs)\/(\d+)\/?$/.exec(u.pathname)?.[1];
  return source && /^\d{1,30}$/.test(id || '') ? { source, id } : null;
}
export function supportedJobURL(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Paste a complete HTTPS job listing URL.');
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port)
    throw new Error('Use an official HTTPS job listing URL.');
  if (postingIdentity(u.href) || corporateIdentity(u)) return u;
  const host = u.hostname;
  const valid =
    (['seek.com.au', 'www.seek.com.au', 'au.seek.com'].includes(host) &&
      /^\/job\/\d+\/?$/.test(u.pathname)) ||
    (['indeed.com', 'www.indeed.com', 'au.indeed.com'].includes(host) &&
      u.pathname === '/viewjob' &&
      /^[a-zA-Z0-9_-]{1,100}$/.test(u.searchParams.get('jk') || '')) ||
    (['linkedin.com', 'www.linkedin.com', 'au.linkedin.com'].includes(host) &&
      /^\/jobs\/view\/(?:[a-zA-Z0-9-]+-)?\d+\/?$/.test(u.pathname));
  if (!valid)
    throw new Error('Use a SEEK, Indeed, LinkedIn, Greenhouse, Lever or Ashby job listing link.');
  u.hash = '';
  if (host.includes('linkedin.com') || host.includes('seek.com')) u.search = '';
  return u;
}
const clean = (value) =>
  String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
const normal = (value) => clean(value).toLowerCase();
/** @param {string} raw
 * @param {{repo?: JobRepository, parseText?: (text: string) => Promise<any>, signal?: AbortSignal}} options
 */
export async function resolveJobLink(raw, { repo = new JobRepository(), parseText, signal } = {}) {
  let u = supportedJobURL(raw);
  const identity = postingIdentity(u.href);
  if (identity) {
    const job = await verifyPosting(repo, identity, signal || AbortSignal.timeout(15000));
    job.company =
      employerBoards.find((source) => source.board === identity.board)?.company || job.company;
    delete job.source.discoveredBy;
    job.source.coverage = 'User-supplied link confirmed through its public recruitment API';
    job.source.importedFromURL = u.href;
    return job;
  }
  const corporate = corporateIdentity(u);
  if (corporate) {
    const { source, id } = corporate;
    const api = `https://boards-api.greenhouse.io/v1/boards/${source.board}/jobs/${id}`;
    const entry = await repo.json(api, signal);
    const destination = supportedJobURL(entry.absolute_url);
    const confirmed = corporateIdentity(destination);
    if (
      String(entry.id) !== id ||
      confirmed?.source.board !== source.board ||
      confirmed.id !== id ||
      !entry.title ||
      !entry.content
    )
      throw new Error('The job details could not be confirmed by the employer API.');
    const job = repo.normalize(
      {
        id,
        title: entry.title,
        company: source.company,
        location: entry.location?.name,
        description: entry.content,
        url: destination.href,
      },
      {
        provider: 'greenhouse',
        board: source.board,
        listingId: id,
        host: destination.hostname,
        url: api,
        coverage: 'Employer posting confirmed through its public recruitment API',
      },
    );
    job.source.importedFromURL = u.href;
    return job;
  }
  const deadline = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
    : AbortSignal.timeout(15000);
  let response;
  for (let hop = 0; hop < 4; hop++) {
    response = await repo.fetcher(u.href, {
      redirect: 'manual',
      signal: deadline,
      headers: { Accept: 'text/html' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || hop === 3)
        throw new Error('This job link redirects to an unavailable page.');
      u = supportedJobURL(new URL(location, u).href);
      continue;
    }
    break;
  }
  if (!response.ok)
    throw new JobSourceError(
      'JOB_PAGE_UNAVAILABLE',
      `This site could not provide the public job page (HTTP ${response.status}). Try the employer’s original listing link.`,
      response.status,
    );
  const type = response.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml\+xml/i.test(type))
    throw new Error('The link did not return a public job page.');
  const reader = response.body.getReader();
  let html = '',
    bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 2000000) throw new Error('Job page is too large to read.');
      html += decoder.decode(part.value, { stream: true });
    }
    html += decoder.decode();
  } finally {
    await reader.cancel();
  }
  let structured;
  const walk = (node) => {
    if (!node || typeof node !== 'object' || structured) return;
    if ([node['@type']].flat().includes('JobPosting')) {
      structured = node;
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.slice(0, 100).forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  };
  for (const match of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      walk(JSON.parse(match[1]));
    } catch {}
  }
  let listing;
  if (structured) {
    if (
      structured.validThrough &&
      Number.isFinite(Date.parse(structured.validThrough)) &&
      Date.parse(structured.validThrough) < Date.now()
    )
      throw new Error('This job listing has expired.');
    const places = [structured.jobLocation].flat().filter(Boolean);
    listing = {
      title: clean(structured.title),
      company: clean(structured.hiringOrganization?.name),
      location:
        places
          .map((p) => {
            const a = p.address || {};
            return [
              a.addressLocality,
              a.addressRegion,
              typeof a.addressCountry === 'string' ? a.addressCountry : a.addressCountry?.name,
            ]
              .filter(Boolean)
              .join(', ');
          })
          .filter(Boolean)
          .join('; ') || clean(structured.applicantLocationRequirements?.name),
      description: clean(structured.description),
    };
  }
  const text = clean(html).slice(0, 24000);
  if ((!listing?.title || !listing?.company || !listing?.description) && parseText) {
    listing = await parseText(text);
    if (Object.values(listing).some((value) => value && !normal(text).includes(normal(value))))
      throw new Error(
        'The job details could not be grounded in the public page. Try the employer’s original listing.',
      );
  }
  if (
    !listing?.title ||
    !listing?.company ||
    !listing?.description ||
    listing.description.length < 20
  )
    throw new Error(
      'No readable job details were found. The page may require login. Try the employer’s original listing.',
    );
  const job = manualListing({
    ...listing,
    location: listing.location || 'Not supplied',
    url: u.href,
  });
  job.source = {
    ...job.source,
    importedFromURL: u.href,
    fetchedVia: 'public-page',
    coverage: 'Read from a public job page; availability not confirmed by a recruitment API',
  };
  return job;
}
