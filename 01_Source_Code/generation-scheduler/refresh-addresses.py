#!/usr/bin/env python3
import ipaddress
import json
import os
import pathlib
import subprocess
import tempfile
import urllib.parse

assert os.geteuid() == 0
network = 'logo-scheduler_database'
network_info = json.loads(subprocess.check_output(['docker', 'network', 'inspect', network]))[0]
assert network_info['Internal'] is True
root = pathlib.Path('/etc/logo-scheduler')
target = root / 'app.env'
assert target.is_file() and not target.is_symlink()
values = dict(line.split('=', 1) for line in target.read_text().splitlines() if line)
for container, key, port in [('logo-scheduler-postgres', 'DATABASE_URL', 5432), ('logo-scheduler-redis', 'REDIS_URL', 6379)]:
    info = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
    assert list(info['NetworkSettings']['Networks']) == [network]
    assert not info['HostConfig']['PortBindings']
    address = info['NetworkSettings']['Networks'][network]['IPAddress']
    assert ipaddress.ip_address(address).is_private
    previous = urllib.parse.urlsplit(values[key])
    credentials = previous.netloc.rsplit('@', 1)[0]
    values[key] = urllib.parse.urlunsplit((previous.scheme, f'{credentials}@{address}:{port}', previous.path, previous.query, previous.fragment))
temporary = None
try:
    with tempfile.NamedTemporaryFile(mode='w', dir=root, prefix='app.env.', delete=False) as output:
        temporary = pathlib.Path(output.name)
        output.write(''.join(f'{key}={value}\n' for key, value in values.items()))
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, target)
finally:
    if temporary is not None:
        temporary.unlink(missing_ok=True)
print('PRIVATE_DATABASE_ADDRESSES_REFRESHED')
