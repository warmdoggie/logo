import {statfs} from 'node:fs/promises';

export async function hasDiskSpace(directory,reserveGiB,inspect=statfs){
 const stats=await inspect(directory);return Number(stats.bavail)*Number(stats.bsize)>=reserveGiB*1024**3;
}
