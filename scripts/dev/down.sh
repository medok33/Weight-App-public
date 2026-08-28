#!/usr/bin/env sh
set -eu

project="${COMPOSE_PROJECT_NAME:-}"
if [ "$project" != "weight-app-local" ]; then
  echo "REFUSED: set COMPOSE_PROJECT_NAME=weight-app-local explicitly" >&2
  exit 2
fi

docker compose -p weight-app-local -f docker/compose.local.yaml down "$@"
