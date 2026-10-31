import { it, expect, vi, afterEach } from 'vitest';
import { modelRoute, routerSettings } from '../packages/agents/src/router.js';
afterEach(() => vi.unstubAllEnvs());
it('keeps main text, economical text and vision assignments independent without exposing secrets', () => {
  vi.stubEnv('OPENAI_NATIVE_API_KEY', '');
  vi.stubEnv('OPENAI_NATIVE_TEXT_MODEL', '');
  vi.stubEnv('OPENAI_NATIVE_LIGHT_MODEL', '');
  vi.stubEnv('OPENAI_NATIVE_VISION_MODEL', '');
  vi.stubEnv('OPENAI_API_KEY', 'test-key-never-expose');
  vi.stubEnv('OPENAI_BASE_URL', 'https://api.groq.com/openai/v1');
  vi.stubEnv('VISION_BASE_URL', 'https://api.groq.com/openai/v1');
  vi.stubEnv('OPENAI_MODEL', 'openai/gpt-oss-120b');
  vi.stubEnv('TEXT_MODEL', '');
  vi.stubEnv('LIGHT_TEXT_MODEL', 'openai/gpt-oss-20b');
  vi.stubEnv('VISION_MODEL', 'qwen/qwen3.8-27b');
  vi.stubEnv('VISION_API_KEY', '');
  expect(modelRoute('text').model).toBe('openai/gpt-oss-120b');
  expect(modelRoute('light').model).toBe('openai/gpt-oss-20b');
  expect(modelRoute('vision').model).toBe('qwen/qwen3.8-27b');
  expect(modelRoute('vision').apiKey).toBe('test-key-never-expose');
  expect(JSON.stringify(routerSettings())).not.toContain('test-key');
  vi.stubEnv('OPENAI_BASE_URL', 'https://api.openai.com/v1');
  expect(modelRoute('vision').apiKey).toBe('');
  expect(routerSettings().visionConfigured).toBe(false);
});

it('uses an independent native OpenAI configuration as an all-route override', () => {
  vi.stubEnv('OPENAI_API_KEY', 'groq-key-never-use');
  vi.stubEnv('OPENAI_BASE_URL', 'https://api.groq.com/openai/v1');
  vi.stubEnv('OPENAI_MODEL', 'openai/gpt-oss-120b');
  vi.stubEnv('OPENAI_NATIVE_API_KEY', 'native-key-never-expose');
  vi.stubEnv('OPENAI_NATIVE_BASE_URL', 'https://api.openai.com/v1');
  vi.stubEnv('OPENAI_NATIVE_TEXT_MODEL', 'native-text-model');
  vi.stubEnv('OPENAI_NATIVE_LIGHT_MODEL', 'native-light-model');
  vi.stubEnv('OPENAI_NATIVE_VISION_MODEL', 'native-vision-model');

  expect(modelRoute('text')).toMatchObject({
    model: 'native-text-model',
    baseURL: 'https://api.openai.com/v1',
    apiKey: 'native-key-never-expose',
  });
  expect(modelRoute('light').model).toBe('native-light-model');
  expect(modelRoute('vision').model).toBe('native-vision-model');
  expect(routerSettings().visionConfigured).toBe(true);
  expect(JSON.stringify(routerSettings())).not.toContain('native-key');
  expect(JSON.stringify(routerSettings())).not.toContain('groq-key');
});

it('falls native light and vision routes back to the native text model', () => {
  vi.stubEnv('OPENAI_NATIVE_API_KEY', 'native-key');
  vi.stubEnv('OPENAI_NATIVE_BASE_URL', '');
  vi.stubEnv('OPENAI_NATIVE_TEXT_MODEL', 'native-shared-model');
  vi.stubEnv('OPENAI_NATIVE_LIGHT_MODEL', '');
  vi.stubEnv('OPENAI_NATIVE_VISION_MODEL', '');

  expect(modelRoute('text').model).toBe('native-shared-model');
  expect(modelRoute('light').model).toBe('native-shared-model');
  expect(modelRoute('vision').model).toBe('native-shared-model');
  expect(modelRoute('vision').baseURL).toBe('https://api.openai.com/v1');
});
