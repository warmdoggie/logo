import assert from 'node:assert/strict';
import test from 'node:test';
import {buildProductCategories} from './01_Source_Code/public/product-categories.js';

test('产品分类提供四个大类及对应细类',()=>{
 const categories=buildProductCategories();
 assert.deepEqual(Object.keys(categories),['唇部','脸部','身体','眼部']);
 assert.ok(categories['唇部'].includes('唇蜜'));
 assert.ok(categories['脸部'].includes('腮红'));
 assert.ok(categories['身体'].includes('身体乳'));
 assert.ok(categories['眼部'].includes('眉胶'));
});

test('已保存的自定义细类只加入所属大类，旧分类仍可筛选',()=>{
 const categories=buildProductCategories([{category:'脸部',subcategory:'珠光液'},{category:'脸部',subcategory:'珠光液'},{category:'旧分类',subcategory:''}]);
 assert.equal(categories['脸部'].filter(value=>value==='珠光液').length,1);
 assert.ok(!categories['唇部'].includes('珠光液'));
 assert.deepEqual(categories['旧分类'],[]);
 assert.ok(!buildProductCategories()['脸部'].includes('珠光液'));
});
