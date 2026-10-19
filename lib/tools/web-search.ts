import { tool } from 'ai';
import { z } from 'zod';
import { tavily } from '@tavily/core';

export const webSearchTool = tool({
  description: 'Search the web for current information and return the top results.',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
  }),
  execute: async ({ query }: { query: string }) => {
    const apiKey = process.env.TAVILY_API_KEY || process.env.VITE_TAVILY_API_KEY;
    if (!apiKey) {
      console.error('[web_search] TAVILY_API_KEY is not set');
      return { error: 'Web search is not configured. Missing TAVILY_API_KEY.' };
    }

    try {
      const tvly = tavily({ apiKey });
      const response = await tvly.search(query, { maxResults: 5 });
      return response.results.map((r: any) => ({
        title: r.title,
        url: r.url,
        content: r.content,
      }));
    } catch (err: any) {
      console.warn('Tavily client search failed, trying fallback fetch:', err);
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
        } else {
          const errText = await results.text();
          console.error('Web search HTTP fallback error:', errText);
          return { error: `Web search failed: ${results.statusText || 'HTTP error'}` };
        }
      } catch (e: any) {
        console.error('Web search execution error:', e);
        return { error: `Web search failed: ${e?.message || 'Network error'}` };
      }
    }
  },
});
