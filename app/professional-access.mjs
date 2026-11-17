// Enforce advanced editor permissions before parsing or changing business data.
export function professionalAction(path,method){
 if(!['POST','PUT','PATCH','DELETE'].includes(method))return false;
 return path==='/api/products'||/^\/api\/manage\/products\//.test(path)||path==='/api/render'||/^\/api\/templates\/[^/]+$/.test(path)||/^\/api\/workspace\/[^/]+\/(draft|review)$/.test(path)||/^\/api\/logo\/[^/]+\/elements(?:\/[^/]+)?$/.test(path)||/^\/api\/batch\/[^/]+\/approve$/.test(path);
}
export function requireProfessional(actor){if(!['ADMIN','DESIGNER'].includes(actor.role))throw Object.assign(Error('此操作需要设计师或管理员登录。业务员请使用「开始做图」自动生成，或从预设方案中调整位置。'),{status:403});}
export function validateBusinessLogo(db,taskId,input,actor){
 if(['ADMIN','DESIGNER'].includes(actor.role))return;
 const source=db.prepare('SELECT id FROM OriginalLogoVersion WHERE id=? AND taskId=?').get(input?.sourceLogoAssetId||'',taskId);
 const selected=input?.selectedElementIds;
 if(!source||!Array.isArray(selected)||selected.length!==1||!db.prepare('SELECT id FROM LogoElement WHERE id=? AND logoAssetId=? AND isFull=1 AND isArchived=0').get(selected[0],source.id))requireProfessional(actor);
 if(!['ORIGINAL','SINGLE'].includes(input.colorMode)||!['NONE','WHITE'].includes(input.backgroundRemovalMode))requireProfessional(actor);
}
