# 动画语音工作区

## Direction contract

THESIS: 面向 UE 动画配字幕与跳过配置的连续审核工具，继承现有工作区，不增加营销页。

OWN-WORLD: 既有浅灰工程壳层、Segoe UI、紧凑表格、信号黄主操作和统一图标反馈。

STORY: 用户主动全量扫描，选择动画，核对字幕时间、端点和标记，再批准精确变更。

FIRST VIEWPORT: 顶部单行目录和扫描控制；左侧动画清单；右侧字幕编辑及配置检查；
底栏固定审核与唯一写入入口。修改任何草稿立即撤销原审核状态。

FORM: 扩展已批准的工作区结构，Operate 模式，代码实现；不进行视觉身份替换。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 第一版边界

- 按指定 `/Game` 目录枚举全部 LevelSequence，前端逐个请求扫描，允许停止后续扫描。
- 每个资产扫描主轨、绑定轨、Section、字幕 ID、Wwise 事件引用、子序列引用、
  播放范围、帧率、Marked Frames，以及 Director 与跳过端点。
- 子序列只显示引用，各资产使用自身时间坐标，不把嵌套变速和偏移误当主序列时间。
- 字幕文本只从配置目录 `p配音表.csv` 读取；缺失时仍可扫描，写入内容是
  `DialogueID` 与起止时间，不修改 Excel。
- 上次已有字幕段保留；仅更新勾选段或增加新段，不删除未选配置。
- 仅在唯一的已绑定 Custom Event 直接调用 Show/Hide 函数时允许校正事件时间。
  不创建 Director，不创建端点，不修改父类、SkipMode 或已有函数逻辑。
- 缺少 Director/端点时只阻断事件校正，字幕和单独 skip 标记仍可审核。
- 服务端持有一次性审核令牌，提交时重读并校验资产版本和 UE 连接目标。
- 已有未保存修改阻断；成功只标脏，不自动保存。失败显式恢复本轮修改并回读；
  连接超时须先在 UE 检查结果，不盲目重放。
- 常规切换保留草稿；隐藏时不自动刷新，进入配置小窗按全局规则卸载。

## 语音阶段

当前 VLM `qwen3-vl:4b` 不支持 ASR。本机 Whisper base 的真实语音测试出现
明显文字与时间误差，不把其输出直接写入 UE。仓库已加入独立受管环境、Wwise
语音提取、Qwen3-ASR-0.6B 与 Qwen3-ForcedAligner-0.6B 后端接口：

```powershell
npm run speech:install
```

安装内容位于 `%LOCALAPPDATA%\ShotSandbox\speech-runtime`，模型和虚拟环境不随
安装包分发。当前动画语音界面尚未开放这些接口，仍以正式台词和人工时间编辑为准；
运行时接入、质量阈值与失败回退需要另行验收后再开放。

## 验证记录（2026-09-11）

- 464 项 Vitest 测试通过；新增 19 项覆盖字幕校验及端点解析。
- 3 项动画语音桌面 E2E 通过，覆盖审核失效、切换保留草稿、扫描失败和
  Director 失效后锁定事件输入。1280/1440 桌面截图完成复核。
- 完整桌面 E2E 共 48 项通过；规则占位动作测试改为验证实际只读内容，不再依赖
  异步加载过程中的瞬时状态文案。
- `v0.24.6` 前端生产构建、Electron 主进程与 preload 编译通过，Windows 安装版
  和便携版均已生成；发布摘要见 `RELEASE_NOTES.md` 与 `UPDATE_NOTES.md`。
- 实际 HTTP 接口成功扫描机械要塞开场目录的 10 个 LevelSequence；
  主序列读取 30 条轨道、7 条正式台词和唯一 Show/Hide 端点。
- 临时空资产验证字幕轨、字幕段、skip 标记创建、只标脏和一次性审核令牌。
  注入中途失败后逐字段核对字幕 ID、时间范围、标记恢复；测试资产已清理。
- 正式动画的隔离副本验证 Show=0.5s、Hide=33.8s、skip=34s，并回读确认原端点
  与其他事件保持不变。正式动画未修改。
- UE 返回的 `section_range` 与标记结构须使用 `.copy()` 备份，避免引用随原对象
  修改而失去回滚依据。测试清理允许等待 120 秒并检查资产确实不存在。
- 运行时播放触发、整批 Undo/Redo、真正卸载包后重开仍未验收。

手动集成测试（会创建并删除独立临时 UE 资产）：

```powershell
npx tsx scripts/smoke-animation-voice.ts --write-probe
```
