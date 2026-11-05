import {schemeTargets} from './schemes.mjs';
import {selectGenerationVersions} from './generation-versions.mjs';
import {resolveTargetPrint} from './target-print.mjs';
const PRINT_REALISM_COMMON=`
[LOGO 印刷工艺真实上样｜高保真强制约束]
以 Image 2 作为唯一产品、包装、构图、摄影光线和材质基准。任务是把 Image 1 的完整 Logo 真实印刷或烫印到指定表面；这不是 Logo 贴图、颜色替换或后期覆盖。最终必须像已经实际生产完成的包装产品，再在专业商业摄影棚中拍摄：physically plausible printed packaging photographed with a real camera，而不是 digital logo composited onto a product photo。

产品与构图锁定：不得改变产品数量、尺寸、比例、位置、方向、包装结构、包装颜色、原有版式、原有文字、原有图案、装饰元素、摄影机角度、镜头焦段感、透视、裁切、背景、阴影、高光、环境光、原始材质、表面粗糙度以及软管、塑料或纸盒原本形态。仅允许修改 Logo 对应的真实印刷区域及印刷工艺自然产生的局部光学效果。禁止重新设计包装、重新生成产品、改变产品造型或为了展示 Logo 改变光线方向。

Logo 几何与保真：完整保留字体、字符比例、字距、图形、图标、标志结构、长宽比例、字符位置关系、内部镂空和整体轮廓。不得重绘、改字、换字体、增加描边、修改字距、拉伸、压缩、缺字、多字或创造新设计。Logo 只可跟随真实透视与曲率产生极轻微几何变化；弧形软管或圆柱表面允许边缘因曲率产生轻微透视压缩，但不得改变原始设计比例。

材质融合：Logo 必须与基材发生真实物理互动，不得表现为平面覆盖、UI 图层、贴纸、数字水印、Photoshop 文字或完全均匀的纯色区域。纸盒彩盒要继承纸张微细纤维、涂层、压纹、纸张颗粒和局部粗糙度；塑料或亚克力要继承光滑反射、表面高光、曲面变化和半光泽反射；软管要跟随曲率、高光和材质粗糙度，不得悬浮。近距离可有极轻微真实印刷边缘和材料纹理，但保持高级、干净的商业印刷品质。

光线互动：Logo 不得拥有独立光源，必须遵循 Image 2 的主光、补光、阴影、环境光和高光位置。阴影区的 Logo 同步变暗，高光区同步受光；金属箔可形成更强、更窄、跟随曲率变化的镜面亮带。禁止新增灯光、轮廓光、发光效果或改变整体曝光。

真实摄影一致性：Logo 与所在产品表面的锐度、噪点、清晰度、色温、透视和景深必须一致；焦点区域保持清晰，轻微失焦区域同步产生同等失焦。不得出现锐度不一致、噪点不一致、清晰度不一致、光线不一致、色温不一致、透视不一致或景深不一致。

REFLECTION CALIBRATION: Use restrained low-gloss surface reflection for ordinary printed ink. For gold, silver, rose gold or laser holographic foil, use clear but controlled directional metallic reflections caused by the existing scene light and local surface normal. Follow the flat plane, tube curvature or other real substrate geometry. Hot stamping should appear nearly flush with the package. Suggest the press only through extremely fine foil grain. Silver must show subtle foil thickness: a microscopic material layer bonded onto the package, with a fine light-facing edge and a restrained darker opposite edge. Keep this relief subpixel-thin, without a broad bevel, conspicuous raised lettering or cast shadow. No per-letter independent lighting, chrome mirror finish, hard white streaks, or 3D metallic gradient. Keep the logo color or foil tone visually dense and continuous; material response may gently modulate brightness but must never make the logo look like a chrome decal.

ABSOLUTELY NO: flat color replacement, flat logo overlay, floating logo, sticker-like logo, Photoshop text overlay, digital watermark appearance, uniform metallic color, flat yellow gold, flat gray silver, artificial or fake metallic gradient, glowing logo, glitter, thick metal letters, 3D extrusion, deep or oversized embossing, exaggerated bevel, excessive texture, dirty printing, damaged foil, cracked foil, peeling foil, random scratches, added lighting, modified packaging, redesigned typography, changed logo, distorted product, changed composition.

最终视觉判断：普通消费者必须认为 Logo 本来就印在真实生产的包装上，而不是后来用 Photoshop 放上去。`;

