import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { X, Search, CheckSquare, Square, Music2 } from 'lucide-react';
import { usePlaylistStore } from '@/stores/playlistStore';

interface LibraryPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  playlistId: string;
  existingTrackIds: string[];
  onAddTracks: (trackIds: string[]) => Promise<void>;
}

const LibraryPickerModal = ({
  isOpen,
  onClose,
  playlistId: _playlistId,
  existingTrackIds,
  onAddTracks,
}: LibraryPickerModalProps) => {
  // playlistId available for future use (e.g., showing playlist name)
  void _playlistId;
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  const { library, libraryLoading, fetchLibrary } = usePlaylistStore();

  useEffect(() => {
    if (isOpen) {
      fetchLibrary();
      setSelectedTracks(new Set());
      setSearchQuery('');
    }
  }, [isOpen, fetchLibrary]);

  // Filter out tracks already in playlist, apply search, and sort alphabetically
  const availableTracks = useMemo(() => {
    const existingSet = new Set(existingTrackIds);
    let filtered = library.filter((track) => !existingSet.has(track.id));

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (track) =>
          track.title.toLowerCase().includes(query) ||
          (track.artist?.toLowerCase().includes(query)) ||
          (track.album?.toLowerCase().includes(query))
      );
    }

    // Sort alphabetically by title (case-insensitive)
    return filtered.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  }, [library, existingTrackIds, searchQuery]);

  // Tracks already in the playlist, sorted alphabetically
  const existingTracks = useMemo(() => {
    const existingSet = new Set(existingTrackIds);
    return library
      .filter((track) => existingSet.has(track.id))
      .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  }, [library, existingTrackIds]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleTrackSelection = (trackId: string) => {
    const newSelection = new Set(selectedTracks);
    if (newSelection.has(trackId)) {
      newSelection.delete(trackId);
    } else {
      newSelection.add(trackId);
    }
    setSelectedTracks(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedTracks.size === availableTracks.length) {
      setSelectedTracks(new Set());
    } else {
      setSelectedTracks(new Set(availableTracks.map((t) => t.id)));
    }
  };

  const handleAddTracks = async () => {
    if (selectedTracks.size === 0) return;

    setIsAdding(true);
    try {
      await onAddTracks(Array.from(selectedTracks));
      onClose();
    } catch {
      // Error handled by parent
    } finally {
      setIsAdding(false);
    }
  };

  const modalRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !modalRef.current) return;
    const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    const timer = setTimeout(() => {
      modalRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    }, 0);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 pb-28">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-picker-title"
        className="bg-[#111111] border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[70vh] flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div>
            <h2 id="library-picker-title" className="text-lg font-medium text-white">Add from Library</h2>
            <p className="text-zinc-500 text-sm">Select tracks to add to your playlist</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-4 border-b border-zinc-800/50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search library..."
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-700 transition-all text-sm"
            />
          </div>
        </div>

        {/* Track List */}
        <div className="flex-1 overflow-y-auto">
          {libraryLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
              <svg className="animate-spin h-6 w-6 mb-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p className="text-sm">Loading library...</p>
            </div>
          )}

          {!libraryLoading && library.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
              <Music2 className="w-10 h-10 mb-3 opacity-50" />
              <p className="text-sm">Your library is empty</p>
              <p className="text-xs text-zinc-600 mt-1">Import some tracks first</p>
            </div>
          )}

          {!libraryLoading && library.length > 0 && (
            <div className="divide-y divide-zinc-800/30">
              {/* Select All Header (only if there are available tracks) */}
              {availableTracks.length > 0 && (
                <button
                  onClick={toggleSelectAll}
                  className="w-full flex items-center gap-3 px-6 py-3 hover:bg-zinc-800/30 transition-colors text-left"
                >
                  {selectedTracks.size === availableTracks.length ? (
                    <CheckSquare className="w-4 h-4 text-white" />
                  ) : (
                    <Square className="w-4 h-4 text-zinc-500" />
                  )}
                  <span className="text-sm text-zinc-400">
                    {selectedTracks.size === availableTracks.length
                      ? 'Deselect all'
                      : `Select all (${availableTracks.length})`}
                  </span>
                </button>
              )}

              {/* Available Tracks */}
              {availableTracks.map((track) => (
                <button
                  key={track.id}
                  onClick={() => toggleTrackSelection(track.id)}
                  className="w-full flex items-center gap-3 px-6 py-3 hover:bg-zinc-800/30 transition-colors text-left"
                >
                  {selectedTracks.has(track.id) ? (
                    <CheckSquare className="w-4 h-4 text-white flex-shrink-0" />
                  ) : (
                    <Square className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm truncate">{track.title}</p>
                    <p className="text-zinc-500 text-xs truncate">
                      {track.artist || 'Unknown Artist'}
                    </p>
                  </div>
                  <span className="text-zinc-600 text-xs tabular-nums flex-shrink-0">
                    {formatDuration(track.duration)}
                  </span>
                </button>
              ))}

              {/* Already in Playlist Section */}
              {existingTracks.length > 0 && (
                <>
                  <div className="px-6 py-2 bg-zinc-900/50">
                    <span className="text-xs uppercase tracking-wider text-zinc-600">
                      Already in playlist ({existingTracks.length})
                    </span>
                  </div>
                  {existingTracks.map((track) => (
                    <div
                      key={track.id}
                      className="flex items-center gap-3 px-6 py-3 opacity-50"
                    >
                      <CheckSquare className="w-4 h-4 text-zinc-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-zinc-400 text-sm truncate">{track.title}</p>
                        <p className="text-zinc-600 text-xs truncate">
                          {track.artist || 'Unknown Artist'}
                        </p>
                      </div>
                      <span className="text-zinc-700 text-xs tabular-nums flex-shrink-0">
                        {formatDuration(track.duration)}
                      </span>
                    </div>
                  ))}
                </>
              )}

              {/* No results message */}
              {availableTracks.length === 0 && existingTracks.length === 0 && searchQuery && (
                <div className="py-8 text-center text-zinc-500">
                  <p className="text-sm">No tracks found matching "{searchQuery}"</p>
                </div>
              )}

              {availableTracks.length === 0 && !searchQuery && existingTracks.length > 0 && (
                <div className="py-8 text-center text-zinc-500">
                  <p className="text-sm">All library tracks are already in this playlist</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800">
          <span className="text-sm text-zinc-500">
            {selectedTracks.size > 0
              ? `${selectedTracks.size} track${selectedTracks.size === 1 ? '' : 's'} selected`
              : 'No tracks selected'}
          </span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleAddTracks}
              disabled={selectedTracks.size === 0 || isAdding}
              className="px-4 py-2 rounded-xl bg-white text-black font-medium hover:bg-zinc-200 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAdding ? 'Adding...' : 'Add to Playlist'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LibraryPickerModal;
