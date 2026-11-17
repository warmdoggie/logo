import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {buildProductCategories,categoryFields,bindCategoryFields} from './public/product-categories.js';

const source=await readFile(new URL('./public/app.js',import.meta.url),'utf8');
const products=[
 {id:'one',sku:'F001',name:'产品一',category:'脸部',subcategory:'腮红',status:'ACTIVE'},
 {id:'two',sku:'F002',name:'产品二',category:'脸部',subcategory:'腮红',status:'ACTIVE'},
 {id:'three',sku:'L001',name:'产品三',category:'唇部',subcategory:'唇蜜',status:'INACTIVE'}
];
function workspace(){
 let nodes=new Map(),markup='';const scrolls=[];
 function element(tagName='DIV',value=''){
  let html='';return {tagName,value,textContent:'',insertAdjacentHTML(){},get innerHTML(){return html;},set innerHTML(next){html=next;if(tagName==='SELECT')this.value='';}};
 }
 const breadcrumb=element(),main={querySelector:selector=>nodes.get(selector),get innerHTML(){return markup;},set innerHTML(html){
  markup=html;nodes=new Map();
  if(html.includes('id="catalog"'))for(const [id,tag,value] of [['catalog-category','SELECT',''],['catalog-subcategory','SELECT',''],['product-state','SELECT','ACTIVE'],['product-search','INPUT',''],['product-count','DIV',''],['catalog','DIV','']])nodes.set('#'+id,element(tag,value));
 }};
 const c=vm.createContext({main,buildProductCategories,categoryFields,bindCategoryFields,routeVersion:0,objectUrls:[],canEditProducts:true,
  location:{hash:'#/products'},window:{scrollY:0,scrollTo(_x,y){this.scrollY=y;scrolls.push(y);}},
  document:{querySelector:selector=>selector==='#breadcrumb'?breadcrumb:nodes.get(selector),querySelectorAll:()=>[]},URL:{revokeObjectURL(){}},
  api:async()=>structuredClone(products),heading:()=>'',card:product=>`<article>${product.sku}</article>`,esc:value=>value,toast(){},
  leaveTemplate:()=>true,leaveLogo:()=>true,leaveWorkspace:async()=>true,leaveBatch(){},renderTemplate:async()=>{main.innerHTML='template editor';}
 });
 vm.runInContext(source.slice(source.indexOf('function empty('),source.indexOf('async function renderLogoLibrary(')),c);
 vm.runInContext(source.slice(source.indexOf('async function route(){'),source.indexOf("document.addEventListener('click'")),c);
 return {c,scrolls,control:id=>nodes.get('#'+id),async go(hash){c.location.hash=hash;await c.route();}};
}

test('returning from a product template retains category, search, status and list scroll',async()=>{
 const {c,control,go}=workspace();await go('#/products');
 control('catalog-category').value='脸部';control('catalog-category').onchange();
 control('catalog-subcategory').value='腮红';control('catalog-subcategory').onchange();
 control('product-state').value='ALL';control('product-state').onchange();
 control('product-search').value='F002';control('product-search').oninput({target:control('product-search')});
 c.window.scrollY=1280;await go('#/templates/two');assert.equal(c.window.scrollY,0);
 c.window.scrollY=350;await go('#/products');
 assert.equal(control('catalog-category').value,'脸部');assert.equal(control('catalog-subcategory').value,'腮红');
 assert.equal(control('product-state').value,'ALL');assert.equal(control('product-search').value,'F002');
 assert.equal(control('catalog').innerHTML,'<article>F002</article>');assert.equal(c.window.scrollY,1280);
});

test('repeated edit and return cycles remember the most recent list position',async()=>{
 const {c,go}=workspace();await go('#/products');assert.equal(c.window.scrollY,0);
 c.window.scrollY=1800;await go('#/templates/one');await go('#/products');assert.equal(c.window.scrollY,1800);
 c.window.scrollY=2400;await go('#/templates/two');await go('#/products');assert.equal(c.window.scrollY,2400);
});

test('cancelling navigation keeps the product list and its current position',async()=>{
 const {c,control,go}=workspace();await go('#/products');c.window.scrollY=900;
 c.leaveWorkspace=async()=>false;await go('#/templates/two');
 assert.equal(c.window.scrollY,900);assert.ok(control('catalog'));
 c.leaveWorkspace=async()=>true;await go('#/templates/two');await go('#/products');assert.equal(c.window.scrollY,900);
});

test('visiting an embedded module cannot overwrite the saved catalog scroll on return',async()=>{
 const {c,go}=workspace();await go('#/products');c.window.scrollY=1750;
 c.document.body={classList:{toggle(){}}};c.setS7ModuleActive=()=>{};c.renderS7Module=()=>{};
 vm.runInContext(source.slice(source.indexOf('function renderS7IfRequested(){'),source.indexOf('const esc=')),c);
 c.location.hash='#/modules/s7-logo-stability';assert.equal(c.renderS7IfRequested(),true);
 c.window.scrollY=250;await go('#/products');assert.equal(c.window.scrollY,1750);
});

test('a delayed catalog response after switching modules cannot replace the saved position',async()=>{
 const {c,go}=workspace();await go('#/products');c.window.scrollY=1750;await go('#/templates/two');
 const pending=Promise.withResolvers(),requested=Promise.withResolvers(),api=c.api;c.api=()=>{requested.resolve();return pending.promise;};
 const returning=go('#/products');await requested.promise;
 c.document.body={classList:{toggle(){}}};c.setS7ModuleActive=()=>{};c.renderS7Module=()=>{};
 vm.runInContext(source.slice(source.indexOf('function renderS7IfRequested(){'),source.indexOf('const esc=')),c);
 c.location.hash='#/modules/s7-logo-stability';c.renderS7IfRequested();
 pending.resolve(structuredClone(products));await returning;
 c.window.scrollY=250;c.api=api;await go('#/products');assert.equal(c.window.scrollY,1750);
});
