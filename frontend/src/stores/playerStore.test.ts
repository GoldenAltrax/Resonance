import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Track } from '@/services/api';

vi.mock('@/services/api', () => ({
  api: {
    logSkip: vi.fn(() => Promise.resolve()),
    getSimilarTracks: vi.fn(() => Promise.resolve({ similarTracks: [] })),
    updatePreferences: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@/services/audioEngine', () => ({
  audioEngine: { seek: vi.fn(), reset: vi.fn() },
}));

const { usePlayerStore, shuffleArray } = await import('@/stores/playerStore');
const { usePlaybackStore } = await import('@/stores/playbackStore');
const { api } = await import('@/services/api');

const track = (id: string): Track => ({
  id,
  title: `Track ${id}`,
  artist: null,
  album: null,
  duration: 200,
  filePath: `${id}.mp3`,
  originalFilename: null,
  coverArt: null,
  bpm: null,
  key: null,
  energy: null,
  loudness: null,
  truePeak: null,
  userId: 'u1',
  createdAt: '2026-01-01',
});

const tracks = ['a', 'b', 'c', 'd', 'e'].map(track);
const ids = (list: Track[]) => list.map((t) => t.id);
const state = () => usePlayerStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  state().reset();
  usePlayerStore.setState({ shuffle: false, repeat: 'none' });
  usePlaybackStore.setState({ progress: 0, duration: 0 });
});

describe('shuffleArray', () => {
  it('returns a permutation without mutating the input', () => {
    const input = [1, 2, 3, 4, 5, 6];
    const result = shuffleArray(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...result].sort()).toEqual(input);
  });
});

describe('play', () => {
  it('starts at the chosen track and bumps loadId', () => {
    const before = state().loadId;
    state().play(tracks[2], tracks);
    expect(state().currentTrack?.id).toBe('c');
    expect(state().queueIndex).toBe(2);
    expect(state().isPlaying).toBe(true);
    expect(state().loadId).toBe(before + 1);
  });

  it('prepends the track when it is not in the given queue', () => {
    state().play(track('x'), tracks);
    expect(state().queue[0]?.id).toBe('x');
    expect(state().queueIndex).toBe(0);
  });

  it('with shuffle on, puts the chosen track first and keeps the original order', () => {
    usePlayerStore.setState({ shuffle: true });
    state().play(tracks[3], tracks);
    expect(state().queue[0]?.id).toBe('d');
    expect(state().queueIndex).toBe(0);
    expect([...ids(state().queue)].sort()).toEqual(ids(tracks));
    expect(ids(state().originalQueue ?? [])).toEqual(ids(tracks));
  });
});

describe('next / previous', () => {
  it('advances through the queue', () => {
    state().play(tracks[0], tracks);
    state().next();
    expect(state().currentTrack?.id).toBe('b');
  });

  it('wraps at the end only with repeat all', () => {
    state().play(tracks[4], tracks);
    usePlayerStore.setState({ repeat: 'all' });
    state().next();
    expect(state().currentTrack?.id).toBe('a');
  });

  it('flags automatic advances for crossfade', () => {
    state().play(tracks[0], tracks);
    state().next({ auto: true });
    expect(state().autoAdvance).toBe(true);
    state().next();
    expect(state().autoAdvance).toBe(false);
  });

  it('logs a skip for manual early skips only', () => {
    state().play(tracks[0], tracks);
    usePlaybackStore.setState({ progress: 10, duration: 200 });
    state().next();
    expect(api.logSkip).toHaveBeenCalledWith('a', 5);

    usePlaybackStore.setState({ progress: 10, duration: 200 });
    state().next({ auto: true });
    expect(api.logSkip).toHaveBeenCalledTimes(1);
  });

  it('previous restarts the track after 3 seconds', () => {
    state().play(tracks[2], tracks);
    usePlaybackStore.setState({ progress: 30 });
    state().previous();
    expect(state().currentTrack?.id).toBe('c');
    expect(usePlaybackStore.getState().progress).toBe(0);
  });

  it('previous goes back near the start, and does not wrap at index 0', () => {
    state().play(tracks[1], tracks);
    state().previous();
    expect(state().currentTrack?.id).toBe('a');
    state().previous();
    expect(state().currentTrack?.id).toBe('a');
  });

  it('peekNext reports the upcoming track for preload', () => {
    state().play(tracks[3], tracks);
    expect(state().peekNext()?.id).toBe('e');
    state().next();
    expect(state().peekNext()).toBeNull();
    usePlayerStore.setState({ repeat: 'all' });
    expect(state().peekNext()?.id).toBe('a');
  });
});

