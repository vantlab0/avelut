import type { AppSettings, UserProfile } from '../types';
import { AVELUT_TEXT_MODEL, normalizeTextModel } from '../lib/textModel';

/**
 * Universal JSON Schema Type Enum (replaces @google/genai Type)
 */
export const Type = {
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  INTEGER: 'INTEGER',
  BOOLEAN: 'BOOLEAN',
  ARRAY: 'ARRAY',
  OBJECT: 'OBJECT',
} as const;

/**
 * Strips mathematical LaTeX/KaTeX symbols and complex code blocks from text
 * for compaction unless the user specifically requested math or code.
 */
export const compactContext = (text: string, isRequested: boolean): string => {
  if (!text || isRequested) return text;
  let cleaned = text;

  // Strip LaTeX style blocks: $$...$$
  cleaned = cleaned.replace(/\$\$.*?\$\$/gs, '');
  // Strip LaTeX style inline: $...$
  cleaned = cleaned.replace(/\$.*?\$/g, '');
  // Strip \[ ... \] and \( ... \)
  cleaned = cleaned.replace(/\\\[.*?\\\]/gs, '');
  cleaned = cleaned.replace(/\\\(.*?\\\)/gs, '');
  // Strip complex markdown code blocks but keep text contents or omit them
  cleaned = cleaned.replace(/```[a-zA-Z]*\n[\s\S]*?\n```/g, '\n[Code block omitted for context compaction]\n');
  // Strip KaTeX math structures like \frac, \sqrt, \begin{equation}
  cleaned = cleaned.replace(/\\[a-zA-Z]+\{.*?\}/g, '');
  cleaned = cleaned.replace(/\\begin\{.*?\}.*?\\end\{.*?\}/gs, '');

  return cleaned;
};

/**
 * Checks if the user prompt requests mathematical or programmatic syntax.
 */
const isMathOrCodeRequested = (contents: any): boolean => {
  if (!contents) return false;
  const keywords = [
    'math', 'latex', 'katex', 'equation', 'formula', 'code', 'program',
    'script', 'function', 'class', 'python', 'javascript', 'typescript',
    'java', 'c++', 'c#', 'html', 'css', 'solve', 'calculate', 'prove',
    'integral', 'derivative', 'matrix', 'vector', 'theorem', 'fraction'
  ];
  let text = '';
  
  const extractText = (item: any) => {
    if (typeof item === 'string') {
      text += ' ' + item.toLowerCase();
    } else if (item && typeof item === 'object') {
      for (const key in item) {
        extractText(item[key]);
      }
    }
  };
  extractText(contents);
  
  return keywords.some(keyword => text.includes(keyword));
};

/**
 * Localized trimming routine that calculates character length (proxy for tokens)
 * and recursively compresses large text blocks to stay strictly below TPM boundary.
 */
export const compressContext = (params: any, tpmLimit: number = 250000): any => {
  // Use a conservative proxy of 3.5 characters per token.
  const maxChars = Math.floor(tpmLimit * 3.5);
  
  let totalLength = 0;
  const countChars = (item: any) => {
    if (item && typeof item === 'object') {
      if ('inlineData' in item) {
        return;
      }
      for (const key in item) {
        if (key !== 'inlineData') {
          countChars(item[key]);
        }
      }
    } else if (typeof item === 'string') {
      totalLength += item.length;
    }
  };
  countChars(params);

  if (totalLength <= maxChars) {
    return params;
  }

  // Deep clone to safely manipulate parameters
  const newParams = JSON.parse(JSON.stringify(params));
  
  // Truncate large string values dynamically until payload fits
  let threshold = 30000;
  while (totalLength > maxChars && threshold > 500) {
    totalLength = 0;
    const truncate = (obj: any): any => {
      if (obj && typeof obj === 'object') {
        if ('inlineData' in obj) {
          return obj;
        }
        if (Array.isArray(obj)) {
          return obj.map(item => truncate(item));
        }
        const res: any = {};
        for (const key in obj) {
          if (key === 'inlineData') {
            res[key] = obj[key];
          } else {
            res[key] = truncate(obj[key]);
          }
        }
        return res;
      }
      if (typeof obj === 'string') {
        if (obj.length > threshold) {
          const truncated = obj.substring(0, threshold) + '\n[... Context compressed to stay within limit ...]';
          totalLength += truncated.length;
          return truncated;
        }
        totalLength += obj.length;
        return obj;
      }
      return obj;
    };
    
    const result = truncate(newParams);
    if (totalLength <= maxChars) {
      return result;
    }
    threshold = Math.floor(threshold * 0.7);
  }

  return newParams;
};

