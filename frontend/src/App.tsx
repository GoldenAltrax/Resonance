import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useNetworkStore } from '@/stores/networkStore';
import { useDownloadStore } from '@/stores/downloadStore';
import { api } from '@/services/api';
import { Page } from '@/types';

import SplashView from '@/views/SplashView';
import LandingView from '@/views/LandingView';
import LoginView from '@/views/LoginView';
import SignUpView from '@/views/SignUpView';
import Sidebar from '@/components/Sidebar';
import HomeView from '@/views/HomeView';
import LibraryView from '@/views/LibraryView';
import LikedSongsView from '@/views/LikedSongsView';
import PlaylistsView from '@/views/PlaylistsView';
import PlaylistDetailView from '@/views/PlaylistDetailView';
import SettingsView from '@/views/SettingsView';
import SearchView from '@/views/SearchView';
import AdminView from '@/views/AdminView';
import PlayerBar from '@/components/player/PlayerBar';
import { ToastContainer } from '@/components/ui/Toast';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import KeyboardShortcutsModal from '@/components/ui/KeyboardShortcutsModal';
import OfflineBanner from '@/components/OfflineBanner';
import UpdateNotification from '@/components/UpdateNotification';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { usePlatform } from '@/hooks/usePlatform';
import BottomNav from '@/components/android/BottomNav';
import MobilePlayerBar from '@/components/android/MobilePlayerBar';

type AuthScreen = 'landing' | 'login' | 'signup';

const App = () => {
  const [showSplash, setShowSplash] = useState(true);
  const [authScreen, setAuthScreen] = useState<AuthScreen>('landing');
  const [activePage, setActivePage] = useState<Page>('home');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  const { isAuthenticated, token, checkAuth } = useAuthStore();
  const { playlists, fetchPlaylists } = usePlaylistStore();
  const { currentTrack, showLyrics, showQueue } = usePlayerStore();
  const { startMonitoring } = useNetworkStore();
  const { initCache } = useDownloadStore();
  const { isAndroid } = usePlatform();

  // Enable keyboard shortcuts for player controls
  useKeyboardShortcuts({ onOpenHelp: () => setShowShortcutsModal(true) });

  // Start network monitoring and cache init on mount
  useEffect(() => {
    startMonitoring();
    initCache();
  }, [startMonitoring, initCache]);

  // Handle splash screen
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 4500);
    return () => clearTimeout(timer);
  }, []);

  // Check auth on mount and set API token
  useEffect(() => {
    if (token) {
      api.setToken(token);
      checkAuth();
    }
  }, [token, checkAuth]);

  // Fetch playlists when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchPlaylists();
    }
  }, [isAuthenticated, fetchPlaylists]);

  const navigateToPlaylist = (id: string) => {
    setSelectedPlaylistId(id);
    setActivePage('playlist-detail');
  };

  // Show splash screen
  if (showSplash) {
    return <SplashView />;
  }

  // Show auth screens if not authenticated
  if (!isAuthenticated) {
    if (authScreen === 'landing') {
      return (
        <LandingView
          onLogin={() => setAuthScreen('login')}
          onSignUp={() => setAuthScreen('signup')}
        />
      );
    }
    if (authScreen === 'signup') {
      return (
        <SignUpView
          onSwitchToLogin={() => setAuthScreen('login')}
          onBack={() => setAuthScreen('landing')}
        />
      );
    }
    return (
      <LoginView
        onSwitchToSignup={() => setAuthScreen('signup')}
        onBack={() => setAuthScreen('landing')}
      />
    );
  }

  // Render main content based on active page
  const renderContent = () => {
    switch (activePage) {
      case 'home':
        return (
          <HomeView
            onNavigate={setActivePage}
            onPlaylistClick={navigateToPlaylist}
          />
        );
      case 'library':
        return <LibraryView />;
      case 'liked':
        return <LikedSongsView />;
      case 'playlists':
        return (
          <PlaylistsView
            onPlaylistClick={navigateToPlaylist}
          />
        );
      case 'playlist-detail':
        return selectedPlaylistId ? (
          <PlaylistDetailView playlistId={selectedPlaylistId} />
        ) : (
          <HomeView
            onNavigate={setActivePage}
            onPlaylistClick={navigateToPlaylist}
          />
        );
      case 'search':
        return <SearchView />;
      case 'settings':
        return <SettingsView />;
      case 'admin':
        return <AdminView />;
      default:
        return (
          <HomeView
            onNavigate={setActivePage}
            onPlaylistClick={navigateToPlaylist}
          />
        );
    }
  };

  // Convert API playlists to frontend format for Sidebar
  const sidebarPlaylists = playlists.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description || '',
    image: p.coverImage || `https://picsum.photos/seed/${p.id}/400/400`,
    songs: [],
  }));

  if (isAndroid) {
    return (
      <ErrorBoundary>
        <div className="flex flex-col h-screen w-full bg-[#0a0a0a] text-zinc-300 select-none overflow-hidden">
          <OfflineBanner />
          <main
            className="flex-1 overflow-y-auto relative"
            style={{
              paddingBottom: currentTrack
                ? 'calc(72px + 56px + env(safe-area-inset-bottom))'
                : 'calc(56px + env(safe-area-inset-bottom))',
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-[#1a1a1a]/20 to-[#0a0a0a] pointer-events-none" />
            <div className="relative z-10 p-4 pb-4">
              <ErrorBoundary>
                {renderContent()}
              </ErrorBoundary>
            </div>
          </main>
          <MobilePlayerBar />
          <BottomNav activePage={activePage} onNavigate={setActivePage} />
          <ToastContainer />
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen w-full bg-[#0a0a0a] text-zinc-300 select-none overflow-hidden">
        <OfflineBanner />
        <UpdateNotification />
        <Sidebar
          activePage={activePage}
          setActivePage={setActivePage}
          playlists={sidebarPlaylists}
          onPlaylistClick={navigateToPlaylist}
        />
        <main
          className={`flex-1 overflow-y-auto relative h-full transition-[margin] duration-300 ease-out ${currentTrack ? 'pb-24' : ''}`}
          style={{ marginRight: showLyrics || showQueue ? '400px' : '0' }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-[#1a1a1a]/20 to-[#0a0a0a] pointer-events-none" />
          <div className="relative z-10 p-6 md:p-10 pb-32">
            <ErrorBoundary>
              {renderContent()}
            </ErrorBoundary>
          </div>
        </main>
        <PlayerBar />
        <ToastContainer />
        <KeyboardShortcutsModal
          isOpen={showShortcutsModal}
          onClose={() => setShowShortcutsModal(false)}
        />
      </div>
    </ErrorBoundary>
  );
};

export default App;
