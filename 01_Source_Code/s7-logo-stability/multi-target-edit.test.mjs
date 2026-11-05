import test from 'node:test';
import assert from 'node:assert/strict';
import * as schemes from './schemes.mjs';
const target=(id,carrierType='BODY')=>({id,carrierType,x:.5,y:.5,widthRatio:.12,rotation:0,color:'#000000'});

test('同类多选大小角度只影响选中区域，同步当前 SKU 的五个版本并保留各自颜色位置',()=>{
  assert.equal(typeof schemes.editSelectedLogos,'function');
  const state=schemes.createSchemes([target('p1'),target('p2'),target('front','CARTON_FRONT'),target('back','CARTON_BACK'),target('extra','CARTON_FRONT')]);
  state.schemes[2].independentGeometry=true;state.schemes[2].targets[2].x=.3;
  const before=structuredClone(state),result=schemes.editSelectedLogos(state,'CUSTOM',['p1','p2','front','back'],'carton',{widthRatio:.2,rotation:30});
  for(let index=0;index<5;index++){
    for(const id of ['front','back']){
      const previous=before.schemes[index].targets.find(t=>t.id===id),actual=result.schemes[index].targets.find(t=>t.id===id);
      assert.deepEqual(actual,{...previous,widthRatio:.2,rotation:30});
    }
    for(const id of ['p1','p2','extra'])assert.deepEqual(result.schemes[index].targets.find(t=>t.id===id),before.schemes[index].targets.find(t=>t.id===id));
  }
  assert.equal(result.sharedTargets[2].widthRatio,.2);assert.equal(result.sharedTargets[3].rotation,30);
  assert.deepEqual(state,before);
});

test('自定义批量颜色仅修改选中同类，其他类别、未选区域及预设版本保持原值',()=>{
  assert.equal(typeof schemes.editSelectedLogos,'function');
  const state=schemes.createSchemes([target('p1'),target('front','CARTON_FRONT'),target('back','CARTON_BACK'),target('extra','CARTON_FRONT')]);
  const before=structuredClone(state),result=schemes.editSelectedLogos(state,'CUSTOM',['p1','front','back'],'carton',{color:'#FF0000'});
  assert.deepEqual(result.schemes[4].targets.map(t=>t.color),['#000000','#FF0000','#FF0000','#000000']);
  assert.deepEqual(result.schemes.slice(0,4),before.schemes.slice(0,4));
  assert.deepEqual(result.sharedTargets,before.sharedTargets);
  for(const version of ['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL'])assert.throws(()=>schemes.editSelectedLogos(state,version,['front'],'carton',{color:'#FF0000'}),/固定/);
});

test('批量变换四点区域时围绕各自中心旋转缩放，越界时不修改任何版本',()=>{
  assert.equal(typeof schemes.editSelectedLogos,'function');
  const state=schemes.createSchemes([{...target('quad'),quad:[{x:.4,y:.45},{x:.6,y:.45},{x:.6,y:.55},{x:.4,y:.55}],widthRatio:.2}]);
  const before=structuredClone(state),result=schemes.editSelectedLogos(state,'ORIGINAL',['quad'],'product',{widthRatio:.4,rotation:90});
  assert.deepEqual(result.schemes[0].targets[0].quad,[{x:.6,y:.3},{x:.6,y:.7},{x:.4,y:.7},{x:.4,y:.3}]);
  assert.deepEqual(state,before);
  assert.throws(()=>schemes.editSelectedLogos(state,'ORIGINAL',['quad'],'product',{widthRatio:2}),/大小/);
  const edge=schemes.createSchemes([{...target('edge'),x:.9,quad:[{x:.8,y:.45},{x:1,y:.45},{x:1,y:.55},{x:.8,y:.55}],widthRatio:.2}]);
  assert.throws(()=>schemes.editSelectedLogos(edge,'ORIGINAL',['edge'],'product',{widthRatio:.4}),/超出/);
});

test('长方形原图中的四点 Logo 按实际像素旋转，不改变形状比例',()=>{
  const state=schemes.createSchemes([{...target('quad'),widthRatio:.2,quad:[{x:.4,y:.4},{x:.6,y:.4},{x:.6,y:.6},{x:.4,y:.6}]}]);
  const result=schemes.editSelectedLogos(state,'CUSTOM',['quad'],'product',{rotation:90},{width:200,height:100,logoAspect:.5});
  for(const scheme of result.schemes)assert.deepEqual(scheme.targets[0].quad,[{x:.55,y:.3},{x:.55,y:.7},{x:.45,y:.7},{x:.45,y:.3}]);
});