/**
 * production-grade, asynchronous token-bucket queue for RPM limits.
 */
class RpmRateLimiter {
  private lastRequestTimes: number[] = [];
  private limitRpm: number;

  constructor(limitRpm: number = 10) {
    this.limitRpm = limitRpm;
  }

  setLimitRpm(limit: number) {
    this.limitRpm = limit;
  }

  async acquireToken(): Promise<void> {
    const intervalMs = 60000; // 1 minute window
    while (true) {
      const now = Date.now();
      this.lastRequestTimes = this.lastRequestTimes.filter(t => now - t < intervalMs);

      if (this.lastRequestTimes.length < this.limitRpm) {
        this.lastRequestTimes.push(now);
        return;
      }

      const oldestTime = this.lastRequestTimes[0];
      const waitTime = intervalMs - (now - oldestTime);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime + 100)); // Add a buffer
      }
    }
  }
}

// Global rate limiter singleton — 60 RPM matches Alibaba DashScope tier limits
// (the old 10 RPM was artificially throttling chat requests by up to 6 seconds)
const globalRateLimiter = new RpmRateLimiter(60);

/**
 * Safe helper to extract text from an AI model response.
 * Handles both getter and method versions of .text property.
 */

/**
 * Extract token usage from a generateContent / stream chunk response.
 * Returns zeros when the provider did not attach usage metadata.
 */
export interface AiUsageMetadata {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export const extractUsageMetadata = (response: any): AiUsageMetadata => {
  const empty: AiUsageMetadata = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  if (!response) return empty;

  const meta = response.usageMetadata || response.usage_metadata || response.usage;
  if (!meta || typeof meta !== 'object') return empty;

  const prompt =
    Number(meta.promptTokenCount ?? meta.prompt_tokens ?? meta.input_tokens ?? 0) || 0;
  const completion =
    Number(meta.candidatesTokenCount ?? meta.completion_tokens ?? meta.output_tokens ?? 0) || 0;
  let total = Number(meta.totalTokenCount ?? meta.total_tokens ?? 0) || 0;
  if (!total && (prompt || completion)) total = prompt + completion;

