// Claude API access straight from the iPad (user-supplied API key, official
// Anthropic SDK in browser mode). Streams text and runs a client-side tool loop
// so Jarvis and the Circuit Lab can act on the Holomat.
import Anthropic from '../../vendor/anthropic/sdk.mjs';
import { settings } from './store.js';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'Most capable · default' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', note: 'Faster replies' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', note: 'Fastest · lowest cost' },
];

const isHaiku = (m) => m.startsWith('claude-haiku');
// Server-side refusal fallback ("default" routing) is available for these models.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// Optional request features get switched off for the session if the account
// rejects them (e.g. web search disabled by an org admin).
const unsupported = { fallbacks: false, webSearch: false };

export class NoKeyError extends Error {
  constructor() { super('No Claude API key yet — add one in SYSTEM › Claude.'); this.name = 'NoKeyError'; }
}

let client = null;
let clientKey = null;

export function hasKey() { return !!(settings.get('apiKey') || '').trim(); }

function getClient() {
  const key = (settings.get('apiKey') || '').trim();
  if (!key) throw new NoKeyError();
  if (!client || clientKey !== key) {
    // The key lives only on this device (localStorage) and is sent only to api.anthropic.com.
    client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
    clientKey = key;
  }
  return client;
}

/** Cheap key check (no tokens spent): look up the selected model. */
export async function testKey() {
  const c = getClient();
  const m = await c.models.retrieve(settings.get('model'));
  return m.display_name || m.id;
}

