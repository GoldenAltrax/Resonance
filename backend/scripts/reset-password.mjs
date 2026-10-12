// Reset a user's password in the local SQLite database.
// Usage (from backend/): node scripts/reset-password.mjs <username>
// The new password is read from a hidden prompt, never from argv or shell history.
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const username = process.argv[2];
if (!username) {
  console.error('Usage: node scripts/reset-password.mjs <username>');
  process.exit(1);
}

const dbPath = process.env.DATABASE_URL || join(dirname(fileURLToPath(import.meta.url)), '../data/resonance.db');
const db = new Database(dbPath);

const user = db.prepare('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE').get(username);
if (!user) {
  const names = db.prepare('SELECT username FROM users').all().map((u) => u.username);
  console.error(`No user "${username}" in ${dbPath}. Users: ${names.join(', ')}`);
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl._writeToOutput = (s) => { if (!rl.muted) rl.output.write(s); };
process.stdout.write(`New password for ${user.username}: `);
rl.muted = true;
rl.question('', async (password) => {
  rl.close();
  process.stdout.write('\n');
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  console.log(`Password updated for ${user.username}. Log in with that exact username (case-sensitive).`);
});
