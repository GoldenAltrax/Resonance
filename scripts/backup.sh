#!/usr/bin/env bash
# Nightly backup of the Resonance server: database, uploads and .env.
#
# Run on the server from anywhere:  ~/resonance/scripts/backup.sh
# Cron (03:30 daily):               30 3 * * * $HOME/resonance/scripts/backup.sh >> $HOME/resonance/backups/backup.log 2>&1
#
# Each run writes backups/<date>/ containing:
#   resonance.db  consistent snapshot taken with SQLite's online backup API (safe while the app runs)
#   uploads/      hard-linked against the previous run, so unchanged audio costs no extra disk
#   .env          secrets (mode 600)
# The newest BACKUP_KEEP runs are kept (default 14).
#
# Restore:
#   docker compose -f docker-compose.prod.yml down
#   cp backups/<date>/resonance.db data/resonance.db && rm -f data/resonance.db-wal data/resonance.db-shm
#   rsync -a --delete backups/<date>/uploads/ uploads/
#   docker compose -f docker-compose.prod.yml up -d
#
# This protects against mistakes and corruption, not against losing the VM: copy backups/
# to another machine too (e.g. rsync over Tailscale, or Proxmox's own VM backups).
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="${BACKUP_DIR:-$PWD/backups}"
KEEP="${BACKUP_KEEP:-14}"
CONTAINER="${RESONANCE_CONTAINER:-resonance-app}"
TARGET="$DEST/$(date +%Y-%m-%d_%H%M)"
TMP_DB=/tmp/resonance-backup.db

mkdir -p "$TARGET"
echo "[$(date -Is)] backup -> $TARGET"

# Database: snapshot inside the container (it has better-sqlite3), verify it, then copy it out
docker exec -w /app "$CONTAINER" node -e "
const Database = require('better-sqlite3');
const src = new Database('/app/backend/data/resonance.db', { readonly: true });
src.backup('$TMP_DB').then(() => {
  src.close();
  const copy = new Database('$TMP_DB', { readonly: true });
  const result = copy.pragma('integrity_check', { simple: true });
  copy.close();
  if (result !== 'ok') { console.error('integrity_check failed: ' + result); process.exit(1); }
}).catch((err) => { console.error(err); process.exit(1); });
"
docker cp "$CONTAINER:$TMP_DB" "$TARGET/resonance.db"
docker exec "$CONTAINER" rm -f "$TMP_DB"

# Uploads: unchanged files are hard links to the previous backup
LINK_DEST=()
[ -d "$DEST/latest/uploads" ] && LINK_DEST=(--link-dest="$DEST/latest/uploads")
rsync -a --delete "${LINK_DEST[@]}" uploads/ "$TARGET/uploads/"

if [ -f .env ]; then
  install -m 600 .env "$TARGET/.env"
fi

ln -sfn "$TARGET" "$DEST/latest"

# Keep the newest $KEEP runs
ls -1d "$DEST"/20*/ 2>/dev/null | sort | head -n -"$KEEP" | xargs -r rm -rf

echo "[$(date -Is)] done: $(du -sh "$TARGET/resonance.db" | cut -f1) db, $(ls -1d "$DEST"/20*/ | wc -l) backups kept"
