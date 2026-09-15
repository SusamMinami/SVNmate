# Weapon Icon Operations

All examples use PowerShell. Replace paths only after confirming the local
workspace. Keep every generated file outside `doc` and `res`.

## 1. Preflight

```powershell
$SkillDir = "<skill-directory>"
$DocDir = "C:\trunk\doc"
$ResDir = "C:\trunk\res"
$RunDir = Join-Path $env:TEMP ("weapon-icon-sync-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$BaseToken = "InxgbLPW1a8WiRs2KR4cDmevnhg"
$TableId = "tblSOKLfpRQ1nsnQ"
$UProject = Join-Path $ResDir "Seria.uproject"
$UEEditor = "<absolute-path-to-UE4Editor-Cmd.exe>"

New-Item -ItemType Directory -Force $RunDir | Out-Null
lark-cli auth status --json --verify
lark-cli base +base-get --base-token $BaseToken --as user --json
lark-cli base +table-list --base-token $BaseToken --as user --json
lark-cli base +field-list --base-token $BaseToken --table-id $TableId --as user --json
```

Stop when:

- user identity is not ready;
- the Base or table cannot be resolved;
- required fields are missing or have incompatible types;
- `Seria.uproject`, either CSV, or the resource directory is missing.

## 2. Build the Source Snapshot

```powershell
python "$SkillDir\scripts\collect_weapon_icons.py" `
  --doc-dir $DocDir `
  --res-dir $ResDir `
  --output-dir $RunDir
```

Inspect:

- `$RunDir\collection-summary.json`
- `$RunDir\weapon-icon-source.json`
- unresolved icon IDs;
- missing `.uasset` IDs;
- weapon and unique-icon counts.

Any conflicting duplicate ID is a blocking error.

## 3. Export the Complete Base Scope

The current table is below the 2,000-row single-page limit, but always check
`has_more`. If it becomes true, continue with `next_offset` and reconcile only
after every page is available at the same Base revision.

```powershell
lark-cli base +record-list `
  --base-token $BaseToken `
  --table-id $TableId `
  --field-id 图标键 `
  --field-id 图标ID `
  --field-id 配置路径 `
  --field-id UAsset路径 `
  --field-id 预览图 `
  --field-id 导出状态 `
  --field-id 源状态 `
  --field-id 引用武器数量 `
  --field-id 引用武器ID `
  --field-id 代表武器名 `
  --limit 2000 `
  --format ndjson `
  --output "$RunDir\base-records.ndjson" `
  --overwrite `
  --as user
```

## 4. Produce a Read-Only Plan

```powershell
python "$SkillDir\scripts\reconcile_weapon_icon_catalog.py" `
  --source "$RunDir\weapon-icon-source.json" `
  --base-ndjson "$RunDir\base-records.ndjson" `
  --output "$RunDir\weapon-icon-plan.json"
```

Present the summary and stop for explicit user confirmation before any Base
write. The checkpoint must include:

- create count;
- metadata update count;
- mark-inactive count;
- export/upload count;
- existing-attachment verification count;
- conflicts;
- unresolved resource and missing `.uasset` counts.

Do not apply a plan containing duplicate keys or multiple-attachment
conflicts.

## 5. Apply Metadata After Approval

Create or update at most 200 records per call and execute batches serially.
Use JSON files for non-trivial payloads.

Create payload shape:

```json
{
  "create_records": [
    {
      "图标键": "weapon-icon:201572",
      "图标ID": "201572",
      "配置路径": "Frames/Equipicon/Equipicon_1572",
      "UAsset路径": "res/Content/Seria/UI/Texture/Frames/Equipicon/Equipicon_1572.uasset",
      "导出状态": ["待导出"],
      "源状态": ["有效"],
      "引用武器数量": 15,
      "引用武器ID": "559001,610001",
      "代表武器名": "誓约剑·穹谕"
    }
  ]
}
```

```powershell
lark-cli base +record-batch-create `
  --base-token $BaseToken `
  --table-id $TableId `
  --json "@$RunDir\create-batch-01.json" `
  --as user
