# 迁移接续检查点 · 2026-09-16

## 基线

正式项目与最新开发副本分别解压、隔离核对。两份 SQLite integrity_check 均为 ok，foreign_key_check 均无违规。
正式：15 产品、8 任务、17 母版版本、5 Production Logo；开发：15 产品、8 任务、18 母版版本、5 Production Logo、1 TemplateAutomation。
双方 43 个上传文件逐个 SHA-256 相同。此次测试使用新建临时数据库，没有启动或写入上传的两个 data 目录。

## 本轮改动

- logo-pixels.mjs：优先加载项目 sharp 依赖，兼容旧版 Node 运行时依赖位置和当前工作环境；缺依赖时给出安装提示。
- package.json：声明 sharp 0.35.4，将 npm test 指向完整回归入口。
- run-tests.mjs：自动创建隔离测试目录，枚举测试文件，兼容 Windows 不展开通配符的执行方式。
- automatic-render.mjs：复用结果前核对输出文件哈希。缺失或损坏则新增版本重新生成，旧历史记录不覆盖。全失败为 FAILED，部分成功为 PARTIAL。逐方案/前置失败及时保存报告，生成锁在异常后释放。
- test-automatic-render.mjs：补充输出缺失、损坏恢复及全失败状态断言。

## 验证

Node 24.19.0，sharp 0.35.4；执行 node run-tests.mjs：17 项测试通过、0 失败。
包括 Step 1–6B 回归、背景处理、母版自动化、真实二维多载体 PNG、方案确认、重生成和删除清理。
两处 FOREIGN KEY constraint failed 日志由原有 DeleteFailureProbe 故意触发，用于确认删除失败回滚；对应测试通过。
APIMart 仅使用本地模拟接口；没有真实付费调用。此次未完成浏览器端视觉验收，也未在用户 Windows 电脑执行启动验证。

## 源码包使用边界

这是完整开发源码检查点，含 seed 测试素材；不含 data、真实上传素材、密钥、密码、node_modules 和测试产生的文件。
保留收到的原始迁移 ZIP。若本机验证，请复制原开发文件夹到新的测试目录，再用本包代码更新该测试副本，保留其 data。不要覆盖正式项目。
Node.js 需 24 或更高；已有打包运行时可继续使用。普通 Node 环境首次需在目录执行 npm install，然后 npm test。
原 start.cmd/start.ps1 使用 3210，请勿在正式服务占用该端口时用它启动测试副本；隔离启动请设置 PORT=3211、APP_DATA_DIR 为测试副本 data 的绝对路径、APP_NO_SEED=1，再执行 node server.mjs。

## 下一停止点

自动二维多目标/多方案主链路已通过接口测试，但仍要求已有 Production Logo 和显式工艺。
尚未实现完整的“上传原始资料即一键完成”：Transparent Master 持久化及业务入口、自动工艺编排、区域级规则覆盖、客户修稿轮次、载体改色、标准交付标签、设计师模式及全流程浏览器验收继续待做。
维持 Node.js + SQLite；不改变历史任务绑定；硬禁止不可绕过；开发库不得覆盖正式库。
