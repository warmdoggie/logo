import {spawn} from 'node:child_process';import {existsSync,mkdirSync,writeFileSync} from 'node:fs';import {dirname,join} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {prepareDemo} from './acceptance-demo.mjs';
const root=dirname(fileURLToPath(import.meta.url)),data=join(root,'acceptance-data'),port='3212',base='http://127.0.0.1:'+port,instance=createHash('sha256').update(root).digest('hex'),marker=join(data,'acceptance-ready.json'),origin=join(data,'acceptance-origin.json');let child;
const open=()=>{if(process.env.ACCEPTANCE_NO_BROWSER==='1')return;if(process.platform==='win32'){const p=spawn('explorer.exe',[base],{stdio:'ignore'});p.on('error',()=>console.log('请手动打开 '+base));p.unref();}else console.log('请在同一台电脑打开 '+base);};
async function health(){try{return await(await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).json();}catch{return null;}}
try{
 if(Number(process.versions.node.split('.')[0])<24)throw Error('需要Node.js 24或更高版本');
 const active=await health();if(active){if(active.acceptanceInstance!==instance)throw Error('3212被其他服务占用，请关闭对应窗口后重试');console.log('当前合并版已启动');open();process.exit(0);}
 if(!existsSync(join(data,'assistant.sqlite')))throw Error('合并版历史数据库缺失，请重新解压完整合并包。为避免误建空库，本入口停止启动。');writeFileSync(join(data,'ai-provider.local.json'),JSON.stringify({enabled:false}));
 child=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,env:{...process.env,PORT:port,APP_DATA_DIR:data,APP_NO_SEED:'1',APP_ACCEPTANCE_INSTANCE:instance},stdio:'inherit'});child.on('error',e=>{console.error(e.message);process.exitCode=1;});
 process.on('SIGINT',()=>{child.kill();process.exit();});process.on('SIGTERM',()=>{child.kill();process.exit();});
 let ready=false;for(let i=0;i<60;i++){if(child.exitCode!==null)break;if((await health())?.acceptanceInstance===instance){ready=true;break;}await new Promise(r=>setTimeout(r,250));}if(!ready)throw Error('启动失败，请查看窗口错误及3212端口占用');
 console.log('\n验收版已就绪：'+base+'\n数据目录：'+data+'\n请保持窗口打开。结束请按Ctrl+C。真实AI已禁用。');open();
}catch(e){console.error('启动失败：'+e.message);child?.kill();process.exitCode=1;}
