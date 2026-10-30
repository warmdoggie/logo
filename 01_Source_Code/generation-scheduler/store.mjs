import {randomUUID} from 'node:crypto';

const terminal=['SUCCEEDED','FAILED','CANCELLED','DOWNLOAD_FAILED','PROCESS_FAILED'];
const stages={poll:['GENERATING','GENERATING','poll_attempts'],download:['REMOTE_SUCCEEDED','DOWNLOADING','download_attempts'],process:['DOWNLOADED','PROCESSING','process_attempts']};
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};

export function createStore(pool,{maxRunning=0,userRunning=2,maxPending=200,leaseMs=120000}={}){
 async function tx(run){
  const db=await pool.connect();
  try{await db.query('BEGIN');const result=await run(db);await db.query('COMMIT');return result;}
  catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
 }
 const event=(db,job,code=null)=>db.query('INSERT INTO job_events(job_id,status,code) VALUES($1,$2,$3)',[job.id,job.status,code]);
 async function create(user,key,params){
  return tx(async db=>{
   await db.query('INSERT INTO scheduler_users(id) VALUES($1) ON CONFLICT DO NOTHING',[user]);
   await db.query('SELECT id FROM scheduler_users WHERE id=$1 FOR UPDATE',[user]);
   const existing=(await db.query('SELECT *,params=$3::jsonb AS same FROM jobs WHERE user_id=$1 AND request_id=$2',[user,key,JSON.stringify(params)])).rows[0];
   if(existing){if(!existing.same)fail(409,'Idempotency key conflicts with existing parameters');return existing;}
   if(params.batchId){
    const batch=(await db.query('SELECT * FROM business_batches WHERE id=$1 AND user_id=$2 FOR UPDATE',[params.batchId,user])).rows[0];
    if(!batch||batch.status!=='PREPARING'||!batch.descriptor.items.some(item=>item.key===params.key))fail(409,'Batch is not accepting this image');
    if((await db.query("SELECT 1 FROM jobs WHERE user_id=$1 AND params->>'batchId'=$2 AND params->>'key'=$3",[user,params.batchId,params.key])).rowCount)fail(409,'Batch image already staged');
   }
   const count=(await db.query('SELECT count(*)::int n FROM jobs WHERE user_id=$1 AND NOT(status=ANY($2::text[]))',[user,terminal])).rows[0].n;
   if(count>=maxPending)fail(429,'Pending job quota reached');
   let status='QUEUED',source=null,file=null,providerId=null,slot=false;
   if(params.resumeJobId){
    const old=(await db.query('SELECT * FROM jobs WHERE id=$1 AND user_id=$2',[params.resumeJobId,user])).rows[0];
    if(!old||old.params.planHash!==params.planHash||!['DOWNLOAD_FAILED','PROCESS_FAILED'].includes(old.status))fail(409,'Previous image cannot be resumed with these parameters');
    source=old.source_url;file=old.file_path;
    if(old.status==='PROCESS_FAILED'&&(file||old.params.local))status='DOWNLOADED';
    else if(source)status='REMOTE_SUCCEEDED';
    else fail(409,'Previous provider result requires manual retrieval; generation will not be repeated');
   }else if(params.resumeTask){
    source=params.resumeTask.imageUrl||null;providerId=params.resumeTask.taskId||null;
    status=source?'REMOTE_SUCCEEDED':'GENERATING';slot=!source;
   }
   const job=(await db.query('INSERT INTO jobs(id,user_id,request_id,params,status,source_url,file_path,provider_task_id,slot_reserved) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[randomUUID(),user,key,params,status,source,file,providerId,slot])).rows[0];
   await event(db,job);return job;
  });
 }
 async function reserve({allowRemote=true,submitConcurrency=1000000}={}){
  return tx(async db=>{
   await db.query('SELECT id FROM scheduler_account WHERE id=1 FOR UPDATE');
   if(maxRunning>0){
    const running=(await db.query('SELECT count(*)::int n FROM jobs WHERE slot_reserved')).rows[0].n;
    if(running>=maxRunning)return null;
   }
   const submitting=(await db.query("SELECT count(*)::int n FROM jobs WHERE status='SUBMITTING' AND lease_until>now()")).rows[0].n;
   if(submitting>=submitConcurrency)return null;
   const job=(await db.query(`SELECT j.* FROM jobs j JOIN scheduler_users u ON u.id=j.user_id
    WHERE j.status='QUEUED' AND j.next_action_at<=now()
      AND ($2 OR j.params->>'local'='true')
      AND (NOT(j.params ? 'batchId') OR EXISTS(SELECT 1 FROM business_batches b WHERE b.id::text=j.params->>'batchId' AND b.status='READY'))
    ORDER BY (SELECT count(*) FROM jobs a WHERE a.user_id=j.user_id AND a.slot_reserved)>= $1,
      u.last_served,j.created_at,j.id LIMIT 1 FOR UPDATE OF j`,[userRunning,allowRemote])).rows[0];
   if(!job)return null;
   const seq=(await db.query('UPDATE scheduler_account SET sequence=sequence+1 WHERE id=1 RETURNING sequence')).rows[0].sequence;
   await db.query('UPDATE scheduler_users SET last_served=$2 WHERE id=$1',[job.user_id,seq]);
   const claimed=(await db.query(`UPDATE jobs SET status='SUBMITTING',slot_reserved=true,submit_started=false,
    lease_token=$2,lease_until=now()+$3*interval '1 millisecond',updated_at=now() WHERE id=$1 RETURNING *`,[job.id,randomUUID(),leaseMs])).rows[0];
   await event(db,claimed);return claimed;
  });
 }
 async function claim(stage){
  const [from,to,attempts]=stages[stage];
  return tx(async db=>{
   await db.query('SELECT id FROM scheduler_account WHERE id=1 FOR UPDATE');
   const leased=(await db.query('SELECT count(*)::int n FROM jobs WHERE status=$1 AND lease_until>now()',[to])).rows[0].n;
   if(leased>={poll:4,download:2,process:1}[stage])return null;
   const job=(await db.query(`SELECT * FROM jobs WHERE status=$1 AND next_action_at<=now() AND lease_token IS NULL
    AND (NOT(params ? 'batchId') OR EXISTS(SELECT 1 FROM business_batches b WHERE b.id::text=jobs.params->>'batchId' AND b.status<>'PREPARING'))
    ORDER BY next_action_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,[from])).rows[0];
   if(!job)return null;
   return (await db.query(`UPDATE jobs SET status=$2,${attempts}=${attempts}+1,lease_token=$3,
    lease_until=now()+$4*interval '1 millisecond',updated_at=now() WHERE id=$1 RETURNING *`,[job.id,to,randomUUID(),leaseMs])).rows[0];
  });
 }
 async function startSubmit(job){
  return (await pool.query(`UPDATE jobs SET submit_started=true,updated_at=now() WHERE id=$1 AND lease_token=$2
   AND status='SUBMITTING' AND NOT submit_started AND lease_until>now() RETURNING *`,[job.id,job.lease_token])).rows[0]||null;
 }
 async function transition(job,status,patch={},release=false,delayMs=0){
  const allowed=['provider_task_id','source_url','file_path','result_path','error_code','download_attempts'];
  if(Object.keys(patch).some(key=>!allowed.includes(key)))throw Error('Unsupported transition field');
  return tx(async db=>{
   const values=[job.id,job.lease_token,status,release,delayMs];
   const assignments=Object.entries(patch).map(([key,value])=>{values.push(value);return `${key}=$${values.length}`;});
   const result=(await db.query(`UPDATE jobs SET status=$3,slot_reserved=CASE WHEN $4 THEN false ELSE slot_reserved END,
    lease_token=NULL,lease_until=NULL,next_action_at=now()+$5*interval '1 millisecond',updated_at=now()
    ${assignments.length?','+assignments.join(','):''}
    WHERE id=$1 AND lease_token=$2 AND lease_until>now() RETURNING *`,values)).rows[0];
   if(result)await event(db,result,patch.error_code);return result||null;
  });
 }
 async function recover(){
  return tx(async db=>{
   const rows=(await db.query(`UPDATE jobs SET
    status=CASE WHEN status='SUBMITTING' THEN CASE WHEN submit_started AND NOT COALESCE(params->>'local'='true',false) THEN 'SUBMISSION_UNKNOWN' ELSE 'QUEUED' END
     WHEN status='DOWNLOADING' THEN 'REMOTE_SUCCEEDED' WHEN status='PROCESSING' THEN 'DOWNLOADED' ELSE status END,
    slot_reserved=CASE WHEN status='SUBMITTING' AND (NOT submit_started OR params->>'local'='true') THEN false ELSE slot_reserved END,
    lease_token=NULL,lease_until=NULL,updated_at=now()
    WHERE lease_until<=now() RETURNING *`)).rows;
   for(const job of rows)await event(db,job,'lease_expired');return rows.length;
  });
 }
 async function cancel(user,id){
  return tx(async db=>{
   const job=(await db.query(`UPDATE jobs SET status='CANCELLED',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='QUEUED' RETURNING *`,[id,user])).rows[0];
   if(job)await event(db,job);return job||null;
  });
 }
 async function beginBatch(user,id,descriptor){
  return tx(async db=>{
   await db.query('INSERT INTO scheduler_users(id) VALUES($1) ON CONFLICT DO NOTHING',[user]);
   await db.query('SELECT id FROM scheduler_users WHERE id=$1 FOR UPDATE',[user]);
   const old=(await db.query('SELECT *,descriptor=$3::jsonb same FROM business_batches WHERE id=$1 AND user_id=$2',[id,user,JSON.stringify(descriptor)])).rows[0];
   if(old){if(!old.same)fail(409,'Batch parameters changed');return old;}
   if((await db.query(`SELECT 1 FROM business_batches b WHERE user_id=$1 AND descriptor->>'taskId'=$2 AND status<>'ABORTED'
    AND (status='PREPARING' OR EXISTS(SELECT 1 FROM jobs j WHERE j.params->>'batchId'=b.id::text AND NOT(j.status=ANY($3::text[]))))`,[user,descriptor.taskId,terminal])).rowCount)fail(409,'Task already has an active batch');
   const pending=(await db.query('SELECT count(*)::int n FROM jobs WHERE user_id=$1 AND NOT(status=ANY($2::text[]))',[user,terminal])).rows[0].n;
   if(pending+descriptor.items.length>maxPending)fail(429,'Pending job quota reached');
   return (await db.query('INSERT INTO business_batches(id,user_id,descriptor) VALUES($1,$2,$3) RETURNING *',[id,user,descriptor])).rows[0];
  });
 }
 async function batch(user,id){
  const value=(await pool.query('SELECT * FROM business_batches WHERE id=$1 AND user_id=$2',[id,user])).rows[0];
  if(!value)return null;return {...value,jobs:(await pool.query("SELECT * FROM jobs WHERE user_id=$1 AND params->>'batchId'=$2 ORDER BY created_at,id",[user,id])).rows};
 }
 async function commitBatch(user,id){
  return tx(async db=>{
   const value=(await db.query('SELECT * FROM business_batches WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user])).rows[0];
   if(!value||value.status==='ABORTED')fail(404,'Batch not found');
   const count=(await db.query("SELECT count(*)::int n FROM jobs WHERE user_id=$1 AND params->>'batchId'=$2",[user,id])).rows[0].n;
   if(count!==value.descriptor.items.length)fail(409,'Batch images are incomplete');
   await db.query("UPDATE business_batches SET status='READY' WHERE id=$1",[id]);return {id};
  });
 }
 return {create,reserve,claim,startSubmit,transition,recover,cancel,beginBatch,batch,commitBatch,
  renew:job=>pool.query("UPDATE jobs SET lease_until=now()+$3*interval '1 millisecond' WHERE id=$1 AND lease_token=$2 AND lease_until>now()",[job.id,job.lease_token,leaseMs]),
  deferSubmit:job=>pool.query("UPDATE jobs SET status='QUEUED',slot_reserved=false,lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND lease_until>now() AND status='SUBMITTING' AND NOT submit_started",[job.id,job.lease_token]),
  abortBatch:(user,id)=>tx(async db=>{
   const result=await db.query("UPDATE business_batches SET status='ABORTED' WHERE id=$1 AND user_id=$2 AND status='PREPARING' RETURNING id",[id,user]);
   if(result.rowCount)await db.query("UPDATE jobs SET status='CANCELLED',updated_at=now() WHERE user_id=$1 AND params->>'batchId'=$2 AND status='QUEUED'",[user,id]);
  }),
  activeBatches:async after=>(await pool.query("SELECT id,user_id FROM business_batches WHERE projected_at IS NULL AND id>$1::uuid ORDER BY id LIMIT 100",[after||'00000000-0000-0000-0000-000000000000'])).rows,
  latestBatch:async(user,taskId)=>(await pool.query("SELECT id FROM business_batches WHERE user_id=$1 AND descriptor->>'taskId'=$2 ORDER BY created_at DESC,id DESC LIMIT 1",[user,taskId])).rows[0]||null,
  acknowledgeBatch:(user,id)=>pool.query(`UPDATE business_batches b SET projected_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('READY','ABORTED')
   AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.params->>'batchId'=b.id::text AND NOT(j.status=ANY($3::text[])))`,[id,user,terminal]),
  pauseDownload:job=>transition(job,'REMOTE_SUCCEEDED',{error_code:'disk_reserve_required',download_attempts:Math.max(0,job.download_attempts-1)},false,30000),
  retry:(job,status,code,delay=5000)=>transition(job,status,{error_code:code},false,delay),
  get:async(user,id)=>(await pool.query('SELECT * FROM jobs WHERE id=$1 AND user_id=$2',[id,user])).rows[0]||null,
  list:async user=>(await pool.query('SELECT * FROM jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[user])).rows,
  stats:async()=>(await pool.query('SELECT status,count(*)::int count FROM jobs GROUP BY status')).rows
 };
}
