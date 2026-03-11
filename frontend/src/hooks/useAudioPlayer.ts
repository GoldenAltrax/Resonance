import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { Track, api } from '@/services/api';
import { isTauri } from '@/utils/tauri';

const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentBlobUrl = useRef<string | null>(null);

  // Web Audio API nodes
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const eqNodesRef = useRef<BiquadFilterNode[]>([]);
  const crossfadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pipelineInitialized = useRef(false);
  // Incremented on every track change — stale fetches check this and discard
  const loadGenerationRef = useRef(0);

  // Latest-ref: event handlers read from here to avoid stale closures
  // without causing the setup useEffect to re-run.
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

  // Keep latestRef in sync on every render
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

  const getAudioCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }, []);

  // On mobile (Android especially), AudioContext starts in suspended state and can
  // only be resumed during a user gesture. We hook the very first touch/click so the
  // context is already running by the time a track loads — the blob download takes
  // several seconds and by then the gesture window has long closed.
  useEffect(() => {
    const unlock = () => {
      const ctx = getAudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    };
    document.addEventListener('touchstart', unlock, { once: true, passive: true });
    document.addEventListener('click', unlock, { once: true });
    return () => {
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('click', unlock);
    };
  }, [getAudioCtx]);

  // Initialize the Web Audio pipeline ONCE per audio element.
  // Falls back gracefully if Web Audio API is unavailable (some Android WebViews).
  const initAudioPipeline = useCallback(
    (audio: HTMLAudioElement) => {
      if (pipelineInitialized.current) return;
      pipelineInitialized.current = true;

      try {
        const ctx = getAudioCtx();
        const source = ctx.createMediaElementSource(audio);
        sourceNodeRef.current = source;

        const gain = ctx.createGain();
        gain.gain.value = latestRef.current.volume;
        gainNodeRef.current = gain;

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

        source.connect(gain);
        let node: AudioNode = gain;
        for (const eq of eqNodes) {
          node.connect(eq);
          node = eq;
        }
        node.connect(ctx.destination);
      } catch (err) {
        // Web Audio API unavailable — volume falls back to audio.volume
        console.warn('Web Audio API pipeline unavailable, using fallback:', err);
      }
    },
    [getAudioCtx]
  );

  // EQ gain updates
  useEffect(() => {
    eqNodesRef.current.forEach((node, i) => {
      node.gain.value = eqEnabled ? (eqGains[i] ?? 0) : 0;
    });
  }, [eqEnabled, eqGains]);

  // Volume — GainNode when pipeline is active, audio.volume as fallback
  useEffect(() => {
    if (gainNodeRef.current && !crossfadeTimeoutRef.current) {
      gainNodeRef.current.gain.value = volume;
    } else if (audioRef.current && !sourceNodeRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Tauri tray + global media shortcuts
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

  // Tray tooltip
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

  // Initialize audio element — runs ONCE with stable deps
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    setAudioElement(audio);

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

    const handleLoadedMetadata = () => setDuration(audio.duration);

    const handleEnded = () => {
      crossfadeTimeoutRef.current = null;
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.setValueAtTime(
          latestRef.current.volume,
          getAudioCtx().currentTime
        );
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
      if (crossfadeTimeoutRef.current) {
        clearTimeout(crossfadeTimeoutRef.current);
        crossfadeTimeoutRef.current = null;
      }
    };
  }, [setAudioElement, setProgress, setDuration, getAudioCtx]);

  // Handle track changes — fetch as blob so the audio element uses a local
  // blob: URL (avoids ATS/CORS issues with HTMLMediaElement on Tauri/WebView).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    const generation = ++loadGenerationRef.current;

    crossfadeTimeoutRef.current = null;
    if (gainNodeRef.current) {
      const ctx = getAudioCtx();
      gainNodeRef.current.gain.cancelScheduledValues(ctx.currentTime);
      gainNodeRef.current.gain.setValueAtTime(latestRef.current.volume, ctx.currentTime);
    }

    // Revoke previous blob URL
    if (currentBlobUrl.current) {
      api.revokeStreamUrl(currentBlobUrl.current);
      currentBlobUrl.current = null;
    }

    const loadAndPlay = async (url: string) => {
      if (loadGenerationRef.current !== generation) {
        api.revokeStreamUrl(url);
        return;
      }
      if (!audioRef.current) {
        api.revokeStreamUrl(url);
        return;
      }
      audioRef.current.src = url;
      currentBlobUrl.current = url;
      audioRef.current.load();

      initAudioPipeline(audioRef.current);

      if (usePlayerStore.getState().isPlaying) {
        const ctx = audioCtxRef.current;
        // Await resume — on Android the context starts suspended and must be
        // fully running before play() or audio routes through it silently.
        if (ctx?.state === 'suspended') await ctx.resume().catch(() => {});
        audioRef.current.play().catch((err) => console.error('Playback failed:', err));
      }
    };

    api
      .getSecureStreamUrl(currentTrack.id)
      .then((blobUrl) => loadAndPlay(blobUrl))
      .catch((err) => console.error('Failed to load audio:', err));
  }, [currentTrack, initAudioPipeline, getAudioCtx]);

  // Handle play/pause
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (isPlaying) {
      const ctx = audioCtxRef.current;
      (async () => {
        if (ctx?.state === 'suspended') await ctx.resume().catch(() => {});
        audio.play().catch((err) => console.error('Playback failed:', err));
      })();
    } else {
      audio.pause();
    }
  }, [isPlaying, currentTrack]);

  const formatTime = useCallback((seconds: number): string => {
    if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  return { audioRef, formatTime };
}
