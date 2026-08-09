#!/bin/sh
set -eu

case "${DISPOSABLE_RUNTIME_ID:-}" in
  wa-[a-z0-9-]*) ;;
  *) echo 'DISPOSABLE_RUNTIME_ID is required and must be canonical' >&2; exit 1 ;;
esac

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v runtime_id="$DISPOSABLE_RUNTIME_ID" <<'SQL'
CREATE SCHEMA IF NOT EXISTS weight_app_runtime_metadata;
CREATE TABLE IF NOT EXISTS weight_app_runtime_metadata.runtime_identity (
  marker_name text PRIMARY KEY,
  runtime_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  marker_version integer NOT NULL DEFAULT 1,
  CHECK (marker_name = 'postgres-disposable-runtime')
);
INSERT INTO weight_app_runtime_metadata.runtime_identity (marker_name, runtime_id)
VALUES ('postgres-disposable-runtime', :'runtime_id')
ON CONFLICT (marker_name) DO NOTHING;
SQL
