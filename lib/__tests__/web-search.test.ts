import { describe, it, expect, vi } from 'vitest';
import { webSearchTool } from '../tools/web-search';

describe('webSearchTool', () => {
  it('should have web_search schema and description', () => {
    expect(webSearchTool.description).toContain('Search the web');
  });

  it('should return error when no api key is configured', async () => {
    const result = await (webSearchTool as any).execute({ query: 'quantum computing' });
    if (!process.env.TAVILY_API_KEY && !process.env.VITE_TAVILY_API_KEY && !process.env.NEXT_PUBLIC_TAVILY_API_KEY) {
      expect(result).toHaveProperty('error');
      expect((result as any).error).toContain('Web search is not configured');
    } else {
      expect(Array.isArray(result) || (result && 'error' in result)).toBe(true);
    }
  });
});
