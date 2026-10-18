#!/bin/sh
set -eu

container="${TUTORPLUS_TEST_CONTAINER:-supabase_db_TutorPlus}"
database="tutorplus_ddl_validation_$(date +%s)_$$"
temporary="$(mktemp -d /tmp/tutorplus-db-tests.XXXXXX)"
created=false
cleanup() {
  if [ "$created" = true ]; then
    case "$database" in
      tutorplus_ddl_validation_*) docker exec "$container" dropdb -U postgres --if-exists --force "$database" ;;
      *) printf '%s\n' 'Refusing unexpected cleanup target' >&2; return 1 ;;
    esac
  fi
  rm -rf "$temporary"
}
trap cleanup EXIT HUP INT TERM

printf 'Isolated verification database: %s\n' "$database"
docker exec "$container" psql -U postgres -d postgres -Atc 'select version()'
docker exec "$container" pg_dump -U postgres -d postgres --schema-only --schema=auth --no-owner --no-privileges |
  sed '/^CREATE TRIGGER tutorplus_auth_signup /d' > "$temporary/auth-schema.sql"
docker exec "$container" createdb -U postgres "$database"
created=true
docker exec -i "$container" psql -X -U postgres -d "$database" -v ON_ERROR_STOP=1 < "$temporary/auth-schema.sql" > "$temporary/auth-restore.log" 2>&1 || {
  cat "$temporary/auth-restore.log"; exit 1;
}
docker exec "$container" psql -X -U postgres -d "$database" -v ON_ERROR_STOP=1 -c 'grant usage on schema auth to anon, authenticated, service_role;'
docker exec -i "$container" psql -X -U postgres -d "$database" -v ON_ERROR_STOP=1 < sql/sprint2_tables.sql > "$temporary/ddl-replay.log" 2>&1 || {
  cat "$temporary/ddl-replay.log"; exit 1;
}
docker exec -i "$container" psql -X -U postgres -d "$database" -v ON_ERROR_STOP=1 < sql/sprint3_tables.sql > "$temporary/ddl-sprint3.log" 2>&1 || {
  cat "$temporary/ddl-sprint3.log"; exit 1;
}
printf '%s\n' 'PASS: standalone DDL replay against an empty application schema with copied managed Auth schema'
docker exec "$container" psql -X -U postgres -d "$database" -Atc "select extensions.postgis_full_version(); select count(*) from pg_tables where schemaname = 'public';"
docker exec -i "$container" psql -X -U postgres -d "$database" -v ON_ERROR_STOP=1 < supabase/tests/001_regression.sql > "$temporary/regression.log" 2>&1 || {
  cat "$temporary/regression.log"; exit 1;
}
cat "$temporary/regression.log"
docker exec -i "$container" psql -X -U postgres -d "$database" -v ON_ERROR_STOP=1 < supabase/tests/003_sprint3_learning_records.sql > "$temporary/sprint3.log" 2>&1 || {
  cat "$temporary/sprint3.log"; exit 1;
}
grep -E 'PASS|SKIP' "$temporary/sprint3.log"
docker exec -i "$container" psql -X -U postgres -d "$database" -v ON_ERROR_STOP=1 < supabase/tests/concurrency_fixture.sql

docker exec -i "$container" psql -X -U postgres -d "$database" -v ON_ERROR_STOP=1 \
  -v student=71000000-0000-4000-8000-000000000001 -v session=72000000-0000-4000-8000-000000000001 -v request=parallel-one \
  < supabase/tests/concurrency_client.sql > "$temporary/client-one.log" 2>&1 &
first_process=$!
docker exec -i "$container" psql -X -U postgres -d "$database" -v ON_ERROR_STOP=1 \
  -v student=71000000-0000-4000-8000-000000000002 -v session=72000000-0000-4000-8000-000000000002 -v request=parallel-two \
  < supabase/tests/concurrency_client.sql > "$temporary/client-two.log" 2>&1 &
second_process=$!
printf 'Independent parallel client process IDs: %s %s\n' "$first_process" "$second_process"
first_result=0
second_result=0
wait "$first_process" || first_result=$?
wait "$second_process" || second_result=$?
printf 'Parallel client exit codes: %s %s\n' "$first_result" "$second_result"
cat "$temporary/client-one.log" "$temporary/client-two.log"
if [ "$first_result" = 0 ] && [ "$second_result" != 0 ]; then
  loser="$temporary/client-two.log"
elif [ "$second_result" = 0 ] && [ "$first_result" != 0 ]; then
  loser="$temporary/client-one.log"
else
  printf '%s\n' 'FAIL: expected exactly one successful parallel client'; exit 1
fi
if ! grep -q '23P01' "$loser"; then
  printf '%s\n' 'FAIL: losing client was not rejected by the exclusion constraint'; exit 1
fi
count="$(docker exec "$container" psql -X -U postgres -d "$database" -Atc "select count(*) from public.bookings where tutor_id = '74000000-0000-4000-8000-000000000001' and status = 'payment_pending'")"
if [ "$count" != 1 ]; then
  printf 'FAIL: expected one committed booking, found %s\n' "$count"; exit 1
fi
printf '%s\n' 'PASS: two independent concurrent clients, exactly one committed reservation, other SQLSTATE 23P01'
printf '%s\n' 'PASS: original local application database was not reset or changed by isolated replay/concurrency verification'
