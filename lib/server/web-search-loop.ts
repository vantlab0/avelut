/**
 * Provider-agnostic OpenAI-compatible tool-call loop for web search.
 *
 * DashScope (Alibaba Model Studio) and OpenRouter both expose the OpenAI chat
 * completions shape, but neither should be handed provider-specific structure
 * blindly. This module only emits the documented `tool_calls` / `tool` roles,
 * validating every model-issued call before anything is executed.
 */

import {
  MAX_QUERY_LENGTH,
  WEB_SEARCH_TOOL_DEFINITION,
  WebSearchError,
  clampMaxResults,
  searchWeb,
  type WebSearchResult,
} from './web-search';

export const MAX_TOOL_ITERATIONS = 3;

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface AssistantToolMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: ToolCall[];
}

export interface ToolResultMessage {
  role: 'tool';
  tool_call_id: string;
  name: string;
  content: string;
}

export type WebSearchLoopMessage = Record<string, unknown> | AssistantToolMessage | ToolResultMessage;

export interface WebSearchLoopOptions {
  /** Chat completions base URL including the version segment. */
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
  messages: Array<Record<string, unknown>>;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' };
  extraPayload?: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxIterations?: number;
  fetchImpl?: typeof fetch;
}

export interface WebSearchLoopResult {
  content: string;
  usedSearch: boolean;
  sources: WebSearchResult[];
  iterations: number;
}

export type WebSearchLoopErrorCode =
  | 'TOOL_LOOP_UPSTREAM_ERROR'
  | 'TOOL_LOOP_TIMEOUT'
  | 'TOOL_LOOP_EMPTY_RESPONSE'
  | 'TOOL_LOOP_MAX_ITERATIONS';

export class WebSearchLoopError extends Error {
  readonly code: WebSearchLoopErrorCode;
  readonly status: number;

  constructor(code: WebSearchLoopErrorCode, message: string, status = 502) {
    super(message);
    this.name = 'WebSearchLoopError';
    this.code = code;
    this.status = status;
  }
}

/** Normalize a model message into tool calls, tolerating missing ids. */
export function parseToolCalls(message: unknown): ToolCall[] {
  const rawCalls = (message as { tool_calls?: unknown })?.tool_calls;
  if (!Array.isArray(rawCalls)) return [];

  const calls: ToolCall[] = [];
  rawCalls.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const call = raw as Record<string, unknown>;
    const fn = call.function as Record<string, unknown> | undefined;
    const name = typeof fn?.name === 'string' ? fn.name : '';
    if (!name) return;
    const args = typeof fn?.arguments === 'string'
      ? fn.arguments
      : JSON.stringify(fn?.arguments ?? {});
    calls.push({
      id: typeof call.id === 'string' && call.id ? call.id : `call_${index}_${Date.now()}`,
      type: 'function',
      function: { name, arguments: args },
    });
  });
  return calls;
}

export interface ExecuteToolCallsOptions {
  signal?: AbortSignal;
  maxIterations?: number;
  fetchImpl?: typeof fetch;
}

export interface ExecutedToolCall {
  message: ToolResultMessage;
  sources: WebSearchResult[];
  error?: string;
}

/**
 * Validate and execute model-requested tool calls. Unknown tools and malformed
 * arguments produce a structured tool error (which the model can explain to the
 * user) instead of throwing and breaking the conversation.
 */
export async function executeWebSearchToolCalls(
  calls: ToolCall[],
  options: ExecuteToolCallsOptions = {}
): Promise<ExecutedToolCall[]> {
  const results: ExecutedToolCall[] = [];

  for (const call of calls) {
    if (call.function.name !== WEB_SEARCH_TOOL_DEFINITION.function.name) {
      results.push({
        message: {
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify({
            error: 'unsupported_tool',
            message: `Tool "${call.function.name}" is not available. Only web_search is supported.`,
          }),
        },
        sources: [],
        error: 'unsupported_tool',
      });
      continue;
    }

    let args: { query?: unknown; max_results?: unknown } = {};
    try {
      const parsed = JSON.parse(call.function.arguments || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Tool arguments must be a JSON object.');
      }
      args = parsed as { query?: unknown; max_results?: unknown };
    } catch (error) {
      results.push({
        message: {
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify({
            error: 'invalid_arguments',
            message: `Could not parse web_search arguments: ${(error as Error).message}`,
          }),
        },
        sources: [],
        error: 'invalid_arguments',
      });
      continue;
    }

    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query || query.length > MAX_QUERY_LENGTH) {
      results.push({
        message: {
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify({
            error: 'invalid_query',
            message: `web_search requires a query between 2 and ${MAX_QUERY_LENGTH} characters.`,
          }),
        },
        sources: [],
        error: 'invalid_query',
      });
      continue;
    }

    try {
      const response = await searchWeb(query, {
        maxResults: clampMaxResults(args.max_results),
        signal: options.signal,
        fetchImpl: options.fetchImpl,
      });
      results.push({
        message: {
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify({
            query: response.query,
            results: response.results,
            note: 'Cite these sources by their original URLs. Do not invent additional sources.',
          }),
        },
        sources: response.results,
      });
    } catch (error) {
      const searchError = error instanceof WebSearchError ? error : null;
      results.push({
        message: {
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify({
            error: searchError?.code || 'web_search_failed',
            message: searchError?.toPublicMessage() || 'Web search failed.',
            instruction: 'Do not fabricate results. Tell the user the web search failed.',
          }),
        },
        sources: [],
        error: searchError?.code || 'web_search_failed',
      });
    }
  }

  return results;
}

