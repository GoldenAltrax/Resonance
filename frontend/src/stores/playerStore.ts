import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Track, UserPreferences, api } from '@/services/api';

// Debounce for server preferences sync
let _syncPrefTimeout: ReturnType<typeof setTimeout> | null = null;
let _radioAutoStartedTimeout: ReturnType<typeof setTimeout> | null = null;

const _syncPrefsToServer = (prefs: UserPreferences) => {
  if (_syncPrefTimeout) clearTimeout(_syncPrefTimeout);
  _syncPrefTimeout = setTimeout(() => {
    // Lazy import to avoid circular dep at module init time
    import('@/stores/authStore').then(({ useAuthStore }) => {
      const userId = useAuthStore.getState().user?.id;
      if (!userId) return;
      api.updatePreferences(userId, prefs).catch(() => {});
    });
  }, 1500);
};

const _extractPrefs = (s: PlayerState): UserPreferences => ({
  volume: s.volume,
  isMuted: s.isMuted,
  shuffle: s.shuffle,
  repeat: s.repeat,
  crossfadeEnabled: s.crossfadeEnabled,
  crossfadeDuration: s.crossfadeDuration,
  eqEnabled: s.eqEnabled,
  eqGains: s.eqGains,
  eqPreset: s.eqPreset,
});

// Debounce tracking for logPlay API calls
let lastLoggedTrackId: string | null = null;
let lastLoggedTime = 0;
const LOG_DEBOUNCE_MS = 5000; // 5 seconds minimum between logs for same track

const shouldLogPlay = (trackId: string): boolean => {
  const now = Date.now();
  if (trackId !== lastLoggedTrackId || now - lastLoggedTime > LOG_DEBOUNCE_MS) {
    lastLoggedTrackId = trackId;
    lastLoggedTime = now;
    return true;
  }
  return false;
};

interface PlayerState {
  // Current track
  currentTrack: Track | null;
  queue: Track[];
  queueIndex: number;

  // Playback state
  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  progress: number;
  duration: number;
  shuffle: boolean;
  repeat: 'none' | 'one' | 'all';
  showLyrics: boolean;
  showQueue: boolean;
  showDownloadPanel: boolean;

  // Crossfade
  crossfadeEnabled: boolean;
  crossfadeDuration: number; // seconds (0–12)

  // Equalizer
  eqEnabled: boolean;
  eqGains: number[]; // 10 bands: 32,64,125,250,500,1k,2k,4k,8k,16k Hz — each -12 to +12 dB
  eqPreset: string; // e.g. 'Flat', 'Bass Boost', ...
  showEqualizer: boolean;

  // Radio mode - auto-queue similar tracks
  radioMode: boolean;
  radioSourceTrackId: string | null;

  // Sleep timer
  sleepTimerEnd: number | null; // Unix timestamp when timer expires
  sleepTimerMinutes: number | null; // Original timer duration

  // Audio element reference (set from useAudioPlayer hook)
  audioElement: HTMLAudioElement | null;

  // True while Android blob fetch is in progress (src not yet set on audio element)
  isLoadingAudio: boolean;

  // Actions
  setAudioElement: (element: HTMLAudioElement | null) => void;
  setLoadingAudio: (loading: boolean) => void;
  play: (track?: Track, queue?: Track[]) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  previous: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setProgress: (progress: number) => void;
  setDuration: (duration: number) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  toggleLyrics: () => void;
  toggleQueue: () => void;
  toggleDownloadPanel: () => void;
  setCrossfade: (enabled: boolean, duration?: number) => void;
  setEqGain: (bandIndex: number, gain: number) => void;
  setEqPreset: (preset: string, gains: number[]) => void;
  toggleEq: () => void;
  toggleEqualizer: () => void;
  addToQueue: (tracks: Track[]) => void;
  playNext: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  clearQueue: () => void;
  setSleepTimer: (minutes: number | null) => void;
  checkSleepTimer: () => void;
  // Radio mode
  startRadio: (track: Track, similarTracks: Track[]) => void;
  stopRadio: () => void;
  // Smart auto-play notification (set briefly when radio auto-starts at queue end)
  radioAutoStarted: boolean;
  // Cross-device sync
  loadPreferences: (prefs: UserPreferences) => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      currentTrack: null,
      queue: [],
      queueIndex: -1,
      isPlaying: false,
      isLoadingAudio: false,
      volume: 0.7,
      isMuted: false,
      progress: 0,
      duration: 0,
      shuffle: false,
      repeat: 'none',
      showLyrics: false,
      showQueue: false,
      showDownloadPanel: false,
      crossfadeEnabled: false,
      crossfadeDuration: 3,
      eqEnabled: false,
      eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      eqPreset: 'Flat',
      showEqualizer: false,
      radioMode: false,
      radioSourceTrackId: null,
      radioAutoStarted: false,
      sleepTimerEnd: null,
      sleepTimerMinutes: null,
      audioElement: null,

