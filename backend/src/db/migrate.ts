import Database from 'better-sqlite3';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Ensure data directory exists
const dbPath = process.env.DATABASE_URL || join(__dirname, '../../data/resonance.db');
const dbDir = dirname(dbPath);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// Create migrations tracking table if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY,
    hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

// Get applied migrations
const applied = new Set(
  db.prepare('SELECT hash FROM __drizzle_migrations').all().map((r: any) => r.hash)
);

// Get migration files
const migrationsDir = join(__dirname, 'migrations');
if (!existsSync(migrationsDir)) {
  console.log('No migrations directory found, skipping migrations');
  process.exit(0);
}

const migrationFiles = readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort();

let migrationsRun = 0;

for (const file of migrationFiles) {
  const hash = file.replace('.sql', '');

  if (applied.has(hash)) {
    continue;
  }

  console.log(`Running migration: ${file}`);
  const sql = readFileSync(join(migrationsDir, file), 'utf-8');

  // Split by statement breakpoints and run each statement
  const statements = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);

  db.transaction(() => {
    for (const statement of statements) {
      if (statement) {
        db.exec(statement);
      }
    }
    db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(hash, Date.now());
  })();

  migrationsRun++;
}

console.log(`Migrations complete. ${migrationsRun} migration(s) applied.`);
db.close();
