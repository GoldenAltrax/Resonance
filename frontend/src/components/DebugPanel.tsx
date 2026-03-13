import { useState, useEffect, useRef } from 'react';
import { Clipboard, Trash2, Check } from 'lucide-react';
import { dbg, LogEntry } from '@/utils/debugLog';

// Renders the debug log inline (no fixed overlay — embed inside a parent container).
export default function DebugPanel() {
  const [entries, setEntries] = useState<LogEntry[]>(dbg.getEntries());
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEntries(dbg.getEntries());
    const unsub = dbg.subscribe(() => setEntries(dbg.getEntries()));
    return unsub;
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  const handleCopy = async () => {
    await dbg.copyToClipboard();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const levelColor = (level: LogEntry['level']) => {
    if (level === 'error') return 'text-red-400';
    if (level === 'warn') return 'text-yellow-400';
    return 'text-zinc-300';
  };

  const levelBadge = (level: LogEntry['level']) => {
    if (level === 'error') return 'bg-red-500/20 text-red-400';
    if (level === 'warn') return 'bg-yellow-500/20 text-yellow-400';
    return 'bg-zinc-800 text-zinc-400';
  };

  return (
    <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-2xl overflow-hidden flex flex-col" style={{ minHeight: '400px' }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50 shrink-0">
        <span className="text-sm font-mono font-semibold text-zinc-400">
          {entries.length} entries
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Clipboard className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy all'}
          </button>
          <button
            onClick={() => dbg.clear()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div className="overflow-y-auto font-mono text-xs p-3 space-y-1 flex-1">
        {entries.length === 0 && (
          <div className="text-zinc-600 text-center pt-8">No logs yet — play a track to see output</div>
        )}
        {entries.map((e, i) => (
          <div key={i} className="flex gap-2 items-start leading-relaxed">
            <span className="text-zinc-600 shrink-0">{e.ts}</span>
            <span className={`px-1 rounded text-[10px] uppercase font-bold shrink-0 ${levelBadge(e.level)}`}>
              {e.level}
            </span>
            <span className={`break-all ${levelColor(e.level)}`}>{e.msg}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
