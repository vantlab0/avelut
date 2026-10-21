export const maxDuration = 60;

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, X-DashScope-WorkSpace, HTTP-Referer, X-Title',
    },
  });
}

const DASHSCOPE_BASE_URLS = [
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
];

export const DEFAULT_MODEL = 'qwen3.5-omni-flash';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const incomingAuth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || '';
    const validClientKey = incomingAuth && incomingAuth !== 'undefined' && incomingAuth !== 'null' && incomingAuth.length > 10
      ? incomingAuth
      : '';

    const alibabaApiKey =
      process.env.ALIBABA_API_KEY ||
      process.env.VITE_ALIBABA_API_KEY ||
      validClientKey ||
      'sk-ws-H.DDLPMIE.fbaD.MEQCIFkao1-I0HQyUMxmrty8-k1S70b0xjgF1BoNksO2pM6WAiACzxp1ojlxhmc6YQFNodecye0oQOBAalaHxCVNdJfQjA';

    const workspaceId =
      req.headers.get('x-dashscope-workspace') ||
      process.env.ALIBABA_WORKSPACE_ID ||
      process.env.VITE_ALIBABA_WORKSPACE_ID ||
      'ws-o3v6mh0i8y9tqdfx';

    // Normalize messages and detect vision / PDF-document requests
    const messages = body.messages || [];
    const hasDocument = messages.some((m: any) =>
      Array.isArray(m.content) && m.content.some((c: any) =>
        c.type === 'file' || c.file_url || c.file_data || c.file
      )
    );

    let rawModel = (body.model ? String(body.model).trim() : '');
    rawModel = rawModel
      .replace(/^qwen\//i, '')
      .replace(/^alibaba\//i, '')
      .replace(/^google\//i, '')
      .replace(/^openai\//i, '')
      .replace(/^anthropic\//i, '')
      .replace(/^meta-llama\//i, '');

    const isQwenModel = rawModel.toLowerCase().startsWith('qwen');
    const model = isQwenModel ? rawModel : DEFAULT_MODEL;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), hasDocument ? 55000 : 25000);

    const payload: any = {
      model,
      messages,
      modalities: ['text'],
      enable_thinking: false,
      include_reasoning: false,
      temperature: body.temperature ?? 0.35,
      max_tokens: Math.min(body.max_tokens ?? (hasDocument ? 16384 : 2500), hasDocument ? 16384 : 4096),
    };
    if (body.response_format && body.response_format.type === 'json_object') {
      payload.response_format = { type: 'json_object' };
      payload.stream = false;
    } else if (body.stream) {
      payload.stream = true;
    }

    if (body.web_search || body.enable_search) {
      payload.enable_search = true;
    }

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${alibabaApiKey}`,
      'Content-Type': 'application/json',
    };
    if (workspaceId) {
      requestHeaders['X-DashScope-WorkSpace'] = workspaceId;
    }

    let lastError = '';
    let lastStatus = 502;

    for (const baseUrl of DASHSCOPE_BASE_URLS) {
      try {
        const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (response.ok) {
          clearTimeout(timer);
          if (payload.stream && response.body) {
            return new Response(response.body, {
              status: 200,
              headers: {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'X-Accel-Buffering': 'no',
              },
            });
          }
          const data = await response.json();
          const extractedText = data?.choices?.[0]?.message?.content || '';
          return new Response(extractedText, {
            status: 200,
            headers: {
              'Content-Type': 'text/plain',
              'Access-Control-Allow-Origin': '*',
            },
          });
        } else {
          lastError = await response.text().catch(() => '');
          lastStatus = response.status;
          console.warn(`[Alibaba Chat Proxy] Upstream ${baseUrl} (${model}) HTTP ${response.status}:`, lastError);

          // For auth or rate limit errors, fail immediately without retrying other base
          if (response.status === 401 || response.status === 403 || response.status === 429) {
            clearTimeout(timer);
            return new Response(lastError, {
              status: response.status,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            });
          }
        }
      } catch (fetchErr: any) {
        lastError = fetchErr?.message || '';
        console.warn(`[Alibaba Chat Proxy] Upstream fetch to ${baseUrl} failed:`, fetchErr?.message);
      }
    }
    clearTimeout(timer);

    return new Response(
      JSON.stringify({ error: `Alibaba DashScope (${model}) unavailable: ${lastError || 'Connection error'}` }),
      {
        status: lastStatus || 503,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error: any) {
    console.error('[Alibaba Chat Proxy] Unhandled error:', error?.message || error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Internal AI Chat Proxy Error' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
