import { useState, useEffect, useRef } from 'react';
import { X, Clipboard, Trash2, Check } from 'lucide-react';
import { dbg, LogEntry } from '@/utils/debugLog';

export default function DebugPanel() {
  const [open, setOpen] = useState(dbg.isPanelOpen());
  const [entries, setEntries] = useState<LogEntry[]>(dbg.getEntries());
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = dbg.subscribePanelState(() => {
      setOpen(dbg.isPanelOpen());
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!open) return;
    setEntries(dbg.getEntries());
    const unsub = dbg.subscribe(() => setEntries(dbg.getEntries()));
    return unsub;
  }, [open]);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  if (!open) return null;

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
    <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
        <span className="text-sm font-mono font-semibold text-zinc-200">
          Debug Log ({entries.length})
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
          <button
            onClick={() => dbg.closePanel()}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto font-mono text-xs p-3 space-y-1">
        {entries.length === 0 && (
          <div className="text-zinc-600 text-center pt-8">No logs yet</div>
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
