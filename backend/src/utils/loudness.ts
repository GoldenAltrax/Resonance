/**
 * Parsing for the single ffmpeg analysis pass (`ebur128=peak=true,volumedetect`).
 * Kept free of I/O so it can be unit-tested against captured ffmpeg output.
 */

/**
 * Audio filter chain: EBU R128 loudness and true peak, plus mean volume (Radio energy).
 * ebur128 must come first: volumedetect only accepts 16-bit samples, and the conversion to
 * feed it clips the inter-sample overs that the true-peak measurement exists to catch.
 */
export const ANALYSIS_FILTER = 'ebur128=peak=true:framelog=verbose,volumedetect';

export interface VolumeStats {
  /** volumedetect mean volume, dB */
  meanVolume: number | null;
  /** Integrated loudness, LUFS */
  loudness: number | null;
  /** True peak, dBTP */
  truePeak: number | null;
}

function finite(match: RegExpMatchArray | null): number | null {
  if (!match?.[1]) return null;
  const value = parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function parseVolumeStats(stderr: string): VolumeStats {
  // ebur128 prints its totals after "Summary:"; anything before it is per-frame noise
  const summary = stderr.slice(Math.max(0, stderr.lastIndexOf('Summary:')));
  const loudness = finite(summary.match(/\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/));
  return {
    meanVolume: finite(stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/)),
    // ebur128 reports -70 LUFS (its gate floor) for silence; that is not a usable measurement
    loudness: loudness !== null && loudness > -70 ? loudness : null,
    // "-inf" for digital silence fails the number pattern and becomes null
    truePeak: finite(summary.match(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/)),
  };
}

/** volumedetect mean volume (-60..0 dB) mapped to the 0–100 energy scale used by Radio. */
export function energyFromMeanVolume(meanDb: number | null): number | null {
  if (meanDb === null) return null;
  return Math.max(0, Math.min(100, Math.round((meanDb + 60) * (100 / 60))));
}
