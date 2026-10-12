import { api } from '@/services/api';

const generated = new Map<string, string>();

function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Deterministic placeholder cover (inline SVG data URI). Replaces the external
 * picsum.photos images: no network request, works offline, same image every time.
 */
export function generatedCover(seed: string): string {
  const cached = generated.get(seed);
  if (cached) return cached;
  const h = hash(seed);
  const hue1 = h % 360;
  const hue2 = (hue1 + 40 + (h % 80)) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue1},28%,26%)"/><stop offset="1" stop-color="hsl(${hue2},22%,10%)"/>` +
    `</linearGradient></defs><rect width="100" height="100" fill="url(#g)"/>` +
    `<circle cx="50" cy="50" r="17" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2"/>` +
    `<circle cx="50" cy="50" r="3" fill="rgba(255,255,255,.25)"/></svg>`;
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  generated.set(seed, uri);
  return uri;
}

/** Cover image URL for a playlist: uploaded cover, or a generated placeholder. */
export function playlistCoverUrl(playlist: { id: string; coverImage: string | null }): string {
  if (playlist.coverImage) {
    return playlist.coverImage.startsWith('http') ? playlist.coverImage : api.getUploadUrl(playlist.coverImage);
  }
  return generatedCover(playlist.id);
}
