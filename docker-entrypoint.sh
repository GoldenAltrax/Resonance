#!/bin/sh
set -e

# Starts as root only to hand the bind-mounted data to the node user (servers deployed
# before the app stopped running as root have root-owned files), then drops privileges.
if [ "$(id -u)" = "0" ]; then
  for dir in /app/backend/data /app/backend/uploads; do
    if [ -n "$(find "$dir" ! -user node -print -quit)" ]; then
      echo "Giving $dir to the node user..."
      chown -R node:node "$dir"
    fi
  done
  exec su-exec node "$0" "$@"
fi

echo "Running database migrations..."
node backend/dist/db/migrate.js

echo "Starting Resonance server..."
exec node backend/dist/app.js
