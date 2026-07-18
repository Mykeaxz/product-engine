// claude.js — thin wrapper. All brand-specific behaviour comes from the
// system prompt passed in (built by lib/brand.js), never hardcoded here.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-5';

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Ask Claude and get back parsed JSON (used for copy, naming, image prompts).
export async function askJSON({ system, user, maxTokens = 8000, temperature = 0.4 }) {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return parseJSON(text);
}

// Margin/comps reasoning with web search enabled.
export async function askWithWebSearch({ system, user, maxTokens = 4000 }) {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
    messages: [{ role: 'user', content: user }],
  });
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return parseJSON(text);
}

function parseJSON(text) {
  // Strip accidental fences, grab the first {...} block.
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('claude did not return JSON: ' + text.slice(0, 200));
  return JSON.parse(cleaned.slice(start, end + 1));
}
