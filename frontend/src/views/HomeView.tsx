import { useEffect, useState } from 'react';
import { PlayCircle, Clock, Shuffle, Search, Music, Play, History, AlertCircle } from 'lucide-react';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useAuthStore } from '@/stores/authStore';
import { api, Track, HistoryEntry } from '@/services/api';
import { Page } from '@/types';
import { formatDuration, formatTimeAgo } from '@/utils/time';

interface HomeViewProps {
  onNavigate: (page: Page) => void;
  onPlaylistClick: (id: string) => void;
}

const HomeView = ({ onNavigate, onPlaylistClick }: HomeViewProps) => {
  const { user } = useAuthStore();
  const { playlists } = usePlaylistStore();
  const { play } = usePlayerStore();
  const [recentTracks, setRecentTracks] = useState<Track[]>([]);
  const [isLoadingTracks, setIsLoadingTracks] = useState(true);
  const [recentlyPlayed, setRecentlyPlayed] = useState<HistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const isAdmin = user?.isAdmin ?? false;

  // Fetch recently added tracks - only for admins (uses admin-only API)
  useEffect(() => {
    const fetchRecentTracks = async () => {
      // Only fetch for admins - regular users shouldn't see this section
      if (!isAdmin) {
        setIsLoadingTracks(false);
        return;
      }

      try {
        const tracks = await api.getTracks();
        // Sort by createdAt desc and take first 8
        const sorted = tracks.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        setRecentTracks(sorted.slice(0, 8));
      } catch {
        // Silently fail - section just won't show
      } finally {
        setIsLoadingTracks(false);
      }
    };

    fetchRecentTracks();
  }, [isAdmin]);

  // Fetch recently played tracks
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        setHistoryError(null);
        const history = await api.getHistory();
        setRecentlyPlayed(history.slice(0, 10)); // Show last 10
      } catch (err) {
        setHistoryError(err instanceof Error ? err.message : 'Failed to load history');
      } finally {
        setIsLoadingHistory(false);
      }
    };

    fetchHistory();
  }, []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  const handleShuffleAll = () => {
    if (recentTracks.length === 0) return;
    const shuffled = [...recentTracks].sort(() => Math.random() - 0.5);
    play(shuffled[0], shuffled);
  };

  const handlePlayTrack = (track: Track) => {
    play(track, recentTracks);
  };

  const overviewCards = [
    { title: 'Playlists', icon: PlayCircle, color: 'text-zinc-400', action: () => onNavigate('playlists') },
    { title: 'Recently Added', icon: Clock, color: 'text-zinc-400', action: () => onNavigate('search') },
    { title: 'Shuffle All', icon: Shuffle, color: 'text-zinc-400', action: handleShuffleAll },
  ];

  // Get cover URL for playlist with cache-busting for local images
  const getPlaylistCover = (playlist: { id: string; coverImage: string | null }) => {
    if (playlist.coverImage) {
      return playlist.coverImage.startsWith('http')
        ? playlist.coverImage
        : `/uploads/${playlist.coverImage}?t=${Date.now()}`;
    }
    return `https://picsum.photos/seed/${playlist.id}/500/500`;
  };


  const handlePlayHistoryTrack = (entry: HistoryEntry) => {
    const tracks = recentlyPlayed.map(e => e.track);
    play(entry.track, tracks);
  };

  return (
    <div className="space-y-12 max-w-6xl mx-auto">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-widest mb-1">{getGreeting()}</h2>
          <h1 className="text-4xl font-semibold text-white tracking-tight">{user?.username}</h1>
        </div>
        <div
          className="relative group w-full md:w-80 cursor-pointer"
          onClick={() => onNavigate('search')}
        >
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-white transition-colors" />
          <input
            type="text"
            placeholder="Search tracks, artists, albums..."
            readOnly
            className="w-full bg-zinc-900/50 border border-zinc-800 rounded-full py-3 pl-12 pr-6 text-sm text-zinc-300 cursor-pointer hover:bg-zinc-900 transition-all"
          />
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {overviewCards.map((card, i) => (
          <button
            key={i}
            onClick={card.action}
            className="group flex items-center justify-between p-6 bg-zinc-900/30 border border-zinc-800/50 rounded-2xl hover:bg-zinc-800/40 transition-all duration-500 text-left"
          >
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center transition-transform group-hover:scale-110 duration-500`}>
                <card.icon className={`w-6 h-6 ${card.color}`} />
              </div>
              <span className="text-lg font-medium text-zinc-300 group-hover:text-white transition-colors">{card.title}</span>
            </div>
            <div className="opacity-0 group-hover:opacity-100 transition-opacity translate-x-2 group-hover:translate-x-0 duration-500">
               <ArrowRightSmall />
            </div>
          </button>
        ))}
      </section>

      {/* Jump Back In Section - Shows for all users with history */}
      {!isLoadingHistory && recentlyPlayed.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <History className="w-5 h-5 text-zinc-500" />
              <h3 className="text-xl font-medium text-white tracking-tight">Jump Back In</h3>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {recentlyPlayed.map((entry) => (
              <button
                key={entry.id}
                onClick={() => handlePlayHistoryTrack(entry)}
                className="group text-left p-3 bg-zinc-900/30 hover:bg-zinc-800/50 rounded-xl transition-all"
              >
                <div className="aspect-square bg-zinc-800 rounded-lg overflow-hidden mb-3 relative">
                  <img
                    src={`https://picsum.photos/seed/${entry.track.id}/200/200`}
                    alt={entry.track.title}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center">
                      <Play className="w-5 h-5 text-white" />
                    </div>
                  </div>
                </div>
                <p className="text-sm font-medium text-zinc-300 truncate group-hover:text-white transition-colors">
                  {entry.track.title}
                </p>
                <p className="text-xs text-zinc-600 mt-1">
                  {formatTimeAgo(entry.playedAt)}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* History Error */}
      {!isLoadingHistory && historyError && (
        <div className="text-center py-8 bg-red-900/10 rounded-2xl border border-red-800/30">
          <AlertCircle className="w-10 h-10 text-red-500/50 mx-auto mb-3" />
          <p className="text-red-400 text-sm">Failed to load history</p>
        </div>
      )}

      {/* Welcome Section for new users with no history */}
      {!isLoadingHistory && recentlyPlayed.length === 0 && !historyError && !isAdmin && (
        <section className="bg-gradient-to-br from-zinc-900/80 to-zinc-800/30 rounded-3xl p-8 border border-zinc-800/50">
          <div className="flex flex-col md:flex-row items-center gap-8">
            <div className="w-24 h-24 bg-gradient-to-br from-pink-500/20 to-purple-500/20 rounded-2xl flex items-center justify-center flex-shrink-0">
              <Music className="w-12 h-12 text-pink-500/70" />
            </div>
            <div className="flex-1 text-center md:text-left">
              <h3 className="text-2xl font-semibold text-white mb-2">Start Listening</h3>
              <p className="text-zinc-400 mb-6">
                Search for your favorite tracks or explore playlists to get started. Your recently played music will appear here.
              </p>
              <div className="flex flex-wrap gap-3 justify-center md:justify-start">
                <button
                  onClick={() => onNavigate('search')}
                  className="flex items-center gap-2 px-6 py-3 bg-white text-black rounded-full font-medium hover:bg-zinc-200 transition-colors"
                >
                  <Search className="w-4 h-4" />
                  Search Music
                </button>
                <button
                  onClick={() => onNavigate('playlists')}
                  className="flex items-center gap-2 px-6 py-3 bg-zinc-800 text-white rounded-full font-medium hover:bg-zinc-700 transition-colors"
                >
                  <PlayCircle className="w-4 h-4" />
                  Browse Playlists
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Playlists Section */}
      {playlists.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-medium text-white tracking-tight">Your Playlists</h3>
            <button
              onClick={() => onNavigate('playlists')}
              className="text-xs text-zinc-500 hover:text-white uppercase tracking-widest font-semibold transition-colors"
            >
              See all
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
            {playlists.slice(0, 4).map((playlist) => (
              <div
                key={playlist.id}
                className="group space-y-4 cursor-pointer"
                onClick={() => onPlaylistClick(playlist.id)}
              >
                <div className="aspect-square bg-zinc-900 rounded-2xl overflow-hidden relative shadow-2xl">
                  <img
                    src={getPlaylistCover(playlist)}
                    alt={playlist.name}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                    <div className="w-14 h-14 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white transform translate-y-4 group-hover:translate-y-0 transition-transform duration-500">
                      <PlayCircle className="w-8 h-8 fill-white" />
                    </div>
                  </div>
                </div>
                <div>
                  <h4 className="font-medium text-zinc-200 group-hover:text-white transition-colors truncate">{playlist.name}</h4>
                  <p className="text-xs text-zinc-500 mt-1 line-clamp-1">{playlist.description || 'Playlist'}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recently Added Section - Admin only */}
      {isAdmin && (
        <section>
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-medium text-white tracking-tight">Recently Added</h3>
          </div>

          {isLoadingTracks ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
            </div>
          ) : recentTracks.length === 0 ? (
            <div className="text-center py-12 bg-zinc-900/20 rounded-2xl border border-zinc-800/30">
              <Music className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
              <p className="text-zinc-500">No tracks yet</p>
              <p className="text-xs text-zinc-600 mt-1">Upload tracks in the Library to see them here</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {recentTracks.map((track) => (
                <button
                  key={track.id}
                  onClick={() => handlePlayTrack(track)}
                  className="flex items-center gap-4 p-4 bg-zinc-900/30 hover:bg-zinc-800/50 rounded-xl transition-all group text-left"
                >
                  <div className="w-12 h-12 bg-zinc-800 rounded-lg flex items-center justify-center group-hover:bg-zinc-700 transition-colors flex-shrink-0">
                    <Play className="w-5 h-5 text-zinc-400 group-hover:text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{track.title}</p>
                    <p className="text-sm text-zinc-500 truncate">
                      {track.artist || 'Unknown Artist'}
                    </p>
                  </div>
                  <span className="text-sm text-zinc-600 flex-shrink-0">
                    {track.duration > 0 ? formatDuration(track.duration) : '--:--'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

const ArrowRightSmall = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

export default HomeView;