      setLoadingAudio: (loading) => set({ isLoadingAudio: loading }),

      setAudioElement: (element) => {
        set({ audioElement: element });
        // Apply persisted settings to the new audio element
        const { volume, isMuted } = get();
        if (element) {
          element.volume = isMuted ? 0 : volume;
        }
      },

  play: (track, queue) => {
    const state = get();

    if (track) {
      // If a specific track is provided, play it
      let newQueue = queue || [track];
      let newIndex = queue ? queue.findIndex((t) => t.id === track.id) : 0;

      if (newIndex === -1) newIndex = 0;

      // Log play to history (debounced to prevent rapid duplicate logs)
      if (shouldLogPlay(track.id)) {
        api.logPlay(track.id).catch(() => {
          // Silently ignore errors
        });
      }

      set({
        currentTrack: track,
        queue: newQueue,
        queueIndex: newIndex,
        isPlaying: true,
      });
    } else if (state.currentTrack) {
      // Resume current track
      set({ isPlaying: true });
    }
  },

  pause: () => set({ isPlaying: false }),

  resume: () => {
    const { currentTrack } = get();
    if (currentTrack) {
      set({ isPlaying: true });
    }
  },

  next: () => {
    const { queue, queueIndex, shuffle, repeat, currentTrack, progress, duration, radioMode } = get();
    if (queue.length === 0) return;

    // C5: Skip logging — if <30% through the track, record the skip
    if (currentTrack && duration > 0 && progress / duration < 0.30) {
      const skipPosition = Math.round((progress / duration) * 100);
      api.logSkip(currentTrack.id, skipPosition).catch(() => {});
    }

    let nextIndex: number;

    if (shuffle) {
      // Random track (excluding current)
      const availableIndices = queue
        .map((_, i) => i)
        .filter((i) => i !== queueIndex);
      if (availableIndices.length === 0) {
        nextIndex = queueIndex;
      } else {
        nextIndex =
          availableIndices[Math.floor(Math.random() * availableIndices.length)] ?? queueIndex;
      }
    } else {
      nextIndex = queueIndex + 1;

      if (nextIndex >= queue.length) {
        if (repeat === 'all') {
          nextIndex = 0;
        } else {
          // C4: Smart auto-play — start radio from current track instead of stopping
          if (currentTrack && !radioMode) {
            api.getSimilarTracks(currentTrack.id, { limit: 30 }).then(({ similarTracks }) => {
              if (similarTracks.length > 0) {
                get().startRadio(currentTrack, similarTracks);
                if (_radioAutoStartedTimeout) clearTimeout(_radioAutoStartedTimeout);
                set({ radioAutoStarted: true });
                _radioAutoStartedTimeout = setTimeout(() => set({ radioAutoStarted: false }), 4000);
              } else {
                set({ isPlaying: false });
              }
            }).catch(() => {
              set({ isPlaying: false });
            });
          } else {
            set({ isPlaying: false });
          }
          return;
        }
      }
    }

    const nextTrack = queue[nextIndex];
    if (nextTrack) {
      set({
        currentTrack: nextTrack,
        queueIndex: nextIndex,
        progress: 0,
      });
    }
  },

