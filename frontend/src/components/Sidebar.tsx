import { useState } from 'react';
import { Home, Library, Search, Settings, Music2, LogOut, Shield, Music, Heart } from 'lucide-react';
import { Page, Playlist } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { usePlayerStore } from '@/stores/playerStore';

interface SidebarProps {
  activePage: Page;
  setActivePage: (page: Page) => void;
  playlists: Playlist[];
  onPlaylistClick: (id: string) => void;
}

const Sidebar = ({ activePage, setActivePage, playlists, onPlaylistClick }: SidebarProps) => {
  const { logout, user } = useAuthStore();
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Check if current user is admin (from API response)
  const isAdmin = user?.isAdmin ?? false;

  const handleLogoutClick = () => {
    setShowLogoutConfirm(true);
  };

  const handleLogoutConfirm = () => {
    setShowLogoutConfirm(false);
    setIsLoggingOut(true);
    // Show animation for 1.5s before logging out
    setTimeout(() => logout(), 1500);
  };

  // Show logging out animation
  if (isLoggingOut) {
    return (
      <div className="fixed inset-0 z-[100] bg-[#0a0a0a] flex flex-col items-center justify-center animate-in fade-in duration-500">
        <svg className="animate-spin h-10 w-10 text-zinc-500 mb-6" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <h2 className="text-xl font-light text-white tracking-widest uppercase">Logging out...</h2>
      </div>
    );
  }

  // Nav items - Library only visible to admin
  const navItems = [
    { id: 'home', icon: Home, label: 'Home' },
    ...(isAdmin ? [{ id: 'library', icon: Music, label: 'Library' }] : []),
    { id: 'liked', icon: Heart, label: 'Liked Songs' },
    { id: 'search', icon: Search, label: 'Search' },
    { id: 'playlists', icon: Library, label: 'Playlists' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <aside className="w-64 h-full bg-[#0d0d0d] border-r border-zinc-800/50 flex flex-col hidden md:flex">
      <div className="p-8 flex items-center gap-3">
        <div className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center">
          <Music2 className="text-zinc-400 w-5 h-5" />
        </div>
        <div>
          <h1 className="text-lg font-medium tracking-tight text-white">Resonance</h1>
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">Simply Music</p>
        </div>
      </div>

      <nav className="px-4 py-2 flex flex-col gap-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActivePage(item.id as Page)}
            className={`flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-300 group ${
              activePage === item.id 
              ? 'bg-zinc-800/50 text-white' 
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/20'
            }`}
          >
            <item.icon className={`w-5 h-5 transition-transform duration-300 ${activePage === item.id ? 'scale-110' : 'group-hover:scale-110'}`} />
            <span className="text-sm font-medium">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="mt-8 px-8 mb-4">
        <h2 className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold">Your Playlists</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 custom-scrollbar">
        <div className="flex flex-col gap-1">
          {playlists.map((pl) => (
            <button
              key={pl.id}
              onClick={() => onPlaylistClick(pl.id)}
              className="text-left px-4 py-2 text-sm text-zinc-500 hover:text-white transition-colors truncate rounded-lg hover:bg-zinc-800/20"
            >
              {pl.name}
            </button>
          ))}
        </div>
      </div>

      <div className={`p-4 border-t border-zinc-800/50 space-y-2 ${currentTrack ? 'pb-28' : ''}`}>
        {isAdmin && (
          <button
            onClick={() => setActivePage('admin')}
            className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all group ${
              activePage === 'admin'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'text-zinc-500 hover:text-amber-400 hover:bg-amber-500/10'
            }`}
          >
            <Shield className="w-5 h-5 transition-transform group-hover:scale-110" />
            <span className="text-sm font-medium">Admin Panel</span>
          </button>
        )}
        <button
          onClick={handleLogoutClick}
          className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all group"
        >
          <LogOut className="w-5 h-5 transition-transform group-hover:scale-110" />
          <span className="text-sm font-medium">Logout</span>
        </button>
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 pb-28">
          <div className="bg-[#111111] border border-zinc-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-medium text-white mb-2">Confirm Logout</h3>
            <p className="text-zinc-400 text-sm mb-6">Are you sure you want to logout?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLogoutConfirm}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors"
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
