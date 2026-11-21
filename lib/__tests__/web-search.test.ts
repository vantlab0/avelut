import { describe, it, expect, vi, afterEach } from 'vitest';
import { webSearchTool } from '../tools/web-search';
import { searchWeb } from '../server/web-search';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('webSearchTool', () => {
  it('should have web_search schema and description', () => {
    expect(webSearchTool.description).toContain('current events');
  });

  it('falls back to public search when no API key is configured', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('duckduckgo.com/html')) {
        return new Response(
          '<h2 class="result__title"><a class="result__url" href="https://example.com/quantum">Quantum</a></h2><a class="result__snippet">Quantum computing basics.</a>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        );
      }
      return new Response('', { status: 404 });
    });
    const result = await searchWeb('quantum computing', { env: {}, fetchImpl });
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('propagates fallback results through the AI SDK tool', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('duckduckgo.com/html')) {
        return new Response(
          '<h2 class="result__title"><a class="result__url" href="https://example.com/quantum">Quantum</a></h2><a class="result__snippet">Quantum computing basics.</a>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        );
      }
      return new Response('', { status: 404 });
    }));
    const result = await (webSearchTool as unknown as {
      execute: (args: { query: string }) => Promise<any>;
    }).execute({ query: 'quantum computing' });
    expect(result.results.length).toBeGreaterThan(0);
  });
});
