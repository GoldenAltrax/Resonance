/**
 * Tools the admin assistant can call. Each one wraps an existing feature (catalog search,
 * the download queue, playlists) and returns compact JSON so the model reads as little as
 * possible. Adding a capability later means adding an entry here.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db, downloadJobs, playlists, playlistTracks, tracks } from '../db/index.js';
import { searchSongs, searchAlbums, albumTracks, resolveLink, type CatalogTrack } from './catalog.js';
import { enqueue, addToPlaylist, type EnqueueResult } from './downloader.js';
import { songKey } from '../utils/matching.js';

/** Queue requests above this size need an explicit yes from the user first. */
const CONFIRM_ABOVE = 25;
const ACTIVE = ['queued', 'searching', 'downloading', 'importing'];
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

export interface ToolContext {
  userId: string;
}

export interface ToolOutcome {
  /** JSON-serialisable result given to the model */
  result: unknown;
  /** One line shown in the chat panel under the step */
  summary: string;
  /** Parts of the app whose data changed, so the client can refresh them */
  changed?: Array<'downloads' | 'playlists' | 'library'>;
  isError?: boolean;
}

// Catalog songs from recent searches, so the model can queue them by id without repeating metadata
const songCache = new Map<string, CatalogTrack>();
function remember(song: CatalogTrack) {
  if (!song.externalId) return;
  songCache.delete(song.externalId);
  songCache.set(song.externalId, song);
  if (songCache.size > 2000) songCache.delete(songCache.keys().next().value!);
}

