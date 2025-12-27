import { useEffect } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { toast } from '@/stores/toastStore';

interface UseKeyboardShortcutsOptions {
  onOpenHelp?: () => void;
}

export const useKeyboardShortcuts = (options?: UseKeyboardShortcutsOptions) => {
  const {
    isPlaying,
    currentTrack,
    volume,
    isMuted,
    progress,
    duration,
    shuffle,
    repeat,
    pause,
    resume,
    next,
    previous,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    toggleRepeat,
    toggleLyrics,
    toggleQueue,
  } = usePlayerStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const shortcuts: Record<string, () => void> = {
        // Space - play/pause
        ' ': () => {
          event.preventDefault();
          if (!currentTrack) return;
          if (isPlaying) {
            pause();
            toast.info('Paused');
          } else {
            resume();
            toast.info('Playing');
          }
        },

        // Arrow keys for seeking
        ArrowLeft: () => {
          if (!currentTrack) return;
          const newTime = Math.max(0, progress - 10);
          seek(newTime);
        },

        ArrowRight: () => {
          if (!currentTrack) return;
          const newTime = Math.min(duration, progress + 10);
          seek(newTime);
        },

        // Arrow keys for volume (with Shift)
        ArrowUp: () => {
          if (event.shiftKey) {
            const newVolume = Math.min(1, volume + 0.1);
            setVolume(newVolume);
            toast.info(`Volume: ${Math.round(newVolume * 100)}%`);
          }
        },

        ArrowDown: () => {
          if (event.shiftKey) {
            const newVolume = Math.max(0, volume - 0.1);
            setVolume(newVolume);
            toast.info(`Volume: ${Math.round(newVolume * 100)}%`);
          }
        },

        // M - mute toggle
        m: () => {
          toggleMute();
          toast.info(isMuted ? 'Unmuted' : 'Muted');
        },

        // L - lyrics toggle
        l: () => {
          toggleLyrics();
        },

        // Q - queue toggle
        q: () => {
          toggleQueue();
        },

        // N - next track
        n: () => {
          if (!currentTrack) return;
          next();
          toast.info('Next track');
        },

        // P - previous track
        p: () => {
          if (!currentTrack) return;
          previous();
          toast.info('Previous track');
        },

        // S - shuffle toggle
        s: () => {
          toggleShuffle();
          toast.info(shuffle ? 'Shuffle off' : 'Shuffle on');
        },

        // R - repeat toggle
        r: () => {
          toggleRepeat();
          const nextRepeat = repeat === 'none' ? 'all' : repeat === 'all' ? 'one' : 'none';
          const messages = {
            all: 'Repeat all',
            one: 'Repeat one',
            none: 'Repeat off',
          };
          toast.info(messages[nextRepeat]);
        },

        // ? - show help
        '?': () => {
          event.preventDefault();
          options?.onOpenHelp?.();
        },
      };

      // Handle shortcuts by key
      // Keep arrow keys as-is (ArrowLeft, ArrowRight, etc.), lowercase letters
      const key = event.key.startsWith('Arrow') ? event.key : event.key.toLowerCase();
      const handler = shortcuts[key as keyof typeof shortcuts];
      if (handler) {
        handler();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isPlaying,
    currentTrack,
    volume,
    isMuted,
    progress,
    duration,
    shuffle,
    repeat,
    pause,
    resume,
    next,
    previous,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    toggleRepeat,
    toggleLyrics,
    toggleQueue,
    options,
  ]);
};

// Export keyboard shortcut info for help display
export const KEYBOARD_SHORTCUTS = [
  { key: 'Space', action: 'Play / Pause' },
  { key: 'N', action: 'Next track' },
  { key: 'P', action: 'Previous track' },
  { key: 'M', action: 'Mute / Unmute' },
  { key: 'S', action: 'Toggle shuffle' },
  { key: 'R', action: 'Toggle repeat' },
  { key: 'L', action: 'Show / Hide lyrics' },
  { key: 'Q', action: 'Show / Hide queue' },
  { key: '←', action: 'Seek backward 10s' },
  { key: '→', action: 'Seek forward 10s' },
  { key: 'Shift + ↑', action: 'Volume up' },
  { key: 'Shift + ↓', action: 'Volume down' },
  { key: '?', action: 'Show keyboard shortcuts' },
];
