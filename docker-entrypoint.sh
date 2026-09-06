#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"

# Persist a session secret so PIN logins survive container restarts.
if [ -z "$SESSION_SECRET" ]; then
  SECRET_FILE="$DATA_DIR/session-secret"
  if [ ! -f "$SECRET_FILE" ]; then
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > "$SECRET_FILE"
  fi
  SESSION_SECRET="$(cat "$SECRET_FILE")"
  export SESSION_SECRET
fi

exec node .output/server/index.mjs
