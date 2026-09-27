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
- Logo 加工：支持自动识别边缘背景色并去除，再裁剪透明边界。
- 隔离：暂不接入 `server.mjs`、SQLite、旧工作台或现有批量流程。

金银版本当前是确定性颜色版本，尚未加入真实金属反光。AI 材质融合会在后续阶段通过受保护遮罩接入。

## 验证

在 `01_Source_Code` 目录运行：

```powershell
node --test s7-logo-stability/test.mjs
```
