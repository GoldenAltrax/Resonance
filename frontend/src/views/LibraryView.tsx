import { useState, useEffect, useRef, ChangeEvent, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Upload, Play, Pause, Trash2, Search, Music2, X, CheckSquare, Square, Heart, ArrowUpDown, ChevronDown, ShieldX } from 'lucide-react';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useAuthStore } from '@/stores/authStore';
import { Track, api } from '@/services/api';
import { toast } from '@/stores/toastStore';
import DuplicateModal, { DuplicateItem, DuplicateAction } from '@/components/ui/DuplicateModal';
import ImportProgressModal from '@/components/ui/ImportProgressModal';
import DropZone from '@/components/ui/DropZone';
import { useFavoritesStore } from '@/stores/favoritesStore';

// File size limits
const MAX_TRACK_SIZE = 50 * 1024 * 1024; // 50MB

// Sort options
type SortOption = 'title-asc' | 'title-desc' | 'artist-asc' | 'date-newest' | 'date-oldest' | 'duration-asc' | 'duration-desc';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'title-asc', label: 'Title (A-Z)' },
  { value: 'title-desc', label: 'Title (Z-A)' },
  { value: 'artist-asc', label: 'Artist (A-Z)' },
  { value: 'date-newest', label: 'Date Added (Newest)' },
  { value: 'date-oldest', label: 'Date Added (Oldest)' },
  { value: 'duration-asc', label: 'Duration (Short)' },
  { value: 'duration-desc', label: 'Duration (Long)' },
];

const getStoredSort = (): SortOption => {
  const stored = localStorage.getItem('library-sort');
  if (stored && SORT_OPTIONS.some(o => o.value === stored)) {
    return stored as SortOption;
  }
  return 'title-asc';
};

// Threshold for using virtualization (tracks count)
const VIRTUALIZATION_THRESHOLD = 50;

