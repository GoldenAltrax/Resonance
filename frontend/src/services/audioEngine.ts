/**
 * Audio engine: two <audio> "decks" so the next track can be preloaded (gapless)
 * and two tracks can overlap (true crossfade).
 *
 * Signal path when Web Audio is available:
 *   deck A <audio> → MediaElementSource → normGain A → deckGain A ┐
 *   deck B <audio> → MediaElementSource → normGain B → deckGain B ┴→ masterGain (volume) → 10× EQ → destination
 *
 * normGain holds the track's loudness-normalization gain; deckGain is the fade/mute level.
 *
 * Volume lives in exactly one place: masterGain when Web Audio is active, otherwise
 * HTMLMediaElement.volume. (Applying both squares the volume curve.)
 *
 * iOS/iPadOS: Web Audio is skipped. Routing a media element through an AudioContext there
 * stops playback when the screen locks, and element.volume is read-only, so EQ, crossfade
 * and normalization are unavailable; playback falls back to plain elements with gapless preload.
 */

import { dbToLinear, normalizationGainDb, type LoudnessInfo } from '@/utils/loudness';

export interface EngineCallbacks {
  onTimeUpdate: (time: number) => void;
  onDurationChange: (duration: number) => void;
  onEnded: () => void;
  onError: (message: string) => void;
  onBuffering: (buffering: boolean) => void;
  onPlaying: () => void;
  /** The active element was paused by something other than us (headphones unplugged, OS interruption). */
  onExternalPause: () => void;
  /** play() was rejected by the browser's autoplay policy. */
  onPlayBlocked: () => void;
}

/** What the engine needs to know about a track. */
export interface EngineTrack extends LoudnessInfo {
  id: string;
}

interface Deck {
  el: HTMLAudioElement;
  norm: GainNode | null;
  gain: GainNode | null;
  trackId: string | null;
  loudness: LoudnessInfo | null;
}

const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const IS_IOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  // iPadOS 13+ reports itself as macOS
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const AudioContextCtor: typeof AudioContext | undefined =
  window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

export class AudioEngine {
  readonly supportsWebAudio = !IS_IOS && !!AudioContextCtor;

  private decks: [Deck, Deck];
  private activeIndex = 0;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private eqNodes: BiquadFilterNode[] = [];
  private volume = 1;
  private eqEnabled = false;
  private eqGains: number[] = Array(10).fill(0);
  private normalize = true;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingStartAt: number | null = null;
  // Set while we pause an element ourselves, so the 'pause' event isn't mistaken for an external pause
  private selfPausing = new WeakSet<HTMLAudioElement>();
  private callbacks: EngineCallbacks | null = null;

  constructor() {
    this.decks = [this.createDeck(), this.createDeck()];
  }

  get active(): Deck {
    return this.decks[this.activeIndex]!;
  }

  private get inactive(): Deck {
    return this.decks[1 - this.activeIndex]!;
  }

  get currentTime(): number {
    return this.active.el.currentTime;
  }

  get duration(): number {
    const d = this.active.el.duration;
    return Number.isFinite(d) ? d : 0;
  }

  get isFading(): boolean {
    return this.fadeTimer !== null;
  }

  setCallbacks(callbacks: EngineCallbacks | null) {
    this.callbacks = callbacks;
  }

  private createDeck(): Deck {
    const el = new Audio();
    el.preload = 'auto';
    el.crossOrigin = 'anonymous'; // required for Web Audio to read cross-origin (dev proxy) media
    const deck: Deck = { el, norm: null, gain: null, trackId: null, loudness: null };
    const isActive = () => this.active === deck;

    el.addEventListener('timeupdate', () => {
      if (isActive()) this.callbacks?.onTimeUpdate(el.currentTime);
    });
    el.addEventListener('loadedmetadata', () => {
      if (!isActive()) return;
      if (this.pendingStartAt !== null) {
        const start = this.pendingStartAt;
        this.pendingStartAt = null;
        if (start > 0 && start < el.duration - 1) el.currentTime = start;
      }
      this.callbacks?.onDurationChange(el.duration);
    });
    el.addEventListener('durationchange', () => {
      if (isActive()) this.callbacks?.onDurationChange(el.duration);
    });
    el.addEventListener('ended', () => {
      if (isActive()) this.callbacks?.onEnded();
    });
    el.addEventListener('error', () => {
      // An emptied src (we clear decks after use) also fires 'error' — ignore those
      if (!isActive() || !el.getAttribute('src')) return;
      const code = el.error?.code;
      const reason =
        code === MediaError.MEDIA_ERR_NETWORK ? 'network error'
        : code === MediaError.MEDIA_ERR_DECODE ? 'the file could not be decoded'
        : code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? 'the file is unavailable'
        : 'unknown error';
      this.callbacks?.onError(reason);
    });
    el.addEventListener('waiting', () => {
      if (isActive()) this.callbacks?.onBuffering(true);
    });
    el.addEventListener('playing', () => {
      if (!isActive()) return;
      this.callbacks?.onBuffering(false);
      this.callbacks?.onPlaying();
    });
    el.addEventListener('canplay', () => {
      if (isActive()) this.callbacks?.onBuffering(false);
    });
    el.addEventListener('pause', () => {
      if (this.selfPausing.has(el)) {
        this.selfPausing.delete(el);
        return;
      }
      // 'pause' also fires right before 'ended'; that case is handled by onEnded
      if (isActive() && !el.ended && !this.isFading) this.callbacks?.onExternalPause();
    });

    return deck;
  }

