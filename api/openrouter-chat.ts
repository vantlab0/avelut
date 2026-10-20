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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, HTTP-Referer, X-Title',
    },
  });
}

const BASE_URL = 'https://openrouter.ai/api/v1';

const FALLBACK_MODELS = [
  'qwen/qwen3.5-omni-flash',
  'qwen/qwen3.8-omni-flash',
  'qwen/qwen3.8-flash',
  'qwen/qwen3.7-flash',
  'qwen/qwen-2.5-72b-instruct',
  'deepseek/deepseek-r1:free',
  'meta-llama/llama-3.3-70b-instruct:free',
];

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function jsonError(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const apiKey =
      process.env.OPENROUTER_API_KEY ||
      process.env.VITE_OPENROUTER_API_KEY ||
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
      '';

    if (!apiKey) {
      return jsonError(401, {
        error: 'Avelut AI is not configured on this deployment. Add OPENROUTER_API_KEY on the server.',
        code: 'AI_NOT_CONFIGURED',
      });
    }

    const requestHeaders: Record<string, string> = {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://avelut.xyz',
      'X-Title': 'Avelut AI',
    };

    const messages: any[] = Array.isArray(body.messages) ? [...body.messages] : [];
    const primaryModel = process.env.OPENROUTER_MODEL || body.model || 'qwen/qwen3.5-omni-flash';
    const candidateModels = Array.from(new Set([primaryModel, ...FALLBACK_MODELS]));
    const webSearchRequested = body.web_search === true || body.web_search === 'true';

    // Browse ON but search key missing: never pretend a search happened.
    if (webSearchRequested && !isWebSearchConfigured()) {
      messages.unshift({ role: 'system', content: WEB_SEARCH_UNAVAILABLE_INSTRUCTION });
    }

    // ── Real web browsing: complete tool-call cycle ──────────────────────────
    if (webSearchRequested && isWebSearchConfigured()) {
      messages.unshift({ role: 'system', content: WEB_SEARCH_SYSTEM_INSTRUCTION });

      let lastLoopError: WebSearchLoopError | null = null;
      for (const model of candidateModels) {
        try {
          const result = await runWebSearchToolLoop({
            baseUrl: BASE_URL,
            headers: requestHeaders,
            model,
            messages,
            temperature: body.temperature ?? 0.7,
            maxTokens: body.max_tokens ?? 4096,
            signal: req.signal,
            timeoutMs: 20000,
            // maxDuration is 60s; one search round plus the final answer fits.
            maxIterations: 1,
            extraPayload: { include_reasoning: false },
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
          console.warn(`[OpenRouter Proxy] web search loop failed on ${model}:`, lastLoopError.code);
          // Unsupported-tool or model errors can be fixed by the next model.
          // Auth/quota errors are not retried indefinitely.
          if (lastLoopError.status === 401 || lastLoopError.status === 403) break;
        }
      }

      return jsonError(lastLoopError?.status === 429 ? 429 : 503, {
        error: lastLoopError?.code === 'TOOL_LOOP_TIMEOUT'
          ? 'Web search took too long. Please try again.'
          : 'Web search could not be completed. Please try again.',
        code: lastLoopError?.code || 'WEB_SEARCH_FAILED',
      });
    }

    // ── Standard chat ───────────────────────────────────────────────────────
    let lastResponse: Response | null = null;
    let lastErrorText = '';

    for (const model of candidateModels) {
      try {
        const payload: any = {
          model,
          messages,
          temperature: body.temperature ?? 0.7,
          max_tokens: body.max_tokens ?? 4096,
          include_reasoning: false,
        };

        if (body.response_format && body.response_format.type === 'json_object') {
          payload.response_format = { type: 'json_object' };
          payload.stream = false; // Strictly enforce non-streaming for JSON mode
        } else if (body.stream) {
          payload.stream = true;
          if (body.stream_options) {
            payload.stream_options = body.stream_options;
          }
        }

        const response = await fetch(`${BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(payload),
          signal: req.signal,
        });

        if (response.ok) {
          if (payload.stream && response.body) {
            return new Response(response.body, {
              status: 200,
              headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
                'Access-Control-Allow-Origin': '*',
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
        }

        lastErrorText = await response.text();
        lastResponse = response;

        // If 401 or auth issue without fallback key, retry won't fix it on this model, but try next model if 429 or 5xx
        if (response.status !== 429 && response.status < 500) {
          break;
        }
      } catch (err: any) {
        lastErrorText = JSON.stringify({ error: `Fetch error for model ${model}: ${err.message}` });
        // continue to next fallback model
      }
    }

    if (lastResponse?.status === 429) {
      return jsonError(429, {
        error: 'RATE_LIMIT',
        message: 'Upstream provider is temporarily overloaded.',
      });
    }

    console.error('[OpenRouter Proxy] All upstream attempts failed', {
      status: lastResponse?.status || 500,
      detail: lastErrorText.slice(0, 500),
    });
    return jsonError(lastResponse?.status || 500, {
      error: 'Avelut AI is temporarily unavailable. Please try again in a moment.',
      code: 'AI_UPSTREAM_UNAVAILABLE',
    });
  } catch (error: any) {
    console.error('[OpenRouter Proxy] Unhandled error:', error?.message || error);
    return jsonError(500, { error: 'Internal OpenRouter Chat Proxy Error' });
  }
}