const LibraryView = () => {
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin ?? false;

  // Admin-only access guard
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-zinc-500">
        <ShieldX className="w-20 h-20 mb-6 opacity-50" />
        <h2 className="text-2xl font-medium text-zinc-300 mb-2">Access Restricted</h2>
        <p className="text-zinc-500 text-center max-w-md">
          The Library is only accessible to administrators.<br />
          Use Search to discover and play music.
        </p>
      </div>
    );
  }

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [trackToDelete, setTrackToDelete] = useState<Track | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, completed: 0, skipped: 0, currentFile: '' });
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateItems, setDuplicateItems] = useState<DuplicateItem[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [sortOption, setSortOption] = useState<SortOption>(getStoredSort);
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  const { library, libraryLoading, fetchLibrary, uploadTrack, deleteTrack } = usePlaylistStore();
  const { play, currentTrack, isPlaying, pause } = usePlayerStore();
  const { toggleFavorite, isFavorited, fetchFavoriteIds } = useFavoritesStore();

  useEffect(() => {
    fetchLibrary();
    fetchFavoriteIds();
  }, [fetchLibrary, fetchFavoriteIds]);

  // Filter and sort tracks
  const filteredTracks = useMemo(() => {
    let tracks = [...library];

    // Filter by search query if present
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      tracks = tracks.filter(
        (track) =>
          track.title.toLowerCase().includes(query) ||
          (track.artist?.toLowerCase().includes(query)) ||
          (track.album?.toLowerCase().includes(query))
      );
    }

    // Sort based on selected option
    switch (sortOption) {
      case 'title-asc':
        return tracks.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
      case 'title-desc':
        return tracks.sort((a, b) => b.title.toLowerCase().localeCompare(a.title.toLowerCase()));
      case 'artist-asc':
        return tracks.sort((a, b) =>
          (a.artist || 'zzz').toLowerCase().localeCompare((b.artist || 'zzz').toLowerCase())
        );
      case 'date-newest':
        return tracks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      case 'date-oldest':
        return tracks.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      case 'duration-asc':
        return tracks.sort((a, b) => a.duration - b.duration);
      case 'duration-desc':
        return tracks.sort((a, b) => b.duration - a.duration);
      default:
        return tracks;
    }
  }, [library, searchQuery, sortOption]);

  // Handle sort change
  const handleSortChange = (option: SortOption) => {
    setSortOption(option);
    setShowSortDropdown(false);
    localStorage.setItem('library-sort', option);
  };

  // Determine if we should use virtualization
  const useVirtualization = filteredTracks.length > VIRTUALIZATION_THRESHOLD;

  // Virtualizer for large lists
  const virtualizer = useVirtualizer({
    count: filteredTracks.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 56, // Approximate row height
    overscan: 10,
    enabled: useVirtualization,
  });

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Helper to extract title from filename
  const getTitleFromFilename = (filename: string): string => {
    return filename.replace(/\.[^/.]+$/, ''); // Remove extension
  };

  // Process files after duplicate check/resolution
  const processFiles = useCallback(async (
    files: File[],
    duplicateActions: Map<string, { action: DuplicateAction; existingTrackId: string }>
  ) => {
    cancelRef.current = false;
    setIsUploading(true);
    setUploadProgress({ current: 0, total: files.length, completed: 0, skipped: 0, currentFile: '' });

    let completed = 0;
    let skipped = 0;

    for (let i = 0; i < files.length; i++) {
      // Check if cancelled
      if (cancelRef.current) {
        break;
      }

      const file = files[i];
      if (!file) continue;

      setUploadProgress((prev) => ({ ...prev, current: i, currentFile: file.name }));

      const title = getTitleFromFilename(file.name);
      const actionInfo = duplicateActions.get(title.toLowerCase());

      if (actionInfo) {
        // This file was identified as a duplicate
        if (actionInfo.action === 'skip') {
          skipped++;
          setUploadProgress((prev) => ({ ...prev, current: i + 1, skipped }));
          continue;
        } else if (actionInfo.action === 'replace') {
          // Delete existing track first, then upload new one
          try {
            await deleteTrack(actionInfo.existingTrackId, true); // silent mode
            await uploadTrack(file, true); // silent mode
            completed++;
          } catch {
            skipped++;
          }
        } else {
          // 'add' - Add anyway
          try {
            await uploadTrack(file, true); // silent mode
            completed++;
          } catch {
            skipped++;
          }
        }
      } else {
        // Not a duplicate, upload normally
        try {
          await uploadTrack(file, true); // silent mode
          completed++;
        } catch {
          skipped++;
        }
      }
      setUploadProgress((prev) => ({ ...prev, current: i + 1, completed, skipped }));
    }

    // Refresh library once at the end
    await fetchLibrary();

    setIsUploading(false);
    setUploadProgress({ current: 0, total: 0, completed: 0, skipped: 0, currentFile: '' });
    setPendingFiles([]);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [deleteTrack, uploadTrack, fetchLibrary]);

  const handleCancelImport = () => {
    cancelRef.current = true;
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);

    // Validate file sizes (50MB max per track)
    const oversizedFiles = fileArray.filter((file) => file.size > MAX_TRACK_SIZE);
    if (oversizedFiles.length > 0) {
      const names = oversizedFiles.slice(0, 3).map((f) => f.name).join(', ');
      toast.error(`Files too large (max 50MB): ${names}${oversizedFiles.length > 3 ? ` and ${oversizedFiles.length - 3} more` : ''}`);
      // Filter out oversized files
      const validFiles = fileArray.filter((file) => file.size <= MAX_TRACK_SIZE);
      if (validFiles.length === 0) {
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      // Continue with valid files only
      fileArray.length = 0;
      fileArray.push(...validFiles);
    }

    // Extract metadata from filenames for duplicate check
    const trackMeta = fileArray.map((file) => ({
      title: getTitleFromFilename(file.name),
      artist: null as string | null, // We don't know artist from filename
    }));

    try {
      // Check for duplicates
      const result = await api.checkDuplicates(trackMeta);

      if (result.duplicates.length > 0) {
        // Create duplicate items for the modal
        const items: DuplicateItem[] = result.duplicates.map((dup) => ({
          fileName: fileArray.find((f) =>
            getTitleFromFilename(f.name).toLowerCase() === dup.title.toLowerCase()
          )?.name || dup.title,
          title: dup.title,
          artist: dup.artist,
          existingTrackId: dup.existingTrackId,
          action: 'skip' as DuplicateAction,
        }));

        setDuplicateItems(items);
        setPendingFiles(fileArray);
        setShowDuplicateModal(true);
      } else {
        // No duplicates, upload all files directly
        await processFiles(fileArray, new Map());
      }
    } catch {
      // If duplicate check fails, proceed with upload anyway
      await processFiles(fileArray, new Map());
    }
  };

  const handleDuplicateConfirm = async (items: DuplicateItem[]) => {
    setShowDuplicateModal(false);

    // Build a map of duplicate actions
    const duplicateActions = new Map<string, { action: DuplicateAction; existingTrackId: string }>();
    for (const item of items) {
      duplicateActions.set(item.title.toLowerCase(), {
        action: item.action,
        existingTrackId: item.existingTrackId,
      });
    }

    // Process files with the user's choices
    await processFiles(pendingFiles, duplicateActions);
  };

  const handleDuplicateCancel = () => {
    setShowDuplicateModal(false);
    setPendingFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePlayTrack = (track: Track) => {
    if (currentTrack?.id === track.id && isPlaying) {
      pause();
    } else {
      play(track, library);
    }
  };

  const handleDeleteClick = (track: Track) => {
    setTrackToDelete(track);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (trackToDelete) {
      await deleteTrack(trackToDelete.id);
      setShowDeleteConfirm(false);
      setTrackToDelete(null);
    }
  };

  const handleBulkDelete = async () => {
    for (const trackId of selectedTracks) {
      await deleteTrack(trackId);
    }
    setSelectedTracks(new Set());
    setShowDeleteConfirm(false);
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
    if (selectedTracks.size === filteredTracks.length) {
      setSelectedTracks(new Set());
    } else {
      setSelectedTracks(new Set(filteredTracks.map((t) => t.id)));
    }
  };

  const isTrackPlaying = (track: Track) => currentTrack?.id === track.id && isPlaying;

  // Handle files dropped via drag & drop
  const handleFilesDropped = useCallback(async (files: File[]) => {
    // Validate file sizes (50MB max per track)
    const oversizedFiles = files.filter((file) => file.size > MAX_TRACK_SIZE);
    if (oversizedFiles.length > 0) {
      const names = oversizedFiles.slice(0, 3).map((f) => f.name).join(', ');
      toast.error(`Files too large (max 50MB): ${names}${oversizedFiles.length > 3 ? ` and ${oversizedFiles.length - 3} more` : ''}`);
      const validFiles = files.filter((file) => file.size <= MAX_TRACK_SIZE);
      if (validFiles.length === 0) return;
      files = validFiles;
    }

    // Extract metadata from filenames for duplicate check
    const trackMeta = files.map((file) => ({
      title: getTitleFromFilename(file.name),
      artist: null as string | null,
    }));

    try {
      const result = await api.checkDuplicates(trackMeta);

      if (result.duplicates.length > 0) {
        const items: DuplicateItem[] = result.duplicates.map((dup) => ({
          fileName: files.find((f) =>
            getTitleFromFilename(f.name).toLowerCase() === dup.title.toLowerCase()
          )?.name || dup.title,
          title: dup.title,
          artist: dup.artist,
          existingTrackId: dup.existingTrackId,
          action: 'skip' as DuplicateAction,
        }));

        setDuplicateItems(items);
        setPendingFiles(files);
        setShowDuplicateModal(true);
      } else {
        await processFiles(files, new Map());
      }
    } catch {
      await processFiles(files, new Map());
    }
  }, [processFiles]);

  return (
    <DropZone
      onFilesDropped={handleFilesDropped}
      accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac"
      className="max-w-6xl"
      disabled={isUploading}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Your Library</h1>
          <p className="text-zinc-500 text-sm">
            {library.length} {library.length === 1 ? 'track' : 'tracks'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Sort Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowSortDropdown(!showSortDropdown)}
              className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900/50 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors"
            >
              <ArrowUpDown className="w-4 h-4" />
              <span className="text-sm">{SORT_OPTIONS.find(o => o.value === sortOption)?.label}</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showSortDropdown ? 'rotate-180' : ''}`} />
            </button>
            {showSortDropdown && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowSortDropdown(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-52 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-20 py-1 overflow-hidden">
                  {SORT_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      onClick={() => handleSortChange(option.value)}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                        sortOption === option.value
                          ? 'bg-zinc-800 text-white'
                          : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-white'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {selectedTracks.size > 0 && (
            <button
              onClick={() => {
                setTrackToDelete(null);
                setShowDeleteConfirm(true);
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-red-500/20 text-red-400 rounded-xl hover:bg-red-500/30 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete ({selectedTracks.size})
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-2 px-6 py-2.5 bg-white text-black rounded-xl font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            Import Tracks
          </button>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            multiple
            accept="audio/*"
            onChange={handleFileUpload}
          />
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search your library..."
          className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl pl-12 pr-10 py-3 text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-700 transition-all"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Loading State */}
      {libraryLoading && (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
          <svg className="animate-spin h-8 w-8 mb-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p>Loading library...</p>
        </div>
      )}

      {/* Empty State */}
      {!libraryLoading && library.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
          <Music2 className="w-16 h-16 mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-zinc-400 mb-2">Your library is empty</h3>
          <p className="text-sm mb-6">Import some tracks to get started</p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-6 py-3 bg-zinc-800 text-white rounded-xl hover:bg-zinc-700 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Import Tracks
          </button>
        </div>
      )}

      {/* Track List */}
      {!libraryLoading && library.length > 0 && (
        <div className="bg-zinc-900/30 rounded-2xl border border-zinc-800/50 overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-[auto_1fr_1fr_100px_120px_auto_auto] gap-4 px-4 py-3 border-b border-zinc-800/50 text-xs uppercase tracking-wider text-zinc-500">
            <button
              onClick={toggleSelectAll}
              className="w-8 flex items-center justify-center hover:text-white transition-colors"
            >
              {selectedTracks.size === filteredTracks.length && filteredTracks.length > 0 ? (
                <CheckSquare className="w-4 h-4" />
              ) : (
                <Square className="w-4 h-4" />
              )}
            </button>
            <span>Title</span>
            <span>Artist</span>
            <span className="text-right">Duration</span>
            <span>Added</span>
            <span className="w-8"></span>
            <span className="w-10"></span>
          </div>

          {/* Track Rows - Virtualized for large lists */}
          {useVirtualization ? (
            <div
              ref={scrollContainerRef}
              className="h-[calc(100vh-380px)] min-h-[300px] overflow-auto custom-scrollbar"
            >
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const track = filteredTracks[virtualRow.index];
                  if (!track) return null;

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
                        className={`grid grid-cols-[auto_1fr_1fr_100px_120px_auto_auto] gap-4 px-4 h-14 items-center hover:bg-zinc-800/30 transition-colors group ${
                          isTrackPlaying(track) ? 'bg-zinc-800/50' : ''
                        }`}
                      >
                        {/* Checkbox */}
                        <button
                          onClick={() => toggleTrackSelection(track.id)}
                          className="w-8 flex items-center justify-center text-zinc-500 hover:text-white transition-colors"
                        >
                          {selectedTracks.has(track.id) ? (
                            <CheckSquare className="w-4 h-4 text-white" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>

                        {/* Title with Play Button */}
                        <div className="flex items-center gap-3 min-w-0">
                          <button
                            onClick={() => handlePlayTrack(track)}
                            className="w-8 h-8 flex-shrink-0 bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-all group-hover:bg-zinc-700"
                          >
                            {isTrackPlaying(track) ? (
                              <Pause className="w-4 h-4" />
                            ) : (
                              <Play className="w-4 h-4 ml-0.5" />
                            )}
                          </button>
                          <span className={`truncate ${isTrackPlaying(track) ? 'text-white font-medium' : 'text-zinc-300'}`}>
                            {track.title}
                          </span>
                        </div>

                        {/* Artist */}
                        <span className="text-zinc-500 truncate">{track.artist || 'Unknown Artist'}</span>

                        {/* Duration */}
                        <span className="text-zinc-500 text-right tabular-nums">
                          {formatDuration(track.duration)}
                        </span>

                        {/* Date Added */}
                        <span className="text-zinc-600 text-sm">{formatDate(track.createdAt)}</span>

                        {/* Favorite Button */}
                        <button
                          onClick={() => toggleFavorite(track)}
                          className={`w-8 flex items-center justify-center transition-all duration-200 ${
                            isFavorited(track.id)
                              ? 'text-pink-500 hover:text-pink-400'
                              : 'text-zinc-600 hover:text-pink-500 opacity-0 group-hover:opacity-100'
                          }`}
                          title={isFavorited(track.id) ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
                        >
                          <Heart className={`w-4 h-4 ${isFavorited(track.id) ? 'fill-current' : ''}`} />
                        </button>

                        {/* Delete Button */}
                        <button
                          onClick={() => handleDeleteClick(track)}
                          className="w-10 flex items-center justify-center text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                          title="Delete track"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Non-virtualized list for smaller libraries */
            <div className="divide-y divide-zinc-800/30">
              {filteredTracks.map((track) => (
                <div
                  key={track.id}
                  className={`grid grid-cols-[auto_1fr_1fr_100px_120px_auto_auto] gap-4 px-4 py-3 items-center hover:bg-zinc-800/30 transition-colors group ${
                    isTrackPlaying(track) ? 'bg-zinc-800/50' : ''
                  }`}
                >
                  {/* Checkbox */}
                  <button
                    onClick={() => toggleTrackSelection(track.id)}
                    className="w-8 flex items-center justify-center text-zinc-500 hover:text-white transition-colors"
                  >
                    {selectedTracks.has(track.id) ? (
                      <CheckSquare className="w-4 h-4 text-white" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>

                  {/* Title with Play Button */}
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={() => handlePlayTrack(track)}
                      className="w-8 h-8 flex-shrink-0 bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-all group-hover:bg-zinc-700"
                    >
                      {isTrackPlaying(track) ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4 ml-0.5" />
                      )}
                    </button>
                    <span className={`truncate ${isTrackPlaying(track) ? 'text-white font-medium' : 'text-zinc-300'}`}>
                      {track.title}
                    </span>
                  </div>

                  {/* Artist */}
                  <span className="text-zinc-500 truncate">{track.artist || 'Unknown Artist'}</span>

                  {/* Duration */}
                  <span className="text-zinc-500 text-right tabular-nums">
                    {formatDuration(track.duration)}
                  </span>

                  {/* Date Added */}
                  <span className="text-zinc-600 text-sm">{formatDate(track.createdAt)}</span>

                  {/* Favorite Button */}
                  <button
                    onClick={() => toggleFavorite(track)}
                    className={`w-8 flex items-center justify-center transition-all duration-200 ${
                      isFavorited(track.id)
                        ? 'text-pink-500 hover:text-pink-400'
                        : 'text-zinc-600 hover:text-pink-500 opacity-0 group-hover:opacity-100'
                    }`}
                    title={isFavorited(track.id) ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
                  >
                    <Heart className={`w-4 h-4 ${isFavorited(track.id) ? 'fill-current' : ''}`} />
                  </button>

                  {/* Delete Button */}
                  <button
                    onClick={() => handleDeleteClick(track)}
                    className="w-10 flex items-center justify-center text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    title="Delete track"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* No Results */}
          {filteredTracks.length === 0 && searchQuery && (
            <div className="py-12 text-center text-zinc-500">
              <p>No tracks found matching "{searchQuery}"</p>
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 pb-28">
          <div className="bg-[#111111] border border-zinc-800 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
            <h3 className="text-lg font-medium text-white mb-2">
              {trackToDelete ? 'Delete Track' : `Delete ${selectedTracks.size} Tracks`}
            </h3>
            <p className="text-zinc-400 text-sm mb-6">
              {trackToDelete
                ? `Are you sure you want to delete "${trackToDelete.title}"? This will also remove it from all playlists.`
                : `Are you sure you want to delete ${selectedTracks.size} tracks? This will also remove them from all playlists.`}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setTrackToDelete(null);
                }}
                className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={trackToDelete ? handleConfirmDelete : handleBulkDelete}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Detection Modal */}
      <DuplicateModal
        isOpen={showDuplicateModal}
        duplicates={duplicateItems}
        onClose={handleDuplicateCancel}
        onConfirm={handleDuplicateConfirm}
      />

      {/* Import Progress Modal */}
      <ImportProgressModal
        isOpen={isUploading}
        current={uploadProgress.current}
        total={uploadProgress.total}
        currentFileName={uploadProgress.currentFile}
        completed={uploadProgress.completed}
        skipped={uploadProgress.skipped}
        onCancel={handleCancelImport}
      />
    </DropZone>
  );
};

export default LibraryView;
