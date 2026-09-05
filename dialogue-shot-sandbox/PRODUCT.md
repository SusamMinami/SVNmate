# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

产品以 Electron 封装为 Windows 桌面应用；Vite 页面只用于本地开发和自动化验收，
不支持移动端、触屏端或窄屏浏览器产品形态。

## Users

主要用户是使用 UE4 制作游戏对白、站位、镜头、角色动作和音频配置的策划与镜头
设计人员。用户需要在真实项目数据、Formation Blueprint、对话节点、NPC 资产和
UE 当前状态之间反复核对，并在高风险写入前完成审核。

## Product Purpose

镜头沙盘读取真实 `res`/`doc` 配置与 UE Blueprint，把对白上下文、角色站位、
镜头语言、动作、音效和配乐组织为可预览、可检查、可返修并可安全导出的分镜方案。
成功意味着用户能在同一桌面工作流中定位对白、确认站位、比较方案、检查构图和
逐项批准写入范围，而不会意外覆盖 UE 中未确认的数据。

## Positioning

它不是通用 3D 场景编辑器或文本生成器。产品把规则导演、内部 TRAE 协作、Mira AI、
真实 Formation BP、确定性几何求解、投影验收和 UE 回读保护组合成一条有证据的
对白制作链，并允许规则、缓存、共享和新生成方案之间无损切换。

## Operating Context

- Windows Electron 桌面应用，与 UE4 和 OmniMcpCore 在本机协作。
- 用户同时处理分镜工作台、NPC 注册、任务目标物和 NPC 迁移四个常驻工作区。
- 数据来自真实 CSV、Excel、UE 资产、飞书 Base 音频/角色资料和本地缓存。
- 生成与 UE 读取可能持续较久；用户需要保留当前结果并切换到其他工作。
- 导出、Excel 写入、BP 创建和任务中断均属于需要复核的高风险动作。

## Capabilities and Constraints

- React、TypeScript、Three.js、Vite、Electron 与本地 Node 服务。
- 仅面向常规 Windows 桌面窗口；不新增移动端布局和触屏交互。
- 2-12 人分镜，Formation BP 数字槽定义实际在场角色，0 号玩家始终保留。
- 规则导演、TRAE 和 Mira 均需通过 `shot-plan.v5` 与投影验收。
- 真实 CSV 必须在 Worker 中分块解析；Three.js 视口按需渲染。
- 工作区切换保留输入、勾选、查询、结果和错误状态。
- UE 写入前必须展示真实差异，审核令牌失效时重新检查；失败时回滚。
- 不复制参考游戏官网的 Logo、图片、视频、字体、着色器或生产代码。

## Brand Commitments

- 产品名为“镜头沙盘”。
- 既有视觉方向为原创的 `Endfield field engineering` 主风格与
  `Arknights information system` 辅助语言。
- 浅色工程壳层、黑白层级、稀有信号黄、青色空间辅助与小圆角是固定视觉资产。
- A/B 角色颜色是业务数据，不得被品牌强调色覆盖。

## Evidence on Hand

- 完整视觉与交互规范：`DESIGN.md`
- 产品、功能与运行说明：`README.md`
- AI 开发约束：`AGENTS.md`
- 当前界面与设计 token：`src/App.tsx`、`src/styles.css`
- 3D 视口：`src/components/StageView.tsx`
- 桌面视觉验收：`e2e/visual.spec.ts`、`playwright.config.ts`
- 分镜导出设计：`docs/dialogue-camera-export-design.md`
- 镜头语言与研究依据：`docs/shot-language-rulebook.md`、`docs/research/`
- 未提供量化用户研究、商业品牌许可或外部可公开素材；后续不得虚构。

## Product Principles

1. 真实数据和可执行结果优先于视觉表演。
2. 生成式建议必须经过确定性约束、投影验收和人工确认。
3. 长任务可中断、可切换、可恢复，已显示结果不因后台状态丢失。
4. 高风险写入先展示差异，再按用户勾选的精确范围执行并回读。
5. 每份数据只有一个视觉所有者，避免跨栏重复与状态分裂。

## Accessibility & Inclusion

所有交互支持键盘，焦点与状态不得只依赖颜色，图标按钮提供可访问名称。应用尊重
`prefers-reduced-motion`。桌面窗口需避免页面级横向滚动；文字最小值、对比度、
长路径与中英文混排必须在真实数据范围内验收。
