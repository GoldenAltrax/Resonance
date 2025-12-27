import { useEffect, useState } from 'react';
import { Play, Pause, Heart, ListPlus, Plus, Loader2 } from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { Track } from '@/services/api';
import { toast } from '@/stores/toastStore';

const LikedSongsView = () => {
  const { favorites, isLoading, fetchFavorites, toggleFavorite } = useFavoritesStore();
  const { play, currentTrack, isPlaying, pause } = usePlayerStore();
  const { playlists, fetchPlaylists, addTrackToPlaylist, createPlaylist } = usePlaylistStore();

  const [showImportModal, setShowImportModal] = useState(false);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  useEffect(() => {
    if (showImportModal) {
      fetchPlaylists();
    }
  }, [showImportModal, fetchPlaylists]);

  const handleImportToPlaylist = async (playlistId: string) => {
    const tracks = favorites.map((f) => f.track).filter(Boolean) as Track[];
    if (tracks.length === 0) return;

    setIsImporting(true);
    setImportProgress({ current: 0, total: tracks.length });

    let added = 0;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if (!track) continue;

      try {
        await addTrackToPlaylist(playlistId, track.id, true);
        added++;
      } catch {
        // Track may already exist in playlist, continue
      }
      setImportProgress({ current: i + 1, total: tracks.length });
    }

    setIsImporting(false);
    setShowImportModal(false);
    setImportProgress({ current: 0, total: 0 });
    toast.success(`Added ${added} tracks to playlist`);
  };

  const handleCreateAndImport = async () => {
    if (!newPlaylistName.trim()) return;

    try {
      const playlist = await createPlaylist(newPlaylistName.trim());
      if (playlist) {
        await handleImportToPlaylist(playlist.id);
        setNewPlaylistName('');
        setShowCreatePlaylist(false);
      }
    } catch {
      toast.error('Failed to create playlist');
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handlePlayTrack = (track: Track) => {
    const tracks = favorites.map(f => f.track);
    if (currentTrack?.id === track.id && isPlaying) {
      pause();
    } else {
      play(track, tracks);
    }
  };

  const handlePlayAll = () => {
    if (favorites.length > 0 && favorites[0]?.track) {
      const tracks = favorites.map(f => f.track);
      play(favorites[0].track, tracks);
    }
  };

  const isTrackPlaying = (track: Track) => currentTrack?.id === track.id && isPlaying;

  // Calculate total duration
  const totalDuration = favorites.reduce((acc, f) => acc + (f.track?.duration || 0), 0);
  const hours = Math.floor(totalDuration / 3600);
  const minutes = Math.floor((totalDuration % 3600) / 60);

  return (
    <div className="max-w-6xl">
      {/* Header with gradient */}
      <div className="relative mb-8 rounded-2xl overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-pink-600/30 via-purple-600/20 to-transparent" />
        <div className="relative px-8 py-12 flex items-end gap-6">
          <div className="w-52 h-52 bg-gradient-to-br from-pink-500 to-purple-600 rounded-xl shadow-2xl flex items-center justify-center">
            <Heart className="w-24 h-24 text-white fill-current" />
          </div>
          <div className="flex-1">
            <p className="text-sm text-zinc-400 uppercase tracking-wider mb-2">Playlist</p>
            <h1 className="text-5xl font-bold text-white mb-4">Liked Songs</h1>
            <p className="text-zinc-400">
              {favorites.length} {favorites.length === 1 ? 'song' : 'songs'}
              {totalDuration > 0 && (
                <span className="text-zinc-500">
                  {' '}&bull; {hours > 0 ? `${hours} hr ` : ''}{minutes} min
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Play All & Import Buttons */}
      {favorites.length > 0 && (
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={handlePlayAll}
            className="flex items-center gap-3 px-8 py-3 bg-pink-500 hover:bg-pink-400 text-white rounded-full font-medium transition-colors"
          >
            <Play className="w-5 h-5 fill-current" />
            Play All
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 px-6 py-3 border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white rounded-full font-medium transition-colors"
          >
            <ListPlus className="w-5 h-5" />
            Import to Playlist
          </button>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
          <svg className="animate-spin h-8 w-8 mb-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p>Loading liked songs...</p>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && favorites.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
          <Heart className="w-16 h-16 mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-zinc-400 mb-2">No liked songs yet</h3>
          <p className="text-sm">Songs you like will appear here</p>
        </div>
      )}

      {/* Track List */}
      {!isLoading && favorites.length > 0 && (
        <div className="bg-zinc-900/30 rounded-2xl border border-zinc-800/50 overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-[auto_1fr_1fr_100px_auto] gap-4 px-4 py-3 border-b border-zinc-800/50 text-xs uppercase tracking-wider text-zinc-500">
            <span className="w-10">#</span>
            <span>Title</span>
            <span>Artist</span>
            <span className="text-right">Duration</span>
            <span className="w-10"></span>
          </div>

          {/* Track Rows */}
          <div className="divide-y divide-zinc-800/30">
            {favorites.map((fav, index) => {
              const track = fav.track;
              if (!track) return null;

              return (
                <div
                  key={fav.id}
                  className={`grid grid-cols-[auto_1fr_1fr_100px_auto] gap-4 px-4 py-3 items-center hover:bg-zinc-800/30 transition-colors group ${
                    isTrackPlaying(track) ? 'bg-zinc-800/50' : ''
                  }`}
                >
                  {/* Number / Play Button */}
                  <div className="w-10 flex items-center justify-center">
                    <span className="text-zinc-500 group-hover:hidden">
                      {index + 1}
                    </span>
                    <button
                      onClick={() => handlePlayTrack(track)}
                      className="hidden group-hover:flex w-8 h-8 items-center justify-center text-white"
                    >
                      {isTrackPlaying(track) ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4 ml-0.5" />
                      )}
                    </button>
                  </div>

                  {/* Title */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-zinc-800 rounded overflow-hidden flex-shrink-0">
                      <img
                        src={`https://picsum.photos/seed/${track.id}/40/40`}
                        alt={track.title}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <span className={`truncate ${isTrackPlaying(track) ? 'text-pink-500 font-medium' : 'text-zinc-300'}`}>
                      {track.title}
                    </span>
                  </div>

                  {/* Artist */}
                  <span className="text-zinc-500 truncate">{track.artist || 'Unknown Artist'}</span>

                  {/* Duration */}
                  <span className="text-zinc-500 text-right tabular-nums">
                    {formatDuration(track.duration)}
                  </span>

                  {/* Unlike Button */}
                  <button
                    onClick={() => toggleFavorite(track)}
                    className="w-10 flex items-center justify-center text-pink-500 hover:text-pink-400 transition-colors"
                    title="Remove from Liked Songs"
                  >
                    <Heart className="w-4 h-4 fill-current" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Import to Playlist Modal */}
      {showImportModal && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => !isImporting && setShowImportModal(false)}
        >
          <div
            className="bg-[#1a1a1a] rounded-2xl w-full max-w-md overflow-hidden border border-zinc-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-zinc-800">
              <h2 className="text-xl font-semibold text-white">Import to Playlist</h2>
              <p className="text-sm text-zinc-400 mt-1">
                Add all {favorites.length} liked songs to a playlist
              </p>
            </div>

            {isImporting ? (
              <div className="p-8 flex flex-col items-center gap-4">
                <Loader2 className="w-8 h-8 text-pink-500 animate-spin" />
                <p className="text-zinc-400">
                  Adding tracks... {importProgress.current} / {importProgress.total}
                </p>
                <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-pink-500 transition-all duration-300"
                    style={{
                      width: `${(importProgress.current / importProgress.total) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ) : showCreatePlaylist ? (
              <div className="p-6">
                <label className="block text-sm text-zinc-400 mb-2">Playlist Name</label>
                <input
                  type="text"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  placeholder="Enter playlist name"
                  className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-pink-500"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateAndImport();
                  }}
                />
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={() => setShowCreatePlaylist(false)}
                    className="flex-1 py-2.5 text-sm text-zinc-400 hover:text-white transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleCreateAndImport}
                    disabled={!newPlaylistName.trim()}
                    className="flex-1 py-2.5 bg-pink-500 hover:bg-pink-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-xl font-medium transition-colors"
                  >
                    Create & Import
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="max-h-80 overflow-y-auto">
                  {/* Create New Playlist Option */}
                  <button
                    onClick={() => setShowCreatePlaylist(true)}
                    className="w-full flex items-center gap-4 p-4 hover:bg-zinc-800/50 transition-colors border-b border-zinc-800/50"
                  >
                    <div className="w-12 h-12 bg-pink-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Plus className="w-6 h-6 text-pink-500" />
                    </div>
                    <div className="text-left">
                      <p className="text-white font-medium">Create New Playlist</p>
                      <p className="text-sm text-zinc-500">Add liked songs to a new playlist</p>
                    </div>
                  </button>

                  {/* Existing Playlists */}
                  {playlists.length === 0 ? (
                    <div className="p-8 text-center text-zinc-500">No playlists yet</div>
                  ) : (
                    playlists.map((playlist) => (
                      <button
                        key={playlist.id}
                        onClick={() => handleImportToPlaylist(playlist.id)}
                        className="w-full flex items-center gap-4 p-4 hover:bg-zinc-800/50 transition-colors"
                      >
                        <div className="w-12 h-12 bg-zinc-800 rounded-lg overflow-hidden flex-shrink-0">
                          <img
                            src={
                              playlist.coverImage
                                ? `/uploads/${playlist.coverImage}`
                                : `https://picsum.photos/seed/${playlist.id}/48/48`
                            }
                            alt={playlist.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="text-left">
                          <p className="text-white font-medium">{playlist.name}</p>
                          <p className="text-sm text-zinc-500">Playlist</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
                <div className="p-4 border-t border-zinc-800">
                  <button
                    onClick={() => setShowImportModal(false)}
                    className="w-full py-2.5 text-sm text-zinc-400 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LikedSongsView;
