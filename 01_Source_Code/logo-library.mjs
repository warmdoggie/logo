import {randomUUID} from 'node:crypto';

const fail=(message,status)=>{throw Object.assign(Error(message),{status});};
export function logoLibrary(db,storage,getOwner=()=> 'local'){
 db.exec(`CREATE TABLE IF NOT EXISTS LogoLibraryAsset(
  id TEXT PRIMARY KEY, ownerId TEXT NOT NULL, name TEXT NOT NULL, filePath TEXT NOT NULL, createdAt TEXT NOT NULL
 ); CREATE INDEX IF NOT EXISTS idx_LogoLibraryAsset_owner ON LogoLibraryAsset(ownerId,createdAt DESC);`);
 if(!db.prepare('PRAGMA table_info(LogoLibraryAsset)').all().some(column=>column.name==='aiRefined'))db.exec('ALTER TABLE LogoLibraryAsset ADD COLUMN aiRefined INTEGER NOT NULL DEFAULT 0');
 const owner=()=>{const value=getOwner();if(!value)fail('请先登录',401);return value;};
 function view(row){return {id:row.id,name:row.name,createdAt:row.createdAt,imageUrl:`/api/logo-library/${row.id}/image`,...(row.aiRefined?{aiRefined:true}:{})};}
 function add({name,bytes,aiRefined=false}){
  const ownerId=owner();if(!Buffer.isBuffer(bytes)||!bytes.length)fail('请选择 Logo 图片',400);if(bytes.length>12*1024*1024)fail('Logo 图片不能超过 12 MB',413);
  if(typeof name!=='string'||!name.trim())fail('Logo 名称不能为空',400);
  const id=randomUUID(),filePath=storage.put(bytes,'png'),createdAt=new Date().toISOString();
  try{db.prepare('INSERT INTO LogoLibraryAsset (id,ownerId,name,filePath,createdAt,aiRefined) VALUES (?,?,?,?,?,?)').run(id,ownerId,name.trim().slice(0,240),filePath,createdAt,aiRefined===true?1:0);}catch(error){storage.remove(filePath);throw error;}
  return view({id,name:name.trim().slice(0,240),createdAt,aiRefined:aiRefined===true});
 }
 function list(){const ownerId=owner();return db.prepare('SELECT id,name,createdAt,aiRefined FROM LogoLibraryAsset WHERE ownerId=? ORDER BY createdAt DESC,id DESC').all(ownerId).map(view);}
 function rename(id,name){const ownerId=owner();if(typeof name!=='string'||!name.trim())fail('Logo 名称不能为空',400);if(name.trim().length>120)fail('Logo 名称不能超过 120 个字',400);const row=db.prepare('SELECT id,createdAt,aiRefined FROM LogoLibraryAsset WHERE id=? AND ownerId=?').get(id,ownerId);if(!row)fail('Logo 不存在',404);const value=name.trim();db.prepare('UPDATE LogoLibraryAsset SET name=? WHERE id=? AND ownerId=?').run(value,id,ownerId);return view({...row,name:value});}
 function image(id){const row=db.prepare('SELECT filePath FROM LogoLibraryAsset WHERE id=? AND ownerId=?').get(id,owner());if(!row)fail('Logo 不存在',404);return storage.get(row.filePath);}
 function remove(id){const row=db.prepare('SELECT filePath FROM LogoLibraryAsset WHERE id=? AND ownerId=?').get(id,owner());if(!row)fail('Logo 不存在',404);db.prepare('DELETE FROM LogoLibraryAsset WHERE id=? AND ownerId=?').run(id,owner());storage.remove(row.filePath);}
 return {add,list,rename,image,remove};
}
