import { describe, it, expect, beforeAll, vi } from 'vitest';

// Minimal Web Audio stand-in: records gain values, connects nothing
class FakeParam {
  value = 1;
  setValueAtTime(v: number) { this.value = v; }
  cancelScheduledValues() {}
  linearRampToValueAtTime(v: number) { this.value = v; }
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  type = '';
  connect<T>(next: T): T { return next; }
}
class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = new FakeNode();
  createGain() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createMediaElementSource() { return new FakeNode(); }
  resume() { return Promise.resolve(); }
}

type Engine = import('./audioEngine').AudioEngine;
let engine: Engine;
const decks = () => (engine as unknown as { decks: { norm: FakeNode | null; trackId: string | null }[] }).decks;
const normFor = (id: string) => decks().find((d) => d.trackId === id)?.norm?.gain.value;

beforeAll(async () => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  // jsdom does not implement media loading; the engine only needs the calls to exist
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const { AudioEngine } = await import('./audioEngine');
  engine = new AudioEngine();
  engine.unlock();
});

describe('AudioEngine normalization', () => {
  it('applies the track gain on the deck that holds it', () => {
    engine.preload({ id: 'loud', loudness: -8, truePeak: 2 }, '/a.mp3');
    expect(normFor('loud')).toBeCloseTo(Math.pow(10, -6 / 20));
  });

  it('turns off and on without reloading', () => {
    engine.setNormalization(false);
    expect(normFor('loud')).toBe(1);
    engine.setNormalization(true);
    expect(normFor('loud')).toBeCloseTo(Math.pow(10, -6 / 20));
  });

  it('leaves unmeasured tracks at unity and picks up measurements later', () => {
    engine.load({ id: 'new', loudness: null, truePeak: null }, '/b.mp3', { autoplay: false });
    expect(normFor('new')).toBe(1);
    engine.refreshTracks([{ id: 'new', loudness: -20, truePeak: -10 }]);
    expect(normFor('new')).toBeCloseTo(Math.pow(10, 6 / 20));
  });
});
