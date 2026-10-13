import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X, Sparkles, ArrowUp, Square, RotateCcw, Check, AlertCircle, Loader2 } from 'lucide-react';
import { useAssistantStore } from '@/stores/assistantStore';
import { useMediaQuery } from '@/utils/router';
import type { AssistantItem } from '@/services/api';

const SUGGESTIONS = [
  'Add the album Random Access Memories by Daft Punk',
  'Make a playlist of 15 relaxed late-night songs',
  "What's downloading right now?",
];

// Inline formatting the model uses: **bold** and links. Built as React nodes, never as HTML.
function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const [, bold, label, href, bare] = match;
    if (bold) nodes.push(<strong key={match.index} className="text-white font-medium">{bold}</strong>);
    else {
      const url = href ?? bare!;
      nodes.push(
        <a key={match.index} href={url} target="_blank" rel="noopener noreferrer" className="text-zinc-200 underline underline-offset-2 hover:text-white">
          {label ?? url}
        </a>
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Paragraphs and simple bullet or numbered lists. */
function FormattedText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={blocks.length} className={`${list.ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-0.5 marker:text-zinc-600`}>
        {list.items.map((item, i) => <li key={i}>{inline(item)}</li>)}
      </Tag>
    );
    list = null;
  };
  for (const line of text.split('\n')) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    flush();
    if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ''))}</p>);
  }
  flush();
  return <div className="space-y-2">{blocks}</div>;
}

function Item({ item, pending }: { item: AssistantItem; pending: boolean }) {
  if (item.kind === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-800 px-3.5 py-2 text-sm text-zinc-100 whitespace-pre-wrap break-words select-text">
          {item.text}
        </div>
      </div>
    );
  }
  if (item.kind === 'step') {
    const running = pending && !item.summary;
    return (
      <div className="flex items-start gap-2 text-xs text-zinc-500 pl-1">
        <span className="mt-0.5 flex-shrink-0">
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : item.ok ? <Check className="w-3.5 h-3.5 text-zinc-400" />
            : <AlertCircle className="w-3.5 h-3.5 text-amber-500/80" />}
        </span>
        <span className="min-w-0">
          <span className="text-zinc-400">{item.label}</span>
          {item.summary && <span className="block text-zinc-500 break-words">{item.summary}</span>}
        </span>
      </div>
    );
  }
  return (
    <div className="text-sm leading-relaxed text-zinc-300 break-words select-text">
      <FormattedText text={item.text} />
    </div>
  );
}

/** The conversation itself: used in the side panel and in the Admin Panel's Assistant tab. */
export const AssistantChat = ({ inline = false }: { inline?: boolean }) => {
  const { enabled, webSearch, items, isSending, error, close, send, stop, startOver, load } = useAssistantStore();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Follow the reply as it streams in
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, isSending]);

  useEffect(() => {
    if (!useAssistantStore.getState().loaded) void load();
    if (isDesktop) inputRef.current?.focus();
  }, [load, isDesktop]);

  // Grow the input with its content, up to a few lines
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  const submit = (text = draft) => {
    if (!text.trim() || isSending) return;
    setDraft('');
    void send(text);
  };

  const last = items[items.length - 1];
  const thinking = isSending && (!last || last.kind === 'user' || (last.kind === 'step' && Boolean(last.summary)));

  return (
    <>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/50">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-zinc-500" />
            <div>
              <h3 className="text-white font-medium leading-tight">Assistant</h3>
              <p className="text-zinc-500 text-xs">{webSearch ? 'Music, playlists and web search' : 'Music and playlists'}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {items.length > 0 && (
              <button
                onClick={() => void startOver()}
                className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800/50 transition-colors"
                title="New conversation"
                aria-label="New conversation"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
            {!inline && (
              <button
                onClick={close}
                className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800/50 transition-colors"
                aria-label="Close assistant"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-4 overscroll-contain">
          {enabled === false && (
            <div className="text-sm text-zinc-400 space-y-2">
              <p>The assistant is not set up yet.</p>
              <p className="text-zinc-500">Add <code className="text-zinc-300">ANTHROPIC_API_KEY</code> to the server <code className="text-zinc-300">.env</code> and restart the container. <code className="text-zinc-300">TAVILY_API_KEY</code> turns on web search.</p>
            </div>
          )}
          {enabled && items.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-zinc-400">Ask for songs, albums or playlists and I'll add them to the library.</p>
              <div className="space-y-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => submit(s)}
                    className="block w-full text-left text-sm text-zinc-300 px-3.5 py-2.5 rounded-xl border border-zinc-800 hover:bg-zinc-800/40 hover:border-zinc-700 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {items.map((item, i) => (
            <Item key={item.kind === 'step' ? item.id : i} item={item} pending={isSending} />
          ))}
          {thinking && (
            <div className="flex gap-1 pl-1 py-1" aria-label="Thinking">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-zinc-600 animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
              ))}
            </div>
          )}
          {error && <p className="text-sm text-amber-500/90">{error}</p>}
        </div>

        {/* Input */}
        <div className="px-4 pt-3 border-t border-zinc-800/50" style={{ paddingBottom: isDesktop || inline ? '1rem' : 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <div className="flex items-end gap-2 rounded-2xl bg-zinc-900 border border-zinc-800 focus-within:border-zinc-700 px-3 py-2 transition-colors">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              maxLength={4000}
              disabled={enabled === false}
              placeholder="Ask for a song, album or playlist"
              className="flex-1 resize-none bg-transparent text-sm text-zinc-100 placeholder-zinc-600 outline-none py-1.5 max-h-[140px] select-text"
            />
            {isSending ? (
              <button
                onClick={stop}
                className="flex-shrink-0 w-8 h-8 rounded-full bg-zinc-700 text-white flex items-center justify-center hover:bg-zinc-600 transition-colors"
                aria-label="Stop"
              >
                <Square className="w-3 h-3 fill-current" />
              </button>
            ) : (
              <button
                onClick={() => submit()}
                disabled={!draft.trim() || enabled === false}
                className="flex-shrink-0 w-8 h-8 rounded-full bg-white text-black flex items-center justify-center disabled:bg-zinc-800 disabled:text-zinc-600 transition-colors"
                aria-label="Send"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
    </>
  );
};

/** Slide-in panel on the right (full screen on phones), opened with the A shortcut. */
const AssistantPanel = () => {
  const close = useAssistantStore((s) => s.close);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  return (
    <div className={isDesktop ? 'fixed top-0 right-0 bottom-24 z-40' : 'fixed inset-0 z-[70]'}>
      <div
        className={`${isDesktop ? 'w-[400px] border-l border-zinc-800/50 shadow-2xl' : 'w-full'} h-full bg-[#0a0a0a] flex flex-col`}
        style={{ animation: 'slideInFromRight 0.3s ease-out', paddingTop: isDesktop ? undefined : 'env(safe-area-inset-top)' }}
      >
        <AssistantChat />
      </div>
    </div>
  );
};

export default AssistantPanel;
