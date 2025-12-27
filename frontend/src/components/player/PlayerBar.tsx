import { useState, useEffect } from 'react';
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
  Info,
  X,
} from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useFavoritesStore } from '@/stores/favoritesStore';
import LyricsPanel from './LyricsPanel';
import QueuePanel from './QueuePanel';

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
    radioMode,
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
    setSleepTimer,
    checkSleepTimer,
    stopRadio,
  } = usePlayerStore();

  const { formatTime } = useAudioPlayer();
  const { isFavorited, toggleFavorite } = useFavoritesStore();
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const [showRadioInfo, setShowRadioInfo] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string | null>(null);

  // Check sleep timer and update remaining time display
  useEffect(() => {
    if (!sleepTimerEnd) {
      setTimeRemaining(null);
      return;
    }

    const interval = setInterval(() => {
      checkSleepTimer();
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
  }, [sleepTimerEnd, checkSleepTimer]);

  if (!currentTrack) {
    return null;
  }

  const isCurrentFavorited = isFavorited(currentTrack.id);

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    seek(parseFloat(e.target.value));
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value));
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 h-24 bg-[#0d0d0d] border-t border-zinc-800/50 px-4 flex items-center z-50">
      {/* Track Info */}
      <div className="flex items-center gap-4 w-1/4 min-w-[200px]">
        <div className="w-14 h-14 bg-zinc-800 rounded-lg overflow-hidden flex-shrink-0">
          <img
            src={`https://picsum.photos/seed/${currentTrack.id}/100/100`}
            alt={currentTrack.title}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        </div>
        <div className="truncate flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">
            {currentTrack.title}
          </p>
          <p className="text-xs text-zinc-500 truncate">
            {currentTrack.artist || 'Unknown Artist'}
          </p>
        </div>
        <button
          onClick={() => toggleFavorite(currentTrack)}
          aria-label={isCurrentFavorited ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
          className={`flex-shrink-0 transition-all duration-200 hover:scale-110 ${
            isCurrentFavorited
              ? 'text-pink-500 hover:text-pink-400'
              : 'text-zinc-500 hover:text-pink-500'
          }`}
        >
          <Heart className={`w-5 h-5 ${isCurrentFavorited ? 'fill-current' : ''}`} />
        </button>
      </div>

      {/* Playback Controls */}
      <div className="flex-1 flex flex-col items-center justify-center gap-2 max-w-2xl mx-auto">
        <div className="flex items-center gap-6">
          {/* Radio Mode Indicator */}
          {radioMode ? (
            <div className="relative">
              <button
                onClick={stopRadio}
                aria-label="Stop Radio mode"
                className="flex items-center gap-1 text-green-400 hover:text-green-300 transition-colors"
              >
                <Radio className="w-4 h-4 animate-pulse" />
                <span className="text-[10px] font-medium">RADIO</span>
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <button
                onClick={() => setShowRadioInfo(true)}
                aria-label="Radio mode info"
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <Radio className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowRadioInfo(true)}
                className="absolute -top-1 -right-1 w-3 h-3 bg-zinc-700 rounded-full flex items-center justify-center hover:bg-zinc-600 transition-colors"
                aria-label="What is Radio mode?"
              >
                <Info className="w-2 h-2 text-zinc-400" />
              </button>
            </div>
          )}

          <button
            onClick={toggleShuffle}
            aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
            aria-pressed={shuffle}
            disabled={radioMode}
            className={`transition-colors ${
              radioMode ? 'text-zinc-600 cursor-not-allowed' : shuffle ? 'text-white' : 'text-zinc-500 hover:text-white'
            }`}
          >
            <Shuffle className="w-4 h-4" />
          </button>

          <button
            onClick={previous}
            aria-label="Previous track"
            className="text-zinc-400 hover:text-white transition-colors"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            onClick={() => (isPlaying ? pause() : play())}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="w-10 h-10 bg-white hover:scale-105 rounded-full flex items-center justify-center transition-transform"
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 text-black" />
            ) : (
              <Play className="w-5 h-5 text-black ml-0.5" />
            )}
          </button>

          <button
            onClick={next}
            aria-label="Next track"
            className="text-zinc-400 hover:text-white transition-colors"
          >
            <SkipForward className="w-5 h-5" />
          </button>

          <button
            onClick={toggleRepeat}
            aria-label={`Repeat: ${repeat === 'none' ? 'off' : repeat === 'all' ? 'all' : 'one'}`}
            className={`transition-colors ${
              repeat !== 'none' ? 'text-white' : 'text-zinc-500 hover:text-white'
            }`}
          >
            {repeat === 'one' ? (
              <Repeat1 className="w-4 h-4" />
            ) : (
              <Repeat className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Progress Bar */}
        <div className="w-full flex items-center gap-2">
          <span className="text-xs text-zinc-500 w-10 text-right tabular-nums">
            {formatTime(progress)}
          </span>
          <div className="flex-1 relative group">
            <input
              type="range"
              min="0"
              max={duration || 100}
              value={progress}
              onChange={handleProgressChange}
              aria-label="Track progress"
              aria-valuemin={0}
              aria-valuemax={duration || 100}
              aria-valuenow={progress}
              aria-valuetext={`${formatTime(progress)} of ${formatTime(duration)}`}
              className="w-full h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:w-3
                [&::-webkit-slider-thumb]:h-3
                [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:bg-white
                [&::-webkit-slider-thumb]:opacity-0
                [&::-webkit-slider-thumb]:group-hover:opacity-100
                [&::-webkit-slider-thumb]:transition-opacity"
              style={{
                background: `linear-gradient(to right, white ${
                  (progress / (duration || 1)) * 100
                }%, rgb(63 63 70) ${(progress / (duration || 1)) * 100}%)`,
              }}
            />
          </div>
          <span className="text-xs text-zinc-500 w-10 tabular-nums">
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Volume Control & Lyrics */}
      <div className="flex items-center gap-3 w-1/4 justify-end min-w-[180px]">
        {/* Sleep Timer */}
        <div className="relative">
          <button
            onClick={() => setShowSleepMenu(!showSleepMenu)}
            aria-label={sleepTimerEnd ? `Sleep timer: ${timeRemaining} remaining` : 'Set sleep timer'}
            className={`transition-colors flex items-center gap-1 ${
              sleepTimerEnd ? 'text-purple-400' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Moon className="w-5 h-5" />
            {timeRemaining && (
              <span className="text-[10px] font-medium text-purple-400 tabular-nums">
                {timeRemaining}
              </span>
            )}
          </button>

          {showSleepMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSleepMenu(false)} />
              <div className="absolute bottom-full right-0 mb-2 w-44 bg-[#1a1a1a] border border-zinc-800 rounded-xl shadow-xl z-50 overflow-hidden py-1">
                <div className="px-4 py-2 text-xs text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                  Sleep Timer
                </div>
                {SLEEP_TIMER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      setSleepTimer(option.value);
                      setShowSleepMenu(false);
                    }}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                      sleepTimerMinutes === option.value
                        ? 'text-purple-400 bg-purple-900/20'
                        : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                    }`}
                  >
                    {option.label}
                    {sleepTimerMinutes === option.value && <Check className="w-4 h-4" />}
                  </button>
                ))}
                {sleepTimerEnd && (
                  <button
                    onClick={() => {
                      setSleepTimer(null);
                      setShowSleepMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-red-900/20 transition-colors border-t border-zinc-800"
                  >
                    Turn off timer
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <button
          onClick={toggleQueue}
          aria-label={showQueue ? 'Hide queue' : 'Show queue'}
          aria-expanded={showQueue}
          className={`transition-colors ${
            showQueue ? 'text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <ListMusic className="w-5 h-5" />
        </button>
        <button
          onClick={toggleLyrics}
          aria-label={showLyrics ? 'Hide lyrics' : 'Show lyrics'}
          aria-expanded={showLyrics}
          className={`transition-colors ${
            showLyrics ? 'text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Mic2 className="w-5 h-5" />
        </button>
        <button
          onClick={toggleMute}
          aria-label={isMuted || volume === 0 ? 'Unmute' : 'Mute'}
          className="text-zinc-400 hover:text-white transition-colors"
        >
          {isMuted || volume === 0 ? (
            <VolumeX className="w-5 h-5" />
          ) : (
            <Volume2 className="w-5 h-5" />
          )}
        </button>
        <div className="w-24 relative group">
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
            aria-valuetext={`${Math.round(volume * 100)}%`}
            className="w-full h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-white
              [&::-webkit-slider-thumb]:opacity-0
              [&::-webkit-slider-thumb]:group-hover:opacity-100
              [&::-webkit-slider-thumb]:transition-opacity"
            style={{
              background: `linear-gradient(to right, white ${
                volume * 100
              }%, rgb(63 63 70) ${volume * 100}%)`,
            }}
          />
        </div>
      </div>

      {/* Panels */}
      <LyricsPanel />
      <QueuePanel />

      {/* Radio Info Modal */}
      {showRadioInfo && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-50"
            onClick={() => setShowRadioInfo(false)}
          />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] max-w-[90vw] bg-[#1a1a1a] border border-zinc-800 rounded-2xl shadow-2xl z-50 overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Radio className="w-5 h-5 text-green-400" />
                <h3 className="text-lg font-semibold text-white">Radio Mode</h3>
              </div>
              <button
                onClick={() => setShowRadioInfo(false)}
                className="text-zinc-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-zinc-300 text-sm leading-relaxed">
                Radio mode automatically creates a playlist of similar songs based on the track you select.
              </p>
              <div className="space-y-2">
                <h4 className="text-white text-sm font-medium">How it works:</h4>
                <ul className="text-zinc-400 text-sm space-y-1.5">
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 mt-0.5">1.</span>
                    <span>Search for a song you like</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 mt-0.5">2.</span>
                    <span>Click the <Radio className="w-3 h-3 inline mx-1" /> icon next to the play button</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 mt-0.5">3.</span>
                    <span>Similar tracks are queued based on artist, tempo, energy, and musical key</span>
                  </li>
                </ul>
              </div>
              <div className="pt-2 border-t border-zinc-800">
                <p className="text-zinc-500 text-xs">
                  Tip: Radio mode works best when your library has been analyzed. Admins can trigger analysis from the Admin panel.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default PlayerBar;
