# S7 Logo Stability

独立的确定性 Logo 上样模块。当前阶段只负责建立一个固定布局，并从同一布局输出四个版本：

- `ORIGINAL`
- `BLACK`
- `GOLD FOIL`
- `SILVER FOIL`

## 当前边界

- 输入：一张产品/彩盒原图、一张透明 Logo、一个或多个明确的上样目标。
- 输出：四张独立 PNG、目标 ID、统一布局指纹和每个目标的边界信息。
- 保护：Logo 以外的原图像素不被模块主动修改。
- 校验：目标不能为空、目标 ID 不能重复、Logo 不能越出原图。
- 交互：画布支持移动、缩放和旋转，左侧参数会同步更新。
- Logo 加工：界面只使用 AI 图片模型重新生成透明底、纯黑字 Logo；模型结果必须带透明像素和可见 Logo，镂空区域不再由本地算法猜测。
- 多位置上样：每个目标都是一个独立 Logo 实例；点击“复制 Logo”可复制当前实例并自动错开位置，之后可单独移动、缩放和旋转。
- 隔离：暂不接入 `server.mjs`、SQLite、旧工作台或现有批量流程。

## AI Logo 加工配置

S7 读取 `01_Source_Code/data/ai-provider.local.json`，也可以使用环境变量 `S7_AI_CONFIG` 指向配置文件。APIMart 配置示例：

```json
{
  "enabled": true,
  "provider": "APIMART",
  "model": "wan2.7-image-pro",
  "endpoint": "https://api.apimart.ai",
  "apiKey": "只保存在本机配置，不要提交到 Git"
}
```

S7 会向 APIMart 提交 `/v1/images/generations` 图片编辑任务，使用 Logo 的 base64 data URL，轮询 `/v1/tasks/{task_id}` 后下载结果。当前允许模型：`wan2.7-image-pro`、`wan2.7-image`。下载结果必须是带透明背景的 PNG，否则会直接提示失败，不会使用本地抠图算法兜底。

金银版本当前是确定性颜色版本，尚未加入真实金属反光。AI 材质融合会在后续阶段通过受保护遮罩接入。

## 验证

在 `01_Source_Code` 目录运行：

```powershell
node --test s7-logo-stability/test.mjs
```
