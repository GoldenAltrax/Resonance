import { useEffect, useState } from 'react';
import { onUpdateReady, applyUpdate } from '@/utils/pwa';

/** "New version available" prompt, driven by the service worker update flow. */
const UpdateNotification = () => {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => onUpdateReady(() => setReady(true)), []);

  if (!ready || dismissed) return null;

  return (
    <div
      role="status"
      className="fixed bottom-[140px] md:bottom-28 right-4 left-4 md:left-auto z-[60] md:w-80 bg-[#1a1a1a] border border-zinc-700 rounded-xl shadow-2xl p-4 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-white font-medium text-sm">A new version of Resonance is available</p>
          <p className="text-zinc-500 text-xs mt-0.5">Reload to update. Your queue is kept.</p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-zinc-600 hover:text-zinc-400 transition-colors text-lg leading-none flex-shrink-0 mt-0.5"
          aria-label="Dismiss update"
        >
          ×
        </button>
      </div>
      <button
        onClick={applyUpdate}
        className="w-full py-1.5 bg-white hover:bg-zinc-200 text-black text-sm font-medium rounded-lg transition-colors"
      >
        Reload now
      </button>
    </div>
  );
};

export default UpdateNotification;
