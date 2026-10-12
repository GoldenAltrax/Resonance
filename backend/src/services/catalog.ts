/**
 * Song metadata from public catalogs, used to search for music and to turn pasted links
 * into a list of songs. None of these need an API key:
 *   - Apple's iTunes Search API: search, album track lists, high-resolution covers
 *   - Spotify / Deezer / Apple Music links: read from public embed pages and ID lookups
 *   - YouTube / YouTube Music links: read with yt-dlp
 */
import { getUrlInfo } from './ytdlp.js';
import { normalizeTitle, parseVideoTitle, splitArtists } from '../utils/matching.js';

export interface CatalogTrack {
  title: string;
  artist: string | null;
  album?: string | null;
  duration?: number | null; // seconds
  coverUrl?: string | null;
  externalId?: string | null;
  /** Exact YouTube video to download, when the request came from a YouTube link */
  sourceUrl?: string | null;
}

export interface CatalogAlbum {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  trackCount: number;
  year: number | null;
}

export interface ResolvedLink {
  kind: 'track' | 'album' | 'playlist';
  label: string;
  tracks: CatalogTrack[];
}

const ITUNES_COUNTRY = process.env.ITUNES_COUNTRY || 'US';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; Resonance/5.0)' };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Catalog request failed (${res.status})`);
  return res.json() as Promise<T>;
}

// ── iTunes ───────────────────────────────────────────────────────────────────

interface ItunesItem {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionId?: number;
  collectionName?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  trackCount?: number;
  releaseDate?: string;
  discNumber?: number;
  trackNumber?: number;
}

/** iTunes returns 100px artwork URLs; the same path serves any size up to the original. */
const bigArtwork = (url?: string) => (url ? url.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/1000x1000bb.jpg') : null);

const fromItunesSong = (t: ItunesItem): CatalogTrack => ({
  title: t.trackName ?? 'Unknown',
  artist: t.artistName ?? null,
  album: t.collectionName ?? null,
  duration: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : null,
  coverUrl: bigArtwork(t.artworkUrl100),
  externalId: t.trackId ? `itunes:${t.trackId}` : null,
});

export async function searchSongs(query: string, limit = 25): Promise<CatalogTrack[]> {
  const data = await getJson<{ results: ItunesItem[] }>(
    `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=${limit}&country=${ITUNES_COUNTRY}`
  );
  return data.results.filter((r) => r.kind === 'song').map(fromItunesSong);
}

export async function searchAlbums(query: string, limit = 20): Promise<CatalogAlbum[]> {
  const data = await getJson<{ results: ItunesItem[] }>(
    `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=${limit}&country=${ITUNES_COUNTRY}`
  );
  return data.results
    .filter((r) => r.collectionId)
    .map((a) => ({
      id: String(a.collectionId),
      title: a.collectionName ?? 'Unknown album',
      artist: a.artistName ?? 'Unknown artist',
      coverUrl: bigArtwork(a.artworkUrl100),
      trackCount: a.trackCount ?? 0,
      year: a.releaseDate ? new Date(a.releaseDate).getFullYear() : null,
    }));
}

export async function albumTracks(collectionId: string): Promise<ResolvedLink> {
  const data = await getJson<{ results: ItunesItem[] }>(
    `https://itunes.apple.com/lookup?id=${encodeURIComponent(collectionId)}&entity=song&country=${ITUNES_COUNTRY}`
  );
  const album = data.results.find((r) => r.wrapperType === 'collection');
  const songs = data.results
    .filter((r) => r.kind === 'song')
    .sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0));
  if (!album && songs.length === 0) throw new Error('Album not found');
  return {
    kind: 'album',
    label: `${album?.collectionName ?? songs[0]?.collectionName ?? 'Album'} — ${album?.artistName ?? songs[0]?.artistName ?? ''}`.replace(/ — $/, ''),
    tracks: songs.map(fromItunesSong),
  };
}

/**
 * Fills in album and cover art for a song that came from a source without them
 * (YouTube, Spotify playlists). Picks the iTunes result with the closest length.
 */
