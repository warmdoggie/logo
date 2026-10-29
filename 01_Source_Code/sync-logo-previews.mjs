import {parseArgs} from 'node:util';
import {readdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createOssPreviews,LOGO_PREVIEW_PREFIX} from './oss-previews.mjs';

const {values}=parseArgs({options:{'data-dir':{type:'string'},apply:{type:'boolean',default:false}}});
if(!values['data-dir'])throw Error('请明确指定 --data-dir；默认仅盘点，--apply 才上传预览');
const data=resolve(values['data-dir']),uploads=join(data,'uploads');
const files=(await readdir(uploads)).filter(file=>/^[a-f0-9-]+\.(png|jpg|webp)$/.test(file)).sort();
let previews;
if(values.apply){const {createLogoOssClients}=await import('./logo-oss-client.mjs');previews=createOssPreviews({directory:join(data,'oss-previews'),client:createLogoOssClients()});}
let sourceBytes=0;
for(const file of files){const bytes=await readFile(join(uploads,file));sourceBytes+=bytes.length;if(previews)await previews.publish(bytes);}
console.log(JSON.stringify({mode:values.apply?'apply':'dry-run',bucket:'heci-002',prefix:LOGO_PREVIEW_PREFIX,images:files.length,sourceBytes,originalsRetained:true}));
