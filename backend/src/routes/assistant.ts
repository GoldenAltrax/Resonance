import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { db, assistantConversations, assistantMessages, users } from '../db/index.js';
import { adminMiddleware } from '../middleware/auth.js';
import { runTool, toolDefinitions, toolLabel, webSearchEnabled } from '../services/assistantTools.js';
import { usageReport, setCredit } from '../services/assistantUsage.js';

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ASSISTANT_MODEL || 'claude-haiku-5-5';
/** Model calls per user message; each tool round is one call. */
const MAX_ROUNDS = 10;
/** Earlier messages sent with each request. Older ones stay in the database but are not resent. */
const HISTORY_LIMIT = 40;

const client = API_KEY ? new Anthropic({ apiKey: API_KEY }) : null;

const chatSchema = z.object({ message: z.string().trim().min(1).max(4000) });

function systemPrompt(username: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are the assistant inside Resonance, a self-hosted music player. You talk only with ${username}, the admin. Today is ${today}.

Your main job is getting music into the library and organising it:
- When asked for a song, find it with search_music and queue the original studio version by the right artist. Skip live, remix, cover, karaoke and sped-up versions unless they are asked for.
- If a request is ambiguous (several different songs share a name and nothing tells them apart), ask a short question instead of guessing.
- For lists you can work out yourself ("10 essential Daft Punk songs", "the Interstellar soundtrack"), queue them directly with queue_songs using titles and artists; you do not need to search each one.${webSearchEnabled() ? '\n- Use web_search for anything recent or that you are unsure of: charts, new releases, songs from a show or video, then queue what you find.' : '\n- Web search is not set up, so rely on what you know and the music catalog.'}
- To make a playlist with songs that may not be downloaded yet: create_playlist first, then queue_songs with its playlist_id. Songs already in the library go into the playlist right away; the rest join as they finish downloading.
- Downloads run in the background and take a minute or so per song. Say what was queued; do not claim songs are already downloaded.
- If a tool asks for confirmation, ask the user and wait for a yes before calling it again with confirmed: true.

You can also help with general questions as a personal assistant.

Style: brief and plain. Short sentences, no emojis, no filler. Report outcomes with numbers ("Queued 12 songs, 3 were already in your library"). Use simple lists when listing songs. Do not mention tool names or ids to the user.`;
}

type StoredContent = string | Anthropic.ContentBlockParam[];

function currentConversation(userId: string): string {
  const latest = db.select({ id: assistantConversations.id }).from(assistantConversations)
    .where(eq(assistantConversations.userId, userId))
    .orderBy(desc(assistantConversations.createdAt), desc(sql`rowid`)).limit(1).get();
  if (latest) return latest.id;
  const id = uuidv4();
  db.insert(assistantConversations).values({ id, userId }).run();
  return id;
}

function loadMessages(conversationId: string): Array<{ role: 'user' | 'assistant'; content: StoredContent }> {
  return db.select({ role: assistantMessages.role, content: assistantMessages.content })
    .from(assistantMessages).where(eq(assistantMessages.conversationId, conversationId))
    .orderBy(asc(sql`rowid`)).all()
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: JSON.parse(m.content) as StoredContent }));
}

const isPlainUserTurn = (m: { role: string; content: StoredContent }) =>
  m.role === 'user' && (typeof m.content === 'string' || !m.content.some((b) => b.type === 'tool_result'));

const blocksOf = (content: StoredContent): Anthropic.ContentBlockParam[] =>
  typeof content === 'string' ? [{ type: 'text', text: content }] : content;

/**
 * The last HISTORY_LIMIT messages in a shape the API accepts: starts at a plain user message,
 * drops tool calls whose results were never saved (reply interrupted), and merges back-to-back
 * messages from the same side.
 */
function recentHistory(all: Array<{ role: 'user' | 'assistant'; content: StoredContent }>): Anthropic.MessageParam[] {
  let start = Math.max(0, all.length - HISTORY_LIMIT);
  while (start < all.length && !isPlainUserTurn(all[start]!)) start++;
  const slice = all.slice(start);

  const out: Anthropic.MessageParam[] = [];
  slice.forEach((m, i) => {
    let blocks = blocksOf(m.content);
    if (m.role === 'assistant') {
      const next = slice[i + 1];
      const answered = new Set(next && next.role === 'user'
        ? blocksOf(next.content).flatMap((b) => (b.type === 'tool_result' ? [b.tool_use_id] : []))
        : []);
      blocks = blocks.filter((b) => b.type !== 'tool_use' || answered.has(b.id));
    }
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content = [...blocksOf(last.content as StoredContent), ...blocks];
    else out.push({ role: m.role, content: blocks });
  });
  return out;
}

function saveMessage(conversationId: string, role: 'user' | 'assistant', content: StoredContent, usage?: Anthropic.Usage) {
  const blocks = typeof content === 'string' ? [] : content;
  db.insert(assistantMessages).values({
    id: uuidv4(),
    conversationId,
    role,
    content: JSON.stringify(content),
    ...(usage ? {
      model: MODEL,
      inputTokens: usage.input_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      outputTokens: usage.output_tokens,
      webSearches: blocks.filter((b) => b.type === 'tool_use' && b.name === 'web_search').length,
    } : {}),
  }).run();
}

/** Text and tool-call blocks in the shape the API accepts back as history. */
function toParams(content: Anthropic.ContentBlock[]): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const b of content) {
    if (b.type === 'text' && b.text) blocks.push({ type: 'text', text: b.text });
    else if (b.type === 'tool_use') blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input });
  }
  return blocks;
}

/** Chat history as the panel shows it: user and assistant text with the steps taken in between. */
function toDisplay(messages: Array<{ role: 'user' | 'assistant'; content: StoredContent }>) {
  const summaries = new Map<string, { summary: string; ok: boolean }>();
  for (const m of messages) {
    if (m.role !== 'user' || typeof m.content === 'string') continue;
    for (const b of m.content) {
      if (b.type !== 'tool_result') continue;
      const text = Array.isArray(b.content) ? b.content.find((c) => c.type === 'text')?.text : b.content;
      try {
        const parsed = JSON.parse(text ?? '{}') as { _summary?: string };
        summaries.set(b.tool_use_id, { summary: parsed._summary ?? '', ok: !b.is_error });
      } catch { /* not ours */ }
    }
  }

  const items: Array<
    | { kind: 'user'; text: string }
    | { kind: 'assistant'; text: string }
    | { kind: 'step'; id: string; label: string; summary: string; ok: boolean }
  > = [];
  for (const m of messages) {
    if (m.role === 'user') {
      if (typeof m.content === 'string') items.push({ kind: 'user', text: m.content });
      else for (const b of m.content) if (b.type === 'text') items.push({ kind: 'user', text: b.text });
      continue;
    }
    const blocks = typeof m.content === 'string' ? [{ type: 'text' as const, text: m.content }] : m.content;
    for (const b of blocks) {
      if (b.type === 'text') items.push({ kind: 'assistant', text: b.text });
      else if (b.type === 'tool_use') {
        const done = summaries.get(b.id);
        items.push({ kind: 'step', id: b.id, label: toolLabel(b.name, b.input as Record<string, unknown>), summary: done?.summary ?? '', ok: done?.ok ?? false });
      }
    }
  }
  return items;
}

// Admin-only chat assistant. Replies stream as server-sent events.
export async function assistantRoutes(app: FastifyInstance) {
  app.addHook('preHandler', adminMiddleware);

  app.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ enabled: Boolean(client), model: MODEL, webSearch: webSearchEnabled() });
  });

  // Spend and token counts for the admin Usage tab
  app.get('/usage', async (request: FastifyRequest<{ Querystring: { tz?: string } }>, reply: FastifyReply) => {
    return reply.send(await usageReport(MODEL, request.query.tz));
  });

  // Anthropic has no balance API: the admin enters the current balance and spend is subtracted from it
  app.put('/credit', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = z.object({ amount: z.number().min(0).max(100_000).nullable() }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Enter an amount in dollars' });
    setCredit(parsed.data.amount);
    return reply.send(await usageReport(MODEL));
  });

  app.get('/conversation', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };
    const id = currentConversation(userId);
    return reply.send({ id, items: toDisplay(loadMessages(id)) });
  });

  // Start over. The old conversation is kept for review, only the panel is cleared.
  app.post('/conversation/new', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };
    const id = uuidv4();
    db.insert(assistantConversations).values({ id, userId }).run();
    return reply.send({ id, items: [] });
  });

  app.post('/chat', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!client) return reply.status(503).send({ error: 'The assistant is not set up. Add ANTHROPIC_API_KEY to the server .env.' });
    const parsed = chatSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Type a message first' });

    const { userId } = request.user as { userId: string };
    const user = db.select({ username: users.username }).from(users).where(eq(users.id, userId)).get();
    const conversationId = currentConversation(userId);
    const userContent: StoredContent = parsed.data.message;
    saveMessage(conversationId, 'user', userContent);
    const messages = recentHistory(loadMessages(conversationId));

    // Server-sent events; the stream stays open until the model finishes its turn
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: Record<string, unknown>) => {
      if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Stop calling the model (and paying for it) when the panel is closed mid-reply
    const abort = new AbortController();
    reply.raw.on('close', () => abort.abort());

    const tools = toolDefinitions();
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: 2048,
          system: systemPrompt(user?.username ?? 'the admin'),
          tools,
          messages,
          cache_control: { type: 'ephemeral' },
        }, { signal: abort.signal });
        stream.on('text', (text) => send({ type: 'text', text }));
        const message = await stream.finalMessage();

        const content = toParams(message.content);
        if (content.length) {
          messages.push({ role: 'assistant', content });
          saveMessage(conversationId, 'assistant', content, message.usage);
        }

        const calls = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        if (message.stop_reason !== 'tool_use' || !calls.length) break;

        for (const call of calls) send({ type: 'step', id: call.id, label: toolLabel(call.name, call.input as Record<string, unknown>) });
        const outcomes = await Promise.all(calls.map((call) => runTool(call.name, call.input as Record<string, unknown>, { userId })));

        const results: Anthropic.ToolResultBlockParam[] = calls.map((call, i) => {
          const outcome = outcomes[i]!;
          send({ type: 'step_done', id: call.id, summary: outcome.summary, ok: !outcome.isError, changed: outcome.changed ?? [] });
          return {
            type: 'tool_result',
            tool_use_id: call.id,
            // _summary is for the chat history display; it also tells the model the outcome in one line
            content: JSON.stringify({ ...(outcome.result as object), _summary: outcome.summary }),
            ...(outcome.isError ? { is_error: true } : {}),
          };
        });
        messages.push({ role: 'user', content: results });
        saveMessage(conversationId, 'user', results);

        if (round === MAX_ROUNDS - 1) send({ type: 'text', text: '\n\nI stopped here because this took too many steps. Tell me if you want me to continue.' });
      }
      send({ type: 'done' });
    } catch (err) {
      if (!abort.signal.aborted) {
        request.log.warn(err, 'assistant request failed');
        const status = err instanceof Anthropic.APIError ? err.status : undefined;
        send({
          type: 'error',
          error: status === 401 ? 'The API key was rejected. Check ANTHROPIC_API_KEY.'
            : status === 429 ? 'Rate limited by the model provider. Try again in a minute.'
            : status === 529 || status === 503 ? 'The model is overloaded right now. Try again shortly.'
            : 'Something went wrong while answering.',
        });
      }
    } finally {
      reply.raw.end();
    }
  });
}
