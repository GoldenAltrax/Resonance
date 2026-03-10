import { Home, Library, Search, ListMusic, Settings } from 'lucide-react';
import { Page } from '@/types';

const TABS: { id: Page; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'playlists', label: 'Playlists', icon: ListMusic },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface Props {
  activePage: Page;
  onNavigate: (page: Page) => void;
}

export default function BottomNav({ activePage, onNavigate }: Props) {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 bg-[#0d0d0d] border-t border-zinc-800/50 z-50 flex"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = activePage === id || (id === 'playlists' && activePage === 'playlist-detail');
        return (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 min-h-[56px] transition-colors active:opacity-70 ${
              active ? 'text-white' : 'text-zinc-500'
            }`}
          >
            <Icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
