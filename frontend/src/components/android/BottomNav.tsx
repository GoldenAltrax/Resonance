import { Home, Library, Search, ListMusic, Settings, Shield, Disc3 } from 'lucide-react';
import { Page } from '@/types';
import { useAuthStore } from '@/stores/authStore';

interface Props {
  activePage: Page;
  onNavigate: (page: Page) => void;
}

export default function BottomNav({ activePage, onNavigate }: Props) {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.isAdmin ?? false;

  const tabs: { id: Page; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'library', label: 'Library', icon: Library },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'playlists', label: 'Playlists', icon: ListMusic },
    { id: 'albums' as Page, label: 'Albums', icon: Disc3 },
    ...(isAdmin ? [{ id: 'admin' as Page, label: 'Admin', icon: Shield }] : []),
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div
      className="fixed bottom-0 left-0 right-0 bg-[#0c0c0c]/95 backdrop-blur-md border-t border-zinc-800/40 z-50 flex"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map(({ id, label, icon: Icon }) => {
        const active = activePage === id || (id === 'playlists' && activePage === 'playlist-detail');
        return (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={`relative flex-1 flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] transition-colors active:opacity-60 ${
              active ? 'text-white' : 'text-zinc-600'
            }`}
          >
            {/* Active top indicator */}
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
    </div>
  );
}
