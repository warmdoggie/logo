import pg from 'pg';
import IORedis from 'ioredis';
import {Queue} from 'bullmq';
import {createStore} from './store.mjs';

export const number=(key,fallback,min=1,max=10000)=>{
 const value=Number(process.env[key]??fallback);
 if(!Number.isSafeInteger(value)||value<min||value>max)throw Error('Invalid '+key);return value;
};
if(!process.env.DATABASE_URL||!process.env.REDIS_URL)throw Error('Dedicated DATABASE_URL and REDIS_URL required');
export const enabled=process.env.PROVIDER_ENABLED==='true';
export const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:3000,statement_timeout:5000});
pool.on('error',()=>console.error('postgres_connection_error'));
export const store=createStore(pool,{maxRunning:number('PROVIDER_MAX_RUNNING',0,0,100),userRunning:number('USER_MAX_RUNNING',2,1,30),maxPending:number('USER_MAX_PENDING',200,1,500),leaseMs:120000});
export const redis=new IORedis(process.env.REDIS_URL,{maxRetriesPerRequest:null,enableReadyCheck:true});
redis.on('error',()=>console.error('redis_connection_error'));
export const queues=Object.fromEntries(['submit','poll','download','process'].map(stage=>[stage,new Queue('logo-'+stage,{connection:redis,defaultJobOptions:{removeOnComplete:true,removeOnFail:100}})]));
export async function close(){await Promise.all(Object.values(queues).map(q=>q.close()));redis.disconnect();await pool.end();}
