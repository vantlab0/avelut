import { describe, it, expect, vi } from 'vitest';
import { webSearchTool } from '../tools/web-search';

describe('webSearchTool', () => {
  it('should have web_search schema and description', () => {
    expect(webSearchTool.description).toContain('Search the web');
  });

  it('should execute fallback when no api key is configured', async () => {
    const result = await (webSearchTool as any).execute({ query: 'quantum computing' });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('title');
    expect(result[0]).toHaveProperty('url');
  });
});
