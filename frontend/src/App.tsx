import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useNetworkStore } from '@/stores/networkStore';
import { api } from '@/services/api';
import { useRoute, useMediaQuery } from '@/utils/router';

import SplashView from '@/views/SplashView';
import LandingView from '@/views/LandingView';
import LoginView from '@/views/LoginView';
import SignUpView from '@/views/SignUpView';
import HomeView from '@/views/HomeView';
import Sidebar from '@/components/Sidebar';
import PlayerBar from '@/components/player/PlayerBar';
import { ToastContainer } from '@/components/ui/Toast';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import OfflineBanner from '@/components/OfflineBanner';
import UpdateNotification from '@/components/UpdateNotification';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import BottomNav from '@/components/mobile/BottomNav';
import MobilePlayerBar from '@/components/mobile/MobilePlayerBar';

// Route-level code splitting: only Home ships in the initial bundle.
const LibraryView = lazy(() => import('@/views/LibraryView'));
const LikedSongsView = lazy(() => import('@/views/LikedSongsView'));
const PlaylistsView = lazy(() => import('@/views/PlaylistsView'));
const PlaylistDetailView = lazy(() => import('@/views/PlaylistDetailView'));
const SettingsView = lazy(() => import('@/views/SettingsView'));
const SearchView = lazy(() => import('@/views/SearchView'));
const AdminView = lazy(() => import('@/views/AdminView'));
const AlbumsView = lazy(() => import('@/views/AlbumsView'));
// Panels are only needed once opened
const LyricsPanel = lazy(() => import('@/components/player/LyricsPanel'));
const QueuePanel = lazy(() => import('@/components/player/QueuePanel'));
const EqualizerPanel = lazy(() => import('@/components/player/EqualizerPanel'));
const NowPlayingScreen = lazy(() => import('@/components/mobile/NowPlayingScreen'));
const KeyboardShortcutsModal = lazy(() => import('@/components/ui/KeyboardShortcutsModal'));

type AuthScreen = 'landing' | 'login' | 'signup';

const PageContent = () => {
  const route = useRoute();
  const isAdmin = useAuthStore((s) => s.user?.isAdmin ?? false);
  switch (route.page) {
    case 'library':
      return <LibraryView />;
    case 'liked':
      return <LikedSongsView />;
    case 'playlists':
      return <PlaylistsView />;
    case 'playlist-detail':
      return route.playlistId ? <PlaylistDetailView playlistId={route.playlistId} /> : <PlaylistsView />;
    case 'search':
      return <SearchView />;
    case 'settings':
      return <SettingsView />;
    case 'albums':
      return <AlbumsView />;
    case 'admin':
      return isAdmin ? <AdminView /> : <HomeView />;
    default:
      return <HomeView />;
  }
};

const PageFallback = () => (
  <div className="flex items-center justify-center py-24">
    <LoadingSpinner />
  </div>
);

const App = () => {
  const [authScreen, setAuthScreen] = useState<AuthScreen>('landing');
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showNowPlaying, setShowNowPlaying] = useState(false);
  // Only show the splash while a stored session is being verified (no fixed delay)
  const [isBooting, setIsBooting] = useState(() => !!useAuthStore.getState().token);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const userId = useAuthStore((s) => s.user?.id);
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null);
  const sidePanelOpen = usePlayerStore((s) => s.showLyrics || s.showQueue);
  const showEqualizer = usePlayerStore((s) => s.showEqualizer);
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const route = useRoute();
  const mainRef = useRef<HTMLElement>(null);

  // Audio engine controller — mounted once for the app's lifetime
  useAudioPlayer();
  useKeyboardShortcuts({ onOpenHelp: () => setShowShortcutsModal(true) });

  useEffect(() => useNetworkStore.getState().startMonitoring(), []);

  useEffect(() => {
    if (!useAuthStore.getState().token) return;
    useAuthStore.getState().checkAuth().finally(() => setIsBooting(false));
  }, []);

  // Per-user data: playlists and synced player preferences
  useEffect(() => {
    if (!isAuthenticated || !userId) return;
    usePlaylistStore.getState().fetchPlaylists();
    api.getPreferences(userId)
      .then((prefs) => { if (prefs) usePlayerStore.getState().loadPreferences(prefs); })
      .catch(() => {});
  }, [isAuthenticated, userId]);

  // New page → start at the top (but keep scroll position on back/forward within the same page)
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [route]);

  if (isBooting) {
    return <SplashView />;
  }

  if (!isAuthenticated) {
    if (authScreen === 'signup') {
      return (
        <SignUpView
          onSwitchToLogin={() => setAuthScreen('login')}
          onBack={() => setAuthScreen('landing')}
        />
      );
    }
    if (authScreen === 'login') {
      return (
        <LoginView
          onSwitchToSignup={() => setAuthScreen('signup')}
          onBack={() => setAuthScreen('landing')}
        />
      );
    }
    return (
      <LandingView
        onLogin={() => setAuthScreen('login')}
        onSignUp={() => setAuthScreen('signup')}
      />
    );
  }

  const mobileBottomPadding = hasTrack
    ? 'calc(72px + 56px + env(safe-area-inset-bottom))'
    : 'calc(56px + env(safe-area-inset-bottom))';

  return (
    <ErrorBoundary>
      <div className="flex h-[100dvh] w-full bg-[#0a0a0a] text-zinc-300 select-none overflow-hidden">
        <OfflineBanner />
        <UpdateNotification />
        {isDesktop && <Sidebar />}
        <main
          ref={mainRef}
          className="flex-1 overflow-y-auto relative h-full transition-[margin] duration-300 ease-out"
          style={
            isDesktop
              ? { marginRight: sidePanelOpen ? '400px' : '0', paddingBottom: hasTrack ? '96px' : 0 }
              : { paddingBottom: mobileBottomPadding }
          }
        >
          <div className="absolute inset-0 bg-gradient-to-b from-[#1a1a1a]/20 to-[#0a0a0a] pointer-events-none" />
          <div className={`relative z-10 ${isDesktop ? 'p-6 md:p-10 pb-10' : 'p-4'}`}>
            <ErrorBoundary key={route.page}>
              <Suspense fallback={<PageFallback />}>
                <PageContent />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>

        {isDesktop ? (
          <PlayerBar />
        ) : (
          <>
            <MobilePlayerBar onOpenNowPlaying={() => setShowNowPlaying(true)} />
            <BottomNav />
          </>
        )}

        <Suspense fallback={null}>
          {sidePanelOpen && (
            <>
              <LyricsPanel />
              <QueuePanel />
            </>
          )}
          {showEqualizer && <EqualizerPanel />}
          {!isDesktop && showNowPlaying && (
            <NowPlayingScreen onClose={() => setShowNowPlaying(false)} />
          )}
          {showShortcutsModal && (
            <KeyboardShortcutsModal isOpen onClose={() => setShowShortcutsModal(false)} />
          )}
        </Suspense>
        <ToastContainer />
      </div>
    </ErrorBoundary>
  );
};

export default App;
