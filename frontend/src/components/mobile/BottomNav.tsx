import { Home, Library, Search, ListMusic, Settings, Heart } from 'lucide-react';
import { Page } from '@/types';
import { navigate, useRoute } from '@/utils/router';

const TABS: { id: Page; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'liked', label: 'Liked', icon: Heart },
  { id: 'playlists', label: 'Playlists', icon: ListMusic },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function BottomNav() {
  const { page } = useRoute();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-[#0c0c0c]/95 backdrop-blur-md border-t border-zinc-800/40 z-50 flex"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active =
          page === id ||
          (id === 'playlists' && page === 'playlist-detail') ||
          (id === 'settings' && page === 'admin') ||
          (id === 'library' && page === 'albums');
        return (
          <button
            key={id}
            onClick={() => navigate(id)}
            aria-current={active ? 'page' : undefined}
            className={`relative flex-1 flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] transition-colors active:opacity-60 ${
              active ? 'text-white' : 'text-zinc-600'
            }`}
          >
            <span
              className={`absolute top-0 left-1/2 -translate-x-1/2 h-0.5 rounded-b-full bg-white transition-all duration-200 ${
                active ? 'w-5 opacity-100' : 'w-0 opacity-0'
              }`}
            />
            <Icon className={`w-5 h-5 transition-transform duration-200 ${active ? 'scale-100' : 'scale-90'}`} />
            <span className={`text-[10px] font-medium transition-colors ${active ? 'text-white' : 'text-zinc-600'}`}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
