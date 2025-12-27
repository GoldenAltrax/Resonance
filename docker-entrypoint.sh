#!/bin/sh
set -e

echo "Running database migrations..."
node backend/dist/db/migrate.js

echo "Starting Resonance server..."
exec node backend/dist/app.js
