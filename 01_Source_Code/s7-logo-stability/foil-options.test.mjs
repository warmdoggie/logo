import test from 'node:test';
import assert from 'node:assert/strict';
import * as selection from './foil-selection.mjs';
import {mixedVersion} from './generation-versions.mjs';

const versions=['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL','CUSTOM','ROSE GOLD FOIL','LASER FOIL'];
const master=(finishes=[])=>({zones:[{id:'body',zoneType:'logo'},{id:'carton',zoneType:'logo'}],automation:{carriers:[{id:'p',type:'BODY'},{id:'c',type:'CARTON'}],areas:[{zoneId:'body',carrierId:'p',foilProcesses:finishes},{zoneId:'carton',carrierId:'c'}]}});

test('默认保留三种普通方案，只有主动启用的烫印方案追加到右侧',()=>{
 assert.deepEqual(selection.visibleSchemeVersions?.(versions,['ORIGINAL','BLACK']),['ORIGINAL','BLACK','CUSTOM']);
 assert.deepEqual(selection.visibleSchemeVersions?.(versions,['ORIGINAL','SILVER FOIL']),['ORIGINAL','BLACK','CUSTOM','SILVER FOIL']);
});
test('取消新烫印选项后仍能找到已有成图及失败方案',()=>{
 assert.deepEqual(selection.visibleSchemeVersions?.(versions,[],[{version:'GOLD FOIL',dataUrl:'/gold.png'}],{'LASER FOIL':{stage:'failed'}}),['ORIGINAL','BLACK','CUSTOM','GOLD FOIL','LASER FOIL']);
});
test('产品仅开放每个已选母版均允许的工艺，禁止的工艺不能勾选',()=>{
 assert.deepEqual(selection.allowedFoilVersions?.([master(['GOLD FOIL','SILVER FOIL'])],['product']),['GOLD FOIL','SILVER FOIL']);
 assert.deepEqual(selection.allowedFoilVersions?.([master(['GOLD FOIL','SILVER FOIL']),master(['SILVER FOIL'])],['product']),['SILVER FOIL']);
 assert.deepEqual(selection.allowedFoilVersions?.([master()],['product']),[]);
});
test('彩盒可主动选四种烫印，包含不支持的产品时不能借彩盒放行',()=>{
 assert.deepEqual(selection.allowedFoilVersions?.([master()],['carton']),['GOLD FOIL','SILVER FOIL','ROSE GOLD FOIL','LASER FOIL']);
 assert.deepEqual(selection.allowedFoilVersions?.([master()],['product','carton']),[]);
 assert.deepEqual(selection.allowedFoilVersions?.([master()],[]),[]);
});
test('母版加载前及缺少对应区域时不开放烫印，兼容旧 zoneIndex 区域',()=>{
 assert.deepEqual(selection.allowedFoilVersions?.([],['product']),[]);
 assert.deepEqual(selection.allowedFoilVersions?.([undefined],['carton']),[]);
 const legacy=master(['GOLD FOIL']);legacy.automation.areas[0].zoneIndex=0;delete legacy.automation.areas[0].zoneId;
 assert.deepEqual(selection.allowedFoilVersions?.([legacy],['product']),['GOLD FOIL']);
 legacy.zones=legacy.zones.slice(0,1);
 assert.deepEqual(selection.allowedFoilVersions?.([legacy],['carton']),[]);
});

test('新增搭配保留产品和彩盒各自工艺，不受旧全局烫印区域覆盖',()=>{
 const targets=[{id:'body',carrierType:'BODY',printFinish:'GOLD FOIL'},{id:'box',carrierType:'CARTON_FRONT',printFinish:'SILVER FOIL'}],version=mixedVersion('GOLD FOIL','SILVER FOIL');
 assert.deepEqual(selection.applyFoilSelection(targets,[{version,targets}],[]).schemes[0].targets,targets);
});
test('新增搭配只检查实际请求烫印的载体，普通印刷不被产品烫印禁令挡住',()=>{
 assert.equal(selection.canSelectMixedVersion?.([master()],mixedVersion('ORIGINAL','GOLD FOIL')),true);
 assert.equal(selection.canSelectMixedVersion?.([master()],mixedVersion('GOLD FOIL','ORIGINAL')),false);
});
