import json,os,re,shutil,sqlite3,stat,sys,time
from pathlib import Path
stage=Path(sys.argv[1]);root=Path('/var/lib/s7-logo-archive')
assert stage.parent==root and stage.resolve()==stage and re.fullmatch(r'snapshot-\d{8}T\d{6}Z',stage.name)
assert root.stat().st_uid==0 and root.stat().st_mode&0o777==0o700
sources={'results':Path('/var/lib/logo-scheduler/results'),'archives':Path('/var/lib/logo-scheduler/completed-plan-archives'),'workspace':Path('/var/lib/s7-logo/workspace/user-spaces'),'uploads':Path('/var/lib/s7-logo/workspace/uploads')}
database=Path('/var/lib/s7-logo/workspace/assistant.sqlite')
def walk_error(error):raise error
def immutable(label,path):return path.suffix.lower() in ['.png','.jpg','.jpeg','.webp','.gz'] or (label=='results' and re.fullmatch(r'[a-f0-9]{64}\.json',path.name))
def identity(path,label=''):
 s=path.lstat();return [s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,0 if immutable(label,path) else s.st_ctime_ns]
def scan():
 entries={}
 for label,source in sources.items():
  assert source.resolve()==source and source.is_dir()
  for folder,dirs,files in os.walk(source,followlinks=False,onerror=walk_error):
   for path in [Path(folder),*(Path(folder)/name for name in sorted(dirs+files))]:
    relative=path.relative_to(source).as_posix();s=path.lstat();assert not stat.S_ISLNK(s.st_mode) and (stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode))
    entries[label+'/'+relative]=identity(path,label)
 return entries
for attempt in range(5):
 before=scan()
 for label in sources:
  target=stage/label
  if target.exists():shutil.rmtree(target)
 with sqlite3.connect('file:'+str(database)+'?mode=ro',uri=True) as source,sqlite3.connect(stage/'database/workspace.sqlite') as target:
  source.backup(target)
  assert target.execute('PRAGMA integrity_check').fetchone()[0]=='ok','SQLite backup integrity check failed'
 for label,source in sources.items():
  for folder,dirs,files in os.walk(source,followlinks=False,onerror=walk_error):
   target=stage/label/Path(folder).relative_to(source);target.mkdir(parents=True,exist_ok=True)
   for name in files:
    original=Path(folder)/name;copied=target/name;s=original.lstat();assert stat.S_ISREG(s.st_mode)
    if immutable(label,original):os.link(original,copied,follow_symlinks=False)
    else:
     sourcefd=os.open(original,os.O_RDONLY|os.O_NOFOLLOW)
     with os.fdopen(sourcefd,'rb') as sourcefile:
      current=os.fstat(sourcefile.fileno());assert stat.S_ISREG(current.st_mode) and current.st_ino==s.st_ino and current.st_dev==s.st_dev
      targetfd=os.open(copied,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
      with os.fdopen(targetfd,'wb') as targetfile:
       shutil.copyfileobj(sourcefile,targetfile);os.fchown(targetfile.fileno(),s.st_uid,s.st_gid);os.fchmod(targetfile.fileno(),stat.S_IMODE(s.st_mode))
   s=Path(folder).stat();os.chown(target,s.st_uid,s.st_gid);os.chmod(target,stat.S_IMODE(s.st_mode))
 after=scan()
 if before==after:break
 changes=[name for name in before.keys()|after.keys() if before.get(name)!=after.get(name)]
 (root/'freeze-last-changes.json').write_text(json.dumps({'changes':changes,'before':{name:before.get(name) for name in changes},'after':{name:after.get(name) for name in changes}},indent=2))
else:raise RuntimeError('Customer data changed repeatedly while preparing backup; retry later')
(stage/'frozen.json').write_text(json.dumps({'privateSnapshot':True,'attempts':attempt+1,'entries':len(before),'time':time.time()}))
print('CUSTOMER_SNAPSHOT_FROZEN '+str(len(before)))
