import { X, CloudOff, Trash2, Download } from 'lucide-react';
import { useDownloadStore } from '@/stores/downloadStore';
import { usePlayerStore } from '@/stores/playerStore';

const formatBytes = (bytes: number | null): string => {
  if (bytes === null) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024;

const DownloadManager = () => {
  const { items, remove } = useDownloadStore();
  const { toggleDownloadPanel } = usePlayerStore();

  const totalBytes = items
    .filter((i) => i.status === 'done')
    .reduce((acc, i) => acc + (i.sizeBytes ?? 0), 0);

  const usedPercent = Math.min((totalBytes / MAX_CACHE_BYTES) * 100, 100);

  return (
    <div className="fixed top-0 right-0 bottom-24 w-[380px] max-w-[95vw] bg-[#0a0a0a] border-l border-zinc-800/50 flex flex-col shadow-2xl z-40">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/50">
        <div className="flex items-center gap-2">
          <Download className="w-4 h-4 text-zinc-400" />
          <h3 className="text-white font-medium">Downloads</h3>
          {items.length > 0 && (
            <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
              {items.filter((i) => i.status === 'done').length} cached
            </span>
          )}
        </div>
        <button
          onClick={toggleDownloadPanel}
          className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Storage indicator */}
      <div className="px-5 py-3 border-b border-zinc-800/30">
        <div className="flex justify-between text-xs text-zinc-500 mb-1">
          <span>Storage used</span>
          <span>{formatBytes(totalBytes)} / {formatBytes(MAX_CACHE_BYTES)}</span>
        </div>
        <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-zinc-400 rounded-full transition-all duration-500"
            style={{ width: `${usedPercent}%` }}
          />
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-3">
            <CloudOff className="w-10 h-10 opacity-40" />
            <p className="text-sm">No downloads yet</p>
            <p className="text-xs text-zinc-700 text-center px-8">
              Download tracks to listen offline. Look for the cloud icon next to any track.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800/40">
            {items.map((item) => (
              <li key={item.trackId} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 truncate">{item.trackTitle}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {item.status === 'downloading' && (
                      <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-zinc-300 rounded-full transition-all"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    )}
                    {item.status === 'queued' && (
                      <span className="text-xs text-zinc-500">Queued…</span>
                    )}
                    {item.status === 'done' && (
                      <span className="text-xs text-zinc-500">
                        {formatBytes(item.sizeBytes)}
                      </span>
                    )}
                    {item.status === 'error' && (
                      <span className="text-xs text-red-500">Failed</span>
                    )}
                  </div>
                </div>
                {(item.status === 'done' || item.status === 'error') && (
                  <button
                    onClick={() => remove(item.trackId)}
                    aria-label="Remove download"
                    className="flex-shrink-0 p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default DownloadManager;