  previous: () => {
    const { queue, queueIndex, progress } = get();
    if (queue.length === 0) return;

    // If more than 3 seconds in, restart track
    if (progress > 3) {
      set({ progress: 0 });
      const { audioElement } = get();
      if (audioElement) {
        audioElement.currentTime = 0;
      }
      return;
    }

    // Otherwise go to previous track
    let prevIndex = queueIndex - 1;
    if (prevIndex < 0) {
      prevIndex = queue.length - 1;
    }

    const prevTrack = queue[prevIndex];
    if (prevTrack) {
      set({
        currentTrack: prevTrack,
        queueIndex: prevIndex,
        progress: 0,
      });
    }
  },

  seek: (time) => {
    set({ progress: time });
    const { audioElement } = get();
    if (audioElement) {
      audioElement.currentTime = time;
    }
  },

  setVolume: (volume) => {
        set({ volume, isMuted: volume === 0 });
        const { audioElement } = get();
        if (audioElement) {
          audioElement.volume = volume;
        }
        _syncPrefsToServer(_extractPrefs(get()));
      },

      toggleMute: () => {
        const { isMuted, volume, audioElement } = get();
        const newMuted = !isMuted;
        set({ isMuted: newMuted });
        if (audioElement) {
          audioElement.volume = newMuted ? 0 : volume;
        }
        _syncPrefsToServer(_extractPrefs(get()));
      },

      setProgress: (progress) => set({ progress }),

  setDuration: (duration) => set({ duration }),

  toggleShuffle: () => {
        set((state) => ({ shuffle: !state.shuffle }));
        _syncPrefsToServer(_extractPrefs(get()));
      },

  toggleLyrics: () => set((state) => ({ showLyrics: !state.showLyrics, showQueue: false })),

      toggleQueue: () => set((state) => ({ showQueue: !state.showQueue, showLyrics: false })),

      toggleDownloadPanel: () => set((state) => ({ showDownloadPanel: !state.showDownloadPanel })),

      setCrossfade: (enabled, duration) => {
        set((state) => ({
          crossfadeEnabled: enabled,
          crossfadeDuration: duration ?? state.crossfadeDuration,
        }));
        _syncPrefsToServer(_extractPrefs(get()));
      },

      setEqGain: (bandIndex, gain) => {
        set((state) => {
          const eqGains = [...state.eqGains];
          eqGains[bandIndex] = gain;
          return { eqGains };
        });
        _syncPrefsToServer(_extractPrefs(get()));
      },

      setEqPreset: (preset, gains) => {
        set({ eqPreset: preset, eqGains: gains });
        _syncPrefsToServer(_extractPrefs(get()));
      },

      toggleEq: () => {
        set((state) => ({ eqEnabled: !state.eqEnabled }));
        _syncPrefsToServer(_extractPrefs(get()));
      },

      toggleEqualizer: () => set((state) => ({ showEqualizer: !state.showEqualizer })),

      toggleRepeat: () => {
        set((state) => ({
          repeat:
            state.repeat === 'none'
              ? 'all'
              : state.repeat === 'all'
              ? 'one'
              : 'none',
        }));
        _syncPrefsToServer(_extractPrefs(get()));
      },

      addToQueue: (tracks) =>
        set((state) => ({
          queue: [...state.queue, ...tracks],
        })),

      playNext: (track) =>
        set((state) => {
          const newQueue = [...state.queue];
          // Insert after current track
          newQueue.splice(state.queueIndex + 1, 0, track);
          return { queue: newQueue };
        }),

      removeFromQueue: (index) =>
        set((state) => {
          if (index <= state.queueIndex) {
            // If removing before or at current, adjust index
            return {
              queue: state.queue.filter((_, i) => i !== index),
              queueIndex: index < state.queueIndex ? state.queueIndex - 1 : state.queueIndex,
            };
          }
          return {
            queue: state.queue.filter((_, i) => i !== index),
          };
        }),

