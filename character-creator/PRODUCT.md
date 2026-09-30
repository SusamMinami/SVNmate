# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Windows 本地桌面工作台；首版使用本机服务与浏览器测试面板，后续可封装 Electron。
不部署云端，不设计移动端。

## Stack

用户委托推荐工具结构。采用 React / TypeScript / Vite 前端，Python 本地数据服务与
Windows Excel COM 适配器。沿用 ConfigLinker 的双表头、多值索引策略及运镜沙盒的
Excel 编辑会话协议。Python 负责 CSV、工作簿只读检查与 COM，避免再引入一套表格转换器。

## Users

需要跨多张配置表制作可玩角色、职业、技能和 Buff 的游戏策划。

## Product Purpose

以角色为编辑上下文，把分散表格组织为基础、成长、技能、Buff 与表现模块。
在同一界面查看来源、编辑草稿、检查跨表引用并预览实际写入差异。

## Capabilities and Constraints

- 从 Eric、Jodie、Nino 的既有配置出发，基础职业、转职分支和新手本职业分别保留。
- 支持职业基础编辑与模板复制；完整的新职业上线仍需枚举、资源与游戏验证。
- 支持技能执行、技能树、升级参数及 Buff 生命周期/属性/触发模块编辑；技能模板新建同步复制技能树和升级行，Buff、伤害、行为、光环可按模板单独新建并显式关联。
- 不把配置表行等同于完整技能资产。UE 复用与待补接口见 [能力核对](docs/ue-interface-reuse.md)。
- CSV 是只读导出快照，Excel 是配置源；不直接重写 CSV 或用第三方库保存真实 xlsm。
- Excel 写入前核对版本、表头、唯一 ID 和原值，串行执行，回读后标红且保持未保存。
- 测试默认落在隔离工作簿副本；源工作簿写入必须由用户在界面明确选择并确认具体差异。
- 业务数据、目录配置、草稿、测试副本不进 Git。首版不自动执行 VBA、导表、SVN 或 UE 写入。

## Brand Commitments

名称“角色创建工具”。用户指定复用运镜沙盒既有设计语言：浅色工程壳层、黑白层级、
少量信号黄、紧凑表单、明确状态与细线分区。

## Evidence on Hand

真实本地 CSV、xlsm 只读检查，游戏 Lua 调用和生成的 Java 表定义。
研究结论与范围见 [配置研究](docs/configuration-research.md)。

## Accessibility & Inclusion

键盘可操作、清晰焦点、错误不只用颜色，支持减少动态效果及 Windows 缩放。
