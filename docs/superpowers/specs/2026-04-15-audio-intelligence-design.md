# Audio Intelligence — Acoustic Fingerprinting & Duplicate Detection

**Date:** 2026-04-15  
**Sub-project:** A (of 4)  
**Status:** Approved

---

## Overview

Replace the existing filename/title-based duplicate detection with a real acoustic fingerprinting pipeline using Chromaprint + AcoustID. When a track is uploaded, its audio fingerprint is generated, cross-referenced against MusicBrainz via AcoustID, and scored against the existing library. If the similarity score is ≥ 60, the admin is warned and can choose to upload anyway.

---

## Architecture

### Upload flow (new)

```
file → temp → ffmpeg compress
     → generateFingerprint()   [fpcalc -json -length 120]
     → lookupAcoustID()        [AcoustID API, 5s timeout, silent fail]
     → checkDuplicates()       [score existing library]
     → if score ≥ 60: return 409 with match + breakdown
     → analyzeAudio()          [existing BPM/key/energy]
     → DB insert               [with fingerprint + MBID stored]
```

### Similarity score (0–100)

| Signal | Points | Method |
|---|---|---|
| MusicBrainz Recording ID exact match | 50 | AcoustID lookup result |
| Duration delta ≤ 2s | 20 | Local, computed from fpcalc output |
| Fuzzy title + artist match | 15 | Normalized string comparison |
| Original filename exact match | 15 | Existing logic |

- Score ≥ 60 → warn (POSSIBLE MATCH)
- Score ≥ 85 → warn (STRONG MATCH)
- Offline graceful degradation: if AcoustID unreachable, max score is 50 (duration + title + filename signals still active)

---

## Database Changes

Three new columns on the `tracks` table (new migration):

```typescript
acoustidFingerprint: text('acoustid_fingerprint'),       // compressed fpcalc output string
acoustidId: text('acoustid_id'),                          // AcoustID result ID
musicbrainzRecordingId: text('musicbrainz_recording_id') // top-confidence MusicBrainz Recording ID
```

No new tables. Existing tracks get `null` in all three columns and are fingerprinted retroactively via the `/api/tracks/fingerprint-all` admin endpoint.

---

## Backend Implementation

### New functions (`backend/src/routes/tracks.ts`)

**`generateFingerprint(filePath: string)`**
- Runs `fpcalc -json -length 120 <file>` via `execFileAsync`
- Returns `{ fingerprint: string, duration: number }`
- `fpcalc` installed on server: `apt install libchromaprint-tools`
- Fails silently if fpcalc not installed — returns `null`

**`lookupAcoustID(fingerprint: string, duration: number)`**
- POST to `https://api.acoustid.org/v2/lookup`
- Params: `client=<ACOUSTID_API_KEY>` + `fingerprint` + `duration` + `meta=recordings`
- Returns `{ acoustidId: string, musicbrainzRecordingId: string } | null`
- 5s timeout, fails silently on network error
- AcoustID client key: `ACOUSTID_API_KEY` in `.env` (free registration at acoustid.org)

**`calculateDuplicateScore(incoming, existingTrack)`**
- Pure function, no I/O
- Returns `{ score: number, breakdown: { mbid: boolean, duration: boolean, title: boolean, filename: boolean } }`

### Modified upload route (`POST /api/tracks`)

After `compressAudio()`, before `analyzeAudio()`:
1. Run `generateFingerprint()` on final compressed file
2. Run `lookupAcoustID()` — non-blocking, silent failure
3. Query DB: all tracks where `musicbrainzRecordingId` matches incoming OR `originalFilename` matches
4. Score each candidate via `calculateDuplicateScore()`
5. If best score ≥ 60: delete temp files, return `409 { match, score, breakdown }`
6. Otherwise: continue to `analyzeAudio()` → DB insert (store fingerprint + MBID)

**Force upload bypass:** `?force=true` query param skips the duplicate check entirely. Used when admin clicks "Upload Anyway" in the UI.

### New admin endpoint

```
POST /api/tracks/fingerprint-all
```
- Admin-only, mirrors existing `/analyze-all` pattern
- Processes all tracks where `acoustidFingerprint IS NULL`
- Rate-limited: 1 AcoustID lookup per second (API limit)
- Returns `{ processed, failed, total }`

---

## Frontend Implementation

### Duplicate warning modal

Triggered when upload API returns `409`. Intercepts the existing upload error handler — no changes to the happy path UX.

**Modal layout:**
```
⚠ Possible Duplicate Detected

Incoming:  "<title>" — <artist>
Matches:   "<title>" — <artist>  [uploaded <relative date>]

Similarity: 94%  ████████████████████░  STRONG MATCH

Matched signals:
  ✓ MusicBrainz ID    — same recording, confirmed cross-source
  ✓ Duration          — within 2 seconds
  ✓ Title / Artist    — exact match
  ✗ Filename          — different

[ Cancel ]   [ Upload Anyway ]
```

- Score ≥ 85 → "STRONG MATCH" label
- Score 60–84 → "POSSIBLE MATCH" label
- Existing track title links to that track in the library
- "Upload Anyway" re-sends with `?force=true`
- "Cancel" dismisses modal, no upload

---

## Environment Variables

```env
ACOUSTID_API_KEY=<free key from acoustid.org>
```

---

## Server Requirements

- `fpcalc` binary: `apt install libchromaprint-tools` (same server as ffmpeg)
- No GPU, no ML model — pure signal processing, CPU cost negligible

---

## Out of Scope

- Metadata correction from MusicBrainz (intentionally excluded)
- Automatic duplicate merging or deletion
- Fingerprinting audio during playback (only on upload)
- Sub-project B (Smart Listening), C (Music DNA), D (Jam) — separate specs
