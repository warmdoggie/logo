import hashlib,json,os,stat,subprocess,time
from pathlib import Path
ROOT=Path('/var/backups/s7-logo');REG=Path('/var/lib/s7-logo-archive')
CURRENT='6a6973f9e112306647b6348a3a65c843d4853050'
PREVIOUS='0c85cc666769c7f893faace285b8df22be9e0e3c'
KEEP=[]
for revision in [CURRENT,PREVIOUS]:
 matches=[p.parent.name for p in ROOT.glob('*/manifest.json') if json.loads(p.read_text()).get('candidate')==revision]
 assert len(matches)==1,'Ambiguous release backup';KEEP.append(matches[0])
def out(args):return subprocess.check_output(args,text=True).strip()
def sha(path):
 with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def guard(path):
 assert path.resolve()==path and not path.is_symlink(),str(path)
 for ancestor in [path,*path.parents]:
  s=ancestor.stat();assert s.st_uid==0 and not s.st_mode&0o022,'Unsafe parent '+str(ancestor)
guard(ROOT);assert out(['git','-C','/srv/ai-logo','rev-parse','HEAD'])==CURRENT
REG.mkdir(mode=0o700,exist_ok=True);guard(REG);assert stat.S_IMODE(REG.stat().st_mode)==0o700
key=REG/'encryption.key'
if not key.exists():
 fd=os.open(key,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb') as f:f.write(os.urandom(32));f.flush();os.fsync(f.fileno())
assert key.stat().st_size==32 and key.stat().st_uid==0 and stat.S_IMODE(key.stat().st_mode)==0o600
for name,revision in zip(KEEP,[CURRENT,PREVIOUS]):
 folder=ROOT/name;guard(folder)
 archive=folder/'source-recovery.tar.gz'
 if not archive.exists():
  with archive.open('xb') as f:subprocess.run(['git','-C','/srv/ai-logo','archive','--format=tar.gz',revision],stdout=f,check=True)
  os.chmod(archive,0o600)
 with archive.open('rb') as f:
  subprocess.run(['tar','-tzf','-'],stdin=f,stdout=subprocess.DEVNULL,check=True)
 (folder/'recovery.json').write_text(json.dumps({'revision':revision,'archiveSha256':sha(archive),'source':'source-recovery.tar.gz','runtime':'/srv/logo-scheduler','dependenciesPreserved':True},indent=2))
names=sorted(p.name for p in ROOT.iterdir() if p.is_dir() and p.name not in KEEP)
entries={};total=0
def walk(path):
 global total
 relative=path.relative_to(ROOT).as_posix();s=path.lstat()
 if stat.S_ISDIR(s.st_mode):
  entries[relative]={'type':'directory','mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid}
  for child in sorted(path.iterdir()):walk(child)
 elif stat.S_ISLNK(s.st_mode):entries[relative]={'type':'symlink','link':os.readlink(path),'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid}
 else:
  assert stat.S_ISREG(s.st_mode),'Special file '+relative
  entries[relative]={'type':'file','bytes':s.st_size,'sha256':sha(path),'mtimeNs':str(s.st_mtime_ns),'inode':s.st_ino,'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid};total+=s.st_size
for name in names:walk(ROOT/name)
protectedFiles=['/etc/logo-scheduler/app.env','/etc/logo-scheduler/provider.json','/etc/s7-logo/scheduler.json','/etc/s7-logo/ai-provider.json','/etc/systemd/system/logo-scheduler-api.service.d/zz-full-resolution-memory.conf','/etc/systemd/system/logo-scheduler-images.service.d/zz-full-resolution-memory.conf']
services=['s7-workspace','logo-scheduler-api','logo-scheduler-network','logo-scheduler-images']
containers=json.loads(out(['docker','inspect',*out(['docker','ps','-aq']).split()]))
protected={'files':{p:sha(Path(p)) for p in protectedFiles},'services':{s:out(['systemctl','show',s,'-p','MainPID','--value']) for s in services},'containers':{v['Id']:{'image':v['Image'],'started':v['State']['StartedAt']} for v in containers}}
plan={'version':1,'stamp':time.strftime('%Y%m%dT%H%M%SZ',time.gmtime()),'root':str(ROOT),'keep':KEEP,'current':CURRENT,'previous':PREVIOUS,'names':names,'entries':entries,'totalBytes':total,'protected':protected}
file=REG/'release-plan.json';file.write_text(json.dumps(plan));os.chmod(file,0o600)
print(json.dumps({'selectedFolders':len(names),'files':sum(e['type']=='file' for e in entries.values()),'totalMiB':round(total/1048576,1),'keep':KEEP}))
