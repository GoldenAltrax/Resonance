import { useState, useEffect } from 'react';
import { Disc3, Music } from 'lucide-react';
import { api, AlbumSummary, Track } from '@/services/api';
import { usePlayerStore } from '@/stores/playerStore';

export default function AlbumsView() {
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumSummary | null>(null);
  const { play } = usePlayerStore();

  useEffect(() => {
    api
      .getAlbums()
      .then(setAlbums)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const playAlbum = (album: AlbumSummary, startTrack?: Track) => {
    const first = startTrack ?? album.tracks[0];
    if (!first) return;
    play(first, album.tracks);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Disc3 className="w-6 h-6 text-zinc-600 animate-spin" />
      </div>
    );
  }

  if (albums.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Disc3 className="w-12 h-12 text-zinc-700 mb-3" />
        <p className="text-zinc-400 font-medium">No albums yet</p>
        <p className="text-zinc-600 text-sm mt-1">Upload tracks with album tags to see them here.</p>
      </div>
    );
  }

  // Detail view for a selected album
  if (selectedAlbum) {
    const coverUrl = selectedAlbum.coverArt ? api.getTrackCoverUrl(selectedAlbum.coverArt) : null;
    return (
      <div>
        {/* Back */}
        <button
          onClick={() => setSelectedAlbum(null)}
          className="text-sm text-zinc-400 hover:text-white transition-colors mb-4 flex items-center gap-1"
        >
          ← Albums
        </button>

        {/* Album header */}
        <div className="flex items-end gap-4 mb-6">
          <div className="w-28 h-28 bg-zinc-800 rounded-xl overflow-hidden flex-shrink-0 shadow-lg">
            {coverUrl ? (
              <img src={coverUrl} alt={selectedAlbum.album} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Disc3 className="w-10 h-10 text-zinc-600" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xl font-bold text-white truncate">{selectedAlbum.album}</p>
            {selectedAlbum.artist && (
              <p className="text-zinc-400 text-sm truncate mt-0.5">{selectedAlbum.artist}</p>
            )}
            <p className="text-zinc-600 text-xs mt-1">{selectedAlbum.trackCount} tracks</p>
            <button
              onClick={() => playAlbum(selectedAlbum)}
              className="mt-3 px-4 py-1.5 bg-white text-black text-sm font-medium rounded-full hover:bg-zinc-200 transition-colors"
            >
              Play All
            </button>
          </div>
        </div>

        {/* Track list */}
        <div className="space-y-1">
          {selectedAlbum.tracks.map((track, idx) => (
            <button
              key={track.id}
              onClick={() => playAlbum(selectedAlbum, track)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-zinc-800/50 active:bg-zinc-800 transition-colors text-left group"
            >
              <span className="w-5 text-center text-xs text-zinc-600 group-hover:text-zinc-400">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{track.title}</p>
                {track.artist && (
                  <p className="text-xs text-zinc-500 truncate">{track.artist}</p>
                )}
              </div>
              <span className="text-xs text-zinc-600 flex-shrink-0">
                {Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Album grid
  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Albums</h1>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {albums.map((album) => {
          const coverUrl = album.coverArt ? api.getTrackCoverUrl(album.coverArt) : null;
          return (
            <button
              key={album.album}
              onClick={() => setSelectedAlbum(album)}
              className="group text-left"
            >
              <div className="aspect-square bg-zinc-800 rounded-xl overflow-hidden mb-2 shadow-md group-hover:shadow-xl transition-shadow">
                {coverUrl ? (
                  <img
                    src={coverUrl}
                    alt={album.album}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Music className="w-10 h-10 text-zinc-600" />
                  </div>
                )}
              </div>
              <p className="text-sm font-medium text-white truncate">{album.album}</p>
              {album.artist && (
                <p className="text-xs text-zinc-500 truncate mt-0.5">{album.artist}</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
