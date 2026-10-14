import { useEffect } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlaybackStore } from '@/stores/playbackStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { audioEngine } from '@/services/audioEngine';
import { api, Track } from '@/services/api';
import { toast } from '@/stores/toastStore';

const RESUME_KEY = 'resonance-resume';
const PRELOAD_LEAD_SECONDS = 30;
const RADIO_REFILL_THRESHOLD = 3;
const MAX_CONSECUTIVE_ERRORS = 3;

function readResume(): { trackId: string; position: number } | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeResume(trackId: string, position: number) {
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ trackId, position }));
  } catch { /* storage unavailable */ }
}

/**
 * Connects the player store to the audio engine. Mount exactly once (in App).
 *
 * Everything here runs through store subscriptions and engine callbacks rather than
 * React state, so playback never causes the component tree to re-render.
 */
export function useAudioPlayer() {
  useEffect(() => {
    const player = usePlayerStore;
    const playback = usePlaybackStore.getState();

    let crossfadeRequested = false;
    let consecutiveErrors = 0;
    // A track that failed to load while paused (e.g. the restored track): reload it on play
    let failedWhilePaused = false;
    let loggedLoadId = -1;
    let lastResumeWrite = 0;
    let radioRefillInFlight = false;

    const streamUrl = (track: Track) => api.getStreamUrl(track.id);

    // ── Engine → store ──────────────────────────────────────────────────────
    audioEngine.setCallbacks({
      onTimeUpdate: (time) => {
        playback.setProgress(time);
        const s = player.getState();
        const track = s.currentTrack;
        if (!track) return;

        const duration = audioEngine.duration;
        const remaining = duration - time;

        // Remember position for "continue where you left off" (throttled)
        const now = Date.now();
        if (now - lastResumeWrite > 5000) {
          lastResumeWrite = now;
          writeResume(track.id, time);
        }

        if (!duration || !s.isPlaying || s.repeat === 'one') return;
        const upcoming = s.peekNext();
        if (!upcoming) return;

        // True crossfade: start the next track while this one fades out
        if (
          s.crossfadeEnabled &&
          s.crossfadeDuration > 0 &&
          audioEngine.webAudioActive &&
          !audioEngine.isFading &&
          !crossfadeRequested &&
          remaining > 0.25 &&
          remaining <= s.crossfadeDuration
        ) {
          crossfadeRequested = true;
          s.next({ auto: true });
          return;
        }

        // Gapless: buffer the next track on the idle deck ahead of time
        if (remaining <= PRELOAD_LEAD_SECONDS && audioEngine.preloadedTrackId() !== upcoming.id) {
          audioEngine.preload(upcoming, streamUrl(upcoming));
        }
      },
      onDurationChange: (duration) => playback.setDuration(duration),
      onEnded: () => {
        const s = player.getState();
        if (s.repeat === 'one') {
          audioEngine.restart();
          return;
        }
        s.next({ auto: true });
      },
      onError: (reason) => {
        const s = player.getState();
        consecutiveErrors++;
        playback.setBuffering(false);
        const title = s.currentTrack?.title ?? 'this track';
        // Not playing (session restored paused): keep the track instead of skipping through the queue
        if (!s.isPlaying) {
          failedWhilePaused = true;
          consecutiveErrors = 0;
          return;
        }
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS || !s.peekNext()) {
          toast.error(`Couldn't play "${title}" (${reason}).`);
          s.pause();
          consecutiveErrors = 0;
          return;
        }
        toast.warning(`Couldn't play "${title}" (${reason}). Skipping.`);
        s.next({ auto: true });
      },
      onBuffering: (buffering) => playback.setBuffering(buffering),
      onPlaying: () => {
        consecutiveErrors = 0;
        const s = player.getState();
        // Log each load once, when audio actually starts (not when a session is restored paused)
        if (s.currentTrack && loggedLoadId !== s.loadId) {
          loggedLoadId = s.loadId;
          api.logPlay(s.currentTrack.id).catch(() => {});
        }
      },
      onExternalPause: () => {
        if (player.getState().isPlaying) player.setState({ isPlaying: false });
      },
      onPlayBlocked: () => {
        player.setState({ isPlaying: false });
        playback.setBuffering(false);
      },
    });

    // ── Store → engine ──────────────────────────────────────────────────────
    const loadCurrent = (startAt?: number) => {
      const s = player.getState();
      const track = s.currentTrack;
      if (!track) return;
      playback.setProgress(startAt ?? 0);
      playback.setDuration(track.duration);

      if (crossfadeRequested && s.autoAdvance && s.isPlaying) {
        crossfadeRequested = false;
        const remaining = Math.max(0.5, audioEngine.duration - audioEngine.currentTime);
        audioEngine.crossfadeTo(track, streamUrl(track), Math.min(remaining, s.crossfadeDuration));
      } else {
        crossfadeRequested = false;
        audioEngine.load(track, streamUrl(track), { autoplay: s.isPlaying, startAt });
      }
    };

    const unsubscribe = player.subscribe((s, prev) => {
      if (s.loadId !== prev.loadId) {
        failedWhilePaused = false;
        if (s.currentTrack) loadCurrent();
        return; // load() already applied isPlaying
      }
      if (s.isPlaying !== prev.isPlaying) {
        if (s.isPlaying && failedWhilePaused && s.currentTrack) {
          failedWhilePaused = false;
          loadCurrent(usePlaybackStore.getState().progress);
        } else if (s.isPlaying) {
          audioEngine.play();
        } else {
          audioEngine.pauseAll();
          playback.setBuffering(false);
          if (s.currentTrack) writeResume(s.currentTrack.id, audioEngine.currentTime);
        }
      }
      if (s.volume !== prev.volume || s.isMuted !== prev.isMuted) {
        audioEngine.setVolume(s.isMuted ? 0 : s.volume);
      }
      if (s.eqEnabled !== prev.eqEnabled || s.eqGains !== prev.eqGains) {
        audioEngine.setEq(s.eqEnabled, s.eqGains);
      }
      if (s.normalizeVolume !== prev.normalizeVolume) {
        audioEngine.setNormalization(s.normalizeVolume);
      }
      if (s.currentTrack !== prev.currentTrack || s.isPlaying !== prev.isPlaying) {
        updateMediaSession(s.currentTrack, s.isPlaying);
      }
      if (s.queueIndex !== prev.queueIndex || s.queue !== prev.queue) {
        maybeRefillRadio();
      }
    });

    // The persisted session holds track objects from an earlier visit; refresh them from
    // the library so edits and new loudness measurements apply without reloading audio.
    const unsubscribeLibrary = usePlaylistStore.subscribe((p, prev) => {
      if (p.library === prev.library || p.library.length === 0) return;
      const s = player.getState();
      s.refreshTracks(p.library);
      const fresh = player.getState();
      const loaded = [fresh.currentTrack, fresh.peekNext()].filter((t): t is Track => t !== null);
      audioEngine.refreshTracks(loaded);
    });

    // Radio: keep a few similar tracks queued ahead
    const maybeRefillRadio = () => {
      const s = player.getState();
      if (!s.radioMode || !s.radioSourceTrackId || radioRefillInFlight) return;
      const remaining = s.queue.length - (s.queueIndex + 1);
      if (remaining > RADIO_REFILL_THRESHOLD) return;
      radioRefillInFlight = true;
      // Recent tracks only: the ids go in the URL, and a long radio session's whole queue
      // would exceed the server's header size limit (the refill would then fail silently)
      const excludeIds = s.queue.slice(-150).map((t) => t.id).join(',');
      const recentArtists = s.queue
        .slice(Math.max(0, s.queueIndex - 4), s.queueIndex + 1)
        .map((t) => t.artist)
        .filter(Boolean)
        .join(',');
      api.getSimilarTracks(s.radioSourceTrackId, { limit: 20, excludeIds, recentArtists })
        .then(({ similarTracks }) => {
          if (similarTracks.length > 0 && player.getState().radioMode) {
            player.getState().addToQueue(similarTracks);
          }
        })
        .catch(() => {})
        .finally(() => { radioRefillInFlight = false; });
    };

    // ── Media Session (lock screen, headset buttons, OS media keys) ─────────
    const updateMediaSession = (track: Track | null, isPlaying: boolean) => {
      if (!('mediaSession' in navigator)) return;
      if (!track) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
        return;
      }
      if (navigator.mediaSession.metadata?.title !== track.title) {
        const artwork: MediaImage[] = track.coverArt
          ? [{ src: new URL(api.getTrackCoverUrl(track.coverArt), location.href).href, sizes: '512x512' }]
          : [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }];
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title,
          artist: track.artist ?? '',
          album: track.album ?? '',
          artwork,
        });
      }
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    };

    const unsubscribePosition = usePlaybackStore.subscribe((p, prev) => {
      // Position state lets the lock screen show a progress bar; ~1 update/sec is plenty
      if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
      if (Math.floor(p.progress) === Math.floor(prev.progress) && p.duration === prev.duration) return;
      if (!p.duration || p.progress > p.duration) return;
      try {
        navigator.mediaSession.setPositionState({ duration: p.duration, position: p.progress, playbackRate: 1 });
      } catch { /* invalid state during track switch */ }
    });

    const mediaHandlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => player.getState().resume()],
      ['pause', () => player.getState().pause()],
      ['stop', () => player.getState().pause()],
      ['previoustrack', () => player.getState().previous()],
      ['nexttrack', () => player.getState().next()],
      ['seekto', (d) => { if (d.seekTime != null) player.getState().seek(d.seekTime); }],
      ['seekbackward', (d) => player.getState().seek(audioEngine.currentTime - (d.seekOffset ?? 10))],
      ['seekforward', (d) => player.getState().seek(audioEngine.currentTime + (d.seekOffset ?? 10))],
    ];
    if ('mediaSession' in navigator) {
      for (const [action, handler] of mediaHandlers) {
        try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ }
      }
    }

    // ── Web Audio unlock on first gesture (AudioContext must start in a user gesture) ──
    const unlock = () => audioEngine.unlock();
    const gestureEvents = ['pointerdown', 'keydown', 'touchend'] as const;
    gestureEvents.forEach((e) => document.addEventListener(e, unlock, { capture: true, passive: true }));

    // Save position when the page is hidden/closed
    const saveOnHide = () => {
      const track = player.getState().currentTrack;
      if (track) writeResume(track.id, audioEngine.currentTime);
    };
    window.addEventListener('pagehide', saveOnHide);

    // ── Initial state: apply settings and restore the last session (paused) ──
    const initial = player.getState();
    audioEngine.setVolume(initial.isMuted ? 0 : initial.volume);
    audioEngine.setEq(initial.eqEnabled, initial.eqGains);
    audioEngine.setNormalization(initial.normalizeVolume);
    if (initial.currentTrack) {
      // Never auto-play on page load
      if (initial.isPlaying) player.setState({ isPlaying: false });
      const resume = readResume();
      const startAt = resume?.trackId === initial.currentTrack.id ? resume.position : 0;
      loadCurrent(startAt);
      updateMediaSession(initial.currentTrack, false);
    }

    return () => {
      unsubscribe();
      unsubscribePosition();
      unsubscribeLibrary();
      audioEngine.setCallbacks(null);
      gestureEvents.forEach((e) => document.removeEventListener(e, unlock, { capture: true }));
      window.removeEventListener('pagehide', saveOnHide);
      if ('mediaSession' in navigator) {
        for (const [action] of mediaHandlers) {
          try { navigator.mediaSession.setActionHandler(action, null); } catch { /* ignore */ }
        }
      }
    };
  }, []);
}
