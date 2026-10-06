const PRINT_REALISM_COMMON=`
[LOGO 印刷工艺真实上样｜高保真强制约束]
以 Image 2 作为唯一产品、包装、构图、摄影光线和材质基准。任务是把 Image 1 的完整 Logo 真实印刷或烫印到指定表面；这不是 Logo 贴图、颜色替换或后期覆盖。最终必须像已经实际生产完成的包装产品，再在专业商业摄影棚中拍摄：physically plausible printed packaging photographed with a real camera，而不是 digital logo composited onto a product photo。

产品与构图锁定：不得改变产品数量、尺寸、比例、位置、方向、包装结构、包装颜色、原有版式、原有文字、原有图案、装饰元素、摄影机角度、镜头焦段感、透视、裁切、背景、阴影、高光、环境光、原始材质、表面粗糙度以及软管、塑料或纸盒原本形态。仅允许修改 Logo 对应的真实印刷区域及印刷工艺自然产生的局部光学效果。禁止重新设计包装、重新生成产品、改变产品造型或为了展示 Logo 改变光线方向。

Logo 几何与保真：完整保留字体、字符比例、字距、图形、图标、标志结构、长宽比例、字符位置关系、内部镂空和整体轮廓。不得重绘、改字、换字体、增加描边、修改字距、拉伸、压缩、缺字、多字或创造新设计。Logo 只可跟随真实透视与曲率产生极轻微几何变化；弧形软管或圆柱表面允许边缘因曲率产生轻微透视压缩，但不得改变原始设计比例。

材质融合：Logo 必须与基材发生真实物理互动，不得表现为平面覆盖、UI 图层、贴纸、数字水印、Photoshop 文字或完全均匀的纯色区域。纸盒彩盒要继承纸张微细纤维、涂层、压纹、纸张颗粒和局部粗糙度；塑料或亚克力要继承光滑反射、表面高光、曲面变化和半光泽反射；软管要跟随曲率、高光和材质粗糙度，不得悬浮。近距离可有极轻微真实印刷边缘和材料纹理，但保持高级、干净的商业印刷品质。

光线互动：Logo 不得拥有独立光源，必须遵循 Image 2 的主光、补光、阴影、环境光和高光位置。阴影区的 Logo 同步变暗，高光区同步受光；金属箔可形成更强、更窄、跟随曲率变化的镜面亮带。禁止新增灯光、轮廓光、发光效果或改变整体曝光。

真实摄影一致性：Logo 与所在产品表面的锐度、噪点、清晰度、色温、透视和景深必须一致；焦点区域保持清晰，轻微失焦区域同步产生同等失焦。不得出现锐度不一致、噪点不一致、清晰度不一致、光线不一致、色温不一致、透视不一致或景深不一致。

REFLECTION CALIBRATION: Use restrained low-gloss surface reflection for ordinary printed ink. For gold or silver foil, use low-intensity, soft and continuous surface reflection caused only by the existing scene light and the local surface normal. The reflection must follow the flat plane, tube curvature or other real substrate geometry. No sharp internal highlight bands, no alternating white/gray segments inside letters, no per-letter independent lighting, no chrome, mirror finish, or hard white streaks, no bevel highlights, and no 3D metallic gradient. Keep the logo color or foil tone visually dense and continuous; material response may gently modulate brightness but must never make the logo look like a chrome decal.

ABSOLUTELY NO: flat color replacement, flat logo overlay, floating logo, sticker-like logo, Photoshop text overlay, digital watermark appearance, uniform metallic color, flat yellow gold, flat gray silver, artificial or fake metallic gradient, glowing logo, glitter, thick metal letters, 3D extrusion, oversized embossing, unrealistic bevel, excessive texture, dirty printing, damaged foil, cracked foil, peeling foil, random scratches, added lighting, modified packaging, redesigned typography, changed logo, distorted product, changed composition.

最终视觉判断：普通消费者必须认为 Logo 本来就印在真实生产的包装上，而不是后来用 Photoshop 放上去。`;

