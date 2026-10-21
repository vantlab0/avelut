import { streamText, convertToModelMessages, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { webSearchTool } from '../lib/tools/web-search';
import {
  WEB_SEARCH_SYSTEM_INSTRUCTION,
  WEB_SEARCH_UNAVAILABLE_INSTRUCTION,
  isWebSearchConfigured,
} from '../lib/server/web-search';

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

export async function POST(req: Request) {
  try {
    const { messages, model: requestedModel, web_search } = await req.json();

    const incomingAuth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || '';
    const validClientKey = incomingAuth && incomingAuth !== 'undefined' && incomingAuth !== 'null' && incomingAuth.length > 10
      ? incomingAuth
      : '';

    const alibabaApiKey =
      process.env.ALIBABA_API_KEY ||
      process.env.VITE_ALIBABA_API_KEY ||
      validClientKey;

    if (!alibabaApiKey) {
      return new Response(
        JSON.stringify({
          error: 'Avelut AI is not configured on this deployment. Add ALIBABA_API_KEY on the server.',
          code: 'AI_NOT_CONFIGURED',
        }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const dashscope = createOpenAI({
      baseURL: process.env.ALIBABA_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      apiKey: alibabaApiKey,
    });

    const modelName = requestedModel || 'qwen3.5-omni-flash';
    const browseRequested = web_search === true || web_search === 'true';
    const searchAvailable = browseRequested && isWebSearchConfigured();

    const system = [
      'You are Avelut AI, a helpful study tutor.',
      searchAvailable
        ? WEB_SEARCH_SYSTEM_INSTRUCTION
        : browseRequested
          ? WEB_SEARCH_UNAVAILABLE_INSTRUCTION
          : 'Web browsing is disabled by the user. Do not claim to search the web or cite live results.',
    ].join(' ');

    const incomingMessages = Array.isArray(messages) ? messages : [];
    const usesUiMessageParts =
      incomingMessages.length > 0 &&
      incomingMessages.every((message: any) => Array.isArray(message?.parts));
    const modelMessages = usesUiMessageParts
      ? await convertToModelMessages(incomingMessages)
      : incomingMessages;

    const result = streamText({
      model: dashscope(modelName),
      system,
      messages: modelMessages,
      ...(searchAvailable ? {
        tools: { web_search: webSearchTool },
        stopWhen: stepCountIs(3),
      } : {}),
      abortSignal: req.signal,
    });

    return result.toUIMessageStreamResponse();
  } catch (error: any) {
    console.error('[AI Chat Endpoint] Unhandled error:', error?.message || error);
    return new Response(
      JSON.stringify({ error: 'Internal AI Chat Endpoint Error' }),
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
