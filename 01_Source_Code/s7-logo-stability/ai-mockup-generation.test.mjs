import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildAiMockupPlan} from './ai-mockup-generation.mjs';

test('四个AI上样版本使用锁定原图和对应定位参考图',()=>{
  const plan=buildAiMockupPlan({
    model:'gpt-image-2',
    baseImage:'data:image/png;base64,BASE',
    logoImage:'data:image/png;base64,LOGO',
    guides:[
      {version:'ORIGINAL',dataUrl:'data:image/png;base64,GUIDE_ORIGINAL'},
      {version:'BLACK',dataUrl:'data:image/png;base64,GUIDE_BLACK'},
      {version:'GOLD FOIL',dataUrl:'data:image/png;base64,GUIDE_GOLD'},
      {version:'SILVER FOIL',dataUrl:'data:image/png;base64,GUIDE_SILVER'}
    ],
    originalColor:'#C54B78'
  });
  assert.deepEqual(plan.map(item=>item.version),['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL']);
  assert.deepEqual(plan[0].request.image_urls,['data:image/png;base64,LOGO','data:image/png;base64,BASE','data:image/png;base64,GUIDE_ORIGINAL']);
  assert.equal(plan[0].request.size,'1:1');
  assert.equal(plan[0].request.resolution,'2K');
  assert.match(plan[0].request.prompt,/Image 1 is the only logo source/i);
  assert.match(plan[0].request.prompt,/Image 2 is the pixel-locked product/i);
  assert.match(plan[0].request.prompt,/Image 3 is the exact placement/i);
  assert.match(plan[0].request.prompt,/each exact base color shown in Image 3/i);
  assert.match(plan[0].request.prompt,/pixel-identical to Image 2 outside the logo application areas/i);
  assert.match(plan[0].request.prompt,/preserve every letter, glyph, mark, spacing, proportion and edge exactly/i);
  assert.match(plan[0].request.prompt,/natural printed surface gloss and subtle material reflection/i);
  assert.match(plan[0].request.prompt,/never render the logo as a flat vector fill/i);
  assert.match(plan[0].request.prompt,/microtexture of the substrate must remain subtly visible/i);
  assert.match(plan[1].request.prompt,/pure black/i);
  assert.match(plan[1].request.prompt,/pure-white reverse logo/i);
  assert.match(plan[2].request.prompt,/thin gold foil/i);
  assert.match(plan[2].request.prompt,/varies across individual glyphs/i);
  assert.match(plan[3].request.prompt,/thin silver foil/i);
  assert.match(plan[0].request.prompt,/physically plausible printed packaging photographed with a real camera/i);
  assert.match(plan[0].request.prompt,/锐度不一致/);
  assert.match(plan[0].request.prompt,/高品质真实印刷，而不是数字纯色填充/);
  assert.match(plan[1].request.prompt,/thin printed black ink integrated into the packaging surface/i);
  assert.match(plan[2].request.prompt,/very thin metallic hot-stamped gold foil physically bonded to the packaging surface/i);
  assert.doesNotMatch(plan[2].request.prompt,/thin reflective metallic silver hot-stamped foil/i);
  assert.match(plan[3].request.prompt,/thin reflective metallic silver hot-stamped foil/i);
  assert.doesNotMatch(plan[3].request.prompt,/very thin metallic hot-stamped gold foil physically bonded/i);
});

