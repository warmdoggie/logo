import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {detectPlaceholders,matchPlaceholderWords} from './ocr.mjs';

test('OCR matches only explicit placeholder phrases and keeps captions and real brands',()=>{
  const word=(text,x)=>({text,confidence:90,bbox:{x0:x,y0:10,x1:x+40,y1:30}});
  const found=matchPlaceholderWords([word('YOUR',10),word('LOGO',60),word('Weight:',160),word('41g',210),word('ACME',300),word('LOGO',350)],500,100,0,500,100);
  assert.equal(found.length,1);assert.equal(found[0].text,'YOUR LOGO');
  assert.ok(found[0].x<.03&&found[0].x+found[0].width<.21);
  assert.equal(matchPlaceholderWords([word('Custom',0),word('Information',50)],500,100,0,500,100).length,0);
});

test('the supplied metallic product photo finds all five placeholders without net weight or swatches',async()=>{
  const regions=await detectPlaceholders(await readFile(new URL('./fixtures/placeholder-products.jpg',import.meta.url)));
  assert.equal(regions.length,5);
  assert.ok(regions.every(region=>region.y>.3&&region.y+region.height<.76));
});

test('real OCR locates horizontal and vertical placeholders without selecting weight labels',async()=>{
  const source=await sharp(Buffer.from('<svg width="600" height="460"><rect width="600" height="460" fill="white"/><text x="30" y="80" font-family="Arial" font-size="32" fill="black">YOUR LOGO</text><text x="30" y="150" font-family="Arial" font-size="28">Weight: 41g</text><g transform="translate(450,210) rotate(90)"><text x="0" y="0" font-family="Arial" font-size="32">Private Label</text></g></svg>')).png().toBuffer();
  const regions=await detectPlaceholders(source);
  assert.ok(regions.some(region=>region.x<.1&&region.y<.2&&region.width>.2));
  assert.ok(regions.some(region=>region.x>.6&&region.height>.2));
  assert.ok(regions.every(region=>!(region.y>.23&&region.y<.38)));
});

test('white lettering on all four pink product tubes is detected with tight separate regions',async()=>{
  const regions=await detectPlaceholders(await readFile(new URL('./fixtures/pink-lipsticks.png',import.meta.url)));
  assert.equal(regions.length,4);
  for(const center of [.355,.467,.577,.692]){
    const region=regions.find(region=>region.x<center&&region.x+region.width>center);
    assert.ok(region,`missing tube at ${center}`);
    assert.ok(region.width<.08,'a text region must not cross onto the neighboring tube');
    assert.ok(region.y<.52&&region.y>.48&&region.y+region.height>.79&&region.y+region.height<.83);
  }
});
