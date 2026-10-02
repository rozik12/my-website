#!/usr/bin/env bash
# Прогоняет миграции и SQL-тесты на временном локальном PostgreSQL (нужны initdb/pg_ctl/psql 15+).
# Альтернатива для проекта Supabase: supabase start && psql "$DB_URL" -f tests/sql/test.sql
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."
PGBIN="${PGBIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")}"
RUNAS=""; if [ "$(id -u)" = "0" ]; then id pgtest >/dev/null 2>&1 || useradd -m pgtest; RUNAS="runuser -u pgtest --"; fi
TMP="$(mktemp -d)"; chmod 777 "$TMP"; PORT="${PGPORT:-55432}"
cleanup() { $RUNAS "$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
$RUNAS "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
$RUNAS "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses='' -c timezone=UTC" -l "$TMP/log" start -w >/dev/null
PSQL=("$PGBIN/psql" -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
cp "$HERE/stub-supabase.sql" "$ROOT"/supabase/migrations/*.sql "$ROOT/supabase/seed.sql" "$HERE/test.sql" "$HERE/test_v2.sql" "$TMP/"
$RUNAS "${PSQL[@]}" -f "$TMP/stub-supabase.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do $RUNAS "${PSQL[@]}" -f "$TMP/$(basename "$f")"; done
$RUNAS "${PSQL[@]}" -f "$TMP/seed.sql"
$RUNAS "${PSQL[@]}" -f "$TMP/test.sql"
$RUNAS "${PSQL[@]}" -f "$TMP/test_v2.sql"
echo "✓ SQL: миграции и тесты прошли"
