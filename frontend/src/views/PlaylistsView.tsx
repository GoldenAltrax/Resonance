import { useState, useRef, FormEvent } from 'react';
import { Plus, X, Upload, MoreVertical, Play, Loader2, Edit2, Trash2, Image } from 'lucide-react';
import { usePlaylistStore } from '@/stores/playlistStore';
import { Playlist } from '@/services/api';

interface PlaylistsViewProps {
  onPlaylistClick: (id: string) => void;
}

const PlaylistsView = ({ onPlaylistClick }: PlaylistsViewProps) => {
  const { playlists, isLoading, createPlaylist, updatePlaylist, deletePlaylist, uploadPlaylistCover } = usePlaylistStore();
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [playlistToDelete, setPlaylistToDelete] = useState<Playlist | null>(null);
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [createCoverFile, setCreateCoverFile] = useState<File | null>(null);
  const [createCoverPreview, setCreateCoverPreview] = useState<string | null>(null);
  const createCoverInputRef = useRef<HTMLInputElement>(null);
  const editCoverInputRef = useRef<HTMLInputElement>(null);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsCreating(true);
    try {
      const newPlaylist = await createPlaylist(name.trim(), desc.trim() || undefined);

      // Upload cover image if selected
      if (createCoverFile && newPlaylist?.id) {
        await uploadPlaylistCover(newPlaylist.id, createCoverFile);
      }

      setShowModal(false);
      setName('');
      setDesc('');
      setCreateCoverFile(null);
      setCreateCoverPreview(null);
    } catch {
      // Error handled by store
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateCoverClick = () => {
    createCoverInputRef.current?.click();
  };

  const handleCreateCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCreateCoverFile(file);
    // Create preview URL
    const previewUrl = URL.createObjectURL(file);
    setCreateCoverPreview(previewUrl);
  };

  const handleCloseCreateModal = () => {
    setShowModal(false);
    setName('');
    setDesc('');
    setCreateCoverFile(null);
    if (createCoverPreview) {
      URL.revokeObjectURL(createCoverPreview);
    }
    setCreateCoverPreview(null);
  };

  const handleEdit = (playlist: Playlist, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPlaylist(playlist);
    setName(playlist.name);
    setDesc(playlist.description || '');
    setActiveMenu(null);
    setShowEditModal(true);
  };

  const handleEditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingPlaylist || !name.trim()) return;

    setIsSaving(true);
    try {
      await updatePlaylist(editingPlaylist.id, {
        name: name.trim(),
        description: desc.trim() || undefined,
      });
      setShowEditModal(false);
      setEditingPlaylist(null);
      setName('');
      setDesc('');
    } catch {
      // Error handled by store
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClick = (playlist: Playlist, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveMenu(null);
    setPlaylistToDelete(playlist);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (playlistToDelete) {
      try {
        await deletePlaylist(playlistToDelete.id);
      } catch {
        // Error handled by store
      }
    }
    setShowDeleteConfirm(false);
    setPlaylistToDelete(null);
  };

  const handleCoverUpload = async (playlistId: string, file: File) => {
    try {
      await uploadPlaylistCover(playlistId, file);
    } catch {
      // Error handled by store
    }
  };

  const handleEditCoverClick = (e: React.MouseEvent) => {
    e.preventDefault();
    editCoverInputRef.current?.click();
  };

  const handleEditCoverChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingPlaylist) return;
    await handleCoverUpload(editingPlaylist.id, file);
  };

  const toggleMenu = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveMenu(activeMenu === id ? null : id);
  };

  // Resolve cover image URL with cache-busting for local images
  const getCoverUrl = (playlist: Playlist) => {
    if (playlist.coverImage) {
      return playlist.coverImage.startsWith('http')
        ? playlist.coverImage
        : `/uploads/${playlist.coverImage}?t=${Date.now()}`;
    }
    return `https://picsum.photos/seed/${playlist.id}/400/400`;
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-12">
        <div>
          <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-widest mb-1">Collection</h2>
          <h1 className="text-4xl font-semibold text-white tracking-tight">Your Playlists</h1>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-zinc-100 hover:bg-white text-black font-medium px-6 py-3 rounded-xl transition-all flex items-center gap-2 shadow-lg"
        >
          <Plus className="w-5 h-5" />
          Create Playlist
        </button>
      </div>

      {isLoading && playlists.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-zinc-500 animate-spin" />
        </div>
      ) : playlists.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-zinc-500 text-lg mb-4">No playlists yet</p>
          <p className="text-zinc-600 text-sm">Create your first playlist to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {playlists.map((pl) => (
            <div
              key={pl.id}
              onClick={() => onPlaylistClick(pl.id)}
              className="group cursor-pointer bg-zinc-900/20 border border-zinc-800/30 p-5 rounded-3xl hover:bg-zinc-800/40 transition-all duration-500"
            >
              <div className="aspect-square rounded-2xl overflow-hidden mb-6 relative">
                <img
                  src={getCoverUrl(pl)}
                  alt={pl.name}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <div className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center transform scale-90 group-hover:scale-100 transition-transform duration-300">
                    <Play className="w-5 h-5 fill-black" />
                  </div>
                </div>
              </div>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-medium text-white group-hover:text-zinc-100 transition-colors line-clamp-1">
                    {pl.name}
                  </h3>
                  <p className="text-xs text-zinc-500 mt-1 line-clamp-1">
                    {pl.description || 'No description'}
                  </p>
                </div>
                <div className="relative">
                  <button
                    onClick={(e) => toggleMenu(pl.id, e)}
                    className="text-zinc-600 hover:text-white transition-colors p-1"
                  >
                    <MoreVertical className="w-5 h-5" />
                  </button>

                  {activeMenu === pl.id && (
                    <div className="absolute right-0 top-8 z-10 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl py-1 min-w-[140px]">
                      <button
                        onClick={(e) => handleEdit(pl, e)}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                        Edit
                      </button>
                      <button
                        onClick={(e) => handleDeleteClick(pl, e)}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-zinc-800 hover:text-red-300 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pb-28 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-xl bg-[#111111] border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl max-h-[80vh] overflow-y-auto">
            <div className="p-8 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-white tracking-tight">Create Playlist</h2>
              <button
                onClick={handleCloseCreateModal}
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-8 space-y-6">
              <div className="flex flex-col md:flex-row gap-8">
                <div className="flex-shrink-0">
                  <div
                    onClick={handleCreateCoverClick}
                    className="w-48 h-48 bg-zinc-900 rounded-2xl border-2 border-dashed border-zinc-800 hover:border-zinc-700 transition-colors relative group overflow-hidden flex flex-col items-center justify-center cursor-pointer"
                  >
                    {createCoverPreview ? (
                      <>
                        <img
                          src={createCoverPreview}
                          alt="Cover preview"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center">
                          <Image className="w-8 h-8 text-white mb-2" />
                          <span className="text-[10px] text-white uppercase tracking-widest font-bold">
                            Change Image
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <Upload className="w-8 h-8 text-zinc-600 mb-2" />
                        <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">
                          Cover Image
                        </span>
                        <span className="text-[10px] text-zinc-700 mt-1">(Optional)</span>
                      </>
                    )}
                  </div>
                  <input
                    ref={createCoverInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleCreateCoverChange}
                    className="hidden"
                  />
                </div>

                <div className="flex-1 space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold px-1">
                      Name
                    </label>
                    <input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="My Awesome Mix"
                      className="w-full bg-[#161616] border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-1 focus:ring-zinc-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold px-1">
                      Description
                    </label>
                    <textarea
                      value={desc}
                      onChange={(e) => setDesc(e.target.value)}
                      placeholder="A short story about this music..."
                      rows={3}
                      className="w-full bg-[#161616] border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-1 focus:ring-zinc-600 resize-none"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  type="submit"
                  disabled={isCreating}
                  className="bg-zinc-100 hover:bg-white text-black font-semibold px-8 py-3 rounded-xl transition-all shadow-lg disabled:opacity-50 flex items-center gap-2"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && editingPlaylist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pb-28 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-xl bg-[#111111] border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl max-h-[80vh] overflow-y-auto">
            <div className="p-8 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-white tracking-tight">Edit Playlist</h2>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingPlaylist(null);
                }}
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-8 space-y-6">
              <div className="flex flex-col md:flex-row gap-8">
                <div className="flex-shrink-0">
                  <div
                    onClick={handleEditCoverClick}
                    className="w-48 h-48 bg-zinc-900 rounded-2xl border-2 border-dashed border-zinc-800 hover:border-zinc-700 transition-colors relative group overflow-hidden cursor-pointer"
                  >
                    <img
                      src={getCoverUrl(editingPlaylist)}
                      alt={editingPlaylist.name}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center">
                      <Image className="w-8 h-8 text-white mb-2" />
                      <span className="text-[10px] text-white uppercase tracking-widest font-bold">
                        Change Cover
                      </span>
                    </div>
                  </div>
                  <input
                    ref={editCoverInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleEditCoverChange}
                    className="hidden"
                  />
                </div>

                <div className="flex-1 space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold px-1">
                      Name
                    </label>
                    <input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="My Awesome Mix"
                      className="w-full bg-[#161616] border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-1 focus:ring-zinc-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold px-1">
                      Description
                    </label>
                    <textarea
                      value={desc}
                      onChange={(e) => setDesc(e.target.value)}
                      placeholder="A short story about this music..."
                      rows={3}
                      className="w-full bg-[#161616] border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-1 focus:ring-zinc-600 resize-none"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingPlaylist(null);
                  }}
                  className="flex-1 px-4 py-3 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white hover:border-zinc-700 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 bg-zinc-100 hover:bg-white text-black font-semibold px-8 py-3 rounded-xl transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && playlistToDelete && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 pb-28">
          <div className="bg-[#111111] border border-zinc-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-medium text-white mb-2">Delete Playlist</h3>
            <p className="text-zinc-400 text-sm mb-6">
              Are you sure you want to delete "{playlistToDelete.name}"? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setPlaylistToDelete(null);
                }}
                className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Click outside to close menu */}
      {activeMenu && (
        <div className="fixed inset-0 z-0" onClick={() => setActiveMenu(null)} />
      )}
    </div>
  );
};

export default PlaylistsView;
