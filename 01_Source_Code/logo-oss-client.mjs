import OSS from 'ali-oss';
import {ECSRAMRoleCredentialsProvider,RAMRoleARNCredentialsProvider} from '@alicloud/credentials';

export function createLogoOssClients({roleArn=process.env.LOGO_OSS_PREVIEW_ROLE_ARN,provider}={}){
 if(!/^acs:ram::\d+:role\/LogoOssPreviewRole$/i.test(roleArn||''))throw Error('LOGO_OSS_PREVIEW_ROLE_ARN 必须指定独立的 LogoOssPreviewRole');
 return clients(roleArn,provider,'logo-previews');
}
export function createLogoStorageClients({roleArn=process.env.LOGO_OSS_STORAGE_ROLE_ARN,provider}={}){
 if(!/^acs:ram::\d+:role\/LogoSchedulerStorageRole$/i.test(roleArn||''))throw Error('LOGO_OSS_STORAGE_ROLE_ARN 必须指定独立的 LogoSchedulerStorageRole');
 return clients(roleArn,provider,'logo-scheduler-storage');
}
function clients(roleArn,provider,session){
 provider??=RAMRoleARNCredentialsProvider.builder()
  .withCredentialsProvider(ECSRAMRoleCredentialsProvider.builder().withDisableIMDSv1(true).withReadTimeout(1000).withConnectTimeout(1000).build())
  .withRoleArn(roleArn).withRoleSessionName(session).withStsRegionId('cn-heyuan').withReadTimeout(1000).withConnectTimeout(1000).build();
 return async internal=>{
  const {accessKeyId,accessKeySecret,securityToken}=await provider.getCredentials();
  return new OSS({region:'oss-cn-heyuan',bucket:'heci-002',secure:true,internal,accessKeyId,accessKeySecret,stsToken:securityToken,timeout:10000,refreshSTSTokenInterval:0,refreshSTSToken:async()=>{const credential=await provider.getCredentials();return {...credential,stsToken:credential.securityToken};}});
 };
}
