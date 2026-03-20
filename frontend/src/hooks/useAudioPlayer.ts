import { useEffect, useRef, useCallback } from 'react';

export function formatTime(seconds: number): string {
  if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
import { usePlayerStore } from '@/stores/playerStore';
import { Track, api } from '@/services/api';
import { isTauri } from '@/utils/tauri';
import { dbg } from '@/utils/debugLog';

const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// Android WebView's Web Audio API is unreliable with MediaElementAudioSourceNode:
// once createMediaElementSource() is called the audio element is detached from the
// native render path and routed through the Web Audio graph, which silences playback
// on many Android versions. Detect synchronously via UA so we can skip the pipeline.
const IS_ANDROID = isTauri() && /android/i.test(navigator.userAgent);

// Log environment info once at module load so the debug panel always has context.
dbg.info(`--- useAudioPlayer loaded ---`);
dbg.info(`isTauri=${isTauri()} IS_ANDROID=${IS_ANDROID}`);
dbg.info(`UA=${navigator.userAgent.substring(0, 120)}`);

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
  // Gapless playback: pre-fetched URL for the upcoming next track
  const prefetchRef = useRef<{ trackId: string; url: string } | null>(null);
  const prefetchInProgressRef = useRef<string | null>(null); // trackId being pre-fetched

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
    radioMode: false,
    radioSourceTrackId: null as string | null,
  });

  // Radio auto-refill throttle refs
  const lastRadioRefillRef = useRef(0);
  const radioRefillInProgressRef = useRef(false);

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
    radioMode,
    radioSourceTrackId,
    setAudioElement,
    setProgress,
    setDuration,
    setLoadingAudio,
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
      radioMode,
      radioSourceTrackId,
    };
  });

  const getAudioCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }, []);

  // On desktop, AudioContext starts suspended and must be resumed during a user gesture.
  // We hook the very first touch/click so the context is running before a track loads.
  // On Android we skip Web Audio entirely (IS_ANDROID), so no AudioContext to unlock.
  useEffect(() => {
    if (IS_ANDROID) return;
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

  // MediaSession: update metadata whenever the current track changes
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const artwork: MediaImage[] = [];
    if (currentTrack.coverArt) {
      const coverUrl = api.getTrackCoverUrl(currentTrack.coverArt);
      artwork.push({ src: coverUrl, sizes: '512x512', type: 'image/jpeg' });
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist ?? '',
      album: currentTrack.album ?? '',
      artwork,
    });
  }, [currentTrack]);

  // MediaSession: keep playback state in sync
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying]);

  // MediaSession: register action handlers ONCE
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const store = () => usePlayerStore.getState();
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => store().resume()],
      ['pause', () => store().pause()],
      ['previoustrack', () => store().previous()],
      ['nexttrack', () => store().next()],
      ['seekto', (details) => {
        if (details.seekTime != null) store().seek(details.seekTime);
      }],
    ];
    for (const [action, handler] of handlers) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
    }
    return () => {
      for (const [action] of handlers) {
        try { navigator.mediaSession.setActionHandler(action, null); } catch {}
      }
    };
  }, []);

  // Initialize audio element — runs ONCE with stable deps
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    setAudioElement(audio);

    const handleTimeUpdate = () => {
      setProgress(audio.currentTime);
      usePlayerStore.getState().checkSleepTimer();

      if (audio.duration) {
        const timeLeft = audio.duration - audio.currentTime;

        const { crossfadeEnabled, crossfadeDuration } = latestRef.current;
        if (crossfadeEnabled && crossfadeDuration > 0) {
          if (timeLeft <= crossfadeDuration && timeLeft > 0 && !crossfadeTimeoutRef.current) {
            startCrossfade(timeLeft);
          }
        }

        // Gapless: pre-fetch next track URL when 20s remain.
        // Skip in shuffle mode — the next track is random and can't be predicted reliably,
        // so pre-fetching would fire a new fetch every timeupdate for a different random track.
        if (timeLeft <= 20 && timeLeft > 0) {
          const { queue, queueIndex, shuffle, repeat } = latestRef.current;
          if (shuffle) {
            // do nothing — gapless not possible with shuffle
          } else {
          let nextIdx = queueIndex + 1 < queue.length
            ? queueIndex + 1
            : repeat === 'all'
            ? 0
            : -1;

          const nextTrack = nextIdx >= 0 ? queue[nextIdx] : null;
          if (
            nextTrack &&
            prefetchRef.current?.trackId !== nextTrack.id &&
            prefetchInProgressRef.current !== nextTrack.id
          ) {
            prefetchInProgressRef.current = nextTrack.id;
            dbg.info(`gapless: pre-fetching next track "${nextTrack.title}" id=${nextTrack.id}`);
            api
              .getSecureStreamUrl(nextTrack.id)
              .then((url) => {
                // Discard if a different track is now being pre-fetched
                if (prefetchInProgressRef.current !== nextTrack.id) {
                  api.revokeStreamUrl(url);
                  return;
                }
                dbg.info(`gapless: pre-fetch ready for "${nextTrack.title}"`);
                prefetchRef.current = { trackId: nextTrack.id, url };
                prefetchInProgressRef.current = null;
              })
              .catch((err) => {
                dbg.warn(`gapless: pre-fetch failed: ${err}`);
                prefetchInProgressRef.current = null;
              });
          }
          } // end else (not shuffle)
        }

        // C3: Radio auto-refill — when ≤3 tracks remain, fetch more similar tracks
        const nowMs = Date.now();
        const { radioMode, radioSourceTrackId, queue: rQueue, queueIndex: rIdx } = latestRef.current;
        if (
          radioMode &&
          radioSourceTrackId &&
          !radioRefillInProgressRef.current &&
          nowMs - lastRadioRefillRef.current > 5000
        ) {
          const remaining = rQueue.length - (rIdx + 1);
          if (remaining <= 3) {
            lastRadioRefillRef.current = nowMs;
            radioRefillInProgressRef.current = true;
            const excludeIds = rQueue.map(t => t.id).join(',');
            dbg.info(`radio refill: ${remaining} tracks left, fetching more from source=${radioSourceTrackId}`);
            api.getSimilarTracks(radioSourceTrackId, { limit: 20, excludeIds })
              .then(({ similarTracks }) => {
                if (similarTracks.length > 0) {
                  usePlayerStore.getState().addToQueue(similarTracks);
                  dbg.info(`radio refill: appended ${similarTracks.length} tracks`);
                }
              })
              .catch((err) => dbg.warn(`radio refill failed: ${err}`))
              .finally(() => { radioRefillInProgressRef.current = false; });
          }
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
      const target = e.target as HTMLAudioElement;
      const err = target?.error;
      const msg = `Audio error: code=${err?.code} msg="${err?.message}" src=${target?.src?.substring(0, 60)}`;
      dbg.error(msg);
      console.error('Audio error:', e);
      usePlayerStore.getState().pause();
    };

    const handleCanPlay = () => {
      const el = audio as HTMLAudioElement;
      dbg.info(`canplay — readyState=${el.readyState} duration=${el.duration}`);
    };

    const handleStalled = () => dbg.warn(`stalled — readyState=${audio.readyState} networkState=${audio.networkState}`);
    const handleWaiting = () => dbg.warn(`waiting — readyState=${audio.readyState}`);
    const handleSuspend = () => dbg.info(`suspend — readyState=${audio.readyState}`);
    const handlePlaying = () => dbg.info(`playing event fired`);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('stalled', handleStalled);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('suspend', handleSuspend);
    audio.addEventListener('playing', handlePlaying);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('stalled', handleStalled);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('suspend', handleSuspend);
      audio.removeEventListener('playing', handlePlaying);
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

  // Android: mark the audio element as "user-activated" on the very first touch.
  // Android WebView blocks play() called from async callbacks (blob fetch, setTimeout)
  // unless the element was previously activated by a synchronous user-gesture call.
  // Calling play() here will fail (NotSupportedError — no src yet) but that's intentional:
  // Chrome/WebView records the activation even on rejection, allowing all subsequent
  // async play() calls on this same element to proceed without a fresh gesture.
  useEffect(() => {
    if (!IS_ANDROID) return;

    const unlock = () => {
      const audio = audioRef.current;
      if (!audio) return;
      dbg.info('Android: audio unlock via first gesture — calling play() to activate element');
      audio.play().catch((e) => {
        // Expected: NotSupportedError (no src yet). Element is now user-activated.
        dbg.info(`Android: unlock play() settled (${e?.name ?? 'ok'}) — element activated`);
      });
    };

    // Capture phase so we run before React's synthetic event system
    document.addEventListener('touchstart', unlock, { capture: true, passive: true, once: true });
    document.addEventListener('click', unlock, { capture: true, once: true });
    return () => {
      document.removeEventListener('touchstart', unlock, true);
      document.removeEventListener('click', unlock, true);
    };
  }, []); // audio element is always initialized before this effect runs (defined after init effect)

  // Handle track changes — fetch as blob so the audio element uses a local
  // blob: URL (avoids ATS/CORS issues with HTMLMediaElement on Tauri/WebView).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    const generation = ++loadGenerationRef.current;
    setLoadingAudio(false); // clear any stale loading state from previous track
    dbg.info(`Track change: "${currentTrack.title}" id=${currentTrack.id} gen=${generation}`);

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

    // Cancel any in-progress pre-fetch for a different track
    if (prefetchInProgressRef.current && prefetchInProgressRef.current !== currentTrack.id) {
      prefetchInProgressRef.current = null;
    }

    const loadAndPlay = async (url: string) => {
      const urlType = url.startsWith('blob:') ? 'blob' : url.startsWith('stream:') ? 'stream' : 'other';
      dbg.info(`loadAndPlay: gen=${generation} urlType=${urlType}`);

      if (loadGenerationRef.current !== generation) {
        dbg.warn(`loadAndPlay: stale gen=${generation}, current=${loadGenerationRef.current} — discarding`);
        api.revokeStreamUrl(url);
        return;
      }
      if (!audioRef.current) {
        dbg.warn('loadAndPlay: audioRef is null — discarding');
        api.revokeStreamUrl(url);
        return;
      }

      audioRef.current.src = url;
      currentBlobUrl.current = url;
      dbg.info(`audio.src set, calling load()`);
      audioRef.current.load();

      // Skip the Web Audio pipeline on Android — createMediaElementSource() detaches
      // the element from the native render path and routes it through the Web Audio
      // graph, which silences playback on Android WebView. Volume falls back to
      // audio.volume (see the volume useEffect below).
      if (!IS_ANDROID) {
        dbg.info('initAudioPipeline: running (desktop)');
        initAudioPipeline(audioRef.current);
      } else {
        dbg.info('initAudioPipeline: skipped (Android)');
        audioRef.current.volume = latestRef.current.volume;
      }

      const isPlaying = usePlayerStore.getState().isPlaying;
      dbg.info(`isPlaying=${isPlaying} — ${isPlaying ? 'calling play()' : 'not calling play() (paused)'}`);

      if (isPlaying) {
        const ctx = audioCtxRef.current;
        if (ctx?.state === 'suspended') {
          dbg.info('AudioContext suspended — awaiting resume()');
          await ctx.resume().catch((e) => dbg.warn(`ctx.resume() failed: ${e}`));
        }
        dbg.info(`audio.play() — readyState=${audioRef.current.readyState} networkState=${audioRef.current.networkState}`);
        audioRef.current
          .play()
          .then(() => dbg.info('audio.play() resolved'))
          .catch((err) => {
            dbg.error(`audio.play() rejected: ${err}`);
            console.error('Playback failed:', err);
          });
      }
    };

    // Check if next track was already pre-fetched (gapless)
    const prefetched = prefetchRef.current;
    if (prefetched && prefetched.trackId === currentTrack.id) {
      dbg.info(`gapless: using pre-fetched URL for "${currentTrack.title}"`);
      prefetchRef.current = null;
      loadAndPlay(prefetched.url);
    } else {
      // Invalidate any stale pre-fetch for a different track
      if (prefetched) {
        api.revokeStreamUrl(prefetched.url);
        prefetchRef.current = null;
      }
      if (IS_ANDROID) setLoadingAudio(true);
      dbg.info(`getSecureStreamUrl: fetching for id=${currentTrack.id}`);
      api
        .getSecureStreamUrl(currentTrack.id)
        .then((url) => {
          dbg.info(`getSecureStreamUrl: got ${url.startsWith('blob:') ? 'blob URL' : url.substring(0, 40)}`);
          setLoadingAudio(false);
          loadAndPlay(url);
        })
        .catch((err) => {
          dbg.error(`getSecureStreamUrl error: ${err}`);
          setLoadingAudio(false);
          console.error('Failed to load audio:', err);
        });
    }
  }, [currentTrack, initAudioPipeline, getAudioCtx]);

  // Handle play/pause
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (isPlaying) {
      const ctx = audioCtxRef.current;
      (async () => {
        if (ctx?.state === 'suspended') {
          dbg.info('play/pause effect: ctx suspended — resuming');
          await ctx.resume().catch((e) => dbg.warn(`ctx.resume() failed: ${e}`));
        }
        dbg.info(`play/pause effect: play() — readyState=${audio.readyState} src=${audio.src.substring(0, 50)}`);
        audio
          .play()
          .then(() => dbg.info('play/pause effect: play() resolved'))
          .catch((err) => {
            dbg.error(`play/pause effect: play() rejected: ${err}`);
            console.error('Playback failed:', err);
          });
      })();
    } else {
      dbg.info('play/pause effect: pause()');
      audio.pause();
    }
  }, [isPlaying, currentTrack]);

  return { audioRef };
}
