import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processCandidates,chooseProcess} from './customer-revisions.mjs';
const result=(status,testOnly=false)=>({overallStatus:status,testOnly,messages:[status]});
test('自动工艺：保留颜色语义，金色不推断烫金，指定工艺不替换',async()=>{
 assert.deepEqual(processCandidates('AUTO',{colorMode:'SINGLE',primaryColor:'#c4a052'}),['NORMAL_PRINT','GOLD_PRINT']);
 assert.deepEqual(processCandidates('HOT_STAMP_GOLD',{}),['HOT_STAMP_GOLD']);
 assert.deepEqual(processCandidates('AUTO',{colorMode:'ORIGINAL'}),['NORMAL_PRINT']);
 const calls=[];const selected=await chooseProcess(['NORMAL_PRINT','BLACK_PRINT'],['body','box'],async(p,z)=>{calls.push([p,z]);return result(p==='NORMAL_PRINT'&&z==='box'?'BLOCK':'PASS');});
 assert.equal(selected.processType,'BLACK_PRINT');assert.equal(selected.rejected.length,1);assert.equal(calls.length,4);
 await assert.rejects(()=>chooseProcess(['HOT_STAMP_GOLD'],['body'],async()=>result('BLOCK')),/没有可自动执行/);
});
test('自动工艺：所有区域通过才放行，警告、未知与示例结果均不可自动通过',async()=>{
 for(const status of ['WARNING','NEED_INFO','BLOCK'])await assert.rejects(()=>chooseProcess(['NORMAL_PRINT'],['body','box'],async(_,zone)=>result(zone==='body'?'PASS':status)),/没有可自动执行/);
 await assert.rejects(()=>chooseProcess(['NORMAL_PRINT'],['body'],async()=>result('PASS',true)),/没有可自动执行/);
});
