import { useRef } from 'react';
import {
  ChevronDown,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Shuffle,
  Repeat,
  Repeat1,
  Loader2,
  Music,
  Heart,
} from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { api } from '@/services/api';
import { formatTime } from '@/hooks/useAudioPlayer';

interface Props {
  onClose: () => void;
}

export default function NowPlayingScreen({ onClose }: Props) {
  const {
    currentTrack,
    isPlaying,
    isLoadingAudio,
    progress,
    duration,
    shuffle,
    repeat,
    play,
    pause,
    next,
    previous,
    seek,
    toggleShuffle,
    toggleRepeat,
  } = usePlayerStore();

  const favoriteIds = useFavoritesStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);

  // Swipe-down-to-close
  const touchStartY = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0]?.clientY ?? null;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const deltaY = (e.changedTouches[0]?.clientY ?? 0) - touchStartY.current;
    touchStartY.current = null;
    if (deltaY > 80) onClose();
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    seek(parseFloat(e.target.value));
  };

  if (!currentTrack) return null;

  const progressPct = duration > 0 ? (progress / duration) * 100 : 0;
  const isFavorited = favoriteIds.has(currentTrack.id);
  const coverUrl = currentTrack.coverArt ? api.getTrackCoverUrl(currentTrack.coverArt) : null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0a] animate-fade-in"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Subtle top gradient for depth */}
      <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-zinc-800/20 to-transparent pointer-events-none" />

      {/* Header */}
      <div className="relative flex items-center justify-between px-4 pt-3 pb-2">
        {/* Swipe handle */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-zinc-700 rounded-full" />

        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center text-zinc-500 active:text-white transition-colors"
          aria-label="Close"
        >
          <ChevronDown className="w-6 h-6" />
        </button>
        <div className="text-center">
          <p className="text-[11px] text-zinc-500 uppercase tracking-widest font-medium">Now Playing</p>
        </div>
        <div className="w-10" />
      </div>

      {/* Album art */}
      <div className="flex-1 flex items-center justify-center px-8 pb-2">
        <div className="w-full aspect-square max-w-sm bg-zinc-900 rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/5">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={currentTrack.album ?? currentTrack.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music className="w-20 h-20 text-zinc-800" />
            </div>
          )}
        </div>
      </div>

      {/* Track info + favorite */}
      <div className="px-6 pb-4 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-xl font-semibold text-white truncate leading-tight">
            {currentTrack.title}
          </p>
          <p className="text-sm text-zinc-400 truncate mt-1">
            {currentTrack.artist || 'Unknown Artist'}
          </p>
        </div>
        <button
          onClick={() => toggleFavorite(currentTrack)}
          aria-label={isFavorited ? 'Unlike' : 'Like'}
          className={`w-10 h-10 flex items-center justify-center active:scale-90 transition-all flex-shrink-0 mt-1 ${
            isFavorited ? 'text-pink-500' : 'text-zinc-600'
          }`}
        >
          <Heart className={`w-6 h-6 transition-colors ${isFavorited ? 'fill-current' : ''}`} />
        </button>
      </div>

      {/* Seek bar */}
      <div className="px-6 pb-5">
        <input
          type="range"
          min={0}
          max={duration || 1}
          value={progress}
          onChange={handleSeek}
          className="range-slider w-full"
          style={{
            background: `linear-gradient(to right, #ffffff ${progressPct}%, #27272a ${progressPct}%)`,
          }}
          aria-label="Seek"
        />
        <div className="flex justify-between mt-2">
          <span className="text-[11px] text-zinc-600 tabular-nums">{formatTime(progress)}</span>
          <span className="text-[11px] text-zinc-600 tabular-nums">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Playback controls */}
      <div className="px-6 pb-8">
        <div className="flex items-center justify-between">
          <button
            onClick={toggleShuffle}
            aria-label="Shuffle"
            className={`w-11 h-11 flex items-center justify-center transition-all active:scale-90 ${
              shuffle ? 'text-white' : 'text-zinc-600'
            }`}
          >
            <Shuffle className="w-5 h-5" />
          </button>

          <button
            onClick={previous}
            aria-label="Previous"
            className="w-14 h-14 flex items-center justify-center text-white active:scale-90 transition-transform"
          >
            <SkipBack className="w-7 h-7" />
          </button>

          <button
            onClick={() => !isLoadingAudio && (isPlaying ? pause() : play())}
            aria-label={isLoadingAudio ? 'Loading' : isPlaying ? 'Pause' : 'Play'}
            className="flex items-center justify-center bg-white rounded-full active:scale-90 transition-transform shadow-glow-white"
            style={{ width: 72, height: 72 }}
          >
            {isLoadingAudio ? (
              <Loader2 className="w-7 h-7 text-black animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-7 h-7 text-black" />
            ) : (
              <Play className="w-7 h-7 text-black ml-1" />
            )}
          </button>

          <button
            onClick={next}
            aria-label="Next"
            className="w-14 h-14 flex items-center justify-center text-white active:scale-90 transition-transform"
          >
            <SkipForward className="w-7 h-7" />
          </button>

          <button
            onClick={toggleRepeat}
            aria-label="Repeat"
            className={`w-11 h-11 flex items-center justify-center transition-all active:scale-90 ${
              repeat !== 'none' ? 'text-white' : 'text-zinc-600'
            }`}
          >
            {repeat === 'one' ? <Repeat1 className="w-5 h-5" /> : <Repeat className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