const PRINT_FINISH={
  ORIGINAL:`使用原始 Logo 色彩，表现为极薄的真实商业包装印刷墨层。必须有极轻微油墨厚度与颗粒、真实印刷边缘、底材纹理轻微透出、墨层与包材自然融合；局部高光经过 Logo 时自然变化，阴影区自然变暗，高光区自然变亮。颜色不可绝对均匀，应存在非常细微的明暗、墨层密度、表面反射和材质纹理变化，但不得制造脏污或明显缺陷。目标：高品质真实印刷，而不是数字纯色填充。`,
  BLACK:`使用真实黑色包装印刷油墨，不是纯 RGB 黑色覆盖。表现为 high-quality black ink printing on packaging material：极薄墨层、轻微油墨吸收、极轻微半哑光或半光泽变化、非绝对均匀黑色、底材纹理轻微透出、自然印刷边缘，并随曲率和摄影光线产生局部亮度与反射变化。高光位置仅可出现柔和、极窄、低强度反光；阴影位置自然变暗。禁止纯黑平面、塑料黑贴纸、浮雕、3D 字、厚涂层或发光字。必须是 thin printed black ink integrated into the packaging surface.`,
  'GOLD FOIL':`使用真实商业包装热压烫金工艺，不是黄色文字、金黄色油墨或金色渐变。必须是 very thin metallic hot-stamped gold foil physically bonded to the packaging surface。金属箔层极薄并几乎与包装表面齐平。只在近看时呈现细微箔面颗粒和几乎不可察觉的压印边缘变化；正视时不应看到明显高低差、斜面亮边或投影。金箔具有随包装平面、曲率和现有灯光连续变化的方向性金属反射。同一 Logo 内必须自然同时出现明亮金色高光、柔和金色中间调、深金色暗部、局部棕金色反射暗面、极细窄镜面亮带和非均匀金属反射。不同字母与笔画因表面角度和受光方向产生轻微亮度差异；曲面上的反射亮带必须跟随曲率。允许极细微 foil grain、metallic micro-texture、stamping texture 和 subtle foil irregularity，但禁止生锈、破损、剥落、粗糙、廉价亮片感、深浮雕、厚重凸字、夸张斜面或悬浮阴影、flat yellow text、yellow ink、matte yellow、uniform gold、gold gradient graphic、glowing gold、glitter、thick metallic lettering、deep embossed letters 或 3D extrusion。最终必须像真实奢侈品彩妆包装上的极薄、近乎平面的烫金，仅近看可察觉箔面颗粒。`,
  'SILVER FOIL':`使用真实银色金属热压箔工艺，不是浅灰、白字或灰色油墨。必须是 thin reflective metallic silver hot-stamped foil。银箔需有真实金属反射，同时保持极薄并几乎与包装表面齐平。只保留近看才可察觉的箔面细纹；银箔是覆盖在原包材上的极薄新材料层，保留轻微可感知的薄箔厚度，朝光侧有极细亮面、背光侧有克制暗面，仅在字形内侧边缘表现轻微厚度，禁止宽亮边、深暗边、斜面或立体轮廓；不出现明显高低差、斜面亮边或接触投影。同一 Logo 内保留有细节的银白高光、中性银灰和较深的银灰反射，亮暗连续变化，避免近黑镜面暗部。不同区域必须因灯位、包装曲率、表面方向和环境反射产生不同亮度；高光区可接近高亮银白，偏离反射角的位置可明显变暗。At normal viewing size, make the silver foil visibly metallic with a broad, gentle silver-white reflection that transitions smoothly into neutral silver midtones with only subpixel-thin edge shading. Let this tonal range vary naturally across adjacent glyph strokes and follow the existing light, local surface angle and packaging curvature. Keep the silver finish opaque, crisp and legible against the package; do not wash it out into pale gray or white ink. The reflection must remain continuous and controlled, never becoming harsh segmented bands or mirror chrome. Retain silver-white highlights with fine detail and deeper neutral-silver reflections. Vary the density of microscopic foil grain and tiny reflected flecks; do not substitute uniform digital noise or a matte gray fill. 允许极轻微 metallic micro grain、foil stamping texture、fine directional reflection 和 microscopic metallic surface variation，但整体必须干净、精致、商业级、高端。禁止 flat gray、light gray text、white text、matte silver paint、chrome 3D lettering、深浮雕、厚重凸字、夸张斜面、悬浮阴影、glitter、thick metal logo 或 floating metallic sticker。`
};

