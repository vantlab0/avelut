import { describe, it, expect, vi, afterEach } from 'vitest';
import { webSearchTool } from '../tools/web-search';
import { searchWeb } from '../server/web-search';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('webSearchTool', () => {
  it('should have web_search schema and description', () => {
    expect(webSearchTool.description).toContain('current events');
  });

  it('throws a typed configuration error when no API key is configured', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    await expect(searchWeb('quantum computing')).rejects.toMatchObject({
      code: 'WEB_SEARCH_NOT_CONFIGURED',
    });
  });

  it('propagates the configuration error through the AI SDK tool', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    await expect(
      (webSearchTool as unknown as {
        execute: (args: { query: string }) => Promise<unknown>;
      }).execute({ query: 'quantum computing' })
    ).rejects.toMatchObject({ code: 'WEB_SEARCH_NOT_CONFIGURED' });
  });
});
