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

  const coverUrl = currentTrack.coverArt
    ? api.getTrackCoverUrl(currentTrack.coverArt)
    : null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0a]"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-2 pb-4">
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center text-zinc-400 active:text-white"
          aria-label="Close"
        >
          <ChevronDown className="w-6 h-6" />
        </button>
        <div className="text-center">
          <p className="text-xs text-zinc-500 uppercase tracking-widest font-medium">Now Playing</p>
        </div>
        <div className="w-10" />
      </div>

      {/* Album art */}
      <div className="flex-1 flex items-center justify-center px-8 pb-4">
        <div className="w-full aspect-square max-w-sm bg-zinc-900 rounded-2xl overflow-hidden shadow-2xl">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={currentTrack.album ?? currentTrack.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music className="w-24 h-24 text-zinc-700" />
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
          <p className="text-base text-zinc-400 truncate mt-1">
            {currentTrack.artist || 'Unknown Artist'}
          </p>
        </div>
        <button
          onClick={() => toggleFavorite(currentTrack)}
          aria-label={isFavorited ? 'Unlike' : 'Like'}
          className="w-10 h-10 flex items-center justify-center text-zinc-400 active:scale-95 transition-transform flex-shrink-0 mt-1"
        >
          <Heart
            className={`w-6 h-6 transition-colors ${isFavorited ? 'fill-white text-white' : ''}`}
          />
        </button>
      </div>

      {/* Seek bar */}
      <div className="px-6 pb-4">
        <input
          type="range"
          min={0}
          max={duration || 1}
          value={progress}
          onChange={handleSeek}
          className="w-full h-1 appearance-none bg-zinc-700 rounded-full cursor-pointer"
          style={{
            background: `linear-gradient(to right, #ffffff ${progressPct}%, #3f3f46 ${progressPct}%)`,
          }}
          aria-label="Seek"
        />
        <div className="flex justify-between mt-1">
          <span className="text-xs text-zinc-500">{formatTime(progress)}</span>
          <span className="text-xs text-zinc-500">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Playback controls */}
      <div className="px-4 pb-6">
        <div className="flex items-center justify-between">
          {/* Shuffle */}
          <button
            onClick={toggleShuffle}
            aria-label="Shuffle"
            className={`w-11 h-11 flex items-center justify-center transition-colors active:scale-95 ${
              shuffle ? 'text-white' : 'text-zinc-600'
            }`}
          >
            <Shuffle className="w-5 h-5" />
          </button>

          {/* Previous */}
          <button
            onClick={previous}
            aria-label="Previous"
            className="w-14 h-14 flex items-center justify-center text-white active:scale-95 transition-transform"
          >
            <SkipBack className="w-7 h-7" />
          </button>

          {/* Play / Pause */}
          <button
            onClick={() => !isLoadingAudio && (isPlaying ? pause() : play())}
            aria-label={isLoadingAudio ? 'Loading' : isPlaying ? 'Pause' : 'Play'}
            className="w-18 h-18 bg-white rounded-full flex items-center justify-center active:scale-95 transition-transform shadow-lg"
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

          {/* Next */}
          <button
            onClick={next}
            aria-label="Next"
            className="w-14 h-14 flex items-center justify-center text-white active:scale-95 transition-transform"
          >
            <SkipForward className="w-7 h-7" />
          </button>

          {/* Repeat */}
          <button
            onClick={toggleRepeat}
            aria-label="Repeat"
            className={`w-11 h-11 flex items-center justify-center transition-colors active:scale-95 ${
              repeat !== 'none' ? 'text-white' : 'text-zinc-600'
            }`}
          >
            {repeat === 'one' ? (
              <Repeat1 className="w-5 h-5" />
            ) : (
              <Repeat className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
