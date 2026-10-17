#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pg_bin="${PG_BIN:-}"
if [[ -z "$pg_bin" ]]; then
  if command -v pg_ctl >/dev/null; then pg_bin="$(dirname "$(command -v pg_ctl)")";
  elif [[ -x /Library/PostgreSQL/15/bin/pg_ctl ]]; then pg_bin=/Library/PostgreSQL/15/bin;
  else echo 'PostgreSQL binaries not found. Set PG_BIN or use docker compose.' >&2; exit 1; fi
fi
mkdir -p .runtime
if [[ ! -f .runtime/postgres/PG_VERSION ]]; then "$pg_bin/initdb" -D .runtime/postgres -U careerflow -A trust --encoding=UTF8 --locale=C >/dev/null; fi
if ! "$pg_bin/pg_ctl" -D .runtime/postgres status >/dev/null 2>&1; then "$pg_bin/pg_ctl" -D .runtime/postgres -l .runtime/postgres.log -o '-p 55432 -h 127.0.0.1 -k /tmp' start; fi
if [[ "$("$pg_bin/psql" -h 127.0.0.1 -p 55432 -U careerflow -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='careerflow'")" != "1" ]]; then "$pg_bin/createdb" -h 127.0.0.1 -p 55432 -U careerflow careerflow; fi
echo 'Project-local PostgreSQL is ready on 127.0.0.1:55432. This development instance accepts local connections only.'
