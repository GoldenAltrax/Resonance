/**
 * Volume normalization: the gain that brings a track to a common loudness.
 *
 * Mirrors how Spotify's "Normal" level behaves: aim for -14 LUFS, never boost a track so far
 * that its true peak exceeds -1 dBTP (lossy decoders overshoot near 0 dB and clip), and leave
 * implausible measurements alone. Because boosts are peak-capped, no limiter is needed.
 */

export const TARGET_LUFS = -14;
/** Headroom kept below full scale when boosting quiet tracks (all stored formats are lossy). */
const PEAK_CEILING_DB = -1;
/** Gains outside this range mean a bad measurement, not a real track. */
const MIN_GAIN_DB = -40;
const MAX_GAIN_DB = 42;

export interface LoudnessInfo {
  loudness: number | null;
  truePeak: number | null;
}

/** Gain in dB to apply to a track; 0 when it has not been measured. */
export function normalizationGainDb(track: LoudnessInfo): number {
  if (track.loudness === null || !Number.isFinite(track.loudness)) return 0;
  let gain = TARGET_LUFS - track.loudness;
  if (gain < MIN_GAIN_DB || gain > MAX_GAIN_DB) return 0;

  if (gain > 0 && track.truePeak !== null && Number.isFinite(track.truePeak)) {
    if (gain + track.truePeak > PEAK_CEILING_DB) {
      gain = track.truePeak > PEAK_CEILING_DB ? 0 : PEAK_CEILING_DB - track.truePeak;
    }
  }
  return gain;
}

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}
