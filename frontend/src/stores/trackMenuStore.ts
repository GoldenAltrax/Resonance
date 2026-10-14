import { create } from 'zustand';
import type { Track } from '@/services/api';

/** Extra actions that only make sense where the menu was opened. */
export interface TrackMenuContext {
  /** Playlist the track is listed in: hidden from "Add to playlist". */
  playlistId?: string;
  /** Shows "Remove from playlist". */
  onRemove?: () => void;
}

interface TrackMenuState {
  track: Track | null;
  /** Viewport point the menu opens from (cursor, or the corner of the "more" button). */
  x: number;
  y: number;
  context: TrackMenuContext;
  /** Date.now() at open; keys each opening. */
  openedAt: number;
  /** Opened by a long-press: the finger lifting may still deliver a click to the menu. */
  byTouch: boolean;
  open: (track: Track, x: number, y: number, context?: TrackMenuContext, byTouch?: boolean) => void;
  close: () => void;
}

/** One track menu for the whole app; rows open it via useTrackMenu. */
export const useTrackMenuStore = create<TrackMenuState>((set) => ({
  track: null,
  x: 0,
  y: 0,
  context: {},
  openedAt: 0,
  byTouch: false,
  open: (track, x, y, context = {}, byTouch = false) => set({ track, x, y, context, openedAt: Date.now(), byTouch }),
  close: () => set({ track: null, context: {} }),
}));
