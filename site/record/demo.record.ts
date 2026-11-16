import { writeFileSync } from 'node:fs';
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { fillProfileFixture } from '../../tests/e2e/profile-fixture.js';
import { go } from '../../tests/e2e/nav.js';
import { sampleProfile } from '../../packages/contracts/src/index.js';

// The landing-page walkthrough (CFS-163, slowed down in CFS-185): one fictional candidate from
// sign-up to the battle report, then the pages around it. A caption names each step and a drawn
// cursor shows where the click goes, so the video can be followed without sound.

// Stills for the site carry no caption or cursor; `top` scrolls to the top of the page first.
async function shot(page: Page, name: string, top = false) {
  if (top) await page.evaluate(() => scrollTo(0, 0));
  await page
    .addStyleTag({ content: '#rec-cap, #rec-cur, .rec-ring { visibility: hidden !important; }' })
    .then((tag) => tag.evaluate((el) => (el.id = 'rec-hide')));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `site/assets/${name}.png`, fullPage: false });
  await page.evaluate(() => document.getElementById('rec-hide')?.remove());
  if (top) await page.waitForTimeout(400);
}
const pause = (page: Page, ms = 2200) => page.waitForTimeout(ms);

// Caption pill and cursor drawn into every page of the recording.
const overlay = () => {
  const style = document.createElement('style');
  style.textContent = `
    #rec-cap { position: fixed; left: 50%; bottom: 28px; translate: -50% 0; z-index: 2147483647;
      background: #111218; color: #fff; font: 700 20px/1.3 system-ui, sans-serif; padding: 12px 22px;
      border-radius: 999px; border: 3px solid #d4f55b; box-shadow: 0 6px 0 #000; max-width: 80vw;
      text-align: center; transition: opacity .3s; pointer-events: none; }
    #rec-cap b { color: #d4f55b; margin-right: 8px; }
    #rec-cur { position: fixed; z-index: 2147483647; width: 22px; height: 22px; margin: -3px 0 0 -3px;
      pointer-events: none; transition: transform .12s; }
    #rec-cur.down { transform: scale(.82); }
    .rec-ring { position: fixed; z-index: 2147483646; width: 40px; height: 40px; margin: -20px 0 0 -20px;
      border-radius: 50%; border: 3px solid #d4f55b; pointer-events: none; animation: rec-ring .6s ease-out forwards; }
    @keyframes rec-ring { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }`;
  const add = () => {
    if (document.getElementById('rec-cur')) return;
    document.head.appendChild(style);
    const cur = document.createElement('div');
    cur.id = 'rec-cur';
    cur.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7 19 2.6-7.6L20 11z" fill="#fff" stroke="#111218" stroke-width="2" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cur);
    const cap = document.createElement('div');
    cap.id = 'rec-cap';
    cap.style.opacity = '0';
    document.body.appendChild(cap);
    const last = (window as any).__recCap;
    if (last) (window as any).recCaption(last);
  };
  (window as any).recCaption = (html: string) => {
    (window as any).__recCap = html;
    const cap = document.getElementById('rec-cap');
    if (!cap) return;
    cap.innerHTML = html;
    cap.style.opacity = html ? '1' : '0';
  };
  addEventListener('mousemove', (e) => {
    const cur = document.getElementById('rec-cur');
    if (cur) cur.style.left = `${e.clientX}px`;
    if (cur) cur.style.top = `${e.clientY}px`;
  });
  addEventListener('mousedown', (e) => {
    document.getElementById('rec-cur')?.classList.add('down');
    const ring = document.createElement('div');
    ring.className = 'rec-ring';
    ring.style.left = `${e.clientX}px`;
    ring.style.top = `${e.clientY}px`;
    document.body.appendChild(ring);
    setTimeout(() => ring.remove(), 700);
  });
  addEventListener('mouseup', () => document.getElementById('rec-cur')?.classList.remove('down'));
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add);
  else add();
};

const t0 = Date.now();
const chapters: { at: number; label: string }[] = [];
let stepNo = 0;
// `chapter` is the short name of a chapter button under the video; sub-steps have none.
async function step(page: Page, label: string, chapter?: string) {
  stepNo += 1;
  if (chapter)
    chapters.push({ at: Math.max(0, Math.round((Date.now() - t0) / 100) / 10), label: chapter });
  await page.evaluate((html) => (window as any).recCaption?.(html), `<b>${stepNo}</b>${label}`);
  await pause(page, 1400);
}
// Glide the cursor onto an element, then click it.
async function press(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
    await pause(page, 350);
  }
  await target.click();
}
async function type(page: Page, target: Locator, text: string, delay = 28) {
  await press(page, target);
  await target.pressSequentially(text, { delay });
}
async function scrollBy(page: Page, y: number) {
  await page.mouse.wheel(0, y);
  await pause(page, 1200);
}

