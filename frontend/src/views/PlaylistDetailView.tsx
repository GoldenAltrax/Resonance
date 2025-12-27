import { useEffect, useRef, useState, ChangeEvent, useCallback, useMemo } from 'react';
import { Play, Shuffle, Clock, Loader2, Plus, FolderOpen, Music, ArrowUpDown, Check, X, Trash2, ListPlus } from 'lucide-react';
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
} from '@dnd-kit/sortable';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useAuthStore } from '@/stores/authStore';
import { Track, api } from '@/services/api';
import { toast } from '@/stores/toastStore';
import LibraryPickerModal from '@/components/LibraryPickerModal';
import DuplicateModal, { DuplicateItem, DuplicateAction } from '@/components/ui/DuplicateModal';
import ImportProgressModal from '@/components/ui/ImportProgressModal';
import DropZone from '@/components/ui/DropZone';
import SortableTrackRow from '@/components/ui/SortableTrackRow';

// File size limits
const MAX_TRACK_SIZE = 50 * 1024 * 1024; // 50MB

type SortOption = 'default' | 'title-asc' | 'title-desc' | 'artist' | 'duration' | 'date-added';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'default', label: 'Custom Order' },
  { value: 'title-asc', label: 'Title (A-Z)' },
  { value: 'title-desc', label: 'Title (Z-A)' },
  { value: 'artist', label: 'Artist' },
  { value: 'duration', label: 'Duration' },
  { value: 'date-added', label: 'Date Added' },
];

interface PlaylistDetailViewProps {
  playlistId: string;
}

