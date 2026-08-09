#!/usr/bin/env sh
set -eu

docker compose up -d "$@"
docker compose ps
