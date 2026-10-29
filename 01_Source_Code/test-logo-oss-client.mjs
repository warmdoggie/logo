import test from 'node:test';
import assert from 'node:assert/strict';

test('Logo 签名使用专用角色和固定 Bucket，忽略 FRAME 的存储配置',async()=>{
 const {createLogoOssClients}=await import('./logo-oss-client.mjs');
 const factory=createLogoOssClients({roleArn:'acs:ram::1234567890123456:role/LogoOssPreviewRole',provider:{getCredentials:async()=>({accessKeyId:'test-access-key',accessKeySecret:'test-secret',securityToken:'test-token'})}});
 const publicClient=await factory(false),internalClient=await factory(true);
 const signed=new URL(publicClient.signatureUrl('s7-logo/previews/v1/example/192.webp',{expires:60}));
 assert.equal(signed.origin,'https://heci-002.oss-cn-heyuan.aliyuncs.com');assert.equal(signed.searchParams.get('security-token'),'test-token');
 assert.equal(internalClient.options.endpoint.hostname,'oss-cn-heyuan-internal.aliyuncs.com');
 assert.throws(()=>createLogoOssClients({roleArn:'acs:ram::1234567890123456:role/FrameEcsOssRole'}),/LogoOssPreviewRole/);
 assert.throws(()=>createLogoOssClients({roleArn:''}),/LogoOssPreviewRole/);
});