const PlaylistDetailView = ({ playlistId }: PlaylistDetailViewProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, completed: 0, skipped: 0, currentFile: '' });
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateItems, setDuplicateItems] = useState<DuplicateItem[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState<Track | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('default');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());
  const [showBulkPlaylistPicker, setShowBulkPlaylistPicker] = useState(false);

  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin ?? false;

  const {
    currentPlaylist,
    playlists,
    isLoading,
    fetchPlaylist,
    uploadTrack,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    deleteTrack,
    reorderPlaylistTracks,
  } = usePlaylistStore();

  // Drag and drop sensors
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
  const { play, currentTrack, isPlaying } = usePlayerStore();

  useEffect(() => {
    fetchPlaylist(playlistId);
  }, [playlistId, fetchPlaylist]);

  // Helper to extract title from filename
  const getTitleFromFilename = (filename: string): string => {
    return filename.replace(/\.[^/.]+$/, '');
  };

  // Process files after duplicate check/resolution
  const processFiles = useCallback(async (
    files: File[],
    duplicateActions: Map<string, { action: DuplicateAction; existingTrackId: string }>
  ) => {
    cancelRef.current = false;
    setIsImporting(true);
    setImportProgress({ current: 0, total: files.length, completed: 0, skipped: 0, currentFile: '' });

    let completed = 0;
    let skipped = 0;

    for (let i = 0; i < files.length; i++) {
      if (cancelRef.current) break;

      const file = files[i];
      if (!file) continue;

      setImportProgress((prev) => ({ ...prev, current: i, currentFile: file.name }));

      const title = getTitleFromFilename(file.name);
      const actionInfo = duplicateActions.get(title.toLowerCase());

      if (actionInfo) {
        if (actionInfo.action === 'skip') {
          skipped++;
          setImportProgress((prev) => ({ ...prev, current: i + 1, skipped }));
          continue;
        } else if (actionInfo.action === 'replace') {
          try {
            await deleteTrack(actionInfo.existingTrackId, true); // silent mode
            const track = await uploadTrack(file, true); // silent mode
            await addTrackToPlaylist(playlistId, track.id, true); // silent mode
            completed++;
          } catch {
            skipped++;
          }
        } else {
          try {
            const track = await uploadTrack(file, true); // silent mode
            await addTrackToPlaylist(playlistId, track.id, true); // silent mode
            completed++;
          } catch {
            skipped++;
          }
        }
      } else {
        try {
          const track = await uploadTrack(file, true); // silent mode
          await addTrackToPlaylist(playlistId, track.id, true); // silent mode
          completed++;
        } catch {
          skipped++;
        }
      }
      setImportProgress((prev) => ({ ...prev, current: i + 1, completed, skipped }));
    }

    // Refresh playlist once at the end
    await fetchPlaylist(playlistId);

    setIsImporting(false);
    setImportProgress({ current: 0, total: 0, completed: 0, skipped: 0, currentFile: '' });
    setPendingFiles([]);
    setShowAddMenu(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [deleteTrack, uploadTrack, addTrackToPlaylist, playlistId, fetchPlaylist]);

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);

    // Validate file sizes (50MB max per track)
    const oversizedFiles = fileArray.filter((file) => file.size > MAX_TRACK_SIZE);
    if (oversizedFiles.length > 0) {
      const names = oversizedFiles.slice(0, 3).map((f) => f.name).join(', ');
      toast.error(`Files too large (max 50MB): ${names}${oversizedFiles.length > 3 ? ` and ${oversizedFiles.length - 3} more` : ''}`);
      const validFiles = fileArray.filter((file) => file.size <= MAX_TRACK_SIZE);
      if (validFiles.length === 0) {
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      fileArray.length = 0;
      fileArray.push(...validFiles);
    }

    const trackMeta = fileArray.map((file) => ({
      title: getTitleFromFilename(file.name),
      artist: null as string | null,
    }));

    try {
      const result = await api.checkDuplicates(trackMeta);

      if (result.duplicates.length > 0) {
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
        await processFiles(fileArray, new Map());
      }
    } catch {
      await processFiles(fileArray, new Map());
    }
  };

  const handleDuplicateConfirm = async (items: DuplicateItem[]) => {
    setShowDuplicateModal(false);
    const duplicateActions = new Map<string, { action: DuplicateAction; existingTrackId: string }>();
    for (const item of items) {
      duplicateActions.set(item.title.toLowerCase(), {
        action: item.action,
        existingTrackId: item.existingTrackId,
      });
    }
    await processFiles(pendingFiles, duplicateActions);
  };

  const handleDuplicateCancel = () => {
    setShowDuplicateModal(false);
    setPendingFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleCancelImport = () => {
    cancelRef.current = true;
  };

  const handleAddFromLibrary = async (trackIds: string[]) => {
    cancelRef.current = false;
    setIsImporting(true);
    setImportProgress({ current: 0, total: trackIds.length, completed: 0, skipped: 0, currentFile: '' });

    let completed = 0;
    let skipped = 0;

    for (let i = 0; i < trackIds.length; i++) {
      if (cancelRef.current) break;

      const trackId = trackIds[i];
      if (!trackId) continue;

      setImportProgress((prev) => ({ ...prev, current: i, currentFile: 'Adding track...' }));

      try {
        await addTrackToPlaylist(playlistId, trackId, true); // silent mode
        completed++;
      } catch {
        skipped++;
      }
      setImportProgress((prev) => ({ ...prev, current: i + 1, completed, skipped }));
    }

    // Refresh playlist once at the end
    await fetchPlaylist(playlistId);

    setIsImporting(false);
    setImportProgress({ current: 0, total: 0, completed: 0, skipped: 0, currentFile: '' });
  };

  const handlePlayTrack = (track: Track, index: number) => {
    const tracks = currentPlaylist?.tracks || [];
    // Play the selected track and set the queue to all tracks starting from this one
    play(track, tracks.slice(index).concat(tracks.slice(0, index)));
  };

  const handlePlayAll = () => {
    const tracks = currentPlaylist?.tracks || [];
    if (tracks.length > 0 && tracks[0]) {
      play(tracks[0], tracks);
    }
  };

  const handleShuffle = () => {
    const tracks = currentPlaylist?.tracks || [];
    if (tracks.length > 0) {
      const shuffled = [...tracks].sort(() => Math.random() - 0.5);
      if (shuffled[0]) {
        play(shuffled[0], shuffled);
      }
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getTotalDuration = (): string => {
    const tracks = currentPlaylist?.tracks || [];
    const totalSeconds = tracks.reduce((sum, t) => sum + t.duration, 0);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      const remainingMins = mins % 60;
      return `${hours} hr ${remainingMins} min`;
    }
    return `${mins} min ${secs} sec`;
  };

  // Resolve cover image URL with cache-busting for local images
  const getCoverUrl = () => {
    if (currentPlaylist?.coverImage) {
      return currentPlaylist.coverImage.startsWith('http')
        ? currentPlaylist.coverImage
        : `/uploads/${currentPlaylist.coverImage}?t=${Date.now()}`;
    }
    return `https://picsum.photos/seed/${currentPlaylist?.id}/400/400`;
  };

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

  // Handle removing track from playlist
  const handleRemoveFromPlaylist = async (trackId: string) => {
    await removeTrackFromPlaylist(playlistId, trackId);
  };

  // Handle adding track to another playlist
  const handleAddToOtherPlaylist = async (track: Track, targetPlaylistId: string) => {
    try {
      await addTrackToPlaylist(targetPlaylistId, track.id);
      toast.success(`Added to playlist`);
    } catch {
      toast.error('Failed to add to playlist');
    }
    setShowPlaylistPicker(null);
  };

  // Bulk selection handlers
  const toggleTrackSelection = (trackId: string) => {
    setSelectedTracks((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  };

  const selectAllTracks = () => {
    setSelectedTracks(new Set(tracks.map((t) => t.id)));
  };

  const clearSelection = () => {
    setSelectedTracks(new Set());
  };

  const handleBulkRemove = async () => {
    const count = selectedTracks.size;
    for (const trackId of selectedTracks) {
      await removeTrackFromPlaylist(playlistId, trackId);
    }
    clearSelection();
    toast.success(`Removed ${count} tracks from playlist`);
  };

  const handleBulkAddToPlaylist = async (targetPlaylistId: string) => {
    let added = 0;
    for (const trackId of selectedTracks) {
      try {
        await addTrackToPlaylist(targetPlaylistId, trackId, true);
        added++;
      } catch {
        // Skip duplicates
      }
    }
    setShowBulkPlaylistPicker(false);
    clearSelection();
    toast.success(`Added ${added} tracks to playlist`);
  };

  // Handle drag end for reordering tracks
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const tracks = currentPlaylist?.tracks || [];
      const oldIndex = tracks.findIndex((t) => t.id === active.id);
      const newIndex = tracks.findIndex((t) => t.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        // Create new order
        const newTracks = [...tracks];
        const removed = newTracks.splice(oldIndex, 1)[0];
        if (removed) {
          newTracks.splice(newIndex, 0, removed);

          // Get new track IDs in order
          const newTrackIds = newTracks.map((t) => t.id);

          // Save to server
          await reorderPlaylistTracks(playlistId, newTrackIds);
        }
      }
    }
  }, [currentPlaylist?.tracks, playlistId, reorderPlaylistTracks]);

  // Get tracks with optional sorting
  const rawTracks = currentPlaylist?.tracks || [];
  const tracks = useMemo(() => {
    if (sortBy === 'default') return rawTracks;

    const sorted = [...rawTracks];
    switch (sortBy) {
      case 'title-asc':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'title-desc':
        sorted.sort((a, b) => b.title.localeCompare(a.title));
        break;
      case 'artist':
        sorted.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
        break;
      case 'duration':
        sorted.sort((a, b) => a.duration - b.duration);
        break;
      case 'date-added':
        sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
    }
    return sorted;
  }, [rawTracks, sortBy]);

  if (isLoading || !currentPlaylist) {
    return (
      <div className="max-w-6xl mx-auto flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-zinc-500 animate-spin" />
      </div>
    );
  }

  return (
    <DropZone
      onFilesDropped={handleFilesDropped}
      accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac"
      className="max-w-6xl mx-auto space-y-10"
      disabled={isImporting || !isAdmin}
    >
      <header className="flex flex-col md:flex-row items-end gap-8 pb-4 border-b border-zinc-900/50">
        <div className="w-64 h-64 bg-zinc-900 rounded-[2.5rem] overflow-hidden shadow-2xl flex-shrink-0">
          <img
            src={getCoverUrl()}
            alt={currentPlaylist.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        </div>
        <div className="flex-1 space-y-4">
          <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 font-bold">Playlist</p>
          <h1 className="text-6xl font-bold text-white tracking-tighter leading-none">
            {currentPlaylist.name}
          </h1>
          <p className="text-zinc-400 text-lg">{currentPlaylist.description || 'No description'}</p>
          <div className="flex items-center gap-2 text-sm text-zinc-500 font-medium">
            <span className="text-zinc-300">Your Library</span>
            <span className="w-1 h-1 rounded-full bg-zinc-700 mx-1" />
            <span>
              {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
              {tracks.length > 0 && `, ${getTotalDuration()}`}
            </span>
          </div>
        </div>
      </header>

      <div className="flex items-center gap-6">
        <button
          onClick={handlePlayAll}
          disabled={tracks.length === 0}
          className="w-16 h-16 bg-white hover:bg-zinc-200 text-black rounded-full flex items-center justify-center transition-all hover:scale-105 shadow-xl disabled:opacity-50 disabled:hover:scale-100"
        >
          <Play className="w-8 h-8 fill-black ml-1" />
        </button>
        <button
          onClick={handleShuffle}
          disabled={tracks.length === 0}
          className="text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
        >
          <Shuffle className="w-7 h-7" />
        </button>

        {/* Sort Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowSortMenu(!showSortMenu)}
            disabled={tracks.length === 0}
            className="flex items-center gap-2 px-4 py-2 text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <ArrowUpDown className="w-5 h-5" />
            <span className="text-sm hidden sm:inline">
              {SORT_OPTIONS.find((o) => o.value === sortBy)?.label || 'Sort'}
            </span>
          </button>
          {showSortMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
              <div className="absolute top-full left-0 mt-2 w-48 bg-[#1a1a1a] border border-zinc-800 rounded-xl shadow-xl z-50 overflow-hidden py-1">
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      setSortBy(option.value);
                      setShowSortMenu(false);
                    }}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                      sortBy === option.value
                        ? 'text-white bg-zinc-800/50'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800/30'
                    }`}
                  >
                    {option.label}
                    {sortBy === option.value && <Check className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {isAdmin && (
          <>
            <div className="relative">
              <button
                onClick={() => setShowAddMenu(!showAddMenu)}
                className="flex items-center gap-2 px-6 py-3 border border-zinc-800 rounded-full text-sm font-medium hover:bg-zinc-900 transition-all text-zinc-300 hover:text-white"
              >
                <Plus className="w-4 h-4" />
                Add Tracks
              </button>

              {/* Dropdown Menu */}
              {showAddMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowAddMenu(false)}
                  />
                  <div className="absolute top-full left-0 mt-2 w-56 bg-[#1a1a1a] border border-zinc-800 rounded-xl shadow-xl z-50 overflow-hidden">
                    <button
                      onClick={() => {
                        fileInputRef.current?.click();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/50 transition-colors text-left"
                    >
                      <FolderOpen className="w-4 h-4 text-zinc-400" />
                      <div>
                        <p className="text-sm text-white">Import from PC</p>
                        <p className="text-xs text-zinc-500">Upload new audio files</p>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        setShowAddMenu(false);
                        setShowLibraryPicker(true);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/50 transition-colors text-left border-t border-zinc-800/50"
                    >
                      <Music className="w-4 h-4 text-zinc-400" />
                      <div>
                        <p className="text-sm text-white">Add from Library</p>
                        <p className="text-xs text-zinc-500">Choose from existing tracks</p>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              multiple
              accept="audio/*"
              onChange={handleFileUpload}
            />
          </>
        )}
      </div>

      <div className="w-full">
        {/* Bulk Selection Bar */}
        {selectedTracks.size > 0 && (
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-800/50 rounded-xl mb-4 border border-zinc-700/50">
            <div className="flex items-center gap-4">
              <button
                onClick={clearSelection}
                className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              <span className="text-sm text-white font-medium">
                {selectedTracks.size} {selectedTracks.size === 1 ? 'track' : 'tracks'} selected
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowBulkPlaylistPicker(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm text-zinc-300 hover:text-white hover:bg-zinc-700/50 rounded-lg transition-colors"
              >
                <ListPlus className="w-4 h-4" />
                Add to Playlist
              </button>
              <button
                onClick={handleBulkRemove}
                className="flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Remove
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-[auto_auto_auto_1fr_1fr_auto_auto] gap-4 px-4 py-3 text-[10px] uppercase tracking-widest text-zinc-600 font-bold border-b border-zinc-900/50">
          {/* Select All Checkbox */}
          <button
            onClick={() => selectedTracks.size === tracks.length ? clearSelection() : selectAllTracks()}
            className="w-5 flex items-center justify-center"
          >
            <div className={`w-4 h-4 rounded border transition-colors ${
              selectedTracks.size === tracks.length && tracks.length > 0
                ? 'bg-white border-white'
                : selectedTracks.size > 0
                  ? 'bg-zinc-600 border-zinc-600'
                  : 'border-zinc-600 hover:border-zinc-400'
            }`}>
              {selectedTracks.size > 0 && (
                <Check className="w-full h-full text-black" />
              )}
            </div>
          </button>
          <span className="w-6" />
          <span className="w-8">#</span>
          <span>Title</span>
          <span className="hidden md:block">Album</span>
          <span className="w-10 flex justify-center">
            <Clock className="w-4 h-4" />
          </span>
          <span className="w-8" />
        </div>

        {tracks.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-zinc-500 text-lg mb-2">No tracks yet</p>
            <p className="text-zinc-600 text-sm">
              Click "Add Tracks" to upload your first song
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={tracks.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="mt-2">
                {tracks.map((track, index) => (
                  <SortableTrackRow
                    key={track.id}
                    track={track}
                    index={index}
                    isCurrentTrack={currentTrack?.id === track.id}
                    isCurrentPlaying={currentTrack?.id === track.id && isPlaying}
                    onPlay={() => handlePlayTrack(track, index)}
                    formatDuration={formatDuration}
                    onRemoveFromPlaylist={() => handleRemoveFromPlaylist(track.id)}
                    onAddToOtherPlaylist={() => setShowPlaylistPicker(track)}
                    playlists={playlists}
                    currentPlaylistId={playlistId}
                    isSelected={selectedTracks.has(track.id)}
                    onSelect={() => toggleTrackSelection(track.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Library Picker Modal */}
      <LibraryPickerModal
        isOpen={showLibraryPicker}
        onClose={() => setShowLibraryPicker(false)}
        playlistId={playlistId}
        existingTrackIds={tracks.map((t) => t.id)}
        onAddTracks={handleAddFromLibrary}
      />

      {/* Duplicate Detection Modal */}
      <DuplicateModal
        isOpen={showDuplicateModal}
        duplicates={duplicateItems}
        onClose={handleDuplicateCancel}
        onConfirm={handleDuplicateConfirm}
      />

      {/* Import Progress Modal */}
      <ImportProgressModal
        isOpen={isImporting}
        current={importProgress.current}
        total={importProgress.total}
        currentFileName={importProgress.currentFile}
        completed={importProgress.completed}
        skipped={importProgress.skipped}
        onCancel={handleCancelImport}
      />

      {/* Playlist Picker Modal */}
      {showPlaylistPicker && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={() => setShowPlaylistPicker(null)}
          >
            <div
              className="bg-[#1a1a1a] rounded-2xl w-full max-w-md overflow-hidden border border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-zinc-800">
                <h2 className="text-xl font-semibold text-white">Add to Playlist</h2>
                <p className="text-sm text-zinc-400 mt-1">
                  Choose a playlist to add "{showPlaylistPicker.title}"
                </p>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {playlists.filter((p) => p.id !== playlistId).length === 0 ? (
                  <div className="p-8 text-center text-zinc-500">
                    No other playlists available
                  </div>
                ) : (
                  playlists
                    .filter((p) => p.id !== playlistId)
                    .map((playlist) => (
                      <button
                        key={playlist.id}
                        onClick={() => handleAddToOtherPlaylist(showPlaylistPicker, playlist.id)}
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
                  onClick={() => setShowPlaylistPicker(null)}
                  className="w-full py-2.5 text-sm text-zinc-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Bulk Add to Playlist Modal */}
      {showBulkPlaylistPicker && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={() => setShowBulkPlaylistPicker(false)}
          >
            <div
              className="bg-[#1a1a1a] rounded-2xl w-full max-w-md overflow-hidden border border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-zinc-800">
                <h2 className="text-xl font-semibold text-white">Add to Playlist</h2>
                <p className="text-sm text-zinc-400 mt-1">
                  Add {selectedTracks.size} tracks to a playlist
                </p>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {playlists.filter((p) => p.id !== playlistId).length === 0 ? (
                  <div className="p-8 text-center text-zinc-500">
                    No other playlists available
                  </div>
                ) : (
                  playlists
                    .filter((p) => p.id !== playlistId)
                    .map((playlist) => (
                      <button
                        key={playlist.id}
                        onClick={() => handleBulkAddToPlaylist(playlist.id)}
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
                  onClick={() => setShowBulkPlaylistPicker(false)}
                  className="w-full py-2.5 text-sm text-zinc-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </DropZone>
  );
};

export default PlaylistDetailView;
