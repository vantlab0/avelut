/**
 * Server-side web search integration (Tavily).
 *
 * Search credentials must stay on the server. We deliberately do not read
 * `VITE_*` / `NEXT_PUBLIC_*` variables here: those are bundled into the client
 * and would leak the key to every user.
 */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedAt?: string;
  score?: number;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
}

export type WebSearchErrorCode =
  | 'WEB_SEARCH_NOT_CONFIGURED'
  | 'WEB_SEARCH_INVALID_QUERY'
  | 'WEB_SEARCH_TIMEOUT'
  | 'WEB_SEARCH_UPSTREAM_ERROR'
  | 'WEB_SEARCH_INVALID_RESPONSE';

export class WebSearchError extends Error {
  readonly code: WebSearchErrorCode;
  readonly status: number;

  constructor(code: WebSearchErrorCode, message: string, status = 500) {
    super(message);
    this.name = 'WebSearchError';
    this.code = code;
    this.status = status;
  }

  /** Message that is safe to show to end users. */
  toPublicMessage(): string {
    switch (this.code) {
      case 'WEB_SEARCH_NOT_CONFIGURED':
        return 'Web search is not configured on this deployment.';
      case 'WEB_SEARCH_INVALID_QUERY':
        return 'The search query was empty or too long.';
      case 'WEB_SEARCH_TIMEOUT':
        return 'The web search provider timed out.';
      case 'WEB_SEARCH_INVALID_RESPONSE':
        return 'The web search provider returned an unreadable response.';
      default:
        return 'The web search provider is temporarily unavailable.';
    }
  }
}

export const WEB_SEARCH_ENV_VAR = 'TAVILY_API_KEY';
export const MAX_QUERY_LENGTH = 400;
export const MIN_QUERY_LENGTH = 2;
export const MAX_RESULTS = 8;
export const DEFAULT_RESULTS = 5;
export const SEARCH_TIMEOUT_MS = 12000;

export type SearchEnv = Record<string, string | undefined>;

/** Resolve the server-side search key. Never falls back to a public env var. */
export function getSearchApiKey(env: SearchEnv = process.env): string | null {
  const key = env[WEB_SEARCH_ENV_VAR]?.trim();
  return key ? key : null;
}

export function isWebSearchConfigured(env: SearchEnv = process.env): boolean {
  return Boolean(getSearchApiKey(env));
}

export function normalizeSearchQuery(input: unknown): string {
  if (typeof input !== 'string') {
    throw new WebSearchError('WEB_SEARCH_INVALID_QUERY', 'Search query must be a string.', 400);
  }
  const query = input.replace(/\s+/g, ' ').trim();
  if (query.length < MIN_QUERY_LENGTH) {
    throw new WebSearchError('WEB_SEARCH_INVALID_QUERY', 'Search query is too short.', 400);
  }
  if (query.length > MAX_QUERY_LENGTH) {
    throw new WebSearchError(
      'WEB_SEARCH_INVALID_QUERY',
      `Search query exceeds ${MAX_QUERY_LENGTH} characters.`,
      400
    );
  }
  return query;
}

export function clampMaxResults(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_RESULTS;
  return Math.min(MAX_RESULTS, Math.max(1, Math.trunc(parsed)));
}

function toSourceName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return 'web';
  }
}

function parseTavilyResults(query: string, payload: unknown, limit: number = MAX_RESULTS): WebSearchResponse {
  const data = payload as { results?: unknown } | null;
  if (!data || !Array.isArray(data.results)) {
    throw new WebSearchError(
      'WEB_SEARCH_INVALID_RESPONSE',
      'Search provider response did not contain a results array.',
      502
    );
  }

  const results: WebSearchResult[] = [];
  const seenUrls = new Set<string>();
  for (const raw of data.results) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    if (!/^https?:\/\//i.test(url) || seenUrls.has(url)) continue;
    const title = typeof item.title === 'string' && item.title.trim()
      ? item.title.trim()
      : toSourceName(url);
    const snippet = typeof item.content === 'string'
      ? item.content.trim()
      : (typeof item.snippet === 'string' ? item.snippet.trim() : '');
    seenUrls.add(url);
    results.push({
      title,
      url,
      snippet,
      source: toSourceName(url),
      publishedAt: typeof item.published_date === 'string' ? item.published_date : undefined,
      score: typeof item.score === 'number' ? item.score : undefined,
    });
    if (results.length >= Math.min(limit, MAX_RESULTS)) break;
  }

  return { query, results };
}

