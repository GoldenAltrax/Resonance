import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FingerprintResult {
  fingerprint: string;
  duration: number;
}

export interface AcoustIDResult {
  acoustidId: string;
  musicbrainzRecordingId: string;
}

export interface DuplicateScoreBreakdown {
  mbid: boolean;
  duration: boolean;
  title: boolean;
  filename: boolean;
}

export interface DuplicateScoreResult {
  score: number;
  breakdown: DuplicateScoreBreakdown;
}

export interface IncomingTrackMeta {
  title: string;
  artist: string | null;
  duration: number;
  originalFilename: string;
  musicbrainzRecordingId: string | null;
}

export interface ExistingTrackMeta {
  title: string;
  artist: string | null;
  duration: number;
  originalFilename: string | null;
  musicbrainzRecordingId: string | null;
}

// ─── generateFingerprint ────────────────────────────────────────────────────

export async function generateFingerprint(filePath: string): Promise<FingerprintResult | null> {
  try {
    const { stdout } = await execFileAsync('fpcalc', ['-json', '-length', '120', filePath], {
      timeout: 30_000,
    });
    const parsed = JSON.parse(stdout) as { fingerprint: string; duration: number };
    if (!parsed.fingerprint || !parsed.duration) return null;
    return { fingerprint: parsed.fingerprint, duration: Math.round(parsed.duration) };
  } catch {
    return null;
  }
}

// ─── lookupAcoustID ─────────────────────────────────────────────────────────

export async function lookupAcoustID(
  fingerprint: string,
  duration: number
): Promise<AcoustIDResult | null> {
  const apiKey = process.env.ACOUSTID_API_KEY;
  if (!apiKey) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    const params = new URLSearchParams({
      client: apiKey,
      fingerprint,
      duration: String(duration),
      meta: 'recordings',
    });

    const response = await fetch(`https://api.acoustid.org/v2/lookup?${params.toString()}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json() as {
      status: string;
      results?: Array<{
        id: string;
        score: number;
        recordings?: Array<{ id: string }>;
      }>;
    };

    if (data.status !== 'ok' || !data.results?.length) return null;

    for (const result of data.results) {
      if (result.recordings?.length) {
        return {
          acoustidId: result.id,
          musicbrainzRecordingId: result.recordings[0]!.id,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── calculateDuplicateScore ────────────────────────────────────────────────

export function calculateDuplicateScore(
  incoming: IncomingTrackMeta,
  existing: ExistingTrackMeta
): DuplicateScoreResult {
  const breakdown: DuplicateScoreBreakdown = {
    mbid: false,
    duration: false,
    title: false,
    filename: false,
  };

  if (
    incoming.musicbrainzRecordingId &&
    existing.musicbrainzRecordingId &&
    incoming.musicbrainzRecordingId === existing.musicbrainzRecordingId
  ) {
    breakdown.mbid = true;
  }

  if (Math.abs(incoming.duration - existing.duration) <= 2) {
    breakdown.duration = true;
  }

  const normalise = (s: string) => s.toLowerCase().trim();
  if (normalise(incoming.title) === normalise(existing.title)) {
    breakdown.title = true;
  }

  if (
    existing.originalFilename &&
    normalise(incoming.originalFilename) === normalise(existing.originalFilename)
  ) {
    breakdown.filename = true;
  }

  const score =
    (breakdown.mbid ? 50 : 0) +
    (breakdown.duration ? 20 : 0) +
    (breakdown.title ? 15 : 0) +
    (breakdown.filename ? 15 : 0);

  return { score, breakdown };
}
