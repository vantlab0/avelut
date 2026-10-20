import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_TOOL_ITERATIONS,
  appendSourcesIfMissing,
  createSyntheticSseResponse,
  executeWebSearchToolCalls,
  parseToolCalls,
  runWebSearchToolLoop,
  type ToolCall,
} from '../lib/server/web-search-loop';
import type { WebSearchResult } from '../lib/server/web-search';

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const completion = (message: Record<string, unknown>) =>
  jsonResponse({ choices: [{ message, finish_reason: 'stop' }] });

const toolCallCompletion = (id = 'call_1', query = 'latest AI news') =>
  completion({
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id,
        type: 'function',
        function: {
          name: 'web_search',
          arguments: JSON.stringify({ query, max_results: 2 }),
        },
      },
    ],
  });

const tavilyResponse = () =>
  jsonResponse({
    results: [
      { title: 'Result one', url: 'https://one.example.com/a', content: 'First snippet' },
      { title: 'Result two', url: 'https://two.example.com/b', content: 'Second snippet' },
      { title: 'Duplicate', url: 'https://one.example.com/a', content: 'Duplicate' },
    ],
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv('TAVILY_API_KEY', 'test-tavily-key');
});

describe('parseToolCalls', () => {
  it('normalizes valid calls and supplies missing ids', () => {
    const calls = parseToolCalls({
      tool_calls: [
        {
          function: { name: 'web_search', arguments: { query: 'nasa' } },
        },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].id).toMatch(/^call_/);
    expect(calls[0].function.name).toBe('web_search');
    expect(calls[0].function.arguments).toContain('nasa');
  });

  it('ignores malformed calls', () => {
    expect(parseToolCalls({ tool_calls: [null, {}, { function: {} }] })).toEqual([]);
    expect(parseToolCalls(null)).toEqual([]);
  });
});

describe('executeWebSearchToolCalls', () => {
  it('executes web_search and returns sources', async () => {
    const fetchImpl = vi.fn(async () => tavilyResponse());
    const calls: ToolCall[] = [
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'web_search', arguments: '{"query":"AI news","max_results":2}' },
      },
    ];

    const result = await executeWebSearchToolCalls(calls, {
      fetchImpl,
      signal: undefined,
    });
    expect(result).toHaveLength(1);
    expect(result[0].sources).toHaveLength(2);
    const payload = JSON.parse(result[0].message.content);
    expect(payload.results).toHaveLength(2);
    expect(payload.note).toContain('Do not invent');
  });

  it('returns structured errors for unknown tools and invalid arguments', async () => {
    const fetchImpl = vi.fn();
    const result = await executeWebSearchToolCalls(
      [
        {
          id: 'call_unknown',
          type: 'function',
          function: { name: 'run_shell', arguments: '{}' },
        },
        {
          id: 'call_bad_json',
          type: 'function',
          function: { name: 'web_search', arguments: '{not json' },
        },
        {
          id: 'call_empty',
          type: 'function',
          function: { name: 'web_search', arguments: '{"query":""}' },
        },
      ],
      { fetchImpl }
    );

    expect(result.map((item) => item.error)).toEqual([
      'unsupported_tool',
      'invalid_arguments',
      'invalid_query',
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not fabricate sources when the provider fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('upstream down', { status: 500 }));
    const result = await executeWebSearchToolCalls(
      [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'web_search', arguments: '{"query":"AI news"}' },
        },
      ],
      { fetchImpl }
    );

    expect(result[0].sources).toEqual([]);
    expect(result[0].error).toBe('WEB_SEARCH_UPSTREAM_ERROR');
    expect(JSON.parse(result[0].message.content).instruction).toContain('Do not fabricate');
  });

  it('reports missing server configuration through the tool result', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    const fetchImpl = vi.fn();
    const result = await executeWebSearchToolCalls(
      [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'web_search', arguments: '{"query":"AI news"}' },
        },
      ],
      { fetchImpl }
    );

    expect(result[0].error).toBe('WEB_SEARCH_NOT_CONFIGURED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('runWebSearchToolLoop', () => {
  const options = {
    baseUrl: 'https://dashscope.example.com/v1',
    headers: { Authorization: 'Bearer model-key' },
    model: 'qwen3.5-omni-flash',
    messages: [{ role: 'user', content: 'What happened today?' }],
    timeoutMs: 5000,
  };

  it('runs the full search → tool result → final answer cycle', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tavily-key');
    const modelBodies: Array<Record<string, unknown>> = [];
    let modelCall = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('tavily')) {
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tavily-key');
        return tavilyResponse();
      }
      const body = JSON.parse(String(init?.body || '{}'));
      modelBodies.push(body);
      modelCall += 1;
      if (modelCall === 1) return toolCallCompletion();
      return completion({ role: 'assistant', content: 'Today an AI model was announced.' });
    };

    const result = await runWebSearchToolLoop({ ...options, fetchImpl });

    expect(result.usedSearch).toBe(true);
    expect(result.iterations).toBe(2);
    expect(result.sources).toHaveLength(2);
    expect(result.content).toContain('Today an AI model was announced.');
    expect(result.content).toContain('**Sources**');
    expect(result.content).toContain('https://one.example.com/a');
    expect(result.content).toContain('https://two.example.com/b');

    expect(modelBodies).toHaveLength(2);
    expect(modelBodies[0].tools).toBeDefined();
    expect(modelBodies[1].tools).toBeDefined();
    const secondMessages = modelBodies[1].messages as Array<Record<string, unknown>>;
    expect(secondMessages.some((message) => message.role === 'tool')).toBe(true);
  });

  it('does not append a duplicate Sources section when the model cited URLs', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tavily-key');
    let modelCall = 0;
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).includes('tavily')) return tavilyResponse();
      modelCall += 1;
      if (modelCall === 1) return toolCallCompletion();
      return completion({
        role: 'assistant',
        content: 'According to [one](https://one.example.com/a), it happened.',
      });
    };

    const result = await runWebSearchToolLoop({ ...options, fetchImpl });
    expect(result.content).toBe('According to [one](https://one.example.com/a), it happened.');
  });

  it('feeds malformed tool arguments back to the model without searching', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tavily-key');
    const providerCalls: string[] = [];
    let modelCall = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      providerCalls.push(url);
      if (url.includes('tavily')) return tavilyResponse();
      const body = JSON.parse(String(init?.body || '{}'));
      modelCall += 1;
      if (modelCall === 1) {
        return completion({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'bad',
              type: 'function',
              function: { name: 'web_search', arguments: '{"query":' },
            },
          ],
        });
      }
      const toolMessage = (body.messages as Array<Record<string, unknown>>).find(
        (message) => message.role === 'tool'
      );
      expect(String(toolMessage?.content)).toContain('invalid_arguments');
      return completion({ role: 'assistant', content: 'The search could not run.' });
    };

    const result = await runWebSearchToolLoop({ ...options, fetchImpl });
    expect(result.content).toBe('The search could not run.');
    expect(result.sources).toEqual([]);
    expect(providerCalls.some((url) => url.includes('tavily'))).toBe(false);
  });

  it('forces a final text answer after the maximum tool rounds', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tavily-key');
    const modelBodies: Array<Record<string, unknown>> = [];
    let tavilyCalls = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('tavily')) {
        tavilyCalls += 1;
        return tavilyResponse();
      }
      const body = JSON.parse(String(init?.body || '{}'));
      modelBodies.push(body);
      if (body.tools) return toolCallCompletion(`call_${modelBodies.length}`);
      return completion({ role: 'assistant', content: 'Final answer after the limit.' });
    };

    const result = await runWebSearchToolLoop({ ...options, fetchImpl, maxIterations: 3 });

    expect(result.iterations).toBe(MAX_TOOL_ITERATIONS);
    expect(tavilyCalls).toBe(MAX_TOOL_ITERATIONS);
    expect(result.content).toContain('Final answer after the limit.');
    expect(modelBodies).toHaveLength(MAX_TOOL_ITERATIONS + 1);
    expect(modelBodies[modelBodies.length - 1].tools).toBeUndefined();
  });

  it('rejects an empty final answer instead of returning a blank message', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tavily-key');
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).includes('tavily')) return tavilyResponse();
      return completion({ role: 'assistant', content: '' });
    };

    await expect(runWebSearchToolLoop({ ...options, fetchImpl })).rejects.toMatchObject({
      code: 'TOOL_LOOP_EMPTY_RESPONSE',
    });
  });

  it('surfaces upstream model failures as a typed loop error', async () => {
    const fetchImpl = vi.fn(async () => new Response('model down', { status: 500 }));
    await expect(runWebSearchToolLoop({ ...options, fetchImpl })).rejects.toMatchObject({
      code: 'TOOL_LOOP_UPSTREAM_ERROR',
      status: 502,
    });
  });
});

describe('appendSourcesIfMissing', () => {
  const sources: WebSearchResult[] = [
    { title: 'One', url: 'https://one.example.com', snippet: 'a', source: 'one.example.com' },
  ];

  it('does nothing when there are no sources', () => {
    expect(appendSourcesIfMissing('Answer', [])).toBe('Answer');
  });

  it('appends a deterministic Sources section when URLs are missing', () => {
    expect(appendSourcesIfMissing('Answer', sources)).toBe(
      'Answer\n\n**Sources**\n- [One](https://one.example.com)'
    );
  });

  it('keeps existing citations unchanged', () => {
    const content = 'See [One](https://one.example.com).';
    expect(appendSourcesIfMissing(content, sources)).toBe(content);
  });
});

describe('createSyntheticSseResponse', () => {
  it('returns one SSE text chunk that existing stream parsers understand', async () => {
    const response = createSyntheticSseResponse('Hello', { 'X-Test': 'yes' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(response.headers.get('X-Test')).toBe('yes');
    const body = await response.text();
    expect(body).toContain('data: {"choices":[{"delta":{"content":"Hello"}');
    expect(body).toContain('data: [DONE]');
  });
});
