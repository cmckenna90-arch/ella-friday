// Netlify Edge Function — streams Claude API responses
// Edge functions run on Deno, have no timeout issue, and support streaming responses
// This replaces the serverless function for the /api/chat route

export default async function handler(request, context) {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response('', {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let messages, system, apiKey, maxTokens;
  try {
    const body = await request.json();
    messages = body.messages || [];
    system = body.system || '';
    apiKey = body.apiKey || '';
    maxTokens = body.maxTokens || 800;
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: 'Invalid request body' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  if (!apiKey) {
    return new Response(JSON.stringify({ error: { message: 'No API key provided' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // Sanitise messages — truncate large content to prevent payload bloat
  function truncateStr(str, max) {
    if (!str || str.length <= max) return str;
    return str.slice(0, max) + '\n[truncated]';
  }

  const sanitised = messages.map(msg => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: truncateStr(msg.content, 8000) };
    }
    if (Array.isArray(msg.content)) {
      return {
        role: msg.role,
        content: msg.content.map(block => {
          if (block.type === 'text') return { type: 'text', text: truncateStr(block.text, 8000) };
          return block;
        })
      };
    }
    return msg;
  });

  const payload = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system: truncateStr(system, 12000),
    messages: sanitised,
    stream: true
  };

  // Call Anthropic streaming API
  let anthropicResponse;
  try {
    anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: e.message } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  if (!anthropicResponse.ok) {
    const errText = await anthropicResponse.text();
    return new Response(errText, {
      status: anthropicResponse.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // Collect full streaming response and return as a single JSON object
  // (matching the existing non-streaming API shape the client expects)
  const reader = anthropicResponse.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const event = JSON.parse(data);
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          fullText += event.delta.text;
        }
        if (event.type === 'message_delta' && event.usage) {
          outputTokens = event.usage.output_tokens || 0;
        }
        if (event.type === 'message_start' && event.message?.usage) {
          inputTokens = event.message.usage.input_tokens || 0;
        }
      } catch (_) {
        // ignore parse errors on individual SSE events
      }
    }
  }

  // Return in the same shape as the non-streaming Anthropic Messages API
  const result = {
    content: [{ type: 'text', text: fullText }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens }
  };

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export const config = {
  path: '/api/chat'
};
