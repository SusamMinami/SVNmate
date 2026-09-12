# 镜头沙盘文档索引

结构核对：2026-09-11。先读 [AI 入口](../AGENTS.md)，按任务选择下列专题。
版本以 `package.json` 为准；专题内的测试日期只说明当时验证，不表示本次重新验收。

## 现行入口

- [README](../README.md)：快速使用和工作区导航。
- [开发指南](development.md)：环境、命令、端口、TRAE/飞书接入、发布与副作用。
- [PRODUCT](../PRODUCT.md)：用户、目标、产品范围。
- [DESIGN](../DESIGN.md)：视觉 token、布局、组件与反馈，保留设计工具所需 schema。

## 现行专题规范

| 任务 | 规则归属 | 注意 |
| --- | --- | --- |
| 对白加载/搜索、导演切换、队列/共享/缓存 | [分镜工作流](storyboard-workflow.md) | 四位 ID 不隐式连接 UE |
| 数字槽、角色身份、体型/坐标、BP 读取 | [BP 集成](ue-formation-integration.md) | 身份与空间规则，不是任务调度器 |
| 完整分镜导出、对白批量写入 | [导出协议](dialogue-camera-export-design.md) | 精确范围、dirty、回读与保存 |
| 小窗监听、快捷镜头、动作/视线、00 节点 | [节点配置](node-configuration.md) | 单节点保存策略不推广到其他工作流 |
| 角色 Camera BP 数字机位 | [预设机位](camera-bp-presets.md) | 已烘焙 Transform；原生字符串引用仍待验证 |
| 目标物、BP 注册、位置同步、背景资产 | [任务目标物](mission-target-preview.md) | 读取 UE 选择不等于已授权写入 |
| NPC/TaskActor 注册与 Excel | [NPC 注册](npc-registration.md) | 标红、未保存编辑会话 |
| 跨工程 NPC 与动作/面部增补 | [NPC 迁移](npc-migration.md) | 三种流程分开，保留既有 Montage Slot |
| 字幕、skip、Show/Hide 与本地语音对齐 | [动画语音](animation-voice-workspace.md) | 源码已接入语音候选；人工采用/审核后写入，仅标脏 |
| Wwise/远端音效试听 | [音效](sound-effect-preview.md) | 全库同步有远端写入副作用 |
| 音乐映射、分析缓存与推荐 | [音乐分析](music-analysis.md) | 日常同步不下载全库 |
| 镜头语言与投影质量 | [镜头规则](shot-language-rulebook.md) | 区分 error/warning/info |
| 节拍与 VLM 全量候选评分 | [端侧顾问](rule-director-edge-advisor.md) | 可选模型，按需运行 |
| 场景参考交互 | [场景 UI](scene-reference-ui.md) | 快照失效与焦点规则 |
| 场景空间/隐私契约 | [场景接入](scene-composition-integration.md) | 开头为已实现 AABB；后文 RGB/深度/空镜为计划 |

## 待接入方案与能力证据

- [UE 图编辑建议](ue-graph-editing-support.md)：受控节点创建/连线的接口需求。
- [通用资产 Patch 需求](ue-editor-asset-patch-api-requirements.md)：建议的
  Snapshot/Patch 协议，不表示 UE 已实现所有接口；不能替代动画语音当前 Python 链路。
- [本地插件可行性](local-dialog-plugin-feasibility.md)：探测证据、原型与构建限制。
- [本地插件原型说明](../tools/local-dialogue-probe/README.md)：只在该原型任务中读取。

## 研究与历史

- [2026-09-09 性能记录](performance-2026-09-09.md)、
  [2026-09-11 性能记录](performance-2026-09-11.md)：已测结果与当时待办，非当前测试报告。
- [Adobe](adobe-camera-techniques.md)、[StudioBinder](studiobinder-camera-techniques.md)：
  摄影资料提炼，不覆盖当前机器协议。
- [UI 研究](research/hypergryph-ui-evidence.md)：观察证据，不授权复制素材。
- [2048 案例](case-2048-camera-diagnosis.md)：已关闭问题的诊断。
- [近期更新](../UPDATE_NOTES.md)、[版本历史](../RELEASE_NOTES.md)：发布记录，不是开发入口。
- [vgmstream](../tools/vgmstream/README.md) 与 [USAGE](../tools/vgmstream/USAGE.md)：
  第三方说明按需读，许可原样保留。

## 更新规则

一条细节只维护一个专题，其他入口使用链接。功能变化不要求向 AGENTS、README、
DESIGN、PRODUCT 和发布历史各粘贴同一段；仅更新各文件职责内的信息。
详细策略见仓库 [文档维护约定](../../docs/documentation-maintenance.md)。
