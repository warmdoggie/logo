export const PRODUCT_GROUPS={EYE:'眼部',FACE:'脸部',LIP:'唇部'};
export function inferredGroup(category){return ({眉胶:'EYE',眉笔:'EYE',眼影:'EYE',眼线笔:'EYE',睫毛膏:'EYE',腮红:'FACE',高光:'FACE',修容:'FACE',修容棒:'FACE',遮瑕:'FACE',粉底:'FACE',散粉:'FACE',唇蜜:'LIP',唇釉:'LIP',唇线笔:'LIP',口红:'LIP',唇膏:'LIP'})[category]||null;}
export function productGroupService(db){
 db.exec(`CREATE TABLE IF NOT EXISTS ProductGroup(productId TEXT PRIMARY KEY REFERENCES Product(id),groupCode TEXT NOT NULL CHECK(groupCode IN ('EYE','FACE','LIP')),source TEXT NOT NULL,updatedAt TEXT NOT NULL);`);
 db.exec('CREATE TABLE IF NOT EXISTS ProductCategory(groupCode TEXT NOT NULL,name TEXT NOT NULL,PRIMARY KEY(groupCode,name))');
 const remember=(group,name)=>{if(group&&name)db.prepare('INSERT OR IGNORE INTO ProductCategory VALUES (?,?)').run(group,name);};
 for(const [group,names] of Object.entries({EYE:['眉胶','眉笔','眼影','眼线笔','睫毛膏'],FACE:['腮红','修容','高光','粉底','遮瑕','散粉'],LIP:['唇蜜','唇釉','唇线笔','口红','唇膏']}))for(const name of names)remember(group,name);
 const get=p=>db.prepare('SELECT groupCode FROM ProductGroup WHERE productId=?').get(p.id)?.groupCode||inferredGroup(p.category);
 for(const p of db.prepare('SELECT id,category FROM Product').all())remember(get(p)||'UNCLASSIFIED',p.category);
 const validate=v=>{if(!Object.hasOwn(PRODUCT_GROUPS,v))throw Object.assign(Error('请选择眼部、脸部或唇部'),{status:400});return v;};
 const set=(id,code,source='USER')=>{const r=db.prepare('INSERT INTO ProductGroup VALUES (?,?,?,?) ON CONFLICT(productId) DO UPDATE SET groupCode=excluded.groupCode,source=excluded.source,updatedAt=excluded.updatedAt').run(id,validate(code),source,new Date().toISOString());remember(code,db.prepare('SELECT category FROM Product WHERE id=?').get(id)?.category);return r;};
 return {get,set,validate,categories:()=>db.prepare('SELECT groupCode,name AS category FROM ProductCategory ORDER BY groupCode,name').all()};
}
