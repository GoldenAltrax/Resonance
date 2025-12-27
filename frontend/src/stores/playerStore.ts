import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Track, api } from '@/services/api';

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

  // Radio mode - auto-queue similar tracks
  radioMode: boolean;
  radioSourceTrackId: string | null;

  // Sleep timer
  sleepTimerEnd: number | null; // Unix timestamp when timer expires
  sleepTimerMinutes: number | null; // Original timer duration

  // Audio element reference (set from useAudioPlayer hook)
  audioElement: HTMLAudioElement | null;

  // Actions
  setAudioElement: (element: HTMLAudioElement | null) => void;
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
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      currentTrack: null,
      queue: [],
      queueIndex: -1,
      isPlaying: false,
      volume: 0.7,
      isMuted: false,
      progress: 0,
      duration: 0,
      shuffle: false,
      repeat: 'none',
      showLyrics: false,
      showQueue: false,
      radioMode: false,
      radioSourceTrackId: null,
      sleepTimerEnd: null,
      sleepTimerMinutes: null,
      audioElement: null,

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
    const { queue, queueIndex, shuffle, repeat } = get();
    if (queue.length === 0) return;

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
          // End of queue
          set({ isPlaying: false });
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
      },

      toggleMute: () => {
        const { isMuted, volume, audioElement } = get();
        const newMuted = !isMuted;
        set({ isMuted: newMuted });
        if (audioElement) {
          audioElement.volume = newMuted ? 0 : volume;
        }
      },

      setProgress: (progress) => set({ progress }),

  setDuration: (duration) => set({ duration }),

  toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),

  toggleLyrics: () => set((state) => ({ showLyrics: !state.showLyrics, showQueue: false })),

      toggleQueue: () => set((state) => ({ showQueue: !state.showQueue, showLyrics: false })),

      toggleRepeat: () =>
        set((state) => ({
          repeat:
            state.repeat === 'none'
              ? 'all'
              : state.repeat === 'all'
              ? 'one'
              : 'none',
        })),

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
        set({
          queue: [],
          queueIndex: -1,
          currentTrack: null,
          isPlaying: false,
          progress: 0,
          duration: 0,
        }),

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
    }),
    {
      name: 'resonance-player-settings',
      partialize: (state) => ({
        volume: state.volume,
        isMuted: state.isMuted,
        shuffle: state.shuffle,
        repeat: state.repeat,
      }),
    }
  )
);
