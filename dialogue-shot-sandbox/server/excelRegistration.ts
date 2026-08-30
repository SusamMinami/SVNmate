import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import {
  mkdtemp,
  open,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type {
  NpcRegistrationWriteItem,
  NpcRegistrationWriteResult,
  NpcRegistrationWriteScope,
  MissionTargetUpdateItem,
  MissionTargetUpdateResult,
} from "../src/types";

const VectorSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

const RegistrationPathsSchema = z.object({
  missionTarget: z.string().trim().min(1),
  npc: z.string().trim().min(1),
  model: z.string().trim().min(1),
});

const RegistrationWriteSchema = z
  .object({
    scope: z.enum(["all", "npc_only", "target_only"]).default("all"),
    paths: RegistrationPathsSchema,
    items: z
      .array(
        z.object({
          actorRef: z.string().min(1),
          label: z.string().min(1),
          targetDescription: z.string().trim().default(""),
          classPath: z.string().startsWith("/Game/"),
          transform: z.object({
            location: VectorSchema,
            rotation: z.object({
              pitch: z.number().finite(),
              yaw: z.number().finite(),
              roll: z.number().finite(),
            }),
            scale: VectorSchema,
          }),
          mapId: z.string(),
          existingModelId: z.number().int().positive().nullable(),
          existingNpcId: z.number().int().positive().nullable(),
          existingTargetId: z.string().regex(/^\d+$/).nullable(),
          canTurn: z.boolean(),
          newNpc: z
            .object({
              name: z.string().trim().max(80),
              title: z.string().trim().max(80),
              canTurn: z.boolean(),
            })
            .nullable(),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((request, context) => {
    request.items.forEach((item, index) => {
      if (request.scope !== "npc_only" && !item.targetDescription) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "targetDescription"],
          message: "目标物写入必须提供描述",
        });
      }
      if (request.scope === "all" && !/^\d+$/.test(item.mapId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "mapId"],
          message: "完整注册必须提供 MapID",
        });
      }
      if (
        request.scope === "target_only" &&
        (!/^\d+$/.test(item.mapId) ||
          item.existingModelId === null ||
          item.existingNpcId === null ||
          item.existingTargetId !== null ||
          item.newNpc !== null)
      ) {
        context.addIssue({
          code: "custom",
          path: ["items", index],
          message: "仅注册目标物时必须复用现有模型和 NPC，并提供 MapID",
        });
      }
      if (
        request.scope === "npc_only" &&
        (item.existingModelId === null ||
          item.existingNpcId !== null ||
          item.existingTargetId !== null ||
          item.newNpc === null)
      ) {
        context.addIssue({
          code: "custom",
          path: ["items", index],
          message: "仅注册 NPC 时必须复用现有模型并创建新 NPC",
        });
      }
    });
  });

