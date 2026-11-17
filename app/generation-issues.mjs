// These labels explain failures; they never relax geometry or production checks.
export function generationIssue(error){
 const reason=String(error?.message||error||'生成未完成').replace(/^Designer Required[：:]\s*/i,'');
 const rules=[
 ['INTERRUPTED',/中断|重启|INTERRUPTED/,'生成已中断','刷新查看已保存结果，再点击一键生成；已完成的图片将按规则复用。','BUSINESS'],
 ['TEMPLATE_REQUIRED',/缺少.*母版|未绑定.*母版|未分类|语义区域|默认摆放框|锁定母版尚未/,'产品配置待完善','请设计师完成该产品母版、区域和默认方案，并确认任务绑定版本，然后重新生成。','DESIGNER'],
 ['LOGO_REVIEW',/Logo.*(背景|复核|处理|缺少|尚未)|缺少.*Logo|透明.*母版/,'Logo 需要处理','请设计师在 Logo 专业处理入口复核素材；处理完成后，业务员重新点击一键生成。','DESIGNER'],
 ['PRODUCTION_INFO',/NEED_INFO|资料|材质|表面处理|未知/,'生产资料待补充','请设计师补充对应本体、彩盒或区域的生产资料，再重新生成。','DESIGNER'],
 ['COLOR_CONFLICT',/颜色.*(不匹配|冲突)|工艺.*颜色/,'颜色与工艺不一致','核对客户指定工艺与 Logo 颜色，在客户要求中统一设置后重新生成。','BUSINESS'],
 ['PROCESS_RESTRICTED',/BLOCK|禁止|禁用|预审|WARNING|警告/,'工艺需要处理','请管理员核对限制依据，或与客户确认允许的替代工艺；禁止工艺不能直接跳过。','ADMIN'],
 ['LAYOUT_REVIEW',/曲面|自由设计|复杂表面|越界|禁区|摆放|几何|放置|蒙版/,'版式需要设计师处理','请设计师检查母版区域、默认摆放或底色蒙版；复杂需求需先落实到可用方案后重试。','DESIGNER'],
 ['STALE',/变化|刷新|冲突|版本/,'资料已更新','刷新读取最新资料，核对已保存要求后重新生成。','BUSINESS']
 ];
 const row=rules.find(([,pattern])=>pattern.test(reason))||['CHECK_REQUIRED',null,'生成未完成','请保留任务，联系设计师查看具体原因；确认资料后可重新生成，已有历史结果保留。','DESIGNER'];
 return {code:row[0],title:row[2],reason,nextStep:row[3],role:row[4]};
}