  return { promptTokens: prompt, completionTokens: completion, totalTokens: total };
};

/**
 * Merge usage from a stream chunk into a running accumulator (prefer max totals).
 */
export const accumulateUsageMetadata = (
  acc: AiUsageMetadata,
  response: any
): AiUsageMetadata => {
  const next = extractUsageMetadata(response);
  if (!next.totalTokens && !next.promptTokens && !next.completionTokens) return acc;
  return {
    promptTokens: Math.max(acc.promptTokens, next.promptTokens),
    completionTokens: Math.max(acc.completionTokens, next.completionTokens),
    totalTokens: Math.max(acc.totalTokens, next.totalTokens) || (next.promptTokens + next.completionTokens),
  };
};

export const getResponseText = (response: any): string => {
  if (!response) return '';
  const text = response.text;
  if (typeof text === 'function') {
    return text();
  }
  if (typeof text === 'string') {
    return text;
  }
  if (response?.candidates?.[0]?.content?.parts?.[0]?.text !== undefined) {
    return response.candidates[0].content.parts[0].text;
  }
  if (response?.choices?.[0]?.delta?.content !== undefined) {
    return response.choices[0].delta.content || '';
  }
  if (response?.choices?.[0]?.message?.content !== undefined) {
    return response.choices[0].message.content || '';
  }
  return '';
};

/**
 * Safe helper to extract reasoning/thinking text from an AI model response or streaming chunk.
 */
export const getResponseReasoningText = (response: any): string => {
  if (!response) return '';
  const reasoning = response.reasoningText;
  if (typeof reasoning === 'function') {
    return reasoning();
  }
  if (typeof reasoning === 'string') {
    return reasoning;
  }
  if (response?.candidates?.[0]?.content?.parts?.[0]?.reasoning !== undefined) {
    return response.candidates[0].content.parts[0].reasoning;
  }
  if (response?.choices?.[0]?.delta?.reasoning_content !== undefined) {
    return response.choices[0].delta.reasoning_content || '';
  }
  if (response?.choices?.[0]?.delta?.reasoning !== undefined) {
    return response.choices[0].delta.reasoning || '';
  }
  if (response?.choices?.[0]?.message?.reasoning_content !== undefined) {
    return response.choices[0].message.reasoning_content || '';
  }
  if (response?.choices?.[0]?.message?.reasoning !== undefined) {
    return response.choices[0].message.reasoning || '';
  }
  return '';
};

/**
 * Convert contents/parts to standard OpenAI/Alibaba chat messages
 * Supports both text and multi-modal image content
 */
function paramsToChatMessages(params: any): { systemPrompt: string; messages: Array<{ role: string; content: any }>; hasImage: boolean; hasDocument: boolean } {
  let systemPrompt = '';
  const messages: Array<{ role: string; content: any }> = [];
  let hasImage = false;
  let hasDocument = false;

  const isImageMime = (mime?: string) => {
    const m = (mime || '').toLowerCase();
    return m.startsWith('image/');
  };

  if (params?.config?.systemInstruction) {
    const si = params.config.systemInstruction;
    if (typeof si === 'string') {
      systemPrompt = si;
    } else if (si?.parts && Array.isArray(si.parts)) {
      systemPrompt = si.parts.map((p: any) => p.text || '').join('\n');
    }
  }

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  const contents = params?.contents;
  if (Array.isArray(contents)) {
    for (const c of contents) {
      const role = c.role === 'model' || c.role === 'assistant' ? 'assistant' : 'user';
      if (typeof c === 'string') {
        messages.push({ role, content: c });
      } else if (c?.parts && Array.isArray(c?.parts)) {
        const hasRealImage = c.parts.some((p: any) => {
          if (p.imageUrl || p.image_url) return true;
          if (p.inlineData) return isImageMime(p.inlineData.mimeType);
          return false;
        });
        const partHasDocument = c.parts.some((p: any) => {
          if (p.fileUrl || p.file_url) return true;
          if (p.file && (p.file.file_url || p.file.file_data)) return true;
          if (!p.inlineData) return false;
          const mime = (p.inlineData.mimeType || '').toLowerCase();
          return mime === 'application/pdf' || mime.includes('pdf') || mime.includes('document') || mime.includes('msword') || mime.includes('officedocument') || mime === 'text/plain';
        });

        if (hasRealImage || partHasDocument) {
          if (hasRealImage) hasImage = true;
          if (partHasDocument) hasDocument = true;
          const multiModalContent: any[] = [];
          for (const p of c.parts) {
            if (p.text) {
              multiModalContent.push({ type: 'text', text: p.text });
            } else if (p.fileUrl || p.file_url || (p.file && p.file.file_url)) {
              // Preferred path: public HTTPS URL (avoids 413 on large PDFs)
              // Alibaba PDF understanding: type "file" + file_url
              const url = p.fileUrl || p.file_url || p.file.file_url;
              multiModalContent.push({
                type: 'file',
                file: {
                  file_url: typeof url === 'string' ? url : url.url,
                  filename: p.fileName || p.filename || 'document.pdf',
                  file_format: p.fileFormat || p.file_format || 'pdf',
                },
              });
            } else if (p.inlineData) {
              const mime = (p.inlineData.mimeType || 'image/jpeg').toLowerCase();
              const base64 = p.inlineData.data;
              if (isImageMime(mime)) {
                multiModalContent.push({
                  type: 'image_url',
                  image_url: { url: `data:${mime};base64,${base64}` },
                });
              } else if (mime === 'application/pdf' || mime.includes('pdf')) {
                // Fallback only for small PDFs — prefer fileUrl for large files
                multiModalContent.push({
                  type: 'file',
                  file: {
                    file_data: `data:application/pdf;base64,${base64}`,
                    filename: p.fileName || p.filename || 'document.pdf',
                    file_format: 'pdf',
                  },
                });
              } else {
                multiModalContent.push({
                  type: 'file',
                  file: {
                    file_data: `data:${mime};base64,${base64}`,
                    filename: p.fileName || p.filename || 'document',
                  },
                });
              }
            } else if (p.imageUrl || p.image_url) {
              const url = p.imageUrl || p.image_url;
              multiModalContent.push({
                type: 'image_url',
                image_url: { url: typeof url === 'string' ? url : url.url },
              });
            }
          }
          messages.push({ role, content: multiModalContent });
        } else {
          const text = c.parts.map((p: any) => p.text || '').join('\n');
          if (text) messages.push({ role, content: text });
        }
      } else if (typeof c?.text === 'string') {
        messages.push({ role, content: c.text });
      }
    }
  } else if (typeof contents === 'string') {
    messages.push({ role: 'user', content: contents });
  }

  return { systemPrompt, messages, hasImage, hasDocument };
}

export interface AvelutAIOptions {
  endpointPreference?: 'openai_compatible_first' | 'default';
  feature?: string;
  signal?: AbortSignal;
}

/**
 * Resolves the prioritized list of endpoints for Alibaba / Qwen inference.
 * For Study Guide chat / CourseChatTutor, prioritizes the OpenAI-compatible workspace
 * endpoint from env/settings and the app proxy over the public DashScope path.
 */
function resolveAlibabaEndpoints(
  _appSettings: AppSettings,
  isNative: boolean,
  _options?: AvelutAIOptions
): string[] {
  // Always route via the fast, server-side alibaba-chat proxy endpoint.
  // This completely eliminates CORS preflight blocks and client 401 unauthorized errors,
  // and routes directly to Model Studio Singapore MaaS on the backend.
  if (isNative) {
    return [
      'https://www.avelut.xyz/api/alibaba-chat',
      '/api/alibaba-chat',
    ];
  }
  return [
    '/api/alibaba-chat',
    'https://www.avelut.xyz/api/alibaba-chat',
  ];
}

/**
 * Every text request resolves to exactly one model. Caller-supplied models
 * (including the legacy `qwen/qwen3.7-flash` alias) are accepted but ignored;
 * document/image requests use the same text model as everything else.
 */
export function normalizeAlibabaDashScopeModel(
  _model?: string,
  _hasImage: boolean = false,
  _hasDocument: boolean = false
): typeof AVELUT_TEXT_MODEL {
  return normalizeTextModel(_model);
}

/**
 * Helper to calculate backoff delay with exponential scaling and random jitter.
 */
function getBackoffDelayMs(attempt: number, retryAfterHeader?: string | null): number {
  if (retryAfterHeader) {
    const parsedSec = parseInt(retryAfterHeader, 10);
    if (!isNaN(parsedSec) && parsedSec > 0) {
      return Math.min(parsedSec * 1000, 10000);
    }
  }
  const baseDelay = 1000 * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 500;
  return Math.min(baseDelay + jitter, 8000);
}

/**
 * Call Alibaba Cloud DashScope / Qwen Direct API Endpoint with candidate model fallbacks,
 * bounded exponential retries with jitter.
 */
async function callAlibabaQwen(
  params: any,
  appSettings: AppSettings,
  options?: AvelutAIOptions
): Promise<any> {
  const { messages, hasDocument } = paramsToChatMessages(params);
  const primaryModel = normalizeAlibabaDashScopeModel(params?.model, false, hasDocument);
  const webSearchEnabled = params?.config?.webSearch === true;
  const candidateModels = [primaryModel];

  const isNative = typeof window !== 'undefined' && (
    (window as any).Capacitor?.isNativePlatform?.() ||
    window.location.protocol === 'file:'
  );

  const endpoints = resolveAlibabaEndpoints(appSettings, isNative, options);

  let lastError: Error | null = null;
  let isRateLimited = false;

  const callerSignal = options?.signal || params?.signal || params?.config?.signal;
  if (callerSignal?.aborted) {
    return { text: () => '', candidates: [] };
  }

  for (const model of candidateModels) {
    if (callerSignal?.aborted) return { text: () => '', candidates: [] };
    const bodyPayload: any = {
      model,
      messages,
      modalities: ['text'],
      temperature: params?.config?.temperature ?? 0.7,
      max_tokens: params?.config?.maxOutputTokens ?? (hasDocument ? 16384 : 4096),
      include_reasoning: false,
      web_search: webSearchEnabled,
      enable_search: webSearchEnabled,
      ...(webSearchEnabled ? { search_options: { enable_citation: true, enable_source: true } } : {}),
    };

    if (params?.config?.responseMimeType === 'application/json' || params?.config?.response_format?.type === 'json_object') {
      bodyPayload.response_format = { type: 'json_object' };
    }

    for (const endpoint of endpoints) {
      if (callerSignal?.aborted) return { text: () => '', candidates: [] };
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (callerSignal?.aborted) return { text: () => '', candidates: [] };
        try {
          // The DashScope key is resolved server-side from Supabase api_keys
          // (or server env); the browser never sends it in a header.
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-DashScope-WorkSpace': 'ws-o3v6mh0i8y9tqdfx',
          };

          // PDF understanding can take up to ~300s for first token
          const fetchController = new AbortController();
          const onCallerAbort = () => fetchController.abort();
          if (callerSignal) {
            callerSignal.addEventListener('abort', onCallerAbort, { once: true });
          }
          const timeoutMs = hasDocument ? 280000 : (webSearchEnabled ? 150000 : 45000);
          const timeoutId = setTimeout(() => fetchController.abort(), timeoutMs);

          let response: Response;
          try {
            response = await fetch(endpoint, {
              method: 'POST',
              headers,
              body: JSON.stringify(bodyPayload),
              signal: fetchController.signal,
            });
          } finally {
            clearTimeout(timeoutId);
            if (callerSignal) {
              callerSignal.removeEventListener('abort', onCallerAbort);
            }
          }

          if (callerSignal?.aborted) return { text: () => '', candidates: [] };

          const ct = (response.headers?.get?.('content-type') || '').toLowerCase();
          if (ct.includes('text/html')) {
            throw new Error('NETWORK_OFFLINE: Network connection lost. Please check your internet connection and try again.');
          }

          if (response.status === 429) {
            isRateLimited = true;
            const retryAfterHeader = response.headers.get('retry-after');
            const errText = await response.text().catch(() => '');
            console.warn(`[AlibabaChat] status=429 reason=upstream_overloaded model=${model} attempt=${attempt}/${maxRetries}`);

            if (attempt < maxRetries) {
              const delay = getBackoffDelayMs(attempt, retryAfterHeader);
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }
            throw new Error(`429_RATE_LIMIT: Upstream provider is temporarily overloaded.`);
          }

          if (!response.ok) {
            const errorText = await response.text();
            if (errorText.toLowerCase().includes('<!doctype') || errorText.toLowerCase().includes('<html') || errorText.toLowerCase().includes('id="root"')) {
              throw new Error('NETWORK_OFFLINE: Network connection lost. Please check your internet connection and try again.');
            }
            if (response.status >= 500 || errorText.includes('FUNCTION_INVOCATION_FAILED')) {
              console.warn(`[AlibabaChat] Server error on endpoint ${endpoint} (HTTP ${response.status}): ${errorText.slice(0, 150)}`);
              throw new Error(`SERVER_ERROR_${response.status}: Alibaba Qwen Direct HTTP ${response.status}: ${errorText}`);
            }
            throw new Error(`Alibaba Qwen Direct HTTP ${response.status}: ${errorText}`);
          }

          const rawText = await response.text();
          const trimmedLower = rawText.trim().toLowerCase();
          if (trimmedLower.startsWith('<!doctype') || trimmedLower.startsWith('<html') || trimmedLower.includes('<head>') || trimmedLower.includes('id="root"')) {
            throw new Error('NETWORK_OFFLINE: Network connection lost. Please check your internet connection and try again.');
          }

          let data: any = null;
          let extractedText = '';

          if (rawText.startsWith('data:') || rawText.includes('\ndata:')) {
            const lines = rawText.split('\n');
            const chunks: string[] = [];
            for (const line of lines) {
              const trimmedLine = line.trim();
              if (trimmedLine.startsWith('data:')) {
                const contentStr = trimmedLine.slice(5).trim();
                if (contentStr === '[DONE]') continue;
                try {
                  const chunkObj = JSON.parse(contentStr);
                  const content =
                    chunkObj?.choices?.[0]?.delta?.content ??
                    chunkObj?.choices?.[0]?.message?.content ??
                    chunkObj?.output?.text ??
                    '';
                  if (content) {
                    chunks.push(content);
                  }
                } catch (_) {}
              }
            }
            extractedText = chunks.length > 0 ? chunks.join('') : rawText;
          } else {
            try {
              data = JSON.parse(rawText);
              if (data?.choices?.[0]?.message?.content !== undefined) {
                extractedText = data.choices[0].message.content;
              } else if (data?.choices?.[0]?.delta?.content !== undefined) {
                extractedText = data.choices[0].delta.content;
              } else if (data?.output?.text !== undefined) {
                extractedText = data.output.text;
              } else {
                extractedText = rawText;
              }
            } catch (_) {
              extractedText = rawText;
            }
          }

          if (
            extractedText.includes('data: {') ||
            extractedText.includes('chatcmpl-') ||
            extractedText.includes('object:"chat.completion.chunk"')
          ) {
            extractedText = '';
          }

          return {
            text: () => extractedText,
            candidates: [
              {
                content: {
                  parts: [{ text: extractedText }],
                  role: 'model',
                },
                finishReason: data?.choices?.[0]?.finish_reason || 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: data?.usage?.prompt_tokens || 0,
              candidatesTokenCount: data?.usage?.completion_tokens || 0,
              totalTokenCount: data?.usage?.total_tokens || 0,
            },
          };
        } catch (err: any) {
          lastError = err;
          if (err?.message?.startsWith('429_RATE_LIMIT') || err?.message?.startsWith('SERVER_ERROR_')) {
            break; // Don't retry the same failing endpoint repeatedly
          }
        }
      }
    }
  }