const TransformUpdateSchema = z
  .object({
    targetPath: z
      .string()
      .trim()
      .min(1),
    items: z
      .array(
        z.object({
          targetId: z.string().regex(/^\d+$/),
          mapId: z.string().regex(/^\d+$/),
          originalTransform: z.object({
            location: VectorSchema,
            rotation: z.object({
              pitch: z.number().finite(),
              yaw: z.number().finite(),
              roll: z.number().finite(),
            }),
          }),
          transform: z.object({
            location: VectorSchema,
            rotation: z.object({
              pitch: z.number().finite(),
              yaw: z.number().finite(),
              roll: z.number().finite(),
            }),
          }),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((request, context) => {
    const seen = new Set<string>();
    request.items.forEach((item, index) => {
      if (seen.has(item.targetId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "targetId"],
          message: `目标物 ID ${item.targetId} 重复`,
        });
      }
      seen.add(item.targetId);
    });
  });

const EXCEL_REGISTRATION_LOCK = join(
  tmpdir(),
  "shot-sandbox-excel-registration.lock",
);
const EXCEL_OPERATION_TIMEOUT_MS = 3 * 60_000;
const EXCEL_LOCK_WAIT_TIMEOUT_MS = EXCEL_OPERATION_TIMEOUT_MS + 5_000;

async function withExcelRegistrationLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + EXCEL_LOCK_WAIT_TIMEOUT_MS;
  while (true) {
    try {
      const handle = await open(EXCEL_REGISTRATION_LOCK, "wx");
      try {
        return await operation();
      } finally {
        await handle.close();
        await unlink(EXCEL_REGISTRATION_LOCK).catch(() => undefined);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      try {
        const lock = await stat(EXCEL_REGISTRATION_LOCK);
        if (Date.now() - lock.mtimeMs > 5 * 60_000) {
          await unlink(EXCEL_REGISTRATION_LOCK).catch(() => undefined);
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw statError;
      }
      if (Date.now() >= deadline) {
        throw new Error("另一个配表写入仍在进行，请稍后重试");
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
  }
}

export const EXCEL_REGISTRATION_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = (
  Get-Content -LiteralPath $env:SHOT_SANDBOX_REGISTRATION_PAYLOAD_PATH -Raw -Encoding UTF8 |
    ConvertFrom-Json
)
$scope = if ([string]::IsNullOrWhiteSpace([string]$request.scope)) {
  "all"
} else {
  [string]$request.scope
}
if ($scope -notin @("all", "npc_only", "target_only")) {
  throw "不支持的 NPC 注册范围：$scope"
}

function Invoke-ExcelAction(
  [scriptblock]$action,
  [string]$description
) {
  $lastError = $null
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    try {
      return & $action
    } catch [Runtime.InteropServices.COMException] {
      $lastError = $_.Exception
      Start-Sleep -Milliseconds 500
    }
  }
  throw "$description 失败：Excel 正忙或正处于单元格编辑状态，请退出编辑后重试。$($lastError.Message)"
}

function Get-ExcelApplication {
  try {
    return [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
  } catch [Runtime.InteropServices.COMException] {
    if ($_.Exception.HResult -ne -2147221021) {
      throw
    }
    return New-Object -ComObject Excel.Application
  }
}

$paths = @{
  missionTarget = [string]$request.paths.missionTarget
  npc = [string]$request.paths.npc
  model = [string]$request.paths.model
}
$requiredPaths = [Collections.Generic.HashSet[string]]::new(
  [StringComparer]::OrdinalIgnoreCase
)
foreach ($item in $request.items) {
  if ($null -eq $item.existingTargetId) {
    if ($scope -eq "npc_only") {
      [void]$requiredPaths.Add($paths.npc)
    } elseif ($scope -eq "target_only") {
      [void]$requiredPaths.Add($paths.missionTarget)
    } else {
      [void]$requiredPaths.Add($paths.missionTarget)
      if ($null -eq $item.existingModelId) {
        [void]$requiredPaths.Add($paths.model)
      }
      if ($null -eq $item.existingNpcId) {
        [void]$requiredPaths.Add($paths.npc)
      }
    }
  }
}
foreach ($path in $requiredPaths) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "找不到 Excel 源表：$path"
  }
}

function Get-Workbook([object]$excel, [string]$path) {
  $fullPath = [IO.Path]::GetFullPath($path)
  foreach ($book in $excel.Workbooks) {
    if ([string]::Equals(
      [IO.Path]::GetFullPath($book.FullName),
      $fullPath,
      [StringComparison]::OrdinalIgnoreCase
    )) {
      if ($book.ReadOnly) {
        throw "工作簿以只读方式打开：$path"
      }
      return $book
    }
  }
  $book = $excel.Workbooks.Open($path, 0, $false)
  if ($book.ReadOnly) {
    throw "工作簿无法写入：$path"
  }
  return $book
}

function Get-RangeValues(
  [object]$sheet,
  [int]$firstRow,
  [int]$lastRow,
  [int]$firstColumn,
  [int]$lastColumn,
  [string]$description
) {
  if ($lastRow -lt $firstRow) {
    return $null
  }
  $values = Invoke-ExcelAction {
    $rangeValues = $sheet.Range(
      $sheet.Cells.Item($firstRow, $firstColumn),
      $sheet.Cells.Item($lastRow, $lastColumn)
    ).Value2
    Write-Output -NoEnumerate $rangeValues
  } $description
  Write-Output -NoEnumerate $values
}

function Get-RangeValue(
  $values,
  [int]$rowOffset,
  [int]$columnOffset
) {
  if ($null -eq $values) {
    return $null
  }
  if ($values -is [Array]) {
    if ($values.Rank -eq 2) {
      return $values.GetValue(
        $values.GetLowerBound(0) + $rowOffset,
        $values.GetLowerBound(1) + $columnOffset
      )
    }
    return $values.GetValue($values.GetLowerBound(0) + $rowOffset)
  }
  if ($rowOffset -eq 0 -and $columnOffset -eq 0) {
    return $values
  }
  return $null
}

function Get-NextId(
  $values,
  [int]$rowCount,
  [int]$columnOffset,
  [int]$minimum,
  [int]$maximum
) {
  $maxId = $minimum - 1
  for ($rowOffset = 0; $rowOffset -lt $rowCount; $rowOffset++) {
    $raw = Get-RangeValue $values $rowOffset $columnOffset
    $value = 0
    if ($null -ne $raw -and [int]::TryParse([string]$raw, [ref]$value)) {
      if ($value -ge $minimum -and $value -le $maximum -and $value -gt $maxId) {
        $maxId = $value
      }
    }
  }
  if ($maxId + 1 -gt $maximum) {
    throw "ID 段 $minimum-$maximum 已无可用 ID"
  }
  return $maxId + 1
}

function Add-BlankRow([object]$sheet, [int]$row, [int]$columnCount) {
  [void](Invoke-ExcelAction {
    $sheet.Rows.Item($row).Insert(-4121, 0) | Out-Null
    $sheet.Range(
      $sheet.Cells.Item($row, 1),
      $sheet.Cells.Item($row, $columnCount)
    ).ClearContents() | Out-Null
  } "插入工作表行")
}

function Set-Cell([object]$sheet, [int]$row, [int]$column, $value) {
  [void](Invoke-ExcelAction {
    $cell = $sheet.Cells.Item($row, $column)
    if ($value -is [bool]) {
      $cell.Value2 = [bool]$value
    } elseif (
      $value -is [byte] -or
      $value -is [int16] -or
      $value -is [int32] -or
      $value -is [int64] -or
      $value -is [single] -or
      $value -is [double] -or
      $value -is [decimal]
    ) {
      $cell.Value2 = [double]$value
    } elseif ($null -eq $value) {
      $cell.ClearContents() | Out-Null
    } else {
      $cell.Value2 = [string]$value
    }
  } "写入单元格")
}

function Set-NewCell([object]$sheet, [int]$row, [int]$column, $value) {
  Set-Cell $sheet $row $column $value
  [void](Invoke-ExcelAction {
    $sheet.Cells.Item($row, $column).Font.Color = 255
  } "标记新增单元格")
}

function Format-Number([double]$value) {
  return $value.ToString("0.000000", [Globalization.CultureInfo]::InvariantCulture)
}

function Format-Vector($value) {
  return "(X=$(Format-Number $value.x),Y=$(Format-Number $value.y),Z=$(Format-Number $value.z))"
}

function Format-Rotator($value) {
  return "(Pitch=$(Format-Number $value.pitch),Yaw=$(Format-Number $value.yaw),Roll=$(Format-Number $value.roll))"
}

function Normalize-TransformText(
  [string]$value,
  [string[]]$fields
) {
  $numbers = @{}
  foreach ($match in [regex]::Matches(
    $value,
    "([A-Za-z]+)\s*=\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)"
  )) {
    $numbers[$match.Groups[1].Value.ToLowerInvariant()] =
      [double]::Parse(
        $match.Groups[2].Value,
        [Globalization.CultureInfo]::InvariantCulture
      )
  }
  if ($fields | Where-Object { -not $numbers.ContainsKey($_.ToLowerInvariant()) }) {
    return $value.Trim()
  }
  $parts = $fields | ForEach-Object {
    "$_=$(Format-Number $numbers[$_.ToLowerInvariant()])"
  }
  return "($([string]::Join(',', $parts)))"
}

function Get-ConfiguredPath([string]$classPath) {
  $normalized = $classPath.Replace("\", "/")
  if ($normalized -match "^(.+)\.[^\.]+_C$") {
    return $Matches[1]
  }
  return $normalized -replace "_C$", ""
}

function Add-IndexEntry([hashtable]$index, [string]$key, $value) {
  if (-not $index.ContainsKey($key)) {
    $index[$key] = [Collections.ArrayList]::new()
  }
  [void]$index[$key].Add($value)
}

function Get-TargetTransformKey(
  [string]$mapId,
  [string]$position,
  [string]$rotation
) {
  $normalizedPosition =
    Normalize-TransformText $position @("X", "Y", "Z")
  $normalizedRotation =
    Normalize-TransformText $rotation @("Pitch", "Yaw", "Roll")
  return [string]::Join(
    [char]31,
    @($mapId.Trim(), $normalizedPosition, $normalizedRotation)
  )
}

$createdModels = [Collections.ArrayList]::new()
$createdNpcs = [Collections.ArrayList]::new()
$createdTargets = [Collections.ArrayList]::new()
$reusedTargets = [Collections.ArrayList]::new()
$openedWorkbooks = [Collections.ArrayList]::new()
$modelByActor = @{}
$modelByPath = @{}
$npcByActor = @{}
$lastSheet = $null
$lastRow = 0
$excel = $null
$previousSecurity = $null

try {
  $excel = Invoke-ExcelAction {
    return Get-ExcelApplication
  } "连接 Excel"
  $previousSecurity = Invoke-ExcelAction {
    return $excel.AutomationSecurity
  } "读取 Excel 安全设置"
  [void](Invoke-ExcelAction {
    $excel.AutomationSecurity = 3
    $excel.Visible = $true
    $excel.DisplayAlerts = $false
  } "准备 Excel")

  $workbooks = @{}
  foreach ($path in $requiredPaths) {
    $book = Invoke-ExcelAction {
      return Get-Workbook $excel $path
    } "打开或查找工作簿 $path"
    $workbooks[$path] = $book
    [void]$openedWorkbooks.Add($path)
  }
  [void](Invoke-ExcelAction {
    $excel.DisplayAlerts = $true
  } "恢复 Excel 提示")

  $modelWorkbook = $workbooks[$paths.model]
  $modelSheet =
    if ($null -ne $modelWorkbook) {
      Invoke-ExcelAction {
        return $modelWorkbook.Worksheets.Item(1)
      } "读取模型资源工作表"
    } else { $null }
  $npcWorkbook = $workbooks[$paths.npc]
  $npcSheet =
    if ($null -ne $npcWorkbook) {
      Invoke-ExcelAction {
        return $npcWorkbook.Worksheets.Item(1)
      } "读取 NPC 工作表"
    } else { $null }
  $targetWorkbook = $workbooks[$paths.missionTarget]
  $targetSheet =
    if ($null -ne $targetWorkbook) {
      Invoke-ExcelAction {
        return $targetWorkbook.Worksheets.Item(1)
      } "读取目标物工作表"
    } else { $null }

  $modelLastRow = 2
  $modelRowCount = 0
  $modelValues = $null
  $modelEntriesById = @{}
  $modelRows = [Collections.ArrayList]::new()
  if ($null -ne $modelSheet) {
    $modelLastRow = [int](Invoke-ExcelAction {
      return $modelSheet.UsedRange.Rows.Count
    } "读取模型资源表行数")
    $modelRowCount = [Math]::Max(0, $modelLastRow - 2)
    $modelValues =
      Get-RangeValues $modelSheet 3 $modelLastRow 2 3 "批量读取模型资源表"
    for ($rowOffset = 0; $rowOffset -lt $modelRowCount; $rowOffset++) {
      $rowId = [string](Get-RangeValue $modelValues $rowOffset 0)
      $rowPath = [string](Get-RangeValue $modelValues $rowOffset 1)
      if (-not [string]::IsNullOrWhiteSpace($rowId)) {
        $entry = [PSCustomObject]@{
          row = $rowOffset + 3
          id = $rowId
          path = $rowPath
        }
        Add-IndexEntry $modelEntriesById $rowId $entry
        [void]$modelRows.Add($entry)
      }
      if (-not [string]::IsNullOrWhiteSpace($rowPath)) {
        $pathKey = $rowPath.Replace("\", "/").ToLowerInvariant()
        if (-not $modelByPath.ContainsKey($pathKey)) {
          $parsedModelId = 0
          if ([int]::TryParse($rowId, [ref]$parsedModelId)) {
            $modelByPath[$pathKey] = $parsedModelId
          }
        }
      }
    }
  }

  $npcLastRow = 2
  $npcRowCount = 0
  $npcValues = $null
  $npcEntriesById = @{}
  if ($null -ne $npcSheet) {
    $npcLastRow = [int](Invoke-ExcelAction {
      return $npcSheet.UsedRange.Rows.Count
    } "读取 NPC 表行数")
    $npcRowCount = [Math]::Max(0, $npcLastRow - 2)
    $npcValues =
      Get-RangeValues $npcSheet 3 $npcLastRow 2 5 "批量读取 NPC 表"
    for ($rowOffset = 0; $rowOffset -lt $npcRowCount; $rowOffset++) {
      $rowId = [string](Get-RangeValue $npcValues $rowOffset 0)
      if ([string]::IsNullOrWhiteSpace($rowId)) {
        continue
      }
      Add-IndexEntry $npcEntriesById $rowId ([PSCustomObject]@{
        row = $rowOffset + 3
        id = $rowId
        modelId = [string](Get-RangeValue $npcValues $rowOffset 3)
      })
    }
  }

  $targetLastRow = 2
  $targetRowCount = 0
  $targetValues = $null
  $targetIdsByTransform = @{}
  if ($null -ne $targetSheet) {
    $targetLastRow = [int](Invoke-ExcelAction {
      return $targetSheet.UsedRange.Rows.Count
    } "读取目标物表行数")
    $targetRowCount = [Math]::Max(0, $targetLastRow - 2)
    $targetValues =
      Get-RangeValues $targetSheet 3 $targetLastRow 2 13 "批量读取目标物表"
    for ($rowOffset = 0; $rowOffset -lt $targetRowCount; $rowOffset++) {
      $rowId = [string](Get-RangeValue $targetValues $rowOffset 0)
      $mapId = [string](Get-RangeValue $targetValues $rowOffset 9)
      $position = [string](Get-RangeValue $targetValues $rowOffset 10)
      $rotation = [string](Get-RangeValue $targetValues $rowOffset 11)
      if (-not [string]::IsNullOrWhiteSpace($rowId)) {
        Add-IndexEntry $targetIdsByTransform (
          Get-TargetTransformKey $mapId $position $rotation
        ) $rowId
      }
    }
  }

  # Validate every CSV-derived foreign key before inserting into any workbook.
  foreach ($item in $request.items) {
    if (
      $scope -eq "npc_only" -and
      (
        $null -eq $item.existingModelId -or
        $null -ne $item.existingNpcId -or
        $null -ne $item.existingTargetId -or
        $null -eq $item.newNpc
      )
    ) {
      throw "Actor $($item.label) 仅注册 NPC 时必须复用现有模型并创建新 NPC"
    }
    if ($null -ne $item.existingTargetId) {
      continue
    }
    if ($scope -eq "all") {
      $configuredPath = Get-ConfiguredPath $item.classPath
      if ($null -ne $item.existingModelId) {
        if ($null -ne $modelSheet) {
          $modelEntries =
            @($modelEntriesById[[string]$item.existingModelId])
          if ($modelEntries.Count -ne 1) {
            throw "模型 ID $($item.existingModelId) 在模型资源表中不存在或不唯一"
          }
          $existingPath = [string]$modelEntries[0].path
          if (-not [string]::Equals(
            $existingPath.Replace("\", "/"),
            $configuredPath,
            [StringComparison]::OrdinalIgnoreCase
          )) {
            throw "模型 ID $($item.existingModelId) 与 Actor $($item.label) 的资源路径不一致"
          }
        }
      }
      if ($null -ne $item.existingNpcId) {
        if ($null -eq $item.existingModelId) {
          throw "NPC ID $($item.existingNpcId) 缺少可验证的模型 ID"
        }
        if ($null -ne $npcSheet) {
          $npcEntries = @($npcEntriesById[[string]$item.existingNpcId])
          if ($npcEntries.Count -ne 1) {
            throw "NPC ID $($item.existingNpcId) 在 NPC 表中不存在或不唯一"
          }
          $npcModelId = [string]$npcEntries[0].modelId
          if ($npcModelId -ne [string]$item.existingModelId) {
            throw "NPC ID $($item.existingNpcId) 引用的模型与 Actor $($item.label) 不一致"
          }
        }
      } elseif ($null -eq $item.newNpc) {
        throw "Actor $($item.label) 没有可复用 NPC，也没有填写新 NPC"
      }
    }
  }

  $pendingItems = @(
    $request.items | Where-Object { $null -eq $_.existingTargetId }
  )
  $existingTargetByActor = @{}
  if ($scope -ne "npc_only") {
    foreach ($item in $pendingItems) {
      $position = Format-Vector $item.transform.location
      $rotation = Format-Rotator $item.transform.rotation
      $targetKey =
        Get-TargetTransformKey ([string]$item.mapId) $position $rotation
      $existingTargets =
        if ($targetIdsByTransform.ContainsKey($targetKey)) {
          @($targetIdsByTransform[$targetKey])
        } else {
          @()
        }
      if ($existingTargets.Count -gt 1) {
        throw "Actor $($item.label) 在 MapID $($item.mapId) 中匹配到多个目标物"
      }
      if ($existingTargets.Count -eq 1) {
        $existingTargetByActor[$item.actorRef] = [string]$existingTargets[0]
      }
    }
  }

  $needsNewModel = @(
    $pendingItems | Where-Object { $null -eq $_.existingModelId }
  ).Count -gt 0 -and $scope -eq "all"
  $needsNewNpc = @(
    $pendingItems | Where-Object { $null -eq $_.existingNpcId }
  ).Count -gt 0 -and $scope -ne "target_only"
  $needsNewTarget = @(
    $pendingItems | Where-Object {
      -not $existingTargetByActor.ContainsKey($_.actorRef)
    }
  ).Count -gt 0 -and $scope -ne "npc_only"
  $nextModelId =
    if ($needsNewModel) {
      Get-NextId $modelValues $modelRowCount 0 200000 299999
    } else { $null }
  $nextNpcId =
    if ($needsNewNpc) {
      Get-NextId $npcValues $npcRowCount 0 1 2147483647
    } else { $null }
  $nextTargetId =
    if ($needsNewTarget) {
      Get-NextId $targetValues $targetRowCount 0 1 2147483647
    } else { $null }
  $newModelUpperBound = @(
    $pendingItems | Where-Object { $null -eq $_.existingModelId }
  ).Count
  $newNpcCount = @(
    $pendingItems | Where-Object { $null -eq $_.existingNpcId }
  ).Count
  $newTargetCount = @(
    $pendingItems | Where-Object {
      -not $existingTargetByActor.ContainsKey($_.actorRef)
    }
  ).Count
  if (
    $null -ne $nextModelId -and
    $nextModelId + $newModelUpperBound - 1 -gt 299999
  ) {
    throw "模型 ID 段 200000-299999 剩余空间不足"
  }
  if (
    $null -ne $nextNpcId -and
    $nextNpcId + $newNpcCount - 1 -gt 2147483647
  ) {
    throw "NPC ID 已无足够可用空间"
  }
  if (
    $null -ne $nextTargetId -and
    $nextTargetId + $newTargetCount - 1 -gt 2147483647
  ) {
    throw "目标物 ID 已无足够可用空间"
  }

  foreach ($item in $request.items) {
    if ($null -ne $item.existingTargetId) {
      continue
    }
    if ($scope -ne "all") {
      $modelByActor[$item.actorRef] = [int]$item.existingModelId
      continue
    }
    $configuredPath = Get-ConfiguredPath $item.classPath
    if ($null -ne $item.existingModelId) {
      if ($null -ne $modelSheet) {
        $modelEntries =
          @($modelEntriesById[[string]$item.existingModelId])
        if ($modelEntries.Count -ne 1) {
          throw "模型 ID $($item.existingModelId) 在模型资源表中不存在或不唯一"
        }
        $existingPath = [string]$modelEntries[0].path
        if (-not [string]::Equals(
          $existingPath.Replace("\", "/"),
          $configuredPath,
          [StringComparison]::OrdinalIgnoreCase
        )) {
          throw "模型 ID $($item.existingModelId) 与 Actor $($item.label) 的资源路径不一致"
        }
      }
      $modelByActor[$item.actorRef] = [int]$item.existingModelId
      continue
    }
    $pathKey = $configuredPath.ToLowerInvariant()
    if ($modelByPath.ContainsKey($pathKey)) {
      $modelByActor[$item.actorRef] = $modelByPath[$pathKey]
      continue
    }
    if ($null -eq $modelWorkbook) {
      throw "模型资源表未打开"
    }
    $insertRow = $modelLastRow + 1
    foreach ($modelRow in $modelRows) {
      $rowId = 0
      if (
        [int]::TryParse([string]$modelRow.id, [ref]$rowId) -and
        $rowId -gt $nextModelId
      ) {
        $insertRow = [int]$modelRow.row
        break
      }
    }
    Add-BlankRow $modelSheet $insertRow 4
    foreach ($modelRow in $modelRows) {
      if ([int]$modelRow.row -ge $insertRow) {
        $modelRow.row = [int]$modelRow.row + 1
      }
    }
    Set-NewCell $modelSheet $insertRow 1 0
    Set-NewCell $modelSheet $insertRow 2 $nextModelId
    Set-NewCell $modelSheet $insertRow 3 $configuredPath
    $existingId = $nextModelId
    $newModelEntry = [PSCustomObject]@{
      row = $insertRow
      id = [string]$existingId
      path = $configuredPath
    }
    [void]$modelRows.Add($newModelEntry)
    Add-IndexEntry $modelEntriesById ([string]$existingId) $newModelEntry
    $modelLastRow++
    [void]$createdModels.Add(
      [PSCustomObject]@{ actorRef = $item.actorRef; id = $existingId }
    )
    $nextModelId++
    $lastSheet = $modelSheet
    $lastRow = $insertRow
    $modelByPath[$pathKey] = $existingId
    $modelByActor[$item.actorRef] = $existingId
  }

  foreach ($item in $request.items) {
    if ($null -ne $item.existingTargetId) {
      continue
    }
    if ($null -ne $item.existingNpcId) {
      $npcByActor[$item.actorRef] = [int]$item.existingNpcId
      continue
    }
    if ($null -eq $item.newNpc) {
      throw "Actor $($item.label) 没有可复用 NPC，也没有填写新 NPC"
    }
    if ($null -eq $npcWorkbook) {
      throw "NPC 表未打开"
    }
    $npcLastRow++
    $row = $npcLastRow
    Add-BlankRow $npcSheet $row 35
    Set-NewCell $npcSheet $row 1 0
    Set-NewCell $npcSheet $row 2 $nextNpcId
    Set-NewCell $npcSheet $row 3 $item.label
    Set-NewCell $npcSheet $row 4 $item.newNpc.name
    Set-NewCell $npcSheet $row 5 $modelByActor[$item.actorRef]
    Set-NewCell $npcSheet $row 8 $item.newNpc.title
    Set-NewCell $npcSheet $row 10 $false
    Set-NewCell $npcSheet $row 11 $false
    Set-NewCell $npcSheet $row 14 0
    Set-NewCell $npcSheet $row 19 $item.newNpc.canTurn
    Set-NewCell $npcSheet $row 20 1
    Set-NewCell $npcSheet $row 21 "(Pitch=-20,Yaw=40,Roll=0)"
    Set-NewCell $npcSheet $row 22 400
    Set-NewCell $npcSheet $row 24 200
    Set-NewCell $npcSheet $row 25 1500
    Set-NewCell $npcSheet $row 26 55
    Set-NewCell $npcSheet $row 27 $false
    Set-NewCell $npcSheet $row 28 $false
    Set-NewCell $npcSheet $row 29 $true
    Set-NewCell $npcSheet $row 30 0
    $npcByActor[$item.actorRef] = $nextNpcId
    [void]$createdNpcs.Add(
      [PSCustomObject]@{ actorRef = $item.actorRef; id = $nextNpcId }
    )
    $nextNpcId++
    $lastSheet = $npcSheet
    $lastRow = $row
  }

  if ($scope -ne "npc_only") {
    foreach ($item in $request.items) {
      if ($null -ne $item.existingTargetId) {
        [void]$reusedTargets.Add(
          [PSCustomObject]@{
            actorRef = $item.actorRef
            id = [string]$item.existingTargetId
          }
        )
        continue
      }
      if ($null -eq $targetWorkbook) {
        throw "目标物表未打开"
      }
      $position = Format-Vector $item.transform.location
      $rotation = Format-Rotator $item.transform.rotation
      if ($existingTargetByActor.ContainsKey($item.actorRef)) {
        [void]$reusedTargets.Add(
          [PSCustomObject]@{
            actorRef = $item.actorRef
            id = [string]$existingTargetByActor[$item.actorRef]
          }
        )
        continue
      }
      $targetLastRow++
      $row = $targetLastRow
      Add-BlankRow $targetSheet $row 33
      Set-NewCell $targetSheet $row 1 0
      Set-NewCell $targetSheet $row 2 $nextTargetId
      Set-NewCell $targetSheet $row 4 $item.targetDescription
      Set-NewCell $targetSheet $row 5 1
      Set-NewCell $targetSheet $row 6 $npcByActor[$item.actorRef]
      Set-NewCell $targetSheet $row 7 0
      Set-NewCell $targetSheet $row 11 ([int]$item.mapId)
      Set-NewCell $targetSheet $row 12 $position
      Set-NewCell $targetSheet $row 13 $rotation
      Set-NewCell $targetSheet $row 14 $false
      Set-NewCell $targetSheet $row 15 0
      Set-NewCell $targetSheet $row 16 $item.canTurn
      Set-NewCell $targetSheet $row 17 "瞬间消失"
      [void]$createdTargets.Add(
        [PSCustomObject]@{ actorRef = $item.actorRef; id = $nextTargetId }
      )
      $nextTargetId++
      $lastSheet = $targetSheet
      $lastRow = $row
    }
  }

  [void](Invoke-ExcelAction {
    $excel.AutomationSecurity = $previousSecurity
  } "恢复 Excel 安全设置")
  if ($null -ne $lastSheet) {
    try {
      $lastSheet.Parent.Activate() | Out-Null
      $lastSheet.Activate() | Out-Null
      $excel.Goto($lastSheet.Cells.Item($lastRow, 2), $true) | Out-Null
    } catch {
      # Selection is best-effort; the registration values have already been written.
    }
  }
  [PSCustomObject]@{
    ok = $true
    createdModels = @($createdModels)
    createdNpcs = @($createdNpcs)
    createdTargets = @($createdTargets)
    reusedTargets = @($reusedTargets)
    openedWorkbooks = @($openedWorkbooks)
  } | ConvertTo-Json -Depth 6 -Compress
} catch {
  if ($null -ne $excel) {
    if ($null -ne $previousSecurity) {
      try { $excel.AutomationSecurity = $previousSecurity } catch {}
    }
    try { $excel.Visible = $true } catch {}
    try { $excel.DisplayAlerts = $true } catch {}
  }
  [PSCustomObject]@{
    ok = $false
    message = $_.Exception.Message
  } | ConvertTo-Json -Compress
  exit 1
}
`;

export const EXCEL_TARGET_UPDATE_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = (
  Get-Content -LiteralPath $env:SHOT_SANDBOX_TARGET_UPDATE_PAYLOAD_PATH -Raw -Encoding UTF8 |
    ConvertFrom-Json
)
$targetPath = [string]$request.targetPath

function Invoke-ExcelAction(
  [scriptblock]$action,
  [string]$description
) {
  $lastError = $null
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    try {
      return & $action
    } catch [Runtime.InteropServices.COMException] {
      $lastError = $_.Exception
      Start-Sleep -Milliseconds 500
    }
  }
  throw "$description 失败：Excel 正忙或正处于单元格编辑状态，请退出编辑后重试。$($lastError.Message)"
}

function Get-ExcelApplication {
  try {
    return [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
  } catch [Runtime.InteropServices.COMException] {
    if ($_.Exception.HResult -ne -2147221021) {
      throw
    }
    return New-Object -ComObject Excel.Application
  }
}

function Find-OpenWorkbook([object]$excel, [string]$path) {
  $fullPath = [IO.Path]::GetFullPath($path)
  foreach ($book in $excel.Workbooks) {
    if ([string]::Equals(
      [IO.Path]::GetFullPath($book.FullName),
      $fullPath,
      [StringComparison]::OrdinalIgnoreCase
    )) {
      if ($book.ReadOnly) {
        throw "工作簿以只读方式打开：$path"
      }
      return $book
    }
  }
  return $null
}

function Get-RangeValues(
  [object]$sheet,
  [int]$firstRow,
  [int]$lastRow,
  [int]$firstColumn,
  [int]$lastColumn,
  [string]$description
) {
  if ($lastRow -lt $firstRow) {
    return $null
  }
  $values = Invoke-ExcelAction {
    $rangeValues = $sheet.Range(
      $sheet.Cells.Item($firstRow, $firstColumn),
      $sheet.Cells.Item($lastRow, $lastColumn)
    ).Value2
    Write-Output -NoEnumerate $rangeValues
  } $description
  Write-Output -NoEnumerate $values
}

function Get-RangeValue(
  $values,
  [int]$rowOffset,
  [int]$columnOffset
) {
  if ($null -eq $values) {
    return $null
  }
  if ($values -is [Array]) {
    if ($values.Rank -eq 2) {
      return $values.GetValue(
        $values.GetLowerBound(0) + $rowOffset,
        $values.GetLowerBound(1) + $columnOffset
      )
    }
    return $values.GetValue($values.GetLowerBound(0) + $rowOffset)
  }
  if ($rowOffset -eq 0 -and $columnOffset -eq 0) {
    return $values
  }
  return $null
}

function Format-Number([double]$value) {
  return $value.ToString("0.000000", [Globalization.CultureInfo]::InvariantCulture)
}

function Format-Vector($value) {
  return "(X=$(Format-Number $value.x),Y=$(Format-Number $value.y),Z=$(Format-Number $value.z))"
}

function Format-Rotator($value) {
  return "(Pitch=$(Format-Number $value.pitch),Yaw=$(Format-Number $value.yaw),Roll=$(Format-Number $value.roll))"
}

function Read-Component([string]$text, [string]$name) {
  $number = "[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?"
  $match = [regex]::Match(
    $text,
    "(?i)(?:^|[^A-Za-z])$name\s*=\s*($number)"
  )
  if (-not $match.Success) {
    return $null
  }
  return [double]::Parse(
    $match.Groups[1].Value,
    [Globalization.CultureInfo]::InvariantCulture
  )
}

function Test-VectorEqual([string]$text, $value) {
  $x = Read-Component $text "X"
  $y = Read-Component $text "Y"
  $z = Read-Component $text "Z"
  return (
    $null -ne $x -and $null -ne $y -and $null -ne $z -and
    [Math]::Abs($x - [double]$value.x) -le 0.000001 -and
    [Math]::Abs($y - [double]$value.y) -le 0.000001 -and
    [Math]::Abs($z - [double]$value.z) -le 0.000001
  )
}

function Test-RotatorEqual([string]$text, $value) {
  $pitch = Read-Component $text "Pitch"
  $yaw = Read-Component $text "Yaw"
  $roll = Read-Component $text "Roll"
  return (
    $null -ne $pitch -and $null -ne $yaw -and $null -ne $roll -and
    [Math]::Abs($pitch - [double]$value.pitch) -le 0.000001 -and
    [Math]::Abs($yaw - [double]$value.yaw) -le 0.000001 -and
    [Math]::Abs($roll - [double]$value.roll) -le 0.000001
  )
}

$updatedTargets = [Collections.ArrayList]::new()
$unchangedTargetIds = [Collections.ArrayList]::new()
$plans = [Collections.ArrayList]::new()
$excel = $null
$targetSheet = $null

try {
  if (-not (Test-Path -LiteralPath $targetPath)) {
    throw "找不到 Excel 源表：$targetPath"
  }
  $excel = Invoke-ExcelAction {
    return Get-ExcelApplication
  } "连接 Excel"
  [void](Invoke-ExcelAction { $excel.Visible = $true } "显示 Excel")
  [void](Invoke-ExcelAction { $excel.DisplayAlerts = $true } "恢复 Excel 提示")
  $targetWorkbook = Invoke-ExcelAction {
    return Find-OpenWorkbook $excel $targetPath
  } "查找已打开的目标物表"
  if ($null -eq $targetWorkbook) {
    $previousSecurity = Invoke-ExcelAction {
      return $excel.AutomationSecurity
    } "读取 Excel 安全设置"
    [void](Invoke-ExcelAction {
      $excel.AutomationSecurity = 3
      $excel.DisplayAlerts = $false
    } "临时禁用工作簿宏")
    try {
      $targetWorkbook = Invoke-ExcelAction {
        return $excel.Workbooks.Open($targetPath, 0, $false)
      } "打开目标物表"
      if ($targetWorkbook.ReadOnly) {
        throw "工作簿无法写入：$targetPath"
      }
    } finally {
      [void](Invoke-ExcelAction {
        $excel.AutomationSecurity = $previousSecurity
        $excel.DisplayAlerts = $true
      } "恢复 Excel 安全设置")
    }
  }
  $targetSheet = Invoke-ExcelAction {
    return $targetWorkbook.Worksheets.Item(1)
  } "读取目标物工作表"
  $lastTargetRow = Invoke-ExcelAction {
    return $targetSheet.UsedRange.Rows.Count
  } "读取目标物表行数"
  $targetValues =
    Get-RangeValues $targetSheet 3 $lastTargetRow 2 13 "批量读取目标物表"

  foreach ($item in $request.items) {
    $matchingRows = [Collections.ArrayList]::new()
    for ($rowOffset = 0; $rowOffset -le $lastTargetRow - 3; $rowOffset++) {
      $rowId = [string](Get-RangeValue $targetValues $rowOffset 0)
      if ($rowId -eq [string]$item.targetId) {
        [void]$matchingRows.Add($rowOffset + 3)
      }
    }
    if ($matchingRows.Count -eq 0) {
      throw "目标物 $($item.targetId) 在 Excel 源表中不存在"
    }
    if ($matchingRows.Count -gt 1) {
      throw "目标物 $($item.targetId) 在 Excel 源表中存在重复行，已停止修改"
    }

    $targetRow = [int]$matchingRows[0]
    $targetRowOffset = $targetRow - 3
    $workbookMapId =
      [string](Get-RangeValue $targetValues $targetRowOffset 9)
    if ($workbookMapId -ne [string]$item.mapId) {
      throw "目标物 $($item.targetId) 的 MapID 已变化：当前 $workbookMapId，预期 $($item.mapId)"
    }

    $currentPosition =
      [string](Get-RangeValue $targetValues $targetRowOffset 10)
    $currentRotation =
      [string](Get-RangeValue $targetValues $targetRowOffset 11)
    $positionAlreadyUpdated =
      Test-VectorEqual $currentPosition $item.transform.location
    $rotationAlreadyUpdated =
      Test-RotatorEqual $currentRotation $item.transform.rotation
    $positionRequestedChange = -not (
      Test-VectorEqual (
        Format-Vector $item.originalTransform.location
      ) $item.transform.location
    )
    $rotationRequestedChange = -not (
      Test-RotatorEqual (
        Format-Rotator $item.originalTransform.rotation
      ) $item.transform.rotation
    )
    $alreadyUpdated = $positionAlreadyUpdated -and $rotationAlreadyUpdated
    if ($alreadyUpdated) {
      [void]$unchangedTargetIds.Add([string]$item.targetId)
      [void]$plans.Add(
        [PSCustomObject]@{
          item = $item
          row = $targetRow
          position = $currentPosition
          rotation = $currentRotation
          positionChanged = $false
          rotationChanged = $false
          highlightPosition = $positionRequestedChange
          highlightRotation = $rotationRequestedChange
        }
      )
      continue
    }
    $matchesOriginal = (
      (Test-VectorEqual $currentPosition $item.originalTransform.location) -and
      (Test-RotatorEqual $currentRotation $item.originalTransform.rotation)
    )
    if (-not $matchesOriginal) {
      throw "目标物 $($item.targetId) 的位置或旋转已在 Excel 中变化，已停止覆盖；请先核对并刷新 CSV"
    }
    [void]$plans.Add(
      [PSCustomObject]@{
        item = $item
        row = $targetRow
        position = Format-Vector $item.transform.location
        rotation = Format-Rotator $item.transform.rotation
        positionChanged = -not $positionAlreadyUpdated
        rotationChanged = -not $rotationAlreadyUpdated
        highlightPosition = -not $positionAlreadyUpdated
        highlightRotation = -not $rotationAlreadyUpdated
      }
    )
  }

  foreach ($plan in $plans) {
    if ($plan.positionChanged) {
      [void](Invoke-ExcelAction {
        $targetSheet.Cells.Item($plan.row, 12).Value2 = $plan.position
      } "修改目标物 $($plan.item.targetId) 的位置")
    }
    if ($plan.highlightPosition) {
      [void](Invoke-ExcelAction {
        $targetSheet.Cells.Item($plan.row, 12).Font.Color = 255
      } "标记目标物 $($plan.item.targetId) 的位置")
    }
    if ($plan.rotationChanged) {
      [void](Invoke-ExcelAction {
        $targetSheet.Cells.Item($plan.row, 13).Value2 = $plan.rotation
      } "修改目标物 $($plan.item.targetId) 的旋转")
    }
    if ($plan.highlightRotation) {
      [void](Invoke-ExcelAction {
        $targetSheet.Cells.Item($plan.row, 13).Font.Color = 255
      } "标记目标物 $($plan.item.targetId) 的旋转")
    }
    if ($plan.positionChanged -or $plan.rotationChanged) {
      [void]$updatedTargets.Add(
        [PSCustomObject]@{
          targetId = [string]$plan.item.targetId
          rowNumber = [int]$plan.row
        }
      )
    }
  }

  if ($plans.Count -gt 0) {
    try {
      $targetWorkbook.Activate() | Out-Null
      $targetSheet.Activate() | Out-Null
      $excel.Goto($targetSheet.Cells.Item($plans[0].row, 12), $true) | Out-Null
    } catch {
      # Selection is best-effort; the target values have already been updated.
    }
  }
  [PSCustomObject]@{
    ok = $true
    updatedTargets = @($updatedTargets)
    unchangedTargetIds = @($unchangedTargetIds)
    openedWorkbooks = @($targetPath)
  } | ConvertTo-Json -Depth 5 -Compress
} catch {
  if ($null -ne $excel) {
    try { $excel.Visible = $true } catch {}
    try { $excel.DisplayAlerts = $true } catch {}
  }
  [PSCustomObject]@{
    ok = $false
    message = $_.Exception.Message
  } | ConvertTo-Json -Compress
  exit 1
}
`;

interface ExcelRegistrationResponse extends NpcRegistrationWriteResult {
  ok: boolean;
  message?: string;
}

interface ExcelTargetUpdateResponse extends MissionTargetUpdateResult {
  ok: boolean;
  message?: string;
}

function resultArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value === null || value === undefined ? [] : [value];
}

export function validateNpcRegistrationWriteResult(
  items: readonly NpcRegistrationWriteItem[],
  scope: NpcRegistrationWriteScope,
  result: NpcRegistrationWriteResult,
): void {
  if (scope === "npc_only") {
    const missing = items.filter(
      (item) =>
        item.existingNpcId === null &&
        !result.createdNpcs.some(
          (confirmation) =>
            confirmation.actorRef === item.actorRef &&
            /^\d+$/.test(String(confirmation.id)) &&
            Number(confirmation.id) > 0,
        ),
    );
    if (missing.length > 0) {
      throw new Error(
        `Excel 未返回有效 NPC ID：${missing
          .map((item) => item.label)
          .join("、")}。请先检查 NPC 表，勿立即重复写入`,
      );
    }
    return;
  }
  const confirmations = [
    ...result.createdTargets,
    ...result.reusedTargets,
  ];
  const missing = items.filter(
    (item) =>
      item.existingTargetId === null &&
      !confirmations.some(
        (confirmation) =>
          confirmation.actorRef === item.actorRef &&
          /^\d+$/.test(String(confirmation.id)) &&
          Number(confirmation.id) > 0,
      ),
  );
  if (missing.length > 0) {
    throw new Error(
      `Excel 未返回有效目标物 ID：${missing
        .map((item) => item.label)
        .join("、")}。请先检查目标物表，勿立即重复写入`,
    );
  }
}

export function readablePowerShellError(value: string): string {
  if (/800AC472|80010001/i.test(value)) {
    return "Excel 当前正忙或处于单元格编辑状态。请在 Excel 中按 Enter 或 Esc 退出编辑，关闭弹窗后重试";
  }
  const fragments = Array.from(
    value.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g),
    (match) => match[1],
  );
  const text = (fragments.length > 0 ? fragments.join("\n") : value)
    .replace(/_x([0-9a-f]{4})_/gi, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .replace(/^#< CLIXML\s*/i, "")
    .trim();
  return text || "PowerShell 未返回可读错误";
}

export function powerShellFileArguments(scriptPath: string): string[] {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
  ];
}

async function runExcelOperation<
  TResult extends { ok: boolean; message?: string },
>(
  script: string,
  environmentName: string,
  payload: unknown,
  fallbackError: string,
): Promise<TResult> {
  const operationRoot = await mkdtemp(
    join(tmpdir(), "shot-sandbox-excel-"),
  );
  const scriptPath = join(operationRoot, "operation.ps1");
  const payloadPath = join(operationRoot, "payload.json");
  try {
    await Promise.all([
      writeFile(scriptPath, `\uFEFF${script}`, "utf8"),
      writeFile(payloadPath, JSON.stringify(payload), "utf8"),
    ]);
    return await new Promise((resolvePromise, reject) => {
      const child = spawn(
        "powershell.exe",
        powerShellFileArguments(scriptPath),
        {
          env: {
            ...process.env,
            [environmentName]: payloadPath,
          },
          windowsHide: true,
        },
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      const rejectOnce = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };
      const timeout = setTimeout(() => {
        child.kill();
        rejectOnce(
          new Error(
            `${fallbackError}超过 ${EXCEL_OPERATION_TIMEOUT_MS / 1_000} 秒；请检查 Excel 是否停留在单元格编辑、弹窗或受保护视图`,
          ),
        );
      }, EXCEL_OPERATION_TIMEOUT_MS);
      child.stdout.on("data", (chunk) =>
        stdout.push(Buffer.from(chunk)),
      );
      child.stderr.on("data", (chunk) =>
        stderr.push(Buffer.from(chunk)),
      );
      child.once("error", (error) => {
        rejectOnce(error);
      });
      child.once("close", (code) => {
        if (settled) {
          return;
        }
        const output = Buffer.concat(stdout).toString("utf8").trim();
        const errorOutput = Buffer.concat(stderr).toString("utf8").trim();
        let result: TResult | null = null;
        try {
          result = JSON.parse(output) as TResult;
        } catch {
          rejectOnce(
            new Error(
              readablePowerShellError(errorOutput || output) ||
                `${fallbackError}进程异常退出（${code ?? "unknown"}）`,
            ),
          );
          return;
        }
        if (code !== 0 || !result.ok) {
          rejectOnce(
            new Error(
              result.message ||
                readablePowerShellError(errorOutput) ||
                `${fallbackError}失败`,
            ),
          );
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolvePromise(result);
      });
    });
  } finally {
    await rm(operationRoot, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

function runExcelRegistration(
  items: NpcRegistrationWriteItem[],
  scope: NpcRegistrationWriteScope,
  paths: z.infer<typeof RegistrationPathsSchema>,
): Promise<ExcelRegistrationResponse> {
  return runExcelOperation<ExcelRegistrationResponse>(
    EXCEL_REGISTRATION_SCRIPT,
    "SHOT_SANDBOX_REGISTRATION_PAYLOAD_PATH",
    { items, scope, paths },
    "Excel 写入",
  );
}

function runExcelTargetUpdate(
  items: MissionTargetUpdateItem[],
  targetPath: string,
): Promise<ExcelTargetUpdateResponse> {
  return runExcelOperation<ExcelTargetUpdateResponse>(
    EXCEL_TARGET_UPDATE_SCRIPT,
    "SHOT_SANDBOX_TARGET_UPDATE_PAYLOAD_PATH",
    { items, targetPath },
    "Excel 目标物修改",
  );
}

export async function writeNpcRegistrationDraft(
  rawRequest: unknown,
): Promise<NpcRegistrationWriteResult> {
  const request = parseNpcRegistrationWriteRequest(rawRequest);
  const result = await withExcelRegistrationLock(() =>
    runExcelRegistration(request.items, request.scope, request.paths),
  );
  const normalizedResult: NpcRegistrationWriteResult = {
    createdModels: resultArray(result.createdModels),
    createdNpcs: resultArray(result.createdNpcs),
    createdTargets: resultArray(result.createdTargets),
    reusedTargets: resultArray(result.reusedTargets),
    openedWorkbooks: resultArray(result.openedWorkbooks),
  };
  validateNpcRegistrationWriteResult(
    request.items,
    request.scope,
    normalizedResult,
  );
  return normalizedResult;
}

export function parseNpcRegistrationWriteRequest(
  rawRequest: unknown,
): {
  items: NpcRegistrationWriteItem[];
  scope: NpcRegistrationWriteScope;
  paths: z.infer<typeof RegistrationPathsSchema>;
} {
  return RegistrationWriteSchema.parse(rawRequest) as {
    items: NpcRegistrationWriteItem[];
    scope: NpcRegistrationWriteScope;
    paths: z.infer<typeof RegistrationPathsSchema>;
  };
}

export async function updateMissionTargetTransforms(
  rawRequest: unknown,
): Promise<MissionTargetUpdateResult> {
  const request = TransformUpdateSchema.parse(rawRequest) as {
    items: MissionTargetUpdateItem[];
    targetPath: string;
  };
  const result = await withExcelRegistrationLock(() =>
    runExcelTargetUpdate(request.items, request.targetPath),
  );
  return {
    updatedTargets: result.updatedTargets,
    unchangedTargetIds: result.unchangedTargetIds,
    openedWorkbooks: result.openedWorkbooks,
  };
}
