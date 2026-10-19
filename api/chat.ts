import { streamText, convertToCoreMessages } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { webSearchTool } from '../lib/tools/web-search';

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

export async function POST(req: Request) {
  try {
    const { messages, model: requestedModel } = await req.json();

    const incomingAuth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || '';
    const validClientKey = incomingAuth && incomingAuth !== 'undefined' && incomingAuth !== 'null' && incomingAuth.length > 10
      ? incomingAuth
      : '';

    const alibabaApiKey =
      process.env.ALIBABA_API_KEY ||
      process.env.VITE_ALIBABA_API_KEY ||
      validClientKey ||
      'sk-ws-H.DDLPMIE.fbaD.MEQCIFkao1-I0HQyUMxmrty8-k1S70b0xjgF1BoNksO2pM6WAiACzxp1ojlxhmc6YQFNodecye0oQOBAalaHxCVNdJfQjA';

    const dashscope = createOpenAI({
      baseURL: process.env.ALIBABA_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      apiKey: alibabaApiKey,
    });

    const modelName = requestedModel || 'qwen3.5-omni-flash';

    const result = streamText({
      model: dashscope(modelName),
      messages: convertToCoreMessages(messages || []),
      tools: {
        web_search: webSearchTool,
      },
      maxSteps: 3,
      abortSignal: req.signal,
    });

    return result.toUIMessageStreamResponse();
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || 'Internal AI Chat Endpoint Error' }),
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
