import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import sharp from 'sharp';
import {createAiMockupRenderer,getAiMockupProviderStatus} from './ai-mockup-provider.mjs';

async function outputImage(){
  return sharp({create:{width:12,height:8,channels:3,background:{r:220,g:210,b:200}}}).png().toBuffer();
}

const guides=[
  {version:'ORIGINAL',dataUrl:'data:image/png;base64,G1'},
  {version:'BLACK',dataUrl:'data:image/png;base64,G2'},
  {version:'GOLD FOIL',dataUrl:'data:image/png;base64,G3'},
  {version:'SILVER FOIL',dataUrl:'data:image/png;base64,G4'}
];

test('APIMart exposes configured mockup models including flux-3-image',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-model-options-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'gpt-image-2.5-flare',mockupModels:['gpt-image-2.5-flare','flux-3-image'],endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
    assert.deepEqual(getAiMockupProviderStatus(configPath),{
      configured:true,
      provider:'APIMART',
      defaultModel:'gpt-image-2.5-flare',
      models:['gpt-image-2.5-flare','flux-3-image']
    });
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('selected mockup model is forwarded to APIMart without changing the default',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-model-selection-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'gpt-image-2.5-flare',mockupModels:['gpt-image-2.5-flare','flux-3-image'],endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
    const output=await outputImage();
    const sent=[];
    const renderer=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async(url,options)=>{
      if(String(url).endsWith('/v1/images/generations')){sent.push(JSON.parse(options.body));return Response.json({data:[{url:'https://getapib.org/f/mockup.png'}]});}
      return new Response(output);
    }});
    await renderer({model:'flux-3-image',baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',guides,originalColor:'#000000'});
    assert.equal(sent[0].model,'flux-3-image');
    await renderer({baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',guides,originalColor:'#000000'});
    assert.equal(sent[4].model,'gpt-image-2.5-flare');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('unconfigured mockup model cannot be selected',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-model-selection-reject-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'gpt-image-2.5-flare',mockupModels:['gpt-image-2.5-flare'],endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
    const renderer=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async()=>Response.json({data:[{url:'https://getapib.org/f/mockup.png'}]})});
    await assert.rejects(()=>renderer({model:'flux-3-image',baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',guides,originalColor:'#000000'}),/未配置|不可用|model/i);
  }finally{await rm(dir,{recursive:true,force:true});}
});
