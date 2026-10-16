export const maxDuration = 300;

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

export const DEFAULT_MODEL = 'qwen3.8-omni-flash';

const FALLBACK_GEMINI_KEY =
  process.env.GEMINI_API_KEY ||
  process.env.VITE_GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  'AQ.Ab8RN6J46HHzdWXmAxHW5t5xu4Ef3RRzfWchS_a_lGmxK-eK4Q';

async function callGeminiFallback(messages: any[], body: any): Promise<Response | null> {
  const geminiKey = FALLBACK_GEMINI_KEY;
  if (!geminiKey) return null;

  try {
    const systemParts: string[] = [];
    const contents: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        systemParts.push(text);
      } else {
        const role = msg.role === 'assistant' ? 'model' : 'user';
        let text = '';
        if (typeof msg.content === 'string') {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          text = msg.content
            .map((c: any) => (typeof c === 'string' ? c : c?.text || ''))
            .filter(Boolean)
            .join('\n');
        } else {
          text = JSON.stringify(msg.content);
        }
        contents.push({ role, parts: [{ text }] });
      }
    }

    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
    }

    const payload: any = {
      contents,
      generationConfig: {
        temperature: body.temperature ?? 0.2,
        maxOutputTokens: Math.min(body.max_tokens ?? 4096, 8192),
      },
    };

    if (systemParts.length > 0) {
      payload.systemInstruction = {
        parts: [{ text: systemParts.join('\n\n') }],
      };
    }

    if (body.response_format?.type === 'json_object') {
      payload.generationConfig.responseMimeType = 'application/json';
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn('[Gemini Fallback] HTTP error:', res.status, errText);
      return null;
    }

    const data = await res.json();
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // If caller expects streaming SSE, format as standard OpenAI SSE chunks
    if (body.stream) {
      const ssePayload = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(ssePayload, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Standard plain text response expected by getResponseText / fetch
    return new Response(text, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: any) {
    console.warn('[Gemini Fallback] Exception:', err?.message);
    return null;
  }
}

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
    const hasImage = messages.some((m: any) =>
      Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image_url')
    );
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
    const primaryDashscopeModel = isQwenModel ? rawModel : DEFAULT_MODEL;

    // PDF understanding only works on qwen3.8-max / qwen3.8-flash / qwen3.8-27b
    const candidateModels = hasDocument
      ? Array.from(new Set([
          primaryDashscopeModel.includes('max') ? 'qwen3.8-max' : 'qwen3.8-flash',
          'qwen3.8-flash',
          'qwen3.8-max',
        ]))
      : Array.from(new Set([
          primaryDashscopeModel,
          DEFAULT_MODEL,
          'qwen3.7-flash',
        ]));

    // Attempt DashScope / Model Studio MaaS endpoints
    let lastUpstreamError = '';
    let lastUpstreamStatus = 502;
    let attemptedModel = primaryDashscopeModel;

    if (alibabaApiKey) {
      const targetBases = DASHSCOPE_BASE_URLS;

      modelLoop: for (const currentModel of candidateModels) {
        attemptedModel = currentModel;
        for (const baseUrl of targetBases) {
          try {
            const controller = new AbortController();
            // Fast 8s timeout for immediate fallback if unreachable or restricted
            const timer = setTimeout(() => controller.abort(), hasDocument ? 280000 : 8000);

            const payload: any = {
              model: currentModel,
              messages,
              modalities: ['text'],
              enable_thinking: false,
              include_reasoning: false,
              temperature: body.temperature ?? 0.35,
              max_tokens: Math.min(body.max_tokens ?? (hasDocument ? 16384 : 2500), hasDocument ? 16384 : 4096),
            };
            if (body.response_format && body.response_format.type === 'json_object') {
              payload.response_format = { type: 'json_object' };
              payload.stream = false; // Strictly enforce non-streaming for JSON mode
            } else if (body.stream) {
              payload.stream = true;
            }

            const requestHeaders: Record<string, string> = {
              'Authorization': `Bearer ${alibabaApiKey}`,
              'Content-Type': 'application/json',
            };
            if (workspaceId) {
              requestHeaders['X-DashScope-WorkSpace'] = workspaceId;
            }

            const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
              method: 'POST',
              headers: requestHeaders,
              body: JSON.stringify(payload),
              signal: controller.signal,
            });
            clearTimeout(timer);

            if (response.ok) {
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
              const errText = await response.text().catch(() => '');
              lastUpstreamError = errText;
              lastUpstreamStatus = response.status;
              console.warn(`[Alibaba Chat Proxy] Upstream ${baseUrl} (${currentModel}) HTTP ${response.status}:`, errText);

              // If auth or access restriction occurs, break directly to Gemini fallback
              if (response.status === 401 || response.status === 403 || errText.includes('access_denied') || errText.includes('API-Key restrictions')) {
                break modelLoop;
              }

              // If model does not exist on DashScope, try next candidate
              if (response.status === 400 || response.status === 404 || errText.includes('model_not_found') || errText.includes('Model not exist')) {
                continue modelLoop;
              }
            }
          } catch (fetchErr: any) {
            lastUpstreamError = fetchErr?.message || '';
            console.warn(`[Alibaba Chat Proxy] Upstream fetch to ${baseUrl} failed:`, fetchErr?.message);
          }
        }
      }
    }

    // Seamless Fallback: Invoke Google Gemini 2.5 Flash if DashScope was unavailable or restricted
    const geminiFallbackResponse = await callGeminiFallback(messages, body);
    if (geminiFallbackResponse) {
      return geminiFallbackResponse;
    }

    return new Response(
      JSON.stringify({ error: `AI generation temporarily unavailable: ${lastUpstreamError || 'Connection error'}` }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || 'Internal AI Chat Proxy Error' }),
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