  /**
   * Build the Web Audio graph. Must run inside a user gesture (click/keydown/touch) so the
   * AudioContext starts in the 'running' state. Safe to call repeatedly.
   */
  unlock() {
    if (!this.supportsWebAudio) return;
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const ctx = new AudioContextCtor!();
      const master = ctx.createGain();
      master.gain.value = this.volume;

      this.eqNodes = EQ_FREQUENCIES.map((freq, i) => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1.4;
        filter.gain.value = this.eqEnabled ? (this.eqGains[i] ?? 0) : 0;
        return filter;
      });

      let node: AudioNode = master;
      for (const eq of this.eqNodes) {
        node.connect(eq);
        node = eq;
      }
      node.connect(ctx.destination);

      for (const deck of this.decks) {
        const source = ctx.createMediaElementSource(deck.el);
        const norm = ctx.createGain();
        norm.gain.value = this.normalizationFactor(deck);
        const gain = ctx.createGain();
        gain.gain.value = deck === this.active ? 1 : 0;
        source.connect(norm).connect(gain).connect(master);
        deck.norm = norm;
        deck.gain = gain;
        deck.el.volume = 1;
      }

      this.ctx = ctx;
      this.master = master;
    } catch (err) {
      console.warn('Web Audio unavailable, using plain audio elements:', err);
      this.ctx = null;
      this.master = null;
      this.applyVolume();
    }
  }

  get webAudioActive(): boolean {
    return this.master !== null;
  }

  /** Hard switch to a track on the active deck (or swap to a deck that already preloaded it). */
  load(track: EngineTrack, url: string, opts: { autoplay: boolean; startAt?: number }) {
    this.cancelFade();
    this.pendingStartAt = opts.startAt ?? null;

    const preloaded = this.inactive;
    if (preloaded.trackId === track.id && preloaded.el.getAttribute('src')) {
      // Gapless: the next track is already buffered on the other deck
      const previous = this.active;
      this.activeIndex = 1 - this.activeIndex;
      this.stopDeck(previous);
      this.setDeckLevel(this.active, 1);
      if (this.pendingStartAt !== null && this.active.el.readyState >= HTMLMediaElement.HAVE_METADATA) {
        this.active.el.currentTime = this.pendingStartAt;
        this.pendingStartAt = null;
      }
      this.callbacks?.onDurationChange(this.active.el.duration);
      this.callbacks?.onTimeUpdate(this.active.el.currentTime);
    } else {
      this.stopDeck(this.inactive);
      const deck = this.active;
      this.pause(deck.el);
      this.assignTrack(deck, track);
      // A restored (paused) session only needs metadata; don't download the whole file on page load
      deck.el.preload = opts.autoplay ? 'auto' : 'metadata';
      deck.el.src = url;
      deck.el.load();
      this.setDeckLevel(deck, 1);
      this.callbacks?.onBuffering(opts.autoplay);
    }

    if (opts.autoplay) this.play();
  }

  /** Overlap the current track with the next one over `seconds`. */
  crossfadeTo(track: EngineTrack, url: string, seconds: number) {
    if (!this.ctx || !this.master || seconds <= 0) {
      this.load(track, url, { autoplay: true });
      return;
    }
    this.cancelFade();
    this.pendingStartAt = null;

    const outgoing = this.active;
    const incoming = this.inactive;
    if (incoming.trackId !== track.id || !incoming.el.getAttribute('src')) {
      this.assignTrack(incoming, track);
      incoming.el.src = url;
      incoming.el.load();
    }

    const now = this.ctx.currentTime;
    outgoing.gain!.gain.cancelScheduledValues(now);
    outgoing.gain!.gain.setValueAtTime(outgoing.gain!.gain.value, now);
    outgoing.gain!.gain.linearRampToValueAtTime(0, now + seconds);
    incoming.gain!.gain.cancelScheduledValues(now);
    incoming.gain!.gain.setValueAtTime(0, now);
    incoming.gain!.gain.linearRampToValueAtTime(1, now + seconds);

    this.activeIndex = 1 - this.activeIndex;
    this.callbacks?.onDurationChange(incoming.el.duration);
    this.callbacks?.onTimeUpdate(0);
    this.play();

    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = null;
      this.stopDeck(outgoing);
    }, seconds * 1000 + 50);
  }

  /** Buffer the upcoming track on the idle deck so the switch is instant. */
  preload(track: EngineTrack, url: string) {
    if (this.isFading) return;
    const deck = this.inactive;
    if (deck.trackId === track.id && deck.el.getAttribute('src')) return;
    this.pause(deck.el);
    this.assignTrack(deck, track);
    deck.el.preload = 'auto';
    deck.el.src = url;
    deck.el.load();
    this.setDeckLevel(deck, 0);
  }

  preloadedTrackId(): string | null {
    const deck = this.inactive;
    return deck.el.getAttribute('src') ? deck.trackId : null;
  }

  play() {
    if (this.ctx && this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});
    }
    const el = this.active.el;
    if (!el.getAttribute('src')) return;
    el.preload = 'auto';
    el.play().catch((err: DOMException) => {
      if (err.name === 'NotAllowedError') this.callbacks?.onPlayBlocked();
      // AbortError: a newer load() interrupted this play() — expected when skipping quickly
    });
  }

  pauseAll() {
    // Finish any crossfade immediately so the outgoing track doesn't keep playing
    if (this.isFading) {
      this.cancelFade();
      this.stopDeck(this.inactive);
      this.setDeckLevel(this.active, 1);
    }
    this.pause(this.active.el);
  }

  seek(time: number) {
    const el = this.active.el;
    if (!Number.isFinite(time)) return;
    const max = Number.isFinite(el.duration) ? el.duration : time;
    el.currentTime = Math.max(0, Math.min(time, max));
  }

  restart() {
    this.seek(0);
    this.play();
  }

  /** Stop and unload everything (logout). */
  reset() {
    this.cancelFade();
    for (const deck of this.decks) this.stopDeck(deck);
    this.setDeckLevel(this.active, 1);
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyVolume();
  }

  setEq(enabled: boolean, gains: number[]) {
    this.eqEnabled = enabled;
    this.eqGains = gains;
    this.eqNodes.forEach((node, i) => {
      node.gain.value = enabled ? (gains[i] ?? 0) : 0;
    });
  }

  setNormalization(enabled: boolean) {
    if (this.normalize === enabled) return;
    this.normalize = enabled;
    for (const deck of this.decks) this.applyNormalization(deck);
    if (!this.master) this.applyVolume();
  }

  /** Pick up new loudness measurements for tracks already loaded on a deck. */
  refreshTracks(tracks: EngineTrack[]) {
    for (const deck of this.decks) {
      const track = tracks.find((t) => t.id === deck.trackId);
      if (track) this.assignTrack(deck, track);
    }
    if (!this.master) this.applyVolume();
  }

  private assignTrack(deck: Deck, track: EngineTrack) {
    deck.trackId = track.id;
    deck.loudness = { loudness: track.loudness ?? null, truePeak: track.truePeak ?? null };
    this.applyNormalization(deck);
  }

  private normalizationFactor(deck: Deck): number {
    return this.normalize && deck.loudness ? dbToLinear(normalizationGainDb(deck.loudness)) : 1;
  }

  private applyNormalization(deck: Deck) {
    if (deck.norm && this.ctx) {
      deck.norm.gain.setValueAtTime(this.normalizationFactor(deck), this.ctx.currentTime);
    }
  }

  /** element.volume for the plain-element fallback; it cannot exceed 1, so boosts are dropped. */
  private elementVolume(deck: Deck, level: number): number {
    return Math.min(1, level * this.volume * this.normalizationFactor(deck));
  }

  private applyVolume() {
    if (this.master) {
      this.master.gain.value = this.volume;
    } else {
      // Plain-element fallback (no Web Audio). Ignored by iOS, where volume is hardware-only.
      for (const deck of this.decks) deck.el.volume = deck === this.active ? this.elementVolume(deck, 1) : 0;
    }
  }

  private setDeckLevel(deck: Deck, level: number) {
    if (deck.gain && this.ctx) {
      deck.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      deck.gain.gain.setValueAtTime(level, this.ctx.currentTime);
    } else {
      deck.el.volume = this.elementVolume(deck, level);
    }
  }

  private pause(el: HTMLAudioElement) {
    if (el.paused) return;
    this.selfPausing.add(el);
    el.pause();
  }

  private stopDeck(deck: Deck) {
    this.pause(deck.el);
    deck.trackId = null;
    deck.loudness = null;
    if (deck.el.getAttribute('src')) {
      deck.el.removeAttribute('src');
      deck.el.load(); // releases the network connection and decoder
    }
  }

  private cancelFade() {
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
  }
}

export const audioEngine = new AudioEngine();
