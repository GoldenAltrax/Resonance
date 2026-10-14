import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ListStart, ListEnd, Radio, Heart, ListPlus, Disc3, Trash2, ChevronLeft, ChevronRight, Music } from 'lucide-react';
import { api, type Track } from '@/services/api';
import { useTrackMenuStore } from '@/stores/trackMenuStore';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { toast } from '@/stores/toastStore';
import { navigate, useMediaQuery, useRoute } from '@/utils/router';
import { playlistCoverUrl } from '@/utils/cover';
import { isLongPressTail } from '@/utils/trackMenu';

const EDGE = 8;
/** Placeholder some downloaders write into the album tag; not a real album to open. */
const PLACEHOLDER_ALBUM = /^unknown album$/i;
/** Clicks this soon after opening are the finger lifting from a long-press, not a choice. */
const OPEN_GRACE_MS = 350;

/**
 * The track actions menu (play next, add to queue, radio, like, add to playlist, album).
 * Mounted once in App and opened from any row through useTrackMenu: a positioned menu
 * on desktop, a bottom sheet on phones.
 */
export default function TrackMenu() {
  const track = useTrackMenuStore((s) => s.track);
  const openedAt = useTrackMenuStore((s) => s.openedAt);
  const close = useTrackMenuStore((s) => s.close);
  const route = useRoute();

  // Navigating away closes the menu
  useEffect(() => {
    close();
  }, [route, close]);

  // Keyed per opening, so view and position start fresh each time
  return track ? <MenuPanel key={openedAt} track={track} /> : null;
}

