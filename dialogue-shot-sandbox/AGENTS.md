# 镜头沙盘 AI 开发指南

只面向 Windows Electron 桌面；Vite 用于开发与自动化验收，不是独立 Web 产品。
不新增移动端、触屏或窄屏专项布局/测试。先按下表读取任务所需专题，不必全读 README、
设计文档和版本历史。仓库通用规则见 [根目录 AGENTS.md](../AGENTS.md)。

## 按任务阅读

| 修改范围 | 现行规范 | 主要代码 |
| --- | --- | --- |
| 搜索、加载、导演切换、TRAE 排队/缓存 | [分镜工作流](docs/storyboard-workflow.md) | `src/App.tsx`、`src/app/`、`server/traeBridge.ts` |
| BP 站位、角色身份、体型/坐标 | [BP 集成](docs/ue-formation-integration.md) | `src/data/blueprintFormation.ts`、`server/ue/characterBody.ts` |
| 镜头语言、构图、投影 | [镜头规则](docs/shot-language-rulebook.md) | `src/director/` |
| 端侧节拍/VLM、偏好反馈 | [端侧顾问](docs/rule-director-edge-advisor.md) | `server/ruleAdvisorBridge.ts`、`src/director/` |
| 配置小窗、快捷相机、动作/视线、00 节点 | [节点配置](docs/node-configuration.md)；预设机位另读 [Camera BP](docs/camera-bp-presets.md) | `src/app/useUeDialogueSelection.ts`、`server/ue/` |
| UE 导出、对白编辑、审核/恢复 | [导出协议](docs/dialogue-camera-export-design.md) | `server/ueBridge.ts`、`src/app/useStoryboardExport.ts` |
| 目标物、BP 注册、SceneObject/背景资产 | [任务目标物](docs/mission-target-preview.md) | `src/data/missionTarget*.ts`、`server/ueBridge.ts` |
| NPC/TaskActor 配表、Excel 坐标 | [NPC 注册](docs/npc-registration.md) | `server/excelRegistration.ts`、`src/data/npcRegistration.ts` |
| 全新 NPC、Body/Face 动作、Montage | [NPC 迁移](docs/npc-migration.md) | `server/npcMigration.ts`、`server/npcSupplement.ts` |
| LevelSequence 字幕、skip、Show/Hide | [动画语音](docs/animation-voice-workspace.md) | `server/ue/scripts/animation_voice.py`、`src/app/useAnimationVoice.ts` |
| 音效试听/配乐分析 | [音效](docs/sound-effect-preview.md)、[音乐](docs/music-analysis.md) | `server/` 音频服务 |
| 场景 AABB、落点、空镜边界 | [场景接入](docs/scene-composition-integration.md) | `server/ue/sceneReference.ts`、`src/scene/` |
| UI 布局、控件与动效 | [PRODUCT.md](PRODUCT.md)、[DESIGN.md](DESIGN.md)，再读功能专题 | `src/components/`、`src/styles.css` |
| 启动、端口、联调、构建与发布 | [开发指南](docs/development.md) | `package.json`、`desktop/`、`scripts/` |

图节点创建/连线与通用资产 Patch 仍有 UE 侧前置条件，先从
[文档索引的待接入方案](docs/README.md#待接入方案与能力证据)进入，不当作现成 API。

## 全局不可破坏的约束

- 四位对话 ID 只加载本地对白；显式“读取 BP 站位”才访问 UE。导演/VLM/TRAE/Mira
  只由用户主动启动，不能以加载、刷新或小窗监听暗中触发。
- 0 号玩家始终保留，BP 数字槽定义场内实例；NPC ID 不等于模型槽。
  保留真实朝向与高度，预览/机位/投影共用 `characterGeometry`，不重复应用缩放。
- 写入必须有明确目标、差异和确认，提交时核对最新资产/选择与相应审核凭证，
  按用户确认的精确范围写入、回读并在失败时恢复。保存规则不能一概而论：

| 写入类型 | dirty 与保存规则 |
| --- | --- |
| 完整分镜导出、对白批量编辑 | 脏资产阻断；回读通过后按资产保存 |
| 配置小窗单节点 | 可经显式策略一并保存对话资产已有修改；Formation/角色 BP 仍阻断 |
| LevelSequence 动画语音 | 脏资产阻断；成功只标脏，不自动保存 |
| Excel 配表/位置 | 复用同一 Excel 实例、串行 COM、有限忙重试；标红、保持未保存 |

- 上表不是所有 UE 操作的统一事务承诺。BP/NPC 迁移按各自专题的快照、恢复和
  人工终检边界执行；不能宣称跨请求原生 Undo 已实现。
- 小窗只在激活期间监听选择；异步结果绑定对话、节点和坐标基准。
  普通工作区首次访问懒加载、切换保留表单、隐藏不刷新；小窗卸载重型工作区/Canvas，
  保留当前对话动作草稿与目录缓存。
- UE 通信复用现有 transport，有限超时并退避，不增加高频完整反射。
  写探针导致 `ECONNRESET` 或端口消失时停止后续写测试，先检查编辑器和日志。

## 代码边界

- `src/App.tsx` 只组合工作区和跨域流程；独立状态与复杂请求放 `src/app` hooks。
- `src/data/csv.ts` 是纯解析层，逐块生成业务对象，不引用浏览器/Electron，
  不恢复完整二维矩阵。目录/Worker 调度归 `csvLoader.ts`，不回退主线程解析。
- `src/data/databaseIndex.ts` 维护按数据库实例缓存的查询索引，扩展索引而非在
  组件中重复全表扫描。
- `server/ue/transport.ts` 管 TCP，`routes.ts` 管 HTTP/Vite，`services.ts` 是
  业务门面；目录和 Excel 路径归 `server/configRepository.ts`。新功能先进业务服务，
  不把协议处理堆回路由。

## 验证与维护

在本项目目录运行 `npm test`、`npm run build`、`npm run test:e2e`；
窄范围先跑相关测试，交付前按风险覆盖完整桌面流程。UI/Three.js 改动检查桌面截图
和 Canvas 非空。纯文档只需链接、事实和 diff 检查，不启动 UE/Excel。
命令前置条件及有副作用的脚本见 [开发指南](docs/development.md)。

功能细节更新对应专题，视觉更新 DESIGN，用户操作更新 README；只有新增跨功能硬约束
或路由变化才改本文件，不再逐版本追加全部功能描述。
