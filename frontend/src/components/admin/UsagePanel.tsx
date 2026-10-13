import { useEffect, useState, type FormEvent } from 'react';
import { RefreshCw, ExternalLink } from 'lucide-react';
import { api, type AssistantUsage, type UsageTotals } from '@/services/api';
import { toast } from '@/stores/toastStore';

/** Dollars with enough precision for fractions of a cent. */
function money(value: number): string {
  if (value === 0) return '$0.00';
  if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const tokens = (n: number) => compact.format(n);

function cacheHitRate(t: UsageTotals): number | null {
  const prompt = t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens;
  return prompt ? Math.round((t.cacheReadTokens / prompt) * 100) : null;
}

const Card = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-5">
    <p className="text-zinc-500 text-xs uppercase tracking-wider mb-2">{label}</p>
    <p className="text-2xl font-semibold text-white tabular-nums">{value}</p>
    {sub && <p className="text-zinc-500 text-xs mt-1">{sub}</p>}
  </div>
);

const Bar = ({ used, limit }: { used: number; limit: number }) => {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
      <div className={`h-full rounded-full ${pct > 90 ? 'bg-amber-500' : 'bg-zinc-300'}`} style={{ width: `${pct}%` }} />
    </div>
  );
};

const UsagePanel = () => {
  const [usage, setUsage] = useState<AssistantUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [creditInput, setCreditInput] = useState('');
  const [editingCredit, setEditingCredit] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setUsage(await api.getAssistantUsage());
    } catch {
      toast.error('Could not load usage');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const saveCredit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = Number(creditInput);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error('Enter an amount in dollars');
      return;
    }
    try {
      await api.setAssistantCredit(amount);
      setEditingCredit(false);
      setCreditInput('');
      await load();
    } catch {
      toast.error('Could not save the balance');
    }
  };

  const clearCredit = async () => {
    await api.setAssistantCredit(null).catch(() => {});
    await load();
  };

  if (!usage) {
    return <p className="text-zinc-500 text-sm">{loading ? 'Loading usage...' : 'Usage is unavailable.'}</p>;
  }

  const { periods, credit, tavily, days } = usage;
  const maxDay = Math.max(...days.map((d) => d.cost), 0);
  const hit = cacheHitRate(periods.last30);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <p className="text-zinc-500 text-sm">
          Assistant spend on <span className="text-zinc-300">{usage.model}</span>, worked out from the tokens logged with each reply.
        </p>
        <button
          onClick={() => void load()}
          className="flex-shrink-0 p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800/50 transition-colors"
          aria-label="Refresh usage"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Spend */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card label="Today" value={money(periods.today.cost)} sub={`${usage.messagesSent.today} messages`} />
        <Card label="This month" value={money(periods.month.cost)} sub={`${usage.messagesSent.month} messages`} />
        <Card label="Last 30 days" value={money(periods.last30.cost)} sub={`${periods.last30.calls} model calls`} />
        <Card label="All time" value={money(periods.all.cost)} sub={`${usage.messagesSent.all} messages`} />
      </div>

      {/* Credit balance */}
      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-white font-medium">Anthropic credit</h3>
            <p className="text-zinc-500 text-sm mt-0.5">
              Anthropic doesn't share the balance through its API. Enter it from the Console once and Resonance subtracts what the assistant spends.
            </p>
          </div>
          <a
            href="https://console.anthropic.com/settings/billing"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
          >
            Console <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        {credit && !editingCredit ? (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <p className="text-3xl font-semibold text-white tabular-nums">{money(credit.remaining)}</p>
              <p className="text-zinc-500 text-sm tabular-nums">{money(credit.spent)} used of {money(credit.amount)}</p>
            </div>
            <Bar used={credit.spent} limit={credit.amount} />
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Balance entered {new Date(credit.setAt).toLocaleDateString()}</span>
              <span className="flex gap-3">
                <button onClick={() => { setEditingCredit(true); setCreditInput(String(credit.remaining.toFixed(2))); }} className="hover:text-white">Update</button>
                <button onClick={() => void clearCredit()} className="hover:text-white">Remove</button>
              </span>
            </div>
          </div>
        ) : (
          <form onSubmit={saveCredit} className="flex items-center gap-2">
            <span className="text-zinc-500">$</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={creditInput}
              onChange={(e) => setCreditInput(e.target.value)}
              placeholder="Current balance, e.g. 5.00"
              className="w-56 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
            />
            <button type="submit" className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-zinc-200 transition-colors">Save</button>
            {editingCredit && (
              <button type="button" onClick={() => setEditingCredit(false)} className="px-3 py-2 text-sm text-zinc-500 hover:text-white">Cancel</button>
            )}
          </form>
        )}
      </div>

      {/* Daily spend */}
      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="text-white font-medium">Last 30 days</h3>
          <span className="text-zinc-500 text-xs">Highest day {money(maxDay)}</span>
        </div>
        <div className="flex items-end gap-1 h-28" role="img" aria-label="Daily assistant spend over the last 30 days">
          {days.map((d) => (
            <div key={d.date} className="flex-1 h-full flex items-end" title={`${d.date}: ${money(d.cost)}`}>
              <div
                className={`w-full rounded-sm ${d.cost > 0 ? 'bg-zinc-400' : 'bg-zinc-800'}`}
                style={{ height: d.cost > 0 && maxDay > 0 ? `${Math.max(4, (d.cost / maxDay) * 100)}%` : '2px' }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[11px] text-zinc-600 mt-2">
          <span>{days[0]?.date}</span>
          <span>{days[days.length - 1]?.date}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tokens */}
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6">
          <h3 className="text-white font-medium mb-4">Tokens, last 30 days</h3>
          <dl className="space-y-2 text-sm">
            {([
              ['Input', periods.last30.inputTokens, usage.pricing?.input],
              ['Read from cache', periods.last30.cacheReadTokens, usage.pricing?.cacheRead],
              ['Written to cache', periods.last30.cacheWriteTokens, usage.pricing?.cacheWrite],
              ['Output', periods.last30.outputTokens, usage.pricing?.output],
            ] as const).map(([label, count, price]) => (
              <div key={label} className="flex justify-between">
                <dt className="text-zinc-400">{label}</dt>
                <dd className="text-zinc-200 tabular-nums">
                  {tokens(count)}
                  {price !== undefined && <span className="text-zinc-600 ml-2">${price}/M</span>}
                </dd>
              </div>
            ))}
          </dl>
          {hit !== null && (
            <p className="text-zinc-500 text-xs mt-4">{hit}% of prompt tokens came from the cache.</p>
          )}
          {usage.unpricedCalls > 0 && (
            <p className="text-amber-500/80 text-xs mt-2">{usage.unpricedCalls} calls used a model without a known price and are not counted.</p>
          )}
        </div>

        {/* Tavily */}
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6">
          <div className="flex items-start justify-between mb-4">
            <h3 className="text-white font-medium">Web search (Tavily)</h3>
            <a
              href="https://app.tavily.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
            >
              Dashboard <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
          {!tavily.configured ? (
            <p className="text-zinc-500 text-sm">Not set up. Add <code className="text-zinc-300">TAVILY_API_KEY</code> to the server .env to turn on web search.</p>
          ) : 'error' in tavily ? (
            <p className="text-zinc-500 text-sm">Couldn't read usage from Tavily ({tavily.error}).</p>
          ) : (
            <div className="space-y-3">
              {tavily.planLimit !== null && tavily.planUsage !== null ? (
                <>
                  <div className="flex items-baseline justify-between">
                    <p className="text-2xl font-semibold text-white tabular-nums">
                      {(tavily.planLimit - tavily.planUsage).toLocaleString()}
                      <span className="text-zinc-500 text-sm font-normal ml-1.5">credits left</span>
                    </p>
                    <p className="text-zinc-500 text-sm tabular-nums">{tavily.planUsage.toLocaleString()} / {tavily.planLimit.toLocaleString()}</p>
                  </div>
                  <Bar used={tavily.planUsage} limit={tavily.planLimit} />
                </>
              ) : (
                <p className="text-zinc-500 text-sm">Tavily didn't report a plan limit.</p>
              )}
              <p className="text-zinc-500 text-xs">
                {tavily.plan ? `${tavily.plan} plan. ` : ''}Resets monthly. Searches by the assistant: {periods.today.webSearches} today, {periods.month.webSearches} this month.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UsagePanel;
