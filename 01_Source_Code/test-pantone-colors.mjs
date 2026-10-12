import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pantoneColors,findPantoneColors,normalizePantoneCode,rgbToHex,validatePantoneColors} from './pantone-colors.mjs';

test('潘通数据包含 PDF 中的标准色号和 RGB',()=>{
 const result=findPantoneColors(pantoneColors,'186 C');
 assert.equal(result.length,1);
 assert.deepEqual(result[0].rgb,[200,16,46]);
 assert.equal(result[0].hex,'#C8102E');
});

test('潘通色号查询会统一前缀、大小写和 C/U 间距',()=>{
 assert.equal(normalizePantoneCode(' pantone 126c '),'PANTONE 126 C');
 assert.equal(findPantoneColors(pantoneColors,'PANTONE 100 U')[0].hex,'#FEF380');
});

test('RGB 转 HEX 使用两位大写十六进制',()=>{
 assert.equal(rgbToHex([0,16,255]),'#0010FF');
});

test('数据没有缺失 RGB、越界 RGB 或未说明的重复冲突',()=>{
 const report=validatePantoneColors(pantoneColors);
 assert.deepEqual(report,{count:4780,invalid:0,duplicateCodes:18,ambiguousCodes:18});
});
