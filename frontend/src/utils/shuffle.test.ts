import { describe, it, expect } from 'vitest';
import { balancedShuffle, leadArtist } from './shuffle';

const t = (id: string, artist: string | null) => ({ id, artist });

describe('leadArtist', () => {
  it('takes the first credited artist', () => {
    expect(leadArtist(t('1', 'Pritam, Arijit Singh feat. X'))).toBe('pritam');
    expect(leadArtist(t('1', null))).not.toBe(leadArtist(t('2', null)));
  });
});

describe('balancedShuffle', () => {
  it('returns a permutation', () => {
    const items = Array.from({ length: 20 }, (_, i) => t(String(i), `A${i % 4}`));
    expect(balancedShuffle(items).map((x) => x.id).sort()).toEqual(items.map((x) => x.id).sort());
  });

  it('spreads an artist evenly instead of clustering', () => {
    // 4 songs by A among 16: a random shuffle often puts two A's next to each other
    const items = [
      ...Array.from({ length: 4 }, (_, i) => t(`a${i}`, 'A')),
      ...Array.from({ length: 12 }, (_, i) => t(`o${i}`, `Other ${i}`)),
    ];
    for (let run = 0; run < 200; run++) {
      const order = balancedShuffle(items);
      const positions = order.flatMap((x, i) => (x.artist === 'A' ? [i] : []));
      for (let i = 1; i < positions.length; i++) {
        // Never back to back
        expect(positions[i]! - positions[i - 1]!).toBeGreaterThan(1);
      }
    }
  });

  it('holds recently played tracks back toward the end', () => {
    const items = Array.from({ length: 40 }, (_, i) => t(String(i), `A${i}`));
    const recent = ['0', '1', '2', '3', '4'];
    let total = 0;
    for (let run = 0; run < 100; run++) {
      const order = balancedShuffle(items, { recent });
      total += recent.reduce((sum, id) => sum + order.findIndex((x) => x.id === id), 0) / recent.length;
    }
    // Uniform would average 19.5
    expect(total / 100).toBeGreaterThan(24);
  });
});
