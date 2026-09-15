---
name: "weapon-icon-library-sync"
description: "Builds and incrementally syncs formal-server weapon icons into Feishu Base. Invoke when collecting, exporting, uploading, refreshing, or auditing weapon icons."
---

# Weapon Icon Library Sync

用于从正式服装备配置中收集武器图标引用，解析 Unreal 资源，导出并校验 PNG，
再以稳定键增量同步到飞书多维表格“武器图标资源”。

本 Skill 只读游戏配置与 Unreal 资产，不修改 CSV、Excel、XML、`.uasset`、
`.uproject` 或导表产物。

## 适用场景

以下情况使用本 Skill：

- 首次建立在线武器图标库。
- 正式服新增武器后补充图标。
- 武器的 `ItemAttr.icon`、图标路径或引用关系发生变化。
- 检查 Base 是否漏图、重复上传或存在失效资源。
- 为 ConfigLinker 或其他工具维护可按图标 ID 查询的在线资源索引。
- 用户要求收集、整理、导出、上传或审计武器图标。

以下情况不使用：

- 特殊服 `csvspecial` 的独立武器图标。
- 修改武器配置、资源路径或 Unreal 资产本体。
- 仅查询某把武器名称、职业或模型关系。

## 依赖

- Python 3.11+
- Pillow
- Unreal Editor 4 command-line executable with Python support
- `lark-cli`
- 可访问 `NPC角色与对话资料库` 的飞书用户身份

执行 Base 操作时同时遵循：

- `lark-base`
- 授权异常时使用 `lark-shared`
- Windows 中文编码问题时使用 `powershell-encoding-guard`
- 交付前使用 `verification-before-completion`

## 必读资料

开始前完整读取：

- `references/current-base.md`
- `references/data-contract.md`
- `references/operations.md`
- 配置仓根目录 `AGENTS.md`

Base 坐标或字段变化时，以实时 `+base-get`、`+table-list` 和 `+field-list`
结果为准，并更新 `references/current-base.md`。

## 输入

默认项目结构：

```text
<workspace>/
├── doc/
│   └── csvdir/
│       ├── z装备表.csv
│       └── t图标资源表.csv
└── res/
    ├── Seria.uproject
    └── Content/Seria/UI/Texture/
```

只读取正式服 `doc/csvdir`，不读取 `csvspecial`。

## 稳定键与关系

```text
z装备表.ItemAttr.icon
  -> t图标资源表.UIResource.id
  -> UIResource.path
  -> res/Content/Seria/UI/Texture/<path>.uasset
```

稳定键：

```text
weapon-icon:<图标ID>
```

同一图标 ID 被多把武器引用时，只保留一条图标记录，并汇总引用武器 ID。
不同图标 ID 即使路径相同也保留为不同记录。

## 执行模式

每次开始先明确模式：

1. **预览模式（默认）**
   - 读取源数据和 Base。
   - 生成差异计划。
   - 不写 Base，不启动 Unreal，不上传附件。
2. **应用模式**
   - 只有用户审阅差异摘要并明确确认后进入。
   - 按“元数据 -> 导出 -> 上传 -> 回读”的顺序执行。

删除附件属于独立高风险步骤。即使用户已批准应用差异，执行附件删除前仍需再次列出
准确的 `record_id` 和 `file_token` 请求确认。

## 总体流程

### 1. 预检

1. 确认 `doc`、`res`、`.uproject` 和 UE 命令行路径。
2. 运行 `lark-cli auth status --json --verify`。
3. 实时确认 Base、Table 和字段。
4. 记录 SVN revision、两个 CSV 的 SHA-256、`svn status`。
5. 在仓库外创建本轮临时目录。

任何身份、字段、编码或路径异常都停止写入。

### 2. 盘点正式服源数据

运行：

```text
python scripts/collect_weapon_icons.py \
  --doc-dir <doc> \
  --res-dir <res> \
  --output-dir <temporary-run-directory>
```

脚本会：

- 使用 `utf-8-sig` 和结构化 CSV 解析双表头。
- 只保留装备部位为武器的正式服记录。
- 按正整数 `ItemAttr.icon` 聚合。
- 生成稳定键、引用武器、配置路径、UAsset 路径和导出清单。
- 检查重复武器 ID、图标 ID 路径冲突和缺失 UAsset。
- 拒绝把输出写入 `doc` 或 `res`。

不得手工按 Excel 列号或武器名称猜测资源。

### 3. 完整读取 Base

按 `references/operations.md` 将当前表投影为 NDJSON。必须确认：

- `has_more=false`；或已按 `next_offset` 读取全部分页。
- 所有分页 `rev` 相同。
- `图标键` 和 `record_id` 均存在。

