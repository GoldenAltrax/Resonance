import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Play, MoreHorizontal, GripVertical, Heart, Trash2, ListPlus, ListEnd, ListStart, Check } from 'lucide-react';
import { Track, Playlist } from '@/services/api';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { usePlayerStore } from '@/stores/playerStore';
import { toast } from '@/stores/toastStore';

interface SortableTrackRowProps {
  track: Track;
  index: number;
  isCurrentTrack: boolean;
  isCurrentPlaying: boolean;
  onPlay: () => void;
  formatDuration: (seconds: number) => string;
  onRemoveFromPlaylist?: () => void;
  onAddToOtherPlaylist?: (track: Track) => void;
  playlists?: Playlist[];
  currentPlaylistId?: string;
  isSelected?: boolean;
  onSelect?: () => void;
}

const SortableTrackRow = ({
  track,
  index,
  isCurrentTrack,
  isCurrentPlaying,
  onPlay,
  formatDuration,
  onRemoveFromPlaylist,
  onAddToOtherPlaylist,
  playlists = [],
  currentPlaylistId,
  isSelected = false,
  onSelect,
}: SortableTrackRowProps) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showPlaylistSubmenu, setShowPlaylistSubmenu] = useState(false);
  const { isFavorited, toggleFavorite } = useFavoritesStore();
  const { addToQueue, playNext } = usePlayerStore();

  const handleAddToQueue = () => {
    addToQueue([track]);
    toast.success('Added to queue');
    setShowMenu(false);
  };

  const handlePlayNext = () => {
    playNext(track);
    toast.success('Playing next');
    setShowMenu(false);
  };

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: track.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
  };

  const otherPlaylists = playlists.filter(p => p.id !== currentPlaylistId);

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onPlay}
      className={`group grid grid-cols-[auto_auto_auto_1fr_1fr_auto_auto] gap-4 px-4 py-4 rounded-xl hover:bg-zinc-900/40 transition-colors items-center cursor-pointer ${
        isCurrentTrack ? 'bg-zinc-900/30' : ''
      } ${isDragging ? 'bg-zinc-800/50 shadow-xl' : ''} ${isSelected ? 'bg-zinc-800/40' : ''}`}
    >
      {/* Selection Checkbox */}
      {onSelect && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className="w-5 flex items-center justify-center"
        >
          <div className={`w-4 h-4 rounded border transition-colors ${
            isSelected
              ? 'bg-white border-white'
              : 'border-zinc-600 hover:border-zinc-400 group-hover:border-zinc-400'
          }`}>
            {isSelected && <Check className="w-full h-full text-black" />}
          </div>
        </button>
      )}

      {/* Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        className="w-6 flex items-center justify-center text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="w-4 h-4" />
      </div>

      {/* Track Number */}
      <div className="w-8 text-sm font-medium tabular-nums">
        {isCurrentPlaying ? (
          <div className="flex items-center justify-center gap-0.5">
            <span className="w-0.5 h-3 bg-white animate-pulse" />
            <span className="w-0.5 h-4 bg-white animate-pulse delay-75" />
            <span className="w-0.5 h-2 bg-white animate-pulse delay-150" />
          </div>
        ) : (
          <span className={`group-hover:hidden ${isCurrentTrack ? 'text-white' : 'text-zinc-600'}`}>
            {index + 1}
          </span>
        )}
        <span className={`hidden ${isCurrentPlaying ? '' : 'group-hover:flex'} items-center justify-center`}>
          <Play className="w-3 h-3 text-white fill-white" />
        </span>
      </div>

      {/* Title and Artist */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
          <img
            src={`https://picsum.photos/seed/${track.id}/40/40`}
            alt={track.title}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        </div>
        <div>
          <p className={`text-sm font-medium line-clamp-1 ${isCurrentTrack ? 'text-white' : 'text-white'}`}>
            {track.title}
          </p>
          <p className="text-xs text-zinc-500 group-hover:text-zinc-400 transition-colors">
            {track.artist || 'Unknown Artist'}
          </p>
        </div>
      </div>

      {/* Album */}
      <div className="hidden md:block text-sm text-zinc-500 line-clamp-1">
        {track.album || '-'}
      </div>

      {/* Duration */}
      <div className="w-10 text-sm text-zinc-500 text-center tabular-nums">
        {formatDuration(track.duration)}
      </div>

      {/* More Button */}
      <div className="w-8 flex justify-end relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
            setShowPlaylistSubmenu(false);
          }}
          className="text-zinc-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <MoreHorizontal className="w-5 h-5" />
        </button>

        {/* Dropdown Menu */}
        {showMenu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                setShowPlaylistSubmenu(false);
              }}
            />
            <div className="absolute right-0 top-8 z-50 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl py-1 min-w-[200px]">
              {/* Play Next */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handlePlayNext();
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                <ListStart className="w-4 h-4" />
                Play Next
              </button>

              {/* Add to Queue */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddToQueue();
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                <ListEnd className="w-4 h-4" />
                Add to Queue
              </button>

              <div className="h-px bg-zinc-800/50 my-1" />

              {/* Add to Liked Songs */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(track);
                  setShowMenu(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                <Heart className={`w-4 h-4 ${isFavorited(track.id) ? 'fill-pink-500 text-pink-500' : ''}`} />
                {isFavorited(track.id) ? 'Remove from Liked' : 'Add to Liked Songs'}
              </button>

              {/* Add to Other Playlist */}
              {otherPlaylists.length > 0 && (
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowPlaylistSubmenu(!showPlaylistSubmenu);
                    }}
                    className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <ListPlus className="w-4 h-4" />
                      Add to Playlist
                    </div>
                    <span className="text-xs text-zinc-500">▶</span>
                  </button>

                  {/* Playlist Submenu */}
                  {showPlaylistSubmenu && (
                    <div className="absolute right-full top-0 mr-1 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl py-1 min-w-[180px] max-h-64 overflow-y-auto">
                      {otherPlaylists.map((playlist) => (
                        <button
                          key={playlist.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onAddToOtherPlaylist) {
                              onAddToOtherPlaylist(track);
                            }
                            setShowMenu(false);
                            setShowPlaylistSubmenu(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left"
                        >
                          <div className="w-8 h-8 bg-zinc-800 rounded overflow-hidden flex-shrink-0">
                            <img
                              src={playlist.coverImage ? `/uploads/${playlist.coverImage}` : `https://picsum.photos/seed/${playlist.id}/40/40`}
                              alt={playlist.name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <span className="truncate">{playlist.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Remove from Playlist */}
              {onRemoveFromPlaylist && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFromPlaylist();
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-zinc-800 hover:text-red-300 transition-colors border-t border-zinc-800/50"
                >
                  <Trash2 className="w-4 h-4" />
                  Remove from Playlist
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SortableTrackRow;
