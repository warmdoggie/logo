import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=dirname(fileURLToPath(import.meta.url)),data=join(root,'acceptance-data'),port='3226',url='http://127.0.0.1:'+port,instance=createHash('sha256').update(root).digest('hex');
async function health(){try{return await(await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)})).json();}catch{return null;}}
try{
 if(!existsSync(join(data,'assistant.sqlite')))throw Error('原正式数据库缺失，停止启动以避免建立空库');
 let live=await health();if(live&&live.acceptanceInstance!==instance)throw Error('3226 端口被其他程序占用');
 if(!live){mkdirSync(join(root,'work'),{recursive:true});const out=openSync(join(root,'work/current-stage.log'),'a');const child=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,windowsHide:true,detached:true,stdio:['ignore',out,out],env:{...process.env,APP_DATA_DIR:data,APP_NO_SEED:'1',PORT:port,APP_ACCEPTANCE_INSTANCE:instance}});child.unref();closeSync(out);for(let i=0;i<40;i++){live=await health();if(live)break;await new Promise(r=>setTimeout(r,250));}if(live?.acceptanceInstance!==instance)throw Error('启动失败，请查看 app/work/current-stage.log');}
 console.log('当前阶段版本：'+url);if(process.env.ACCEPTANCE_NO_BROWSER!=='1'){const p=spawn('explorer.exe',[url],{windowsHide:true,stdio:'ignore'});p.unref();}
}catch(e){console.error(e.message);process.exitCode=1;}