      reorderQueue: (fromIndex, toIndex) =>
        set((state) => {
          const newQueue = [...state.queue];
          const [removed] = newQueue.splice(fromIndex, 1);
          if (removed) {
            newQueue.splice(toIndex, 0, removed);
          }

          // Adjust queueIndex if needed
          let newQueueIndex = state.queueIndex;
          if (fromIndex === state.queueIndex) {
            newQueueIndex = toIndex;
          } else if (fromIndex < state.queueIndex && toIndex >= state.queueIndex) {
            newQueueIndex--;
          } else if (fromIndex > state.queueIndex && toIndex <= state.queueIndex) {
            newQueueIndex++;
          }

          return { queue: newQueue, queueIndex: newQueueIndex };
        }),

      clearQueue: () =>
        set((state) => ({
          queue: state.currentTrack ? [state.currentTrack] : [],
          queueIndex: state.currentTrack ? 0 : -1,
          radioMode: false,
          radioSourceTrackId: null,
        })),

      setSleepTimer: (minutes) => {
        if (minutes === null) {
          set({ sleepTimerEnd: null, sleepTimerMinutes: null });
        } else {
          const endTime = Date.now() + minutes * 60 * 1000;
          set({ sleepTimerEnd: endTime, sleepTimerMinutes: minutes });
        }
      },

      checkSleepTimer: () => {
        const { sleepTimerEnd, isPlaying } = get();
        if (sleepTimerEnd && isPlaying && Date.now() >= sleepTimerEnd) {
          set({ isPlaying: false, sleepTimerEnd: null, sleepTimerMinutes: null });
        }
      },

      startRadio: (track, similarTracks) => {
        // Start radio mode with the source track and similar tracks as queue
        const queue = [track, ...similarTracks];
        set({
          currentTrack: track,
          queue,
          queueIndex: 0,
          isPlaying: true,
          radioMode: true,
          radioSourceTrackId: track.id,
          shuffle: false, // Disable shuffle in radio mode
        });

        // Log play to history
        if (shouldLogPlay(track.id)) {
          api.logPlay(track.id).catch(() => {});
        }
      },

      stopRadio: () => {
        set({
          radioMode: false,
          radioSourceTrackId: null,
        });
      },

      loadPreferences: (prefs) => {
        const updates: Partial<PlayerState> = {};
        if (prefs.volume !== undefined) updates.volume = prefs.volume;
        if (prefs.isMuted !== undefined) updates.isMuted = prefs.isMuted;
        if (prefs.shuffle !== undefined) updates.shuffle = prefs.shuffle;
        if (prefs.repeat !== undefined) updates.repeat = prefs.repeat;
        if (prefs.crossfadeEnabled !== undefined) updates.crossfadeEnabled = prefs.crossfadeEnabled;
        if (prefs.crossfadeDuration !== undefined) updates.crossfadeDuration = prefs.crossfadeDuration;
        if (prefs.eqEnabled !== undefined) updates.eqEnabled = prefs.eqEnabled;
        if (prefs.eqGains !== undefined) updates.eqGains = prefs.eqGains;
        if (prefs.eqPreset !== undefined) updates.eqPreset = prefs.eqPreset;
        set(updates);
        // Apply volume to existing audio element
        const { audioElement } = get();
        const vol = updates.volume ?? get().volume;
        const muted = updates.isMuted ?? get().isMuted;
        if (audioElement) {
          audioElement.volume = muted ? 0 : vol;
        }
      },
    }),
    {
      name: 'resonance-player-settings',
      partialize: (state) => ({
        // Audio preferences
        volume: state.volume,
        isMuted: state.isMuted,
        shuffle: state.shuffle,
        repeat: state.repeat,
        crossfadeEnabled: state.crossfadeEnabled,
        crossfadeDuration: state.crossfadeDuration,
        eqEnabled: state.eqEnabled,
        eqGains: state.eqGains,
        eqPreset: state.eqPreset,
        // Session persistence — restore last queue on next launch
        currentTrack: state.currentTrack,
        queue: state.queue,
        queueIndex: state.queueIndex,
      }),
    }
  )
);
