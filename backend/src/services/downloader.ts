/**
 * Download queue for "Add music". Requests are rows in download_jobs; a small in-process
 * worker pool takes them one by one:
 *
 *   queued → searching (find the YouTube upload) → downloading (yt-dlp) → importing (ingest.ts)
 *          → done | skipped (already in library) | failed (reason kept, can be retried)
 *
 * State lives in SQLite, so a restart resumes where it left off.
 */
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, downloadJobs, playlistTracks, tracks, type DownloadJob } from '../db/index.js';
import { ingestAudioFile, TEMP_DIR } from './ingest.js';
import { downloadAudio, searchYouTube, searchYouTubeMusic, type VideoInfo } from './ytdlp.js';
import { findSongDetails, type CatalogTrack } from './catalog.js';
import { pickBest, songKey } from '../utils/matching.js';

const CONCURRENCY = Math.max(1, parseInt(process.env.DOWNLOAD_CONCURRENCY || '2', 10));
const ACTIVE_STATUSES = ['queued', 'searching', 'downloading', 'importing'];

let running = 0;
let started = false;

const now = () => new Date();

function update(id: string, values: Partial<DownloadJob>) {
  db.update(downloadJobs).set({ ...values, updatedAt: now() }).where(eq(downloadJobs.id, id)).run();
}

/** Library lookup by normalized title + primary artist. */
function libraryIndex(): Map<string, string> {
  const rows = db.select({ id: tracks.id, title: tracks.title, artist: tracks.artist }).from(tracks).all();
  return new Map(rows.map((r) => [songKey(r.title, r.artist), r.id]));
}

export function findInLibrary(title: string, artist: string | null): string | null {
  return libraryIndex().get(songKey(title, artist)) ?? null;
}

export function addToPlaylist(playlistId: string, trackId: string, position: number | null) {
  const exists = db.select({ id: playlistTracks.id }).from(playlistTracks)
    .where(and(eq(playlistTracks.playlistId, playlistId), eq(playlistTracks.trackId, trackId))).get();
  if (exists) return;
  db.run(sql`
    INSERT INTO playlist_tracks (id, playlist_id, track_id, position, added_at)
    SELECT ${uuidv4()}, ${playlistId}, ${trackId},
           COALESCE(${position}, COALESCE(MAX(position), 0) + 1), ${Math.floor(Date.now() / 1000)}
    FROM playlist_tracks WHERE playlist_id = ${playlistId}
  `);
}

export interface EnqueueOptions {
  requestedBy: string;
  batchLabel?: string | null;
  playlistId?: string | null;
}

export interface EnqueueResult {
  queued: number;
  alreadyInLibrary: number;
  alreadyQueued: number;
}

export function enqueue(items: CatalogTrack[], opts: EnqueueOptions): EnqueueResult {
  const result: EnqueueResult = { queued: 0, alreadyInLibrary: 0, alreadyQueued: 0 };
  const library = libraryIndex();
  const active = db.select({ externalId: downloadJobs.externalId, title: downloadJobs.title, artist: downloadJobs.artist })
    .from(downloadJobs).where(inArray(downloadJobs.status, ACTIVE_STATUSES)).all();
  const activeKeys = new Set(active.flatMap((j) => [j.externalId, songKey(j.title, j.artist)]).filter(Boolean));

  db.transaction((tx) => {
    items.forEach((item, index) => {
      const key = songKey(item.title, item.artist);
      const existingTrackId = library.get(key);
      if (existingTrackId) {
        // Already in the library: no download, but still place it in the requested playlist
        if (opts.playlistId) addToPlaylist(opts.playlistId, existingTrackId, index + 1);
        result.alreadyInLibrary++;
        return;
      }
      if ((item.externalId && activeKeys.has(item.externalId)) || activeKeys.has(key)) {
        result.alreadyQueued++;
        return;
      }
      activeKeys.add(key);
      tx.insert(downloadJobs).values({
        id: uuidv4(),
        status: 'queued',
        title: item.title,
        artist: item.artist,
        album: item.album ?? null,
        duration: item.duration ?? null,
        coverUrl: item.coverUrl ?? null,
        sourceUrl: item.sourceUrl ?? null,
        externalId: item.externalId ?? null,
        batchLabel: opts.batchLabel ?? null,
        playlistId: opts.playlistId ?? null,
        playlistPosition: opts.playlistId ? index + 1 : null,
        requestedBy: opts.requestedBy,
      }).run();
      result.queued++;
    });
  });

  pump();
  return result;
}

