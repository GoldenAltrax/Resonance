import { useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Play, Pause, Trash2, Pencil, Heart, GripVertical } from 'lucide-react';
import { Track } from '@/services/api';

interface VirtualizedTrackListProps {
  tracks: Track[];
  currentTrackId?: string | null;
  isPlaying?: boolean;
  selectedTracks?: Set<string>;
  favoriteIds?: Set<string>;
  showCheckbox?: boolean;
  showDragHandle?: boolean;
  showFavorite?: boolean;
  showEdit?: boolean;
  showDelete?: boolean;
  onPlay?: (track: Track, index: number) => void;
  onToggleSelect?: (trackId: string) => void;
  onToggleFavorite?: (track: Track) => void;
  onEdit?: (track: Track) => void;
  onDelete?: (track: Track) => void;
  formatDuration: (seconds: number) => string;
  formatDate?: (dateString: string) => string;
  estimateSize?: number;
}

const VirtualizedTrackList = ({
  tracks,
  currentTrackId,
  isPlaying = false,
  selectedTracks,
  favoriteIds,
  showCheckbox = false,
  showDragHandle = false,
  showFavorite = false,
  showEdit = false,
  showDelete = false,
  onPlay,
  onToggleSelect,
  onToggleFavorite,
  onEdit,
  onDelete,
  formatDuration,
  formatDate,
  estimateSize = 56,
}: VirtualizedTrackListProps) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 10,
  });

  const isTrackPlaying = useCallback(
    (track: Track) => currentTrackId === track.id && isPlaying,
    [currentTrackId, isPlaying]
  );

  const isFavorited = useCallback(
    (trackId: string) => favoriteIds?.has(trackId) ?? false,
    [favoriteIds]
  );

  const isSelected = useCallback(
    (trackId: string) => selectedTracks?.has(trackId) ?? false,
    [selectedTracks]
  );

  return (
    <div
      ref={parentRef}
      className="h-[calc(100vh-400px)] min-h-[300px] overflow-auto custom-scrollbar"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const track = tracks[virtualRow.index];
          if (!track) return null;

          const playing = isTrackPlaying(track);
          const favorited = isFavorited(track.id);
          const selected = isSelected(track.id);

          return (
            <div
              key={track.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div
                className={`flex items-center gap-4 px-4 py-2 hover:bg-zinc-800/30 transition-colors group ${
                  playing ? 'bg-zinc-800/50' : ''
                }`}
              >
                {/* Drag Handle */}
                {showDragHandle && (
                  <div className="w-6 flex items-center justify-center text-zinc-600 opacity-0 group-hover:opacity-100 cursor-grab">
                    <GripVertical className="w-4 h-4" />
                  </div>
                )}

                {/* Checkbox */}
                {showCheckbox && onToggleSelect && (
                  <button
                    onClick={() => onToggleSelect(track.id)}
                    className="w-6 flex items-center justify-center text-zinc-500 hover:text-white"
                  >
                    <div
                      className={`w-4 h-4 rounded border ${
                        selected
                          ? 'bg-white border-white'
                          : 'border-zinc-600 hover:border-zinc-400'
                      }`}
                    >
                      {selected && (
                        <svg className="w-4 h-4 text-black" viewBox="0 0 20 20" fill="currentColor">
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </div>
                  </button>
                )}

                {/* Play Button & Title */}
                <button
                  onClick={() => onPlay?.(track, virtualRow.index)}
                  className="flex-1 flex items-center gap-3 min-w-0 text-left"
                >
                  <div className="w-8 h-8 flex-shrink-0 bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-all group-hover:bg-zinc-700">
                    {playing ? (
                      <Pause className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4 ml-0.5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${playing ? 'text-white font-medium' : 'text-zinc-300'}`}>
                      {track.title}
                    </p>
                    <p className="text-xs text-zinc-500 truncate">
                      {track.artist || 'Unknown Artist'}
                    </p>
                  </div>
                </button>

                {/* Duration */}
                <span className="text-xs text-zinc-500 tabular-nums w-12 text-right">
                  {formatDuration(track.duration)}
                </span>

                {/* Date Added */}
                {formatDate && (
                  <span className="text-xs text-zinc-600 w-24 hidden lg:block">
                    {formatDate(track.createdAt)}
                  </span>
                )}

                {/* Favorite Button */}
                {showFavorite && onToggleFavorite && (
                  <button
                    onClick={() => onToggleFavorite(track)}
                    className={`w-8 flex items-center justify-center transition-all duration-200 ${
                      favorited
                        ? 'text-pink-500 hover:text-pink-400'
                        : 'text-zinc-600 hover:text-pink-500 opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${favorited ? 'fill-current' : ''}`} />
                  </button>
                )}

                {/* Edit Button */}
                {showEdit && onEdit && (
                  <button
                    onClick={() => onEdit(track)}
                    className="w-8 flex items-center justify-center text-zinc-600 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                )}

                {/* Delete Button */}
                {showDelete && onDelete && (
                  <button
                    onClick={() => onDelete(track)}
                    className="w-8 flex items-center justify-center text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VirtualizedTrackList;
