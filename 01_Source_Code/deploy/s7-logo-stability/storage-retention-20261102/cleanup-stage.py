import os,re,shutil,sys
from pathlib import Path
root=Path('/var/lib/s7-logo-archive');path=Path(sys.argv[1])
assert path.parent==root and re.fullmatch(r'snapshot-\d{8}T\d{6}Z',path.name) and path.resolve()==path and path.stat().st_uid==0
assert root.resolve()==root and root.stat().st_uid==0 and root.stat().st_mode&0o777==0o700
assert (root/'snapshot-success.json').is_file()
import json
assert json.loads((root/'snapshot-success.json').read_text())['stamp']==path.name.removeprefix('snapshot-')
shutil.rmtree(path)
