import { useState, useEffect } from 'react';

const artCache = new Map<string, string | null>();

async function fetchItunesArt(artist: string, title: string): Promise<string | null> {
  const key = `${artist}||${title}`;
  if (artCache.has(key)) return artCache.get(key) ?? null;
  try {
    const term = encodeURIComponent(`${artist} ${title}`);
    const res = await fetch(
      `https://itunes.apple.com/search?term=${term}&entity=musicTrack&limit=5&media=music`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    const match =
      data.results?.find((r: any) =>
        r.artistName?.toLowerCase().includes(artist.toLowerCase())
      ) ?? data.results?.[0];
    const url: string | null = match?.artworkUrl100?.replace('100x100bb', '600x600bb') ?? null;
    artCache.set(key, url);
    return url;
  } catch {
    artCache.set(key, null);
    return null;
  }
}

interface AlbumArtProps {
  src: string | null | undefined;
  alt: string;
  artist?: string | null;
  title?: string | null;
  className?: string;
  iconSize?: string;
}

export function AlbumArt({
  src,
  alt,
  artist,
  title,
  className = 'w-full h-full object-cover',
  iconSize = 'w-5 h-5',
}: AlbumArtProps) {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(src ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (src) {
      setResolvedSrc(src);
      return;
    }
    if (!artist || !title) { setResolvedSrc(null); return; }
    const key = `${artist}||${title}`;
    if (artCache.has(key)) {
      setResolvedSrc(artCache.get(key) ?? null);
      return;
    }
    setResolvedSrc(null);
    fetchItunesArt(artist, title).then(setResolvedSrc);
  }, [src, artist, title]);

  const handleError = () => {
    if (artist && title && src) {
      // Server cover failed — try iTunes
      fetchItunesArt(artist, title).then((url) => {
        if (url) setResolvedSrc(url);
        else setFailed(true);
      });
    } else {
      setFailed(true);
    }
  };

  if (resolvedSrc && !failed) {
    return (
      <img
        src={resolvedSrc}
        alt={alt}
        className={className}
        loading="lazy"
        decoding="async"
        onError={handleError}
      />
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center">
      <svg className={`${iconSize} text-zinc-600`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
      </svg>
    </div>
  );
}

export default AlbumArt;
