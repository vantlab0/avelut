import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  normalizeAlibabaDashScopeModel,
  createAvelutAI,
} from '../../utils/inference';
import { compressBase64Image } from '../../utils/mediaUpload';
import { AVELUT_TEXT_MODEL } from '../../lib/textModel';

describe('Multimodal Pipeline and 429 Rate Limiting Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('0. All text model inputs normalize to qwen3.7-flash', () => {
    expect(normalizeAlibabaDashScopeModel('qwen/qwen3.7-flash', true, true)).toBe(AVELUT_TEXT_MODEL);
    expect(normalizeAlibabaDashScopeModel('qwen3.5-omni-flash', false, false)).toBe(AVELUT_TEXT_MODEL);
    expect(normalizeAlibabaDashScopeModel('qwen3.8-max')).toBe(AVELUT_TEXT_MODEL);
    expect(normalizeAlibabaDashScopeModel()).toBe(AVELUT_TEXT_MODEL);
  });

  test('1. Image downscaling and base64 compression helper', async () => {
    const rawDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const result = await compressBase64Image(rawDataUrl, 1600, 0.82);
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });

  test('2. Bounded exponential backoff and fallback on 429 rate limit', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    // Return 429 for initial Alibaba calls
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '1' }),
      text: async () => JSON.stringify({ error: 'RATE_LIMIT', message: 'Upstream provider is temporarily overloaded.' }),
    } as Response);

    const appSettings: any = {};

    const ai = createAvelutAI(appSettings, null);

    const callPromise = ai.models.generateContent({
      model: AVELUT_TEXT_MODEL,
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: 'abc' } },
          { text: 'Analyze this' },
        ],
      }],
    });

    await expect(callPromise).rejects.toThrow(/temporarily busy/);

    // Verify retries occurred
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
  }, 30000);

  test('4. Title generation prompt excludes images', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ choices: [{ message: { content: 'Calculus Concept Overview' } }] }),
    } as Response);

    const appSettings: any = {};
    const ai = createAvelutAI(appSettings, null);

    const result = await ai.models.generateContent({
      model: AVELUT_TEXT_MODEL,
      contents: [{
        role: 'user',
        parts: [{ text: 'Summarize text prompt into short title: Calculus limits and derivatives' }],
      }],
    });

    expect(fetchSpy).toHaveBeenCalled();
    const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    const userMessageContent = requestBody.messages[0].content;
    expect(JSON.stringify(userMessageContent)).not.toContain('image_url');
  });
});