describe('toggleShuffle', () => {
  it('reorders around the current track and restores the original order', () => {
    state().play(tracks[2], tracks);
    state().toggleShuffle();
    expect(state().shuffle).toBe(true);
    expect(state().queue[0]?.id).toBe('c');
    expect(state().queueIndex).toBe(0);

    state().toggleShuffle();
    expect(ids(state().queue)).toEqual(ids(tracks));
    expect(state().queueIndex).toBe(2);
  });

  it('keeps tracks added while shuffled when turning shuffle off', () => {
    state().play(tracks[0], tracks);
    state().toggleShuffle();
    state().addToQueue([track('z')]);
    state().toggleShuffle();
    expect(ids(state().queue)).toEqual([...ids(tracks), 'z']);
  });
});

describe('queue editing', () => {
  it('removing a track before the current one keeps the current track', () => {
    state().play(tracks[2], tracks);
    state().removeFromQueue(0);
    expect(state().currentTrack?.id).toBe('c');
    expect(state().queueIndex).toBe(1);
  });

  it('removing the current track moves on to the next one', () => {
    state().play(tracks[2], tracks);
    state().removeFromQueue(2);
    expect(state().currentTrack?.id).toBe('d');
  });

  it('removing the only track stops playback', () => {
    state().play(tracks[0], [tracks[0]!]);
    state().removeFromQueue(0);
    expect(state().currentTrack).toBeNull();
    expect(state().isPlaying).toBe(false);
  });

  it('reordering keeps queueIndex pointing at the current track', () => {
    state().play(tracks[2], tracks);
    state().reorderQueue(0, 4);
    expect(state().queue[state().queueIndex]?.id).toBe('c');
    state().reorderQueue(4, 0);
    expect(state().queue[state().queueIndex]?.id).toBe('c');
    state().reorderQueue(state().queueIndex, 4);
    expect(state().queue[state().queueIndex]?.id).toBe('c');
  });

  it('playNext inserts right after the current track', () => {
    state().play(tracks[1], tracks);
    state().playNext(track('n'));
    expect(state().queue[2]?.id).toBe('n');
  });

  it('clearQueue keeps only the current track', () => {
    state().play(tracks[3], tracks);
    state().clearQueue();
    expect(ids(state().queue)).toEqual(['d']);
    expect(state().queueIndex).toBe(0);
  });
});

describe('sleep timer', () => {
  it('pauses when the timer fires and can be cancelled', () => {
    vi.useFakeTimers();
    try {
      state().play(tracks[0], tracks);
      state().setSleepTimer(1);
      vi.advanceTimersByTime(59_000);
      expect(state().isPlaying).toBe(true);
      vi.advanceTimersByTime(1_000);
      expect(state().isPlaying).toBe(false);
      expect(state().sleepTimerEnd).toBeNull();

      state().resume();
      state().setSleepTimer(1);
      state().setSleepTimer(null);
      vi.advanceTimersByTime(120_000);
      expect(state().isPlaying).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('reset', () => {
  it('forgets the session but keeps settings', () => {
    usePlayerStore.setState({ volume: 0.4 });
    state().play(tracks[0], tracks);
    state().reset();
    expect(state().currentTrack).toBeNull();
    expect(state().queue).toEqual([]);
    expect(state().volume).toBe(0.4);
  });
});

describe('refreshTracks', () => {
  it('swaps in fresh track data without reloading or reordering', () => {
    state().play(tracks[1], tracks);
    const loadId = state().loadId;
    const fresh = { ...track('b'), title: 'Renamed', loudness: -9, truePeak: 1 };
    state().refreshTracks([fresh]);
    expect(state().currentTrack).toBe(fresh);
    expect(state().queue[1]).toBe(fresh);
    expect(ids(state().queue)).toEqual(ids(tracks));
    expect(state().loadId).toBe(loadId);
  });
});
