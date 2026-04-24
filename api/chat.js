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

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method Not Allowed' } });
  }

  let messages, system, apiKey, maxTokens;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    messages = body.messages;
    system = body.system;
    apiKey = body.apiKey;
    maxTokens = body.maxTokens || 800;
  } catch(e) {
    return res.status(400).json({ error: { message: 'Invalid request body' } });
  }

  const payload = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system: truncateStr(system, 12000),
    messages: sanitiseMessages(messages)
  });

  return new Promise((resolve) => {
    const req2 = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          res.status(200).json(parsed);
        } catch(e) {
          res.status(500).json({ error: { message: 'Invalid response from API' } });
        }
        resolve();
      });
    });
    req2.on('error', (e) => {
      res.status(500).json({ error: { message: e.message } });
      resolve();
    });
    req2.write(payload);
    req2.end();
  });
};
