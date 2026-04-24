const https = require('https');

function truncateStr(str, max) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max) + '\n[truncated]';
}

function sanitiseMessages(messages) {
  return (messages || []).map(function(msg) {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: truncateStr(msg.content, 8000) };
    }
    if (Array.isArray(msg.content)) {
      return {
        role: msg.role,
        content: msg.content.map(function(block) {
          if (block.type === 'text') return { type: 'text', text: truncateStr(block.text, 8000) };
          return block;
        })
      };
    }
    return msg;
  });
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let messages, system, apiKey, maxTokens;
  try {
    const body = JSON.parse(event.body);
    messages = body.messages;
    system = body.system;
    apiKey = body.apiKey;
    maxTokens = body.maxTokens || 800;
  } catch(e) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: { message: 'Invalid request body' } }) };
  }

  const payload = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system: truncateStr(system, 12000),
    messages: sanitiseMessages(messages)
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify(parsed)
          });
        } catch(e) {
          resolve({
            statusCode: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: { message: 'Invalid response from API' } })
          });
        }
      });
    });
    req.on('error', (e) => {
      resolve({ statusCode: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: { message: e.message } }) });
    });
    req.write(payload);
    req.end();
  });
};
