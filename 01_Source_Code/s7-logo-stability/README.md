# S7 Logo Stability

集成在主工作区中的 Logo 上样模块，通过主服务 `/s7/` 路径提供页面和 API，与主工作区共用登录会话和产品图库；每个用户的任务草稿、素材和结果仍保存在独立空间。模块从同一布局输出四个版本：

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
- 服务：由 `server.mjs` 在 3210 端口直接挂载，不需要单独运行 3237 端口的服务。

## AI Logo 加工配置

S7 读取 `01_Source_Code/data/ai-provider.local.json`，也可以使用环境变量 `S7_AI_CONFIG` 指向配置文件。APIMart 配置示例：

```json
{
  "enabled": true,
  "provider": "APIMART",
  "model": "gpt-image-2.5-flare",
  "mockupModels": ["gpt-image-2.5-flare", "flux-3-image"],
  "endpoint": "https://api.apimart.ai",
  "apiKey": "只保存在本机配置，不要提交到 Git"
}
```

`model` 是默认的最终上样成图模型；`mockupModels` 是前端可选的最终成图模型列表。Logo 透明底加工继续使用 `logoModel`（未配置时回退到 `model`），因此 `flux-3-image` 不会意外替换透明 Logo 加工模型。

S7 会向 APIMart 提交 `/v1/images/generations` 图片编辑请求，使用 Logo 的 base64 data URL，支持直接返回图片链接或异步任务后下载结果。当前允许模型：`gpt-image-2`、`wan2.7-image-pro`、`wan2.7-image`。下载结果必须是带透明背景的 PNG，否则会直接提示失败，不会使用本地抠图算法兜底。

金银版本当前是确定性颜色版本，尚未加入真实金属反光。AI 材质融合会在后续阶段通过受保护遮罩接入。

## 验证

## 产品母版位置

S7 通过主工作区的 `/api/templates/:productId` 读取产品当前已发布母版。产品库选择产品后，所有 `logo` 区域会自动转换为固定上样目标；目标的坐标、尺寸、方向和四点区域由母版提供，S7 画布中的几何编辑会被锁定。需要调整位置时，请回到主工作区的“产品母版”页面修改并重新发布版本。

没有已发布母版的产品仍可在 S7 中手动定位；产品标准图发生变化并需要重新确认母版时，S7 不会继续使用旧区域。

Windows 上通过项目根目录的 `start-workspace.ps1` 启动主工作区，之后从左侧导航打开 S7；旧的 `start-s7.ps1` 入口也会转到主工作区启动脚本：

```powershell
cd C:\Users\EDY\Desktop\AI_LOGO
powershell -ExecutionPolicy Bypass -File .\start-workspace.ps1
```

在 `01_Source_Code` 目录运行：

```powershell
node --test s7-logo-stability/test.mjs
```