const PRINT_PROCESS={
  ORIGINAL:`PRINT PROCESS: high-quality spot-color ink printing. The logo is printed directly onto the packaging using a thin, professional cosmetic-packaging ink layer. Preserve subtle substrate texture beneath the ink. The printed color must not be perfectly flat or digitally uniform, but it must retain its original hue, chroma and saturation. Show extremely subtle natural density variation and realistic interaction with the existing highlights and shadows. The logo follows the exact curvature of the plastic tube and the micro-texture of the paper carton. It must look like factory-printed packaging, not digitally recolored typography.`,
  BLACK:`PRINT PROCESS: matte black screen printing / pad printing. The logo is printed using real dense black cosmetic-packaging ink. The black ink is not a perfectly uniform digital black: it has subtle ink density variation caused by the substrate texture. The ink slightly absorbs light but still inherits the soft specular reflections and surface curvature of the tube underneath. On the paper carton, preserve subtle paper grain through the printed area. On the plastic tube, the black print follows the curved surface naturally, with slightly different brightness across the logo according to the existing lighting. The print must look physically bonded to the packaging, not pasted on top of it. No glossy black sticker. No pure RGB black fill. No floating text.`,
  'GOLD FOIL':`PRINT PROCESS: real hot foil stamping using a very thin metallic gold foil. The logo is NOT yellow ink. It is a microscopically thin metallic foil layer physically bonded to the packaging surface. The gold foil must show physically realistic metallic reflection: narrow bright specular highlights, warm metallic midtones, darker bronze-gold areas away from the light, and subtle reflection changes across different surface angles. The foil reflection follows the existing studio light direction and the curvature of the plastic tube. On this permitted target, the foil inherits very subtle substrate micro-texture while remaining clearly metallic. Some portions may appear bright champagne gold, some medium gold, and some darker muted gold depending on the viewing angle. Keep the foil material extremely thin and bonded to the packaging. The foil remains nearly flush with the package. At close inspection only, show minute foil grain and an almost imperceptible pressure trace at the exact logo edge; no visible raised height, bevel highlight or contact shadow. No yellow flat fill. No orange gradient. No glitter. No glowing gold. No mirror-like chrome.`,
  'SILVER FOIL':`PRINT PROCESS: real silver hot foil stamping. The logo is NOT light gray ink. Use a microscopically thin silver metallic foil physically bonded to the packaging surface. The foil must show realistic metallic silver reflections, including soft silver-white reflections and neutral silver midtones depending on surface angle, without extreme mirror contrast. The reflection pattern responds to the existing studio lighting and follows the curvature of the tube. Do not make the entire logo equally bright. Different parts of the letters should reflect different amounts of light, creating subtle silver highlight bands and darker reflected regions. On this permitted target, retain subtle substrate texture beneath the foil. Keep the silver foil physically thin and bonded to the packaging, with fine foil grain of varying density and only a hairline bonded rim inside the exact logo edge. Keep the surface nearly flat, with no conspicuous raised height, broad bevel highlight or cast shadow. No gray flat fill. No white logo. No matte silver paint. No chrome 3D letters. No artificial glow.`
};

