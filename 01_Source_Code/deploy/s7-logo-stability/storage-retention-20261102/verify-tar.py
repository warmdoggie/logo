import hashlib,json,sys,tarfile
from pathlib import PurePosixPath
plan=json.load(open(sys.argv[1]));expected=plan['entries'];seen=set()
with tarfile.open(fileobj=sys.stdin.buffer,mode='r|gz') as archive:
 for member in archive:
  name=member.name.rstrip('/')
  assert name in expected and name not in seen,'Unexpected or duplicate archive member'
  assert not PurePosixPath(name).is_absolute() and '..' not in PurePosixPath(name).parts
  entry=expected[name];seen.add(name)
  assert member.mode==entry['mode'] and member.uid==entry['uid'] and member.gid==entry['gid'],'Archive permissions mismatch'
  if member.isfile():
   assert entry['type']=='file' and member.size==entry['bytes']
   with archive.extractfile(member) as source:assert hashlib.file_digest(source,'sha256').hexdigest()==entry['sha256'],'File checksum mismatch'
  elif member.isdir():assert entry['type']=='directory'
  elif member.issym():assert entry['type']=='symlink' and member.linkname==entry['link']
  else:raise AssertionError('Unsupported archive member')
assert seen==set(expected),'Archive is incomplete'
print('ALL_ARCHIVE_FILES_RESTORABLE '+str(len(seen)))
