import { create } from 'zustand';
import { api, Playlist, PlaylistWithTracks, Track } from '@/services/api';
import { toast } from '@/stores/toastStore';

interface PlaylistState {
  playlists: Playlist[];
  currentPlaylist: PlaylistWithTracks | null;
  tracks: Track[];
  library: Track[];
  libraryLoading: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchPlaylists: () => Promise<void>;
  fetchPlaylist: (id: string) => Promise<void>;
  fetchTracks: () => Promise<void>;
  fetchLibrary: () => Promise<void>;
  createPlaylist: (name: string, description?: string) => Promise<Playlist>;
  updatePlaylist: (id: string, data: { name?: string; description?: string }) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  uploadPlaylistCover: (playlistId: string, file: File) => Promise<void>;
  uploadTrack: (file: File, silent?: boolean) => Promise<Track>;
  updateTrack: (id: string, data: { title?: string; artist?: string; album?: string }) => Promise<void>;
  deleteTrack: (id: string, silent?: boolean) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, trackId: string, silent?: boolean) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  reorderPlaylistTracks: (playlistId: string, trackIds: string[]) => Promise<void>;
  clearError: () => void;
}

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
  playlists: [],
  currentPlaylist: null,
  tracks: [],
  library: [],
  libraryLoading: false,
  isLoading: false,
  error: null,

  fetchPlaylists: async () => {
    set({ isLoading: true, error: null });
    try {
      const playlists = await api.getPlaylists();
      set({ playlists, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch playlists',
        isLoading: false,
      });
    }
  },

  fetchPlaylist: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const playlist = await api.getPlaylist(id);
      set({ currentPlaylist: playlist, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch playlist',
        isLoading: false,
      });
    }
  },

  fetchTracks: async () => {
    set({ isLoading: true, error: null });
    try {
      const tracks = await api.getTracks();
      set({ tracks, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch tracks',
        isLoading: false,
      });
    }
  },

  fetchLibrary: async () => {
    set({ libraryLoading: true, error: null });
    try {
      const library = await api.getTracks();
      set({ library, libraryLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch library',
        libraryLoading: false,
      });
    }
  },

  createPlaylist: async (name: string, description?: string) => {
    set({ isLoading: true, error: null });
    try {
      const playlist = await api.createPlaylist(name, description);
      set((state) => ({
        playlists: [playlist, ...state.playlists],
        isLoading: false,
      }));
      toast.success(`Created playlist "${name}"`);
      return playlist;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create playlist';
      set({ error: message, isLoading: false });
      toast.error(message);
      throw err;
    }
  },

  updatePlaylist: async (id: string, data: { name?: string; description?: string }) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await api.updatePlaylist(id, data);
      set((state) => ({
        playlists: state.playlists.map((p) => (p.id === id ? updated : p)),
        currentPlaylist:
          state.currentPlaylist?.id === id
            ? { ...state.currentPlaylist, ...updated }
            : state.currentPlaylist,
        isLoading: false,
      }));
      toast.success('Playlist updated');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update playlist';
      set({ error: message, isLoading: false });
      toast.error(message);
      throw err;
    }
  },

  deletePlaylist: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await api.deletePlaylist(id);
      set((state) => ({
        playlists: state.playlists.filter((p) => p.id !== id),
        currentPlaylist:
          state.currentPlaylist?.id === id ? null : state.currentPlaylist,
        isLoading: false,
      }));
      toast.success('Playlist deleted');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete playlist';
      set({ error: message, isLoading: false });
      toast.error(message);
      throw err;
    }
  },

  uploadPlaylistCover: async (playlistId: string, file: File) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await api.uploadPlaylistCover(playlistId, file);
      set((state) => ({
        playlists: state.playlists.map((p) => (p.id === playlistId ? updated : p)),
        currentPlaylist:
          state.currentPlaylist?.id === playlistId
            ? { ...state.currentPlaylist, coverImage: updated.coverImage }
            : state.currentPlaylist,
        isLoading: false,
      }));
      toast.success('Cover image updated');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload cover';
      set({ error: message, isLoading: false });
      toast.error(message);
      throw err;
    }
  },

  uploadTrack: async (file: File, silent = false) => {
    if (!silent) set({ isLoading: true, error: null });
    try {
      const track = await api.uploadTrack(file);
      set((state) => ({
        tracks: [track, ...state.tracks],
        library: [track, ...state.library],
        isLoading: false,
      }));
      if (!silent) toast.success(`Uploaded "${track.title}"`);
      return track;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload track';
      set({ error: message, isLoading: false });
      if (!silent) toast.error(message);
      throw err;
    }
  },

  updateTrack: async (id: string, data: { title?: string; artist?: string; album?: string }) => {
    try {
      const updatedTrack = await api.updateTrack(id, data);
      set((state) => ({
        tracks: state.tracks.map((t) => (t.id === id ? updatedTrack : t)),
        library: state.library.map((t) => (t.id === id ? updatedTrack : t)),
        // Also update track in currentPlaylist if present
        currentPlaylist: state.currentPlaylist
          ? {
              ...state.currentPlaylist,
              tracks: state.currentPlaylist.tracks.map((t) =>
                t.id === id ? updatedTrack : t
              ),
            }
          : null,
      }));
      toast.success('Track updated');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update track';
      set({ error: message });
      toast.error(message);
      throw err;
    }
  },

  deleteTrack: async (id: string, silent = false) => {
    try {
      await api.deleteTrack(id);
      set((state) => ({
        tracks: state.tracks.filter((t) => t.id !== id),
        library: state.library.filter((t) => t.id !== id),
      }));
      if (!silent) toast.success('Track deleted');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete track';
      set({ error: message });
      if (!silent) toast.error(message);
      throw err;
    }
  },

  addTrackToPlaylist: async (playlistId: string, trackId: string, silent = false) => {
    try {
      await api.addTrackToPlaylist(playlistId, trackId);
      // Only refresh if not in silent mode (batch operations handle refresh themselves)
      if (!silent) {
        const { currentPlaylist } = get();
        if (currentPlaylist?.id === playlistId) {
          await get().fetchPlaylist(playlistId);
        }
        toast.success('Track added to playlist');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add track';
      set({ error: message });
      if (!silent) toast.error(message);
      throw err;
    }
  },

  removeTrackFromPlaylist: async (playlistId: string, trackId: string) => {
    try {
      await api.removeTrackFromPlaylist(playlistId, trackId);
      // Refresh the current playlist if it matches
      const { currentPlaylist } = get();
      if (currentPlaylist?.id === playlistId) {
        await get().fetchPlaylist(playlistId);
      }
      toast.success('Track removed from playlist');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove track';
      set({ error: message });
      toast.error(message);
      throw err;
    }
  },

  reorderPlaylistTracks: async (playlistId: string, trackIds: string[]) => {
    try {
      await api.reorderPlaylistTracks(playlistId, trackIds);
      // Update local state immediately for responsiveness
      const { currentPlaylist } = get();
      if (currentPlaylist?.id === playlistId) {
        const reorderedTracks = trackIds
          .map((id) => currentPlaylist.tracks.find((t) => t.id === id))
          .filter((t): t is NonNullable<typeof t> => t !== undefined);
        set({
          currentPlaylist: {
            ...currentPlaylist,
            tracks: reorderedTracks,
          },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reorder tracks';
      set({ error: message });
      toast.error(message);
      // Refresh to restore correct order
      await get().fetchPlaylist(playlistId);
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
