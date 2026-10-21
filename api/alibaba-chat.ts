import {
  WEB_SEARCH_SYSTEM_INSTRUCTION,
  WEB_SEARCH_UNAVAILABLE_INSTRUCTION,
  isWebSearchConfigured,
} from '../lib/server/web-search';
import {
  createSyntheticSseResponse,
  runWebSearchToolLoop,
  WebSearchLoopError,
} from '../lib/server/web-search-loop';

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

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function jsonError(status: number, error: string, code?: string) {
  return new Response(JSON.stringify(code ? { error, code } : { error }), {
    status,
    headers: JSON_HEADERS,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const incomingAuth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || '';
    const validClientKey = incomingAuth && incomingAuth !== 'undefined' && incomingAuth !== 'null' && incomingAuth.length > 10
      ? incomingAuth
      : '';

    // Server-side secrets only. A client-supplied key is accepted for existing
    // authenticated proxy deployments, but no key is ever hardcoded here.
    const alibabaApiKey =
      process.env.ALIBABA_API_KEY ||
      process.env.VITE_ALIBABA_API_KEY ||
      validClientKey;

    const workspaceId =
      req.headers.get('x-dashscope-workspace') ||
      process.env.ALIBABA_WORKSPACE_ID ||
      process.env.VITE_ALIBABA_WORKSPACE_ID ||
      '';

    // Normalize messages and detect vision / PDF-document requests
    const messages: any[] = Array.isArray(body.messages) ? [...body.messages] : [];
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

    // PDF understanding only works on the document-capable Qwen models.
    const candidateModels = hasDocument
      ? Array.from(new Set([
          primaryDashscopeModel.includes('max') ? 'qwen3.8-max' : 'qwen3.8-flash',
          'qwen3.8-flash',
          'qwen3.8-max',
        ]))
      : Array.from(new Set([
          primaryDashscopeModel,
          DEFAULT_MODEL,
          'qwen3.8-omni-flash',
          'qwen3.8-flash',
          'qwen3.7-flash',
        ]));

    if (!alibabaApiKey) {
      return jsonError(503, 'Avelut AI is not configured on this deployment. Add ALIBABA_API_KEY on the server.', 'AI_NOT_CONFIGURED');
    }

    const webSearchRequested = body.web_search === true || body.web_search === 'true';

    // Browse ON but search key missing: never pretend a search happened.
    if (webSearchRequested && !isWebSearchConfigured()) {
      messages.unshift({ role: 'system', content: WEB_SEARCH_UNAVAILABLE_INSTRUCTION });
    }

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${alibabaApiKey}`,
      'Content-Type': 'application/json',
    };
    if (workspaceId) {
      requestHeaders['X-DashScope-WorkSpace'] = workspaceId;
    }

    // ── Real web browsing: complete tool-call cycle ──────────────────────────
    if (webSearchRequested && isWebSearchConfigured()) {
      messages.unshift({ role: 'system', content: WEB_SEARCH_SYSTEM_INSTRUCTION });

      let lastLoopError: WebSearchLoopError | null = null;
      for (const currentModel of candidateModels) {
        for (const baseUrl of DASHSCOPE_BASE_URLS) {
          try {
            const result = await runWebSearchToolLoop({
              baseUrl,
              headers: requestHeaders,
              model: currentModel,
              messages,
              temperature: body.temperature ?? 0.35,
              maxTokens: Math.min(body.max_tokens ?? (hasDocument ? 16384 : 4096), hasDocument ? 16384 : 8192),
              signal: req.signal,
              timeoutMs: hasDocument ? 55000 : 45000,
              // One search round is enough for a grounded answer and keeps the
              // total request inside both the client and platform time limits.
              maxIterations: 1,
              extraPayload: {
                modalities: ['text'],
                enable_thinking: false,
                include_reasoning: false,
              },
            });

            if (body.stream) {
              return createSyntheticSseResponse(result.content, {
                'Access-Control-Allow-Origin': '*',
                'X-Avelut-Web-Search': result.usedSearch ? 'used' : 'not-used',
              });
            }
            return new Response(result.content, {
              status: 200,
              headers: {
                'Content-Type': 'text/plain',
                'Access-Control-Allow-Origin': '*',
                'X-Avelut-Web-Search': result.usedSearch ? 'used' : 'not-used',
              },
            });
          } catch (loopError: any) {
            lastLoopError = loopError instanceof WebSearchLoopError
              ? loopError
              : new WebSearchLoopError('TOOL_LOOP_UPSTREAM_ERROR', loopError?.message || 'Web search failed.');
            console.warn(
              `[Alibaba Chat Proxy] web search loop failed on ${currentModel} @ ${baseUrl}:`,
              lastLoopError.code
            );
            if (loopError instanceof WebSearchLoopError && loopError.status === 429) {
              // Overloaded model/base; try the next candidate.
              continue;
            }
          }
        }
      }

      const status = lastLoopError?.status === 429 ? 429 : 503;
      return jsonError(
        status,
        lastLoopError?.code === 'TOOL_LOOP_TIMEOUT'
          ? 'Web search took too long. Please try again.'
          : 'Web search could not be completed. Please try again.',
        lastLoopError?.code || 'WEB_SEARCH_FAILED'
      );
    }

    // ── Standard chat / document understanding ──────────────────────────────
    let lastUpstreamError = '';
    let lastUpstreamStatus = 502;

    modelLoop: for (const currentModel of candidateModels) {
      for (const baseUrl of DASHSCOPE_BASE_URLS) {
        try {
          const controller = new AbortController();
          // Fast 8s timeout for immediate fallback if unreachable or restricted
          const timer = setTimeout(() => controller.abort(), hasDocument ? 55000 : 8000);

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
                  Connection: 'keep-alive',
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

            // If auth or access restriction occurs, stop trying this base or try next candidate
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

    console.error('[Alibaba Chat Proxy] All upstream attempts failed', {
      status: lastUpstreamStatus,
      detail: lastUpstreamError.slice(0, 500),
    });
    return jsonError(
      lastUpstreamStatus >= 400 && lastUpstreamStatus < 500 ? lastUpstreamStatus : 503,
      'Avelut AI is temporarily unavailable. Please try again in a moment.',
      'AI_UPSTREAM_UNAVAILABLE'
    );
  } catch (error: any) {
    console.error('[Alibaba Chat Proxy] Unhandled error:', error?.message || error);
    return jsonError(500, 'Internal AI Chat Proxy Error');
  }
}
