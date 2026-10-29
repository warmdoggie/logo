#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$(id -u)" = 0
exec 9>/run/lock/logo-scheduler-backup.lock
flock -n 9 || exit 0
root=/var/backups/logo-scheduler
test -d "$root"
test "$(readlink -f "$root")" = "$root"
database_bytes=$(docker exec logo-scheduler-postgres psql -v ON_ERROR_STOP=1 -U scheduler -d scheduler -Atc "SELECT pg_database_size('scheduler')")
available_bytes=$(df --output=avail -B1 "$root" | tail -1)
artifact_bytes=$(du -sb /var/lib/logo-scheduler/results | awk '{print $1}')
if [ "$available_bytes" -lt "$((database_bytes * 3 + artifact_bytes * 2 + 2147483648))" ]; then
 echo SCHEDULER_BACKUP_BLOCKED_LOW_DISK >&2
 exit 1
fi
stamp=$(date -u +%Y%m%dT%H%M%SZ)
drill=scheduler_restore_$(date +%s)_$$
file=$root/$stamp.dump
test ! -e "$file"
test ! -e "$file.tmp"
created=0
cleanup(){
 result=$?
 trap - EXIT
 rm -f -- "$file.tmp"
 rm -f -- "$root/$stamp.artifacts.tar.tmp"
 if [ "$created" = 1 ] && ! docker exec logo-scheduler-postgres dropdb --if-exists -U scheduler "$drill" >/dev/null 2>&1; then
  echo SCHEDULER_RESTORE_DRILL_CLEANUP_FAILED >&2
  exit 1
 fi
 exit "$result"
}
trap cleanup EXIT
docker exec logo-scheduler-postgres pg_dump -U scheduler -d scheduler -Fc > "$file.tmp"
docker exec -i logo-scheduler-postgres pg_restore --list < "$file.tmp" >/dev/null
docker exec logo-scheduler-postgres createdb -U scheduler "$drill"
created=1
docker exec -i logo-scheduler-postgres pg_restore --exit-on-error -U scheduler -d "$drill" < "$file.tmp"
docker exec logo-scheduler-postgres psql -v ON_ERROR_STOP=1 -U scheduler -d "$drill" -Atc 'SELECT count(*) FROM jobs; SELECT count(*) FROM job_events; SELECT count(*) FROM scheduler_account;' > "$file.restore-counts"
tar -cf "$root/$stamp.artifacts.tar.tmp" -C /var/lib/logo-scheduler/results .
python3 - "$root/$stamp.artifacts.tar.tmp" "$drill" <<'VERIFY'
import sys,tarfile,hashlib,subprocess,re
query="SELECT DISTINCT params->>'planHash' FROM jobs WHERE params ? 'planHash'"
hashes=subprocess.check_output(['docker','exec','logo-scheduler-postgres','psql','-v','ON_ERROR_STOP=1','-U','scheduler','-d',sys.argv[2],'-Atc',query],text=True).splitlines()
with tarfile.open(sys.argv[1]) as archive:
 for value in hashes:
  assert re.fullmatch('[a-f0-9]{64}',value),'Invalid stored plan checksum'
  source=archive.extractfile('./plans/'+value+'.json')
  assert source is not None and hashlib.file_digest(source,'sha256').hexdigest()==value,'Backup plan checksum mismatch'
VERIFY
mv "$root/$stamp.artifacts.tar.tmp" "$root/$stamp.artifacts.tar"
sha256sum "$root/$stamp.artifacts.tar" > "$root/$stamp.artifacts.tar.sha256"
mv "$file.tmp" "$file"
sha256sum "$file" > "$file.sha256"
/opt/node-v24.17.0/bin/node /srv/logo-scheduler/offsite-backup.mjs "$stamp"
python3 - "$root" <<'PY'
import pathlib,sys,re,json,datetime
root=pathlib.Path(sys.argv[1]);files=sorted(p for p in root.iterdir() if re.fullmatch(r'\d{8}T\d{6}Z\.dump',p.name))
for file in files[:-7]:
 for path in (file,pathlib.Path(str(file)+'.sha256'),pathlib.Path(str(file)+'.restore-counts'),file.with_suffix('.artifacts.tar'),file.with_suffix('.artifacts.tar.sha256')):
  if path.is_file() and not path.is_symlink():path.unlink()
(root/'last-success.json').write_text(json.dumps({'time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'backup':files[-1].name,'artifacts':files[-1].with_suffix('.artifacts.tar').name,'restoredInIsolatedDatabase':True,'immutablePlansVerified':True}))
PY
echo SCHEDULER_BACKUP_AND_RESTORE_VERIFIED
