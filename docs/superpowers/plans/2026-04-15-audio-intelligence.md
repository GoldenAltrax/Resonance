# Audio Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace title-based duplicate detection with acoustic fingerprinting (Chromaprint/fpcalc), AcoustID cross-reference, and a weighted similarity score — showing admins a breakdown modal when a potential duplicate is detected during upload.

**Architecture:** On upload, the backend generates a Chromaprint fingerprint via `fpcalc`, looks up the matching MusicBrainz Recording ID via AcoustID, and scores the new file against existing library tracks using four signals (MBID match, duration, title, filename). Scores ≥ 60 return HTTP 409 with match details; the frontend intercepts this, collects duplicates during the import loop, and shows an `AcousticDuplicateModal` after the loop finishes.

**Tech Stack:** fpcalc (libchromaprint-tools), AcoustID REST API (free), Vitest (backend unit tests), React + Tailwind (modal), Drizzle ORM migration.

---

## File Map

| File | Change |
|---|---|
| `backend/src/utils/fingerprint.ts` | **CREATE** — `generateFingerprint`, `lookupAcoustID`, `calculateDuplicateScore` |
| `backend/src/utils/fingerprint.test.ts` | **CREATE** — Vitest unit tests for all three functions |
| `backend/vitest.config.ts` | **CREATE** — Vitest config for Node ESM |
| `backend/package.json` | **MODIFY** — add `vitest` dev dep + `test` script |
| `backend/src/db/schema.ts` | **MODIFY** — add `acoustidFingerprint`, `acoustidId`, `musicbrainzRecordingId` columns |
| `backend/src/db/migrations/0008_add_fingerprint_fields.sql` | **CREATE** — ALTER TABLE migration |
| `backend/src/routes/tracks.ts` | **MODIFY** — import fingerprint utils, modify upload route (fingerprint check + 409 + ?force), add `fingerprint-all` endpoint |
| `backend/.env.example` | **MODIFY** — add `ACOUSTID_API_KEY` |
| `frontend/src/services/api.ts` | **MODIFY** — `uploadTrack()` throws `DuplicateError` on 409, add `uploadTrackForce()` |
| `frontend/src/types/index.ts` | **MODIFY** — add `AcousticDuplicate` interface + `DuplicateError` class |
| `frontend/src/components/ui/AcousticDuplicateModal.tsx` | **CREATE** — shows matched track, score, breakdown, Cancel/Upload Anyway |
| `frontend/src/views/LibraryView.tsx` | **MODIFY** — remove pre-check, catch `DuplicateError` in loop, show new modal |
| `frontend/src/views/PlaylistDetailView.tsx` | **MODIFY** — same as LibraryView |
| `frontend/src/views/AdminView.tsx` | **MODIFY** — add "Re-fingerprint Library" button in debug tab |

---

## Task 1: Backend test infrastructure

**Files:**
- Create: `backend/vitest.config.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Install vitest**

```bash
cd backend && npm install -D vitest
```

Expected: vitest appears in `backend/node_modules/.bin/vitest`

- [ ] **Step 2: Create vitest config**

Create `backend/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 3: Add test script to backend/package.json**

In `backend/package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify vitest runs**

```bash
cd backend && npm test
```

Expected output: `No test files found` (no tests yet — that's correct)

- [ ] **Step 5: Commit**

```bash
cd backend && git add vitest.config.ts package.json package-lock.json && git commit -m "chore(backend): add vitest test infrastructure"
```

---

## Task 2: Write failing tests for fingerprint utilities

**Files:**
- Create: `backend/src/utils/fingerprint.test.ts`

This is TDD — write the tests before the implementation exists.

- [ ] **Step 1: Create the test file**

Create `backend/src/utils/fingerprint.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── calculateDuplicateScore ────────────────────────────────────────────────

// Import will fail until we create the module — that's expected
import { calculateDuplicateScore } from './fingerprint.js';

const BASE_TRACK = {
  id: 'existing-1',
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  album: 'A Night at the Opera',
  duration: 354,
  originalFilename: 'bohemian_rhapsody',
  musicbrainzRecordingId: 'mbid-abc-123',
};

