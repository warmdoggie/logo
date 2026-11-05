import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mountFoilConfirmation} from './foil-confirmation.mjs';

function fixture(){
 const controls=Object.fromEntries(['title','messages','cancel','continue'].map(key=>[key,{}]));
 const dialog={querySelector:selector=>controls[selector.replace('[data-foil-','').replace(']','')],showModal(){this.open=true;},close(){this.open=false;}};
 return {dialog,controls,confirm:mountFoilConfirmation(dialog)};
}
test('产品硬阻止不显示继续按钮，调用继续处理也无法放行',async()=>{
 const {controls,confirm}=fixture(),pending=confirm({blocked:[{message:'产品禁止烫印'}],warnings:[{message:'彩盒不建议'}]});
 assert.equal(controls.continue.hidden,true);controls.continue.onclick();assert.equal(await pending,false);
});
test('仅彩盒警告可以明确知晓继续，也可以取消',async()=>{
 const {controls,confirm}=fixture();
 let pending=confirm({blocked:[],warnings:[{message:'彩盒不建议'}]});assert.equal(controls.continue.hidden,false);controls.cancel.onclick();assert.equal(await pending,false);
 pending=confirm({blocked:[],warnings:[{message:'彩盒不建议'}]});controls.continue.onclick();assert.equal(await pending,true);
});
