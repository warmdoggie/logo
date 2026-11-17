import {readFileSync} from 'node:fs';
import {join} from 'node:path';
// Only reads accounts generated in the isolated test directory supplied by the caller.
export async function testLogin(base,data,username='designer'){
 const password=readFileSync(join(data,'规则管理账号.txt'),'utf8').match(new RegExp('账号：'+username+'\\r?\\n密码：([^\\r\\n]+)'))?.[1];
 if(!password)throw Error('Missing isolated test account');
 const r=await fetch(base+'/api/rule-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
 if(r.status!==200)throw Error('Isolated login failed');
 return r.headers.get('set-cookie').split(';')[0];
}
