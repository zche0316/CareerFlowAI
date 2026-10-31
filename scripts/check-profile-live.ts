import { blankProfile } from '../packages/contracts/src/index.js';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = 'http://localhost:8787/api';
const registration = await fetch(base + '/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Alex Chen',
    email: `profile-live-${Date.now()}@careerflow.test`,
    password: crypto.randomUUID(),
  }),
});
assert.equal(registration.ok, true);
const session = await registration.json();
const cookie = registration.headers.get('set-cookie')!.split(';')[0];
async function request(path: string, body?: unknown) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  assert.equal(response.ok, true, JSON.stringify(result));
  return result;
}
let form = structuredClone(blankProfile);
let thread = await request('/profile-threads', { currentProfile: form, mode: 'build' });
const prompts = [
  "Hi, I'm Alex Chen. I'm based in Sydney and will finish university in November 2026. I'm looking for a full-time Graduate Business Analyst role, with Junior Product Analyst as a second option. I'd prefer Sydney-based or hybrid work. I enjoy understanding business problems, working with data and helping teams improve their processes. Please help me build my profile from scratch. Ask one question at a time and keep all profile content in English.",
  "I'm studying a Bachelor of Commerce at the University of Sydney. My major is Business Analytics. I started in February 2024 and expect to graduate in November 2026. I'm still studying. My relevant coursework includes Business Statistics, Database Systems, Operations Management, Information Systems and Data Visualisation. I use Excel, SQL and Tableau in my coursework. Please keep my expected graduation separate from a completed qualification.",
  'From November 2025 to February 2026, I worked as a Business Analyst Intern at Northstar Logistics in Sydney. I supported an operations analyst with weekly delivery-performance reporting. I used SQL to extract order records and Excel pivot tables to summarise delivery delays. The weekly dataset usually contained around 2,000 orders. I checked missing values and inconsistent delay categories, prepared the reporting workbook and discussed unusual results with my supervisor. I supported the analysis; I did not manage the operations team.',
];
const turns: unknown[] = [];
try {
  for (const [i, text] of prompts.entries()) {
    const started = Date.now();
    thread = await request(`/profile-threads/${thread.id}/messages`, {
      text,
      currentProfile: form,
      revision: thread.revision,
      consent: true,
      mode: 'build',
    });
    const reply = thread.messages.at(-1);
    const pending = thread.proposals.filter((p: any) => p.status === 'PENDING');
    turns.push({
      turn: i + 1,
      elapsedMs: Date.now() - started,
      reply,
      fields: pending.map((p: any) => p.field),
    });
    console.log(JSON.stringify(turns.at(-1)));
    assert.equal(Boolean(reply.failed), false, JSON.stringify(reply.diagnostic));
    if (i === 2) {
      const work = pending.find((p: any) => p.field === 'workExperiences');
      assert.ok(work, 'No work experience proposal');
      assert.ok(
        work.after.some(
          (r: any) =>
            r.title === 'Business Analyst Intern' &&
            r.organisation === 'Northstar Logistics' &&
            r.startMonth === '2025-11' &&
            r.endMonth === '2026-02',
        ),
      );
    }
    if (pending.length) {
      const accepted = await request(`/profile-threads/${thread.id}/proposals`, {
        currentProfile: form,
        revision: thread.revision,
        reviewed: true,
      });
      form = accepted.data;
      thread = accepted.thread;
    }
  }
  const workspace = await request('/workspace');
  assert.equal(workspace.profile, null);
  const historyStarted = Date.now();
  thread = await request(`/profile-threads/${thread.id}/messages`, {
    text: 'Please search my saved original Northstar Logistics answer for the weekly order count and retain that original statement in the experience. Do not infer a number.',
    currentProfile: form,
    revision: thread.revision,
    consent: true,
    mode: 'edit',
  });
  const historyReply = thread.messages.at(-1);
  turns.push({
    turn: 'history-search',
    elapsedMs: Date.now() - historyStarted,
    reply: historyReply,
  });
  console.log(JSON.stringify(turns.at(-1)));
  assert.equal(Boolean(historyReply.failed), false, JSON.stringify(historyReply.diagnostic));
  assert.ok(
    historyReply.historySearches?.length > 0,
    'The model did not search the previous answer',
  );
  console.log(
    'PASS: all three scenario turns completed, internship accepted into draft, live history search used, no profile approval.',
  );
} finally {
  await mkdir('output/diagnostics', { recursive: true });
  await writeFile(
    'output/diagnostics/profile-live.json',
    JSON.stringify(
      { accountId: session.user.id, threadId: thread.id, turns, workingForm: form },
      null,
      2,
    ),
  );
}
