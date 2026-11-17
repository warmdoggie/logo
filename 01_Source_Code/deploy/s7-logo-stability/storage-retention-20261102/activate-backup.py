import hashlib,json,os,stat,subprocess
from pathlib import Path
root=Path('/var/lib/s7-logo-archive');assert root.resolve()==root and root.stat().st_uid==0 and root.stat().st_mode&0o777==0o700
status=json.loads((root/'snapshot-success.json').read_text());proof=json.loads((root/'snapshot-restore-verified.json').read_text())
assert proof['stamp']==status['stamp'] and proof['manifestSha256']==hashlib.sha256(Path(status['manifest']).read_bytes()).hexdigest()
assert all(proof[name] for name in ['databaseVerified','taskAssetVerified','resultImageVerified','historyVerified','rawAndGzipPlansRestored'])
assert subprocess.check_output(['systemctl','show','s7-logo-cloud-snapshot-verified.service','-p','ActiveState','--value'],text=True).strip()=='inactive'
folder=Path('/etc/systemd/system/logo-scheduler-backup.service.d');folder.mkdir(mode=0o755,exist_ok=True)
for path in [folder,*folder.parents]:assert path.resolve()==path and path.stat().st_uid==0 and not path.stat().st_mode&0o022
unit='[Service]\nExecStart=\nExecStart=/var/lib/s7-logo-archive/cloud-backup.sh\nMemoryMax=256M\nEnvironment=NODE_OPTIONS=--max-old-space-size=128\n'
file=folder/'zz-cloud-snapshot.conf';assert not file.is_symlink()
if file.exists():assert file.read_text()==unit
else:
 (root/'backup-unit-before.txt').write_bytes(subprocess.check_output(['systemctl','cat','logo-scheduler-backup.service']))
 temporary=folder/'zz-cloud-snapshot.conf.pending'
 with temporary.open('x') as handle:handle.write(unit);handle.flush();os.fsync(handle.fileno())
 os.chmod(temporary,0o644);temporary.rename(file)
 descriptor=os.open(folder,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(descriptor)
 finally:os.close(descriptor)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','reset-failed','logo-scheduler-backup.service'],check=True)
subprocess.run(['systemctl','start','--no-block','logo-scheduler-backup.service'],check=True)
assert subprocess.check_output(['systemctl','is-enabled','logo-scheduler-backup.timer'],text=True).strip()=='enabled'
print('VERIFIED_CLOUD_BACKUP_SCHEDULE_ACTIVATED')
