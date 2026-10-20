import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../api/alibaba-chat';

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const completion = (message: Record<string, unknown>) =>
  jsonResponse({ choices: [{ message, finish_reason: 'stop' }] });

const chatRequest = (body: Record<string, unknown>) =>
  new Request('https://avelut.example.com/api/alibaba-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Alibaba chat browse gating', () => {
  it('does not attach tools or search keys when browsing is disabled', async () => {
    vi.stubEnv('ALIBABA_API_KEY', 'server-alibaba-key');
    vi.stubEnv('TAVILY_API_KEY', 'server-tavily-key');
    const modelBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        modelBodies.push(JSON.parse(String(init?.body || '{}')));
        return completion({ role: 'assistant', content: 'Standard answer' });
      })
    );

    const response = await POST(
      chatRequest({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'qwen3.5-omni-flash',
        stream: false,
        web_search: false,
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Standard answer');
    expect(modelBodies).toHaveLength(1);
    expect(modelBodies[0].tools).toBeUndefined();
    expect(
      (modelBodies[0].messages as Array<Record<string, unknown>>).some((message) =>
        String(message.content).includes('web_search tool')
      )
    ).toBe(false);
  });

  it('tells the model live search is unavailable instead of pretending when the key is missing', async () => {
    vi.stubEnv('ALIBABA_API_KEY', 'server-alibaba-key');
    vi.stubEnv('TAVILY_API_KEY', '');
    const modelBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      modelBodies.push(JSON.parse(String(init?.body || '{}')));
      return completion({ role: 'assistant', content: 'Live search is unavailable.' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      chatRequest({
        messages: [{ role: 'user', content: 'What happened today?' }],
        model: 'qwen3.5-omni-flash',
        stream: false,
        web_search: true,
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Live search is unavailable.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(modelBodies[0].tools).toBeUndefined();
    const messages = modelBodies[0].messages as Array<Record<string, unknown>>;
    expect(String(messages[0].content)).toContain('web search is not configured');
  });

  it('runs a real search cycle and returns a stream-compatible SSE response', async () => {
    vi.stubEnv('ALIBABA_API_KEY', 'server-alibaba-key');
    vi.stubEnv('TAVILY_API_KEY', 'server-tavily-key');
    const calls: string[] = [];
    let modelCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('tavily')) {
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          'Bearer server-tavily-key'
        );
        return jsonResponse({
          results: [
            { title: 'Live result', url: 'https://news.example.com/live', content: 'Current facts.' },
          ],
        });
      }
      modelCalls += 1;
      if (modelCalls === 1) {
        return completion({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'web_search', arguments: '{"query":"today news"}' },
            },
          ],
        });
      }
      return completion({ role: 'assistant', content: 'Here is the current answer.' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      chatRequest({
        messages: [{ role: 'user', content: 'What happened today?' }],
        model: 'qwen3.5-omni-flash',
        stream: true,
        web_search: true,
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(response.headers.get('X-Avelut-Web-Search')).toBe('used');
    const sse = await response.text();
    expect(sse).toContain('Here is the current answer.');
    expect(sse).toContain('https://news.example.com/live');
    expect(sse).toContain('data: [DONE]');
    expect(calls.some((url) => url.includes('api.tavily.com'))).toBe(true);
  });

  it('returns a configuration error when the model key is absent', async () => {
    vi.stubEnv('ALIBABA_API_KEY', '');
    vi.stubEnv('VITE_ALIBABA_API_KEY', '');
    const response = await POST(
      chatRequest({
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'AI_NOT_CONFIGURED' });
  });
});