function MenuPanel({ track }: { track: Track }) {
  const { x, y, context, openedAt, byTouch, close } = useTrackMenuStore.getState();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const playlists = usePlaylistStore((s) => s.playlists);
  const liked = useFavoritesStore((s) => s.isFavorited(track.id));
  const menuRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<'main' | 'playlists'>('main');
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Desktop: open at the point, flipped/clamped so it stays on screen
  useLayoutEffect(() => {
    if (!isDesktop || !menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE));
    const top = y + height > window.innerHeight - EDGE ? Math.max(EDGE, y - height) : y;
    setPos({ left, top });
  }, [x, y, isDesktop, view]);

  // Dismiss on outside press, Escape, scroll and resize; arrow keys move between items
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      // The phone backdrop closes on its own click: closing here would unmount it before
      // the tap's click fires, and that click would land on (and play) the row underneath
      if (backdropRef.current?.contains(e.target as Node)) return;
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return close();
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      if (items.length === 0) return;
      e.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? current + 1 : current - 1;
      items[(next + items.length) % items.length]?.focus();
    };
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [close]);

  // Keyboard users land on the first item
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [view, pos]);

  /** The click is the finger lifting from the long-press that opened the menu, not a choice. */
  const isOpeningTap = () => byTouch && (Date.now() - openedAt < OPEN_GRACE_MS || isLongPressTail());

  /** Runs a menu action unless the click is the tail of the long-press that opened the menu. */
  const act = (fn: () => void, keepOpen = false) => () => {
    if (isOpeningTap()) return;
    fn();
    if (!keepOpen) close();
  };

  const player = usePlayerStore.getState();
  const album = track.album?.trim();
  const hasAlbum = !!album && !PLACEHOLDER_ALBUM.test(album);
  const targetPlaylists = playlists.filter((p) => p.id !== context.playlistId);

  const startRadio = async () => {
    try {
      const { similarTracks } = await api.getSimilarTracks(track.id, { limit: 30 });
      player.startRadio(track, similarTracks);
      toast.success(`Radio started from "${track.title}"`);
    } catch {
      toast.error('Couldn\'t start radio');
    }
  };

  const addToPlaylist = (playlistId: string) => {
    // The store shows the success or error toast (including "already in this playlist")
    usePlaylistStore.getState().addTrackToPlaylist(playlistId, track.id).catch(() => {});
  };

  const body =
    view === 'playlists' ? (
      <>
        <Item icon={<ChevronLeft className="w-4 h-4" />} onClick={act(() => setView('main'), true)}>
          Back
        </Item>
        <Divider />
        <div className="max-h-72 overflow-y-auto">
          {targetPlaylists.length === 0 ? (
            <p className="px-4 py-3 text-sm text-zinc-500">No other playlists yet.</p>
          ) : (
            targetPlaylists.map((playlist) => (
              <Item
                key={playlist.id}
                icon={
                  <img src={playlistCoverUrl(playlist)} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />
                }
                onClick={act(() => addToPlaylist(playlist.id))}
              >
                <span className="truncate">{playlist.name}</span>
              </Item>
            ))
          )}
        </div>
      </>
    ) : (
      <>
        <Item icon={<ListStart className="w-4 h-4" />} onClick={act(() => { player.playNext(track); toast.success('Playing next'); })}>
          Play next
        </Item>
        <Item icon={<ListEnd className="w-4 h-4" />} onClick={act(() => { player.addToQueue([track]); toast.success('Added to queue'); })}>
          Add to queue
        </Item>
        <Item icon={<Radio className="w-4 h-4" />} onClick={act(() => void startRadio())}>
          Start radio
        </Item>
        <Divider />
        <Item
          icon={<Heart className={`w-4 h-4 ${liked ? 'fill-pink-500 text-pink-500' : ''}`} />}
          onClick={act(() => void useFavoritesStore.getState().toggleFavorite(track))}
        >
          {liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
        </Item>
        <Item
          icon={<ListPlus className="w-4 h-4" />}
          trailing={<ChevronRight className="w-4 h-4 text-zinc-500" />}
          onClick={act(() => setView('playlists'), true)}
        >
          Add to playlist
        </Item>
        {hasAlbum && (
          <Item icon={<Disc3 className="w-4 h-4" />} onClick={act(() => navigate('albums', album))}>
            Go to album
          </Item>
        )}
        {context.onRemove && (
          <>
            <Divider />
            <Item icon={<Trash2 className="w-4 h-4" />} danger onClick={act(context.onRemove)}>
              Remove from this playlist
            </Item>
          </>
        )}
      </>
    );

  if (!isDesktop) {
    return (
      <div
        ref={backdropRef}
        className="fixed inset-0 z-[70] bg-black/60"
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget && !isOpeningTap()) close();
        }}
      >
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${track.title}`}
          className="absolute inset-x-0 bottom-0 bg-zinc-900 border-t border-zinc-800 rounded-t-2xl pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] animate-slide-up"
        >
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-zinc-700" />
          <div className="flex items-center gap-3 px-4 pb-3 border-b border-zinc-800/70">
            <div className="w-10 h-10 rounded-lg bg-zinc-800 overflow-hidden flex-shrink-0 flex items-center justify-center">
              {track.coverArt ? (
                <img src={api.getTrackCoverUrl(track.coverArt)} alt="" className="w-full h-full object-cover" />
              ) : (
                <Music className="w-4 h-4 text-zinc-600" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{track.title}</p>
              <p className="text-xs text-zinc-500 truncate">{track.artist || 'Unknown Artist'}</p>
            </div>
          </div>
          <div className="py-1">{body}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${track.title}`}
      className="fixed z-[70] min-w-[220px] max-w-[280px] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl py-1"
      // Rendered off-screen for one frame so it can be measured before placement
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {body}
    </div>
  );
}

function Item({ icon, trailing, danger, onClick, children }: {
  icon: ReactNode;
  trailing?: ReactNode;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2.5 md:py-2 text-sm text-left transition-colors outline-none focus-visible:bg-zinc-800 ${
        danger ? 'text-red-400 hover:bg-zinc-800 hover:text-red-300' : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
      }`}
    >
      {icon}
      <span className="flex-1 min-w-0 flex items-center">{children}</span>
      {trailing}
    </button>
  );
}

function Divider() {
  return <div className="h-px bg-zinc-800/60 my-1" />;
}
