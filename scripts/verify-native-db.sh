#!/bin/sh
# Isolated SQL/RLS checks when Docker is unavailable. Does not verify Auth/HTTP/storage.
set -eu
task_pg_bin="${TUTORPLUS_PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
task_pg_port="${TUTORPLUS_PG_PORT:-55439}"
task_pg_dir="$(mktemp -d /tmp/tutorplus-native-check.XXXXXX)"
cleanup() {
  "$task_pg_bin/pg_ctl" -D "$task_pg_dir/data" -m fast stop >/dev/null 2>&1 || true
  printf 'SQL evidence retained at %s\n' "$task_pg_dir"
}
trap cleanup EXIT HUP INT TERM
"$task_pg_bin/initdb" -D "$task_pg_dir/data" -A trust --no-locale --encoding=UTF8 -U postgres > "$task_pg_dir/init.log"
"$task_pg_bin/pg_ctl" -D "$task_pg_dir/data" -l "$task_pg_dir/server.log" -o "-p $task_pg_port -k $task_pg_dir -h 127.0.0.1" start >/dev/null
"$task_pg_bin/psql" -X -h "$task_pg_dir" -p "$task_pg_port" -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/native-auth-fixture.sql > "$task_pg_dir/auth-fixture.log" 2>&1
for migration in supabase/migrations/*.sql; do
  rg -qi '^commit;' "$migration" || { printf 'FAIL: incomplete migration %s\n' "$migration"; exit 1; }
  printf 'Replay %s\n' "$migration"
  "$task_pg_bin/psql" -X -h "$task_pg_dir" -p "$task_pg_port" -U postgres -d postgres -v ON_ERROR_STOP=1 -f "$migration" > "$task_pg_dir/$(basename "$migration").log" 2>&1 || {
    cat "$task_pg_dir/$(basename "$migration").log"; exit 1;
  }
done
for regression in supabase/tests/001_regression.sql supabase/tests/003_sprint3_learning_records.sql supabase/tests/004_remaining_modules.sql supabase/tests/005_platform.sql supabase/tests/006_learning_completion.sql supabase/tests/007_admin_baseline.sql supabase/tests/008_marketplace_currency.sql; do
  if [ -f "$regression" ]; then
    printf 'Test %s\n' "$regression"
    "$task_pg_bin/psql" -X -h "$task_pg_dir" -p "$task_pg_port" -U postgres -d postgres -v ON_ERROR_STOP=1 -f "$regression" > "$task_pg_dir/$(basename "$regression").log" 2>&1 || {
      cat "$task_pg_dir/$(basename "$regression").log"; exit 1;
    }
    rg 'PASS|SKIP' "$task_pg_dir/$(basename "$regression").log"
  fi
done
"$task_pg_bin/psql" -X -h "$task_pg_dir" -p "$task_pg_port" -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/concurrency_fixture.sql > "$task_pg_dir/concurrency-fixture.log" 2>&1
"$task_pg_bin/psql" -X -h "$task_pg_dir" -p "$task_pg_port" -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v student=71000000-0000-4000-8000-000000000001 -v session=72000000-0000-4000-8000-000000000001 -v request=native-parallel-one \
  -f supabase/tests/concurrency_client.sql > "$task_pg_dir/client-one.log" 2>&1 &
task_first_pid=$!
"$task_pg_bin/psql" -X -h "$task_pg_dir" -p "$task_pg_port" -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v student=71000000-0000-4000-8000-000000000002 -v session=72000000-0000-4000-8000-000000000002 -v request=native-parallel-two \
  -f supabase/tests/concurrency_client.sql > "$task_pg_dir/client-two.log" 2>&1 &
task_second_pid=$!
task_first_result=0
task_second_result=0
wait "$task_first_pid" || task_first_result=$?
wait "$task_second_pid" || task_second_result=$?
if [ "$task_first_result" = 0 ] && [ "$task_second_result" != 0 ]; then
  task_loser_log="$task_pg_dir/client-two.log"
elif [ "$task_second_result" = 0 ] && [ "$task_first_result" != 0 ]; then
  task_loser_log="$task_pg_dir/client-one.log"
else
  cat "$task_pg_dir/client-one.log" "$task_pg_dir/client-two.log"
  printf '%s\n' 'FAIL: expected one successful concurrent reservation'; exit 1
fi
rg -q '23P01' "$task_loser_log" || { cat "$task_loser_log"; exit 1; }
task_committed_count="$("$task_pg_bin/psql" -X -h "$task_pg_dir" -p "$task_pg_port" -U postgres -d postgres -Atc "select count(*) from public.bookings where tutor_id = '74000000-0000-4000-8000-000000000001' and status = 'payment_pending'")"
[ "$task_committed_count" = 1 ] || { printf '%s\n' 'FAIL: concurrent reservation count'; exit 1; }
printf '%s\n' 'PASS: two independent SQL clients race for one slot; exactly one commits and the other receives exclusion violation 23P01.'
printf '%s\n' 'PASS: isolated native migration replay and SQL regressions; managed Auth/HTTP/storage remain separate checks.'
