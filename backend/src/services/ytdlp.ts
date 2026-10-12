/**
 * Thin wrapper around the yt-dlp CLI. yt-dlp is installed in the Docker image (see Dockerfile);
 * for local development install it yourself (`brew install yt-dlp`) or point YTDLP_PATH at it.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
// Node is always present, so use it to solve YouTube's JavaScript challenges (no Deno needed).
// YTDLP_ARGS adds site options, e.g. a PO-token provider or --cookies if YouTube starts blocking.
const BASE_ARGS = ['--ignore-config', '--no-warnings', '--js-runtimes', 'node', ...splitArgs(process.env.YTDLP_ARGS)];

function splitArgs(value: string | undefined): string[] {
  return value ? value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((a) => a.replace(/^"|"$/g, '')) ?? [] : [];
}

async function run(args: string[], timeoutMs = 60_000): Promise<string> {
  try {
    const { stdout } = await execFileAsync(YTDLP, [...BASE_ARGS, ...args], {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    if (e.code === 'ENOENT') throw new Error('yt-dlp is not installed on the server');
    if (e.killed) throw new Error('yt-dlp timed out');
    // Last ERROR line is the useful part ("ERROR: [youtube] xyz: Video unavailable")
    const line = (e.stderr ?? '').split('\n').filter((l) => l.startsWith('ERROR')).pop();
    throw new Error(line ? line.replace(/^ERROR:\s*/, '') : e.message);
  }
}

export interface VideoInfo {
  id: string;
  title: string;
  /** YouTube Music song metadata, when the video is an official song */
  track?: string | null;
  artists?: string[] | null;
  artist?: string | null;
  album?: string | null;
  channel?: string | null;
  duration?: number | null;
}

const INFO_FIELDS = '%(.{id,title,track,artists,artist,album,channel,duration})j';

/** Song results from YouTube Music search (official audio), with full metadata. */
export async function searchYouTubeMusic(query: string, limit = 4): Promise<VideoInfo[]> {
  const flat = JSON.parse(await run([
    '--flat-playlist', '-J', '--playlist-end', String(limit),
    `https://music.youtube.com/search?q=${encodeURIComponent(query)}#songs`,
  ])) as { entries?: { id: string }[] };
  const ids = (flat.entries ?? []).map((e) => e.id).filter(Boolean).slice(0, limit);
  if (ids.length === 0) return [];
  // Flat search results have no length or credits; one more call fetches them for all candidates
  const out = await run(['--skip-download', '--print', INFO_FIELDS, ...ids.map((id) => `https://music.youtube.com/watch?v=${id}`)], 120_000)
    .catch(() => '');
  return out.split('\n').filter(Boolean).map((line) => JSON.parse(line) as VideoInfo);
}

/** Regular YouTube search, used when YouTube Music has no match (rare songs, uploads by fans). */
export async function searchYouTube(query: string, limit = 8): Promise<VideoInfo[]> {
  const flat = JSON.parse(await run(['--flat-playlist', '-J', `ytsearch${limit}:${query}`])) as { entries?: VideoInfo[] };
  return (flat.entries ?? []).filter((e) => e.id);
}

/** Metadata for a single video or every entry of a playlist URL (no download). */
export async function getUrlInfo(url: string): Promise<{ title: string | null; entries: VideoInfo[] }> {
  const data = JSON.parse(await run(['--flat-playlist', '-J', url], 120_000)) as VideoInfo & {
    _type?: string;
    entries?: VideoInfo[];
  };
  if (data._type === 'playlist') {
    return { title: data.title ?? null, entries: (data.entries ?? []).filter((e) => e.id) };
  }
  return { title: null, entries: [data] };
}

/**
 * Downloads the best audio stream without re-encoding. M4A (AAC) is preferred because it
 * plays everywhere including iOS; other formats are converted to MP3 by the import step.
 */
export async function downloadAudio(url: string, outputBase: string): Promise<{ filePath: string; info: VideoInfo }> {
  const out = await run([
    '-f', 'bestaudio[ext=m4a]/bestaudio',
    '--no-playlist', '--no-progress', '--no-simulate',
    '-o', `${outputBase}.%(ext)s`,
    '--print', INFO_FIELDS,
    '--print', 'after_move:filepath',
    url,
  ], 10 * 60_000);
  const lines = out.split('\n').filter(Boolean);
  const infoLine = lines.find((l) => l.startsWith('{'));
  const filePath = lines.filter((l) => !l.startsWith('{')).pop();
  if (!infoLine || !filePath) throw new Error('yt-dlp did not report the downloaded file');
  return { filePath, info: JSON.parse(infoLine) as VideoInfo };
}

export async function ytdlpVersion(): Promise<string | null> {
  try {
    return (await run(['--version'], 15_000)).trim();
  } catch {
    return null;
  }
}

/** Upgrades yt-dlp in place (YouTube changes often break older versions). Only works in the Docker image. */
export async function updateYtdlp(): Promise<string | null> {
  await execFileAsync('python3', ['-m', 'pip', 'install', '--quiet', '--upgrade', '--break-system-packages', 'yt-dlp[default]'], {
    timeout: 5 * 60_000,
  });
  return ytdlpVersion();
}