不要从截断预览推断全表差异。

### 4. 生成差异计划

运行：

```text
python scripts/reconcile_weapon_icon_catalog.py \
  --source <weapon-icon-source.json> \
  --base-ndjson <base-records.ndjson> \
  --output <weapon-icon-plan.json>
```

先向用户展示：

- 源武器与唯一图标数量。
- 新增、更新、失效、导出、复用数量。
- 缺失图标表映射和缺失 UAsset。
- 重复稳定键或多附件冲突。

在用户明确批准前停留在此阶段。

### 5. 增量写入元数据

批准后：

1. 每批最多 200 条。
2. 同一 Table 串行写入。
3. 新记录先创建元数据，不把附件当普通 CellValue 写入。
4. 更新只提交变化字段。
5. 源中消失的键标记 `源状态=已失效`，不删除。
6. 创建后重新完整读取 Base，并重新对账以取得真实 `record_id`。

### 6. 导出与转换

只导出批准计划中的新增或路径变化资源：

1. 设置 `WEAPON_ICON_ASSET_MANIFEST`。
2. 设置 `WEAPON_ICON_ASSET_OUTPUT`。
3. 用 UE4Editor-Cmd 执行
   `scripts/export_unreal_weapon_icons.py`。
4. 读取每条 `export-results.json`，不能只看进程退出码。
5. 用 `scripts/prepare_weapon_icon_pngs.py` 转换 PNG。
6. 用 `scripts/validate_weapon_icon_catalog.py` 校验文件。

普通 `Texture2D` 直接导出。若资源为 `PaperSprite`，导出源图集并按
`source_uv`、`source_dimension` 裁切。其他资产类型视为导出失败。

不生成占位图片，不修改或保存 Unreal 资产。

### 7. 上传与回读

附件上传必须遵循：

- 每条记录只上传一个 PNG。
- stdout 和 stderr 分开捕获。
- 只解析 stdout 的 JSON。
- 上传命令不确定时先读回，禁止盲目重试。
- 操作间隔至少 450ms。
- 回读确认恰好一个有效附件后，才设 `导出状态=已导出`。

附件上传是 append 操作。检测到多个附件时停止自动处理并报告冲突。

路径变化需要替换图片时：

1. 保留旧附件。
2. 上传并验证新附件。
3. 再次请求用户确认。
4. 精确删除旧 file token。
5. 回读确认只剩一张。

### 8. 最终验证

再次完整读取 Base，并运行：

```text
python scripts/validate_weapon_icon_catalog.py \
  --source <weapon-icon-source.json> \
  --base-ndjson <base-final.ndjson> \
  --output <final-validation.json>
```

完成标准：

- 源和 Base 的有效稳定键集合一致。
- `图标键` 唯一。
- 所有源字段与当前正式服一致。
- 每条 `源状态=有效` 且 `导出状态=已导出` 的记录恰好有一个有效附件。
- 所有导出 PNG 可由 Pillow 打开。
- 未产生占位图或重复附件。
- 两个 CSV 的 SHA-256 未变化。
- `svn status`、`svn diff` 没有本次流程造成的配置或资源改动。

验证失败时不得声明同步成功。保留本轮临时目录用于排查。

## 脚本

| Script | Purpose |
| --- | --- |
| `scripts/collect_weapon_icons.py` | 从正式服 CSV 生成标准源清单 |
| `scripts/reconcile_weapon_icon_catalog.py` | 与 Base NDJSON 生成只读差异计划 |
| `scripts/export_unreal_weapon_icons.py` | 在 Unreal 中导出 Texture2D/PaperSprite |
| `scripts/prepare_weapon_icon_pngs.py` | 转换、缩放并校验 PNG |
| `scripts/validate_weapon_icon_catalog.py` | 校验本地 PNG 与最终 Base 状态 |

## 临时文件

所有 manifest、NDJSON、TGA、PNG 和批量写入 JSON 必须位于仓库外临时目录。

- 成功上传并回读后删除。
- 失败时保留并报告路径。
- 不把临时图片、Base 导出或认证信息打包进 Skill。

## 汇报格式

最终回复必须包含：

- 执行模式：预览 / 应用。
- Base 链接与目标表。
- SVN revision 与源文件 SHA-256。
- 正式服武器数、带图标武器数、唯一图标数。
- 新增、更新、失效、导出、复用数量。
- 上传成功、失败和多附件冲突数量。
- 缺失图标映射与缺失 UAsset。
- 最终验证结果。
- 临时目录是否已删除。
- 游戏配置校验或导表是否运行。

未修改游戏配置时明确写：

```text
未运行游戏配置校验或导表；原因：本次只读正式服 CSV 和 Unreal 资源，并更新在线图标库。
```
