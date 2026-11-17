#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$(id -u)" = 0
root=/var/lib/s7-logo-archive
test "$(readlink -f "$root")" = "$root"
test "$(stat -c '%u:%a' "$root")" = 0:700
exec 9>"$root/backup.lock"
flock -n 9 || exit 0
test "$(df --output=avail -B1 "$root" | tail -1)" -gt 536870912
stamp=$(date -u +%Y%m%dT%H%M%SZ)
stage=$root/snapshot-$stamp
test ! -e "$stage"
mkdir -m 700 "$stage"
drill=scheduler_restore_$(date +%s)_$$
created=0
cleanup(){
 result=$?
 trap - EXIT
 if [ "$created" = 1 ]; then docker exec logo-scheduler-postgres dropdb --if-exists -U scheduler "$drill" >/dev/null; fi
 if [ "$result" = 0 ]; then python3 "$root/cleanup-stage.py" "$stage"; fi
 exit "$result"
}
trap cleanup EXIT
mkdir -m 700 "$stage/database"
docker exec logo-scheduler-postgres pg_dump -U scheduler -d scheduler -Fc > "$stage/database/scheduler.dump"
docker exec -i logo-scheduler-postgres pg_restore --list < "$stage/database/scheduler.dump" >/dev/null
docker exec logo-scheduler-postgres createdb -U scheduler "$drill"
created=1
docker exec -i logo-scheduler-postgres pg_restore --exit-on-error -U scheduler -d "$drill" < "$stage/database/scheduler.dump"
docker exec logo-scheduler-postgres psql -v ON_ERROR_STOP=1 -U scheduler -d "$drill" -Atc "SELECT DISTINCT params->>'planHash' FROM jobs WHERE params ? 'planHash'" > "$stage/plan-hashes.txt"
docker exec logo-scheduler-postgres psql -v ON_ERROR_STOP=1 -U scheduler -d "$drill" -Atc 'SELECT count(*) FROM jobs; SELECT count(*) FROM job_events; SELECT count(*) FROM scheduler_account;' > "$stage/database/restore-counts.txt"
python3 "$root/freeze-data.py" "$stage"
/opt/node-v24.17.0/bin/node "$root/backup-snapshot.mjs" "$stage" "$stamp"
echo SCHEDULER_AND_CUSTOMER_CLOUD_BACKUP_VERIFIED
