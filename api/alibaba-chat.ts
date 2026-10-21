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

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedAt?: string;
}

function isRealTimeSearchNeeded(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim().toLowerCase();
  if (t.length < 3) return false;

  const isAlgorithmConcept =
    /\b(binary|linear|depth\s*first|breadth\s*first|tree|graph|heuristic|grid|interpolation|exponential|a\*|dijkstra)\s*search\b/i.test(t) ||
    /\bsearch\s*(algorithm|complexity|tree|pattern|implementation|code)\b/i.test(t);

  const hasExplicitWebSearch =
    /\b(search\s+(the\s+)?(web|internet|net|online)|browse\s+(the\s+)?(web|internet|net)|check\s*online|web\s*search|google\s+this|google\s+it)\b/i.test(t) ||
    (!isAlgorithmConcept && /^(please\s+)?(search|look\s*up|browse|google)\b/i.test(t));
  if (hasExplicitWebSearch) return true;

  if (/\b(news|headline|headlines|breaking|what\s+happened|whats\s+happening|developing\s+story)\b/i.test(t)) {
    return true;
  }

  if (/\b(today|yesterday|tomorrow|tonight|this\s+(week|weekend|month|year)|latest|current|currently|recent|recently|right\s+now|nowadays|at\s+the\s+moment)\b/i.test(t)) {
    return true;
  }

  if (/\b(weather|forecast|temperature|humidity)\b/i.test(t)) return true;
  if (/\b(stock|stocks|share\s*price|crypto|bitcoin|btc|eth|ethereum|solana|exchange\s*rate|dollar\s*rate|naira\s*rate|forex)\b/i.test(t)) return true;
  if (/\b(match\s*score|game\s*score|standings|premier\s*league|champions\s*league|world\s*cup|ballon\s*d'or|nba|nfl)\b/i.test(t)) return true;
  if (/\b(election|poll\s*numbers|voting\s*results|who\s+won|who\s+is\s+the\s+current)\b/i.test(t)) return true;
  if (/\b(release\s*date|air\s*date|box\s*office|in\s+cinemas)\b/i.test(t)) return true;

  if (/\b(2025|2026|2027|2028|2029|2030)\b/.test(t)) return true;

  return false;
}

function cleanSearchQuery(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/^(can\s+you\s+)?(please\s+)?(search\s+(the\s+)?(web|internet|net|online)\s+(for\s+)?|browse\s+(the\s+)?(web|internet|net)\s+(for\s+)?|look\s*up\s+|google\s+)/i, '')
    .trim() || text;
}

async function searchWeb(query: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<WebSearchResult[]> {
  const isNews = /\b(news|headline|headlines|today|latest|breaking|update)\b/i.test(query);
  const results: WebSearchResult[] = [];
  const maxResults = 5;

  // 1. Google News RSS for live news queries
  if (isNews) {
    try {
      const newsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
      const res = await fetch(newsUrl, { signal: options.signal });
      if (res.ok) {
        const xml = await res.text();
        const itemRegex = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>/g;
        let match;
        while ((match = itemRegex.exec(xml)) && results.length < maxResults) {
          const rawTitle = match[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
          const rawUrl = match[2].trim();
          results.push({
            title: rawTitle,
            url: rawUrl,
            snippet: `Published ${match[3].trim()}: ${rawTitle}`,
            source: 'Google News',
            publishedAt: match[3].trim(),
          });
        }
      }
    } catch (e) {
      console.warn('[alibaba-chat] Google News note:', (e as Error)?.message);
    }
  }

  // 2. DuckDuckGo HTML search for general web queries
  if (results.length < maxResults) {
    try {
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(ddgUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
        signal: options.signal,
      });
      if (res.ok) {
        const html = await res.text();
        const itemRegex = /<h2 class="result__title">[\s\S]*?<a class="result__url"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
        let match;
        while ((match = itemRegex.exec(html)) && results.length < maxResults) {
          let destUrl = match[1];
          if (destUrl.includes('uddg=')) {
            try {
              const u = new URL(destUrl, 'https://duckduckgo.com');
              destUrl = decodeURIComponent(u.searchParams.get('uddg') || destUrl);
            } catch {}
          }
          const title = match[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
          const snippet = match[3].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
          let source = 'web';
          try { source = new URL(destUrl).hostname.replace(/^www\./, ''); } catch {}
          if (!results.some(r => r.url === destUrl)) {
            results.push({
              title,
              url: destUrl,
              snippet,
              source,
            });
          }
        }
      }
    } catch (e) {
      console.warn('[alibaba-chat] DuckDuckGo note:', (e as Error)?.message);
    }
  }

  return results;
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
    const messages = Array.isArray(body.messages) ? [...body.messages] : [];
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

    // Real web search grounding when browse/search is requested
    let searchResults: WebSearchResult[] = [];
    if (body.web_search || body.enable_search) {
      const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
      let userQuery = '';
      if (typeof lastUserMsg?.content === 'string') {
        userQuery = lastUserMsg.content;
      } else if (Array.isArray(lastUserMsg?.content)) {
        userQuery = lastUserMsg.content.map((c: any) => c.text || '').join(' ');
      }

      // Check if this query actually requires web search (making it adaptive / optional)
      const needsSearch = isRealTimeSearchNeeded(userQuery);
      const queryToSearch = cleanSearchQuery(userQuery);

      if (needsSearch && queryToSearch && queryToSearch.trim().length >= 2) {
        try {
          searchResults = await searchWeb(queryToSearch, { signal: controller.signal, timeoutMs: 8000 });
          if (searchResults.length > 0) {
            const searchGrounding = [
              `[REAL-TIME LIVE WEB SEARCH RESULTS FOR: "${queryToSearch}"]`,
              ...searchResults.map((r, i) =>
                `Source ${i + 1}: ${r.title}\nURL: ${r.url}\nSummary: ${r.snippet}`
              ),
              'INSTRUCTIONS FOR ASSISTANT:',
              `- You have been provided with real-time web search results above for current date and events.`,
              `- Answer the user's question directly, clearly, and thoroughly using these live results.`,
              `- Cite the relevant source URLs as clickable markdown links (e.g. [Source Name](url)).`,
              `- Do not state that you cannot browse or lack real-time access; answer directly using the search results above.`,
            ].join('\n\n');

            messages.unshift({
              role: 'system',
              content: searchGrounding,
            });
          }
        } catch (searchErr) {
          console.warn('[alibaba-chat] web search note:', (searchErr as Error)?.message);
        }
      }
    }

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
            let streamBody = response.body;

            // If we have search results, inject the search_info SSE event at the start
            if (searchResults.length > 0) {
              const encoder = new TextEncoder();
              const searchInfoChunk = encoder.encode(
                `data: ${JSON.stringify({
                  choices: [{ delta: { content: '' }, index: 0 }],
                  search_info: {
                    search_results: searchResults.map((r) => ({
                      title: r.title,
                      url: r.url,
                      snippet: r.snippet,
                    })),
                  },
                })}\n\n`
              );

              const originalReader = response.body.getReader();
              streamBody = new ReadableStream({
                async start(controllerStream) {
                  controllerStream.enqueue(searchInfoChunk);
                  try {
                    while (true) {
                      const { done, value } = await originalReader.read();
                      if (done) break;
                      controllerStream.enqueue(value);
                    }
                  } finally {
                    controllerStream.close();
                  }
                },
              });
            }

            return new Response(streamBody, {
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
