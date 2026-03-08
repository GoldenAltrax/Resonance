import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { api } from '@/services/api';
import { isTauri } from '@/utils/tauri';

// Preload threshold (percentage of track completion)
const PRELOAD_THRESHOLD = 0.75;

const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadRef = useRef<HTMLAudioElement | null>(null);
  const preloadedTrackId = useRef<string | null>(null);
  const currentBlobUrl = useRef<string | null>(null);
  const preloadedBlobUrl = useRef<string | null>(null);

  // Web Audio API nodes
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const eqNodesRef = useRef<BiquadFilterNode[]>([]);
  const crossfadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    currentTrack,
    isPlaying,
    volume,
    repeat,
    queue,
    queueIndex,
    shuffle,
    eqEnabled,
    eqGains,
    crossfadeEnabled,
    crossfadeDuration,
    setAudioElement,
    setProgress,
    setDuration,
    next,
    pause,
  } = usePlayerStore();

  // Initialize or get AudioContext
  const getAudioCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }, []);

  // Build the Web Audio pipeline for a given audio element
  const buildAudioPipeline = useCallback(
    (audio: HTMLAudioElement): { gainNode: GainNode; eqNodes: BiquadFilterNode[] } => {
      const ctx = getAudioCtx();

      // Disconnect old source if it exists for this audio element
      try {
        sourceNodeRef.current?.disconnect();
      } catch {}

      const source = ctx.createMediaElementSource(audio);
      sourceNodeRef.current = source;

      // Create main gain node
      const gain = ctx.createGain();
      gain.gain.value = 1;
      gainNodeRef.current = gain;

      // Create 10-band EQ
      const eqNodes: BiquadFilterNode[] = EQ_FREQUENCIES.map((freq, i) => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1.4;
        filter.gain.value = eqEnabled ? (eqGains[i] ?? 0) : 0;
        return filter;
      });
      eqNodesRef.current = eqNodes;

      // Chain: source → gain → eq[0] → eq[1] → ... → eq[9] → destination
      source.connect(gain);
      let node: AudioNode = gain;
      for (const eq of eqNodes) {
        node.connect(eq);
        node = eq;
      }
      node.connect(ctx.destination);

      return { gainNode: gain, eqNodes };
    },
    [getAudioCtx, eqEnabled, eqGains]
  );

  // Update EQ gain values when settings change
  useEffect(() => {
    eqNodesRef.current.forEach((node, i) => {
      node.gain.value = eqEnabled ? (eqGains[i] ?? 0) : 0;
    });
  }, [eqEnabled, eqGains]);

  // Register Tauri tray event listeners + global media shortcuts
  useEffect(() => {
    if (!isTauri()) return;

    let unlistenTray: (() => void) | null = null;

    const setupTauri = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlistenTray = await listen<{ command: string }>('tray:command', (event) => {
          const store = usePlayerStore.getState();
          switch (event.payload.command) {
            case 'play_pause':
              store.isPlaying ? store.pause() : store.resume();
              break;
            case 'next':
              store.next();
              break;
            case 'previous':
              store.previous();
              break;
          }
        });

        const { register } = await import('@tauri-apps/plugin-global-shortcut');
        await register('MediaPlayPause', () => {
          const store = usePlayerStore.getState();
          store.isPlaying ? store.pause() : store.resume();
        });
        await register('MediaNextTrack', () => usePlayerStore.getState().next());
        await register('MediaPreviousTrack', () => usePlayerStore.getState().previous());
      } catch (err) {
        console.warn('Tauri IPC setup failed:', err);
      }
    };

    setupTauri();

    return () => {
      unlistenTray?.();
      if (isTauri()) {
        import('@tauri-apps/plugin-global-shortcut')
          .then(({ unregisterAll }) => unregisterAll())
          .catch(() => {});
      }
    };
  }, []);

  // Update tray tooltip when track changes (Tauri only)
  useEffect(() => {
    if (!isTauri() || !currentTrack) return;
    import('@tauri-apps/api/core')
      .then(({ invoke }) =>
        invoke('update_tray', {
          trackName: currentTrack.title,
          artist: currentTrack.artist ?? '',
          isPlaying,
        })
      )
      .catch(() => {});
  }, [currentTrack, isPlaying]);

  // Initialize audio element
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = volume;
      setAudioElement(audioRef.current);
    }

    const audio = audioRef.current;

    // Initialize preload audio element
    if (!preloadRef.current) {
      preloadRef.current = new Audio();
      preloadRef.current.preload = 'auto';
      preloadRef.current.volume = 0; // Silent preload
    }

    // Event handlers
    const handleTimeUpdate = () => {
      setProgress(audio.currentTime);

      // Check sleep timer
      usePlayerStore.getState().checkSleepTimer();

      // Crossfade trigger
      if (crossfadeEnabled && crossfadeDuration > 0 && audio.duration) {
        const timeLeft = audio.duration - audio.currentTime;
        if (timeLeft <= crossfadeDuration && timeLeft > 0 && !crossfadeTimeoutRef.current) {
          startCrossfade(timeLeft);
        }
      }

      // Check if we should preload the next track
      if (audio.duration && audio.currentTime / audio.duration >= PRELOAD_THRESHOLD) {
        preloadNextTrack();
      }
    };

    const startCrossfade = (timeLeft: number) => {
      if (crossfadeTimeoutRef.current) return;
      // Mark so we don't start it again
      crossfadeTimeoutRef.current = setTimeout(() => {}, 0);

      const ctx = getAudioCtx();
      if (!gainNodeRef.current) return;

      const now = ctx.currentTime;
      // Fade out current
      gainNodeRef.current.gain.setValueAtTime(1, now);
      gainNodeRef.current.gain.linearRampToValueAtTime(0, now + timeLeft);

      // Advance to next track immediately so it starts loading
      usePlayerStore.getState().next();
    };

    // Preload the next track in queue
    const preloadNextTrack = () => {
      if (!preloadRef.current || queue.length === 0) return;

      let nextIndex: number;
      if (shuffle) {
        return;
      } else {
        nextIndex = queueIndex + 1;
        if (nextIndex >= queue.length) {
          if (repeat === 'all') {
            nextIndex = 0;
          } else {
            return;
          }
        }
      }

      const nextTrack = queue[nextIndex];
      if (!nextTrack || preloadedTrackId.current === nextTrack.id) {
        return;
      }

      api.getSecureStreamUrl(nextTrack.id)
        .then((blobUrl) => {
          if (preloadRef.current && preloadedTrackId.current !== nextTrack.id) {
            if (preloadedBlobUrl.current) {
              api.revokeStreamUrl(preloadedBlobUrl.current);
            }
            preloadRef.current.src = blobUrl;
            preloadRef.current.load();
            preloadedTrackId.current = nextTrack.id;
            preloadedBlobUrl.current = blobUrl;
          } else {
            api.revokeStreamUrl(blobUrl);
          }
        })
        .catch((err) => {
          console.warn('Failed to preload next track:', err);
        });
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handleEnded = () => {
      // Reset crossfade state
      crossfadeTimeoutRef.current = null;
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.setValueAtTime(1, getAudioCtx().currentTime);
      }

      if (repeat === 'one') {
        audio.currentTime = 0;
        audio.play();
      } else {
        next();
      }
    };

    const handleError = (e: Event) => {
      console.error('Audio error:', e);
      pause();
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      if (currentBlobUrl.current) {
        api.revokeStreamUrl(currentBlobUrl.current);
        currentBlobUrl.current = null;
      }
      if (preloadedBlobUrl.current) {
        api.revokeStreamUrl(preloadedBlobUrl.current);
        preloadedBlobUrl.current = null;
      }
      if (preloadRef.current) {
        preloadRef.current.src = '';
        preloadRef.current = null;
      }
      if (crossfadeTimeoutRef.current) {
        clearTimeout(crossfadeTimeoutRef.current);
        crossfadeTimeoutRef.current = null;
      }
    };
  }, [
    repeat,
    next,
    pause,
    setAudioElement,
    setProgress,
    setDuration,
    volume,
    queue,
    queueIndex,
    shuffle,
    crossfadeEnabled,
    crossfadeDuration,
    getAudioCtx,
  ]);

  // Handle track changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    // Reset crossfade state on track change
    crossfadeTimeoutRef.current = null;
    if (gainNodeRef.current) {
      const ctx = getAudioCtx();
      gainNodeRef.current.gain.cancelScheduledValues(ctx.currentTime);
      gainNodeRef.current.gain.setValueAtTime(1, ctx.currentTime);
    }

    // Revoke old blob URL
    if (currentBlobUrl.current) {
      api.revokeStreamUrl(currentBlobUrl.current);
      currentBlobUrl.current = null;
    }

    const loadAndPlay = (blobUrl: string) => {
      if (!audioRef.current) {
        api.revokeStreamUrl(blobUrl);
        return;
      }
      audioRef.current.src = blobUrl;
      currentBlobUrl.current = blobUrl;
      audioRef.current.load();

      // Build Web Audio pipeline (reconnects source node after src change)
      buildAudioPipeline(audioRef.current);

      if (usePlayerStore.getState().isPlaying) {
        const ctx = getAudioCtx();
        if (ctx.state === 'suspended') ctx.resume();
        audioRef.current.play().catch((err) => {
          console.error('Playback failed:', err);
        });
      }
    };

    // Check if this track was preloaded
    if (preloadedTrackId.current === currentTrack.id && preloadedBlobUrl.current) {
      const blobUrl = preloadedBlobUrl.current;
      preloadedBlobUrl.current = null;
      preloadedTrackId.current = null;
      loadAndPlay(blobUrl);
    } else {
      api.getSecureStreamUrl(currentTrack.id)
        .then((blobUrl) => {
          if (audioRef.current && currentTrack) {
            if (currentBlobUrl.current && currentBlobUrl.current !== blobUrl) {
              api.revokeStreamUrl(currentBlobUrl.current);
            }
            loadAndPlay(blobUrl);
          } else {
            api.revokeStreamUrl(blobUrl);
          }
        })
        .catch((err) => {
          console.error('Failed to load audio:', err);
        });
    }

    if (preloadedTrackId.current === currentTrack.id) {
      preloadedTrackId.current = null;
    }
  }, [currentTrack, buildAudioPipeline, getAudioCtx]);

  // Handle play/pause state changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    if (isPlaying) {
      const ctx = audioCtxRef.current;
      if (ctx?.state === 'suspended') ctx.resume();
      audio.play().catch((err) => {
        console.error('Playback failed:', err);
      });
    } else {
      audio.pause();
    }
  }, [isPlaying, currentTrack]);

  // Handle volume changes
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
    }
  }, [volume]);

  // Utility functions
  const formatTime = useCallback((seconds: number): string => {
    if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  return {
    audioRef,
    formatTime,
  };
}
