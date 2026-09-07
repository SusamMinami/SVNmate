# 场景参考工具

模式：Operate。范围：现有分镜视口的局部扩展，不新增工作区或视觉体系。
Impeccable CLI 下载校验失败，本说明作为本轮开发侧 surface brief。

## Direction contract

THESIS: 在已确认 BP 坐标下读取附近几何，明确区分快照建议与真实引擎验收。

OWN-WORLD: 沿用浅灰工程壳、黑白信息层级、青色几何线框和信号黄主操作；
使用已有字号、2px 控件和 Lucide 图标。

STORY: 读取候选落点、确认采集、选择参考对象，再主动重算规则镜头。
失效或离线不覆盖当前结果，不自动向 AI 发送场景内容。

FIRST VIEWPORT: 视口标题栏右侧是紧凑入口；临时工具区贴合标题栏展开，
表格有限高度，采集与应用动作固定可见。关闭后恢复完整预览空间。

FORM: 既有工具栏的按需展开附件，无新视觉方向，无 seed（局部扩展）。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 实际状态规则

- 读取依赖当前对话匹配的 BP 坐标基准；多实例无唯一明确落点时必须手动选择，
  未选择时不能采集。对象表格随内容区滚动，底部应用与解除引用操作保持可见。
- 改选或清空落点立即清除待应用草稿并禁用应用，但保留已应用快照；
  重选原落点也必须重新采集。读取失败或中断不覆盖已应用快照与当前分镜。
- 快照非实时；AI 分享默认关闭，新草稿恢复关闭。应用与解除引用只重算本地
  规则镜头，不调用端侧顾问、TRAE 或 Mira，也不写入 UE。
- 3D 视口隔离堆叠上下文，角色标签不盖过场景工具；关闭、Escape 或点击外部
  可收起工具，关闭按钮与 Escape 会将焦点归还入口。

## 已有桌面验收范围

已验收桌面尺寸：1440 × 900。现有截图位于
`test-results/visual-offers-the-detected-91f72-tion-before-designing-shots-desktop/`：
`scene-reference-panel.png`、`scene-reference-applied.png` 及三张
`scene-reference-anchor-*.png`，覆盖工具展开、应用后线框、改选落点、
清空落点与重选原落点仍需采集的状态。

上述证据使用测试快照；UE 端口离线，未完成真实读取验收。RGB/深度验收与
独立无对白空镜尚未接入。本次仅合并文档，不新增浏览器或测试执行结果。
