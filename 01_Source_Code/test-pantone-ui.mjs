import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePantoneSearch,searchPantoneColors,formatPantoneRgb,formatPantoneNote} from './public/pantone-ui.js';

const colors=[
 {code:'PANTONE 186 C',label:'PANTONE 186 C',rgb:[200,16,46],hex:'#C8102E'},
 {code:'PANTONE MAGENTA',label:'PANTONE Magenta',rgb:[241,178,220],hex:'#F1B2DC',ambiguous:true,variant:1},
 {code:'PANTONE MAGENTA',label:'PANTONE Magenta',rgb:[248,170,221],hex:'#F8AADD',ambiguous:true,variant:2}
];

test('Pantone 查询输入统一为可匹配的标准格式',()=>{
 assert.equal(normalizePantoneSearch(' pantone 186c '),'PANTONE 186 C');
 assert.equal(normalizePantoneSearch('126C'),'PANTONE 126 C');
});

test('精确色号优先返回，未标注版本完整保留',()=>{
 assert.deepEqual(searchPantoneColors(colors,'magenta').map(c=>c.variant),[1,2]);
 assert.equal(searchPantoneColors(colors,'186 c')[0].hex,'#C8102E');
});

test('查询结果可生成 RGB 展示和备注文本',()=>{
 const color=colors[0];
 assert.equal(formatPantoneRgb(color.rgb),'RGB 200, 16, 46');
 assert.equal(formatPantoneNote(color),'PANTONE 186 C · RGB 200, 16, 46 · HEX #C8102E');
});
