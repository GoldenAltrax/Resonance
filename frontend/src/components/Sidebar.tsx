import { useState } from 'react';
import { Home, Library, Search, Settings, Music2, LogOut, Shield, Music, Heart, Disc3, ListMusic, CirclePlus, Sparkles } from 'lucide-react';
import { Page } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { useAssistantStore } from '@/stores/assistantStore';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { navigate, useRoute } from '@/utils/router';

const Sidebar = () => {
  const logout = useAuthStore((s) => s.logout);
  const isAdmin = useAuthStore((s) => s.user?.isAdmin ?? false);
  const assistantOpen = useAssistantStore((s) => s.isOpen);
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null);
  const playlists = usePlaylistStore((s) => s.playlists);
  const { page: activePage, playlistId: activePlaylistId } = useRoute();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleLogoutClick = () => setShowLogoutConfirm(true);

  const handleLogoutConfirm = () => {
    setShowLogoutConfirm(false);
    logout().catch((err) => console.error('Logout failed:', err));
  };

  const navItems = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'library', icon: Music, label: 'Library' },
    { id: 'liked', icon: Heart, label: 'Liked Songs' },
    { id: 'albums', icon: Disc3, label: 'Albums' },
    { id: 'search', icon: Search, label: 'Search' },
    { id: 'playlists', icon: Library, label: 'Playlists' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <aside className="w-64 h-full bg-[#0c0c0c] border-r border-zinc-800/40 flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-6 py-7 flex items-center gap-3">
        <div className="w-9 h-9 bg-gradient-to-br from-zinc-700 to-zinc-900 rounded-xl flex items-center justify-center shadow-lg ring-1 ring-white/5 flex-shrink-0">
          <Music2 className="text-zinc-300 w-4 h-4" />
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-white leading-none">Resonance</h1>
          <p className="text-[9px] uppercase tracking-widest text-zinc-600 mt-0.5">Simply Music</p>
        </div>
      </div>

      {/* Main Nav */}
      <nav className="px-3 py-1 flex flex-col gap-0.5">
        {navItems.map((item) => {
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.id as Page)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex items-center gap-3.5 px-4 py-2.5 rounded-lg transition-all duration-200 group ${
                isActive
                  ? 'bg-zinc-800/70 text-white'
                  : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/30'
              }`}
            >
              {/* Active left indicator */}
              <span
                className={`absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-r-full bg-white transition-opacity duration-200 ${
                  isActive ? 'opacity-100' : 'opacity-0'
                }`}
              />
              <item.icon
                className={`w-4 h-4 flex-shrink-0 transition-all duration-200 ${
                  isActive ? 'text-white' : 'group-hover:scale-105'
                }`}
              />
              <span className="text-sm font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Playlists section */}
      <div className="mt-6 px-6 mb-3 flex items-center gap-2">
        <ListMusic className="w-3 h-3 text-zinc-700" />
        <h2 className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold">Playlists</h2>
        {playlists.length > 0 && (
          <span className="text-[9px] text-zinc-700 tabular-nums">{playlists.length}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="flex flex-col gap-0.5">
          {playlists.length === 0 ? (
            <p className="text-xs text-zinc-700 px-4 py-2">No playlists yet</p>
          ) : (
            playlists.map((pl) => (
              <button
                key={pl.id}
                onClick={() => navigate('playlist-detail', pl.id)}
                className={`text-left px-4 py-2 text-sm transition-all duration-150 truncate rounded-lg hover:bg-zinc-800/30 group ${
                  activePage === 'playlist-detail' && activePlaylistId === pl.id
                    ? 'text-white bg-zinc-800/40'
                    : 'text-zinc-500 hover:text-zinc-200'
                }`}
              >
                {pl.name}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Footer */}
      <div className={`px-3 pt-3 border-t border-zinc-800/40 space-y-0.5 ${hasTrack ? 'pb-28' : 'pb-4'}`}>
        {isAdmin && (
          <button
            onClick={() => useAssistantStore.getState().toggle()}
            aria-pressed={assistantOpen}
            className={`flex items-center gap-3.5 w-full px-4 py-2.5 rounded-lg transition-all duration-200 group text-sm font-medium ${
              assistantOpen
                ? 'bg-zinc-800/70 text-white'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800/30'
            }`}
          >
            <Sparkles className="w-4 h-4 flex-shrink-0" />
            Assistant
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => navigate('add-music')}
            aria-current={activePage === 'add-music' ? 'page' : undefined}
            className={`flex items-center gap-3.5 w-full px-4 py-2.5 rounded-lg transition-all duration-200 group text-sm font-medium ${
              activePage === 'add-music'
                ? 'bg-zinc-800/70 text-white'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800/30'
            }`}
          >
            <CirclePlus className="w-4 h-4 flex-shrink-0" />
            Add music
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => navigate('admin')}
            className={`flex items-center gap-3.5 w-full px-4 py-2.5 rounded-lg transition-all duration-200 group text-sm font-medium ${
              activePage === 'admin'
                ? 'bg-amber-500/15 text-amber-400'
                : 'text-zinc-500 hover:text-amber-400 hover:bg-amber-500/10'
            }`}
          >
            <Shield className="w-4 h-4 flex-shrink-0" />
            Admin Panel
          </button>
        )}
        <button
          onClick={handleLogoutClick}
          className="flex items-center gap-3.5 w-full px-4 py-2.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/8 transition-all duration-200 text-sm font-medium group"
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          Logout
        </button>
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in-fast">
          <div className="bg-[#111] border border-zinc-800/80 rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-scale-in">
            <h3 className="text-base font-semibold text-white mb-1.5">Confirm Logout</h3>
            <p className="text-zinc-400 text-sm mb-6">Are you sure you want to log out?</p>
            <div className="flex gap-2.5">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-700/80 text-zinc-400 hover:text-white hover:border-zinc-600 transition-all text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleLogoutConfirm}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20 transition-all text-sm"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
