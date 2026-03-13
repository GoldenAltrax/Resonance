// In-app debug logger — stores recent log entries in memory so they can be
// displayed in the DebugPanel overlay without needing a connected desktop debugger.

type Level = 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: string;
  level: Level;
  msg: string;
}

const MAX_ENTRIES = 400;
const entries: LogEntry[] = [];
const listeners = new Set<() => void>();
let _panelOpen = false;
const panelListeners = new Set<() => void>();

function timestamp() {
  const d = new Date();
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function append(level: Level, msg: string) {
  entries.push({ ts: timestamp(), level, msg });
  if (entries.length > MAX_ENTRIES) entries.shift();
  listeners.forEach((fn) => fn());
}

export const dbg = {
  info: (msg: string) => append('info', msg),
  warn: (msg: string) => append('warn', msg),
  error: (msg: string) => append('error', msg),

  getEntries: (): LogEntry[] => [...entries],

  subscribe: (fn: () => void): (() => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  clear: () => {
    entries.length = 0;
    listeners.forEach((fn) => fn());
  },

  copyToClipboard: (): Promise<void> => {
    const text = entries
      .map((e) => `[${e.ts}] [${e.level.toUpperCase()}] ${e.msg}`)
      .join('\n');
    return navigator.clipboard.writeText(text);
  },

  openPanel: () => {
    _panelOpen = true;
    panelListeners.forEach((fn) => fn());
  },

  closePanel: () => {
    _panelOpen = false;
    panelListeners.forEach((fn) => fn());
  },

  isPanelOpen: () => _panelOpen,

  subscribePanelState: (fn: () => void): (() => void) => {
    panelListeners.add(fn);
    return () => panelListeners.delete(fn);
  },
};
