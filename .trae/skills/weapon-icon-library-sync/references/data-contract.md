# Weapon Icon Data Contract

## Scope

The catalog represents weapon icon resources referenced by the formal-server
equipment table only.

Inputs:

- `<doc>/csvdir/z装备表.csv`
- `<doc>/csvdir/t图标资源表.csv`
- `<res>/Content/Seria/UI/Texture/**/*.uasset`

All source files are read-only. The workflow must not modify CSV, Excel,
XML, `.uasset`, `.uproject`, or generated game data.

## CSV Parsing

Both CSV files use two header rows:

1. Member-name row.
2. Chinese-label row.

Read with `utf-8-sig` and Python's `csv` module. Normalize a member name by
removing a leading `##&`; do not identify columns by a hard-coded Excel
position.

Required equipment members:

- `ItemAttr.id`
- `ItemAttr.name`
- `ItemAttr.icon`
- `EquipAttr.part`
- `EquipAttr.partname`

Required icon members:

- `UIResource.id`
- `UIResource.path`

A row is a weapon when either:

- `EquipAttr.partname` starts with `武器-`; or
- `100 <= EquipAttr.part < 200`.

Empty, zero, or negative `ItemAttr.icon` values do not create catalog rows.

## Identity and Aggregation

Stable key:

```text
weapon-icon:<positive icon ID>
```

One icon record aggregates every active formal-server weapon that references
the same icon ID.

- `引用武器ID`: ascending unique equipment IDs joined by commas.
- `引用武器数量`: count of those unique IDs.
- `代表武器名`: name belonging to the smallest equipment ID.
- Two icon IDs remain separate even when they resolve to the same path.
- One icon ID resolving to different paths is a blocking conflict.
- Duplicate weapon equipment IDs are a blocking conflict.

## Path Mapping

For a normal `UIResource.path` value:

```text
Frames/Equipicon/Equipicon_1572
```

derive:

```text
Unreal package:
  /Game/Seria/UI/Texture/Frames/Equipicon/Equipicon_1572

Repository-relative UAsset:
  res/Content/Seria/UI/Texture/Frames/Equipicon/Equipicon_1572.uasset

PNG filename:
  weapon_icon_201572.png
```

Do not infer or repair a path from a weapon name. A missing icon-table row or
missing `.uasset` is reported as `源文件缺失`; no placeholder image is created.

## Generated Artifacts

`collect_weapon_icons.py` writes these files outside the source repositories:

### `weapon-icon-source.json`

Canonical source snapshot. Each item contains:

```json
{
  "key": "weapon-icon:201572",
  "icon_id": 201572,
  "config_path": "Frames/Equipicon/Equipicon_1572",
  "asset_path": "/Game/Seria/UI/Texture/Frames/Equipicon/Equipicon_1572",
  "uasset_path": "res/Content/Seria/UI/Texture/Frames/Equipicon/Equipicon_1572.uasset",
  "absolute_uasset_path": "C:\\trunk\\res\\Content\\...",
  "source_exists": true,
  "filename": "weapon_icon_201572.png",
  "weapon_ids": [559001, 610001],
  "weapon_names": ["誓约剑·穹谕", "85深渊史诗武器"],
  "representative_weapon_name": "誓约剑·穹谕"
}
```

The root object also records source SHA-256 values and aggregate counts.

### `unreal-export-manifest.json`

Minimal manifest consumed by Unreal:

```json
[
  {
    "key": "weapon-icon:201572",
    "asset_path": "/Game/Seria/UI/Texture/Frames/Equipicon/Equipicon_1572",
    "filename": "weapon_icon_201572.png"
  }
]
```

Only entries whose `.uasset` exists are included.

### `base-record-fields.json`

Source-derived Base field maps. This is not a direct single-call batch
payload because Base writes must be split into at most 200 records and must
first be reconciled with existing records.

### `weapon-icon-plan.json`

Read-only reconciliation plan with:

- `create_records`
- `update_records`
- `export_records`
- `verify_existing_attachments`
- `reusable_records`
- `inactive_records`
- `conflicts`

Do not apply a plan containing conflicts.

## Ownership Rules

Source-owned fields may be updated from the canonical source snapshot:

- 图标键
- 图标ID
- 配置路径
- UAsset路径
- 源状态
- 引用武器数量
- 引用武器ID
- 代表武器名

Pipeline-owned fields:

- 预览图
- 导出状态

An unchanged source path with one valid attachment must reuse the attachment.
Do not replace it just because the source manifest was regenerated.

## Lifecycle

- New key: create metadata with `源状态=有效`; export and upload when source
  exists.
- Existing key, metadata changed: update only changed source-owned fields.
- Existing key, path changed: set `导出状态=待导出`, export a new image, and
  preserve the old attachment until the replacement passes read-back.
- Source key missing: set `源状态=已失效`; never delete automatically.
- Key returns: restore `源状态=有效`.
- Export failure: set `导出状态=导出失败`; never upload a placeholder.
- Missing source file: set `导出状态=源文件缺失`.

## Attachment Invariants

An active exported record must have exactly one attachment.

Attachment upload appends to the cell. Therefore:

- Never retry an upload solely because stderr contains progress text.
- Capture stdout and stderr separately.
- Parse success JSON from stdout only.
- If success is uncertain, read the record before retrying.
- Multiple attachments are a conflict, not a normal retry condition.
- Removing an attachment is a high-risk operation and requires a separate
  explicit confirmation with exact record ID and file token.

## Completion Invariants

- Source stable keys are unique.
- Base stable keys are unique.
- Every positive referenced icon ID resolves to at most one config path.
- Every resolved config path points to an existing `.uasset`.
- Every expected PNG is readable, non-empty, and has positive dimensions.
- Every active exported Base record has exactly one readable attachment.
- Source and Base source-owned fields match.
- No configuration or Unreal source file hash changed during the run.