test('record the CareerFlow walkthrough', async ({ page, browser }) => {
  await page.addInitScript(overlay);
  await page.goto('/');
  await step(page, 'Create an account', 'Sign up');
  await press(page, page.getByRole('button', { name: 'New here? Create an account' }));
  await type(page, page.getByLabel('Your name', { exact: true }), sampleProfile.name, 45);
  await type(
    page,
    page.getByLabel('Email address'),
    `walkthrough-${Date.now()}@careerflow.test`,
    12,
  );
  await type(page, page.getByLabel('Password', { exact: true }), 'Walkthrough-pass-123', 12);
  await press(page, page.getByRole('button', { name: 'Create workspace', exact: true }));
  await expect(page.getByRole('heading', { name: 'Build your profile' })).toBeVisible();

  await step(page, 'Tell the Profile Builder what you have done', 'Profile');
  await pause(page, 2600);
  await shot(page, 'profile-builder');
  await fillProfileFixture(page);
  await pause(page);
  await step(page, 'Nothing counts until you approve it');
  await press(page, page.getByRole('button', { name: 'Review profile draft', exact: true }));
  await pause(page, 2400);
  await press(page, page.getByLabel('I reviewed this exact draft'));
  await press(page, page.getByRole('button', { name: 'Approve & save profile', exact: true }));

  await expect(page.getByRole('heading', { name: 'What’s your next career goal?' })).toBeVisible();
  await step(page, 'Send the party out to find roles', 'Find roles');
  await press(page, page.getByLabel('Demo roles'));
  await press(page, page.getByRole('button', { name: 'Send the party out', exact: true }));
  await expect(page.getByRole('heading', { name: 'Pick a role.', exact: true })).toBeVisible({
    timeout: 60000,
  });
  await step(page, 'Every role shows the fit and the gaps');
  await press(page, page.locator('button.qj-role').first());
  await pause(page, 3000);
  await shot(page, 'shortlist');
  await press(page, page.getByRole('button', { name: 'Select this opportunity' }).first());

  await expect(page.getByRole('heading', { name: 'Review your resume.', exact: true })).toBeVisible(
    { timeout: 60000 },
  );
  await step(page, 'The resume team tailors a resume, every line traced to you', 'Tailored resume');
  await pause(page, 2600);
  await shot(page, 'resume-team');
  await scrollBy(page, 420);
  await scrollBy(page, -420);
  await press(page, page.getByLabel('I read this exact draft.'));
  await press(page, page.getByRole('button', { name: 'Approve this draft', exact: true }));

  await expect(page.getByRole('heading', { name: 'Interview practice', exact: true })).toBeVisible({
    timeout: 60000,
  });
  await step(page, 'The panel interviews you, one stage at a time', 'Interview');
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' }));
  await pause(page, 2600);
  await shot(page, 'interview', true);
  // A live call needs the realtime model, so its picture comes from a second, scripted window.
  await recordLiveCall(browser, page);

  const answer = page.getByLabel('Your answer', { exact: true });
  await type(
    page,
    answer,
    'I want a role where my analysis changes a decision. In my internship I automated a weekly SQL report that the team now uses every Monday.',
    14,
  );
  await press(page, page.getByRole('button', { name: 'Answer', exact: true }));
  await step(page, 'A verdict after every answer, then a follow-up');
  await pause(page, 3200);
  const follow = page.getByLabel('Your follow-up answer', { exact: true });
  if (await follow.isVisible().catch(() => false)) {
    await type(
      page,
      follow,
      'Next I want to learn how analysts at your company turn data into client advice, and grow into a senior analyst.',
      14,
    );
    await press(page, page.getByRole('button', { name: 'Answer the follow-up', exact: true }));
    await pause(page, 3000);
  }
  await step(page, 'Stage two: a real example, told in STAR');
  await type(
    page,
    page.getByLabel(/^Your (follow-up )?answer$/),
    'At my internship the weekly report took four hours and often disagreed with the warehouse system. I had to automate it. I wrote a SQL view and a pandas script, so it now takes fifteen minutes to check.',
    10,
  );
  await press(page, page.getByRole('button', { name: /^Answer( the follow-up)?$/ }));
  await pause(page, 3000);
  await press(
    page,
    page.getByRole('button', {
      name: /^(Retreat · get feedback now|Finish battle · get feedback)$/,
    }),
  );
  await expect(page.getByRole('heading', { name: 'Battle report', exact: true })).toBeVisible({
    timeout: 60000,
  });
  await step(page, 'A graded report for every stage', 'Battle report');
  await page.getByRole('heading', { name: 'Battle report', exact: true }).scrollIntoViewIfNeeded();
  await pause(page, 2600);
  await shot(page, 'battle-report');
  await scrollBy(page, 500);
  await scrollBy(page, 500);

  await step(page, 'Your character: rank and skill levels from evidence', 'Character and evidence');
  await go(page, 'Character');
  await pause(page, 2600);
  await shot(page, 'character', true);
  await page.getByText('Codeforces', { exact: true }).first().scrollIntoViewIfNeeded();
  await step(page, 'Link GitHub, Codeforces and more as evidence');
  await pause(page, 2400);
  await shot(page, 'links');

  await step(page, 'World: what each region asks for', 'World, party, season');
  await go(page, 'World');
  await pause(page, 3000);
  await shot(page, 'world');
  await step(page, 'Meet the party');
  await go(page, 'Party');
  await pause(page, 3000);
  await shot(page, 'party');
  await step(page, 'Season events keep it moving');
  await go(page, 'Season event');
  await pause(page, 3000);
  await shot(page, 'season');
  await step(page, 'Scout keeps watch on a schedule', 'Scout');
  await go(page, 'Scout');
  await pause(page, 2600);
  await shot(page, 'scout');
  await go(page, 'Home');
  await page.evaluate(() => (window as any).recCaption?.(''));
  await pause(page, 1800);
  await shot(page, 'home');
  writeFileSync('site/assets/demo-chapters.json', JSON.stringify(chapters, null, 2) + '\n');
});

