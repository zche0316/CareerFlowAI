// Creates a fresh demo account on a running CareerFlow app, with the fictional graduate profile
// from scripts/demo-profile.mjs approved as version 1 and three confirmed career memories.
//
//   npm run demo:account                     # app on http://localhost:8787
//   npm run demo:account -- --url http://localhost:8797
//
// It only uses the app's public API, so it works with the portable database or Docker and never
// edits existing accounts. Each run makes a new account; older demo accounts stay as they were.
// No model is called, so it costs nothing in live mode. The sign-in details are written to
// .runtime/demo-account.json (git-ignored).
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { demoMemories, demoProfile } from './demo-profile.mjs';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const base = (arg('--url') || `http://localhost:${process.env.PORT || 8787}`).replace(/\/$/, '');
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const email = arg('--email') || `demo-${stamp}@careerflow.test`;
const password = `Demo-${randomBytes(9).toString('base64url')}`;
const outFile = fileURLToPath(new URL('../.runtime/demo-account.json', import.meta.url));

let cookie = '';
let csrf = '';
async function call(path, method = 'GET', body) {
  const response = await fetch(base + '/api' + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Error(
      `${method} ${path} → ${response.status} ${data.error?.message || data.message || ''}`,
    );
  return data;
}

try {
  const health = await call('/health').catch(() => {
    throw Error(`CareerFlow is not reachable at ${base}. Start it with npm run start:local first.`);
  });
  const registered = await call('/auth/register', 'POST', {
    email,
    password,
    name: demoProfile.name,
  });
  csrf = registered.csrf;
  const draft = await call('/profiles/drafts', 'POST', {
    ...demoProfile,
    contact: { ...demoProfile.contact, email },
  });
  await call(`/profiles/drafts/${draft.id}/approve`, 'POST', { reviewed: true });
  let memories = 0;
  for (const memory of demoMemories) {
    const saved = await call('/career-memories', 'POST', memory);
    await call(`/career-memories/${saved.id}`, 'PATCH', {
      revision: saved.revision,
      reviewed: true,
    });
    memories++;
  }
  const account = {
    url: base,
    email,
    password,
    mode: health.mode,
    createdAt: new Date().toISOString(),
  };
  await mkdir(fileURLToPath(new URL('../.runtime/', import.meta.url)), { recursive: true });
  await writeFile(outFile, JSON.stringify(account, null, 2) + '\n', { mode: 0o600 });
  console.log(`Demo account ready on ${base} (${health.mode} mode)
  Profile:  ${demoProfile.name} (fictional), approved as version 1
  Memories: ${memories} confirmed
  Email:    ${email}
  Password: ${password}
Saved to .runtime/demo-account.json. Sign in, then start a quest from Quests.`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
