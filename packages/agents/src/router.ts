// Routing is deterministic. Model output never controls tools, approvals or access.
export function modelRoute(task: 'text' | 'light' | 'vision') {
  const nativeKey = process.env.OPENAI_NATIVE_API_KEY?.trim() || '';
  if (nativeKey) {
    const textModel = process.env.OPENAI_NATIVE_TEXT_MODEL?.trim() || '';
    return {
      task,
      model:
        (task === 'light' ? process.env.OPENAI_NATIVE_LIGHT_MODEL?.trim() : '') ||
        (task === 'vision' ? process.env.OPENAI_NATIVE_VISION_MODEL?.trim() : '') ||
        textModel,
      baseURL: process.env.OPENAI_NATIVE_BASE_URL?.trim() || 'https://api.openai.com/v1',
      apiKey: nativeKey,
    };
  }

  const baseURL = process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1';
  const sharedKey = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || '';
  if (task === 'vision') {
    const visionURL = process.env.VISION_BASE_URL || 'https://api.groq.com/openai/v1';
    let sameProvider = false;
    try {
      sameProvider = new URL(baseURL).origin === new URL(visionURL).origin;
    } catch {}
    return {
      task,
      model: process.env.VISION_MODEL || 'qwen/qwen3.8-27b',
      baseURL: visionURL,
      apiKey: process.env.VISION_API_KEY || (sameProvider ? sharedKey : ''),
    };
  }
  return {
    task,
    model:
      (task === 'light' ? process.env.LIGHT_TEXT_MODEL : '') ||
      process.env.TEXT_MODEL ||
      process.env.OPENAI_MODEL ||
      'openai/gpt-oss-120b',
    baseURL,
    apiKey: sharedKey,
  };
}
export function routerSettings() {
  return {
    strategy: 'rules',
    textModel: modelRoute('text').model,
    lightModel: modelRoute('light').model,
    visionModel: modelRoute('vision').model,
    visionConfigured: Boolean(modelRoute('vision').apiKey),
    localFirst: true,
  };
}
export function pageRoute(text: string, imageOnly = false) {
  const letters = text.match(/[\p{L}\p{N}]/gu)?.length || 0;
  const corrupt = (text.match(/\uFFFD/g)?.length || 0) / Math.max(text.length, 1);
  return imageOnly || letters < 40 || corrupt > 0.03 ? 'vision' : 'text';
}
