import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

export const appModule=name=>new URL(name,pathToFileURL((process.env.APP_CODE_DIRECTORY||fileURLToPath(new URL('../',import.meta.url)))+'/'));
export async function readPlan(directory,hash){
 if(!/^[a-f0-9]{64}$/.test(hash||''))throw Error('Invalid plan hash');
 const bytes=await readFile(join(directory,'plans',hash+'.json'));
 if(createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('Image plan checksum mismatch');return JSON.parse(bytes);
}
