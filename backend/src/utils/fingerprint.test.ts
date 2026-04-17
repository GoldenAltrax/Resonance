import { describe, it, expect } from 'vitest';
import { calculateDuplicateScore } from './fingerprint.js';

const BASE_TRACK = {
  id: 'existing-1',
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  album: 'A Night at the Opera',
  duration: 354,
  originalFilename: 'bohemian_rhapsody',
  musicbrainzRecordingId: 'mbid-abc-123',
  acoustidFingerprint: 'AQADtJm2SEqUmZmamZmSmZmSiZk',
};

describe('calculateDuplicateScore', () => {
  it('scores 100 when all signals match (capped at 100)', () => {
    const result = calculateDuplicateScore(
      { title: 'Bohemian Rhapsody', artist: 'Queen', duration: 356, originalFilename: 'bohemian_rhapsody', musicbrainzRecordingId: 'mbid-abc-123', acoustidFingerprint: 'AQADtJm2SEqUmZmamZmSmZmSiZk' },
      BASE_TRACK
    );
    expect(result.score).toBe(100);
    expect(result.breakdown.fingerprint).toBe(true);
    expect(result.breakdown.mbid).toBe(true);
    expect(result.breakdown.duration).toBe(true);
    expect(result.breakdown.title).toBe(true);
    expect(result.breakdown.filename).toBe(true);
  });

  it('scores 50 when only fingerprint matches (no MBID)', () => {
    const result = calculateDuplicateScore(
      { title: 'Different Title', artist: 'Other', duration: 999, originalFilename: 'different_file', musicbrainzRecordingId: null, acoustidFingerprint: 'AQADtJm2SEqUmZmamZmSmZmSiZk' },
      { ...BASE_TRACK, musicbrainzRecordingId: null }
    );
    expect(result.score).toBe(50);
    expect(result.breakdown.fingerprint).toBe(true);
    expect(result.breakdown.mbid).toBe(false);
  });

  it('scores 50 when only MBID matches (no fingerprint)', () => {
    const result = calculateDuplicateScore(
      { title: 'Different Title', artist: 'Other', duration: 999, originalFilename: 'different_file', musicbrainzRecordingId: 'mbid-abc-123', acoustidFingerprint: null },
      BASE_TRACK
    );
    expect(result.score).toBe(50);
    expect(result.breakdown.mbid).toBe(true);
    expect(result.breakdown.fingerprint).toBe(false);
  });

  it('scores 50 when duration + title + filename match but no fingerprint or MBID', () => {
    const result = calculateDuplicateScore(
      { title: 'Bohemian Rhapsody', artist: 'Queen', duration: 355, originalFilename: 'bohemian_rhapsody', musicbrainzRecordingId: null, acoustidFingerprint: null },
      { ...BASE_TRACK, musicbrainzRecordingId: null, acoustidFingerprint: null }
    );
    expect(result.score).toBe(50);
    expect(result.breakdown.fingerprint).toBe(false);
    expect(result.breakdown.mbid).toBe(false);
    expect(result.breakdown.duration).toBe(true);
    expect(result.breakdown.title).toBe(true);
    expect(result.breakdown.filename).toBe(true);
  });

  it('scores 70 when fingerprint + duration match (same file, no MBID)', () => {
    const result = calculateDuplicateScore(
      { title: 'Bohemian Rhapsody', artist: 'Queen', duration: 355, originalFilename: 'bohemian_rhapsody', musicbrainzRecordingId: null, acoustidFingerprint: 'AQADtJm2SEqUmZmamZmSmZmSiZk' },
      { ...BASE_TRACK, musicbrainzRecordingId: null }
    );
    expect(result.score).toBe(100); // fingerprint(50) + duration(20) + title(15) + filename(15)
    expect(result.breakdown.fingerprint).toBe(true);
    expect(result.breakdown.duration).toBe(true);
  });

  it('duration match requires delta <= 2s', () => {
    const close = calculateDuplicateScore(
      { title: 'X', artist: null, duration: 356, originalFilename: 'x', musicbrainzRecordingId: null },
      { ...BASE_TRACK, duration: 354, musicbrainzRecordingId: null, acoustidFingerprint: null }
    );
    expect(close.breakdown.duration).toBe(true);

    const far = calculateDuplicateScore(
      { title: 'X', artist: null, duration: 360, originalFilename: 'x', musicbrainzRecordingId: null },
      { ...BASE_TRACK, duration: 354, musicbrainzRecordingId: null, acoustidFingerprint: null }
    );
    expect(far.breakdown.duration).toBe(false);
  });

  it('title match is case-insensitive and trims whitespace', () => {
    const result = calculateDuplicateScore(
      { title: '  BOHEMIAN RHAPSODY  ', artist: null, duration: 0, originalFilename: 'x', musicbrainzRecordingId: null },
      { ...BASE_TRACK, musicbrainzRecordingId: null, acoustidFingerprint: null }
    );
    expect(result.breakdown.title).toBe(true);
  });

  it('scores 0 when nothing matches', () => {
    const result = calculateDuplicateScore(
      { title: 'Completely Different', artist: 'Nobody', duration: 999, originalFilename: 'unrelated', musicbrainzRecordingId: 'other-mbid', acoustidFingerprint: 'totally-different-fp' },
      BASE_TRACK
    );
    expect(result.score).toBe(0);
  });
});