```

Update payload shape:

```json
{
  "update_records": {
    "recxxxxxxxxxxx": {
      "引用武器数量": 15,
      "引用武器ID": "559001,610001"
    }
  }
}
```

```powershell
lark-cli base +record-batch-update `
  --base-token $BaseToken `
  --table-id $TableId `
  --json "@$RunDir\update-batch-01.json" `
  --as user
```

After creates, export the table again and rerun reconciliation so every upload
candidate has a real `record_id`. Do not infer record IDs from row order.

## 6. Export from Unreal

Only export keys listed by the approved plan. Filter
`unreal-export-manifest.json` to those keys before starting Unreal.

```powershell
$env:WEAPON_ICON_ASSET_MANIFEST = "$RunDir\approved-export-manifest.json"
$env:WEAPON_ICON_ASSET_OUTPUT = "$RunDir\unreal"

& $UEEditor $UProject `
  -Unattended `
  -NoSplash `
  -NoP4 `
  "-ExecutePythonScript=$SkillDir\scripts\export_unreal_weapon_icons.py"
```

The Unreal process can return non-zero after creating
`export-results.json`. Preserve that exit code in the report, but determine
per-resource success only from the result entry and the generated TGA file.

Convert to PNG:

```powershell
python "$SkillDir\scripts\prepare_weapon_icon_pngs.py" `
  "$RunDir\unreal\export-results.json" `
  "$RunDir\png"
```

Validate before upload:

```powershell
python "$SkillDir\scripts\validate_weapon_icon_catalog.py" `
  --source "$RunDir\weapon-icon-source.json" `
  --png-dir "$RunDir\png" `
  --output "$RunDir\png-validation.json"
```

When processing only an incremental subset, validate the subset by creating a
filtered source snapshot. Do not create placeholder images for failures.

## 7. Upload Attachments Safely

Upload one file per record:

```powershell
Push-Location $RunDir
try {
  lark-cli base +record-upload-attachment `
    --base-token $BaseToken `
    --table-id $TableId `
    --record-id <record_id> `
    --field-id 预览图 `
    --file ".\png\weapon_icon_<id>.png" `
    --as user `
    --json
} finally {
  Pop-Location
}
```

Mandatory retry rules:

1. `--file` must be relative to the command's current directory; absolute
   paths are rejected before upload.
2. Capture stdout and stderr separately.
3. Parse JSON from stdout only; progress text can be written to stderr.
4. Never merge streams with `2>&1` before JSON parsing.
5. If the command result is uncertain, read the attachment cell before
   retrying because upload appends.
6. Delay at least 450 ms between record operations.
7. Set `导出状态=已导出` only after read-back shows exactly one attachment
   with a non-empty file token and positive size.

Read back:

```powershell
lark-cli base +record-get `
  --base-token $BaseToken `
  --table-id $TableId `
  --record-id <record_id> `
  --field-id 图标键 `
  --field-id 预览图 `
  --field-id 导出状态 `
  --format ndjson `
  --output "$RunDir\readback-<id>.ndjson" `
  --overwrite `
  --as user
```

When replacing an existing image:

1. Keep the old attachment.
2. Upload the new PNG.
3. Read back and validate the new attachment.
4. Request a second explicit confirmation listing the exact record ID and old
   file token.
5. Only then remove the old token with
   `+record-remove-attachment --yes`.
6. Read back again and require exactly one attachment.

Never delete a Base record as part of routine synchronization.

## 8. Final Validation

Export the complete Base table again and run:

```powershell
python "$SkillDir\scripts\validate_weapon_icon_catalog.py" `
  --source "$RunDir\weapon-icon-source.json" `
  --base-ndjson "$RunDir\base-final.ndjson" `
  --output "$RunDir\final-validation.json"
```

Also verify:

- Base export completed with `has_more=false`;
- source and Base stable-key counts;
- every active exported record has exactly one attachment;
- no duplicate file tokens were introduced;
- the two source CSV SHA-256 values still match the snapshot;
- `svn status` and `svn diff` show no game-source changes.

Delete the temporary run directory only after successful read-back and final
reporting. Preserve it on failure for diagnosis.
