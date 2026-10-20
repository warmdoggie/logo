import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createApimartTransport} from './apimart-transport.mjs';

const disconnected=()=>Object.assign(new TypeError('fetch failed'),{cause:{code:'UND_ERR_SOCKET'}});

test('APIMart retries interrupted reads without resubmitting a generation',async()=>{
  let reads=0,submissions=0;
  const transport=createApimartTransport({transport:async(_url,options={})=>{
    if(options.method==='POST'){submissions++;throw disconnected();}
    if(++reads<3)throw disconnected();
    return Response.json({status:'completed'});
  }});
  assert.equal((await transport('https://api.apimart.ai/v1/tasks/task_test')).status,200);
  assert.equal(reads,3);
  await assert.rejects(()=>transport('https://api.apimart.ai/v1/images/generations',{method:'POST'}),/提交生成请求.*UND_ERR_SOCKET/);
  assert.equal(submissions,1);
});

test('APIMart final network errors identify query or download without leaking URL secrets',async()=>{
  const transport=createApimartTransport({transport:async()=>{throw disconnected();}});
  await assert.rejects(()=>transport('https://api.apimart.ai/v1/tasks/task_test'),/查询生成进度.*UND_ERR_SOCKET/);
  await assert.rejects(()=>transport('https://getapib.org/private.png?token=secret'),error=>{
    assert.match(error.message,/下载生成图片.*UND_ERR_SOCKET/);
    assert.doesNotMatch(error.message,/secret|private.png/);return true;
  });
});

test('APIMart does not retry aborted requests, HTTP failures, or programming errors',async()=>{
  for(const failure of [new Error('invalid request'),new DOMException('aborted','AbortError')]){
    let calls=0;const transport=createApimartTransport({transport:async()=>{calls++;throw failure;}});
    await assert.rejects(()=>transport('https://api.apimart.ai/v1/tasks/task_test'),error=>error===failure);
    assert.equal(calls,1);
  }
  let calls=0;const transport=createApimartTransport({transport:async()=>{calls++;return new Response('',{status:403});}});
  assert.equal((await transport('https://api.apimart.ai/v1/tasks/task_test')).status,403);assert.equal(calls,1);
});

test('APIMart retries image or query bodies interrupted after response headers',async()=>{
  let reads=0;
  const interrupted=()=>new Response(new ReadableStream({start(controller){controller.error(Object.assign(new TypeError('terminated'),{cause:{code:'UND_ERR_SOCKET'}}));}}));
  const transport=createApimartTransport({transport:async()=>++reads===1?interrupted():new Response('complete image')});
  assert.equal(await (await transport('https://getapib.org/image.png')).text(),'complete image');
  assert.equal(reads,2);
  let posts=0;
  const submit=createApimartTransport({transport:async()=>{posts++;return interrupted();}});
  await assert.rejects(()=>submit('https://api.apimart.ai/v1/images/generations',{method:'POST'}),/提交生成请求.*UND_ERR_SOCKET/);
  assert.equal(posts,1);
});

test('APIMart gives image downloads bounded longer retries than status queries',async()=>{
  for(const [url,expectedAttempts] of [['https://getapib.org/image.png',5],['https://api.apimart.ai/v1/tasks/task_test',3]]){
    let calls=0;
    const transport=createApimartTransport({transport:async()=>{calls++;throw disconnected();}});
    await assert.rejects(()=>transport(url),/网络连接失败/);
    assert.equal(calls,expectedAttempts);
  }
});

