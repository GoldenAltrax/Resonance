import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Play, MoreHorizontal, GripVertical, Check } from 'lucide-react';
import { Track, api } from '@/services/api';
import { trackMenuProps, openTrackMenuFromButton, TRACK_ROW_TOUCH_CLASSES } from '@/utils/trackMenu';

interface SortableTrackRowProps {
  track: Track;
  index: number;
  isCurrentTrack: boolean;
  isCurrentPlaying: boolean;
  onPlay: () => void;
  formatDuration: (seconds: number) => string;
  onRemoveFromPlaylist?: () => void;
  currentPlaylistId?: string;
  dragDisabled?: boolean;
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
  currentPlaylistId,
  dragDisabled = false,
  isSelected = false,
  onSelect,
}: SortableTrackRowProps) => {
  const menuContext = { playlistId: currentPlaylistId, onRemove: onRemoveFromPlaylist };

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: track.id, disabled: dragDisabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onPlay}
      {...trackMenuProps(track, menuContext)}
      className={`group ${TRACK_ROW_TOUCH_CLASSES} grid grid-cols-[auto_auto_auto_1fr_1fr_auto_auto] gap-4 px-4 py-4 rounded-xl hover:bg-zinc-900/40 transition-colors items-center cursor-pointer ${
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
        className={`w-6 flex items-center justify-center text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing opacity-0 transition-opacity ${
          dragDisabled ? 'invisible' : 'group-hover:opacity-100 [@media(hover:none)]:opacity-100'
        }`}
        onClick={(e) => e.stopPropagation()}
        // Holding the grip before dragging is a drag, not a long-press for the track menu
        // (the drag sensor listens to pointer events, which these don't affect)
        onTouchStart={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
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
          {track.coverArt ? (
            <img
              src={api.getTrackCoverUrl(track.coverArt)}
              alt={track.title}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          ) : (
            <svg className="w-4 h-4 text-zinc-600" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          )}
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
      <div className="w-8 flex justify-end">
        <button
          onClick={(e) => openTrackMenuFromButton(e, track, menuContext)}
          aria-label={`More actions for ${track.title}`}
          className="text-zinc-500 hover:text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
        >
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

export default SortableTrackRow;
