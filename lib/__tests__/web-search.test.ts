import { describe, it, expect, vi } from 'vitest';
import { webSearchTool } from '../tools/web-search';

describe('webSearchTool', () => {
  it('should have web_search schema and description', () => {
    expect(webSearchTool.description).toContain('current events');
  });

  it('should return unconfigured error when no api key is configured', async () => {
    const result = await (webSearchTool as any).execute({ query: 'quantum computing' });
    expect(result).toHaveProperty('error');
    expect(result.error).toContain('Web search is not configured');
  });
});
