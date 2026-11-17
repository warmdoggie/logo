import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createSchemes,editScheme,ensureMixedSchemes} from './schemes.mjs';

const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
function workspace(){
  const listeners={},rows=[],addButton={},state=createSchemes([{id:'master',x:.5,y:.5,widthRatio:.2},{id:'added',x:.6,y:.5,widthRatio:.2}]);
  const c=vm.createContext({selectedTargetId:'added',selectedTargetIds:new Set(['added']),schemeState:state,activeScheme:'ORIGINAL',placementScope:'current',dragTarget:null,
    generationBusy:false,generationSubmitting:false,multiPackageBusy:false,copyingProductPreset:false,logoSelectionBusy:false,imagePreview:{hidden:true},
    targets:{get children(){return rows;},get firstElementChild(){return rows[0];},get lastElementChild(){return rows.at(-1);}},document:{addEventListener:(name,handler)=>listeners[name]=handler,querySelector:selector=>selector==='#add-target'?addButton:null},
    refreshTargetSelection(){for(const id of c.selectedTargetIds)if(!rows.some(row=>row.dataset.targetId===id))c.selectedTargetIds.delete(id);},
    drawPreview(){c.schemeState=editScheme(c.schemeState,c.activeScheme,rows.map(row=>({id:row.dataset.targetId,x:.5,y:.5,widthRatio:.2})),false);},setStatus(){},closeImagePreview(){},
  });
  function row(id,locked=false){
    const button={disabled:locked,click(){if(!this.disabled)this.onclick({stopPropagation(){}});}};
    const item={dataset:{targetId:id},querySelector:()=>button,remove(){rows.splice(rows.indexOf(item),1);}};
    rows.push(item);c.row=item;
    const start=source.indexOf("  row.querySelector('.remove-target').onclick=");
    vm.runInContext(source.slice(start,source.indexOf('\n',start)),c);
    return item;
  }
  row('master',true);row('added');
  vm.runInContext(source.slice(source.indexOf('function isTargetSelected('),source.indexOf('function selectedHandleAt(')),c);
  const start=source.indexOf("document.addEventListener('keydown',event=>{");
  vm.runInContext(source.slice(start,source.indexOf('\nasync function showGenerationSubmission(',start)),c);
  const press=(options={})=>{const event={key:'Backspace',target:{closest:()=>null},prevented:false,preventDefault(){this.prevented=true;},...options};listeners.keydown(event);return event;};
  return {c,rows,row,press,addButton};
}

test('Backspace removes the selected added Logo from the draft and every scheme',()=>{
  const {c,rows,press}=workspace(),event=press();
  assert.equal(event.prevented,true);assert.deepEqual(rows.map(row=>row.dataset.targetId),['master']);
  for(const scheme of c.schemeState.schemes)assert.deepEqual(scheme.targets.map(target=>target.id),['master']);
  assert.deepEqual(c.schemeState.sharedTargets.map(target=>target.id),['master']);
  const next=ensureMixedSchemes(c.schemeState,['MIX_GOLD_ORIGINAL']);assert.deepEqual(next.schemes.at(-1).targets.map(target=>target.id),['master']);
});

test('Backspace deletes selected manual copies together while protecting the master Logo',()=>{
  const {c,rows,row,press}=workspace();row('added-2');c.selectedTargetIds=new Set(['master','added','added-2']);
  press();assert.deepEqual(rows.map(row=>row.dataset.targetId),['master']);
});

for(const options of [
  {target:{closest:()=>({})}}, {repeat:true}, {isComposing:true}, {ctrlKey:true}, {metaKey:true}, {altKey:true}, {defaultPrevented:true}
])test(`Backspace preserves Logos during text editing or another keyboard operation: ${Object.keys(options)[0]}`,()=>{
  const {rows,press}=workspace();assert.equal(press(options).prevented,false);assert.equal(rows.length,2);
});

test('Backspace leaves master selections, active gestures, image previews and generation alone',()=>{
  for(const state of [{selectedTargetId:'master',selectedTargetIds:new Set(['master'])},{dragTarget:{}},{imagePreview:{hidden:false}},{generationBusy:true},{generationSubmitting:true},{multiPackageBusy:true},{copyingProductPreset:true},{logoSelectionBusy:true}]){
    const {c,rows,press}=workspace();Object.assign(c,state);assert.equal(press().prevented,false);assert.equal(rows.length,2);
  }
});

test('clicking Add Target selects the new copy so Backspace immediately undoes the accidental addition',()=>{
  const {c,rows,row,press,addButton}=workspace();c.selectedTargetId='master';c.selectedTargetIds=new Set(['master']);c.addTarget=()=>row('just-added');
  const start=source.indexOf("document.querySelector('#add-target').onclick=");vm.runInContext(source.slice(start,source.indexOf('\n',start)),c);
  addButton.onclick();assert.equal(c.selectedTargetId,'just-added');press();assert.equal(rows.some(row=>row.dataset.targetId==='just-added'),false);
});