  if (isRateLimited) {
    throw new Error("Avelut's AI provider is temporarily busy. Please try again in a moment.");
  }

  throw new Error(`[Alibaba Qwen API Error] Request failed on model "${primaryModel}": ${lastError?.message || 'No available endpoint'}`);
}

/**
 * Call Alibaba Cloud DashScope / Qwen Direct API Endpoint with SSE Streaming
 */
async function* callAlibabaQwenStream(
  params: any,
  appSettings: AppSettings,
  options?: AvelutAIOptions
): AsyncGenerator<any, void, unknown> {
  const { messages, hasImage } = paramsToChatMessages(params);
  const model = normalizeAlibabaDashScopeModel(params?.model, hasImage);
  const webSearchEnabled = params?.config?.webSearch === true;

  const isNative = typeof window !== 'undefined' && (
    (window as any).Capacitor?.isNativePlatform?.() ||
    window.location.protocol === 'file:'
  );

  const endpoints = resolveAlibabaEndpoints(appSettings, isNative, options);

  const bodyPayload: any = {
    model,
    messages,
    modalities: ['text'],
    stream: true,
    stream_options: { include_usage: true },
    enable_thinking: false,
    include_reasoning: false,
    temperature: params?.config?.temperature ?? 0.7,
    max_tokens: params?.config?.maxOutputTokens ?? 4096,
    web_search: webSearchEnabled,
    enable_search: webSearchEnabled,
    ...(webSearchEnabled ? { search_options: { enable_citation: true, enable_source: true } } : {}),
  };

  if (params?.config?.responseMimeType === 'application/json' || params?.config?.response_format?.type === 'json_object') {
    bodyPayload.response_format = { type: 'json_object' };
  }

  let response: Response | null = null;
  let lastStreamError = '';

  const callerSignal = options?.signal || params?.signal || params?.config?.signal;
  if (callerSignal?.aborted) return;

  for (const endpoint of endpoints) {
    if (callerSignal?.aborted) return;
    try {
      // No client-side Authorization header: key stays server-side.
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'X-DashScope-WorkSpace': 'ws-o3v6mh0i8y9tqdfx',
      };

      const fetchController = new AbortController();
      const onCallerAbort = () => fetchController.abort();
      if (callerSignal) {
        callerSignal.addEventListener('abort', onCallerAbort, { once: true });
      }
      const timeoutId = setTimeout(() => fetchController.abort(), webSearchEnabled ? 150000 : 45000);

      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(bodyPayload),
          signal: fetchController.signal,
        });
      } finally {
        clearTimeout(timeoutId);
        if (callerSignal) {
          callerSignal.removeEventListener('abort', onCallerAbort);
        }
      }

      if (res.ok && res.body) {
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('text/html')) {
          console.warn(`[Alibaba SSE] Endpoint ${endpoint} returned HTML (SPA fallback / offline). Skipping endpoint.`);
          continue;
        }
        response = res;
        break;
      } else {
        const errText = await res.text().catch(() => '');
        lastStreamError = `HTTP ${res.status}: ${errText}`;
        console.warn(`[Alibaba SSE] Endpoint ${endpoint} returned HTTP ${res.status}:`, errText);
      }
    } catch (err: any) {
      lastStreamError = err?.message || 'Network error';
      console.warn(`[Alibaba SSE] Endpoint ${endpoint} fetch error:`, err?.message);
    }
  }

  if (callerSignal?.aborted) return;

  if (!response || !response.body) {
    throw new Error(`[Alibaba SSE] Stream response not available: ${lastStreamError || 'No available endpoint'}`);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/event-stream')) {
    const text = await response.text();
    const trimmed = text.trim().toLowerCase();
    if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html') || trimmed.includes('<head>') || trimmed.includes('id="root"')) {
      throw new Error('NETWORK_OFFLINE: Network connection lost. Please check your internet connection and try again.');
    }
    yield {
      text: () => text,
      reasoningText: () => '',
      candidates: [{ content: { parts: [{ text }], role: 'model' } }],
    };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      if (callerSignal?.aborted) break;
      const { done, value } = await reader.read();
      if (done || callerSignal?.aborted) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') return;

        if (trimmed.startsWith('data:')) {
          const jsonStr = trimmed.slice(5).trim();
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed?.choices?.[0]?.delta;
            let deltaText = '';
            if (typeof delta?.content === 'string') {
              deltaText = delta.content;
            } else if (Array.isArray(delta?.content)) {
              deltaText = delta.content.map((p: any) => p?.text || '').join('');
            } else if (typeof parsed?.choices?.[0]?.text === 'string') {
              deltaText = parsed.choices[0].text;
            } else if (typeof parsed?.choices?.[0]?.message?.content === 'string') {
              deltaText = parsed.choices[0].message.content;
            }

            let reasoningText = delta?.reasoning || delta?.reasoning_content || '';
            if (!reasoningText && parsed?.choices?.[0]?.message?.reasoning_content) {
              reasoningText = parsed.choices[0].message.reasoning_content;
            } else if (!reasoningText && parsed?.choices?.[0]?.message?.reasoning) {
              reasoningText = parsed.choices[0].message.reasoning;
            }
            let finishReason = parsed?.choices?.[0]?.finish_reason || null;
            const usage = parsed?.usage || parsed?.response?.usage;
            const searchInfo = parsed?.search_info || parsed?.choices?.[0]?.search_info;

            if (deltaText || reasoningText || finishReason || usage || searchInfo) {
              yield {
                text: () => deltaText,
                reasoningText: () => reasoningText,
                searchInfo,
                candidates: [
                  {
                    content: {
                      parts: [{ text: deltaText, reasoning: reasoningText }],
                      role: 'model',
                    },
                    finishReason,
                  },
                ],
                usageMetadata: usage ? {
                  promptTokenCount: usage.prompt_tokens || 0,
                  candidatesTokenCount: usage.completion_tokens || 0,
                  totalTokenCount: usage.total_tokens || 0,
                } : undefined,
              };
            }
          } catch {
            // Ignore JSON parse errors on partial chunks
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Centralized client factory that instantiates the Alibaba Qwen AI client.
 * Direct Alibaba Cloud DashScope API with fallback support.
 */
export const createAvelutAI = (
  appSettings: AppSettings,
  userProfile?: UserProfile | null,
  options?: AvelutAIOptions
): any => {
  // Single chokepoint for every text call: ignore caller/legacy model names
  // and always send the one canonical model to the server proxy.
  const normalizeParams = (params: any) => {
    if (typeof params === 'string') {
      return { contents: params, model: AVELUT_TEXT_MODEL };
    }
    return { ...(params || {}), model: AVELUT_TEXT_MODEL };
  };

  const generateContent = async (params: any) => {
    const mergedOptions: AvelutAIOptions = { ...options, signal: params?.signal || params?.config?.signal || options?.signal };
    return await callAlibabaQwen(normalizeParams(params), appSettings, mergedOptions);
  };

  const generateContentStream = async (params: any) => {
    const mergedOptions: AvelutAIOptions = { ...options, signal: params?.signal || params?.config?.signal || options?.signal };
    const streamGen = callAlibabaQwenStream(normalizeParams(params), appSettings, mergedOptions);
    return {
      [Symbol.asyncIterator]: () => streamGen,
      stream: streamGen,
      response: Promise.resolve(null),
    };
  };

  return {
    generateContent,
    generateContentStream,
    models: {
      generateContent,
      generateContentStream,
      generateImages: async () => {
        throw new Error('Image generation is not supported on this model endpoint.');
      },
    },
    interactions: {
      create: async (params: any) => {
        return await callAlibabaQwen(normalizeParams(params), appSettings, options);
      },
    },
  };
};
