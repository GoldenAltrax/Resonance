import { useState, useEffect, FormEvent } from 'react';
import { Users, Music, ListMusic, Ticket, Plus, Trash2, Copy, Check, X, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react';
import { api, AdminStats, AdminUser, InviteCode } from '@/services/api';
import { toast } from '@/stores/toastStore';

const AdminView = () => {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'invites'>('overview');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Create invite code form state
  const [newCodeCustom, setNewCodeCustom] = useState('');
  const [newCodeMaxUses, setNewCodeMaxUses] = useState<string>('');
  const [isCreating, setIsCreating] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [statsData, usersData, codesData] = await Promise.all([
        api.getAdminStats(),
        api.getAdminUsers(),
        api.getInviteCodes(),
      ]);
      setStats(statsData);
      setUsers(usersData);
      setInviteCodes(codesData);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load admin data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success('Code copied to clipboard');
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleCreateCode = async (e: FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const newCode = await api.createInviteCode({
        code: newCodeCustom || undefined,
        maxUses: newCodeMaxUses ? parseInt(newCodeMaxUses) : null,
      });
      setInviteCodes([newCode, ...inviteCodes]);
      setShowCreateModal(false);
      setNewCodeCustom('');
      setNewCodeMaxUses('');
      toast.success('Invite code created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create invite code');
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleCode = async (code: InviteCode) => {
    try {
      const updated = await api.updateInviteCode(code.id, { isActive: !code.isActive });
      setInviteCodes(inviteCodes.map(c => c.id === code.id ? updated : c));
      toast.success(`Code ${updated.isActive ? 'enabled' : 'disabled'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update code');
    }
  };

  const handleDeleteCode = async (id: string) => {
    try {
      await api.deleteInviteCode(id);
      setInviteCodes(inviteCodes.filter(c => c.id !== id));
      toast.success('Invite code deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete code');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-3 text-zinc-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Loading admin panel...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-amber-500 uppercase tracking-widest mb-1">Administration</h2>
          <h1 className="text-4xl font-semibold text-white tracking-tight">Admin Panel</h1>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 transition-all"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </header>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-8 border-b border-zinc-800 pb-4">
        {(['overview', 'users', 'invites'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
              activeTab === tab
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-500 hover:text-white hover:bg-zinc-800/50'
            }`}
          >
            {tab === 'overview' ? 'Overview' : tab === 'users' ? 'Users' : 'Invite Codes'}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && stats && (
        <div className="space-y-8">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
                  <Users className="w-6 h-6 text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{stats.users}</p>
                  <p className="text-sm text-zinc-500">Total Users</p>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                  <Music className="w-6 h-6 text-green-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{stats.tracks}</p>
                  <p className="text-sm text-zinc-500">Total Tracks</p>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center">
                  <ListMusic className="w-6 h-6 text-purple-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{stats.playlists}</p>
                  <p className="text-sm text-zinc-500">Total Playlists</p>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
                  <Ticket className="w-6 h-6 text-amber-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{stats.activeInviteCodes}</p>
                  <p className="text-sm text-zinc-500">Active Invites</p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-2xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Quick Actions</h3>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => { setActiveTab('invites'); setShowCreateModal(true); }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-all"
              >
                <Plus className="w-4 h-4" />
                Create Invite Code
              </button>
              <button
                onClick={() => setActiveTab('users')}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-all"
              >
                <Users className="w-4 h-4" />
                View All Users
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-zinc-800/50">
            <h3 className="text-lg font-semibold text-white">All Users ({users.length})</h3>
          </div>
          <div className="divide-y divide-zinc-800/50">
            {users.map((u) => (
              <div key={u.id} className="p-4 flex items-center justify-between hover:bg-zinc-800/20 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-800">
                    <img
                      src={u.profileImage
                        ? (u.profileImage.startsWith('http') ? u.profileImage : `/uploads/${u.profileImage}`)
                        : `https://api.dicebear.com/7.x/initials/svg?seed=${u.username}`
                      }
                      alt={u.username}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <p className="font-medium text-white">{u.username}</p>
                    <p className="text-sm text-zinc-500">{u.email || 'No email'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-center">
                    <p className="text-white font-medium">{u.trackCount}</p>
                    <p className="text-zinc-600 text-xs">Tracks</p>
                  </div>
                  <div className="text-center">
                    <p className="text-white font-medium">{u.playlistCount}</p>
                    <p className="text-zinc-600 text-xs">Playlists</p>
                  </div>
                  <div className="text-center min-w-[100px]">
                    <p className="text-zinc-400 text-xs">Joined {formatDate(u.createdAt)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite Codes Tab */}
      {activeTab === 'invites' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-white">Invite Codes ({inviteCodes.length})</h3>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-all"
            >
              <Plus className="w-4 h-4" />
              Create Code
            </button>
          </div>

          <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-2xl overflow-hidden">
            <div className="divide-y divide-zinc-800/50">
              {inviteCodes.length === 0 ? (
                <div className="p-8 text-center text-zinc-500">
                  No invite codes yet. Create one to get started.
                </div>
              ) : (
                inviteCodes.map((code) => (
                  <div key={code.id} className="p-4 flex items-center justify-between hover:bg-zinc-800/20 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className={`w-3 h-3 rounded-full ${code.isActive ? 'bg-green-500' : 'bg-zinc-600'}`} />
                      <div>
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-lg text-white bg-zinc-800 px-3 py-1 rounded-lg">
                            {code.code}
                          </code>
                          <button
                            onClick={() => handleCopyCode(code.code)}
                            className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all"
                          >
                            {copiedCode === code.code ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </div>
                        <p className="text-sm text-zinc-500 mt-1">
                          Created {formatDate(code.createdAt)}
                          {code.expiresAt && ` · Expires ${formatDate(code.expiresAt)}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-center">
                        <p className="text-white font-medium">
                          {code.usedCount}{code.maxUses ? `/${code.maxUses}` : ''}
                        </p>
                        <p className="text-zinc-600 text-xs">Uses</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleToggleCode(code)}
                          className={`p-2 rounded-lg transition-all ${
                            code.isActive
                              ? 'text-green-400 hover:bg-green-500/20'
                              : 'text-zinc-500 hover:bg-zinc-700'
                          }`}
                          title={code.isActive ? 'Disable' : 'Enable'}
                        >
                          {code.isActive ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                        </button>
                        <button
                          onClick={() => handleDeleteCode(code.id)}
                          className="p-2 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/20 transition-all"
                          title="Delete"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Invite Code Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 pb-28">
          <div className="bg-[#111111] border border-zinc-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-white">Create Invite Code</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCode} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-widest text-zinc-600 font-semibold px-1">
                  Custom Code <span className="text-zinc-700">(optional)</span>
                </label>
                <input
                  type="text"
                  value={newCodeCustom}
                  onChange={(e) => setNewCodeCustom(e.target.value.toUpperCase())}
                  placeholder="Leave empty for auto-generated"
                  className="w-full bg-[#161616] border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-600 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs uppercase tracking-widest text-zinc-600 font-semibold px-1">
                  Max Uses <span className="text-zinc-700">(optional)</span>
                </label>
                <input
                  type="number"
                  min="1"
                  value={newCodeMaxUses}
                  onChange={(e) => setNewCodeMaxUses(e.target.value)}
                  placeholder="Unlimited"
                  className="w-full bg-[#161616] border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                />
                <p className="text-[10px] text-zinc-600 px-1">Leave empty for unlimited uses</p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30 transition-colors disabled:opacity-50"
                >
                  {isCreating ? 'Creating...' : 'Create Code'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminView;
