# Current Weapon Icon Base

## Deployment

- Base: `P6 - NPC角色资料库`
- URL: `https://bytedance.larkoffice.com/base/InxgbLPW1a8WiRs2KR4cDmevnhg`
- Base token: `InxgbLPW1a8WiRs2KR4cDmevnhg`
- Table: `武器图标资源`
- Table ID: `tblSOKLfpRQ1nsnQ`
- Default view ID: `vewpkQvXO3`
- Stable key: `图标键 = weapon-icon:<图标ID>`

These IDs are deployment coordinates, not a replacement for live discovery.
Before every write, run `+base-get`, `+table-list`, and `+field-list`.

## Fields

| Field | Field ID | Type | Ownership |
| --- | --- | --- | --- |
| 图标键 | `fldFV4bqlx` | text | Source-owned stable key |
| 图标ID | `fldz4YEDfN` | text | Source-owned |
| 配置路径 | `fldQDnu2fW` | text | Source-owned |
| UAsset路径 | `fldmDWYWCF` | text | Source-owned |
| 预览图 | `fldmV1ITmH` | attachment | Export pipeline |
| 导出状态 | `fldJKhO7op` | select | Export pipeline |
| 源状态 | `fldehSjvZy` | select | Reconciliation |
| 引用武器数量 | `fldCea5R8z` | number | Source-owned |
| 引用武器ID | `fldegyunQF` | text | Source-owned |
| 代表武器名 | `fldSrNhY6Z` | text | Source-owned |

`导出状态` options:

- `待导出`
- `已导出`
- `导出失败`
- `源文件缺失`

`源状态` options:

- `有效`
- `已失效`

## Last Verified Baseline

Verified on 2026-09-15:

- Records: 490
- Unique `图标键`: 490
- `源状态=有效`: 490
- `导出状态=已导出`: 490
- Records with exactly one attachment: 490
- Latest synchronized SVN revision: `2467331`
- Latest added key: `weapon-icon:101437`

This is a historical checkpoint, not a permanent expected count. Every run
must recompute the formal-server source and explain the delta.

## Source Chain

```text
csvdir/z装备表.csv
  ItemAttr.id
  ItemAttr.name
  ItemAttr.icon
  EquipAttr.part / EquipAttr.partname
        |
        v
csvdir/t图标资源表.csv
  UIResource.id
  UIResource.path
        |
        v
res/Content/Seria/UI/Texture/<UIResource.path>.uasset
```

Only formal-server `csvdir` participates. Do not read `csvspecial` for this
catalog.

Example:

```text
图标ID: 201572
图标键: weapon-icon:201572
配置路径: Frames/Equipicon/Equipicon_1572
UAsset路径:
  res/Content/Seria/UI/Texture/Frames/Equipicon/Equipicon_1572.uasset
PNG: weapon_icon_201572.png
```

## Client Contract

ConfigLinker only caches rows that satisfy all of the following:

- `源状态=有效`
- `导出状态=已导出`
- `预览图` has a usable attachment
- `图标ID` is a positive integer

Metadata is cached in:

```text
%LOCALAPPDATA%\SVNmate\ConfigLinker\weapon_icons.sqlite3
```

PNG files are downloaded on demand to:

```text
%LOCALAPPDATA%\SVNmate\ConfigLinker\weapon_icons
```

Never publish the local cache inside the ConfigLinker release package.
