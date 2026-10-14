import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { Track, UserPreferences, api } from '@/services/api';
import { audioEngine } from '@/services/audioEngine';
import { usePlaybackStore } from '@/stores/playbackStore';
import { shuffleArray, balancedShuffle } from '@/utils/shuffle';

// Debounce for server preferences sync
let _syncPrefTimeout: ReturnType<typeof setTimeout> | null = null;
let _radioAutoStartedTimeout: ReturnType<typeof setTimeout> | null = null;
let _sleepTimeout: ReturnType<typeof setTimeout> | null = null;

const _syncPrefsToServer = (prefs: UserPreferences) => {
  if (_syncPrefTimeout) clearTimeout(_syncPrefTimeout);
  _syncPrefTimeout = setTimeout(() => {
    // Lazy import to avoid circular dep at module init time
    import('@/stores/authStore').then(({ useAuthStore }) => {
      const userId = useAuthStore.getState().user?.id;
      if (!userId) return;
      api.updatePreferences(userId, prefs).catch(() => {});
    });
  }, 1500);
};

const _extractPrefs = (s: PlayerState): UserPreferences => ({
  volume: s.volume,
  isMuted: s.isMuted,
  shuffle: s.shuffle,
  repeat: s.repeat,
  crossfadeEnabled: s.crossfadeEnabled,
  crossfadeDuration: s.crossfadeDuration,
  normalizeVolume: s.normalizeVolume,
  eqEnabled: s.eqEnabled,
  eqGains: s.eqGains,
  eqPreset: s.eqPreset,
});

