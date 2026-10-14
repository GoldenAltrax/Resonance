import { posix } from 'path';

/**
 * Whether a request under /uploads may be served publicly. Only cover art, avatars and
 * playlist covers (/uploads/images/) are public; audio goes through the authenticated stream
 * route. The path is decoded and normalized first, because the static server resolves "..":
 * a raw-prefix check would let /uploads/images/../audio/<id>.mp3 (or %2e%2e, ..%2f) through.
 * Returns null for URLs outside /uploads, and 'bad' for undecodable ones.
 */
export function classifyUploadUrl(url: string): 'public' | 'blocked' | 'bad' | null {
  const rawPath = url.split('?')[0] ?? '';
  if (!rawPath.toLowerCase().startsWith('/uploads')) return null;
  let path: string;
  try {
    path = posix.normalize(decodeURIComponent(rawPath));
  } catch {
    return 'bad';
  }
  return !path.includes('\\') && path.startsWith('/uploads/images/') ? 'public' : 'blocked';
}