test('derived finishes use the ORIGINAL composition master while keeping their own guide',()=>{
  const plan=buildAiMockupPlan({
    model:'gpt-image-2',
    baseImage:'data:image/png;base64,BASE',
    compositionMaster:'data:image/png;base64,ORIGINAL_MASTER',
    logoImage:'data:image/png;base64,LOGO',
    guides:[
      {version:'ORIGINAL',dataUrl:'data:image/png;base64,GUIDE_ORIGINAL'},
      {version:'BLACK',dataUrl:'data:image/png;base64,GUIDE_BLACK'},
      {version:'GOLD FOIL',dataUrl:'data:image/png;base64,GUIDE_GOLD'},
      {version:'SILVER FOIL',dataUrl:'data:image/png;base64,GUIDE_SILVER'}
    ],
    originalColor:'#C54B78'
  });
  assert.equal(plan[0].request.image_urls[1],'data:image/png;base64,BASE');
  assert.deepEqual(plan[1].request.image_urls,['data:image/png;base64,LOGO','data:image/png;base64,ORIGINAL_MASTER','data:image/png;base64,GUIDE_BLACK']);
  assert.match(plan[1].request.prompt,/ORIGINAL composition master/i);
  assert.match(plan[1].request.prompt,/do not reproduce the raster edge, flat fill or shading of Image 3/i);
});

test('manual placement geometry is stated in the model prompt',()=>{
  const plan=buildAiMockupPlan({
    model:'gpt-image-2',baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',
    guides:[
      {version:'ORIGINAL',dataUrl:'data:image/png;base64,GUIDE_ORIGINAL'},
      {version:'BLACK',dataUrl:'data:image/png;base64,GUIDE_BLACK'},
      {version:'GOLD FOIL',dataUrl:'data:image/png;base64,GUIDE_GOLD'},
      {version:'SILVER FOIL',dataUrl:'data:image/png;base64,GUIDE_SILVER'}
    ],
    targets:[{id:'tube',x:0.35,y:0.64,widthRatio:0.22,rotation:37,quad:[{x:0.2,y:0.5},{x:0.4,y:0.45},{x:0.45,y:0.7},{x:0.25,y:0.75}]}],
    originalColor:'#C54B78'
  });
  assert.match(plan[0].request.prompt,/Manual placement geometry/i);
  assert.match(plan[0].request.prompt,/tube: center 35.0%, 64.0%; width 22.0%; rotation 37.0/i);
  assert.match(plan[0].request.prompt,/quad \(20.0%,50.0%\)/i);
});

test('an optional real print reference is passed to the model as a material-only reference',()=>{
  const plan=buildAiMockupPlan({
    model:'gpt-image-2',baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',finishReferenceImage:'data:image/png;base64,FOIL_SAMPLE',
    guides:[
      {version:'ORIGINAL',dataUrl:'data:image/png;base64,GUIDE_ORIGINAL'},
      {version:'BLACK',dataUrl:'data:image/png;base64,GUIDE_BLACK'},
      {version:'GOLD FOIL',dataUrl:'data:image/png;base64,GUIDE_GOLD'},
      {version:'SILVER FOIL',dataUrl:'data:image/png;base64,GUIDE_SILVER'}
    ],originalColor:'#C54B78'
  });
  assert.deepEqual(plan[2].request.image_urls,['data:image/png;base64,LOGO','data:image/png;base64,BASE','data:image/png;base64,GUIDE_GOLD','data:image/png;base64,FOIL_SAMPLE']);
  assert.match(plan[2].request.prompt,/Image 4 is a real printing or foil material reference/i);
  assert.match(plan[2].request.prompt,/do not copy its product, text, logo or composition/i);
});

test('ORIGINAL and BLACK keep dense print color while adding only surface-aware reflection',()=>{
  const plan=buildAiMockupPlan({
    model:'gpt-image-2',baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',
    guides:[
      {version:'ORIGINAL',dataUrl:'data:image/png;base64,GUIDE_ORIGINAL'},
      {version:'BLACK',dataUrl:'data:image/png;base64,GUIDE_BLACK'},
      {version:'GOLD FOIL',dataUrl:'data:image/png;base64,GUIDE_GOLD'},
      {version:'SILVER FOIL',dataUrl:'data:image/png;base64,GUIDE_SILVER'}
    ],originalColor:'#2F6FD6'
  });
  assert.match(plan[0].request.prompt,/preserve the original hue, chroma, saturation and ink density/i);
  assert.match(plan[0].request.prompt,/do not wash out, bleach, desaturate, fade or reduce opacity/i);
  assert.match(plan[0].request.prompt,/reflection may modulate brightness, but must not replace the logo color/i);
  assert.match(plan[1].request.prompt,/dense opaque black ink with a rich black core/i);
  assert.match(plan[1].request.prompt,/do not make the black logo gray, faded, translucent or low-contrast/i);
  assert.match(plan[1].request.prompt,/narrow directional highlights/i);
});

