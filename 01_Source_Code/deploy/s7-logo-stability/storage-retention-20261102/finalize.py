import hashlib,json,os,re,shutil,stat,subprocess,time,urllib.request
from pathlib import Path
root=Path('/var/lib/s7-logo-archive');assert root.resolve()==root and root.stat().st_uid==0 and root.stat().st_mode&0o777==0o700
def out(args):return subprocess.check_output(args,text=True).strip()
def sha(path):
 with path.open('rb') as file:return hashlib.file_digest(file,'sha256').hexdigest()
assert out(['systemctl','show','logo-scheduler-backup.service','-p','ActiveState','--value'])=='inactive'
assert out(['systemctl','show','logo-scheduler-backup.service','-p','Result','--value'])=='success'
assert out(['systemctl','show','logo-scheduler-backup.service','-p','ExecMainStatus','--value'])=='0'
release=json.loads((root/'release-verified.json').read_text());evicted=json.loads((root/'release-retention-result.json').read_text());images=json.loads((root/'image-retention-result.json').read_text());snapshot=json.loads((root/'snapshot-success.json').read_text());restored=json.loads((root/'snapshot-restore-verified.json').read_text())
assert snapshot['verified'] and all(restored[name] for name in ['databaseVerified','taskAssetVerified','resultImageVerified','historyVerified','rawAndGzipPlansRestored'])
assert out(['git','-C','/srv/ai-logo','rev-parse','HEAD'])==release['current']
for file,digest in release['protected']['files'].items():assert sha(Path(file))==digest
for name,pid in release['protected']['services'].items():assert out(['systemctl','show',name,'-p','MainPID','--value'])==pid and out(['systemctl','is-active',name])=='active'
containers=json.loads(out(['docker','inspect',*out(['docker','ps','-aq']).split()]))
assert all(v['State']['Running'] for v in containers)
assert {v['Id']:{'image':v['Image'],'started':v['State']['StartedAt']} for v in containers}==release['protected']['containers']
for image in images['preserved']:assert json.loads(out(['docker','image','inspect',image]))[0]['Id']==image
assert sha(Path('/srv/frame/releases/state'))==json.loads((root/'image-verified.json').read_text())['frameStateSha256']
for image in images['imagesEvicted']:assert subprocess.run(['docker','image','inspect',image],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0
assert sorted(p.name for p in Path('/var/backups/s7-logo').iterdir() if p.is_dir())==sorted(release['keep'])
assert out(['systemctl','is-enabled','logo-scheduler-backup.timer'])=='enabled'
assert out(['systemctl','is-active','logo-scheduler-backup.timer'])=='active'
timer=out(['systemctl','show','logo-scheduler-backup.timer','-p','NextElapseUSecRealtime','--value'])
assert timer
stages=[];before=shutil.disk_usage('/').free
for path in sorted(root.iterdir()):
 if not re.fullmatch(r'snapshot-\d{8}T\d{6}Z',path.name) or not path.is_dir():continue
 assert path.parent==root and path.resolve()==path and path.stat().st_uid==0 and stat.S_IMODE(path.stat().st_mode)==0o700
 stages.append(path.name);shutil.rmtree(path)
health={}
for endpoint in ['/api/health','/s7/healthz']:
 with urllib.request.urlopen('http://127.0.0.1:3210'+endpoint,timeout=10) as response:assert response.status==200;health[endpoint]=response.status
with urllib.request.urlopen('https://logo.heciai.net/',timeout=15) as response:assert response.status==200;health['public']=response.status
with urllib.request.urlopen('http://127.0.0.1:3000/',timeout=10) as response:assert response.status==200;health['frame']=response.status
liveImages=set(out(['docker','image','ls','--no-trunc','--format','{{.ID}}']).split())
assert liveImages==set(images['preserved'])
result={'verifiedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'current':release['current'],'previous':release['previous'],'releaseFoldersKept':release['keep'],'oldReleaseFoldersArchived':evicted['foldersEvicted'],'oldImagesArchived':len(images['imagesEvicted']),'imagesKept':len(liveImages),'runningContainersUnchanged':len(containers),'servicesAndProtectedConfigurationUnchanged':True,'workingCustomerDataPreserved':True,'releaseBytesFreed':evicted['freedBytes'],'imageBytesFreed':images['freedBytes'],'testCopyBytesFreed':shutil.disk_usage('/').free-before,'availableBytes':shutil.disk_usage('/').free,'snapshot':snapshot,'sampledRestore':restored,'backupServiceVerified':True,'backupTimerNext':timer,'health':health,'temporaryStagesRemoved':stages}
(root/'final-verified.json').write_text(json.dumps(result,indent=2));os.chmod(root/'final-verified.json',0o600)
print('STORAGE_RETENTION_FULLY_VERIFIED')
print(json.dumps({key:result[key] for key in ['releaseBytesFreed','imageBytesFreed','testCopyBytesFreed','availableBytes','oldReleaseFoldersArchived','oldImagesArchived','imagesKept','backupServiceVerified','backupTimerNext','health']},indent=2))
