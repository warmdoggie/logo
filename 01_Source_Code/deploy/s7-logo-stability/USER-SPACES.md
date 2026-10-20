# 用户空间

管理员在“账号管理”创建、停用账号和重设密码。普通用户只能操作自己的任务和素材；产品图库、标准图及母版共享，只有管理员可维护。管理员的任务视图也只列出管理员自己的任务，历史任务自动归管理员。

本地通过仓库根目录 `start-workspace.ps1` 启动。首次启用后，初始管理员账号写入数据目录的 `workspace-admin.txt`；首次登录后在账号管理重设密码。不要分享或提交该文件。

已有的单用户/验收脚本保留原行为。启用隔离时主服务使用 `APP_MULTI_USER=1`；S7 由主服务直接挂载并共用这份登录会话。普通用户无法调用全局存储清理和验收接口。

## 数据

- SQLite 新增 WorkspaceUser、WorkspaceSession、TaskOwner、WorkspaceFileOwner，不改变原任务或产品的主键。
- 首次启用前备份数据库及 uploads。历史任务和未登记文件归管理员；共享产品图片通过产品引用供所有登录用户读取。
- S7 成功生成的素材和结果保存在 `S7_SPACE_DIR/<用户ID>/<记录ID>/`，只能通过认证后的个人历史接口读取。设置为 `/var/lib/s7-logo/workspace/user-spaces`，在 systemd 的既有可写范围内。
- 原先 S7 只存在浏览器内存中的结果无法追溯恢复；旧浏览器共享 Logo 缓存不会自动带入任何新用户。新缓存按用户 ID 区分，服务端生成历史支持跨设备恢复透明 Logo。
- 账号停用或重设密码会使该账号所有会话失效。登录限 12 小时，Cookie 为 HttpOnly / SameSite=Strict；配置 HTTPS APP_PUBLIC_ORIGIN 后启用 Secure。

## 线上启用

1. 备份 `/var/lib/s7-logo/workspace/assistant.sqlite`（使用 SQLite 在线备份或停服备份，不能单独复制运行中的主数据库而遗漏 WAL）及 uploads。
2. 部署经过验证的代码；保留现有 Basic Auth 作为额外入口保护。
3. 在 `/etc/s7-logo/production.env` 增加 production.env.example 中的 `S7_AI_CONFIG`、`APP_MULTI_USER`、`APP_PUBLIC_ORIGIN`、`S7_WORKSPACE_URL` 和 `S7_SPACE_DIR`。
4. 若更新了 systemd unit，先执行 `systemctl daemon-reload`；重启 `s7-workspace.service`，检查 `/api/health` 和 `/s7/healthz`。
5. 验证工作区和 S7 模块登录正常后，停用旧的 `s7-logo.service`：`systemctl disable --now s7-logo.service`。
6. 从数据目录安全取得初始管理员账号，创建两名测试用户，验证任务、文件直链、S7 历史隔离以及产品共享，再向用户开放。

切勿关闭 APP_MULTI_USER 回退到旧模式后继续让多用户访问。数据库与 user-spaces 都必须纳入日常备份。

## 自助注册与人工审核

登录页提供“注册账号”。注册申请固定为普通用户、待审核状态，不会发放登录会话。管理员在“账号管理”的“待审核申请”中选择“通过”或“拒绝”；待审核、被拒绝或停用的账号不能访问工作空间、S7 或私有素材。管理员直接创建的用户仍可立即使用。

升级会为 WorkspaceUser 增加 approvalStatus，现有账号默认为已通过，并保留原权限及停用状态。上线前停服备份数据库、uploads 和 user-spaces。旧版代码不兼容新增列，回退时需使用兼容此列的代码，或在确认没有新增业务数据后恢复完整备份。

注册接口每个来源 IP 每小时最多接受 10 次尝试。仅在连接来自本机代理时读取 Nginx 覆盖设置的 X-Real-IP；主服务须继续绑定 127.0.0.1。公开注册页需要在管理员确认后移除网站入口的 Basic Auth，保留 APP_MULTI_USER=1 和应用内的登录、审核及权限检查。入口 Basic Auth 保留期间，新用户仍需先通过该入口认证才能申请注册。
