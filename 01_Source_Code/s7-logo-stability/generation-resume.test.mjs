import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {userSpace} from './user-space.mjs';
import {createGenerationJobs} from './generation-jobs.mjs';

test('upstream task checkpoints survive a new jobs instance and clear after saved output',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-job-resume-')),user={id:'alice'},spaces=userSpace(dir);
 try{
  const task=await spaces.createTask(user,{title:'recover remote task'});
  let firstDone,secondDone;const firstFinished=new Promise(r=>firstDone=r),secondFinished=new Promise(r=>secondDone=r);
  await createGenerationJobs(spaces).start(user,task.id,{selectedVersions:['ORIGINAL']},async callbacks=>{
   try{await callbacks.onCheckpoint('ORIGINAL',{taskId:'task_keep',requestHash:'hash'});await callbacks.onStage('ORIGINAL','failed',new Error('offline'));return [];}finally{firstDone();}
  });
  await firstFinished;
  while((await spaces.generation(user,task.id)).status==='running')await new Promise(r=>setTimeout(r,5));
  assert.equal((await spaces.generation(user,task.id)).remoteTasks.ORIGINAL.taskId,'task_keep');
  await createGenerationJobs(spaces).start(user,task.id,{selectedVersions:['ORIGINAL']},async callbacks=>{
   try{assert.equal(callbacks.resumeTasks.ORIGINAL.taskId,'task_keep');await callbacks.onOutput({version:'ORIGINAL',bytes:Buffer.from('saved image')});return [];}finally{secondDone();}
  });
  await secondFinished;
  while((await spaces.generation(user,task.id)).status==='running')await new Promise(r=>setTimeout(r,5));
  const saved=await spaces.generation(user,task.id);assert.equal(saved.stages.ORIGINAL.stage,'complete');assert.equal(saved.remoteTasks.ORIGINAL,undefined);
 }finally{await rm(dir,{recursive:true,force:true});}
});
