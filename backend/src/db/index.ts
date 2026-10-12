import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as schema from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const sqlite: Database.Database = new Database(process.env.DATABASE_URL || join(__dirname, '../../data/resonance.db'));

// WAL lets reads proceed while a write is in progress (e.g. streaming while a track uploads);
// busy_timeout makes concurrent writers wait instead of failing with SQLITE_BUSY.
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

export * from './schema.js';
