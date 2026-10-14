import { useEffect, useMemo, useState } from 'react';
import { PlayCircle, Disc3, Shuffle, Search, Music, Play, History, AlertCircle } from 'lucide-react';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerStore, shuffleArray } from '@/stores/playerStore';
import { useAuthStore } from '@/stores/authStore';
import { api, HistoryEntry } from '@/services/api';
import { formatDuration, formatTimeAgo } from '@/utils/time';
import { navigate } from '@/utils/router';
import { playlistCoverUrl } from '@/utils/cover';
import { trackMenuProps, TRACK_ROW_TOUCH_CLASSES } from '@/utils/trackMenu';

const HomeView = () => {
  const user = useAuthStore((s) => s.user);
  const playlists = usePlaylistStore((s) => s.playlists);
  const library = usePlaylistStore((s) => s.library);
  const libraryLoading = usePlaylistStore((s) => s.libraryLoading);
  const play = usePlayerStore((s) => s.play);
  const [recentlyPlayed, setRecentlyPlayed] = useState<HistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // The library is shared with LibraryView via the store, so it's fetched once per session
  useEffect(() => {
    const { library, fetchLibrary } = usePlaylistStore.getState();
    if (library.length === 0) fetchLibrary();
  }, []);

  const recentTracks = useMemo(
    () =>
      [...library]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 8),
    [library]
  );
  const isLoadingTracks = libraryLoading && library.length === 0;

  useEffect(() => {
    api.getHistory()
      .then((history) => setRecentlyPlayed(history.slice(0, 10)))
      .catch((err) => setHistoryError(err instanceof Error ? err.message : 'Failed to load history'))
      .finally(() => setIsLoadingHistory(false));
  }, []);

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  // Shuffle the whole library, not just the 8 most recent tracks
  const handleShuffleAll = () => {
    if (library.length === 0) return;
    const shuffled = shuffleArray(library);
    play(shuffled[0], shuffled);
  };

  const handlePlayHistoryTrack = (entry: HistoryEntry) => {
    play(entry.track, recentlyPlayed.map(e => e.track));
  };

  const overviewCards = [
    { title: 'Playlists', icon: PlayCircle, action: () => navigate('playlists') },
    { title: 'Albums', icon: Disc3, action: () => navigate('albums') },
    { title: 'Shuffle All', icon: Shuffle, action: handleShuffleAll },
  ];

  const getPlaylistCover = playlistCoverUrl;

  return (
    <div className="space-y-10 max-w-5xl mx-auto">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-5">
        <div>
          <p className="text-xs font-medium text-zinc-600 uppercase tracking-widest mb-1">{getGreeting()}</p>
          <h1 className="text-3xl font-semibold text-white tracking-tight">{user?.username}</h1>
        </div>
        <div
          className="relative group w-full md:w-72 cursor-pointer"
          onClick={() => navigate('search')}
        >
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors pointer-events-none" />
          <div className="w-full bg-zinc-900/60 border border-zinc-800/60 rounded-xl py-2.5 pl-11 pr-5 text-sm text-zinc-600 group-hover:border-zinc-700/60 group-hover:bg-zinc-900/80 transition-all">
            Search tracks, artists…
          </div>
        </div>
      </header>

      {/* Quick actions */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {overviewCards.map((card, i) => (
          <button
            key={i}
            onClick={card.action}
            className="group flex items-center justify-between p-5 bg-zinc-900/30 border border-zinc-800/40 rounded-2xl hover:bg-zinc-800/40 hover:border-zinc-700/40 transition-all duration-300 text-left"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-zinc-800/80 flex items-center justify-center transition-transform duration-300 group-hover:scale-105 group-hover:bg-zinc-700/80">
                <card.icon className="w-5 h-5 text-zinc-400 group-hover:text-zinc-200 transition-colors" />
              </div>
              <span className="text-sm font-medium text-zinc-400 group-hover:text-white transition-colors">{card.title}</span>
            </div>
            <svg
              width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="text-zinc-700 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-300"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </section>

      {/* Jump Back In */}
      {!isLoadingHistory && recentlyPlayed.length > 0 && (
        <section>
          <div className="section-header mb-6">
            <History className="w-4 h-4 text-zinc-600 flex-shrink-0" />
            <h3 className="text-base font-semibold text-white tracking-tight">Jump Back In</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {recentlyPlayed.map((entry) => {
              const coverUrl = entry.track.coverArt
                ? api.getTrackCoverUrl(entry.track.coverArt)
                : null;
              return (
                <button
                  key={entry.id}
                  onClick={() => handlePlayHistoryTrack(entry)}
                  {...trackMenuProps(entry.track)}
                  className={`${TRACK_ROW_TOUCH_CLASSES} group text-left p-2.5 bg-zinc-900/30 hover:bg-zinc-800/50 rounded-xl transition-all duration-200`}
                >
                  <div className="aspect-square bg-zinc-800/80 rounded-lg overflow-hidden mb-2.5 relative">
                    {coverUrl ? (
                      <img
                        src={coverUrl}
                        alt={entry.track.title}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Music className="w-8 h-8 text-zinc-700" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                      <div className="w-9 h-9 bg-white/15 backdrop-blur-md rounded-full flex items-center justify-center">
                        <Play className="w-4 h-4 text-white ml-0.5" />
                      </div>
                    </div>
                  </div>
                  <p className="text-xs font-medium text-zinc-300 truncate group-hover:text-white transition-colors">{entry.track.title}</p>
                  <p className="text-[11px] text-zinc-600 mt-0.5 truncate">{entry.track.artist || 'Unknown'}</p>
                  <p className="text-[10px] text-zinc-700 mt-0.5">{formatTimeAgo(entry.playedAt)}</p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* History Error */}
      {!isLoadingHistory && historyError && (
        <div className="text-center py-8 bg-red-900/8 rounded-2xl border border-red-800/20">
          <AlertCircle className="w-8 h-8 text-red-500/40 mx-auto mb-2" />
          <p className="text-red-400/70 text-sm">Failed to load history</p>
        </div>
      )}

      {/* Welcome for new users */}
      {!isLoadingHistory && recentlyPlayed.length === 0 && !historyError && library.length === 0 && !libraryLoading && (
        <section className="bg-gradient-to-br from-zinc-900/60 to-zinc-800/20 rounded-3xl p-8 border border-zinc-800/40">
          <div className="flex flex-col md:flex-row items-center gap-8">
            <div className="w-20 h-20 bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-2xl flex items-center justify-center flex-shrink-0 ring-1 ring-white/5 shadow-xl">
              <Music className="w-9 h-9 text-zinc-500" />
            </div>
            <div className="flex-1 text-center md:text-left">
              <h3 className="text-xl font-semibold text-white mb-2">Start Listening</h3>
              <p className="text-zinc-500 text-sm mb-5 leading-relaxed">
                Search for your favourite tracks or browse playlists. Your recently played music will appear here.
              </p>
              <div className="flex flex-wrap gap-3 justify-center md:justify-start">
                <button
                  onClick={() => navigate('search')}
                  className="flex items-center gap-2 px-5 py-2.5 bg-white text-black rounded-full text-sm font-medium hover:bg-zinc-100 transition-colors"
                >
                  <Search className="w-3.5 h-3.5" />
                  Search Music
                </button>
                <button
                  onClick={() => navigate('playlists')}
                  className="flex items-center gap-2 px-5 py-2.5 bg-zinc-800 text-zinc-300 rounded-full text-sm font-medium hover:bg-zinc-700 hover:text-white transition-colors"
                >
                  <PlayCircle className="w-3.5 h-3.5" />
                  Browse Playlists
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Playlists */}
      {playlists.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-5">
            <div className="section-header flex-1">
              <h3 className="text-base font-semibold text-white tracking-tight">Your Playlists</h3>
            </div>
            <button
              onClick={() => navigate('playlists')}
              className="ml-4 text-[11px] text-zinc-600 hover:text-zinc-300 uppercase tracking-widest font-semibold transition-colors flex-shrink-0"
            >
              See all
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
            {playlists.slice(0, 4).map((playlist) => (
              <div
                key={playlist.id}
                className="group cursor-pointer"
                onClick={() => navigate('playlist-detail', playlist.id)}
              >
                <div className="aspect-square bg-zinc-900 rounded-xl overflow-hidden relative shadow-xl mb-3">
                  <img
                    src={getPlaylistCover(playlist)}
                    alt={playlist.name}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                    <div className="w-12 h-12 bg-white/15 backdrop-blur-md rounded-full flex items-center justify-center transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                      <PlayCircle className="w-7 h-7 text-white fill-white" />
                    </div>
                  </div>
                </div>
                <h4 className="text-sm font-medium text-zinc-300 group-hover:text-white transition-colors truncate">{playlist.name}</h4>
                {playlist.description && (
                  <p className="text-xs text-zinc-600 mt-0.5 truncate">{playlist.description}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recently Added */}
      {(isLoadingTracks || recentTracks.length > 0) && (
        <section>
          <div className="section-header mb-5">
            <h3 className="text-base font-semibold text-white tracking-tight">Recently Added</h3>
          </div>

          {isLoadingTracks ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-6 h-6 border-2 border-zinc-800 border-t-zinc-500 rounded-full animate-spin" />
            </div>
          ) : recentTracks.length === 0 ? (
            <div className="text-center py-10 bg-zinc-900/20 rounded-2xl border border-zinc-800/30">
              <Music className="w-10 h-10 text-zinc-800 mx-auto mb-3" />
              <p className="text-zinc-600 text-sm">No tracks yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {recentTracks.map((track) => {
                const coverUrl = track.coverArt ? api.getTrackCoverUrl(track.coverArt) : null;
                return (
                  <button
                    key={track.id}
                    onClick={() => play(track, recentTracks)}
                    {...trackMenuProps(track)}
                    className={`${TRACK_ROW_TOUCH_CLASSES} flex items-center gap-3.5 p-3 bg-zinc-900/30 hover:bg-zinc-800/50 rounded-xl transition-all duration-200 group text-left`}
                  >
                    <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {coverUrl ? (
                        <img src={coverUrl} alt={track.title} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                      ) : (
                        <Play className="w-4 h-4 text-zinc-500 group-hover:text-white transition-colors" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{track.title}</p>
                      <p className="text-xs text-zinc-500 truncate">{track.artist || 'Unknown Artist'}</p>
                    </div>
                    <span className="text-xs text-zinc-700 flex-shrink-0 tabular-nums">
                      {track.duration > 0 ? formatDuration(track.duration) : '—'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default HomeView;