const ADDITIONAL_FOIL_INSTRUCTIONS={
  'ROSE GOLD FOIL':`Apply the complete logo as real rose gold hot-stamped metallic foil. Use warm copper-pink reflections, soft blush-gold highlights and deeper rose-bronze midtones that follow the existing light and surface curvature. Keep the foil microscopically thin, bonded nearly flush to the substrate, with minute foil grain inside the exact source glyphs. No flat pink ink, glitter, glow, bevel, thick raised letters or external shadow.`,
  'LASER FOIL':`Apply the complete logo as real laser holographic hot-stamped foil. Use restrained angle-dependent spectral diffraction: continuous pale cyan, blue, violet, rose and champagne reflections that follow the existing scene light and target surface normal across the entire logo. Keep the metallic foil microscopically thin, bonded nearly flush with fine foil grain. Preserve all source holes and edges. No rainbow ink gradient, separate per-letter bands, glitter, glow, bevel, thick raised letters or external shadow.`
};

const VARIANTS=[
  {version:'ORIGINAL',instruction:()=>`Apply the complete logo in each exact base color shown in Image 3; retain the separate color assigned to every placement. Preserve the original hue, chroma, saturation and ink density. Do not wash out, bleach, desaturate, fade or reduce opacity. The original logo color must remain visibly colored and dense; natural surface reflection may modulate brightness, but must not replace the logo color with white, gray or a pale translucent overlay. Make it real printed ink rather than a flat digital color, with subtle surface-aware gloss and material response only. ${PRINT_PROCESS.ORIGINAL} ${PRINT_FINISH.ORIGINAL}`},
  {version:'BLACK',instruction:()=>`Apply the complete logo using pure black (#000000) pigment as dense opaque black ink with a rich black core and restrained low-gloss photographed reflections, printed by silk-screen on light surfaces; on dark surfaces use a dense opaque pure-white reverse logo (#FFFFFF) exactly as shown in Image 2. Do not make the black logo gray, faded, translucent or low-contrast. Preserve strong ink coverage and clean color density; let the existing surface reflection create narrow directional highlights and local light variation without bleaching the ink. The logo must remain visually black or white, not washed out. No decorative gradient, embossing, bevel, or 3D thickness. ${PRINT_PROCESS.BLACK} ${PRINT_FINISH.BLACK}`},
  {version:'GOLD FOIL',instruction:()=>`Apply the complete logo as thin gold foil, not yellow ink. Use fine metallic micro-grain on a nearly flat foil surface. Show only a barely perceptible stamping trace and minute tonal variation within the strokes; no visible raised height, bevel highlight, or cast shadow. Let warm gold reflection vary smoothly with the existing light and surface angle, without making the letters look extruded. ${PRINT_PROCESS['GOLD FOIL']} ${PRINT_FINISH['GOLD FOIL']}`},
  {version:'SILVER FOIL',instruction:()=>`Apply the complete logo as thin silver foil, not gray ink. Use fine metallic micro-grain on a nearly flat foil surface. Show only minute foil grain and gentle tonal variation within the strokes; subtle foil thickness, only a hairline bonded rim inside the strokes, no broad bevel highlight or cast shadow. Let neutral silver reflections vary smoothly with the existing light and surface angle, without making the letters look extruded. ${PRINT_PROCESS['SILVER FOIL']} ${PRINT_FINISH['SILVER FOIL']}`},
  {version:'CUSTOM',instruction:()=>`Apply the complete logo as ordinary nonmetallic ink in the exact custom color assigned to each product or carton target. Preserve each selected color; no automatic black-white substitution. ${PRINT_PROCESS.ORIGINAL} ${PRINT_FINISH.ORIGINAL}`},
  ...['ROSE GOLD FOIL','LASER FOIL'].map(version=>({version,instruction:()=>ADDITIONAL_FOIL_INSTRUCTIONS[version]}))
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

function targetPrintInstructions(variant,targets,originalColor,flux=false){
  if(!targets?.length)return flux?FLUX_FINISH_INSTRUCTIONS[variant.version]:variant.instruction();
  return `PER-TARGET PRINT RULES: Apply each instruction ONLY to its named target. The output version is not a global finish. Use foil on a product or carton target only when that target explicitly requests that foil finish. Targets fixed to ordinary ink must retain their selected colors in every output version, including BLACK and foil versions.\n`+targets.map(target=>{
    const print=resolveTargetPrint(target,variant.version,originalColor);
    const targetColor=print.version==='BLACK'&&target.autoContrast?'black or white from the placement guide':print.color||'source logo colors';
    const label=`Target ${JSON.stringify(target.id)}; carrier ${print.carrierType}; color ${targetColor}; finish ${print.version}: `;
    if(print.printFinish==='INK')return label+'ordinary ink only, thin nonmetallic printed ink with subtle substrate texture. Preserve the selected color exactly; no auto contrast, foil, metallic sheen, embossing or raised letters.';
    const selected=VARIANTS.find(item=>item.version===print.version);
    return label+(flux?FLUX_FINISH_INSTRUCTIONS[print.version]:selected.instruction());
  }).join('\n');
}

function promptFor(variant,{compositionMaster=false,targets,finishReference=false,originalColor}={}){
  const master=compositionMaster?'Image 2 is the approved ORIGINAL composition master. Do not change any non-logo pixel from it.':'Image 2 is the pixel-locked product and packaging master image.';
  const reference=finishReference?' Image 4 is a real printing or foil material reference. Borrow only its optical ink or foil behavior; do not copy its product, text, logo or composition.':'';
  const placementLock=` HARD GEOMETRIC PLACEMENT CONSTRAINT: Image 3 is the visual registration stencil. Match its exact logo center, scale, 2D orientation, rotation, perspective and deformation. The numeric rotation is an absolute clockwise angle in image coordinates, not a suggestion. Do not rotate, mirror, straighten, or re-center, reflow, or align the logo to the product axis. If Image 3 and any natural-language interpretation conflict, Image 3 and the supplied placement geometry win. When four corner coordinates are supplied, those four corner coordinates are authoritative for the logo plane; do not reinterpret them as a loose bounding box.`;
  return `Image 1 is the only logo source. ${master} Image 3 is the exact placement, perspective, color and finish reference produced from the user's manual positioning.${placementLock}${reference}${placementGeometry(targets)} Preserve Image 2 completely: product count, shape, packaging text, artwork, structure, seams, edges, camera angle, crop, perspective, background, lighting, highlights and shadows. The result must be pixel-identical to Image 2 outside the logo application areas. Do not add, remove, clean up, move, redesign, sharpen or rewrite anything except the logo application. Use Image 3 only to determine logo placement, size, rotation, surface perspective, per-placement color and finish; never copy guide artifacts, labels or borders. Do not reproduce the raster edge, flat fill or shading of Image 3: render the final logo pixels afresh from Image 1. The logo is a locked source asset: preserve every letter, glyph, mark, spacing, proportion and edge exactly; preserve holes and internal cutouts exactly. Do not redraw, re-typeset, stretch, crop, simplify or invent any part of the logo. ${PRINT_REALISM_COMMON} CURRENT VERSION ONLY: ${targetPrintInstructions(variant,targets,originalColor)} IMPORTANT PHYSICAL CONSTRAINT: Do not render the logo as a separate graphic layer. The logo material must share the exact surface geometry, surface normals, perspective, deformation, lighting direction and occlusion of the underlying packaging. All highlights and reflections must be caused by the original scene lighting and the substrate surface normal. Do not add a new light source specifically to illuminate the logo. Integrate Image 1 as a natural printed or foil surface treatment that follows the surface perspective shown in Image 3, with surface-aware ink absorption, restrained edge softness, natural printed surface gloss and subtle material reflection aligned to Image 2 lighting. Never render the logo as a flat vector fill: the microtexture of the substrate must remain subtly visible through the finish, while the logo edges stay crisp at normal viewing distance. No pasted rectangle, sticker effect, floating overlay, excessive shadow, glow, deep embossing, thick raised letters or 3D extrusion. Output one clean product image only, with no labels, captions, borders, collage, watermark or extra elements.`;
}

const FLUX_FINISH_INSTRUCTIONS={
  ...ADDITIONAL_FOIL_INSTRUCTIONS,
  CUSTOM:`Apply the complete source Logo as ordinary nonmetallic ink in the exact custom color assigned to each product or carton target. No automatic black-white substitution.`,
  ORIGINAL:`Apply the complete source Logo in its exact original color for every target. Keep the color dense, saturated and opaque. Add only subtle surface-aware printed-ink response from the existing light and substrate; do not bleach, fade, desaturate or replace the color.`,
  BLACK:`Apply the complete source Logo as dense opaque black ink on light surfaces, or dense opaque white ink only where the target surface is dark. Keep strong color coverage and clean letter edges. Add only restrained surface-aware ink response; no gray, faded, translucent, glossy sticker or 3D effect.`,
  'GOLD FOIL':`Apply the complete source Logo as real commercial gold hot-foil stamping physically bonded to the packaging. Show fine, low-amplitude nonuniform foil microtexture and minute substrate impressions within the solid strokes, with continuous warm gold midtones, soft champagne-gold specular reflections and richer bronze reflected shadows. Follow the existing scene light and target surface normal; reflections must flow across the whole logo and follow tube curvature rather than restarting on every letter. Keep the stamped foil nearly flush with the package. At close inspection only, allow fine foil grain and a barely perceptible pressure trace along the exact glyph edge; no visible raised height, bevel highlight or cast shadow. Keep the logo clean and legible, preserving every glyph and cutout exactly. Match the photographic sharpness and grain of the package. No flat yellow fill, glitter, colored sparkle, rainbow foil, glow, exaggerated bevel, thick raised metal lettering, external drop shadow or 3D extrusion.`,
  'SILVER FOIL':`Apply the complete source Logo as commercial silver hot-foil stamping. Keep the metallic foil layer physically thin and bonded to the package, with fine foil grain of varying density and subtle foil thickness within the exact logo strokes. Use a fine light-facing edge and a restrained darker opposite edge; allow only a hairline bonded rim inside the strokes, no broad bevel or dark extrusion. Keep the surface nearly flat, with no conspicuous raised height, broad bevel highlight or cast shadow; follow the package surface and existing light without making the letters look extruded. Use controlled neutral metallic reflection caused by the existing scene light and target surface normal. At normal viewing size, make the silver foil visibly metallic with a broad, gentle silver-white reflection that transitions smoothly into neutral silver midtones with only subpixel-thin edge shading. Let this tonal range vary naturally across adjacent glyph strokes and follow the existing light, local surface angle and packaging curvature. Keep the silver finish opaque, crisp and legible against the package; do not wash it out into pale gray or white ink. The reflection must remain continuous and controlled, never becoming harsh segmented bands or mirror chrome. Retain silver-white highlights with fine detail and deeper neutral-silver reflections. Vary the density of microscopic foil grain and tiny reflected flecks; do not substitute uniform digital noise or a matte gray fill. No gray flat fill, white ink, chrome, glitter, glow, exaggerated bevel, thick raised letters or 3D extrusion.`
};

function fluxCoordinate(value){return Math.round(Math.max(0,Math.min(1,Number(value)||0))*1000);}

function fluxTargetBox(target,logoAspectRatio=1){
  if(Array.isArray(target?.quad)&&target.quad.length===4){
    const xs=target.quad.map(point=>Number(point.x)),ys=target.quad.map(point=>Number(point.y));
    return [fluxCoordinate(Math.min(...ys)),fluxCoordinate(Math.min(...xs)),fluxCoordinate(Math.max(...ys)),fluxCoordinate(Math.max(...xs))];
  }
  const halfWidth=Math.max(0.01,Number(target?.widthRatio||0)/2),halfHeight=halfWidth*Math.max(.01,Number(logoAspectRatio)||1);
  return [fluxCoordinate((Number(target?.y)||0)-halfHeight),fluxCoordinate((Number(target?.x)||0)-halfWidth),fluxCoordinate((Number(target?.y)||0)+halfHeight),fluxCoordinate((Number(target?.x)||0)+halfWidth)];
}

function fluxTargetId(target,index){
  const value=String(target?.id||`target-${index+1}`).replace(/[^A-Za-z0-9_-]+/g,'_');
  return `logo_target_${value||index+1}`;
}

function fluxPromptFor(variant,{targets=[],logoAspectRatio=1,placementGuide=false,finishReference=false,originalColor='#000000'}={}){
  const placements=(Array.isArray(targets)?targets:[]).map((target,index)=>{
    const print=resolveTargetPrint(target,variant.version,originalColor);
    const id=fluxTargetId(target,index),bbox=fluxTargetBox(target,logoAspectRatio),rotation=Number(target?.rotation||0),targetColor=print.version==='ORIGINAL'&&target.preserveOriginalColor?'SOURCE_LOGO_COLORS':String(print.color||originalColor).trim().toUpperCase();
    const corners=Array.isArray(target?.quad)&&target.quad.length===4?` Exact perspective corners in normalized image coordinates: ${target.quad.map(point=>`[${fluxCoordinate(point.y)},${fluxCoordinate(point.x)}]`).join(' ')}.`:'';
    return {id,from:'ref_image_1',src_bbox:[0,0,1000,1000],tgt_bbox:bbox,color:print.version==='BLACK'&&target.autoContrast?undefined:targetColor,carrier:print.carrierType,print_finish:print.version,auto_contrast:print.version==='BLACK'&&target?.autoContrast===true,surface:String(target?.surface||'free'),curve:Number(target?.curve||0),rotation,desc:`<${id}> is the complete locked Logo from ref_image_1, applied to the packaging surface at the exact target location, rotation ${rotation.toFixed(1)} degrees clockwise, preserving every glyph, hole, proportion and spacing.${corners}`};
  });
  const layout=[{id:'packaging_master',from:'ref_image_0',src_bbox:[0,0,1000,1000],tgt_bbox:[0,0,1000,1000],desc:'the complete product and packaging master; preserve every non-logo pixel, text, artwork, seam, edge, material, camera angle, crop, background, light, highlight and shadow.'},...placements];
  const placementReference=placementGuide?" <ref_image_2> is the exact clean placement-and-appearance reference for this version. Use it to preserve the Logo's visible glyph geometry, target direction, scale, color and material placement; do not copy its background or any non-logo change.":'';
  const finishReferenceIndex=placementGuide?'ref_image_3':'ref_image_2';
  const reference=finishReference?` ${finishReferenceIndex} is only a material reference for the requested print finish; do not copy its product, text, logo or composition.`:'';
  return `<ref_image_0> is the only product, packaging and composition master. <ref_image_1> is the only original Logo source. Edit only the listed Logo targets and preserve the rest of ref_image_0 exactly.${placementReference}${reference} ${targetPrintInstructions(variant,targets,originalColor,true)} The Logo must be physically printed or foil-stamped onto the real target surface, following its perspective, curvature, occlusion, existing light and substrate texture. Never redraw or retype the Logo. Keep every source glyph, hole, proportion, spacing and edge unchanged; only apply the explicitly requested target rotation and surface deformation. Do not mirror, stretch, crop, simplify or invent any Logo element. Do not add labels, borders, guide lines, handles, captions, watermarks or new objects. Use the following authoritative layout JSON; each bbox is [top,left,bottom,right] in 0-1000 coordinates. ${JSON.stringify(layout)}`;
}

function buildGptRequest(variant,{model,size,baseImage,compositionMaster,logoImage,guide,finishReference,targets,originalColor}){
  const useCompositionMaster=variant.version!=='ORIGINAL'&&Boolean(asDataUrl(compositionMaster));
  return {model:model.trim(),n:1,size,resolution:'1K',prompt:promptFor(variant,{compositionMaster:useCompositionMaster,targets,originalColor,finishReference:Boolean(finishReference)}),image_urls:[logoImage,useCompositionMaster?compositionMaster:baseImage,guide,...(finishReference?[finishReference]:[])]};
}

function buildFluxRequest(variant,{model,size,baseImage,logoImage,placementGuide,finishReference,targets,logoAspectRatio,originalColor}){
  return {model:model.trim(),n:1,aspect_ratio:size,resolution:'1k',safety_tolerance:2,grounding:false,prompt:fluxPromptFor(variant,{targets,logoAspectRatio,placementGuide:Boolean(placementGuide),finishReference:Boolean(finishReference),originalColor}),image_urls:[baseImage,logoImage,...(placementGuide?[placementGuide]:[]),...(finishReference?[finishReference]:[])]};
}

export function pickAspectRatio(width,height){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('原图尺寸无效');
  const ratio=width/height;
  return SIZES.reduce((best,size)=>Math.abs(Number(size.split(':')[0])/Number(size.split(':')[1])-ratio)<Math.abs(Number(best.split(':')[0])/Number(best.split(':')[1])-ratio)?size:best,SIZES[0]);
}

export function buildAiMockupPlan({model,baseImage,compositionMaster,logoImage,finishReferenceImage,maskImage,guides,targets,schemes,originalColor,onlyVersion,selectedVersions,logoAspectRatio=1,size='1:1'}={}){
  if(typeof model!=='string'||!model.trim())throw Error('缺少 AI 图片模型');
  if(!asDataUrl(baseImage))throw Error('缺少产品/彩盒原图');
  if(!asDataUrl(logoImage))throw Error('缺少透明 Logo 原图');
  if(!SIZES.includes(size))throw Error('AI 成图比例无效');
  color(originalColor);
  if(finishReferenceImage&&!asDataUrl(finishReferenceImage))throw Error('工艺参考图无效');
  const mask=asDataUrl(maskImage);
  const guideByVersion=new Map((Array.isArray(guides)?guides:[]).map(item=>[item?.version,item?.dataUrl]));
  const selected=selectGenerationVersions({selectedVersions,onlyVersion});
  return selected.map(version=>{
    const variant=VARIANTS.find(item=>item.version===version)||{version};
    const guide=asDataUrl(guideByVersion.get(variant.version));
    if(!guide)throw Error(`缺少 ${variant.version} 的定位参考图`);
    const variantTargets=schemeTargets({targets,schemes},variant.version);
    const finishReference=asDataUrl(finishReferenceImage);
    const request=model.trim()==='flux-3-image'
      ?buildFluxRequest(variant,{model,size,baseImage,logoImage,placementGuide:guide,finishReference,targets:variantTargets,logoAspectRatio,originalColor})
      :buildGptRequest(variant,{model,size,baseImage,compositionMaster,logoImage,guide,finishReference,targets:variantTargets,originalColor});
    const guideItem=(guides||[]).find(item=>item.version===variant.version);
    return {version:variant.version,request,baseImage,placementGuide:guide,maskImage:asDataUrl(guideItem?.maskDataUrl)||mask,foilMaskImage:asDataUrl(guideItem?.foilMaskDataUrl),goldMaskImage:asDataUrl(guideItem?.goldMaskDataUrl),roseMaskImage:asDataUrl(guideItem?.roseMaskDataUrl),laserMaskImage:asDataUrl(guideItem?.laserMaskDataUrl)};
  });
}
