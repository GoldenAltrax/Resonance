import { useEffect, useState } from 'react';
import { isTauri } from '@/utils/tauri';

interface UpdateInfo {
  version: string;
  body: string | null;
}

const UpdateNotification = () => {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;

    const checkUpdate = async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const result = await check();
        if (result?.available) {
          setUpdate({ version: result.version, body: result.body ?? null });
        }
      } catch {
        // Ignore updater errors (no network, not configured, etc.)
      }
    };

    // Check after a short delay to not slow down startup
    const timer = setTimeout(checkUpdate, 5000);
    return () => clearTimeout(timer);
  }, []);

  if (!update || dismissed) return null;

  const handleInstall = async () => {
    setIsInstalling(true);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const result = await check();
      if (result?.available) {
        await result.downloadAndInstall();
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
      }
    } catch (err) {
      console.error('Update failed:', err);
      setIsInstalling(false);
    }
  };

  return (
    <div className="fixed bottom-28 right-4 z-[60] w-80 bg-[#1a1a1a] border border-zinc-700 rounded-xl shadow-2xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-white font-medium text-sm">
            Resonance {update.version} is available
          </p>
          {update.body && (
            <p className="text-zinc-500 text-xs mt-0.5 line-clamp-2">{update.body}</p>
          )}
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
        onClick={handleInstall}
        disabled={isInstalling}
        className="w-full py-1.5 bg-white hover:bg-zinc-200 text-black text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
      >
        {isInstalling ? 'Installing…' : 'Update now'}
      </button>
    </div>
  );
};

export default UpdateNotification;