export interface SearchWebOptions {
  maxResults?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: SearchEnv;
  fetchImpl?: typeof fetch;
}

/**
 * Execute a web search. Throws a typed `WebSearchError` on every failure —
 * callers must never substitute fabricated results.
 */
export async function searchWeb(
  rawQuery: unknown,
  options: SearchWebOptions = {}
): Promise<WebSearchResponse> {
  const query = normalizeSearchQuery(rawQuery);
  const env = options.env ?? process.env;
  const apiKey = getSearchApiKey(env);
  if (!apiKey) {
    throw new WebSearchError(
      'WEB_SEARCH_NOT_CONFIGURED',
      `Web search requires the ${WEB_SEARCH_ENV_VAR} environment variable.`,
      503
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const maxResults = clampMaxResults(options.maxResults);
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? SEARCH_TIMEOUT_MS, 1000), 30000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer);
      throw new WebSearchError('WEB_SEARCH_TIMEOUT', 'Search aborted by the caller.', 499);
    }
    options.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const response = await fetchImpl('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        search_depth: 'basic',
        include_answer: false,
        include_raw_content: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const upstreamText = await response.text().catch(() => '');
      // Log only the provider status + a bounded snippet; the API key is never logged.
      console.error('[web_search] Tavily HTTP error', {
        status: response.status,
        detail: upstreamText.slice(0, 300),
      });
      throw new WebSearchError(
        'WEB_SEARCH_UPSTREAM_ERROR',
        `Web search provider returned HTTP ${response.status}.`,
        response.status === 429 ? 429 : 502
      );
    }

    const payload = await response.json();
    return parseTavilyResults(query, payload, maxResults);
  } catch (error) {
    if (error instanceof WebSearchError) throw error;
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new WebSearchError('WEB_SEARCH_TIMEOUT', 'Web search timed out.', 504);
    }
    console.error('[web_search] request failed', (error as Error)?.message || error);
    throw new WebSearchError('WEB_SEARCH_UPSTREAM_ERROR', 'Web search request failed.', 502);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/** OpenAI-compatible function definition understood by DashScope and OpenRouter. */
export const WEB_SEARCH_TOOL_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description:
      'Search the public web for current events, live data, recent facts, news, or information that may be newer than your training data. Returns titles, URLs, and snippets. Use the original URLs when citing.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'A concise, self-contained search query (2-400 characters).',
        },
        max_results: {
          type: 'integer',
          description: `Number of results to return (1-${MAX_RESULTS}).`,
          minimum: 1,
          maximum: MAX_RESULTS,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
} as const;

export const WEB_SEARCH_SYSTEM_INSTRUCTION = [
  'You have access to a real web_search tool.',
  'Use it whenever the user asks about current events, live data, prices, news, or facts that may have changed after your training data.',
  'After using it, base your answer on the returned results and cite each source inline with markdown links using its original URL.',
  'End the answer with a "Sources" section listing the titles and URLs you actually used.',
  'Never invent search results or citations. If the tool returns an error, tell the user the search failed and answer from general knowledge while clearly labelling it as such.',
].join(' ');

export const WEB_SEARCH_UNAVAILABLE_INSTRUCTION = [
  'The user enabled web browsing, but web search is not configured on this deployment.',
  'Do not claim to have searched the web and do not invent citations.',
  'If the answer depends on current information, clearly tell the user that live web search is unavailable.',
].join(' ');
