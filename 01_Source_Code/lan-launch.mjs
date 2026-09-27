import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';

const root=dirname(fileURLToPath(import.meta.url));
const data=join(root,'acceptance-data');
const port=process.env.PORT||'3212';
if(!existsSync(join(data,'assistant.sqlite')))throw Error('合并版历史数据库缺失，已停止启动，未创建空数据库。');
const ips=[];
for(const entries of Object.values(os.networkInterfaces()))for(const item of entries||[])if(item.family==='IPv4'&&!item.internal)ips.push(item.address);
const child=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,env:{...process.env,PORT:port,HOST:'0.0.0.0',APP_ALLOWED_HOSTS:'*',APP_DATA_DIR:data,APP_NO_SEED:'1',APP_ACCEPTANCE_INSTANCE:'lan-'+Date.now()},stdio:'inherit'});
child.on('exit',code=>process.exit(code??0));
console.log('\n局域网版已启动，其他电脑请访问：');
for(const ip of ips)console.log(`  http://${ip}:${port}/`);
console.log(`本机访问：http://127.0.0.1:${port}/`);
console.log('请保持此窗口打开；结束服务请按 Ctrl+C。真实 AI 已禁用。');
process.on('SIGINT',()=>child.kill('SIGINT'));process.on('SIGTERM',()=>child.kill('SIGTERM'));
