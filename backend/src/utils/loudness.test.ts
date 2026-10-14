import { describe, it, expect } from 'vitest';
import { parseVolumeStats, energyFromMeanVolume } from './loudness.js';

const SAMPLE = `[Parsed_volumedetect_0 @ 0x1] n_samples: 23729024
[Parsed_volumedetect_0 @ 0x1] mean_volume: -10.0 dB
[Parsed_volumedetect_0 @ 0x1] max_volume: 0.0 dB
[Parsed_ebur128_1 @ 0x2] Summary:

  Integrated loudness:
    I:          -7.6 LUFS
    Threshold: -17.9 LUFS

  Loudness range:
    LRA:         4.5 LU
    Threshold: -27.8 LUFS

  True peak:
    Peak:        0.5 dBFS
`;

describe('parseVolumeStats', () => {
  it('reads mean volume, integrated loudness and true peak', () => {
    expect(parseVolumeStats(SAMPLE)).toEqual({ meanVolume: -10, loudness: -7.6, truePeak: 0.5 });
  });

  it('ignores per-frame lines before the summary', () => {
    const frame = '[Parsed_ebur128_1 @ 0x2] t: 1.0 TARGET:-23 LUFS M: -20.0 S: -21.0 I: -30.0 LUFS LRA: 0.0 LU\n';
    expect(parseVolumeStats(frame + SAMPLE).loudness).toBe(-7.6);
  });

  it('treats silence as unmeasured', () => {
    const silent = SAMPLE.replace('-7.6 LUFS', '-70.0 LUFS').replace('0.5 dBFS', '-inf dBFS');
    expect(parseVolumeStats(silent)).toMatchObject({ loudness: null, truePeak: null });
  });

  it('reads mean volume printed after the ebur128 summary', () => {
    const [volume, summary] = SAMPLE.split('[Parsed_ebur128_1');
    expect(parseVolumeStats(`[Parsed_ebur128_1${summary}${volume}`)).toEqual({ meanVolume: -10, loudness: -7.6, truePeak: 0.5 });
  });

  it('returns nulls when ffmpeg printed nothing useful', () => {
    expect(parseVolumeStats('')).toEqual({ meanVolume: null, loudness: null, truePeak: null });
  });
});

describe('energyFromMeanVolume', () => {
  it('maps -60..0 dB onto 0..100 and clamps', () => {
    expect(energyFromMeanVolume(-60)).toBe(0);
    expect(energyFromMeanVolume(-30)).toBe(50);
    expect(energyFromMeanVolume(5)).toBe(100);
    expect(energyFromMeanVolume(null)).toBeNull();
  });
});
