# 迁移单号识别与路由

> 文档状态：现行协议
>
> 路由按 2026-09-11 的 `migration_guard/ticket_mapping.py` 核对。
> 实际任务数量和页签名称属于运行时数据，不在本文固化。

## 旧迁移器兼容背景

以下描述外部 `SeriaMigrate.py` / `CheckValidCommit.py`，不是本仓库
MigrationGuard 当前实现，也不表示已接入 `commit_info.json` 导入。
修改本仓库解析器时直接读下方现行规则。

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

工具不会固定页签名称或记录数。固定表入口移除 URL 中旧的 `sheet` 参数，
按 `index` 升序扫描最多 12 个可见页签，选择第一张包含所需路线任务的页签，
并显示实际命中日期。不能因为最新页签只有纯海外任务就把 Trunk 入口判为空。
未传路线过滤时只读首张；直接给底层客户端显式 sheet ID 时只读指定页。
A 列按分段标题和下列格式识别：

| 分段 | 格式 | 路线 |
| --- | --- | --- |
| 标准国内迁移 | `OSCOA完整标题&&&&SERIA完整标题` | 国内主干 → 海外主干 |
| 纯海外单子 | 单个 OSCOA | 海外主干 → OSOB |
| 单提 OSOB | 单个 OSCOA | 不执行常规迁移 |
| 不合并 | SERIA 或 OSCOA | 阻止迁移 |

解析器保留分段状态，即使某一分段当前没有有效单号，后续新增任务也会直接按对应
路线处理。

## MigrationGuard 现行规则

| 输入/表格情况 | 源单号 | 目标单号 | 路线 |
| --- | --- | --- | --- |
| 输入 SERIA，命中 `&&&&` 行 | SERIA | OSCOA | 国内 trunk → 海外 trunk |
| 输入映射过的 OSCOA | 对应 SERIA | OSCOA | 国内 trunk → 海外 trunk |
| 输入“纯海外单子”中的 OSCOA | OSCOA | OSCOA | OStrunk → OSOB |
| 输入“单提OSOB”中的 OSCOA | OSCOA | OSCOA | 不执行常规迁移 |
| 输入“不合并”中的单号 | 原单号 | 原单号 | 阻止迁移 |
| 明确选择国内 trunk -> 国内 OB | SERIA | 相同 SERIA | 不查询飞书映射或海外远端状态 |
| 同一单号命中多行 | 不自动选择 | 不自动选择 | 人工确认 |
| 无匹配 | 保留手工输入 | 保留手工输入 | 待确认 |

飞书读取使用用户身份。Trunk 表和海外 OB 表分别保存固定工作簿链接，按上面的路线
扫描规则选页；没有命中时返回带警告的结果，不伪造匹配。两张表按工作簿分别缓存到：

```text
%LOCALAPPDATA%\SVNmate\MigrationGuard\ticket_mapping_cache_<hash>.json
```

五分钟内仅复用符合请求路线的缓存；在线读取失败时使用最近成功缓存并显示警告。

海外 OB 表中的国内映射会生成两个阶段：

```text
SERIA -> OSCOA（国内 trunk -> 海外 trunk）
OSCOA -> OSCOA（海外 trunk -> OSOB）
```

第二阶段只有在第一阶段最终复核通过后才会启动；“纯海外单子”只进入第二阶段。

修改后在仓库根运行 `python -B -m unittest test_ticket_mapping -v`。
