import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlacementHistory} from './target-state.mjs';
import {createSchemes,ensureMixedSchemes,editScheme} from './schemes.mjs';

const initial=()=>createSchemes([{id:'logo',x:.5,y:.5,widthRatio:.2,rotation:0,quad:[{x:.4,y:.4},{x:.6,y:.4},{x:.6,y:.6},{x:.4,y:.6}],color:'#112233'}]);
function turn(state,rotation){const next=structuredClone(state);for(const targets of [next.sharedTargets,...next.schemes.map(s=>s.targets)])Object.assign(targets[0],{rotation,x:.6,widthRatio:.15,quad:undefined});return next;}

test('undo restores the last three placements, including fitted size and perspective',()=>{
 const history=createPlacementHistory();let state=initial();
 for(const angle of [30,60,90,120]){const next=turn(state,angle);history.record('product/logo',state,next);state=next;}
 for(const angle of [90,60,30]){state=history.undo('product/logo',state);assert.equal(state.schemes[0].targets[0].rotation,angle);}
 assert.equal(history.canUndo('product/logo'),false);assert.equal(history.undo('product/logo',state),null);
 const before=initial(),after=turn(before,45);history.record('product/logo',before,after);
 after.schemes[0].targets[0].color='#ABCDEF';
 const restored=history.undo('product/logo',after);
 assert.equal(restored.schemes[0].targets[0].color,'#ABCDEF');
 assert.equal(restored.sharedTargets[0].x,.5);assert.equal(restored.sharedTargets[0].widthRatio,.2);
 assert.deepEqual(restored.schemes[0].targets[0].quad,[{x:.4,y:.4},{x:.6,y:.4},{x:.6,y:.6},{x:.4,y:.6}]);
});

test('selection-only and unchanged gestures do not consume an undo step',()=>{
 const history=createPlacementHistory(),before=initial(),after=turn(before,45);
 history.record('a',before,after);
 const recolored=structuredClone(after);recolored.schemes[0].targets[0].color='#FF0000';
 history.record('a',after,recolored);
 assert.equal(history.undo('a',recolored).schemes[0].targets[0].rotation,0);
 assert.equal(history.canUndo('a'),false);
});

test('changing product or Logo clears history and never applies another context placement',()=>{
 const history=createPlacementHistory(),before=initial();history.record('a/logo1',before,turn(before,45));
 assert.equal(history.canUndo('a/logo2'),false);assert.equal(history.undo('a/logo2',before),null);
 assert.equal(history.canUndo('a/logo1'),false);
});

test('undo snapshots are isolated and new edits after undo retain earlier steps',()=>{
 const history=createPlacementHistory(),before=initial(),after=turn(before,45);
 history.record('a',before,after);before.schemes[0].targets[0].rotation=170;
 const next=turn(after,90);history.record('a',after,next);
 const restored=history.undo('a',next),edited=turn(restored,60);history.record('a',restored,edited);
 assert.equal(history.undo('a',edited).schemes[0].targets[0].rotation,45);
 assert.equal(history.undo('a',restored).schemes[0].targets[0].rotation,0);
});

test('a shared scheme added after a move cannot propagate the undone placement back',()=>{
 const history=createPlacementHistory(),before=initial(),after=turn(before,45);history.record('a',before,after);
 const expanded=ensureMixedSchemes(after,['MIX_ORIGINAL_SILVER']);
 const restored=history.undo('a',expanded),active=restored.schemes.find(s=>s.version==='MIX_ORIGINAL_SILVER');
 assert.equal(active.targets[0].x,.5);assert.equal(active.targets[0].rotation,0);
 const synced=editScheme(restored,active.version,active.targets,true);
 assert.equal(synced.sharedTargets[0].x,.5);
 assert.equal(synced.schemes[0].targets[0].rotation,0);
});
