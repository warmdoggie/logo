import {spawnSync} from 'node:child_process';import {mkdirSync,writeFileSync} from 'node:fs';import {dirname,join} from 'node:path';import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url)),out=join(root,'work','automatic-ai-validation');mkdirSync(out,{recursive:true});mkdirSync(join(out,'temp'),{recursive:true});
console.log('验证自动增强流程：隔离测试资料、本地模拟服务，不读取正式接口密钥、不调用真实服务。');
const result=spawnSync(process.execPath,['--test',join(root,'test-automatic-ai.mjs')],{cwd:root,env:{...process.env,TMPDIR:join(out,'temp'),TMP:join(out,'temp'),TEMP:join(out,'temp')},encoding:'utf8',windowsHide:true});
const log=(result.stdout||'')+(result.stderr||'');writeFileSync(join(out,'result.log'),log);console.log(log);console.log('验证报告：'+join(out,'result.log'));if(result.error)throw result.error;process.exitCode=result.status??1;