// The live call's arena, driven by scripted realtime events in its own window: no microphone,
// no OpenAI. The transcript shown is written for the picture.
async function recordLiveCall(browser: Browser, page: Page) {
  const ctx = await browser.newContext({
    storageState: await page.context().storageState(),
    viewport: { width: 1280, height: 800 },
  });
  const live = await ctx.newPage();
  await live.addInitScript(() => {
    const w = window as any;
    class Channel extends EventTarget {
      readyState = 'open';
      send() {}
    }
    w.__channel = new Channel();
    w.RTCPeerConnection = class {
      ontrack: any = null;
      addTrack() {}
      createDataChannel() {
        setTimeout(() => w.__channel.dispatchEvent(new Event('open')), 10);
        return w.__channel;
      }
      async createOffer() {
        return { type: 'offer', sdp: 'v=0' };
      }
      async setLocalDescription() {}
      async setRemoteDescription() {}
      close() {}
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const dest = ctx.createMediaStreamDestination();
          osc.connect(dest);
          osc.start();
          return dest.stream;
        },
      },
    });
    w.__emit = (event: object) =>
      w.__channel.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }));
  });
  const asLive = (body: any, depth = 0): any => {
    if (!body || typeof body !== 'object' || depth > 3) return body;
    if (body.mode === 'fixture' && body.data) body.mode = 'openai';
    for (const v of Object.values(body)) asLive(v, depth + 1);
    return body;
  };
  await live.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: asLive(await response.json()) });
  });
  await live.route('**/api/voice/status', (route) =>
    route.fulfill({ json: { realtime: true, transcribe: true } }),
  );
  await live.route('**/voice-session', async (route) => {
    const id = new URL(page.url()).searchParams.get('mission');
    const workspace = await (await live.request.get('/api/workspace')).json();
    const questions = workspace.missions.find((m: any) => m.id === id).data.questions;
    await route.fulfill({
      json: {
        clientSecret: 'demo',
        callsUrl: 'https://api.openai.com/v1/realtime/calls',
        limitSeconds: 600,
        questions,
        remaining: 2,
      },
    });
  });
  await live.route('https://api.openai.com/**', (route) =>
    route.fulfill({ body: 'v=0', headers: { 'access-control-allow-origin': '*' } }),
  );
  await live.goto(page.url());
  await live.getByRole('button', { name: /Live call/ }).click();
  await live.getByRole('button', { name: 'Start the voice interview', exact: true }).click();
  const emit = (event: object) => live.evaluate((e) => (window as any).__emit(e), event);
  await emit({
    type: 'response.output_audio_transcript.done',
    transcript:
      'Thanks for coming in today. Question 1. Why this role, and what have you already done that shows it?',
  });
  await emit({ type: 'input_audio_buffer.speech_started' });
  await emit({
    type: 'conversation.item.input_audio_transcription.completed',
    transcript: 'I automated a weekly SQL report in my internship, and I want more work like that.',
  });
  await live.evaluate(() =>
    document.querySelector('.boss-arena')?.scrollIntoView({ block: 'start' }),
  );
  await live.evaluate(() => scrollBy(0, -90));
  await live.waitForTimeout(1500);
  await live.screenshot({ path: 'site/assets/live-call.png', fullPage: false });
  // Hang up before the scripted answer is saved: this window is only for the picture.
  await ctx.close();
}
