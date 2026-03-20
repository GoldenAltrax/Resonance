import { Play, Pause, SkipBack, SkipForward, Loader2, Music } from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { api } from '@/services/api';

interface Props {
  onOpenNowPlaying: () => void;
}

export default function MobilePlayerBar({ onOpenNowPlaying }: Props) {
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
  const coverUrl = currentTrack.coverArt ? api.getTrackCoverUrl(currentTrack.coverArt) : null;

  return (
    <div
      className="fixed left-0 right-0 bg-[#0c0c0c]/95 backdrop-blur-md border-t border-zinc-800/40 z-40"
      style={{ bottom: 'calc(56px + env(safe-area-inset-bottom))' }}
    >
      {/* Progress bar — slightly thicker, gradient fill */}
      <div className="h-[3px] bg-zinc-800/80">
        <div
          className="h-full bg-gradient-to-r from-zinc-300 to-white transition-none"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="flex items-center gap-3 px-4 h-[68px]">
        {/* Album art */}
        <button
          onClick={onOpenNowPlaying}
          className="w-10 h-10 bg-zinc-800 rounded-lg overflow-hidden flex-shrink-0 active:scale-95 transition-transform ring-1 ring-white/5 shadow-md"
          aria-label="Open now playing"
        >
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={currentTrack.album ?? currentTrack.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music className="w-4 h-4 text-zinc-600" />
            </div>
          )}
        </button>

        {/* Title + artist */}
        <button
          onClick={onOpenNowPlaying}
          className="flex-1 min-w-0 text-left active:opacity-70 transition-opacity"
          aria-label="Open now playing"
        >
          <p className="text-sm font-medium text-white truncate leading-tight">
            {currentTrack.title}
          </p>
          <p className="text-xs text-zinc-500 truncate leading-tight mt-0.5">
            {currentTrack.artist || 'Unknown Artist'}
          </p>
        </button>

        {/* Controls */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={previous}
            aria-label="Previous track"
            className="w-10 h-10 flex items-center justify-center text-zinc-400 active:text-white active:scale-95 transition-all"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            onClick={() => !isLoadingAudio && (isPlaying ? pause() : play())}
            aria-label={isLoadingAudio ? 'Loading' : isPlaying ? 'Pause' : 'Play'}
            className="w-11 h-11 bg-white rounded-full flex items-center justify-center active:scale-90 transition-transform shadow-glow-sm"
          >
            {isLoadingAudio ? (
              <Loader2 className="w-4 h-4 text-black animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-4 h-4 text-black" />
            ) : (
              <Play className="w-4 h-4 text-black ml-0.5" />
            )}
          </button>

          <button
            onClick={next}
            aria-label="Next track"
            className="w-10 h-10 flex items-center justify-center text-zinc-400 active:text-white active:scale-95 transition-all"
          >
            <SkipForward className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
