import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlaybackStore } from '@/stores/playbackStore';
import { toast } from '@/stores/toastStore';
import { useAuthStore } from '@/stores/authStore';
import { useAssistantStore } from '@/stores/assistantStore';
import { navigate } from '@/utils/router';
import { useTrackMenuStore } from '@/stores/trackMenuStore';

interface UseKeyboardShortcutsOptions {
  onOpenHelp?: () => void;
}

/**
 * Global player shortcuts. The listener is registered once and reads current state at
 * key-press time (previously it was torn down and re-added on every progress tick).
 */
export const useKeyboardShortcuts = (options?: UseKeyboardShortcutsOptions) => {
  const onOpenHelpRef = useRef(options?.onOpenHelp);
  onOpenHelpRef.current = options?.onOpenHelp;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }
      // The track menu handles its own keys (arrows, Escape) while open
      if (useTrackMenuStore.getState().track) return;

      const player = usePlayerStore.getState();
      const { progress, duration } = usePlaybackStore.getState();
      const key = event.key.startsWith('Arrow') ? event.key : event.key.toLowerCase();

      switch (key) {
        case ' ':
          // Let focused buttons (and button-like rows) handle Space themselves
          if (target.tagName === 'BUTTON' || ['slider', 'button', 'menuitem'].includes(target.getAttribute('role') ?? '')) return;
          event.preventDefault();
          if (player.currentTrack) player.togglePlay();
          break;
        case 'ArrowLeft':
          if (player.currentTrack && !event.shiftKey) player.seek(Math.max(0, progress - 10));
          break;
        case 'ArrowRight':
          if (player.currentTrack && !event.shiftKey) player.seek(Math.min(duration, progress + 10));
          break;
        case 'ArrowUp':
          if (event.shiftKey) {
            event.preventDefault();
            const v = Math.min(1, Math.round((player.volume + 0.1) * 10) / 10);
            player.setVolume(v);
            toast.info(`Volume: ${Math.round(v * 100)}%`);
          }
          break;
        case 'ArrowDown':
          if (event.shiftKey) {
            event.preventDefault();
            const v = Math.max(0, Math.round((player.volume - 0.1) * 10) / 10);
            player.setVolume(v);
            toast.info(`Volume: ${Math.round(v * 100)}%`);
          }
          break;
        case 'm':
          player.toggleMute();
          toast.info(player.isMuted ? 'Unmuted' : 'Muted');
          break;
        case 'l':
          player.toggleLyrics();
          break;
        case 'q':
          player.toggleQueue();
          break;
        case 'n':
          if (player.currentTrack) player.next();
          break;
        case 'p':
          if (player.currentTrack) player.previous();
          break;
        case 's':
          player.toggleShuffle();
          toast.info(player.shuffle ? 'Shuffle off' : 'Shuffle on');
          break;
        case 'r': {
          player.toggleRepeat();
          const labels = { none: 'Repeat off', all: 'Repeat all', one: 'Repeat one' } as const;
          toast.info(labels[usePlayerStore.getState().repeat]);
          break;
        }
        // Admin only
        case 'a':
          if (useAuthStore.getState().user?.isAdmin) {
            event.preventDefault(); // keep the "a" out of the chat input that gets focused
            useAssistantStore.getState().toggle();
          }
          break;
        case 'd':
          if (useAuthStore.getState().user?.isAdmin) navigate('admin', 'add-music');
          break;
        case '?':
          event.preventDefault();
          onOpenHelpRef.current?.();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
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

export const ADMIN_KEYBOARD_SHORTCUTS = [
  { key: 'A', action: 'Open / Close assistant' },
  { key: 'D', action: 'Add music' },
];
