import { describe, it, expect } from 'vitest';
import { normalizationGainDb, dbToLinear } from './loudness';

describe('normalizationGainDb', () => {
  it('turns loud tracks down to -14 LUFS', () => {
    expect(normalizationGainDb({ loudness: -8.8, truePeak: 2.3 })).toBeCloseTo(-5.2);
  });

  it('boosts quiet tracks when there is peak headroom', () => {
    expect(normalizationGainDb({ loudness: -18, truePeak: -6 })).toBeCloseTo(4);
  });

  it('caps a boost so the true peak stays at -1 dBTP', () => {
    expect(normalizationGainDb({ loudness: -16.8, truePeak: -3.3 })).toBeCloseTo(2.3);
  });

  it('does not boost a track whose peak is already above the ceiling', () => {
    expect(normalizationGainDb({ loudness: -15.5, truePeak: -0.7 })).toBe(0);
  });

  it('boosts without a cap when the true peak is unknown', () => {
    expect(normalizationGainDb({ loudness: -20, truePeak: null })).toBeCloseTo(6);
  });

  it('leaves unmeasured or implausible tracks alone', () => {
    expect(normalizationGainDb({ loudness: null, truePeak: null })).toBe(0);
    expect(normalizationGainDb({ loudness: -60, truePeak: -40 })).toBe(0);
  });
});

describe('dbToLinear', () => {
  it('converts decibels to an amplitude factor', () => {
    expect(dbToLinear(0)).toBe(1);
    expect(dbToLinear(-6)).toBeCloseTo(0.501, 3);
  });
});
