import React, { useState, useEffect } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Mic2,
  ListMusic,
  Heart,
  Moon,
  Check,
  Radio,
  SlidersHorizontal,
} from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { formatTime } from '@/hooks/useAudioPlayer';
import { ProgressScrubber } from './ProgressScrubber';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { api } from '@/services/api';
import { AlbumArt } from '@/components/ui/AlbumArt';

const SLEEP_TIMER_OPTIONS = [
  { label: '5 minutes', value: 5 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '45 minutes', value: 45 },
  { label: '1 hour', value: 60 },
  { label: '2 hours', value: 120 },
];

export const PlayerBar = () => {
  const {
    currentTrack,
    isPlaying,
    volume,
    isMuted,
    progress,
    duration,
    shuffle,
    repeat,
    showLyrics,
    showQueue,
    showEqualizer,
    radioMode,
    radioAutoStarted,
    sleepTimerEnd,
    sleepTimerMinutes,
    play,
    pause,
    next,
    previous,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    toggleRepeat,
    toggleLyrics,
    toggleQueue,
    toggleEqualizer,
    setSleepTimer,
    checkSleepTimer,
    stopRadio,
    startRadio,
  } = usePlayerStore();

  const { isFavorited, toggleFavorite } = useFavoritesStore();
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const [radioLoading, setRadioLoading] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string | null>(null);

  const checkSleepTimerRef = React.useRef(checkSleepTimer);
  checkSleepTimerRef.current = checkSleepTimer;

  useEffect(() => {
    if (!sleepTimerEnd) {
      setTimeRemaining(null);
      return;
    }
    const interval = setInterval(() => {
      checkSleepTimerRef.current();
      const remaining = sleepTimerEnd - Date.now();
      if (remaining <= 0) {
        setTimeRemaining(null);
      } else {
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        setTimeRemaining(`${mins}:${secs.toString().padStart(2, '0')}`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [sleepTimerEnd]);

  if (!currentTrack) return null;

  const isCurrentFavorited = isFavorited(currentTrack.id);
  const coverUrl = currentTrack.coverArt
    ? api.getTrackCoverUrl(currentTrack.coverArt)
    : null;

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value));
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 h-[88px] bg-[#0c0c0c]/95 backdrop-blur-md border-t border-zinc-800/50 px-4 flex items-center z-50">
      {/* Radio auto-start notification */}
      {radioAutoStarted && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 flex items-center gap-2 px-4 py-2 bg-zinc-800/90 backdrop-blur-md border border-zinc-700/50 rounded-full text-xs text-zinc-300 shadow-xl animate-slide-up pointer-events-none">
          <Radio className="w-3 h-3 text-green-400 animate-pulse-gentle" />
          Continuing with similar tracks…
        </div>
      )}

      {/* Track Info */}
      <div className="flex items-center gap-3 w-1/4 min-w-[190px]">
        <div className="w-[52px] h-[52px] bg-zinc-800 rounded-lg overflow-hidden flex-shrink-0 ring-1 ring-white/5 shadow-lg">
          <AlbumArt
            src={coverUrl}
            alt={currentTrack.title}
            artist={currentTrack.artist}
            title={currentTrack.title}
            iconSize="w-5 h-5"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white truncate leading-tight">{currentTrack.title}</p>
          <p className="text-xs text-zinc-500 truncate mt-0.5">{currentTrack.artist || 'Unknown Artist'}</p>
        </div>
        <button
          onClick={() => toggleFavorite(currentTrack)}
          title={isCurrentFavorited ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
          aria-label={isCurrentFavorited ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
          className={`flex-shrink-0 transition-all duration-200 hover:scale-110 active:scale-95 ${
            isCurrentFavorited ? 'text-pink-500' : 'text-zinc-600 hover:text-pink-500'
          }`}
        >
          <Heart className={`w-4 h-4 ${isCurrentFavorited ? 'fill-current' : ''}`} />
        </button>
      </div>

      {/* Center — Playback Controls + Progress */}
      <div className="flex-1 flex flex-col items-center justify-center gap-2 max-w-xl mx-auto">
        <div className="flex items-center gap-5">
          {/* Radio toggle */}
          <button
            onClick={async () => {
              if (radioMode) { stopRadio(); return; }
              if (!currentTrack || radioLoading) return;
              setRadioLoading(true);
              try {
                const { similarTracks } = await api.getSimilarTracks(currentTrack.id, { limit: 30 });
                if (similarTracks.length > 0) startRadio(currentTrack, similarTracks);
              } finally {
                setRadioLoading(false);
              }
            }}
            title={radioMode ? 'Stop Radio' : 'Start Radio'}
            aria-label={radioMode ? 'Stop Radio mode' : 'Start Radio mode'}
            className={`transition-colors duration-150 ${
              radioLoading ? 'text-zinc-600 cursor-wait' :
              radioMode ? 'text-green-400 hover:text-green-300' : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            <Radio className={`w-3.5 h-3.5 ${radioMode ? 'animate-pulse-gentle' : ''}`} />
          </button>

          <button
            onClick={toggleShuffle}
            title={shuffle ? 'Disable Shuffle' : 'Enable Shuffle'}
            aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
            aria-pressed={shuffle}
            disabled={radioMode}
            className={`transition-colors duration-150 ${
              radioMode ? 'text-zinc-700 cursor-not-allowed' : shuffle ? 'text-white' : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            <Shuffle className="w-4 h-4" />
          </button>

          <button
            onClick={previous}
            title="Previous"
            aria-label="Previous track"
            className="text-zinc-400 hover:text-white transition-colors duration-150 hover:scale-105 active:scale-95"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            onClick={() => (isPlaying ? pause() : play())}
            title={isPlaying ? 'Pause' : 'Play'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="w-9 h-9 bg-white rounded-full flex items-center justify-center transition-all duration-150 hover:scale-105 active:scale-95 shadow-glow-white hover:shadow-[0_0_24px_rgba(255,255,255,0.2)]"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 text-black" />
            ) : (
              <Play className="w-4 h-4 text-black ml-0.5" />
            )}
          </button>

          <button
            onClick={next}
            title="Next"
            aria-label="Next track"
            className="text-zinc-400 hover:text-white transition-colors duration-150 hover:scale-105 active:scale-95"
          >
            <SkipForward className="w-5 h-5" />
          </button>

          <button
            onClick={toggleRepeat}
            title={repeat === 'one' ? 'Repeat One' : repeat === 'all' ? 'Repeat All' : 'Repeat Off'}
            aria-label={`Repeat: ${repeat}`}
            className={`transition-colors duration-150 ${
              repeat !== 'none' ? 'text-white' : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            {repeat === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
          </button>
        </div>

        {/* Progress Bar */}
        <div className="w-full flex items-center gap-2.5">
          <span className="text-[11px] text-zinc-600 w-9 text-right tabular-nums">{formatTime(progress)}</span>
          <div className="flex-1">
            <ProgressScrubber
              progress={progress}
              duration={duration}
              onSeek={seek}
            />
          </div>
          <span className="text-[11px] text-zinc-600 w-9 tabular-nums">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Right — Volume & Panels */}
      <div className="flex items-center gap-3.5 w-1/4 justify-end min-w-[180px]">
        {/* Sleep Timer */}
        <div className="relative">
          <button
            onClick={() => setShowSleepMenu(!showSleepMenu)}
            title={sleepTimerEnd ? `Sleep timer: ${timeRemaining}` : 'Sleep Timer'}
            aria-label={sleepTimerEnd ? `Sleep timer: ${timeRemaining}` : 'Set sleep timer'}
            className={`transition-colors flex items-center gap-1 ${
              sleepTimerEnd ? 'text-purple-400' : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            <Moon className="w-4 h-4" />
            {timeRemaining && (
              <span className="text-[10px] font-medium text-purple-400 tabular-nums">{timeRemaining}</span>
            )}
          </button>

          {showSleepMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSleepMenu(false)} />
              <div className="absolute bottom-full right-0 mb-2 w-44 bg-[#161616] border border-zinc-800/80 rounded-xl shadow-2xl z-50 overflow-hidden py-1 animate-scale-in">
                <div className="px-4 py-2 text-[10px] text-zinc-600 uppercase tracking-wider border-b border-zinc-800/50">
                  Sleep Timer
                </div>
                {SLEEP_TIMER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => { setSleepTimer(option.value); setShowSleepMenu(false); }}
                    className={`w-full flex items-center justify-between px-4 py-2 text-sm transition-colors ${
                      sleepTimerMinutes === option.value
                        ? 'text-purple-400 bg-purple-900/15'
                        : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-white'
                    }`}
                  >
                    {option.label}
                    {sleepTimerMinutes === option.value && <Check className="w-3.5 h-3.5" />}
                  </button>
                ))}
                {sleepTimerEnd && (
                  <button
                    onClick={() => { setSleepTimer(null); setShowSleepMenu(false); }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-red-900/15 transition-colors border-t border-zinc-800/50"
                  >
                    Turn off
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Icon buttons group */}
        {[
          { onClick: toggleEqualizer, active: showEqualizer, icon: SlidersHorizontal, label: 'Equalizer' },
          { onClick: toggleQueue, active: showQueue, icon: ListMusic, label: 'Queue' },
          { onClick: toggleLyrics, active: showLyrics, icon: Mic2, label: 'Lyrics' },
        ].map(({ onClick, active, icon: Icon, label }) => (
          <button
            key={label}
            onClick={onClick}
            title={label}
            aria-label={label}
            className={`transition-colors duration-150 ${active ? 'text-white' : 'text-zinc-500 hover:text-zinc-200'}`}
          >
            <Icon className="w-4 h-4" />
          </button>
        ))}

        {/* Volume */}
        <button
          onClick={toggleMute}
          title={isMuted || volume === 0 ? 'Unmute' : 'Mute'}
          aria-label={isMuted || volume === 0 ? 'Unmute' : 'Mute'}
          className="text-zinc-500 hover:text-zinc-200 transition-colors duration-150"
        >
          {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
        <div className="w-20 relative">
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={handleVolumeChange}
            aria-label="Volume"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(volume * 100)}
            className="range-slider w-full"
            style={{
              background: `linear-gradient(to right, rgb(161 161 170) ${volume * 100}%, rgb(39 39 42) ${volume * 100}%)`,
            }}
          />
        </div>
      </div>

    </div>
  );
};

export default PlayerBar;