export function collectSources(executed: ExecutedToolCall[]): WebSearchResult[] {
  const byUrl = new Map<string, WebSearchResult>();
  for (const item of executed) {
    for (const source of item.sources) {
      if (!byUrl.has(source.url)) byUrl.set(source.url, source);
    }
  }
  return Array.from(byUrl.values());
}

/** Append a deterministic Sources section when the model did not cite URLs. */
export function appendSourcesIfMissing(content: string, sources: WebSearchResult[]): string {
  if (!sources.length) return content;
  const hasCitation = sources.some((source) => content.includes(source.url));
  if (hasCitation) return content;

  const list = sources
    .slice(0, 5)
    .map((source) => `- [${source.title}](${source.url})`)
    .join('\n');
  return `${content.trim()}\n\n**Sources**\n${list}`;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: unknown;
      tool_calls?: unknown;
    };
    finish_reason?: string;
  }>;
  error?: { message?: string; code?: string };
}

function extractContent(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : ''))
      .join('');
  }
  return '';
}

async function requestCompletion(
  options: WebSearchLoopOptions,
  messages: Array<Record<string, unknown>>,
  includeTools: boolean
): Promise<ChatCompletionResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 90000, 5000), 280000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer);
      throw new WebSearchLoopError('TOOL_LOOP_TIMEOUT', 'Request aborted.', 499);
    }
    options.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const payload: Record<string, unknown> = {
      ...(options.extraPayload || {}),
      model: options.model,
      messages,
      stream: false,
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 4096,
    };
    if (includeTools) {
      payload.tools = [WEB_SEARCH_TOOL_DEFINITION];
      payload.tool_choice = 'auto';
    }
    if (options.responseFormat) {
      payload.response_format = options.responseFormat;
    }

    const response = await fetchImpl(`${options.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: options.headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('[web_search_loop] upstream error', {
        status: response.status,
        model: options.model,
        detail: detail.slice(0, 400),
      });
      throw new WebSearchLoopError(
        'TOOL_LOOP_UPSTREAM_ERROR',
        `Upstream model returned HTTP ${response.status}.`,
        response.status === 429 ? 429 : 502
      );
    }

    return (await response.json()) as ChatCompletionResponse;
  } catch (error) {
    if (error instanceof WebSearchLoopError) throw error;
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new WebSearchLoopError('TOOL_LOOP_TIMEOUT', 'The model request timed out.', 504);
    }
    console.error('[web_search_loop] request failed', (error as Error)?.message || error);
    throw new WebSearchLoopError('TOOL_LOOP_UPSTREAM_ERROR', 'The model request failed.', 502);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Run the complete search → tool-result → final-answer cycle.
 *
 * The first call is non-streaming so tool calls can be detected and executed;
 * the caller may stream the returned final text with its own transport.
 */
export async function runWebSearchToolLoop(
  options: WebSearchLoopOptions
): Promise<WebSearchLoopResult> {
  const maxIterations = Math.min(Math.max(options.maxIterations ?? MAX_TOOL_ITERATIONS, 1), 5);
  const messages = [...options.messages];
  const allSources: WebSearchResult[] = [];
  let usedSearch = false;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const data = await requestCompletion(options, messages, true);
    const message = data.choices?.[0]?.message;
    if (!message) {
      throw new WebSearchLoopError('TOOL_LOOP_EMPTY_RESPONSE', 'The model returned no message.');
    }

    const toolCalls = parseToolCalls(message);
    if (!toolCalls.length) {
      const content = extractContent(message).trim();
      if (!content) {
        throw new WebSearchLoopError('TOOL_LOOP_EMPTY_RESPONSE', 'The model returned an empty answer.');
      }
      return {
        content: appendSourcesIfMissing(content, allSources),
        usedSearch,
        sources: allSources,
        iterations: iteration + 1,
      };
    }

    usedSearch = true;
    const executed = await executeWebSearchToolCalls(toolCalls, {
      signal: options.signal,
      fetchImpl: options.fetchImpl,
    });
    allSources.push(...collectSources(executed));

    const assistantMessage: Record<string, unknown> = {
      role: 'assistant',
      content: extractContent(message) || null,
      tool_calls: toolCalls,
    };
    messages.push(assistantMessage);
    for (const call of executed) {
      messages.push(call.message as unknown as Record<string, unknown>);
    }

    // Last permitted iteration: force a text answer so we never return an
    // unsatisfied tool call to the client.
    if (iteration === maxIterations - 1) {
      const finalData = await requestCompletion(options, messages, false);
      const finalMessage = finalData.choices?.[0]?.message;
      const finalContent = extractContent(finalMessage).trim();
      if (!finalContent) {
        throw new WebSearchLoopError(
          'TOOL_LOOP_MAX_ITERATIONS',
          'Web search reached the maximum number of tool rounds without a final answer.',
          502
        );
      }
      return {
        content: appendSourcesIfMissing(finalContent, allSources),
        usedSearch,
        sources: allSources,
        iterations: iteration + 1,
      };
    }
  }

  throw new WebSearchLoopError(
    'TOOL_LOOP_MAX_ITERATIONS',
    'Web search exceeded the maximum number of tool rounds.',
    502
  );
}

/** Build a single-chunk SSE stream so existing client parsers keep working. */
export function createSyntheticSseResponse(
  text: string,
  extraHeaders: Record<string, string> = {}
): Response {
  const encoder = new TextEncoder();
  const payload = {
    choices: [
      {
        delta: { content: text },
        finish_reason: 'stop',
      },
    ],
  };
  const body = `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
  return new Response(encoder.encode(body), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...extraHeaders,
    },
  });
}
