import { posix } from 'path';

/**
 * Whether a request under /uploads may be served publicly. Only cover art, avatars and
 * playlist covers (/uploads/images/) are public; audio goes through the authenticated stream
 * route. The path is decoded and normalized first, because the static server resolves "..":
 * a raw-prefix check would let /uploads/images/../audio/<id>.mp3 (or %2e%2e, ..%2f) through.
 * The /uploads prefix itself is also checked after decoding: the router decodes before
 * matching, so /%75ploads/audio/<id>.mp3 reaches the static server too.
 * Returns null for URLs outside /uploads, and 'bad' for undecodable ones (the router would
 * reject those with a 400 as well).
 */
export function classifyUploadUrl(url: string): 'public' | 'blocked' | 'bad' | null {
  const rawPath = url.split('?')[0] ?? '';
  let path: string;
  try {
    path = posix.normalize(decodeURIComponent(rawPath));
  } catch {
    return 'bad';
  }
  if (!path.toLowerCase().startsWith('/uploads')) return null;
  return !path.includes('\\') && path.startsWith('/uploads/images/') ? 'public' : 'blocked';
}
