import { Play, Pause, SkipBack, SkipForward, Loader2 } from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';

export default function MobilePlayerBar() {
  const {
    currentTrack,
    isPlaying,
    isLoadingAudio,
    progress,
    duration,
    play,
    pause,
    next,
    previous,
  } = usePlayerStore();

  if (!currentTrack) return null;

  const progressPct = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <div
      className="fixed left-0 right-0 bg-[#0d0d0d] border-t border-zinc-800/50 z-40"
      style={{ bottom: 'calc(56px + env(safe-area-inset-bottom))' }}
    >
      {/* Progress bar at the very top of the mini player */}
      <div className="h-0.5 bg-zinc-800">
        <div
          className="h-full bg-white transition-none"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="flex items-center gap-3 px-4 h-[72px]">
        {/* Album art */}
        <div className="w-11 h-11 bg-zinc-800 rounded-lg overflow-hidden flex-shrink-0">
          <img
            src={`https://picsum.photos/seed/${currentTrack.id}/100/100`}
            alt={currentTrack.title}
            className="w-full h-full object-cover"
          />
        </div>

        {/* Title + artist */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate leading-tight">
            {currentTrack.title}
          </p>
          <p className="text-xs text-zinc-500 truncate leading-tight mt-0.5">
            {currentTrack.artist || 'Unknown Artist'}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={previous}
            aria-label="Previous track"
            className="w-11 h-11 flex items-center justify-center text-zinc-400 active:text-white transition-colors"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            onClick={() => !isLoadingAudio && (isPlaying ? pause() : play())}
            aria-label={isLoadingAudio ? 'Loading' : isPlaying ? 'Pause' : 'Play'}
            className="w-12 h-12 bg-white rounded-full flex items-center justify-center active:scale-95 transition-transform"
          >
            {isLoadingAudio ? (
              <Loader2 className="w-5 h-5 text-black animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-5 h-5 text-black" />
            ) : (
              <Play className="w-5 h-5 text-black ml-0.5" />
            )}
          </button>

          <button
            onClick={next}
            aria-label="Next track"
            className="w-11 h-11 flex items-center justify-center text-zinc-400 active:text-white transition-colors"
          >
            <SkipForward className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