// The persisted slice includes the whole queue, so writing it on every state change
// (e.g. each step of a volume drag) is wasteful. Coalesce writes and flush on page hide.
const pendingWrites = new Map<string, string>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;
const flushWrites = () => {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
  for (const [key, value] of pendingWrites) {
    try { localStorage.setItem(key, value); } catch { /* quota or private mode */ }
  }
  pendingWrites.clear();
};
window.addEventListener('pagehide', flushWrites);
const debouncedStorage: StateStorage = {
  getItem: (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  setItem: (key, value) => {
    pendingWrites.set(key, value);
    if (!writeTimer) writeTimer = setTimeout(flushWrites, 500);
  },
  removeItem: (key) => {
    pendingWrites.delete(key);
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

export { shuffleArray };

// Current track first, the rest shuffled with artists spread out. The queue itself is
// reordered, so the queue panel always shows the real play order and the next track is
// known in advance (needed for gapless preload and crossfade).
function shuffledAround(queue: Track[], index: number, recent: string[]): Track[] {
  const current = queue[index];
  if (!current) return balancedShuffle(queue, { recent });
  return [current, ...balancedShuffle(queue.filter((_, i) => i !== index), { recent })];
}

/** How many recently played track ids to remember, for shuffle's "fewer repeats". */
const RECENT_PLAYS = 50;

/** Fetch more radio when fewer than this many tracks are left after the current one. */
const RADIO_REFILL_AT = 5;
const RADIO_BATCH = 25;

// Bumped whenever the queue stops being the radio station it was (new play, radio stop,
// clear). A fetch that started under an older session drops its result.
let _radioSession = 0;
let _radioFetch: { session: number; advance: boolean } | null = null;

interface PlayerState {
  currentTrack: Track | null;
  queue: Track[];
  queueIndex: number;
  /** Queue order before shuffle was turned on, restored when it is turned off. */
  originalQueue: Track[] | null;
  /** Increments whenever a (re)load of currentTrack is requested; the audio controller watches it. */
  loadId: number;
  /** True when the most recent track change was automatic (end of track), used for crossfade. */
  autoAdvance: boolean;
  /** Ids of recently started tracks, most recent last. Shuffle holds these back. */
  recentPlays: string[];

  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  shuffle: boolean;
  repeat: 'none' | 'one' | 'all';
  showLyrics: boolean;
  showQueue: boolean;

  crossfadeEnabled: boolean;
  crossfadeDuration: number; // seconds (0–12)
  /** Bring every track to the same loudness (-14 LUFS). */
  normalizeVolume: boolean;

  eqEnabled: boolean;
  eqGains: number[]; // 10 bands: 32,64,125,250,500,1k,2k,4k,8k,16k Hz — each -12 to +12 dB
  eqPreset: string;
  showEqualizer: boolean;

  /** The queue is a station: it refills itself with similar tracks as it plays. */
  radioMode: boolean;
  radioSourceTrackId: string | null;
  radioAutoStarted: boolean;
  /** A station refill is in flight. */
  radioLoading: boolean;

  sleepTimerEnd: number | null;
  sleepTimerMinutes: number | null;

  play: (track?: Track, queue?: Track[]) => void;
  playAt: (index: number) => void;
  pause: () => void;
  resume: () => void;
  togglePlay: () => void;
  next: (opts?: { auto?: boolean }) => void;
  previous: () => void;
  peekNext: () => Track | null;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  toggleLyrics: () => void;
  toggleQueue: () => void;
  setCrossfade: (enabled: boolean, duration?: number) => void;
  setNormalizeVolume: (enabled: boolean) => void;
  setEqGain: (bandIndex: number, gain: number) => void;
  setEqPreset: (preset: string, gains: number[]) => void;
  toggleEq: () => void;
  toggleEqualizer: () => void;
  addToQueue: (tracks: Track[]) => void;
  playNext: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  clearQueue: () => void;
  setSleepTimer: (minutes: number | null) => void;
  /**
   * Play `track` (or keep playing it, if current) followed by a station of similar
   * tracks. Resolves false if no similar tracks were found.
   */
  startRadio: (track: Track) => Promise<boolean>;
  stopRadio: () => void;
  loadPreferences: (prefs: UserPreferences) => void;
  /** Swap in fresh copies of tracks (e.g. after the library loads) without touching playback. */
  refreshTracks: (fresh: Track[]) => void;
  /** Stop playback and forget the session (logout). */
  reset: () => void;
}

const initialSession = {
  currentTrack: null,
  queue: [] as Track[],
  queueIndex: -1,
  originalQueue: null,
  recentPlays: [] as string[],
  isPlaying: false,
  radioMode: false,
  radioSourceTrackId: null,
  radioAutoStarted: false,
  radioLoading: false,
  sleepTimerEnd: null,
  sleepTimerMinutes: null,
};

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => {
      const goTo = (index: number, queue: Track[], auto = false, playNow = true) => {
        const track = queue[index];
        if (!track) return;
        set((s) => ({
          currentTrack: track,
          queueIndex: index,
          isPlaying: playNow,
          autoAdvance: auto,
          loadId: s.loadId + 1,
          recentPlays: [...s.recentPlays.filter((id) => id !== track.id), track.id].slice(-RECENT_PLAYS),
        }));
        refillRadio();
      };

      /**
       * Append the next batch of the station, seeded by the current track and anchored to
       * the station's source. With `advance`, also move on to the first new track (used
       * when playback reached the end of the queue while waiting).
       */
      const extendRadio = (advance = false) => {
        const session = _radioSession;
        if (_radioFetch?.session === session) {
          _radioFetch.advance ||= advance;
          return;
        }
        const { currentTrack: seed, queue, queueIndex, radioSourceTrackId } = get();
        if (!seed) return;
        const fetch = { session, advance };
        _radioFetch = fetch;
        set({ radioLoading: true });

        const recent = queue.slice(Math.max(0, queueIndex - 4), queueIndex + 1).map((t) => t.id);
        // The ids go in the URL: past ~150 a long station's request exceeds the server's
        // header size limit. Older tracks are covered by the server's recently-played penalty.
        const exclude = [...new Set(queue.map((t) => t.id))].slice(-150);

        api.getSimilarTracks(seed.id, {
          limit: RADIO_BATCH,
          excludeIds: exclude.join(','),
          recentIds: recent.join(','),
          anchorId: radioSourceTrackId ?? undefined,
        })
          .then(({ similarTracks }) => {
            if (session !== _radioSession) return;
            // Done before advancing, so the move to the new track can start the next refill
            if (_radioFetch === fetch) _radioFetch = null;
            const { queue: now, queueIndex: index, currentTrack } = get();
            const present = new Set(now.map((t) => t.id));
            const fresh = similarTracks.filter((t) => !present.has(t.id));
            set({ queue: [...now, ...fresh] });
            if (fetch.advance && currentTrack?.id === seed.id) {
              // Paused while waiting: line the track up without starting it
              if (fresh.length > 0) goTo(index + 1, get().queue, true, get().isPlaying);
              else set({ isPlaying: false });
            }
          })
          .catch(() => {
            if (session === _radioSession && fetch.advance) set({ isPlaying: false });
          })
          .finally(() => {
            if (_radioFetch === fetch) _radioFetch = null;
            // A newer refill may already be in flight (started by the advance above)
            if (session === _radioSession && !_radioFetch) set({ radioLoading: false });
          });
      };

      /** Keep a station topped up a few tracks ahead, so preload and crossfade never run dry. */
      const refillRadio = () => {
        const { radioMode, queue, queueIndex } = get();
        if (radioMode && queue.length - 1 - queueIndex < RADIO_REFILL_AT) extendRadio();
      };

      /** A new queue that isn't the current station: drop any refill in flight. */
      const endRadioSession = () => {
        _radioSession++;
        _radioFetch = null;
        set({ radioMode: false, radioSourceTrackId: null, radioLoading: false });
      };

      return {
        ...initialSession,
        loadId: 0,
        autoAdvance: false,
        volume: 0.7,
        isMuted: false,
        shuffle: false,
        repeat: 'none',
        showLyrics: false,
        showQueue: false,
        crossfadeEnabled: false,
        crossfadeDuration: 3,
        normalizeVolume: true,
        eqEnabled: false,
        eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        eqPreset: 'Flat',
        showEqualizer: false,

        play: (track, queue) => {
          if (!track) {
            get().resume();
            return;
          }
          const source = queue && queue.length > 0 ? queue : [track];
          let index = source.findIndex((t) => t.id === track.id);
          let playQueue = source;
          if (index === -1) {
            playQueue = [track, ...source];
            index = 0;
          }
          if (get().shuffle) {
            set({ originalQueue: playQueue });
            playQueue = shuffledAround(playQueue, index, get().recentPlays);
            index = 0;
          } else {
            set({ originalQueue: null });
          }
          endRadioSession();
          set({ queue: playQueue });
          goTo(index, playQueue);
        },

        playAt: (index) => goTo(index, get().queue),

        pause: () => set({ isPlaying: false }),

        resume: () => {
          if (!get().currentTrack) return;
          set({ isPlaying: true });
          // A station restored from the last visit hasn't refilled since: top it up now
          refillRadio();
        },

        togglePlay: () => {
          const { isPlaying, currentTrack } = get();
          if (!currentTrack) return;
          set({ isPlaying: !isPlaying });
          if (!isPlaying) refillRadio();
        },

        peekNext: () => {
          const { queue, queueIndex, repeat } = get();
          if (queueIndex + 1 < queue.length) return queue[queueIndex + 1] ?? null;
          if (repeat === 'all') return queue[0] ?? null;
          return null;
        },

        next: (opts) => {
          const auto = opts?.auto ?? false;
          const { queue, queueIndex, repeat, currentTrack, radioMode } = get();
          if (queue.length === 0) return;

          // Record early manual skips (<30%) to down-rank tracks in Radio
          if (!auto && currentTrack) {
            const { progress, duration } = usePlaybackStore.getState();
            if (duration > 0 && progress / duration < 0.3) {
              api.logSkip(currentTrack.id, Math.round((progress / duration) * 100)).catch(() => {});
            }
          }

          if (queueIndex + 1 < queue.length) {
            goTo(queueIndex + 1, queue, auto);
          } else if (repeat === 'all') {
            goTo(0, queue, auto);
          } else if (currentTrack && radioMode) {
            // The station ran dry before a refill landed: wait for it
            extendRadio(true);
          } else if (currentTrack) {
            // End of queue: continue with similar tracks instead of stopping, like autoplay
            _radioSession++;
            set({ radioMode: true, radioSourceTrackId: currentTrack.id, radioAutoStarted: true, originalQueue: null });
            if (_radioAutoStartedTimeout) clearTimeout(_radioAutoStartedTimeout);
            _radioAutoStartedTimeout = setTimeout(() => set({ radioAutoStarted: false }), 4000);
            extendRadio(true);
          } else {
            set({ isPlaying: false });
          }
        },

        previous: () => {
          const { queue, queueIndex, repeat } = get();
          if (queue.length === 0) return;

          // More than 3 seconds in: restart the current track
          if (usePlaybackStore.getState().progress > 3) {
            get().seek(0);
            return;
          }

          if (queueIndex > 0) {
            goTo(queueIndex - 1, queue);
          } else if (repeat === 'all') {
            goTo(queue.length - 1, queue);
          } else {
            get().seek(0);
          }
        },

        seek: (time) => {
          audioEngine.seek(time);
          usePlaybackStore.getState().setProgress(time);
        },

        setVolume: (volume) => {
          set({ volume, isMuted: volume === 0 });
          _syncPrefsToServer(_extractPrefs(get()));
        },

        toggleMute: () => {
          set((s) => ({ isMuted: !s.isMuted }));
          _syncPrefsToServer(_extractPrefs(get()));
        },

        toggleShuffle: () => {
          const { shuffle, queue, queueIndex, originalQueue, currentTrack, radioMode } = get();
          if (radioMode) {
            // A station is already in a random order; the setting applies to the next playlist
            set({ shuffle: !shuffle });
          } else if (!shuffle) {
            set({
              shuffle: true,
              originalQueue: queue,
              queue: shuffledAround(queue, queueIndex, get().recentPlays),
              queueIndex: queue.length > 0 ? 0 : -1,
            });
          } else {
            // Restore the original order, keeping tracks added while shuffled
            let restored = queue;
            if (originalQueue) {
              const present = new Set(queue.map((t) => t.id));
              const kept = originalQueue.filter((t) => present.has(t.id));
              const keptIds = new Set(kept.map((t) => t.id));
              restored = [...kept, ...queue.filter((t) => !keptIds.has(t.id))];
            }
            const index = currentTrack ? restored.findIndex((t) => t.id === currentTrack.id) : -1;
            set({ shuffle: false, originalQueue: null, queue: restored, queueIndex: index });
          }
          _syncPrefsToServer(_extractPrefs(get()));
        },

        toggleLyrics: () => set((s) => ({ showLyrics: !s.showLyrics, showQueue: false })),

        toggleQueue: () => set((s) => ({ showQueue: !s.showQueue, showLyrics: false })),

        setCrossfade: (enabled, duration) => {
          set((s) => ({
            crossfadeEnabled: enabled,
            crossfadeDuration: duration ?? s.crossfadeDuration,
          }));
          _syncPrefsToServer(_extractPrefs(get()));
        },

        setNormalizeVolume: (enabled) => {
          set({ normalizeVolume: enabled });
          _syncPrefsToServer(_extractPrefs(get()));
        },

        setEqGain: (bandIndex, gain) => {
          set((s) => {
            const eqGains = [...s.eqGains];
            eqGains[bandIndex] = gain;
            return { eqGains, eqPreset: 'Custom' };
          });
          _syncPrefsToServer(_extractPrefs(get()));
        },

        setEqPreset: (preset, gains) => {
          set({ eqPreset: preset, eqGains: gains });
          _syncPrefsToServer(_extractPrefs(get()));
        },

        toggleEq: () => {
          set((s) => ({ eqEnabled: !s.eqEnabled }));
          _syncPrefsToServer(_extractPrefs(get()));
        },

        toggleEqualizer: () => set((s) => ({ showEqualizer: !s.showEqualizer })),

        toggleRepeat: () => {
          set((s) => ({
            repeat: s.repeat === 'none' ? 'all' : s.repeat === 'all' ? 'one' : 'none',
          }));
          _syncPrefsToServer(_extractPrefs(get()));
        },

        addToQueue: (tracks) =>
          set((s) => ({
            queue: [...s.queue, ...tracks],
            originalQueue: s.originalQueue ? [...s.originalQueue, ...tracks] : null,
          })),

        playNext: (track) =>
          set((s) => {
            const queue = [...s.queue];
            queue.splice(s.queueIndex + 1, 0, track);
            return {
              queue,
              originalQueue: s.originalQueue ? [...s.originalQueue, track] : null,
            };
          }),

        removeFromQueue: (index) => {
          const { queue, queueIndex, isPlaying } = get();
          if (index < 0 || index >= queue.length) return;
          const newQueue = queue.filter((_, i) => i !== index);

          if (index < queueIndex) {
            set({ queue: newQueue, queueIndex: queueIndex - 1 });
          } else if (index > queueIndex) {
            set({ queue: newQueue });
          } else if (newQueue.length === 0) {
            // Removed the only (current) track
            audioEngine.reset();
            set({ queue: [], queueIndex: -1, currentTrack: null, isPlaying: false, originalQueue: null });
          } else {
            // Removed the current track: move on to whatever now sits at this index
            const nextIndex = Math.min(index, newQueue.length - 1);
            set({ queue: newQueue });
            goTo(nextIndex, newQueue, false, isPlaying);
          }
        },

        reorderQueue: (fromIndex, toIndex) =>
          set((s) => {
            const queue = [...s.queue];
            const [removed] = queue.splice(fromIndex, 1);
            if (removed) queue.splice(toIndex, 0, removed);

            let queueIndex = s.queueIndex;
            if (fromIndex === s.queueIndex) {
              queueIndex = toIndex;
            } else if (fromIndex < s.queueIndex && toIndex >= s.queueIndex) {
              queueIndex--;
            } else if (fromIndex > s.queueIndex && toIndex <= s.queueIndex) {
              queueIndex++;
            }
            return { queue, queueIndex };
          }),

        clearQueue: () => {
          endRadioSession();
          set((s) => ({
            queue: s.currentTrack ? [s.currentTrack] : [],
            queueIndex: s.currentTrack ? 0 : -1,
            originalQueue: null,
          }));
        },

        setSleepTimer: (minutes) => {
          if (_sleepTimeout) clearTimeout(_sleepTimeout);
          _sleepTimeout = null;
          if (minutes === null) {
            set({ sleepTimerEnd: null, sleepTimerMinutes: null });
            return;
          }
          const ms = minutes * 60 * 1000;
          set({ sleepTimerEnd: Date.now() + ms, sleepTimerMinutes: minutes });
          _sleepTimeout = setTimeout(() => {
            _sleepTimeout = null;
            set({ isPlaying: false, sleepTimerEnd: null, sleepTimerMinutes: null });
          }, ms);
        },

        startRadio: (track) => {
          endRadioSession();
          const session = _radioSession;
          const keepPlaying = get().currentTrack?.id === track.id;
          // Start the song right away (or keep it going); the station fills in behind it
          const station = { queue: [track], originalQueue: null, radioMode: true, radioSourceTrackId: track.id };
          if (keepPlaying) {
            set({ ...station, queueIndex: 0, isPlaying: true });
          } else {
            set(station);
            goTo(0, [track]);
          }
          extendRadio();
          // Resolves once the first batch has landed (or failed)
          return new Promise<boolean>((resolve) => {
            const unsubscribe = usePlayerStore.subscribe((s) => {
              if (session !== _radioSession) {
                unsubscribe();
                resolve(false);
              } else if (!s.radioLoading) {
                unsubscribe();
                resolve(s.queue.length > 1);
              }
            });
          });
        },

        stopRadio: endRadioSession,

        loadPreferences: (prefs) => {
          const updates: Partial<PlayerState> = {};
          if (prefs.volume !== undefined) updates.volume = prefs.volume;
          if (prefs.isMuted !== undefined) updates.isMuted = prefs.isMuted;
          if (prefs.repeat !== undefined) updates.repeat = prefs.repeat;
          if (prefs.crossfadeEnabled !== undefined) updates.crossfadeEnabled = prefs.crossfadeEnabled;
          if (prefs.crossfadeDuration !== undefined) updates.crossfadeDuration = prefs.crossfadeDuration;
          if (prefs.normalizeVolume !== undefined) updates.normalizeVolume = prefs.normalizeVolume;
          if (prefs.eqEnabled !== undefined) updates.eqEnabled = prefs.eqEnabled;
          if (prefs.eqGains !== undefined) updates.eqGains = prefs.eqGains;
          if (prefs.eqPreset !== undefined) updates.eqPreset = prefs.eqPreset;
          // Shuffle is not applied from the server: it reorders the local queue,
          // which another device's preference shouldn't do silently.
          set(updates);
        },

        refreshTracks: (fresh) => {
          if (fresh.length === 0) return;
          const byId = new Map(fresh.map((t) => [t.id, t]));
          const swap = (t: Track) => byId.get(t.id) ?? t;
          const { currentTrack, queue, originalQueue } = get();
          set({
            currentTrack: currentTrack ? swap(currentTrack) : null,
            queue: queue.map(swap),
            originalQueue: originalQueue ? originalQueue.map(swap) : null,
          });
        },

        reset: () => {
          _radioSession++;
          _radioFetch = null;
          if (_sleepTimeout) clearTimeout(_sleepTimeout);
          _sleepTimeout = null;
          audioEngine.reset();
          usePlaybackStore.setState({ progress: 0, duration: 0, isBuffering: false });
          set((s) => ({ ...initialSession, loadId: s.loadId + 1, showLyrics: false, showQueue: false }));
        },
      };
    },
    {
      name: 'resonance-player-settings',
      storage: createJSONStorage(() => debouncedStorage),
      version: 2,
      // v1 persisted shuffleHistory and no originalQueue; dropping unknown keys is enough
      migrate: (persisted) => persisted as PlayerState,
      partialize: (state) => ({
        volume: state.volume,
        isMuted: state.isMuted,
        shuffle: state.shuffle,
        repeat: state.repeat,
        crossfadeEnabled: state.crossfadeEnabled,
        crossfadeDuration: state.crossfadeDuration,
        normalizeVolume: state.normalizeVolume,
        eqEnabled: state.eqEnabled,
        eqGains: state.eqGains,
        eqPreset: state.eqPreset,
        // Session persistence — restore last queue on next launch
        currentTrack: state.currentTrack,
        queue: state.queue,
        queueIndex: state.queueIndex,
        originalQueue: state.originalQueue,
        recentPlays: state.recentPlays,
        radioMode: state.radioMode,
        radioSourceTrackId: state.radioSourceTrackId,
      }),
    }
  )
);