export function describeError(err) {
  if (err instanceof NoKeyError) return err.message;
  if (err instanceof Anthropic.APIUserAbortError) return 'Stopped.';
  if (err instanceof Anthropic.AuthenticationError) return 'Claude rejected the API key (401). Check it in SYSTEM › Claude.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use that model (403).';
  if (err instanceof Anthropic.NotFoundError) return 'That model is not available for this API key (404). Pick another in SYSTEM › Claude.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the Claude API — try again in a moment.';
  if (err instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${err.message}`;
  if (err instanceof Anthropic.InternalServerError) return 'Claude is temporarily unavailable. Try again shortly.';
  if (err instanceof Anthropic.APIConnectionError) return 'Cannot reach Claude — check the internet connection.';
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ''}: ${err.message}`;
  return (err && err.message) || String(err);
}

export function isAbort(err) { return err instanceof Anthropic.APIUserAbortError || err?.name === 'AbortError'; }

// ------------------------------------------------------------------ tiny JSON-schema check
// (eager input streaming means tool inputs are not validated server-side)
function validate(schema, value, path = 'input') {
  if (!schema) return null;
  const t = schema.type;
  if (t === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return `${path} must be an object`;
    for (const k of schema.required || []) if (!(k in value)) return `${path}.${k} is required`;
    for (const [k, sub] of Object.entries(schema.properties || {})) {
      if (k in value) { const e = validate(sub, value[k], `${path}.${k}`); if (e) return e; }
    }
    return null;
  }
  if (t === 'array') {
    if (!Array.isArray(value)) return `${path} must be an array`;
    for (let i = 0; i < value.length; i++) { const e = validate(schema.items, value[i], `${path}[${i}]`); if (e) return e; }
    return null;
  }
  if (t === 'string' && typeof value !== 'string') return `${path} must be a string`;
  if ((t === 'number' || t === 'integer') && (typeof value !== 'number' || !Number.isFinite(value))) return `${path} must be a number`;
  if (t === 'boolean' && typeof value !== 'boolean') return `${path} must be a boolean`;
  if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.join(', ')}`;
  return null;
}

/**
 * Stream one assistant turn, running client tools until Claude is done.
 *
 * opts.messages is the conversation (Anthropic message params). It is appended to
 * in place (assistant turns incl. thinking blocks, tool results) so callers keep an
 * append-only history.
 *
 * opts: { system, messages, tools:[{name, description, input_schema, run}], effort,
 *         maxTokens, webSearch, model, signal, onText(delta), onToolUse(name, input) }
 * → { text, refused, stopReason }
 */
export async function converse(opts) {
  const c = getClient();
  const model = opts.model || settings.get('model');
  const toolDefs = (opts.tools || []).map((t) => ({
    name: t.name, description: t.description, input_schema: t.input_schema, eager_input_streaming: true,
  }));
  const byName = new Map((opts.tools || []).map((t) => [t.name, t]));
  let text = '';
  let jsonRetries = 0;
  let strip = 0; // 1 = drop fallbacks, 2 = also drop web search (after a 400)

  for (let round = 0; round < 16; round++) {
    const useFallback = FALLBACK_MODELS.has(model) && !unsupported.fallbacks && strip < 1;
    const useSearch = !!opts.webSearch && !unsupported.webSearch && strip < 2;
    const tools = [...toolDefs];
    if (useSearch) tools.push({ type: isHaiku(model) ? 'web_search_20250305' : 'web_search_20260209', name: 'web_search', max_uses: 3 });

    const params = {
      model,
      max_tokens: opts.maxTokens || 16000,
      messages: opts.messages,
      cache_control: { type: 'ephemeral' },
    };
    if (opts.system) params.system = opts.system;
    if (tools.length) params.tools = tools;
    if (opts.effort && !isHaiku(model)) params.output_config = { effort: opts.effort };

    let message;
    try {
      const stream = useFallback
        ? c.beta.messages.stream({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' }, { signal: opts.signal })
        : c.messages.stream(params, { signal: opts.signal });
      stream.on('text', (d) => { text += d; opts.onText && opts.onText(d); });
      message = await stream.finalMessage();
      jsonRetries = 0;
      if (strip >= 1 && FALLBACK_MODELS.has(model)) unsupported.fallbacks = true;
      if (strip >= 2 && opts.webSearch) unsupported.webSearch = true;
    } catch (err) {
      if (err instanceof Anthropic.BadRequestError && strip < 2 && (useFallback || useSearch)) {
        strip = useFallback ? 1 : 2; // retry without the optional feature(s)
        continue;
      }
      if (err instanceof Anthropic.APIError || isAbort(err) || err instanceof NoKeyError) throw err;
      if (jsonRetries++ >= 2) throw err; // tool input JSON that could not be parsed: re-issue the turn
      continue;
    }

    if (message.stop_reason === 'refusal') return { text, refused: true, stopReason: 'refusal' };

    const toolUses = message.content.filter((b) => b.type === 'tool_use');
    if (message.stop_reason === 'max_tokens' && toolUses.length) throw new Error('Reply was cut off mid tool call (max_tokens).');

    opts.messages.push({ role: 'assistant', content: message.content });

    if (message.stop_reason === 'pause_turn') continue;
    if (message.stop_reason !== 'tool_use' || !toolUses.length) return { text, refused: false, stopReason: message.stop_reason };

    const results = await Promise.all(toolUses.map(async (tu) => {
      const def = byName.get(tu.name);
      if (!def) return { type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `Unknown tool ${tu.name}` };
      const bad = validate(def.input_schema, tu.input);
      if (bad) return { type: 'tool_result', tool_use_id: tu.id, is_error: true, content: JSON.stringify({ INVALID_INPUT: bad, received: tu.input }) };
      opts.onToolUse && opts.onToolUse(tu.name, tu.input);
      try {
        const out = await def.run(tu.input);
        return { type: 'tool_result', tool_use_id: tu.id, content: typeof out === 'string' ? out : JSON.stringify(out ?? { ok: true }) };
      } catch (e) {
        return { type: 'tool_result', tool_use_id: tu.id, is_error: true, content: String(e.message || e) };
      }
    }));
    // all results for one assistant turn go back in a single user message
    opts.messages.push({ role: 'user', content: results });
  }
  return { text, refused: false, stopReason: 'max_rounds' };
}

/** Plain text of an assistant message's content blocks. */
export function textOf(content) {
  if (typeof content === 'string') return content;
  return (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}
