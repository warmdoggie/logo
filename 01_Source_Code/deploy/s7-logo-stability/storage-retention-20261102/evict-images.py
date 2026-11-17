import hashlib,json,shutil,subprocess,time
from pathlib import Path
root=Path('/var/lib/s7-logo-archive');assert root.resolve()==root and root.stat().st_uid==0 and root.stat().st_mode&0o777==0o700
manifest=json.loads((root/'image-verified.json').read_text());assert manifest['dockerLoadVerified'] and manifest['verifiedAt'] and manifest['keyId']
restore=json.loads((root/'image-authenticated-restore.json').read_text());assert restore['authenticatedBeforeDockerLoad'] and restore['manifestSha256']==hashlib.sha256((root/'image-verified.json').read_bytes()).hexdigest() and restore['archiveSha256']==manifest['archive']['sha256'] and set(restore['images'])=={v['id'] for v in manifest['selected']}
assert hashlib.sha256(Path('/srv/frame/releases/state').read_bytes()).hexdigest()==manifest['frameStateSha256']
def out(args):return subprocess.check_output(args,text=True).strip()
containers=json.loads(out(['docker','inspect',*out(['docker','ps','-aq']).split()]))
assert {v['Id']:{'image':v['Image'],'started':v['State']['StartedAt']} for v in containers}==manifest['protectedContainers']
protected={v['Image'] for v in containers}|set(manifest['preserved'])
for id in protected:assert json.loads(out(['docker','image','inspect',id]))[0]['Id']==id
for selected in manifest['selected']:
 assert selected['id'] not in protected
 live=json.loads(out(['docker','image','inspect',selected['id']]))[0]
 assert sorted(live.get('RepoTags') or [])==sorted(selected['tags'] or [])
before=shutil.disk_usage('/').free;deleted=[]
for selected in manifest['selected']:
 id=selected['id'];tags=selected['tags'] or []
 if tags:subprocess.run(['docker','image','rm','--no-prune',*tags],check=True)
 if subprocess.run(['docker','image','inspect',id],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:
  subprocess.run(['docker','image','rm','--no-prune',id],check=True)
 assert subprocess.run(['docker','image','inspect',id],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0
 deleted.append(id)
for id in protected:assert json.loads(out(['docker','image','inspect',id]))[0]['Id']==id
after=shutil.disk_usage('/').free;result={'time':time.time(),'imagesEvicted':deleted,'preserved':list(protected),'freedBytes':after-before,'availableBytes':after,'dockerLoadVerified':True}
(root/'image-retention-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
