import { tool } from 'ai';
import { z } from 'zod';
import { tavily } from '@tavily/core';

export const webSearchTool = tool({
  description: 'Use this tool for current events, live data, recent facts, or anything that may not be in the model training data. Return the top results with title, URL, and content excerpt.',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
  }),
  execute: async ({ query }: { query: string }) => {
    const apiKey = process.env.TAVILY_API_KEY || process.env.VITE_TAVILY_API_KEY || process.env.NEXT_PUBLIC_TAVILY_API_KEY;
    if (!apiKey) {
      console.error('[web_search] TAVILY_API_KEY is not set');
      return {
        error: 'Web search is not configured. Add TAVILY_API_KEY to the environment to enable live search.',
      };
    }

    try {
      const tvly = tavily({ apiKey });
      const response = await tvly.search(query, { maxResults: 5 });
      return (response.results || []).map((r: any) => ({
        title: r.title,
        url: r.url,
        content: r.content,
      }));
    } catch (err: any) {
      console.warn('[web_search] Tavily client search failed, trying fallback fetch:', err);
      try {
        const results = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            api_key: apiKey,
            query,
            max_results: 5,
          }),
        });

        if (results.ok) {
          const data = await results.json();
          return (data.results || []).map((r: any) => ({
            title: r.title,
            url: r.url,
            content: r.content,
          }));
        }

        const errText = await results.text();
        console.error('[web_search] HTTP fallback error:', errText);
        return { error: `Web search failed: ${results.statusText || 'HTTP error'}` };
      } catch (e: any) {
        console.error('[web_search] Execution error:', e);
        return { error: `Web search failed: ${e?.message || 'Network error'}` };
      }
    }
  },
});