export async function findSongDetails(title: string, artist: string | null, duration?: number | null): Promise<CatalogTrack | null> {
  try {
    const results = await searchSongs(`${artist ?? ''} ${title}`.trim(), 10);
    const wantedTitle = normalizeTitle(title);
    const wantedArtist = artist ? splitArtists(artist)[0] : null;
    const matches = results.filter((r) => {
      if (normalizeTitle(r.title) !== wantedTitle) return false;
      if (wantedArtist && !(r.artist && splitArtists(r.artist).includes(wantedArtist))) return false;
      return !duration || !r.duration || Math.abs(r.duration - duration) <= 8;
    });
    if (duration) matches.sort((a, b) => Math.abs((a.duration ?? 0) - duration) - Math.abs((b.duration ?? 0) - duration));
    return matches[0] ?? null;
  } catch {
    return null;
  }
}

// ── Spotify (public embed pages; the Web API now needs Premium developer accounts) ──

interface SpotifyEntity {
  type?: string;
  name?: string;
  title?: string;
  subtitle?: string;
  duration?: number;
  artists?: { name: string }[];
  uri?: string;
  visualIdentity?: { image?: { url: string; maxWidth?: number }[] };
  trackList?: { title: string; subtitle: string; duration: number; uri: string }[];
}

async function spotifyEntity(type: string, id: string): Promise<SpotifyEntity> {
  const res = await fetch(`https://open.spotify.com/embed/${type}/${id}`, { headers: UA, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Spotify returned ${res.status}`);
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  const entity = match?.[1] ? JSON.parse(match[1])?.props?.pageProps?.state?.data?.entity : null;
  if (!entity) throw new Error('Could not read this Spotify link (is it public?)');
  return entity as SpotifyEntity;
}

const largestImage = (e: SpotifyEntity) =>
  [...(e.visualIdentity?.image ?? [])].sort((a, b) => (b.maxWidth ?? 0) - (a.maxWidth ?? 0))[0]?.url ?? null;

async function resolveSpotify(type: string, id: string): Promise<ResolvedLink> {
  const e = await spotifyEntity(type, id);
  if (type === 'track') {
    const artist = e.artists?.map((a) => a.name).join(', ') || e.subtitle || null;
    return {
      kind: 'track',
      label: `${e.name ?? e.title} — ${artist ?? ''}`,
      tracks: [{
        title: e.name ?? e.title ?? 'Unknown',
        artist,
        duration: e.duration ? Math.round(e.duration / 1000) : null,
        coverUrl: largestImage(e),
        externalId: `spotify:track:${id}`,
      }],
    };
  }
  const albumCover = type === 'album' ? largestImage(e) : null;
  const tracks = (e.trackList ?? []).map((t) => ({
    title: t.title,
    artist: t.subtitle?.replace(/ /g, ' ') || null,
    album: type === 'album' ? e.name ?? null : null,
    duration: t.duration ? Math.round(t.duration / 1000) : null,
    coverUrl: albumCover,
    externalId: t.uri || null,
  }));
  return { kind: type === 'album' ? 'album' : 'playlist', label: e.name ?? e.title ?? 'Spotify', tracks };
}

// ── Deezer (ID lookups work without a key; search is unreliable from servers) ──

interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  artist: { name: string };
  album?: { title: string; cover_xl?: string };
}

const fromDeezer = (t: DeezerTrack, album?: { title: string; cover_xl?: string }): CatalogTrack => ({
  title: t.title,
  artist: t.artist?.name ?? null,
  album: (album ?? t.album)?.title ?? null,
  duration: t.duration || null,
  coverUrl: (album ?? t.album)?.cover_xl ?? null,
  externalId: `deezer:${t.id}`,
});

async function resolveDeezer(type: string, id: string): Promise<ResolvedLink> {
  type DeezerError = { error?: { message: string } };
  if (type === 'track') {
    const t = await getJson<DeezerTrack & DeezerError>(`https://api.deezer.com/track/${id}`);
    if (t.error) throw new Error(`Deezer: ${t.error.message}`);
    return { kind: 'track', label: `${t.title} — ${t.artist.name}`, tracks: [fromDeezer(t)] };
  }
  if (type === 'album') {
    const a = await getJson<{ title: string; cover_xl?: string; artist: { name: string }; tracks: { data: DeezerTrack[] } } & DeezerError>(
      `https://api.deezer.com/album/${id}`
    );
    if (a.error) throw new Error(`Deezer: ${a.error.message}`);
    return { kind: 'album', label: `${a.title} — ${a.artist.name}`, tracks: a.tracks.data.map((t) => fromDeezer(t, a)) };
  }
  const p = await getJson<{ title: string; tracks: { data: DeezerTrack[] } } & DeezerError>(`https://api.deezer.com/playlist/${id}?limit=1000`);
  if (p.error) throw new Error(`Deezer: ${p.error.message}`);
  return { kind: 'playlist', label: p.title, tracks: p.tracks.data.map((t) => fromDeezer(t)) };
}

// ── YouTube / YouTube Music ──────────────────────────────────────────────────

async function resolveYouTube(url: string): Promise<ResolvedLink> {
  const { title, entries } = await getUrlInfo(url);
  const tracks = entries.map((e): CatalogTrack => {
    // Official songs carry track/artist credits; for other videos parse "Artist - Title"
    const parsed = e.track ? { title: e.track, artist: e.artists?.join(', ') ?? e.artist ?? null } : parseVideoTitle(e.title, e.channel);
    return {
      title: parsed.title,
      artist: parsed.artist,
      album: e.album ?? null,
      duration: e.duration ?? null,
      externalId: `youtube:${e.id}`,
      sourceUrl: `https://www.youtube.com/watch?v=${e.id}`,
    };
  });
  if (tracks.length === 0) throw new Error('No videos found at this link');
  const first = tracks[0]!;
  return title
    ? { kind: 'playlist', label: title, tracks }
    : { kind: 'track', label: `${first.title}${first.artist ? ` — ${first.artist}` : ''}`, tracks };
}

// ── Link dispatcher ──────────────────────────────────────────────────────────

export async function resolveLink(raw: string): Promise<ResolvedLink> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('That does not look like a link');
  }
  const host = url.hostname.replace(/^www\./, '');

  // Short links (spotify.link, link.deezer.com, deezer.page.link) redirect to the real URL
  if (['spotify.link', 'link.deezer.com', 'deezer.page.link'].includes(host)) {
    const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (res.url === url.href) throw new Error('Could not follow this short link');
    return resolveLink(res.url);
  }

  if (host === 'open.spotify.com') {
    const m = url.pathname.match(/\/(track|album|playlist)\/([A-Za-z0-9]+)/);
    if (!m) throw new Error('Only Spotify track, album and playlist links are supported');
    return resolveSpotify(m[1]!, m[2]!);
  }

  if (host === 'deezer.com') {
    const m = url.pathname.match(/\/(track|album|playlist)\/(\d+)/);
    if (!m) throw new Error('Only Deezer track, album and playlist links are supported');
    return resolveDeezer(m[1]!, m[2]!);
  }

  if (host === 'music.apple.com' || host === 'itunes.apple.com') {
    const songId = url.searchParams.get('i') ?? url.pathname.match(/\/song\/[^/]+\/(\d+)/)?.[1];
    if (songId) {
      const data = await getJson<{ results: ItunesItem[] }>(`https://itunes.apple.com/lookup?id=${songId}&country=${ITUNES_COUNTRY}`);
      const song = data.results.find((r) => r.kind === 'song');
      if (!song) throw new Error('Song not found on Apple Music');
      const track = fromItunesSong(song);
      return { kind: 'track', label: `${track.title} — ${track.artist ?? ''}`, tracks: [track] };
    }
    const albumId = url.pathname.match(/\/album\/[^/]+\/(\d+)/)?.[1];
    if (albumId) return albumTracks(albumId);
    throw new Error('Only Apple Music song and album links are supported');
  }

  if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) {
    // A watch link that is part of a playlist means the video, not the whole playlist
    if (url.pathname === '/watch' && url.searchParams.get('v')) {
      return resolveYouTube(`https://www.youtube.com/watch?v=${url.searchParams.get('v')}`);
    }
    return resolveYouTube(url.href);
  }

  throw new Error('Supported links: YouTube, YouTube Music, Spotify, Apple Music, Deezer');
}
