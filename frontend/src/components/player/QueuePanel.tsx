import { useState, useCallback } from 'react';
import { X, ListMusic, Trash2, GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { usePlayerStore } from '@/stores/playerStore';
import { Track } from '@/services/api';

interface SortableQueueItemProps {
  track: Track;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: () => void;
  onRemove: () => void;
}

const SortableQueueItem = ({
  track,
  index,
  isCurrent,
  isPlaying,
  onPlay,
  onRemove,
}: SortableQueueItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `queue-${index}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
        isCurrent
          ? 'bg-zinc-800/70'
          : 'hover:bg-zinc-800/40'
      } ${isDragging ? 'shadow-lg' : ''}`}
    >
      {/* Drag Handle */}
      <button
        {...attributes}
        {...listeners}
        className="p-1 text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Track Info */}
      <button
        onClick={onPlay}
        className="flex-1 flex items-center gap-3 text-left min-w-0"
      >
        <div className="relative w-10 h-10 flex-shrink-0">
          <img
            src={`https://picsum.photos/seed/${track.id}/40/40`}
            alt={track.title}
            loading="lazy"
            decoding="async"
            className="w-full h-full rounded object-cover"
          />
          {isCurrent && isPlaying && (
            <div className="absolute inset-0 bg-black/50 rounded flex items-center justify-center">
              <div className="flex items-center gap-0.5">
                <span className="w-0.5 h-2 bg-white animate-pulse" />
                <span className="w-0.5 h-3 bg-white animate-pulse delay-75" />
                <span className="w-0.5 h-1.5 bg-white animate-pulse delay-150" />
              </div>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-sm truncate ${isCurrent ? 'text-white font-medium' : 'text-zinc-300'}`}>
            {track.title}
          </p>
          <p className="text-xs text-zinc-500 truncate">{track.artist || 'Unknown Artist'}</p>
        </div>
        <span className="text-xs text-zinc-500 tabular-nums flex-shrink-0">
          {formatDuration(track.duration)}
        </span>
      </button>

      {/* Remove Button */}
      <button
        onClick={onRemove}
        className="p-1.5 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
        title="Remove from queue"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
};

const QueuePanel = () => {
  const {
    queue,
    queueIndex,
    currentTrack,
    isPlaying,
    showQueue,
    toggleQueue,
    play,
    removeFromQueue,
    reorderQueue,
    clearQueue,
  } = usePlayerStore();
  const [isClosing, setIsClosing] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = parseInt((active.id as string).replace('queue-', ''));
      const newIndex = parseInt((over.id as string).replace('queue-', ''));
      reorderQueue(oldIndex, newIndex);
    }
  }, [reorderQueue]);

  const handlePlayTrack = (index: number) => {
    const track = queue[index];
    if (track) {
      play(track, queue);
    }
  };

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      toggleQueue();
      setIsClosing(false);
    }, 300);
  };

  if (!showQueue) return null;

  const upcomingTracks = queue.slice(queueIndex + 1);
  const previousTracks = queue.slice(0, queueIndex);

  return (
    <div className="fixed top-0 right-0 bottom-24 z-40 pointer-events-none">
      <div
        className={`w-[400px] max-w-[90vw] h-full bg-[#0a0a0a] border-l border-zinc-800/50 flex flex-col shadow-2xl transition-transform duration-300 ease-out pointer-events-auto ${
          isClosing ? 'translate-x-full' : 'translate-x-0'
        }`}
        style={{
          animation: isClosing ? undefined : 'slideInFromRight 0.3s ease-out',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800/50">
          <div className="flex items-center gap-3">
            <ListMusic className="w-5 h-5 text-zinc-500" />
            <div>
              <h3 className="text-white font-medium">Queue</h3>
              <p className="text-zinc-500 text-sm">
                {queue.length} {queue.length === 1 ? 'track' : 'tracks'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {queue.length > 0 && (
              <button
                onClick={clearQueue}
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white bg-zinc-800/50 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                Clear
              </button>
            )}
            <button
              onClick={handleClose}
              className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Queue Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">
          {queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500">
              <ListMusic className="w-12 h-12 mb-4 opacity-50" />
              <p className="text-center">Queue is empty</p>
              <p className="text-sm text-zinc-600 mt-1">
                Play a song to start the queue
              </p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={queue.map((_, i) => `queue-${i}`)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-4">
                  {/* Now Playing */}
                  {currentTrack && queueIndex >= 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 px-3">
                        Now Playing
                      </h4>
                      <SortableQueueItem
                        track={currentTrack}
                        index={queueIndex}
                        isCurrent={true}
                        isPlaying={isPlaying}
                        onPlay={() => handlePlayTrack(queueIndex)}
                        onRemove={() => removeFromQueue(queueIndex)}
                      />
                    </div>
                  )}

                  {/* Up Next */}
                  {upcomingTracks.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 px-3">
                        Up Next
                      </h4>
                      <div className="space-y-1">
                        {upcomingTracks.map((track, i) => (
                          <SortableQueueItem
                            key={`upcoming-${queueIndex + 1 + i}`}
                            track={track}
                            index={queueIndex + 1 + i}
                            isCurrent={false}
                            isPlaying={false}
                            onPlay={() => handlePlayTrack(queueIndex + 1 + i)}
                            onRemove={() => removeFromQueue(queueIndex + 1 + i)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Previously Played */}
                  {previousTracks.length > 0 && (
                    <div className="opacity-60">
                      <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 px-3">
                        Previously Played
                      </h4>
                      <div className="space-y-1">
                        {previousTracks.map((track, i) => (
                          <SortableQueueItem
                            key={`previous-${i}`}
                            track={track}
                            index={i}
                            isCurrent={false}
                            isPlaying={false}
                            onPlay={() => handlePlayTrack(i)}
                            onRemove={() => removeFromQueue(i)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInFromRight {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
};

export default QueuePanel;
