import { create } from 'zustand';
import { api, type AssistantItem } from '@/services/api';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerStore } from '@/stores/playerStore';

interface AssistantState {
  isOpen: boolean;
  /** null until the server status has been checked */
  enabled: boolean | null;
  webSearch: boolean;
  items: AssistantItem[];
  loaded: boolean;
  isSending: boolean;
  error: string | null;
  open: () => void;
  close: () => void;
  toggle: () => void;
  load: () => Promise<void>;
  send: (message: string) => Promise<void>;
  stop: () => void;
  startOver: () => Promise<void>;
}

let controller: AbortController | null = null;
let loading: Promise<void> | null = null;

export const useAssistantStore = create<AssistantState>((set, get) => ({
  isOpen: false,
  enabled: null,
  webSearch: false,
  items: [],
  loaded: false,
  isSending: false,
  error: null,

  open: () => {
    // Shares the right-hand side with the lyrics and queue panels
    usePlayerStore.setState({ showLyrics: false, showQueue: false });
    set({ isOpen: true });
    if (!get().loaded) void get().load();
  },
  close: () => set({ isOpen: false }),
  toggle: () => (get().isOpen ? get().close() : get().open()),

  load: () => (loading ??= (async () => {
    try {
      const status = await api.getAssistantStatus();
      set({ enabled: status.enabled, webSearch: status.webSearch });
      if (!status.enabled) return;
      const { items } = await api.getAssistantConversation();
      set({ items, loaded: true, error: null });
    } catch {
      set({ error: 'Could not reach the assistant.' });
    } finally {
      loading = null;
    }
  })()),

  send: async (message) => {
    const text = message.trim();
    if (!text || get().isSending) return;
    controller = new AbortController();
    set((s) => ({ items: [...s.items, { kind: 'user', text }], isSending: true, error: null }));

    const changed = new Set<string>();
    // Streamed text joins the last assistant bubble until a step interrupts it
    const appendText = (chunk: string) =>
      set((s) => {
        const last = s.items[s.items.length - 1];
        if (last?.kind === 'assistant') {
          return { items: [...s.items.slice(0, -1), { ...last, text: last.text + chunk }] };
        }
        return { items: [...s.items, { kind: 'assistant', text: chunk }] };
      });

    try {
      await api.streamAssistant(text, (event) => {
        switch (event.type) {
          case 'text':
            appendText(event.text);
            break;
          case 'step':
            set((s) => ({ items: [...s.items, { kind: 'step', id: event.id, label: event.label, summary: '', ok: false }] }));
            break;
          case 'step_done':
            event.changed.forEach((c) => changed.add(c));
            set((s) => ({
              items: s.items.map((item) =>
                item.kind === 'step' && item.id === event.id ? { ...item, summary: event.summary, ok: event.ok } : item
              ),
            }));
            break;
          case 'error':
            set({ error: event.error });
            break;
        }
      }, controller.signal);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        set({ error: err instanceof Error ? err.message : 'Something went wrong' });
      }
    } finally {
      controller = null;
      set({ isSending: false });
      if (changed.has('playlists')) void usePlaylistStore.getState().fetchPlaylists();
      if (changed.has('library')) void usePlaylistStore.getState().fetchLibrary();
    }
  },

  stop: () => controller?.abort(),

  startOver: async () => {
    get().stop();
    try {
      const { items } = await api.newAssistantConversation();
      set({ items, error: null });
    } catch {
      set({ error: 'Could not start a new conversation.' });
    }
  },
}));
