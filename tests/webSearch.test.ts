import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RESULTS,
  MAX_QUERY_LENGTH,
  MAX_RESULTS,
  WebSearchError,
  clampMaxResults,
  isWebSearchConfigured,
  normalizeSearchQuery,
  searchWeb,
} from '../lib/server/web-search';

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('search configuration and validation', () => {
  it('never reads client-exposed VITE variables and remains available via fallback', () => {
    vi.stubEnv('VITE_TAVILY_API_KEY', 'leaked-key');
    vi.stubEnv('TAVILY_API_KEY', '');
    expect(isWebSearchConfigured()).toBe(true);
    vi.stubEnv('TAVILY_API_KEY', 'server-key');
    expect(isWebSearchConfigured()).toBe(true);
  });

  it('normalizes whitespace and rejects empty or oversized queries', () => {
    expect(normalizeSearchQuery('  latest   AI news  ')).toBe('latest AI news');
    expect(() => normalizeSearchQuery(' ')).toThrow(WebSearchError);
    expect(() => normalizeSearchQuery(123)).toThrow(WebSearchError);
    expect(() => normalizeSearchQuery('x'.repeat(MAX_QUERY_LENGTH + 1))).toThrow(WebSearchError);
  });

  it('clamps result limits to the supported range', () => {
    expect(clampMaxResults(undefined)).toBe(DEFAULT_RESULTS);
    expect(clampMaxResults(0)).toBe(1);
    expect(clampMaxResults(100)).toBe(MAX_RESULTS);
    expect(clampMaxResults('3')).toBe(3);
    expect(clampMaxResults('nonsense')).toBe(DEFAULT_RESULTS);
  });

  it('falls back to public search when Tavily is unconfigured', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('duckduckgo.com/html')) {
        return new Response(
          '<h2 class="result__title"><a class="result__url" href="https://example.com/article">Example Article</a></h2><a class="result__snippet">A useful snippet.</a>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        );
      }
      return new Response('', { status: 404 });
    });

    const response = await searchWeb('latest news', { env: {}, fetchImpl });
    expect(response.query).toBe('latest news');
    expect(response.results.length).toBeGreaterThan(0);
    expect(response.results[0].url).toBe('https://example.com/article');
  });
});

describe('searchWeb', () => {
  it('returns normalized Tavily results with original URLs', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        results: [
          {
            title: 'AI update',
            url: 'https://www.example.com/news/ai',
            content: 'A current summary.',
            score: 0.91,
          },
          { title: 'Invalid URL', url: 'javascript:alert(1)', content: 'ignored' },
          { title: '', url: 'https://second.example.org/page', content: 'Second result.' },
          { title: 'Duplicate', url: 'https://www.example.com/news/ai', content: 'duplicate' },
        ],
      })
    );

    const response = await searchWeb(' latest AI news ', {
      env: { TAVILY_API_KEY: 'test-key' },
      maxResults: 5,
      fetchImpl,
    });

    expect(response.query).toBe('latest AI news');
    expect(response.results).toHaveLength(2);
    expect(response.results[0]).toEqual({
      title: 'AI update',
      url: 'https://www.example.com/news/ai',
      snippet: 'A current summary.',
      source: 'example.com',
      publishedAt: undefined,
      score: 0.91,
    });
    expect(response.results[1].title).toBe('second.example.org');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.tavily.com/search');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ query: 'latest AI news', max_results: 5, search_depth: 'basic' });
  });

  it('throws a typed upstream error on provider HTTP failures', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 429 }));
    await expect(
      searchWeb('latest news', { env: { TAVILY_API_KEY: 'key' }, fetchImpl })
    ).rejects.toMatchObject({ code: 'WEB_SEARCH_UPSTREAM_ERROR', status: 429 });
  });

  it('throws when the provider response is structurally invalid', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ answer: 'no results key' }));
    await expect(
      searchWeb('latest news', { env: { TAVILY_API_KEY: 'key' }, fetchImpl })
    ).rejects.toMatchObject({ code: 'WEB_SEARCH_INVALID_RESPONSE', status: 502 });
  });

  it('rejects immediately when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn();
    await expect(
      searchWeb('latest news', {
        env: { TAVILY_API_KEY: 'key' },
        fetchImpl,
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ code: 'WEB_SEARCH_TIMEOUT', status: 499 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps network failures to a typed upstream error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      searchWeb('latest news', { env: { TAVILY_API_KEY: 'key' }, fetchImpl })
    ).rejects.toMatchObject({ code: 'WEB_SEARCH_UPSTREAM_ERROR', status: 502 });
  });
});