const PRINT_FINISH={
  ORIGINAL:`使用原始 Logo 色彩，表现为极薄的真实商业包装印刷墨层。必须有极轻微油墨厚度与颗粒、真实印刷边缘、底材纹理轻微透出、墨层与包材自然融合；局部高光经过 Logo 时自然变化，阴影区自然变暗，高光区自然变亮。颜色不可绝对均匀，应存在非常细微的明暗、墨层密度、表面反射和材质纹理变化，但不得制造脏污或明显缺陷。目标：高品质真实印刷，而不是数字纯色填充。`,
  BLACK:`使用真实黑色包装印刷油墨，不是纯 RGB 黑色覆盖。表现为 high-quality black ink printing on packaging material：极薄墨层、轻微油墨吸收、极轻微半哑光或半光泽变化、非绝对均匀黑色、底材纹理轻微透出、自然印刷边缘，并随曲率和摄影光线产生局部亮度与反射变化。高光位置仅可出现柔和、极窄、低强度反光；阴影位置自然变暗。禁止纯黑平面、塑料黑贴纸、浮雕、3D 字、厚涂层或发光字。必须是 thin printed black ink integrated into the packaging surface.`,
  'GOLD FOIL':`使用真实商业包装热压烫金工艺，不是黄色文字、金黄色油墨或金色渐变。必须是 very thin metallic hot-stamped gold foil physically bonded to the packaging surface。箔层极薄，无明显厚度、浮雕或 3D 凸起；具有真实方向性镜面反射。同一 Logo 内必须自然同时出现明亮金色高光、柔和金色中间调、深金色暗部、局部棕金色反射暗面、极细窄镜面亮带和非均匀金属反射。不同字母与笔画因表面角度和受光方向产生轻微亮度差异；曲面上的反射亮带必须跟随曲率。允许极细微 foil grain、metallic micro-texture、stamping texture 和 subtle foil irregularity，但禁止生锈、破损、剥落、粗糙、廉价亮片感、flat yellow text、yellow ink、matte yellow、uniform gold、gold gradient graphic、glowing gold、glitter、thick metallic lettering 或 3D embossed letters。最终必须像真实奢侈品彩妆包装上的薄层烫金。`,
  'SILVER FOIL':`使用真实银色金属热压箔工艺，不是浅灰、白字或灰色油墨。必须是 thin reflective metallic silver hot-stamped foil。银箔需有真实金属镜面反射；同一 Logo 内自然存在高亮银白、中性银灰、深灰金属反射、局部近黑灰镜面暗部和极窄明亮反射带。不同区域必须因灯位、包装曲率、表面方向和环境反射产生不同亮度；高光区可接近高亮银白，偏离反射角的位置可明显变暗。允许极轻微 metallic micro grain、foil stamping texture、fine directional reflection 和 microscopic metallic surface variation，但整体必须干净、精致、商业级、高端。禁止 flat gray、light gray text、white text、matte silver paint、chrome 3D lettering、glitter、thick metal logo 或 floating metallic sticker。`
};

const PRINT_PROCESS={
  ORIGINAL:`PRINT PROCESS: high-quality spot-color ink printing. The logo is printed directly onto the packaging using a thin, professional cosmetic-packaging ink layer. Preserve subtle substrate texture beneath the ink. The printed color must not be perfectly flat or digitally uniform, but it must retain its original hue, chroma and saturation. Show extremely subtle natural density variation and realistic interaction with the existing highlights and shadows. The logo follows the exact curvature of the plastic tube and the micro-texture of the paper carton. It must look like factory-printed packaging, not digitally recolored typography.`,
  BLACK:`PRINT PROCESS: matte black screen printing / pad printing. The logo is printed using real dense black cosmetic-packaging ink. The black ink is not a perfectly uniform digital black: it has subtle ink density variation caused by the substrate texture. The ink slightly absorbs light but still inherits the soft specular reflections and surface curvature of the tube underneath. On the paper carton, preserve subtle paper grain through the printed area. On the plastic tube, the black print follows the curved surface naturally, with slightly different brightness across the logo according to the existing lighting. The print must look physically bonded to the packaging, not pasted on top of it. No glossy black sticker. No pure RGB black fill. No floating text.`,
  'GOLD FOIL':`PRINT PROCESS: real hot foil stamping using a very thin metallic gold foil. The logo is NOT yellow ink. It is a microscopically thin metallic foil layer physically bonded to the packaging surface. The gold foil must show physically realistic metallic reflection: narrow bright specular highlights, warm metallic midtones, darker bronze-gold areas away from the light, and subtle reflection changes across different surface angles. The foil reflection follows the existing studio light direction and the curvature of the plastic tube. On the carton, the foil inherits very subtle paper micro-texture while remaining clearly metallic. Some portions may appear bright champagne gold, some medium gold, and some darker muted gold depending on the viewing angle. Keep the foil extremely thin and flush with the packaging surface. No raised 3D metal letters. No yellow flat fill. No orange gradient. No glitter. No glowing gold. No mirror-like chrome.`,
  'SILVER FOIL':`PRINT PROCESS: real silver hot foil stamping. The logo is NOT light gray ink. Use a microscopically thin silver metallic foil physically bonded to the packaging surface. The foil must show realistic metallic silver reflections, including bright near-white highlights, neutral silver midtones, and darker graphite-gray reflective areas depending on surface angle. The reflection pattern responds to the existing studio lighting and follows the curvature of the tube. Do not make the entire logo equally bright. Different parts of the letters should reflect different amounts of light, creating subtle silver highlight bands and darker reflected regions. On the paper carton, retain subtle substrate texture beneath the foil. The silver foil remains extremely thin and flush with the packaging. No gray flat fill. No white logo. No matte silver paint. No chrome 3D letters. No artificial glow.`
};

