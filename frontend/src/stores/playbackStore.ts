import { create } from 'zustand';

// High-frequency playback state, deliberately kept out of the persisted player store:
// progress changes ~4x per second, and anything subscribed to it re-renders that often.
// Only the scrubber, time labels and synced lyrics should read from here.
interface PlaybackState {
  progress: number;
  duration: number;
  isBuffering: boolean;
  setProgress: (progress: number) => void;
  setDuration: (duration: number) => void;
  setBuffering: (isBuffering: boolean) => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  progress: 0,
  duration: 0,
  isBuffering: false,
  setProgress: (progress) => set({ progress }),
  setDuration: (duration) => set({ duration: Number.isFinite(duration) ? duration : 0 }),
  setBuffering: (isBuffering) => set({ isBuffering }),
}));