test('manual angle is a hard placement lock and each finish uses an explicit print process',()=>{
  const plan=buildAiMockupPlan({
    model:'gpt-image-2',baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',
    guides:[
      {version:'ORIGINAL',dataUrl:'data:image/png;base64,GUIDE_ORIGINAL'},
      {version:'BLACK',dataUrl:'data:image/png;base64,GUIDE_BLACK'},
      {version:'GOLD FOIL',dataUrl:'data:image/png;base64,GUIDE_GOLD'},
      {version:'SILVER FOIL',dataUrl:'data:image/png;base64,GUIDE_SILVER'}
    ],targets:[{id:'tube',x:.35,y:.64,widthRatio:.22,rotation:37,quad:[{x:.2,y:.5},{x:.4,y:.45},{x:.45,y:.7},{x:.25,y:.75}]}],originalColor:'#2F6FD6'
  });
  assert.match(plan[0].request.prompt,/hard geometric placement constraint/i);
  assert.match(plan[0].request.prompt,/do not rotate, mirror, straighten, or re-center/i);
  assert.match(plan[0].request.prompt,/four corner coordinates are authoritative/i);
  assert.match(plan[1].request.prompt,/PRINT PROCESS: matte black screen printing \/ pad printing/i);
  assert.match(plan[0].request.prompt,/PRINT PROCESS: high-quality spot-color ink printing/i);
  assert.match(plan[2].request.prompt,/PRINT PROCESS: real hot foil stamping/i);
  assert.match(plan[3].request.prompt,/PRINT PROCESS: real silver hot foil stamping/i);
});

test('metallic print reflection stays soft and surface-driven rather than chrome-like',()=>{
  const plan=buildAiMockupPlan({
    model:'gpt-image-2',baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',
    guides:[
      {version:'ORIGINAL',dataUrl:'data:image/png;base64,GUIDE_ORIGINAL'},
      {version:'BLACK',dataUrl:'data:image/png;base64,GUIDE_BLACK'},
      {version:'GOLD FOIL',dataUrl:'data:image/png;base64,GUIDE_GOLD'},
      {version:'SILVER FOIL',dataUrl:'data:image/png;base64,GUIDE_SILVER'}
    ],originalColor:'#2F6FD6'
  });
  assert.match(plan[0].request.prompt,/restrained low-gloss surface reflection/i);
  assert.match(plan[2].request.prompt,/low-intensity, soft and continuous surface reflection/i);
  assert.match(plan[2].request.prompt,/no sharp internal highlight bands/i);
  assert.match(plan[3].request.prompt,/no alternating white\/gray segments inside letters/i);
  assert.match(plan[3].request.prompt,/no chrome, mirror finish, or hard white streaks/i);
});

test('onlyVersion builds a request for one selected finish',()=>{
  const plan=buildAiMockupPlan({
    model:'gpt-image-2.5-flare',baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',onlyVersion:'GOLD FOIL',
    guides:[
      {version:'ORIGINAL',dataUrl:'data:image/png;base64,GUIDE_ORIGINAL'},
      {version:'BLACK',dataUrl:'data:image/png;base64,GUIDE_BLACK'},
      {version:'GOLD FOIL',dataUrl:'data:image/png;base64,GUIDE_GOLD'},
      {version:'SILVER FOIL',dataUrl:'data:image/png;base64,GUIDE_SILVER'}
    ],originalColor:'#2F6FD6'
  });
  assert.deepEqual(plan.map(item=>item.version),['GOLD FOIL']);
});
