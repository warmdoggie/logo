import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {renderLogoSet} from './index.mjs';
import {prepareGenerationImage} from './prepared-generation.mjs';
import {createSchemes} from './schemes.mjs';

test('只准备勾选的方案，已选图片的像素和布局保持一致',async()=>{
 const baseImage=await sharp({create:{width:80,height:80,channels:4,background:'#ddd'}}).png().toBuffer(),logoImage=await sharp({create:{width:8,height:4,channels:4,background:'#456'}}).png().toBuffer();
 const targets=[{id:'body',x:.5,y:.5,widthRatio:.2}],schemes=createSchemes(targets).schemes,input={baseImage,logoImage,targets,schemes};
 const full=await renderLogoSet(input),selected=await renderLogoSet({...input,selectedVersions:['ORIGINAL','BLACK']});
 assert.deepEqual(selected.outputs.map(output=>output.version),['ORIGINAL','BLACK']);
 for(const output of selected.outputs){const previous=full.outputs.find(item=>item.version===output.version);assert.deepEqual(output.bytes,previous.bytes);assert.deepEqual(output.bounds,previous.bounds);}
 schemes[2].targets[0].x=0;
 const prepared=await prepareGenerationImage({...input,model:'local',selectedVersions:['ORIGINAL','BLACK']});
 assert.deepEqual(prepared.input.guides.map(guide=>guide.version),['ORIGINAL','BLACK']);
 await assert.rejects(renderLogoSet({...input,selectedVersions:[]}),/有效.*版本/);
});
