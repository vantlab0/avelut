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
    if (apiKey) {
      try {
        const tvly = tavily({ apiKey });
        const response = await tvly.search(query, { maxResults: 5 });
        return response.results.map((r: any) => ({
          title: r.title,
          url: r.url,
          content: r.content,
        }));
      } catch (err) {
        console.warn('Tavily client search failed, trying fallback fetch:', err);
      }
    }

    // Direct HTTP fetch fallback
    try {
      const results = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
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
    } catch (e) {
      console.error('Web search execution error:', e);
    }

    // Fallback stub results if API key not present or fetch fails
    return [
      {
        title: `Search results for ${query}`,
        url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        content: `Search result data for query: ${query}`,
      },
    ];
  },
});
