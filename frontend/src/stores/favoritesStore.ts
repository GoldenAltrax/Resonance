import { create } from 'zustand';
import { api, Track, FavoriteWithTrack } from '@/services/api';

interface FavoritesState {
  favorites: FavoriteWithTrack[];
  favoriteIds: Set<string>;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchFavorites: () => Promise<void>;
  fetchFavoriteIds: () => Promise<void>;
  toggleFavorite: (track: Track) => Promise<void>;
  isFavorited: (trackId: string) => boolean;
  clearFavorites: () => void;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favorites: [],
  favoriteIds: new Set(),
  isLoading: false,
  error: null,

  fetchFavorites: async () => {
    set({ isLoading: true, error: null });
    try {
      const favorites = await api.getFavorites();
      const ids = new Set(favorites.map(f => f.trackId));
      set({ favorites, favoriteIds: ids, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  fetchFavoriteIds: async () => {
    try {
      const { trackIds } = await api.getFavoriteIds();
      set({ favoriteIds: new Set(trackIds) });
    } catch (error) {
      console.error('Failed to fetch favorite IDs:', error);
    }
  },

  toggleFavorite: async (track: Track) => {
    const { favoriteIds, favorites } = get();
    const isFav = favoriteIds.has(track.id);

    // Optimistic update
    const newIds = new Set(favoriteIds);
    if (isFav) {
      newIds.delete(track.id);
      set({
        favoriteIds: newIds,
        favorites: favorites.filter(f => f.trackId !== track.id),
      });
    } else {
      newIds.add(track.id);
      // Add optimistic favorite entry
      const optimisticFavorite: FavoriteWithTrack = {
        id: 'temp-' + track.id,
        userId: '',
        trackId: track.id,
        addedAt: new Date().toISOString(),
        track,
      };
      set({
        favoriteIds: newIds,
        favorites: [optimisticFavorite, ...favorites],
      });
    }

    try {
      if (isFav) {
        await api.removeFavorite(track.id);
      } else {
        await api.addFavorite(track.id);
        // Refresh to get proper favorite entry
        get().fetchFavorites();
      }
    } catch (error) {
      // Revert on error
      console.error('Failed to toggle favorite:', error);
      if (isFav) {
        // Revert remove
        const revertIds = new Set(get().favoriteIds);
        revertIds.add(track.id);
        set({ favoriteIds: revertIds });
      } else {
        // Revert add
        const revertIds = new Set(get().favoriteIds);
        revertIds.delete(track.id);
        set({
          favoriteIds: revertIds,
          favorites: get().favorites.filter(f => f.trackId !== track.id),
        });
      }
    }
  },

  isFavorited: (trackId: string) => {
    return get().favoriteIds.has(trackId);
  },

  clearFavorites: () => {
    set({ favorites: [], favoriteIds: new Set(), error: null });
  },
}));