describe('calculateDuplicateScore', () => {
  it('scores 100 when all signals match', () => {
    const result = calculateDuplicateScore(
      { title: 'Bohemian Rhapsody', artist: 'Queen', duration: 356, originalFilename: 'bohemian_rhapsody', musicbrainzRecordingId: 'mbid-abc-123' },
      BASE_TRACK
    );
    expect(result.score).toBe(100);
    expect(result.breakdown.mbid).toBe(true);
    expect(result.breakdown.duration).toBe(true);
    expect(result.breakdown.title).toBe(true);
    expect(result.breakdown.filename).toBe(true);
  });

  it('scores 50 when only MBID matches', () => {
    const result = calculateDuplicateScore(
      { title: 'Different Title', artist: 'Other', duration: 999, originalFilename: 'different_file', musicbrainzRecordingId: 'mbid-abc-123' },
      BASE_TRACK
    );
    expect(result.score).toBe(50);
    expect(result.breakdown.mbid).toBe(true);
    expect(result.breakdown.duration).toBe(false);
    expect(result.breakdown.title).toBe(false);
    expect(result.breakdown.filename).toBe(false);
  });

  it('scores 35 when duration and title and filename match but no MBID', () => {
    const result = calculateDuplicateScore(
      { title: 'Bohemian Rhapsody', artist: 'Queen', duration: 355, originalFilename: 'bohemian_rhapsody', musicbrainzRecordingId: null },
      { ...BASE_TRACK, musicbrainzRecordingId: null }
    );
    expect(result.score).toBe(50); // 20 + 15 + 15
    expect(result.breakdown.mbid).toBe(false);
    expect(result.breakdown.duration).toBe(true);
    expect(result.breakdown.title).toBe(true);
    expect(result.breakdown.filename).toBe(true);
  });

  it('duration match requires delta <= 2s', () => {
    const close = calculateDuplicateScore(
      { title: 'X', artist: null, duration: 356, originalFilename: 'x', musicbrainzRecordingId: null },
      { ...BASE_TRACK, duration: 354, musicbrainzRecordingId: null }
    );
    expect(close.breakdown.duration).toBe(true);

    const far = calculateDuplicateScore(
      { title: 'X', artist: null, duration: 360, originalFilename: 'x', musicbrainzRecordingId: null },
      { ...BASE_TRACK, duration: 354, musicbrainzRecordingId: null }
    );
    expect(far.breakdown.duration).toBe(false);
  });

  it('title match is case-insensitive and trims whitespace', () => {
    const result = calculateDuplicateScore(
      { title: '  BOHEMIAN RHAPSODY  ', artist: null, duration: 0, originalFilename: 'x', musicbrainzRecordingId: null },
      { ...BASE_TRACK, musicbrainzRecordingId: null }
    );
    expect(result.breakdown.title).toBe(true);
  });

  it('scores 0 when nothing matches', () => {
    const result = calculateDuplicateScore(
      { title: 'Completely Different', artist: 'Nobody', duration: 999, originalFilename: 'unrelated', musicbrainzRecordingId: 'other-mbid' },
      BASE_TRACK
    );
    expect(result.score).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail with import error**

```bash
cd backend && npm test
```

Expected: `Cannot find module './fingerprint.js'` — this is correct, we haven't written the implementation yet.

---

## Task 3: Implement fingerprint utilities

**Files:**
- Create: `backend/src/utils/fingerprint.ts`

- [ ] **Step 1: Create the utility module**

Create `backend/src/utils/fingerprint.ts`:

```typescript
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

/**
 * Generates a Chromaprint acoustic fingerprint using fpcalc.
 * Returns null if fpcalc is not installed or the file cannot be analysed.
 * Requires: apt install libchromaprint-tools
 */
export async function generateFingerprint(filePath: string): Promise<FingerprintResult | null> {
  try {
    const { stdout } = await execFileAsync('fpcalc', ['-json', '-length', '120', filePath], {
      timeout: 30_000,
    });
    const parsed = JSON.parse(stdout) as { fingerprint: string; duration: number };
    if (!parsed.fingerprint || !parsed.duration) return null;
    return { fingerprint: parsed.fingerprint, duration: Math.round(parsed.duration) };
  } catch {
    // fpcalc not installed, file unreadable, or timeout — degrade gracefully
    return null;
  }
}

// ─── lookupAcoustID ─────────────────────────────────────────────────────────

/**
 * Submits a fingerprint to AcoustID and returns the top-confidence
 * MusicBrainz Recording ID. Returns null on network error or no match.
 * Requires ACOUSTID_API_KEY env var (free at acoustid.org).
 */
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

    // Pick highest-score result that has a recording ID
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
    // Network error, timeout, or parse failure — degrade gracefully
    return null;
  }
}

// ─── calculateDuplicateScore ────────────────────────────────────────────────

/**
 * Scores how similar an incoming track is to an existing library track.
 * Pure function — no I/O.
 *
 * Score breakdown (max 100):
 *   MusicBrainz Recording ID exact match  → 50 pts
 *   Duration delta ≤ 2 seconds            → 20 pts
 *   Title + artist match (normalised)     → 15 pts
 *   Original filename exact match         → 15 pts
 */
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

  // MBID match (50 pts)
  if (
    incoming.musicbrainzRecordingId &&
    existing.musicbrainzRecordingId &&
    incoming.musicbrainzRecordingId === existing.musicbrainzRecordingId
  ) {
    breakdown.mbid = true;
  }

  // Duration match — within 2 seconds (20 pts)
  if (Math.abs(incoming.duration - existing.duration) <= 2) {
    breakdown.duration = true;
  }

  // Title match — case-insensitive, trimmed (15 pts)
  const normalise = (s: string) => s.toLowerCase().trim();
  if (normalise(incoming.title) === normalise(existing.title)) {
    breakdown.title = true;
  }

  // Filename match — case-insensitive (15 pts)
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
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
cd backend && npm test
```

Expected: all 6 tests pass with no failures.

- [ ] **Step 3: Fix the score assertion in the test (50 not 35)**

Open `backend/src/utils/fingerprint.test.ts` and fix the comment on the third test — the score is 50 (20 + 15 + 15), not 35. The assertion `toBe(50)` is already correct; just fix the description:

```typescript
  it('scores 50 when duration and title and filename match but no MBID', () => {
```

- [ ] **Step 4: Commit**

```bash
cd backend && git add src/utils/fingerprint.ts src/utils/fingerprint.test.ts && git commit -m "feat(backend): add fingerprint utilities with calculateDuplicateScore, generateFingerprint, lookupAcoustID"
```

---

## Task 4: Database schema + migration

**Files:**
- Modify: `backend/src/db/schema.ts`
- Create: `backend/src/db/migrations/0008_add_fingerprint_fields.sql`

- [ ] **Step 1: Add columns to schema**

In `backend/src/db/schema.ts`, find the `tracks` table definition and add three columns after the `energy` column (line ~39):

```typescript
  // Acoustic fingerprinting fields (added v4.4.0)
  acoustidFingerprint: text('acoustid_fingerprint'),       // Chromaprint compressed fingerprint string
  acoustidId: text('acoustid_id'),                          // AcoustID result ID
  musicbrainzRecordingId: text('musicbrainz_recording_id'), // Top-confidence MusicBrainz Recording ID
```

- [ ] **Step 2: Create migration SQL**

Create `backend/src/db/migrations/0008_add_fingerprint_fields.sql`:

```sql
ALTER TABLE `tracks` ADD `acoustid_fingerprint` text;
ALTER TABLE `tracks` ADD `acoustid_id` text;
ALTER TABLE `tracks` ADD `musicbrainz_recording_id` text;
```

- [ ] **Step 3: Apply migration**

```bash
cd /path/to/project && npm run db:migrate
```

Expected: migration applied, no errors. Existing rows have NULL in the three new columns.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/schema.ts backend/src/db/migrations/0008_add_fingerprint_fields.sql && git commit -m "feat(db): add acoustid_fingerprint, acoustid_id, musicbrainz_recording_id columns to tracks"
```

---

## Task 5: Modify backend upload route

**Files:**
- Modify: `backend/src/routes/tracks.ts`

This task modifies the `POST /` (upload) handler to run fingerprinting before inserting, and adds the `?force=true` bypass. It also stores the new fields on insert.

- [ ] **Step 1: Add imports at the top of tracks.ts**

At the top of `backend/src/routes/tracks.ts`, after the existing imports, add:

```typescript
import { generateFingerprint, lookupAcoustID, calculateDuplicateScore } from '../utils/fingerprint.js';
```

- [ ] **Step 2: Add duplicate check type**

After the existing `skipTrackSchema` const (around line 29), add:

```typescript
// Shape of the 409 duplicate response body
interface DuplicateResponseBody {
  duplicate: {
    score: number;
    breakdown: {
      mbid: boolean;
      duration: boolean;
      title: boolean;
      filename: boolean;
    };
    existingTrack: typeof tracks.$inferSelect;
  };
}
```

- [ ] **Step 3: Modify the upload route — add fingerprint pipeline after compressAudio**

In the `POST /` handler, find the block that runs `analyzeAudio()` (around line 351). Replace:

```typescript
      // Analyze audio for Radio mode (BPM, key, energy)
      const analysis = await analyzeAudio(finalFilePath);
```

with:

```typescript
      // Check ?force=true — skip duplicate detection if admin confirmed override
      const forceUpload = (request.query as Record<string, string>)?.force === 'true';

      if (!forceUpload) {
        // Generate acoustic fingerprint
        const fp = await generateFingerprint(finalFilePath);

        // Look up AcoustID / MusicBrainz (non-blocking, silent fail)
        let acoustidResult = null;
        if (fp) {
          acoustidResult = await lookupAcoustID(fp.fingerprint, fp.duration);
        }

        // Store fingerprint data for use after the check
        (request as Record<string, unknown>)._fpData = { fp, acoustidResult };

        // Find candidate tracks: MBID match OR filename match
        const candidates = await db.query.tracks.findMany();
        const incomingMeta = {
          title,
          artist,
          duration,
          originalFilename: data.filename.replace(/\.[^/.]+$/, ''),
          musicbrainzRecordingId: acoustidResult?.musicbrainzRecordingId ?? null,
        };

        let bestScore = 0;
        let bestMatch: typeof candidates[number] | null = null;

        for (const candidate of candidates) {
          const { score } = calculateDuplicateScore(incomingMeta, {
            title: candidate.title,
            artist: candidate.artist,
            duration: candidate.duration,
            originalFilename: candidate.originalFilename,
            musicbrainzRecordingId: candidate.musicbrainzRecordingId,
          });
          if (score > bestScore) {
            bestScore = score;
            bestMatch = candidate;
          }
        }

        if (bestScore >= 60 && bestMatch) {
          // Clean up temp + final files before returning
          try { await unlink(tempFilePath); } catch { /* ignore */ }
          try { await unlink(finalFilePath); } catch { /* ignore */ }

          const { breakdown } = calculateDuplicateScore(incomingMeta, {
            title: bestMatch.title,
            artist: bestMatch.artist,
            duration: bestMatch.duration,
            originalFilename: bestMatch.originalFilename,
            musicbrainzRecordingId: bestMatch.musicbrainzRecordingId,
          });

          return reply.status(409).send({
            duplicate: {
              score: bestScore,
              breakdown,
              existingTrack: bestMatch,
            },
          } satisfies DuplicateResponseBody);
        }
      }

      // Analyze audio for Radio mode (BPM, key, energy)
      const analysis = await analyzeAudio(finalFilePath);
```

- [ ] **Step 4: Store fingerprint fields in DB insert**

Find the `db.insert(tracks).values({` block (around line 358). Add the three new fields to the values object:

```typescript
        // Retrieve fp data attached during duplicate check (may be undefined if force=true)
        const fpData = (request as Record<string, unknown>)._fpData as
          | { fp: { fingerprint: string } | null; acoustidResult: { acoustidId: string; musicbrainzRecordingId: string } | null }
          | undefined;

        await db.insert(tracks).values({
          id: trackId,
          title,
          artist,
          album,
          duration,
          filePath: `audio/${finalFilename}`,
          originalFilename,
          coverArt: coverArtPath,
          bpm: analysis.bpm,
          key: analysis.key,
          energy: analysis.energy,
          acoustidFingerprint: fpData?.fp?.fingerprint ?? null,
          acoustidId: fpData?.acoustidResult?.acoustidId ?? null,
          musicbrainzRecordingId: fpData?.acoustidResult?.musicbrainzRecordingId ?? null,
          userId,
        });
```

- [ ] **Step 5: Verify backend starts without errors**

```bash
npm run dev:backend
```

Expected: Fastify starts on port 3000, no TypeScript errors in the console.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/tracks.ts && git commit -m "feat(backend): acoustic fingerprint duplicate detection on upload with 409 response"
```

---

## Task 6: Add fingerprint-all admin endpoint

**Files:**
- Modify: `backend/src/routes/tracks.ts`

- [ ] **Step 1: Add the endpoint**

In `backend/src/routes/tracks.ts`, after the existing `analyze-all` endpoint (around line 783), add:

```typescript
  // Fingerprint existing tracks that haven't been fingerprinted yet — ADMIN ONLY
  app.post('/fingerprint-all', {
    preHandler: adminMiddleware,
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const allTracks = await db.query.tracks.findMany();
    const toFingerprint = allTracks.filter(t => !t.acoustidFingerprint);

    if (toFingerprint.length === 0) {
      return reply.send({ message: 'All tracks already fingerprinted', processed: 0, total: allTracks.length });
    }

    let processed = 0;
    let failed = 0;

    for (const track of toFingerprint) {
      const filePath = resolveStoredFilePath(track.filePath);
      if (!filePath) { failed++; continue; }

      try {
        const fp = await generateFingerprint(filePath);
        if (!fp) { failed++; continue; }

        // Rate-limit AcoustID to 1 req/sec
        await new Promise(r => setTimeout(r, 1000));
        const acoustidResult = await lookupAcoustID(fp.fingerprint, fp.duration);

        await db.update(tracks)
          .set({
            acoustidFingerprint: fp.fingerprint,
            acoustidId: acoustidResult?.acoustidId ?? null,
            musicbrainzRecordingId: acoustidResult?.musicbrainzRecordingId ?? null,
          })
          .where(eq(tracks.id, track.id));

        processed++;
        console.log(`Fingerprinted track ${track.id}: mbid=${acoustidResult?.musicbrainzRecordingId ?? 'none'}`);
      } catch (err) {
        failed++;
        console.error(`Failed to fingerprint track ${track.id}:`, err);
      }
    }

    return reply.send({ message: 'Fingerprinting complete', processed, failed, total: allTracks.length });
  });
```

- [ ] **Step 2: Add ACOUSTID_API_KEY to .env.example**

Open `backend/.env.example` and add:

```env
# AcoustID API key (free registration at https://acoustid.org/login)
# Required for cross-source duplicate detection via MusicBrainz
ACOUSTID_API_KEY=
```

- [ ] **Step 3: Verify backend starts cleanly**

```bash
npm run dev:backend
```

Expected: Fastify starts, no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/tracks.ts backend/.env.example && git commit -m "feat(backend): add POST /api/tracks/fingerprint-all admin endpoint"
```

---

## Task 7: Frontend types — AcousticDuplicate + DuplicateError

**Files:**
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Add types**

Open `frontend/src/types/index.ts` and add at the end of the file:

```typescript
// ─── Acoustic Duplicate Detection ───────────────────────────────────────────

export interface AcousticDuplicateBreakdown {
  mbid: boolean;
  duration: boolean;
  title: boolean;
  filename: boolean;
}

export interface AcousticDuplicate {
  score: number;
  breakdown: AcousticDuplicateBreakdown;
  existingTrack: Track;
}

export class DuplicateError extends Error {
  constructor(public readonly duplicate: AcousticDuplicate) {
    super('Acoustic duplicate detected');
    this.name = 'DuplicateError';
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/types/index.ts && git commit -m "feat(frontend): add AcousticDuplicate types and DuplicateError class"
```

---

## Task 8: Frontend API layer — handle 409 in uploadTrack

**Files:**
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: Import DuplicateError and AcousticDuplicate at the top of api.ts**

At the top of `frontend/src/services/api.ts`, add:

```typescript
import { DuplicateError, AcousticDuplicate } from '@/types/index';
```

- [ ] **Step 2: Replace uploadTrack() and add uploadTrackForce()**

Find the existing `uploadTrack` method (around line 181) and replace it entirely:

```typescript
  async uploadTrack(file: File): Promise<Track> {
    const formData = new FormData();
    formData.append('file', file);

    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const response = await fetch(`${API_URL}/tracks`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (response.status === 409) {
      const data = await response.json() as { duplicate: AcousticDuplicate };
      throw new DuplicateError(data.duplicate);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'An error occurred' })) as { error: string };
      throw new Error(error.error || 'Upload failed');
    }

    return response.json() as Promise<Track>;
  }

  async uploadTrackForce(file: File): Promise<Track> {
    const formData = new FormData();
    formData.append('file', file);
    return this.request<Track>('/tracks?force=true', {
      method: 'POST',
      body: formData,
    });
  }
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/api.ts && git commit -m "feat(frontend): uploadTrack throws DuplicateError on 409, add uploadTrackForce"
```

---

## Task 9: AcousticDuplicateModal component

**Files:**
- Create: `frontend/src/components/ui/AcousticDuplicateModal.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/ui/AcousticDuplicateModal.tsx`:

```tsx
import { useRef, useCallback, useEffect } from 'react';
import { X, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { AcousticDuplicate } from '@/types/index';

export interface PendingDuplicate {
  file: File;
  duplicate: AcousticDuplicate;
}

interface AcousticDuplicateModalProps {
  isOpen: boolean;
  pendingDuplicates: PendingDuplicate[];
  onClose: () => void;
  onUploadAnyway: (file: File) => Promise<void>;
}

function ScoreBar({ score }: { score: number }) {
  const isStrong = score >= 85;
  const filled = Math.round(score / 5); // 20 segments

  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-0.5">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className={`h-2 w-2.5 rounded-sm ${
              i < filled
                ? isStrong
                  ? 'bg-red-500'
                  : 'bg-amber-500'
                : 'bg-zinc-800'
            }`}
          />
        ))}
      </div>
      <span
        className={`text-sm font-semibold ${
          isStrong ? 'text-red-400' : 'text-amber-400'
        }`}
      >
        {score}% — {isStrong ? 'STRONG MATCH' : 'POSSIBLE MATCH'}
      </span>
    </div>
  );
}

function BreakdownRow({ label, matched, detail }: { label: string; matched: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      {matched ? (
        <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 text-zinc-600 shrink-0" />
      )}
      <span className={matched ? 'text-zinc-300' : 'text-zinc-600'}>
        <span className="font-medium">{label}</span>
        {matched && <span className="text-zinc-500"> — {detail}</span>}
      </span>
    </div>
  );
}

const AcousticDuplicateModal = ({
  isOpen,
  pendingDuplicates,
  onClose,
  onUploadAnyway,
}: AcousticDuplicateModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key !== 'Tab' || !modalRef.current) return;
    const focusable = Array.from(
      modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    const t = setTimeout(() => modalRef.current?.querySelector<HTMLButtonElement>('button')?.focus(), 0);
    return () => { document.removeEventListener('keydown', handleKeyDown); clearTimeout(t); };
  }, [isOpen, handleKeyDown]);

  if (!isOpen || !pendingDuplicates.length) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 pb-28">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="acoustic-dup-title"
        className="bg-[#111111] border border-zinc-800 rounded-2xl w-full max-w-lg max-h-[75vh] flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500/20 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h2 id="acoustic-dup-title" className="text-lg font-medium text-white">
                Possible Duplicate{pendingDuplicates.length > 1 ? 's' : ''} Detected
              </h2>
              <p className="text-zinc-500 text-sm">
                {pendingDuplicates.length} track{pendingDuplicates.length > 1 ? 's were' : ' was'} flagged by acoustic analysis
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {pendingDuplicates.map(({ file, duplicate }, idx) => (
            <div key={idx} className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800/50 space-y-4">
              {/* Track info */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-zinc-500 text-xs uppercase tracking-wide mb-1">Uploading</p>
                  <p className="text-white font-medium truncate">{file.name.replace(/\.[^/.]+$/, '')}</p>
                </div>
                <div>
                  <p className="text-zinc-500 text-xs uppercase tracking-wide mb-1">Existing match</p>
                  <p className="text-white font-medium truncate">{duplicate.existingTrack.title}</p>
                  <p className="text-zinc-500 truncate">{duplicate.existingTrack.artist ?? 'Unknown Artist'}</p>
                </div>
              </div>

              {/* Score bar */}
              <ScoreBar score={duplicate.score} />

              {/* Breakdown */}
              <div className="space-y-2">
                <BreakdownRow label="MusicBrainz ID" matched={duplicate.breakdown.mbid} detail="same recording, confirmed cross-source" />
                <BreakdownRow label="Duration" matched={duplicate.breakdown.duration} detail="within 2 seconds" />
                <BreakdownRow label="Title / Artist" matched={duplicate.breakdown.title} detail="exact match" />
                <BreakdownRow label="Filename" matched={duplicate.breakdown.filename} detail="exact match" />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => onUploadAnyway(file)}
                  className="flex-1 px-4 py-2 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors text-sm"
                >
                  Upload Anyway
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 rounded-xl bg-white text-black font-medium hover:bg-zinc-200 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default AcousticDuplicateModal;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ui/AcousticDuplicateModal.tsx && git commit -m "feat(frontend): add AcousticDuplicateModal component"
```

---

## Task 10: Wire AcousticDuplicateModal into LibraryView

**Files:**
- Modify: `frontend/src/views/LibraryView.tsx`

The changes are:
1. Remove the old `api.checkDuplicates()` pre-check calls
2. Remove state related to the old `DuplicateModal` (`showDuplicateModal`, `pendingFiles`, etc.)
3. Add state for acoustic duplicates
4. In `processFiles`, catch `DuplicateError` and collect duplicates
5. After the loop, show `AcousticDuplicateModal` if any duplicates found
6. Replace old `DuplicateModal` JSX with the new `AcousticDuplicateModal`

- [ ] **Step 1: Add imports**

At the top of `frontend/src/views/LibraryView.tsx`, add:

```typescript
import AcousticDuplicateModal, { PendingDuplicate } from '@/components/ui/AcousticDuplicateModal';
import { DuplicateError } from '@/types/index';
import { api } from '@/services/api';
```

Remove the existing import of `DuplicateModal` and `DuplicateItem`/`DuplicateAction` from that file if it is no longer used elsewhere in the file after these changes.

- [ ] **Step 2: Replace old duplicate state with new acoustic duplicate state**

Find these state declarations (around line 68):
```typescript
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
```
And any related `pendingFiles` state. Replace / add:

```typescript
  const [acousticDuplicates, setAcousticDuplicates] = useState<PendingDuplicate[]>([]);
  const [showAcousticDuplicateModal, setShowAcousticDuplicateModal] = useState(false);
```

- [ ] **Step 3: Simplify processFiles — remove duplicate action logic, add DuplicateError handling**

The current `processFiles` signature is:
```typescript
const processFiles = useCallback(async (
  files: File[],
  duplicateActions: Map<string, { action: DuplicateAction; existingTrackId: string }>
) => {
```

Replace the function with:

```typescript
  const processFiles = useCallback(async (files: File[]) => {
    cancelRef.current = false;
    setIsUploading(true);
    setUploadProgress({ current: 0, total: files.length, completed: 0, skipped: 0, currentFile: '' });

    let completed = 0;
    let skipped = 0;
    const foundDuplicates: PendingDuplicate[] = [];

    for (let i = 0; i < files.length; i++) {
      if (cancelRef.current) break;
      const file = files[i];
      if (!file) continue;

      setUploadProgress((prev) => ({ ...prev, current: i, currentFile: file.name }));

      try {
        await uploadTrack(file, true);
        completed++;
      } catch (err) {
        if (err instanceof DuplicateError) {
          foundDuplicates.push({ file, duplicate: err.duplicate });
        } else {
          skipped++;
        }
      }

      setUploadProgress((prev) => ({ ...prev, current: i + 1, completed, skipped }));
    }

    await fetchLibrary();
    setIsUploading(false);
    setUploadProgress({ current: 0, total: 0, completed: 0, skipped: 0, currentFile: '' });
    setPendingFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (foundDuplicates.length > 0) {
      setAcousticDuplicates(foundDuplicates);
      setShowAcousticDuplicateModal(true);
    }
  }, [uploadTrack, fetchLibrary]);
```

- [ ] **Step 4: Remove old pre-check calls**

Find every call to `api.checkDuplicates(...)` in `LibraryView.tsx` and remove the entire pre-check block. These are the `handleFileDrop` and `handleFileUpload` handlers that build `trackMeta`, call `checkDuplicates`, and then either call `processFiles` with a duplicate map or show the old modal.

Replace those handlers so they call `processFiles(files)` directly (no duplicate map argument).

Example — after the change, `handleFileDrop` should end with:
```typescript
    await processFiles(Array.from(files));
```

- [ ] **Step 5: Add handleUploadAnyway callback**

Add this callback inside the component, before the return:

```typescript
  const handleUploadAnyway = useCallback(async (file: File) => {
    try {
      const track = await api.uploadTrackForce(file);
      // Update store state directly without a full refetch
      fetchLibrary();
      toast.success(`Uploaded "${track.title}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    }
    // Remove this file from the pending duplicates list
    setAcousticDuplicates((prev) => prev.filter((d) => d.file !== file));
  }, [fetchLibrary]);
```

- [ ] **Step 6: Replace old DuplicateModal JSX with AcousticDuplicateModal**

Find the `<DuplicateModal ... />` in the return JSX (around line 781) and replace it with:

```tsx
      <AcousticDuplicateModal
        isOpen={showAcousticDuplicateModal}
        pendingDuplicates={acousticDuplicates}
        onClose={() => {
          setShowAcousticDuplicateModal(false);
          setAcousticDuplicates([]);
        }}
        onUploadAnyway={handleUploadAnyway}
      />
```

- [ ] **Step 7: Verify frontend compiles**

```bash
npm run dev:frontend
```

Expected: Vite compiles without TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/views/LibraryView.tsx && git commit -m "feat(frontend): replace pre-check duplicate flow with acoustic DuplicateError handling in LibraryView"
```

---

## Task 11: Wire AcousticDuplicateModal into PlaylistDetailView

**Files:**
- Modify: `frontend/src/views/PlaylistDetailView.tsx`

Same changes as Task 10 but for `PlaylistDetailView`. The pattern is identical — the file has the same old pre-check logic.

- [ ] **Step 1: Add imports**

At the top of `frontend/src/views/PlaylistDetailView.tsx`, add:
```typescript
import AcousticDuplicateModal, { PendingDuplicate } from '@/components/ui/AcousticDuplicateModal';
import { DuplicateError } from '@/types/index';
import { api } from '@/services/api';
```

Remove the `DuplicateModal`, `DuplicateItem`, `DuplicateAction` imports if no longer used.

- [ ] **Step 2: Replace old duplicate state**

Find `showDuplicateModal` state and any related pending state. Add:

```typescript
  const [acousticDuplicates, setAcousticDuplicates] = useState<PendingDuplicate[]>([]);
  const [showAcousticDuplicateModal, setShowAcousticDuplicateModal] = useState(false);
```

- [ ] **Step 3: Update the upload loop in processFiles (or equivalent)**

Find the block in `PlaylistDetailView` that loops through files and calls `uploadTrack`. Wrap each upload call:

```typescript
          try {
            const track = await uploadTrack(file, true);
            await addTrackToPlaylist(playlistId, track.id);
            completed++;
          } catch (err) {
            if (err instanceof DuplicateError) {
              foundDuplicates.push({ file, duplicate: err.duplicate });
            } else {
              skipped++;
            }
          }
```

After the loop, show the modal if duplicates found:

```typescript
    if (foundDuplicates.length > 0) {
      setAcousticDuplicates(foundDuplicates);
      setShowAcousticDuplicateModal(true);
    }
```

- [ ] **Step 4: Remove old pre-check calls**

Remove all `api.checkDuplicates(...)` calls and the state + handlers that depended on them (`showDuplicateModal`, `handleDuplicateConfirm`, `pendingFiles`, etc.).

- [ ] **Step 5: Add handleUploadAnyway for playlist context**

```typescript
  const handleUploadAnyway = useCallback(async (file: File) => {
    try {
      const track = await api.uploadTrackForce(file);
      await addTrackToPlaylist(playlistId, track.id);
      fetchPlaylist();
      toast.success(`Uploaded "${track.title}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    }
    setAcousticDuplicates((prev) => prev.filter((d) => d.file !== file));
  }, [addTrackToPlaylist, playlistId, fetchPlaylist]);
```

- [ ] **Step 6: Replace DuplicateModal JSX**

```tsx
      <AcousticDuplicateModal
        isOpen={showAcousticDuplicateModal}
        pendingDuplicates={acousticDuplicates}
        onClose={() => {
          setShowAcousticDuplicateModal(false);
          setAcousticDuplicates([]);
        }}
        onUploadAnyway={handleUploadAnyway}
      />
```

- [ ] **Step 7: Verify frontend compiles**

```bash
npm run dev:frontend
```

Expected: no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/views/PlaylistDetailView.tsx && git commit -m "feat(frontend): replace pre-check duplicate flow with acoustic DuplicateError handling in PlaylistDetailView"
```

---

## Task 12: Admin fingerprint-all button

**Files:**
- Modify: `frontend/src/views/AdminView.tsx`

- [ ] **Step 1: Add the button to the debug tab**

In `AdminView.tsx`, find the debug tab render section. Add a new card for fingerprinting:

```tsx
  const [isFingerprintingAll, setIsFingerprintingAll] = useState(false);

  const handleFingerprintAll = async () => {
    setIsFingerprintingAll(true);
    try {
      const result = await api.request<{ message: string; processed: number; failed: number; total: number }>(
        '/tracks/fingerprint-all',
        { method: 'POST' }
      );
      toast.success(`${result.message}: ${result.processed} processed, ${result.failed} failed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fingerprinting failed');
    } finally {
      setIsFingerprintingAll(false);
    }
  };
```

Note: `api.request` is private. Expose it by calling `api.fingerprintAll()` — add this method to `api.ts`:

In `frontend/src/services/api.ts`, add after `uploadTrackForce`:

```typescript
  async fingerprintAll() {
    return this.request<{ message: string; processed: number; failed: number; total: number }>(
      '/tracks/fingerprint-all',
      { method: 'POST' }
    );
  }
```

Then in AdminView, use `api.fingerprintAll()`:

```tsx
  const handleFingerprintAll = async () => {
    setIsFingerprintingAll(true);
    try {
      const result = await api.fingerprintAll();
      toast.success(`${result.message}: ${result.processed} processed, ${result.failed} failed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fingerprinting failed');
    } finally {
      setIsFingerprintingAll(false);
    }
  };
```

In the debug tab JSX, add:

```tsx
  <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800/50">
    <h3 className="text-white font-medium mb-1">Acoustic Fingerprinting</h3>
    <p className="text-zinc-500 text-sm mb-3">
      Generate Chromaprint fingerprints and AcoustID lookups for all unprocessed tracks.
      Rate-limited to 1 AcoustID request/sec — may take a while for large libraries.
    </p>
    <button
      onClick={handleFingerprintAll}
      disabled={isFingerprintingAll}
      className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors text-sm disabled:opacity-50"
    >
      {isFingerprintingAll ? 'Fingerprinting...' : 'Re-fingerprint Library'}
    </button>
  </div>
```

- [ ] **Step 2: Verify frontend compiles**

```bash
npm run dev:frontend
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/AdminView.tsx frontend/src/services/api.ts && git commit -m "feat(frontend): add fingerprint-all button to AdminView debug tab"
```

---

## Task 13: End-to-end smoke test

- [ ] **Step 1: Install fpcalc on your machine (dev)**

```bash
# macOS
brew install chromaprint

# Ubuntu/Debian (server)
sudo apt install libchromaprint-tools
```

Verify: `fpcalc --version` should print a version string.

- [ ] **Step 2: Start both servers**

```bash
npm run dev
```

- [ ] **Step 3: Upload a track, then upload the same file again**

1. Go to Library view
2. Upload any audio file (MP3/FLAC/etc.)
3. Upload the exact same file again
4. Expected: `AcousticDuplicateModal` appears with score ≥ 85 (STRONG MATCH) since fingerprint + filename + title all match

- [ ] **Step 4: Test "Upload Anyway"**

Click "Upload Anyway" in the modal. Expected: the track uploads successfully (second copy in library), no 409 error.

- [ ] **Step 5: Test offline degradation**

Temporarily set `ACOUSTID_API_KEY=` (empty) in your `.env`. Upload a track, then upload same file again.
Expected: modal still appears — score is ≤ 50 (using duration + title + filename only, no MBID). The word "POSSIBLE MATCH" appears instead of "STRONG MATCH".

- [ ] **Step 6: Run backend unit tests one final time**

```bash
cd backend && npm test
```

Expected: all tests pass.

- [ ] **Step 7: Final commit**

```bash
git add . && git commit -m "feat: audio intelligence v1 — acoustic fingerprint duplicate detection complete"
```
