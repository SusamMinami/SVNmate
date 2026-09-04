# 迁移单号识别与路由

## SeriaMigrate 的实现

`SeriaMigrate.py` 使用两层规则区分国内与海外单号。

### 当前扫描环境

配置 `GbIsOversea` 决定 SVN 日志扫描使用的主单号：

```text
false -> 【SERIA-\d+】
true  -> 【OSCOA-\d+】
```

该开关只决定“在哪一侧按什么单号找提交”，不负责建立两个单号的对应关系。

### 国内/海外关联

关联关系使用以下字符串协议：

```text
【OSCOA-123】海外完整标题&&&&【SERIA-456】国内完整标题
```

对应正则：

```text
(【OSCOA-\d+】)(.*?)&&&&(.*?)(【SERIA-\d+】)
```

工具把结果保存为：

```text
related_jira_map[国内 SERIA] = 海外 OSCOA
```

扫描源 SVN 时仍按 SERIA 查提交；生成 `commit_info.json` 时同时记录 `jira_id` 和
`os_jira_id`。后续打开海外提交窗口时，`CheckValidCommit.py` 把提交说明中的
SERIA key 替换为 OSCOA key。

## 飞书合并表协议

知识库节点：

```text
【P6-OSCOA】OSOB2.0分支合并及屏蔽
```

当前工作表：

```text
kGEBNH / 0904（0910周更）
```

当前页签 A 列共识别：

| 路线 | 数量 | 格式 |
| --- | ---: | --- |
| 国内主干 → 海外主干 | 18 | `OSCOA完整标题&&&&SERIA完整标题` |
| 海外主干 → OSOB | 8 | 只有 OSCOA，位于“纯海外单子”分段 |

表内还存在“单提OSOB”和“不合并”分段。当前页签这两个分段下没有有效单号，但解析器
会保留分段状态，后续新增任务时直接按对应路线处理。

## 新工具的识别规则

| 输入/表格情况 | 源单号 | 目标单号 | 路线 |
| --- | --- | --- | --- |
| 输入 SERIA，命中 `&&&&` 行 | SERIA | OSCOA | 国内 trunk → 海外 trunk |
| 输入映射过的 OSCOA | 对应 SERIA | OSCOA | 国内 trunk → 海外 trunk |
| 输入“纯海外单子”中的 OSCOA | OSCOA | OSCOA | OStrunk → OSOB |
| 输入“单提OSOB”中的 OSCOA | OSCOA | OSCOA | 不执行常规迁移 |
| 输入“不合并”中的单号 | 原单号 | 原单号 | 阻止迁移 |
| 同一单号命中多行 | 不自动选择 | 不自动选择 | 人工确认 |
| 无匹配 | 保留手工输入 | 保留手工输入 | 待确认 |

飞书读取使用用户身份。Trunk 表和海外 OB 表分别保存固定工作簿链接；执行时移除旧
`sheet` 参数，并读取 `index` 最小的可见页签，因此日常新增页签后不需要重新配置。
两张表的成功结果按工作簿分别缓存到：

```text
%LOCALAPPDATA%\SVNmate\MigrationGuard\ticket_mapping_cache_<hash>.json
```

缓存五分钟内直接复用；在线读取失败时使用最近一次成功缓存并显示警告。

海外 OB 表中的国内映射会生成两个阶段：

```text
SERIA -> OSCOA（国内 trunk -> 海外 trunk）
OSCOA -> OSCOA（海外 trunk -> OSOB）
```

第二阶段只有在第一阶段最终复核通过后才会启动；“纯海外单子”只进入第二阶段。