const fmt = (seconds?: number | null) =>
  seconds ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}` : null;

function ownPlaylist(id: string, userId: string) {
  return db.select({ id: playlists.id, name: playlists.name }).from(playlists)
    .where(and(eq(playlists.id, id), eq(playlists.userId, userId))).get();
}

function queueSummary(r: EnqueueResult): string {
  const parts = [`${r.queued} queued`];
  if (r.alreadyInLibrary) parts.push(`${r.alreadyInLibrary} already in library`);
  if (r.alreadyQueued) parts.push(`${r.alreadyQueued} already queued`);
  return parts.join(', ');
}

function needsConfirmation(count: number, confirmed?: boolean): ToolOutcome | null {
  if (count <= CONFIRM_ABOVE || confirmed) return null;
  return {
    result: { needs_confirmation: true, song_count: count, note: `Ask the user to confirm downloading ${count} songs, then call again with confirmed: true.` },
    summary: `Waiting for confirmation (${count} songs)`,
  };
}

// ── Definitions ──────────────────────────────────────────────────────────────

const definitions: Anthropic.Tool[] = [
  {
    name: 'search_music',
    description: 'Search the public music catalog (Apple Music data) for songs or albums. Song results include an id for queue_songs and whether the song is already in the library or queued. Use this to find the exact song or album the user means.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Artist and/or title, e.g. "daft punk get lucky"' },
        type: { type: 'string', enum: ['songs', 'albums'], description: 'Default songs' },
        limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Default 8' },
      },
      required: ['query'],
    },
  },
  {
    name: 'queue_songs',
    description: 'Download songs into the shared library. Pass song_ids from search_music, or songs by title and artist when you already know them (the downloader finds the official audio itself). Songs already in the library are not downloaded again. With playlist_id, every song (new or existing) is also added to that playlist in the given order.',
    input_schema: {
      type: 'object',
      properties: {
        song_ids: { type: 'array', items: { type: 'string' }, description: 'ids from search_music results' },
        songs: {
          type: 'array',
          items: {
            type: 'object',
            properties: { title: { type: 'string' }, artist: { type: 'string' }, album: { type: 'string' } },
            required: ['title', 'artist'],
          },
          description: 'Songs to find by name, when no search was done',
        },
        playlist_id: { type: 'string', description: 'Optional playlist to add the songs to' },
        confirmed: { type: 'boolean', description: `Set true only after the user agreed to download more than ${CONFIRM_ABOVE} songs` },
      },
    },
  },
  {
    name: 'queue_album',
    description: 'Download a whole album by album_id from search_music (type albums).',
    input_schema: {
      type: 'object',
      properties: {
        album_id: { type: 'string' },
        playlist_id: { type: 'string', description: 'Optional playlist to add the album to' },
        confirmed: { type: 'boolean' },
      },
      required: ['album_id'],
    },
  },
  {
    name: 'import_link',
    description: 'Download the songs behind a Spotify, Apple Music, Deezer, YouTube or YouTube Music link (song, album or playlist). With create_playlist, a playlist link is recreated as a playlist in Resonance.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        create_playlist: { type: 'boolean' },
        confirmed: { type: 'boolean' },
      },
      required: ['url'],
    },
  },
  {
    name: 'search_library',
    description: 'Search songs already in the Resonance library by title, artist or album. Returns track ids for playlists.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 15' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_playlists',
    description: "List the user's playlists with their ids and song counts.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_playlist',
    description: 'Songs in one playlist, in order.',
    input_schema: { type: 'object', properties: { playlist_id: { type: 'string' } }, required: ['playlist_id'] },
  },
  {
    name: 'create_playlist',
    description: 'Create a playlist, optionally with library track ids. To include songs that are not downloaded yet, create it first and pass its id to queue_songs.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        track_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_to_playlist',
    description: 'Add library tracks (ids from search_library) to a playlist.',
    input_schema: {
      type: 'object',
      properties: {
        playlist_id: { type: 'string' },
        track_ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
      required: ['playlist_id', 'track_ids'],
    },
  },
  {
    name: 'download_status',
    description: 'Progress of the download queue: counts per status, what is downloading now, and recent failures with reasons.',
    input_schema: { type: 'object', properties: {} },
  },
];

const webSearchDefinition: Anthropic.Tool = {
  name: 'web_search',
  description: 'Search the web for current information: charts, new releases, soundtracks, "that song from ...", or anything outside music. Returns a short answer and sources.',
  input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
};

export function toolDefinitions(): Anthropic.Tool[] {
  return TAVILY_API_KEY ? [...definitions, webSearchDefinition] : definitions;
}

export const webSearchEnabled = () => Boolean(TAVILY_API_KEY);

// ── Implementations ──────────────────────────────────────────────────────────

type Input = Record<string, any>;

const handlers: Record<string, (input: Input, ctx: ToolContext) => Promise<ToolOutcome> | ToolOutcome> = {
  async search_music(input) {
    const query = String(input.query ?? '').trim();
    if (!query) return { result: { error: 'query is required' }, summary: 'Empty search', isError: true };
    const limit = Math.min(25, Math.max(1, Number(input.limit) || 8));

    if (input.type === 'albums') {
      const albums = (await searchAlbums(query, limit)).map((a) => ({
        album_id: a.id, title: a.title, artist: a.artist, year: a.year, tracks: a.trackCount,
      }));
      return { result: { albums }, summary: `${albums.length} album${albums.length === 1 ? '' : 's'} found` };
    }

    const library = new Set(db.select({ title: tracks.title, artist: tracks.artist }).from(tracks).all()
      .map((t) => songKey(t.title, t.artist)));
    const queued = new Set(db.select({ title: downloadJobs.title, artist: downloadJobs.artist }).from(downloadJobs)
      .where(inArray(downloadJobs.status, ACTIVE)).all().map((j) => songKey(j.title, j.artist)));

    const songs = (await searchSongs(query, limit)).map((s) => {
      remember(s);
      const key = songKey(s.title, s.artist);
      return {
        id: s.externalId, title: s.title, artist: s.artist, album: s.album, length: fmt(s.duration),
        ...(library.has(key) ? { in_library: true } : {}),
        ...(queued.has(key) ? { queued: true } : {}),
      };
    });
    return { result: { songs }, summary: `${songs.length} song${songs.length === 1 ? '' : 's'} found` };
  },

  queue_songs(input, ctx) {
    const items: CatalogTrack[] = [];
    const unknownIds: string[] = [];
    for (const id of (input.song_ids ?? []) as string[]) {
      const song = songCache.get(id);
      if (song) items.push(song); else unknownIds.push(id);
    }
    for (const s of (input.songs ?? []) as Array<{ title?: string; artist?: string; album?: string }>) {
      if (s?.title) items.push({ title: String(s.title).slice(0, 300), artist: s.artist ? String(s.artist).slice(0, 300) : null, album: s.album ?? null });
    }
    if (!items.length) {
      return {
        result: { error: unknownIds.length ? 'Those song ids are no longer known; search again.' : 'No songs given' },
        summary: 'Nothing to queue', isError: true,
      };
    }

    let playlistId: string | null = null;
    if (input.playlist_id) {
      const playlist = ownPlaylist(String(input.playlist_id), ctx.userId);
      if (!playlist) return { result: { error: 'Playlist not found' }, summary: 'Playlist not found', isError: true };
      playlistId = playlist.id;
    }

    const confirm = needsConfirmation(items.length, input.confirmed);
    if (confirm) return confirm;

    const r = enqueue(items, { requestedBy: ctx.userId, playlistId });
    return {
      result: { ...r, ...(unknownIds.length ? { unknown_ids: unknownIds } : {}) },
      summary: queueSummary(r),
      changed: playlistId ? ['downloads', 'playlists'] : ['downloads'],
    };
  },

  async queue_album(input, ctx) {
    const albumId = String(input.album_id ?? '');
    if (!/^\d+$/.test(albumId)) return { result: { error: 'Invalid album_id' }, summary: 'Invalid album', isError: true };
    let playlistId: string | null = null;
    if (input.playlist_id) {
      const playlist = ownPlaylist(String(input.playlist_id), ctx.userId);
      if (!playlist) return { result: { error: 'Playlist not found' }, summary: 'Playlist not found', isError: true };
      playlistId = playlist.id;
    }
    const album = await albumTracks(albumId);
    const confirm = needsConfirmation(album.tracks.length, input.confirmed);
    if (confirm) return confirm;
    const r = enqueue(album.tracks, { requestedBy: ctx.userId, batchLabel: album.label, playlistId });
    return {
      result: { album: album.label, ...r },
      summary: `${album.label}: ${queueSummary(r)}`,
      changed: playlistId ? ['downloads', 'playlists'] : ['downloads'],
    };
  },

  async import_link(input, ctx) {
    const url = String(input.url ?? '').trim();
    const resolved = await resolveLink(url);
    const confirm = needsConfirmation(resolved.tracks.length, input.confirmed);
    if (confirm) return confirm;

    let playlistId: string | null = null;
    if (resolved.kind === 'playlist' && input.create_playlist) {
      playlistId = uuidv4();
      db.insert(playlists).values({
        id: playlistId,
        name: resolved.label.slice(0, 100),
        description: `Imported from ${new URL(url).hostname.replace(/^www\./, '')}`,
        userId: ctx.userId,
      }).run();
    }
    const r = enqueue(resolved.tracks, {
      requestedBy: ctx.userId,
      batchLabel: resolved.kind === 'track' ? null : resolved.label,
      playlistId,
    });
    return {
      result: { kind: resolved.kind, label: resolved.label, total: resolved.tracks.length, ...r, ...(playlistId ? { playlist_id: playlistId } : {}) },
      summary: `${resolved.label}: ${queueSummary(r)}`,
      changed: playlistId ? ['downloads', 'playlists'] : ['downloads'],
    };
  },

  search_library(input) {
    const words = String(input.query ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
    if (!words.length) return { result: { error: 'query is required' }, summary: 'Empty search', isError: true };
    const limit = Math.min(50, Math.max(1, Number(input.limit) || 15));
    const conditions = words.map((w) => {
      const pattern = `%${w.replace(/[%_\\]/g, '\\$&')}%`;
      return or(
        sql`${tracks.title} LIKE ${pattern} ESCAPE '\\'`,
        sql`${tracks.artist} LIKE ${pattern} ESCAPE '\\'`,
        sql`${tracks.album} LIKE ${pattern} ESCAPE '\\'`,
      );
    });
    const rows = db.select({ id: tracks.id, title: tracks.title, artist: tracks.artist, album: tracks.album, duration: tracks.duration })
      .from(tracks).where(and(...conditions)).limit(limit).all()
      .map((t) => ({ id: t.id, title: t.title, artist: t.artist, album: t.album, length: fmt(t.duration) }));
    return { result: { tracks: rows }, summary: `${rows.length} in library` };
  },

  list_playlists(_input, ctx) {
    const rows = db.select({
      id: playlists.id,
      name: playlists.name,
      songs: sql<number>`(SELECT count(*) FROM playlist_tracks WHERE playlist_tracks.playlist_id = ${playlists.id})`,
    }).from(playlists).where(eq(playlists.userId, ctx.userId)).orderBy(desc(playlists.updatedAt)).all();
    return { result: { playlists: rows }, summary: `${rows.length} playlist${rows.length === 1 ? '' : 's'}` };
  },

  get_playlist(input, ctx) {
    const playlist = ownPlaylist(String(input.playlist_id ?? ''), ctx.userId);
    if (!playlist) return { result: { error: 'Playlist not found' }, summary: 'Playlist not found', isError: true };
    const rows = db.select({ id: tracks.id, title: tracks.title, artist: tracks.artist })
      .from(playlistTracks).innerJoin(tracks, eq(playlistTracks.trackId, tracks.id))
      .where(eq(playlistTracks.playlistId, playlist.id)).orderBy(playlistTracks.position).limit(200).all();
    return { result: { name: playlist.name, tracks: rows }, summary: `${playlist.name}: ${rows.length} songs` };
  },

  create_playlist(input, ctx) {
    const name = String(input.name ?? '').trim().slice(0, 100);
    if (!name) return { result: { error: 'name is required' }, summary: 'No name given', isError: true };
    const id = uuidv4();
    db.insert(playlists).values({
      id, name, userId: ctx.userId,
      description: input.description ? String(input.description).slice(0, 500) : null,
    }).run();
    const added = addTracks(id, (input.track_ids ?? []) as string[]);
    return {
      result: { playlist_id: id, name, added },
      summary: `Created "${name}"${added ? ` with ${added} songs` : ''}`,
      changed: ['playlists'],
    };
  },

  add_to_playlist(input, ctx) {
    const playlist = ownPlaylist(String(input.playlist_id ?? ''), ctx.userId);
    if (!playlist) return { result: { error: 'Playlist not found' }, summary: 'Playlist not found', isError: true };
    const added = addTracks(playlist.id, (input.track_ids ?? []) as string[]);
    return { result: { added }, summary: `Added ${added} to "${playlist.name}"`, changed: ['playlists'] };
  },

  download_status() {
    const counts = Object.fromEntries(
      db.select({ status: downloadJobs.status, count: sql<number>`count(*)` }).from(downloadJobs)
        .groupBy(downloadJobs.status).all().map((r) => [r.status, r.count])
    );
    const pick = { title: downloadJobs.title, artist: downloadJobs.artist, error: downloadJobs.error };
    const working = db.select(pick).from(downloadJobs)
      .where(inArray(downloadJobs.status, ['searching', 'downloading', 'importing'])).limit(5).all()
      .map(({ title, artist }) => ({ title, artist }));
    const failed = db.select(pick).from(downloadJobs).where(eq(downloadJobs.status, 'failed'))
      .orderBy(desc(downloadJobs.updatedAt)).limit(10).all();
    return { result: { counts, working, failed }, summary: Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'Queue is empty' };
  },

  async web_search(input) {
    if (!TAVILY_API_KEY) return { result: { error: 'Web search is not configured' }, summary: 'Web search unavailable', isError: true };
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TAVILY_API_KEY}` },
      body: JSON.stringify({ query: String(input.query ?? '').slice(0, 400), max_results: 5, include_answer: 'basic', search_depth: 'basic' }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Web search failed (${res.status})`);
    const data = await res.json() as { answer?: string; results?: Array<{ title: string; url: string; content: string }> };
    const results = (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 600) }));
    return { result: { answer: data.answer ?? null, results }, summary: `${results.length} web result${results.length === 1 ? '' : 's'}` };
  },
};

/** Adds library tracks to a playlist, skipping unknown ids and songs already in it. */
function addTracks(playlistId: string, ids: string[]): number {
  const unique = [...new Set(ids.map(String))].slice(0, 500);
  if (!unique.length) return 0;
  const existing = new Set(db.select({ id: tracks.id }).from(tracks).where(inArray(tracks.id, unique)).all().map((t) => t.id));
  const before = db.select({ n: sql<number>`count(*)` }).from(playlistTracks).where(eq(playlistTracks.playlistId, playlistId)).get()?.n ?? 0;
  db.transaction(() => {
    for (const id of unique) if (existing.has(id)) addToPlaylist(playlistId, id, null);
  });
  db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, playlistId)).run();
  const after = db.select({ n: sql<number>`count(*)` }).from(playlistTracks).where(eq(playlistTracks.playlistId, playlistId)).get()?.n ?? 0;
  return after - before;
}

export async function runTool(name: string, input: Input, ctx: ToolContext): Promise<ToolOutcome> {
  const handler = handlers[name];
  if (!handler || (name === 'web_search' && !TAVILY_API_KEY)) {
    return { result: { error: `Unknown tool ${name}` }, summary: 'Unknown action', isError: true };
  }
  try {
    return await handler(input ?? {}, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { result: { error: message }, summary: message.slice(0, 120), isError: true };
  }
}

/** Short present-tense label for a step, shown while it runs and in the chat history. */
export function toolLabel(name: string, input: Input): string {
  const n = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  switch (name) {
    case 'search_music': return `Searching ${input.type === 'albums' ? 'albums' : 'songs'}: ${input.query ?? ''}`;
    case 'queue_songs': {
      const count = n(input.song_ids) + n(input.songs);
      return `Queueing ${count} song${count === 1 ? '' : 's'}`;
    }
    case 'queue_album': return 'Queueing album';
    case 'import_link': return 'Importing link';
    case 'search_library': return `Searching library: ${input.query ?? ''}`;
    case 'list_playlists': return 'Reading playlists';
    case 'get_playlist': return 'Reading playlist';
    case 'create_playlist': return `Creating playlist "${input.name ?? ''}"`;
    case 'add_to_playlist': return `Adding ${n(input.track_ids)} to playlist`;
    case 'download_status': return 'Checking downloads';
    case 'web_search': return `Searching the web: ${input.query ?? ''}`;
    default: return name;
  }
}
