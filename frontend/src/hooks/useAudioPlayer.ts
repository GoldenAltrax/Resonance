import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { Track, api } from '@/services/api';
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
  const pipelineInitialized = useRef(false);

  // Latest-ref pattern: keep a ref in sync with the latest store values
  // so event handlers (set up once) always read fresh values without being
  // listed as useEffect deps (which would cause re-runs on every state change).
  const latestRef = useRef({
    repeat: 'none' as 'none' | 'one' | 'all',
    queue: [] as Track[],
    queueIndex: 0,
    shuffle: false,
    crossfadeEnabled: false,
    crossfadeDuration: 3,
    volume: 0.7,
    eqEnabled: false,
    eqGains: Array(10).fill(0) as number[],
  });

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
  } = usePlayerStore();

  // Keep latestRef in sync on every render (no dep array — always runs)
  useEffect(() => {
    latestRef.current = {
      repeat,
      queue,
      queueIndex,
      shuffle,
      crossfadeEnabled,
      crossfadeDuration,
      volume,
      eqEnabled,
      eqGains,
    };
  });

  // Initialize or get AudioContext
  const getAudioCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }, []);

  // Build the Web Audio pipeline ONCE for the main audio element.
  // MediaElementAudioSourceNode can only be created once per audio element —
  // subsequent track changes just update audio.src, the pipeline stays connected.
  const initAudioPipeline = useCallback(
    (audio: HTMLAudioElement) => {
      if (pipelineInitialized.current) return;
      pipelineInitialized.current = true;

      const ctx = getAudioCtx();
      const source = ctx.createMediaElementSource(audio);
      sourceNodeRef.current = source;

      // Gain node controls volume (audio.volume is bypassed by Web Audio API)
      const gain = ctx.createGain();
      gain.gain.value = latestRef.current.volume;
      gainNodeRef.current = gain;

      // 10-band EQ
      const { eqEnabled, eqGains } = latestRef.current;
      const eqNodes: BiquadFilterNode[] = EQ_FREQUENCIES.map((freq, i) => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1.4;
        filter.gain.value = eqEnabled ? (eqGains[i] ?? 0) : 0;
        return filter;
      });
      eqNodesRef.current = eqNodes;

      // Chain: source → gainNode → eq[0] → ... → eq[9] → destination
      source.connect(gain);
      let node: AudioNode = gain;
      for (const eq of eqNodes) {
        node.connect(eq);
        node = eq;
      }
      node.connect(ctx.destination);
    },
    [getAudioCtx]
  );

  // Update EQ gains when settings change
  useEffect(() => {
    eqNodesRef.current.forEach((node, i) => {
      node.gain.value = eqEnabled ? (eqGains[i] ?? 0) : 0;
    });
  }, [eqEnabled, eqGains]);

  // Volume: must go through GainNode once the Web Audio pipeline is active.
  // audio.volume is bypassed by Web Audio API after createMediaElementSource().
  useEffect(() => {
    if (gainNodeRef.current) {
      // Don't override a crossfade in progress
      if (!crossfadeTimeoutRef.current) {
        gainNodeRef.current.gain.value = volume;
      }
    }
  }, [volume]);

  // Register Tauri tray event listeners + global media shortcuts (runs once)
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

  // Update tray tooltip when track or play state changes
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

  // Initialize audio element and attach event listeners — runs ONCE.
  // Stable deps only: callbacks from store that never change identity.
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    setAudioElement(audio);

    const preload = new Audio();
    preload.preload = 'auto';
    preloadRef.current = preload;

    // ---- Event handlers — read from latestRef to avoid stale closures ----

    const handleTimeUpdate = () => {
      setProgress(audio.currentTime);
      usePlayerStore.getState().checkSleepTimer();

      const { crossfadeEnabled, crossfadeDuration } = latestRef.current;
      if (crossfadeEnabled && crossfadeDuration > 0 && audio.duration) {
        const timeLeft = audio.duration - audio.currentTime;
        if (timeLeft <= crossfadeDuration && timeLeft > 0 && !crossfadeTimeoutRef.current) {
          startCrossfade(timeLeft);
        }
      }

      if (audio.duration && audio.currentTime / audio.duration >= PRELOAD_THRESHOLD) {
        preloadNextTrack();
      }
    };

    const startCrossfade = (timeLeft: number) => {
      if (crossfadeTimeoutRef.current) return;
      crossfadeTimeoutRef.current = setTimeout(() => {}, 0);

      const ctx = getAudioCtx();
      if (!gainNodeRef.current) return;

      const { volume } = latestRef.current;
      const now = ctx.currentTime;
      gainNodeRef.current.gain.setValueAtTime(volume, now);
      gainNodeRef.current.gain.linearRampToValueAtTime(0, now + timeLeft);

      usePlayerStore.getState().next();
    };

    const preloadNextTrack = () => {
      if (!preloadRef.current) return;
      const { queue, queueIndex, shuffle, repeat } = latestRef.current;
      if (queue.length === 0) return;
      if (shuffle) return;

      let nextIndex = queueIndex + 1;
      if (nextIndex >= queue.length) {
        if (repeat === 'all') nextIndex = 0;
        else return;
      }

      const nextTrack = queue[nextIndex];
      if (!nextTrack || preloadedTrackId.current === nextTrack.id) return;

      api
        .getSecureStreamUrl(nextTrack.id)
        .then((blobUrl) => {
          if (preloadRef.current && preloadedTrackId.current !== nextTrack.id) {
            if (preloadedBlobUrl.current) api.revokeStreamUrl(preloadedBlobUrl.current);
            preloadRef.current.src = blobUrl;
            preloadRef.current.load();
            preloadedTrackId.current = nextTrack.id;
            preloadedBlobUrl.current = blobUrl;
          } else {
            api.revokeStreamUrl(blobUrl);
          }
        })
        .catch((err) => console.warn('Failed to preload next track:', err));
    };

    const handleLoadedMetadata = () => setDuration(audio.duration);

    const handleEnded = () => {
      crossfadeTimeoutRef.current = null;
      if (gainNodeRef.current) {
        const { volume } = latestRef.current;
        gainNodeRef.current.gain.setValueAtTime(volume, getAudioCtx().currentTime);
      }

      const { repeat } = latestRef.current;
      if (repeat === 'one') {
        audio.currentTime = 0;
        audio.play();
      } else {
        usePlayerStore.getState().next();
      }
    };

    const handleError = (e: Event) => {
      console.error('Audio error:', e);
      usePlayerStore.getState().pause();
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
      audio.src = '';
      audioRef.current = null;
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
  }, [setAudioElement, setProgress, setDuration, getAudioCtx]); // stable deps only

  // Handle track changes — load new audio src, init pipeline on first track
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    // Reset crossfade state on track change
    crossfadeTimeoutRef.current = null;
    if (gainNodeRef.current) {
      const ctx = getAudioCtx();
      gainNodeRef.current.gain.cancelScheduledValues(ctx.currentTime);
      gainNodeRef.current.gain.setValueAtTime(latestRef.current.volume, ctx.currentTime);
    }

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

      // Initialize pipeline once — subsequent calls are no-ops
      initAudioPipeline(audioRef.current);

      if (usePlayerStore.getState().isPlaying) {
        const ctx = getAudioCtx();
        if (ctx.state === 'suspended') ctx.resume();
        audioRef.current.play().catch((err) => {
          console.error('Playback failed:', err);
        });
      }
    };

    if (preloadedTrackId.current === currentTrack.id && preloadedBlobUrl.current) {
      const blobUrl = preloadedBlobUrl.current;
      preloadedBlobUrl.current = null;
      preloadedTrackId.current = null;
      loadAndPlay(blobUrl);
    } else {
      api
        .getSecureStreamUrl(currentTrack.id)
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
        .catch((err) => console.error('Failed to load audio:', err));
    }

    if (preloadedTrackId.current === currentTrack.id) {
      preloadedTrackId.current = null;
    }
  }, [currentTrack, initAudioPipeline, getAudioCtx]);

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
