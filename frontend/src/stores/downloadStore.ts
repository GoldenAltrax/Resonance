import { create } from 'zustand';
import { isTauri } from '@/utils/tauri';

export interface DownloadItem {
  trackId: string;
  trackTitle: string;
  progress: number; // 0–100
  status: 'queued' | 'downloading' | 'done' | 'error';
  localPath: string | null;
  sizeBytes: number | null;
}

interface DownloadState {
  items: DownloadItem[];
  cachedTrackIds: Set<string>;
  showDownloadPanel: boolean;

  queue: (trackId: string, trackTitle: string) => void;
  remove: (trackId: string) => void;
  getLocalPath: (trackId: string) => string | null;
  togglePanel: () => void;
  initCache: () => Promise<void>;
}

const CACHE_SUBDIR = 'resonance/cache';
const INDEX_FILE = 'resonance/cache/index.json';
const MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

interface CacheIndex {
  [trackId: string]: { path: string; sizeBytes: number; accessedAt: number };
}

async function readIndex(): Promise<CacheIndex> {
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    const text = await readTextFile(INDEX_FILE, { baseDir: BaseDirectory.AppData });
    return JSON.parse(text) as CacheIndex;
  } catch {
    return {};
  }
}

async function writeIndex(index: CacheIndex): Promise<void> {
  try {
    const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(INDEX_FILE, JSON.stringify(index), {
      baseDir: BaseDirectory.AppData,
    });
  } catch {
    // Ignore write errors (e.g., browser context)
  }
}

async function ensureCacheDir(): Promise<void> {
  try {
    const { mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await mkdir(CACHE_SUBDIR, { baseDir: BaseDirectory.AppData, recursive: true });
  } catch {
    // Already exists or unavailable
  }
}

function evictLRU(index: CacheIndex, maxBytes: number): CacheIndex {
  const entries = Object.entries(index).sort(
    ([, a], [, b]) => a.accessedAt - b.accessedAt
  );
  let totalBytes = entries.reduce((acc, [, v]) => acc + v.sizeBytes, 0);
  const newIndex = { ...index };
  for (const [id] of entries) {
    if (totalBytes <= maxBytes) break;
    totalBytes -= (newIndex[id]?.sizeBytes ?? 0);
    delete newIndex[id];
  }
  return newIndex;
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  items: [],
  cachedTrackIds: new Set<string>(),
  showDownloadPanel: false,

  togglePanel: () => set((s) => ({ showDownloadPanel: !s.showDownloadPanel })),

  getLocalPath: (trackId) => {
    const item = get().items.find((i) => i.trackId === trackId && i.status === 'done');
    return item?.localPath ?? null;
  },

  async initCache() {
    if (!isTauri()) return;
    await ensureCacheDir();
    const index = await readIndex();
    const cachedTrackIds = new Set(Object.keys(index));
    const items: DownloadItem[] = Object.entries(index).map(([trackId, info]) => ({
      trackId,
      trackTitle: trackId,
      progress: 100,
      status: 'done',
      localPath: info.path,
      sizeBytes: info.sizeBytes,
    }));
    set({ cachedTrackIds, items });
  },

  async queue(trackId, trackTitle) {
    const existing = get().items.find((i) => i.trackId === trackId);
    if (existing && (existing.status === 'done' || existing.status === 'downloading' || existing.status === 'queued')) {
      return;
    }

    const newItem: DownloadItem = {
      trackId,
      trackTitle,
      progress: 0,
      status: 'queued',
      localPath: null,
      sizeBytes: null,
    };

    set((s) => ({ items: [...s.items.filter((i) => i.trackId !== trackId), newItem] }));

    if (!isTauri()) {
      set((s) => ({
        items: s.items.map((i) =>
          i.trackId === trackId ? { ...i, status: 'error' } : i
        ),
      }));
      return;
    }

    // Mark as downloading
    set((s) => ({
      items: s.items.map((i) =>
        i.trackId === trackId ? { ...i, status: 'downloading' } : i
      ),
    }));

    try {
      const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      const apiUrl = (import.meta.env.VITE_API_URL ?? '') + `/api/tracks/${trackId}/stream`;
      const token = localStorage.getItem('resonance-auth-token') ?? '';

      const response = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok || !response.body) throw new Error('Stream failed');

      const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          const progress = contentLength > 0 ? Math.round((received / contentLength) * 100) : 50;
          set((s) => ({
            items: s.items.map((i) =>
              i.trackId === trackId ? { ...i, progress } : i
            ),
          }));
        }
      }

      // Merge chunks
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      const filePath = `${CACHE_SUBDIR}/${trackId}.mp3`;
      await writeFile(filePath, merged, { baseDir: BaseDirectory.AppData });

      // Update index
      let index = await readIndex();
      index[trackId] = { path: filePath, sizeBytes: totalLength, accessedAt: Date.now() };
      index = evictLRU(index, MAX_CACHE_BYTES);
      await writeIndex(index);

      set((s) => ({
        items: s.items.map((i) =>
          i.trackId === trackId
            ? { ...i, status: 'done', progress: 100, localPath: filePath, sizeBytes: totalLength }
            : i
        ),
        cachedTrackIds: new Set([...s.cachedTrackIds, trackId]),
      }));
    } catch (err) {
      console.error('Download failed:', err);
      set((s) => ({
        items: s.items.map((i) =>
          i.trackId === trackId ? { ...i, status: 'error' } : i
        ),
      }));
    }
  },

  async remove(trackId) {
    if (isTauri()) {
      try {
        const { remove: removeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
        const filePath = `${CACHE_SUBDIR}/${trackId}.mp3`;
        await removeFile(filePath, { baseDir: BaseDirectory.AppData });
        const index = await readIndex();
        delete index[trackId];
        await writeIndex(index);
      } catch {
        // Ignore
      }
    }
    set((s) => ({
      items: s.items.filter((i) => i.trackId !== trackId),
      cachedTrackIds: new Set([...s.cachedTrackIds].filter((id) => id !== trackId)),
    }));
  },
}));
