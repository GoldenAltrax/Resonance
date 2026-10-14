import { useState, useEffect, useCallback, useRef } from 'react';
import { Search as SearchIcon, TrendingUp, Compass, Headphones, Music, ListMusic, Loader2, Play, X, MoreHorizontal, Heart, Radio } from 'lucide-react';
import { api, Track, Playlist } from '@/services/api';
import { playlistCoverUrl } from '@/utils/cover';
import { usePlayerStore } from '@/stores/playerStore';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { toast } from '@/stores/toastStore';
import { trackMenuProps, openTrackMenuFromButton, TRACK_ROW_TOUCH_CLASSES } from '@/utils/trackMenu';

const RECENT_SEARCHES_KEY = 'resonance_recent_searches';
const MAX_RECENT_SEARCHES = 8;

const SearchView = () => {
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<'all' | 'tracks' | 'playlists'>('all');
  const [results, setResults] = useState<{ tracks: Track[]; playlists: Playlist[] }>({ tracks: [], playlists: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const searchSeqRef = useRef(0);
  // Actions only: stable references, no subscription
  const { play, startRadio } = usePlayerStore.getState();
  const { isFavorited, toggleFavorite } = useFavoritesStore();
  const [loadingRadio, setLoadingRadio] = useState<string | null>(null);

  // Start Radio mode
  const handleStartRadio = async (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    setLoadingRadio(track.id);
    try {
      const response = await api.getSimilarTracks(track.id, { limit: 30 });
      startRadio(track, response.similarTracks);
      toast.success(`Radio started based on "${track.title}"`);
    } catch (err) {
      toast.error('Failed to start radio');
      console.error('Radio error:', err);
    } finally {
      setLoadingRadio(null);
    }
  };

  // Load recent searches from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (stored) {
      try {
        setRecentSearches(JSON.parse(stored));
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  // Save recent search
  const saveRecentSearch = useCallback((term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;

    setRecentSearches((prev) => {
      const filtered = prev.filter((s) => s.toLowerCase() !== trimmed.toLowerCase());
      const updated = [trimmed, ...filtered].slice(0, MAX_RECENT_SEARCHES);
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Clear a recent search
  const removeRecentSearch = (term: string) => {
    setRecentSearches((prev) => {
      const updated = prev.filter((s) => s !== term);
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  // Perform search
  const performSearch = useCallback(async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setResults({ tracks: [], playlists: [] });
      setHasSearched(false);
      return;
    }

    const requestId = ++searchSeqRef.current;
    setIsLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const searchResults = await api.search(trimmed, searchType);
      // Responses can arrive out of order while typing; keep only the latest
      if (requestId !== searchSeqRef.current) return;
      setResults(searchResults);
      saveRecentSearch(trimmed);
    } catch (err) {
      if (requestId !== searchSeqRef.current) return;
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults({ tracks: [], playlists: [] });
    } finally {
      if (requestId === searchSeqRef.current) setIsLoading(false);
    }
  }, [searchType, saveRecentSearch]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) {
        performSearch(query);
      } else {
        setResults({ tracks: [], playlists: [] });
        setHasSearched(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, performSearch]);

  // Handle recent search click
  const handleRecentSearchClick = (term: string) => {
    setQuery(term);
  };

  // Play a track
  const handlePlayTrack = (track: Track) => {
    play(track, results.tracks);
  };

  const categories = [
    { name: 'Podcasts', color: 'bg-zinc-800/40', icon: Headphones },
    { name: 'New Releases', color: 'bg-zinc-800/40', icon: Compass },
    { name: 'Charts', color: 'bg-zinc-800/40', icon: TrendingUp },
  ];

  const filterTabs = [
    { label: 'All', value: 'all' as const },
    { label: 'Tracks', value: 'tracks' as const },
    { label: 'Playlists', value: 'playlists' as const },
  ];

  const showResults = hasSearched && (results.tracks.length > 0 || results.playlists.length > 0);
  const showNoResults = hasSearched && !isLoading && results.tracks.length === 0 && results.playlists.length === 0;
  const showCategories = !hasSearched && !query;

  return (
    <div className="max-w-6xl mx-auto space-y-12">
      <header>
        <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-widest mb-1">Discover</h2>
        <h1 className="text-4xl font-semibold text-white tracking-tight">Search</h1>
      </header>

      {/* Search Input */}
      <div className="space-y-4">
        <div className="relative group max-w-2xl">
          <SearchIcon className="absolute left-6 top-1/2 -translate-y-1/2 w-6 h-6 text-zinc-500 group-focus-within:text-white transition-colors" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tracks, artists, or playlists..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-3xl py-6 pl-16 pr-14 text-lg text-white focus:outline-none focus:ring-1 focus:ring-zinc-600 shadow-2xl transition-all"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-6 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          {isLoading && (
            <Loader2 className="absolute right-6 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400 animate-spin" />
          )}
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2">
          {filterTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setSearchType(tab.value)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                searchType === tab.value
                  ? 'bg-white text-black'
                  : 'bg-zinc-800/60 text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-900/20 border border-red-800/50 rounded-2xl p-6 text-red-400">
          <p>{error}</p>
        </div>
      )}

      {/* Search Results */}
      {showResults && (
        <div className="space-y-10">
          {/* Tracks */}
          {results.tracks.length > 0 && (searchType === 'all' || searchType === 'tracks') && (
            <section>
              <h3 className="text-xl font-medium text-white mb-4 flex items-center gap-2">
                <Music className="w-5 h-5 text-zinc-500" />
                Tracks
              </h3>
              <div className="space-y-2">
                {results.tracks.map((track) => (
                  <div
                    key={track.id}
                    {...trackMenuProps(track)}
                    className={`${TRACK_ROW_TOUCH_CLASSES} relative flex items-center gap-2 sm:gap-4 p-3 sm:p-4 bg-zinc-900/50 hover:bg-zinc-800/70 rounded-xl transition-all group`}
                  >
                    <button
                      onClick={() => handlePlayTrack(track)}
                      className="w-10 h-10 sm:w-12 sm:h-12 bg-zinc-800 rounded-lg flex items-center justify-center group-hover:bg-zinc-700 transition-colors flex-shrink-0"
                    >
                      <Play className="w-4 h-4 sm:w-5 sm:h-5 text-zinc-400 group-hover:text-white" />
                    </button>
                    <button
                      onClick={(e) => handleStartRadio(track, e)}
                      disabled={loadingRadio === track.id}
                      className="hidden sm:flex w-10 h-10 bg-zinc-800/50 rounded-lg items-center justify-center hover:bg-green-900/30 hover:text-green-400 transition-colors text-zinc-500 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 flex-shrink-0"
                      title="Start Radio"
                    >
                      {loadingRadio === track.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Radio className="w-4 h-4" />
                      )}
                    </button>
                    <div
                      className="flex-1 text-left cursor-pointer min-w-0"
                      onClick={() => handlePlayTrack(track)}
                    >
                      <p className="text-white font-medium truncate">{track.title}</p>
                      <p className="text-sm text-zinc-500 truncate">
                        {track.artist || 'Unknown Artist'} {track.album && `• ${track.album}`}
                      </p>
                    </div>
                    <span className="text-sm text-zinc-600 flex-shrink-0">
                      {track.duration > 0 ? formatDuration(track.duration) : '--:--'}
                    </span>

                    {/* Favorite button - hidden on mobile, always visible when favorited on desktop */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(track); }}
                      className={`flex-shrink-0 transition-all duration-200 hidden sm:block ${
                        isFavorited(track.id)
                          ? 'text-pink-500 hover:text-pink-400 !block'
                          : 'text-zinc-600 hover:text-pink-500 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100'
                      }`}
                    >
                      <Heart className={`w-5 h-5 ${isFavorited(track.id) ? 'fill-current' : ''}`} />
                    </button>

                    {/* Three-dot menu - always visible on mobile */}
                    <div className="flex-shrink-0">
                      <button
                        onClick={(e) => openTrackMenuFromButton(e, track)}
                        aria-label={`More actions for ${track.title}`}
                        className="p-1 text-zinc-600 hover:text-white transition-colors sm:opacity-0 sm:group-hover:opacity-100"
                      >
                        <MoreHorizontal className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Playlists */}
          {results.playlists.length > 0 && (searchType === 'all' || searchType === 'playlists') && (
            <section>
              <h3 className="text-xl font-medium text-white mb-4 flex items-center gap-2">
                <ListMusic className="w-5 h-5 text-zinc-500" />
                Playlists
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {results.playlists.map((playlist) => (
                  <div
                    key={playlist.id}
                    className="bg-zinc-900/50 hover:bg-zinc-800/70 rounded-2xl p-4 transition-all cursor-pointer group"
                  >
                    <div className="aspect-square bg-zinc-800 rounded-xl mb-3 overflow-hidden">
                      <img
                        src={playlistCoverUrl(playlist)}
                        alt={playlist.name}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                    <p className="text-white font-medium truncate">{playlist.name}</p>
                    <p className="text-sm text-zinc-500 truncate">{playlist.description || 'Playlist'}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* No Results */}
      {showNoResults && (
        <div className="text-center py-16">
          <SearchIcon className="w-16 h-16 text-zinc-700 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-white mb-2">No results found</h3>
          <p className="text-zinc-500">Try searching for something else</p>
        </div>
      )}

      {/* Categories (shown when no search) */}
      {showCategories && (
        <>
          <section>
            <h3 className="text-xl font-medium text-white mb-6">Browse Categories</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              {categories.map((cat, i) => (
                <button
                  key={i}
                  className={`h-40 ${cat.color} rounded-[2rem] border border-zinc-800/50 p-8 flex flex-col justify-between items-start group hover:bg-zinc-800/60 transition-all`}
                >
                  <cat.icon className="w-8 h-8 text-zinc-500 group-hover:text-white transition-colors" />
                  <span className="text-xl font-semibold text-zinc-300 group-hover:text-white transition-colors">
                    {cat.name}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Recent Searches */}
          {recentSearches.length > 0 && (
            <section>
              <h3 className="text-xl font-medium text-white mb-6">Recent Searches</h3>
              <div className="flex flex-wrap gap-3">
                {recentSearches.map((term, i) => (
                  <span
                    key={i}
                    className="group flex items-center gap-2 px-5 py-2 bg-zinc-900 border border-zinc-800 rounded-full text-sm text-zinc-400 hover:text-white hover:border-zinc-700 cursor-pointer transition-all"
                  >
                    <span onClick={() => handleRecentSearchClick(term)}>{term}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRecentSearch(term);
                      }}
                      className="opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 hover:text-red-400 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </section>
          )}
        </>
      )}

    </div>
  );
};

// Helper function to format duration
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default SearchView;
