import { tool } from 'ai';
import { z } from 'zod';
import {
  MAX_QUERY_LENGTH,
  MAX_RESULTS,
  clampMaxResults,
  searchWeb,
} from '../server/web-search';

/**
 * AI SDK tool wrapper around the shared server-side Tavily integration.
 *
 * Used by `api/chat.ts`. The DashScope and OpenRouter proxies use the same
 * `searchWeb` implementation through their own tool-call loop, so there is a
 * single source of truth for credentials, validation, and error handling.
 */
export const webSearchTool = tool({
  description:
    'Search the public web for current events, live data, recent facts, news, or information not covered by your training data. Returns titles, URLs, and snippets.',
  inputSchema: z.object({
    query: z
      .string()
      .min(2)
      .max(MAX_QUERY_LENGTH)
      .describe('A concise, self-contained search query.'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(MAX_RESULTS)
      .optional()
      .describe('Number of results to return.'),
  }),
  execute: async ({ query, max_results }: { query: string; max_results?: number }) => {
    const response = await searchWeb(query, { maxResults: clampMaxResults(max_results) });
    return {
      query: response.query,
      results: response.results,
      note: 'Cite these sources by their original URLs. Do not invent additional sources.',
    };
  },
});
