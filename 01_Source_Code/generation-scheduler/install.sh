#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$(id -u)" = 0
test "$(hostname)" = iZf8zjczn9o390i523upydZ
test "$(df --output=avail -B1 / | tail -1)" -gt 5368709120
test -x /opt/node-v24.17.0/bin/node
test ! -e /etc/logo-scheduler
test ! -e /srv/logo-scheduler
! ss -lntH | grep -Eq ':(3320|55432|56379) '
systemctl is-active --quiet s7-workspace.service
curl -fsS http://127.0.0.1:3210/api/health >/dev/null
src=$(cd "$(dirname "$0")" && pwd)
(cd "$src" && sha256sum -c SHA256SUMS --quiet)
getent passwd logo-scheduler >/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin logo-scheduler
install -d -m 755 /srv/logo-scheduler
cp "$src/"*.mjs "$src/schema.sql" "$src/package.json" "$src/package-lock.json" "$src/compose.yaml" "$src/README.md" /srv/logo-scheduler/
install -m 755 "$src/backup.sh" /srv/logo-scheduler/backup.sh
install -m 755 "$src/refresh-addresses.py" /srv/logo-scheduler/refresh-addresses.py
install -d -m 751 /var/lib/logo-scheduler
install -d -m 700 /etc/logo-scheduler /var/lib/logo-scheduler/postgres /var/lib/logo-scheduler/redis /var/backups/logo-scheduler
install -d -o logo-scheduler -g logo-scheduler -m 700 /var/lib/logo-scheduler/results
python3 - <<'PY'
import secrets,pathlib
password=secrets.token_hex(32);redis=secrets.token_hex(32);token=secrets.token_hex(32)
root=pathlib.Path('/etc/logo-scheduler')
(root/'database.env').write_text(f'POSTGRES_USER=scheduler\nPOSTGRES_DB=scheduler\nPOSTGRES_PASSWORD={password}\nREDIS_PASSWORD={redis}\n')
(root/'app.env').write_text(f'DATABASE_URL=postgres://scheduler:{password}@127.0.0.1:55432/scheduler\nREDIS_URL=redis://:{redis}@127.0.0.1:56379\nSCHEDULER_TOKEN={token}\nPROVIDER_ENABLED=false\nPROVIDER_MAX_RUNNING=0\nUSER_MAX_RUNNING=2\nUSER_MAX_PENDING=200\nPROVIDER_SUBMIT_CONCURRENCY=2\nPROVIDER_SUBMIT_INTERVAL_MS=500\nPROVIDER_POLL_RPM=300\nPOLL_INTERVAL_MS=5000\nPORT=3320\nRESULT_DIRECTORY=/var/lib/logo-scheduler/results\nAPP_CODE_DIRECTORY=/srv/ai-logo/01_Source_Code\nNODE_ENV=production\n')
for file in root.iterdir():file.chmod(0o600)
PY
cd /srv/logo-scheduler
PATH=/opt/node-v24.17.0/bin:$PATH npm ci --omit=dev --no-audit --no-fund >/var/log/logo-scheduler-install.log 2>&1
chmod -R a+rX /srv/logo-scheduler
docker compose up -d --wait --wait-timeout 90
docker exec -i logo-scheduler-postgres psql -v ON_ERROR_STOP=1 -U scheduler -d scheduler < schema.sql >/dev/null
for role in api network images; do
  case "$role" in
    api) entry=api.mjs; memory=512M; cpu=50% ;;
    network) entry=worker.mjs; memory=512M; cpu=50% ;;
    images) entry='worker.mjs images'; memory=768M; cpu=100% ;;
  esac
  cat > "/etc/systemd/system/logo-scheduler-$role.service" <<UNIT
[Unit]
Description=Logo scheduler $role
After=network-online.target docker.service
Wants=network-online.target
Requires=logo-scheduler-databases.service
After=logo-scheduler-databases.service
PartOf=logo-scheduler-databases.service
[Service]
Type=simple
User=logo-scheduler
Group=logo-scheduler
WorkingDirectory=/srv/logo-scheduler
EnvironmentFile=/etc/logo-scheduler/app.env
Environment=NODE_OPTIONS=--max-old-space-size=320
ExecStart=/opt/node-v24.17.0/bin/node /srv/logo-scheduler/$entry
Restart=on-failure
RestartSec=5
TimeoutStopSec=70
MemoryMax=$memory
MemorySwapMax=0
CPUQuota=$cpu
TasksMax=64
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/logo-scheduler/results
[Install]
WantedBy=multi-user.target
UNIT
done
cat > /etc/systemd/system/logo-scheduler-databases.service <<'UNIT'
[Unit]
Description=Dedicated Logo scheduler databases
Requires=docker.service
After=docker.service
[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/srv/logo-scheduler
ExecStart=/usr/bin/docker compose up -d --wait --wait-timeout 90
ExecStartPost=/usr/bin/python3 /srv/logo-scheduler/refresh-addresses.py
ExecStop=/usr/bin/docker compose stop
TimeoutStartSec=120
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now logo-scheduler-databases.service logo-scheduler-api.service logo-scheduler-network.service logo-scheduler-images.service
for attempt in {1..20}; do
 if curl -fsS http://127.0.0.1:3320/healthz; then break; fi
 sleep 1
done
curl -fsS http://127.0.0.1:3320/healthz
curl -fsS http://127.0.0.1:3210/api/health
/srv/logo-scheduler/backup.sh
cat > /etc/systemd/system/logo-scheduler-backup.service <<'UNIT'
[Unit]
Description=Logo scheduler database backup and isolated restore check
Requires=logo-scheduler-databases.service
After=logo-scheduler-databases.service
[Service]
Type=oneshot
ExecStart=/srv/logo-scheduler/backup.sh
Nice=10
CPUQuota=25%
MemoryMax=128M
UNIT
cat > /etc/systemd/system/logo-scheduler-backup.timer <<'UNIT'
[Unit]
Description=Daily Logo scheduler database backup
[Timer]
OnCalendar=*-*-* 02:50:00 Asia/Shanghai
Persistent=true
RandomizedDelaySec=120
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now logo-scheduler-backup.timer
echo FOUNDATION_INSTALLED_PROVIDER_DISABLED
