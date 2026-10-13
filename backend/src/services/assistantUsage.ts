/**
 * Spend for the Usage tab, computed from the token counts logged with every assistant reply.
 * Anthropic has no API for the remaining credit balance, so the admin enters the balance once
 * and spending since then is subtracted from it.
 */
import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { db, appSettings, assistantMessages } from '../db/index.js';

/** USD per million tokens. https://platform.claude.com/docs/en/about-claude/pricing */
interface Price { input: number; cacheWrite: number; cacheRead: number; output: number }
const PRICES: Record<string, { base: Price; longContext?: Price }> = {
  'claude-haiku-5-5': {
    base: { input: 0.10, cacheWrite: 0.125, cacheRead: 0.01, output: 0.50 },
    // Prompts over 100k tokens (all input, cached or not) are billed at 5x
    longContext: { input: 0.50, cacheWrite: 0.625, cacheRead: 0.05, output: 2.50 },
  },
  'claude-haiku-4-5': { base: { input: 1, cacheWrite: 1.25, cacheRead: 0.10, output: 5 } },
};
const LONG_CONTEXT_ABOVE = 100_000;

const CREDIT_KEY = 'anthropic_credit';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

interface Totals {
  calls: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  cost: number;
  webSearches: number;
}

const emptyTotals = (): Totals => ({ calls: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, cost: 0, webSearches: 0 });

interface Row {
  model: string | null;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  webSearches: number;
  createdAt: Date | null;
}

function costOf(row: Row, fallbackModel: string): number | null {
  const pricing = PRICES[row.model ?? fallbackModel];
  if (!pricing) return null;
  const promptSize = row.input + row.cacheRead + row.cacheWrite;
  const p = promptSize > LONG_CONTEXT_ABOVE && pricing.longContext ? pricing.longContext : pricing.base;
  return (row.input * p.input + row.cacheWrite * p.cacheWrite + row.cacheRead * p.cacheRead + row.output * p.output) / 1_000_000;
}

function add(t: Totals, row: Row, cost: number) {
  t.calls++;
  t.inputTokens += row.input;
  t.cacheReadTokens += row.cacheRead;
  t.cacheWriteTokens += row.cacheWrite;
  t.outputTokens += row.output;
  t.webSearches += row.webSearches;
  t.cost += cost;
}

function usageRows(since?: Date): Row[] {
  return db.select({
    model: assistantMessages.model,
    input: sql<number>`coalesce(${assistantMessages.inputTokens}, 0)`,
    cacheRead: sql<number>`coalesce(${assistantMessages.cacheReadTokens}, 0)`,
    cacheWrite: sql<number>`coalesce(${assistantMessages.cacheWriteTokens}, 0)`,
    output: sql<number>`coalesce(${assistantMessages.outputTokens}, 0)`,
    webSearches: sql<number>`coalesce(${assistantMessages.webSearches}, 0)`,
    createdAt: assistantMessages.createdAt,
  }).from(assistantMessages)
    .where(and(isNotNull(assistantMessages.outputTokens), since ? gte(assistantMessages.createdAt, since) : undefined))
    .all();
}

/** When the admin sent messages (stored as a JSON string; tool results are stored as arrays). */
function sentMessageTimes(): Date[] {
  return db.select({ at: assistantMessages.createdAt }).from(assistantMessages)
    .where(and(eq(assistantMessages.role, 'user'), sql`substr(${assistantMessages.content}, 1, 1) = '"'`))
    .all().map((r) => r.at ?? new Date(0));
}

interface Credit { amount: number; setAt: string }

export function getCredit(): Credit | null {
  const row = db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, CREDIT_KEY)).get();
  if (!row) return null;
  try { return JSON.parse(row.value) as Credit; } catch { return null; }
}

export function setCredit(amount: number | null) {
  if (amount === null) {
    db.delete(appSettings).where(eq(appSettings.key, CREDIT_KEY)).run();
    return;
  }
  const value = JSON.stringify({ amount, setAt: new Date().toISOString() } satisfies Credit);
  db.insert(appSettings).values({ key: CREDIT_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } }).run();
}

/** Calendar date (YYYY-MM-DD) of a moment in the viewer's time zone. */
function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function validTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return tz; } catch { return 'UTC'; }
}

async function tavilyUsage() {
  if (!TAVILY_API_KEY) return { configured: false as const };
  try {
    const res = await fetch('https://api.tavily.com/usage', {
      headers: { Authorization: `Bearer ${TAVILY_API_KEY}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`Tavily returned ${res.status}`);
    const data = await res.json() as {
      key?: { usage?: number | null; limit?: number | null };
      account?: { current_plan?: string | null; plan_usage?: number | null; plan_limit?: number | null; paygo_usage?: number | null; paygo_limit?: number | null };
    };
    return {
      configured: true as const,
      plan: data.account?.current_plan ?? null,
      planUsage: data.account?.plan_usage ?? null,
      planLimit: data.account?.plan_limit ?? null,
      paygoUsage: data.account?.paygo_usage ?? null,
      paygoLimit: data.account?.paygo_limit ?? null,
      keyUsage: data.key?.usage ?? null,
      keyLimit: data.key?.limit ?? null,
    };
  } catch (err) {
    return { configured: true as const, error: err instanceof Error ? err.message : 'Could not reach Tavily' };
  }
}

export async function usageReport(model: string, tz?: string) {
  const timeZone = validTimeZone(tz);
  const now = new Date();
  const today = dayKey(now, timeZone);
  const month = today.slice(0, 7);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

  const periods = { today: emptyTotals(), month: emptyTotals(), last30: emptyTotals(), all: emptyTotals() };
  const daily = new Map<string, number>();
  const credit = getCredit();
  const creditSince = credit ? new Date(credit.setAt) : null;
  let spentSinceCredit = 0;
  let unpriced = 0;

  for (const row of usageRows()) {
    const cost = costOf(row, model);
    if (cost === null) unpriced++;
    const c = cost ?? 0;
    const at = row.createdAt ?? now;
    const day = dayKey(at, timeZone);
    add(periods.all, row, c);
    if (day.startsWith(month)) add(periods.month, row, c);
    if (day === today) add(periods.today, row, c);
    if (at >= thirtyDaysAgo) {
      add(periods.last30, row, c);
      daily.set(day, (daily.get(day) ?? 0) + c);
    }
    if (creditSince && at >= creditSince) spentSinceCredit += c;
  }

  // Last 30 days, oldest first, including days with no use
  const days = Array.from({ length: 30 }, (_, i) => {
    const date = dayKey(new Date(now.getTime() - (29 - i) * 86_400_000), timeZone);
    return { date, cost: daily.get(date) ?? 0 };
  });

  return {
    model,
    pricing: PRICES[model]?.base ?? null,
    timeZone,
    periods,
    messagesSent: sentMessageTimes().reduce((acc, at) => {
      const day = dayKey(at, timeZone);
      if (day === today) acc.today++;
      if (day.startsWith(month)) acc.month++;
      if (at >= thirtyDaysAgo) acc.last30++;
      acc.all++;
      return acc;
    }, { today: 0, month: 0, last30: 0, all: 0 }),
    days,
    unpricedCalls: unpriced,
    credit: credit ? { ...credit, spent: spentSinceCredit, remaining: credit.amount - spentSinceCredit } : null,
    tavily: await tavilyUsage(),
  };
}