export function retry(id: string): boolean {
  const changed = db.update(downloadJobs)
    .set({ status: 'queued', error: null, updatedAt: now() })
    .where(and(eq(downloadJobs.id, id), eq(downloadJobs.status, 'failed')))
    .run().changes;
  if (changed) pump();
  return changed > 0;
}

/** Call once at startup: resumes jobs interrupted by a restart. */
export function startDownloader() {
  if (started) return;
  started = true;
  db.update(downloadJobs)
    .set({ status: 'queued', updatedAt: now() })
    .where(inArray(downloadJobs.status, ['searching', 'downloading', 'importing']))
    .run();
  pump();
}

function pump() {
  if (!started) return;
  while (running < CONCURRENCY) {
    const job = db.select().from(downloadJobs)
      .where(eq(downloadJobs.status, 'queued'))
      .orderBy(asc(downloadJobs.createdAt))
      .limit(1).get();
    if (!job) return;
    // Claim it synchronously so the next loop iteration picks a different job
    update(job.id, { status: 'searching', attempts: job.attempts + 1 });
    running++;
    runJob(job)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        update(job.id, { status: 'failed', error: message.slice(0, 300) });
      })
      .finally(() => {
        running--;
        pump();
      });
  }
}

async function findSource(job: DownloadJob): Promise<string> {
  const request = { title: job.title, artist: job.artist, duration: job.duration };
  const query = `${job.artist ?? ''} ${job.title}`.trim();

  // YouTube Music "Songs" are the label's official audio: exact album version, no video intro
  const music = await searchYouTubeMusic(query).catch(() => [] as VideoInfo[]);
  const fromMusic = pickBest(request, music.map((v) => ({ ...v, title: v.track ?? v.title })));
  if (fromMusic) return `https://music.youtube.com/watch?v=${fromMusic.id}`;

  const videos = await searchYouTube(`${query} audio`);
  const fromVideos = pickBest(request, videos);
  if (fromVideos) return `https://www.youtube.com/watch?v=${fromVideos.id}`;

  throw new Error(job.duration
    ? 'No upload with a matching title and length was found on YouTube'
    : 'No matching upload was found on YouTube');
}

async function fetchCover(url: string | null): Promise<{ data: Buffer; ext: string } | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return undefined;
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return undefined;
    return { data: Buffer.from(await res.arrayBuffer()), ext: type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg' };
  } catch {
    return undefined;
  }
}

async function runJob(job: DownloadJob) {
  if (!job.requestedBy) throw new Error('The account that requested this song no longer exists');

  const url = job.sourceUrl ?? await findSource(job);
  update(job.id, { status: 'downloading', youtubeId: new URL(url).searchParams.get('v') });

  const { filePath, info } = await downloadAudio(url, join(TEMP_DIR, `dl-${job.id}`));

  // Catalog metadata wins; YouTube credits and an iTunes lookup fill whatever is missing
  let title = job.title;
  let artist = job.artist ?? info.artists?.join(', ') ?? info.artist ?? null;
  let album = job.album ?? info.album ?? null;
  let coverUrl = job.coverUrl;
  // A pasted YouTube Music link carries official credits that beat parsing the video title
  if (job.sourceUrl && info.track) {
    title = info.track;
    if (info.artists?.length) artist = info.artists.join(', ');
  }
  if (!album || !coverUrl) {
    const details = await findSongDetails(title, artist, info.duration ?? job.duration);
    if (details) {
      album ??= details.album ?? null;
      coverUrl ??= details.coverUrl ?? null;
      artist ??= details.artist;
    }
  }

  update(job.id, { status: 'importing', title, artist, album, coverUrl });

  const result = await ingestAudioFile({
    sourcePath: filePath,
    originalFilename: `${artist ? `${artist} - ` : ''}${title}`,
    userId: job.requestedBy,
    keepOriginal: true,
    meta: {
      title,
      artist: artist ?? undefined,
      album: album ?? undefined,
      cover: await fetchCover(coverUrl),
    },
  });

  const trackId = result.status === 'created' ? result.trackId : result.duplicate.existingTrack.id;
  if (job.playlistId) addToPlaylist(job.playlistId, trackId, job.playlistPosition);

  if (result.status === 'created') {
    update(job.id, { status: 'done', trackId, error: null });
  } else {
    update(job.id, { status: 'skipped', trackId, error: `Already in library as "${result.duplicate.existingTrack.title}"` });
  }
}
