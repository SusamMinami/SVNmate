# Seria GM 指令调研

> 采集基线：2026-09-22 本机 `trunk`。本文件只记录结论；完整内部清单保存在
> `.generated/`，不会提交到公开仓库。

## 数据源与结论

采集器会合并以下只读证据：

- `GMManagerClient.lua` 的客户端指令。
- `GMManagerBase.lua` 的场景服与双端指令。
- `gm指令分级表.csv` 的账号等级约束。
- `gmlist.csv` 中实际被组合脚本引用的指令。
- 本机游戏日志中已经执行过的指令。

当前共得到 **1000 个不区分大小写的唯一指令名**。这是可发现集合，不表示这些
指令会在同一账号、服务器和场景中同时可用：

| 证据 | 数量 |
| --- | ---: |
| 客户端/场景服静态注册 | 943 |
| GM 分级表 | 30 |
| 组合指令表引用 | 53 |
| 本机日志实际出现 | 10 |

这些集合会重叠。风险初筛结果为：只读候选 21、任意执行 5、破坏性 67、
修改状态 347、需人工确认 560。

GM 分级表中的 30 条由账号等级约束：1 级 27 条、2 级 2 条、3 级 1 条。
未启用等级限制的内部开发环境可见本地注册集合；连接逻辑服时，还要以服务器实际
下发结果为准。

完整清单：

```powershell
python -B seria-qa-overlay\tools\collect_gm_commands.py
```

输出：

```text
seria-qa-overlay\.generated\gm-command-catalog.csv
seria-qa-overlay\.generated\gm-command-catalog.json
seria-qa-overlay\.generated\gm-command-summary.md
```

CSV 可直接用 Excel 筛选，JSON 可供后续 Overlay 构建命令面板。

## 已接入与后续候选

所有入口使用固定模板，不提供自由文本：

| 方向 | 指令 |
| --- | --- |
| 已接入：任务 | `PrintCurrentTask`、`TaskListPrint`、`DebugTaskInfo`、`ShowMissionDialogInfo` |
| 已接入：场景与角色诊断 | `GetRotation`、`GetTOD`、`sceneOnlineNum`、`showLocation` |
| 已批准状态操作 | `SkipLevelSequence`、`AddBuff`、`kill` |
| 运行状态 | `MessageCurrentDateTime`、`GetVersion`、`GetSceneVersion`、`GetParam` |
| UI/输入诊断 | `PrintUIStack`、`DiagnoseInputControl` |
| 战斗只读输出 | `PrintSelfBuff`、`PrintBossAttributes`、`PrintMonsterAttribute`、`PrintPuppetInfo` |

`DebugTaskInfo` 会切换本地调试显示，`showLocation` 会打开本地位置面板。
`AddBuff` 只允许正整数 Buff ID 和 1-999 层；`kill` 固定使用无参数形式，
仅作用于当前房间内与玩家阵营敌对的怪物，以红色按钮单击提交。

## 暂不接入

- `RunLuaString` 只保留现有固定 QA bootstrap；不得开放任意 Lua 输入。
- `RunLua`、`RunScript`、`ExecEngineCmd`、`Debug.Eval` 等任意执行入口。
- 除上述三个经明确批准、参数受限的状态操作外，其他含 `add`、`set`、
  `finish`、`remove`、`clear`、`kill`、`unlock`、`teleport` 等状态修改
  或破坏性指令。
- 账号、支付、SDK、网络代理、崩溃、停服与压测指令。

## 逻辑服边界

逻辑服指令并不完整存在于客户端仓库。客户端在进入游戏后发送
`CGMCommandList`，服务器通过 `SGMCommandList` 返回名称、说明、参数、分组和
当前账号 `gm_level`，再动态注册到 `AllGmCmds`。因此静态清单不能代表某个账号在
某个环境中的最终可调用集合。

后续如需覆盖逻辑服指令，应在游戏内收到 `SGMCommandList` 后导出脱敏快照，并把
“服务器已下发”和“当前等级允许”作为按钮可用条件；不能仅凭静态名称执行。