const VARIANTS=[
  {version:'ORIGINAL',instruction:()=>`Apply the complete logo in each exact base color shown in Image 3; retain the separate color assigned to every placement. Preserve the original hue, chroma, saturation and ink density. Do not wash out, bleach, desaturate, fade or reduce opacity. The original logo color must remain visibly colored and dense; natural surface reflection may modulate brightness, but must not replace the logo color with white, gray or a pale translucent overlay. Make it real printed ink rather than a flat digital color, with subtle surface-aware gloss and material response only. ${PRINT_PROCESS.ORIGINAL} ${PRINT_FINISH.ORIGINAL}`},
  {version:'BLACK',instruction:()=>`Apply the complete logo as pure black (#000000) dense opaque black ink with a rich black core, printed by silk-screen on light surfaces; on dark surfaces use a dense opaque pure-white reverse logo (#FFFFFF) exactly as shown in Image 2. Do not make the black logo gray, faded, translucent or low-contrast. Preserve strong ink coverage and clean color density; let the existing surface reflection create narrow directional highlights and local light variation without bleaching the ink. The logo must remain visually black or white, not washed out. No decorative gradient, embossing, bevel, or 3D thickness. ${PRINT_PROCESS.BLACK} ${PRINT_FINISH.BLACK}`},
  {version:'GOLD FOIL',instruction:()=>`Apply the complete logo as thin gold foil, not yellow ink. Use fine metallic micro-grain and restrained specular light behavior that varies across individual glyphs according to the local surface angle and the existing scene lighting; retain darker gold regions where the reflection falls away. No embossing, bevel, or 3D thickness. ${PRINT_PROCESS['GOLD FOIL']} ${PRINT_FINISH['GOLD FOIL']}`},
  {version:'SILVER FOIL',instruction:()=>`Apply the complete logo as thin silver foil, not gray ink. Use fine metallic micro-grain and restrained cool silver highlights with darker gray-silver regions that vary across individual glyphs according to the local surface angle and the existing scene lighting. No embossing, bevel, or 3D thickness. ${PRINT_PROCESS['SILVER FOIL']} ${PRINT_FINISH['SILVER FOIL']}`}
];

const SIZES=['1:1','16:9','9:16','4:3','3:4','3:2','2:3','4:5','5:4','2:1','1:2','21:9'];
const asDataUrl=value=>typeof value==='string'&&value.startsWith('data:image/')?value:null;

