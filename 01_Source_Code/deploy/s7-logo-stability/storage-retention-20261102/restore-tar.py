import hashlib,json,os,stat,sys,tarfile
from pathlib import Path,PurePosixPath
plan=json.load(open(sys.argv[1]));selected=sys.argv[2];target=Path(sys.argv[3])
assert selected in plan['names'] and '/' not in selected
assert target.parent.resolve()==target.parent and target.parent.stat().st_uid==0 and target.parent.stat().st_mode&0o077==0
target.mkdir(mode=0o700);expected=plan['entries'];seen=set();links=[];directories=[]
with tarfile.open(fileobj=sys.stdin.buffer,mode='r|gz') as archive:
 for member in archive:
  name=member.name.rstrip('/');assert name in expected and name not in seen
  assert not PurePosixPath(name).is_absolute() and '..' not in PurePosixPath(name).parts
  entry=expected[name];seen.add(name)
  assert member.mode==entry['mode'] and member.uid==entry['uid'] and member.gid==entry['gid']
  chosen=name==selected or name.startswith(selected+'/');path=target/name
  if member.isfile():
   assert entry['type']=='file' and member.size==entry['bytes'];hash=hashlib.sha256()
   if chosen:path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
   output=path.open('xb') if chosen else None
   try:
    with archive.extractfile(member) as source:
     while chunk:=source.read(1048576):
      hash.update(chunk)
      if output:output.write(chunk)
   finally:
    if output:output.flush();os.fsync(output.fileno());output.close()
   assert hash.hexdigest()==entry['sha256']
   if chosen:os.chown(path,entry['uid'],entry['gid']);os.chmod(path,entry['mode'])
  elif member.isdir():
   assert entry['type']=='directory'
   if chosen:path.mkdir(mode=0o700,parents=True,exist_ok=True);directories.append((path,entry))
  elif member.issym():
   assert entry['type']=='symlink' and member.linkname==entry['link']
   if chosen:links.append((path,entry))
  else:raise AssertionError('Unsupported archive entry')
assert seen==set(expected)
for path,entry in links:path.parent.mkdir(mode=0o700,parents=True,exist_ok=True);os.symlink(entry['link'],path);os.lchown(path,entry['uid'],entry['gid'])
for path,entry in reversed(directories):os.chown(path,entry['uid'],entry['gid']);os.chmod(path,entry['mode'])
(target/'RESTORE-CONTENT-VERIFIED.json').write_text(json.dumps({'folder':selected,'allArchiveEntriesVerified':len(seen),'restoredFiles':sum(e['type']=='file' for n,e in expected.items() if n.startswith(selected+'/'))}))
print('RELEASE_RESTORE_DRILL_VERIFIED '+selected)
