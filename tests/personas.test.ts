import { expect, it } from 'vitest';
import { guardIdentity, rolePreamble } from '../packages/agents/src/personas.js';

// CFS-132: user-facing agents speak as party members and never as another product.

it('opens user-facing instructions with a persona, its scope and the off-topic rule', () => {
  const p = rolePreamble('conversation');
  expect(p).toContain('the Profile Builder');
  expect(p).toContain('never say you are ChatGPT');
  expect(p).toContain('Do not answer the off-topic request');
  expect(rolePreamble('evaluator')).toContain('the Panel');
  // Internal specialists keep the plain preamble.
  expect(rolePreamble('matching')).toBe('You are one specialist in CareerFlow AI. ');
});

it('replaces a vendor self-description with the persona introduction', () => {
  const reply =
    'I’m ChatGPT, an AI assistant. I can help with your career profile, job applications, and interview preparation.';
  const out = guardIdentity(reply, 'conversation');
  expect(out).not.toMatch(/ChatGPT/);
  expect(out).toMatch(/^I’m the Profile Builder in CareerFlow/);
  expect(out).toContain('I can help with your career profile');
  expect(guardIdentity('As an AI language model developed by OpenAI, I cannot.', 'coach')).toMatch(
    /^I’m the Coach in CareerFlow/,
  );
  // Ordinary replies pass through unchanged.
  expect(guardIdentity('Which project should we start with?', 'conversation')).toBe(
    'Which project should we start with?',
  );
});
