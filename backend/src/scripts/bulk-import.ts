/**
 * Bulk Import Script for Resonance
 *
 * Usage:
 *   npx tsx src/scripts/bulk-import.ts --source <folder> --user <username> [options]
 *
 * Options:
 *   --source <folder>    Source folder containing audio files
 *   --user <username>    Username to import tracks for (must exist)
 *   --playlist <name>    Create/use playlist with this name (default: "Imported Music")
 *   --compress           Compress audio to 128kbps MP3 (requires ffmpeg)
 *   --bitrate <kbps>     Target bitrate for compression (default: 128)
 *   --dry-run            Preview what would be imported without making changes
 */

import { readdir, stat, copyFile, mkdir, unlink } from 'fs/promises';
import { join, extname } from 'path';
import { execSync, spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  if (index !== -1 && args[index + 1]) {
    return args[index + 1];
  }
  return undefined;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

const SOURCE_FOLDER = getArg('source');
const USERNAME = getArg('user');
const PLAYLIST_NAME = getArg('playlist') || 'Imported Music';
const COMPRESS = hasFlag('compress');
const BITRATE = parseInt(getArg('bitrate') || '128', 10);
const DRY_RUN = hasFlag('dry-run');

const SUPPORTED_EXTENSIONS = ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg'];
const UPLOADS_DIR = join(import.meta.dirname, '..', '..', 'uploads', 'audio');
const DB_PATH = join(import.meta.dirname, '..', '..', 'data', 'resonance.db');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function parseFilename(filename: string): { title: string; artist: string } {
  // Remove extension
  let name = filename.replace(/\.[^/.]+$/, '');

  // Remove common suffixes like _spotdown.org
  name = name.replace(/_spotdown\.org$/i, '');
  name = name.replace(/_spotify$/i, '');
  name = name.replace(/\s*\(Official.*?\)/gi, '');
  name = name.replace(/\s*\[Official.*?\]/gi, '');

  // Try to parse "Artist - Title" format
  const dashMatch = name.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch && dashMatch[1] && dashMatch[2]) {
    return {
      artist: dashMatch[1].trim(),
      title: dashMatch[2].trim(),
    };
  }

  // Try to extract from "Title - From 'Album'" format
  const fromMatch = name.match(/^(.+?)\s*-\s*From\s*['"](.+?)['"]$/i);
  if (fromMatch && fromMatch[1]) {
    return {
      title: fromMatch[1].trim(),
      artist: 'Unknown Artist',
    };
  }

  // Default: use whole name as title
  return {
    title: name.trim(),
    artist: 'Unknown Artist',
  };
}

async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const result = execSync(
      `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: 'utf-8' }
    );
    return Math.round(parseFloat(result.trim()));
  } catch {
    // If ffprobe fails, return 0
    return 0;
  }
}

async function compressAudio(
  inputPath: string,
  outputPath: string,
  bitrate: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath,
      '-b:a', `${bitrate}k`,
      '-y', // Overwrite output
      outputPath,
    ]);

    ffmpeg.on('close', (code) => {
      resolve(code === 0);
    });

    ffmpeg.on('error', () => {
      resolve(false);
    });
  });
}

async function checkFfmpeg(): Promise<boolean> {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  log('\n🎵 Resonance Bulk Import Tool\n', 'cyan');

  // Validate arguments
  if (!SOURCE_FOLDER) {
    log('Error: --source <folder> is required', 'red');
    log('\nUsage: npx tsx src/scripts/bulk-import.ts --source <folder> --user <username>', 'dim');
    process.exit(1);
  }

  if (!USERNAME) {
    log('Error: --user <username> is required', 'red');
    process.exit(1);
  }

  // Check ffmpeg if compression is requested
  if (COMPRESS) {
    const hasFfmpeg = await checkFfmpeg();
    if (!hasFfmpeg) {
      log('Error: ffmpeg is required for compression but not found', 'red');
      log('Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)', 'dim');
      process.exit(1);
    }
    log(`Compression enabled: ${BITRATE}kbps MP3`, 'yellow');
  }

  if (DRY_RUN) {
    log('DRY RUN MODE - No changes will be made\n', 'yellow');
  }

  // Connect to database
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });

  // Find user
  const user = await db.query.users.findFirst({
    where: eq(schema.users.username, USERNAME),
  });

  if (!user) {
    log(`Error: User "${USERNAME}" not found. Create the user first.`, 'red');
    process.exit(1);
  }

  log(`User: ${user.username} (${user.id})`, 'dim');

  // Scan source folder
  let files: string[];
  try {
    const allFiles = await readdir(SOURCE_FOLDER);
    files = allFiles.filter((f) =>
      SUPPORTED_EXTENSIONS.includes(extname(f).toLowerCase())
    );
  } catch (err) {
    log(`Error: Cannot read folder "${SOURCE_FOLDER}"`, 'red');
    process.exit(1);
  }

  log(`Found ${files.length} audio files\n`, 'green');

  if (files.length === 0) {
    log('No audio files to import.', 'yellow');
    process.exit(0);
  }

  // Ensure uploads directory exists
  if (!DRY_RUN) {
    await mkdir(UPLOADS_DIR, { recursive: true });
  }

  // Create or get playlist
  let playlistId: string;
  if (!DRY_RUN) {
    const existingPlaylist = await db.query.playlists.findFirst({
      where: eq(schema.playlists.name, PLAYLIST_NAME),
    });

    if (existingPlaylist) {
      playlistId = existingPlaylist.id;
      log(`Using existing playlist: "${PLAYLIST_NAME}"`, 'dim');
    } else {
      playlistId = uuidv4();
      await db.insert(schema.playlists).values({
        id: playlistId,
        name: PLAYLIST_NAME,
        description: `Bulk imported on ${new Date().toLocaleDateString()}`,
        userId: user.id,
      });
      log(`Created playlist: "${PLAYLIST_NAME}"`, 'green');
    }
  } else {
    playlistId = 'dry-run-playlist';
  }

  // Process files
  let imported = 0;
  let failed = 0;
  let skipped = 0;
  let totalSavedBytes = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const sourcePath = join(SOURCE_FOLDER, file);
    const { title, artist } = parseFilename(file);

    const progress = `[${i + 1}/${files.length}]`;

    // Check if track already exists (by title and artist)
    if (!DRY_RUN) {
      const existing = await db.query.tracks.findFirst({
        where: eq(schema.tracks.title, title),
      });

      if (existing) {
        log(`${progress} Skipped (exists): ${title}`, 'dim');
        skipped++;
        continue;
      }
    }

    const trackId = uuidv4();
    const ext = COMPRESS ? '.mp3' : extname(file).toLowerCase();
    const destFilename = `${trackId}${ext}`;
    const destPath = join(UPLOADS_DIR, destFilename);

    try {
      const sourceStats = await stat(sourcePath);
      const originalSize = sourceStats.size;

      if (DRY_RUN) {
        log(`${progress} Would import: ${title} - ${artist}`, 'cyan');
        imported++;
        continue;
      }

      // Copy or compress file
      if (COMPRESS) {
        const success = await compressAudio(sourcePath, destPath, BITRATE);
        if (!success) {
          log(`${progress} Failed to compress: ${file}`, 'red');
          failed++;
          continue;
        }

        const destStats = await stat(destPath);
        const savedBytes = originalSize - destStats.size;
        totalSavedBytes += savedBytes;
      } else {
        await copyFile(sourcePath, destPath);
      }

      // Get duration
      const duration = await getAudioDuration(destPath);

      // Insert track
      await db.insert(schema.tracks).values({
        id: trackId,
        title,
        artist,
        duration,
        filePath: `audio/${destFilename}`,
        userId: user.id,
      });

      // Add to playlist
      const existingTracks = await db.query.playlistTracks.findMany({
        where: eq(schema.playlistTracks.playlistId, playlistId),
      });

      await db.insert(schema.playlistTracks).values({
        id: uuidv4(),
        playlistId,
        trackId,
        position: existingTracks.length + 1,
      });

      log(`${progress} Imported: ${title} - ${artist}`, 'green');
      imported++;
    } catch (err) {
      log(`${progress} Error: ${file} - ${err}`, 'red');
      failed++;

      // Clean up partial file
      try {
        await unlink(destPath);
      } catch {}
    }
  }

  // Summary
  log('\n' + '='.repeat(50), 'dim');
  log('Import Summary:', 'cyan');
  log(`  ✓ Imported: ${imported}`, 'green');
  if (skipped > 0) log(`  ○ Skipped:  ${skipped}`, 'yellow');
  if (failed > 0) log(`  ✗ Failed:   ${failed}`, 'red');

  if (COMPRESS && totalSavedBytes > 0) {
    const savedMB = (totalSavedBytes / 1024 / 1024).toFixed(1);
    log(`  💾 Space saved: ${savedMB} MB`, 'cyan');
  }

  log('\nDone! 🎵\n', 'green');

  sqlite.close();
}

main().catch((err) => {
  log(`Fatal error: ${err}`, 'red');
  process.exit(1);
});
