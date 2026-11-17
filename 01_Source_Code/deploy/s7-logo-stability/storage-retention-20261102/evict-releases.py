import hashlib,json,os,shutil,stat,subprocess,time
from pathlib import Path
root=Path('/var/backups/s7-logo');registry=Path('/var/lib/s7-logo-archive');manifest=json.loads((registry/'release-verified.json').read_text())
original=json.loads((registry/'release-plan.json').read_text())
assert original['stamp']==manifest['stamp'] and original['names']==manifest['names'] and original['keep']==manifest['keep']
assert registry.resolve()==registry and registry.stat().st_uid==0 and registry.stat().st_mode&0o777==0o700
for path in [root,*root.parents]:assert path.resolve()==path and path.stat().st_uid==0 and not path.stat().st_mode&0o022
assert manifest['root']==str(root) and manifest['verifiedAt'] and manifest['keyId'] and manifest['envelopeKey']
assert subprocess.check_output(['git','-C','/srv/ai-logo','rev-parse','HEAD'],text=True).strip()==manifest['current']
drill=json.loads((registry/'release-restore-drill/RESTORE-VERIFIED.json').read_text());assert drill['allArchiveEntriesVerified']==len(manifest['entries'])
assert drill['authenticationVerified'] and drill['archiveSha256']==manifest['archive']['sha256'] and drill['manifestSha256']==hashlib.sha256((registry/'release-verified.json').read_bytes()).hexdigest() and drill['folder'] in manifest['names']
def sha(path):
 with path.open('rb') as file:return hashlib.file_digest(file,'sha256').hexdigest()
for file,digest in manifest['protected']['files'].items():assert sha(Path(file))==digest
for name,pid in manifest['protected']['services'].items():assert subprocess.check_output(['systemctl','show',name,'-p','MainPID','--value'],text=True).strip()==pid
containers=json.loads(subprocess.check_output(['docker','inspect',*manifest['protected']['containers']],text=True))
assert {v['Id']:{'image':v['Image'],'started':v['State']['StartedAt']} for v in containers}==manifest['protected']['containers']
for name in manifest['keep']:
 folder=root/name;recovery=json.loads((folder/'recovery.json').read_text());assert sha(folder/recovery['source'])==recovery['archiveSha256']
assert sorted(p.name for p in root.iterdir() if p.is_dir())==sorted(manifest['names']+manifest['keep'])
seen=set()
def verify(path):
 relative=path.relative_to(root).as_posix();seen.add(relative);entry=manifest['entries'][relative];s=path.lstat()
 assert stat.S_IMODE(s.st_mode)==entry['mode'] and s.st_uid==entry['uid'] and s.st_gid==entry['gid']
 if entry['type']=='directory':
  assert stat.S_ISDIR(s.st_mode) and not path.is_symlink()
  for child in path.iterdir():verify(child)
 elif entry['type']=='symlink':assert stat.S_ISLNK(s.st_mode) and os.readlink(path)==entry['link']
 else:
  source=original['entries'][relative]
  assert {k:v for k,v in source.items() if k!='mtimeNs'}=={k:v for k,v in entry.items() if k!='mtimeNs'}
  assert (source['mtimeNs']==entry['mtimeNs']) if isinstance(source['mtimeNs'],str) else (float(source['mtimeNs'])==float(entry['mtimeNs']))
  assert stat.S_ISREG(s.st_mode) and s.st_ino==entry['inode'] and s.st_size==entry['bytes'] and s.st_mtime_ns==int(source['mtimeNs']) and sha(path)==entry['sha256']
for name in manifest['names']:verify(root/name)
assert seen==set(manifest['entries'])
before=shutil.disk_usage('/').free
for name in manifest['names']:
 path=root/name;assert path.resolve()==path and path.parent==root and name not in manifest['keep'];shutil.rmtree(path)
after=shutil.disk_usage('/').free
result={'time':time.time(),'foldersEvicted':len(manifest['names']),'kept':manifest['keep'],'freedBytes':after-before,'availableBytes':after,'archiveVerified':True,'restoreDrillVerified':True}
(registry/'release-retention-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
