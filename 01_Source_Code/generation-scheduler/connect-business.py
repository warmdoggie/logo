#!/usr/bin/env python3
"""Run under the release maintenance window; never prints credentials."""
import grp
import json
import os
from pathlib import Path
import socket
import tempfile

assert os.geteuid() == 0
assert socket.gethostname() == 'iZf8zjczn9o390i523upydZ'
root = Path('/etc/logo-scheduler')
environment = dict(line.split('=', 1) for line in (root / 'app.env').read_text().splitlines() if '=' in line)
assert environment['PROVIDER_ENABLED'] == 'false', 'Paid activation is outside this release'
assert len(environment['SCHEDULER_TOKEN']) >= 40
assert Path('/srv/ai-logo/01_Source_Code/s7-logo-stability/scheduled-generation.mjs').is_file()
assert Path('/etc/s7-logo/ai-provider.json').is_file()

def atomic(path, data, mode=0o600, group=0):
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, mode)
        os.chown(temporary, 0, group)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)

environment.update(PROVIDER_MAX_RUNNING='15', USER_MAX_RUNNING='2', USER_MAX_PENDING='200',
                   PROVIDER_SUBMIT_CONCURRENCY='2', PROVIDER_SUBMIT_INTERVAL_MS='500',
                   PROVIDER_POLL_RPM='300', APP_CODE_DIRECTORY='/srv/ai-logo/01_Source_Code')
environment.pop('PROVIDER_SUBMIT_RPM', None)
environment.pop('PROVIDER_CONFIG', None)
atomic(root / 'app.env', ''.join(f'{key}={value}\n' for key, value in environment.items()))
atomic(root / 'provider.json', Path('/etc/s7-logo/ai-provider.json').read_text())
atomic(Path('/etc/s7-logo/scheduler.json'), json.dumps({'url': 'http://127.0.0.1:3320', 'token': environment['SCHEDULER_TOKEN']}),
       0o640, grp.getgrnam('s7-logo').gr_gid)
units = {
    's7-workspace': '[Service]\nEnvironment=S7_SCHEDULER_CONFIG=/etc/s7-logo/scheduler.json\nMemoryMax=2G\nCPUQuota=150%\n',
    'logo-scheduler-api': '[Service]\nMemoryMax=512M\n',
    'logo-scheduler-network': '[Service]\nLoadCredential=provider.json:/etc/logo-scheduler/provider.json\nEnvironment=PROVIDER_CONFIG=%d/provider.json\n',
}
for name, content in units.items():
    directory = Path('/etc/systemd/system') / (name + '.service.d')
    directory.mkdir(mode=0o755, exist_ok=True)
    atomic(directory / 'scheduler-business.conf', content, 0o644)
print('BUSINESS_CONFIG_READY_PAID_DISABLED')