function color(value){
  const result=String(value||'').trim().replace(/^#/,'').toUpperCase();
  if(!/^[0-9A-F]{6}$/.test(result))throw Error('ORIGINAL Logo 颜色必须是 6 位十六进制颜色');
  return result;
}

function placementGeometry(targets){
  const records=(Array.isArray(targets)?targets:[]).map(target=>{
    const percent=value=>`${(Number(value||0)*100).toFixed(1)}%`;
    const base=`${String(target?.id||'logo')}: center ${percent(target?.x)}, ${percent(target?.y)}; width ${percent(target?.widthRatio)}; rotation ${Number(target?.rotation||0).toFixed(1)}°`;
    const quad=Array.isArray(target?.quad)&&target.quad.length===4?`; quad ${target.quad.map(point=>`(${percent(point?.x)},${percent(point?.y)})`).join(' ')}`:'';
    return base+quad;
  });
  return records.length?` Manual placement geometry (do not reinterpret it): ${records.join(' | ')}.`:'';
}

function promptFor(variant,{compositionMaster=false,targets,finishReference=false}={}){
  const master=compositionMaster?'Image 2 is the approved ORIGINAL composition master. Do not change any non-logo pixel from it.':'Image 2 is the pixel-locked product and packaging master image.';
  const reference=finishReference?' Image 4 is a real printing or foil material reference. Borrow only its optical ink or foil behavior; do not copy its product, text, logo or composition.':'';
  const placementLock=` HARD GEOMETRIC PLACEMENT CONSTRAINT: Image 3 is the visual registration stencil. Match its exact logo center, scale, 2D orientation, rotation, perspective and deformation. The numeric rotation is an absolute clockwise angle in image coordinates, not a suggestion. Do not rotate, mirror, straighten, or re-center, reflow, or align the logo to the product axis. If Image 3 and any natural-language interpretation conflict, Image 3 and the supplied placement geometry win. When four corner coordinates are supplied, those four corner coordinates are authoritative for the logo plane; do not reinterpret them as a loose bounding box.`;
  return `Image 1 is the only logo source. ${master} Image 3 is the exact placement, perspective, color and finish reference produced from the user's manual positioning.${placementLock}${reference}${placementGeometry(targets)} Preserve Image 2 completely: product count, shape, packaging text, artwork, structure, seams, edges, camera angle, crop, perspective, background, lighting, highlights and shadows. The result must be pixel-identical to Image 2 outside the logo application areas. Do not add, remove, clean up, move, redesign, sharpen or rewrite anything except the logo application. Use Image 3 only to determine logo placement, size, rotation, surface perspective, per-placement color and finish; never copy guide artifacts, labels or borders. Do not reproduce the raster edge, flat fill or shading of Image 3: render the final logo pixels afresh from Image 1. The logo is a locked source asset: preserve every letter, glyph, mark, spacing, proportion and edge exactly; preserve holes and internal cutouts exactly. Do not redraw, re-typeset, stretch, crop, simplify or invent any part of the logo. ${PRINT_REALISM_COMMON} CURRENT VERSION ONLY: ${variant.instruction()} IMPORTANT PHYSICAL CONSTRAINT: Do not render the logo as a separate graphic layer. The logo material must share the exact surface geometry, surface normals, perspective, deformation, lighting direction and occlusion of the underlying packaging. All highlights and reflections must be caused by the original scene lighting and the substrate surface normal. Do not add a new light source specifically to illuminate the logo. Integrate Image 1 as a natural printed or foil surface treatment that follows the surface perspective shown in Image 3, with surface-aware ink absorption, restrained edge softness, natural printed surface gloss and subtle material reflection aligned to Image 2 lighting. Never render the logo as a flat vector fill: the microtexture of the substrate must remain subtly visible through the finish, while the logo edges stay crisp at normal viewing distance. No pasted rectangle, sticker effect, floating overlay, excessive shadow, glow, embossing or 3D thickness. Output one clean product image only, with no labels, captions, borders, collage, watermark or extra elements.`;
}

export function pickAspectRatio(width,height){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('原图尺寸无效');
  const ratio=width/height;
  return SIZES.reduce((best,size)=>Math.abs(Number(size.split(':')[0])/Number(size.split(':')[1])-ratio)<Math.abs(Number(best.split(':')[0])/Number(best.split(':')[1])-ratio)?size:best,SIZES[0]);
}

export function buildAiMockupPlan({model,baseImage,compositionMaster,logoImage,finishReferenceImage,guides,targets,originalColor,onlyVersion,size='1:1'}={}){
  if(typeof model!=='string'||!model.trim())throw Error('缺少 AI 图片模型');
  if(!asDataUrl(baseImage))throw Error('缺少产品/彩盒原图');
  if(!asDataUrl(logoImage))throw Error('缺少透明 Logo 原图');
  if(!SIZES.includes(size))throw Error('AI 成图比例无效');
  color(originalColor);
  if(finishReferenceImage&&!asDataUrl(finishReferenceImage))throw Error('工艺参考图无效');
  const guideByVersion=new Map((Array.isArray(guides)?guides:[]).map(item=>[item?.version,item?.dataUrl]));
  if(onlyVersion!==undefined&&!VARIANTS.some(variant=>variant.version===onlyVersion))throw Error('无效的重新生成版本');
  return VARIANTS.filter(variant=>onlyVersion===undefined||variant.version===onlyVersion).map(variant=>{
    const guide=asDataUrl(guideByVersion.get(variant.version));
    if(!guide)throw Error(`缺少 ${variant.version} 的定位参考图`);
    const useCompositionMaster=variant.version!=='ORIGINAL'&&Boolean(asDataUrl(compositionMaster));
    const finishReference=asDataUrl(finishReferenceImage);
    return {version:variant.version,request:{model:model.trim(),n:1,size,resolution:'2K',prompt:promptFor(variant,{compositionMaster:useCompositionMaster,targets,finishReference:Boolean(finishReference)}),image_urls:[logoImage,useCompositionMaster?compositionMaster:baseImage,guide,...(finishReference?[finishReference]:[])]}};
  });
}
