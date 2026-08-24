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

const DEFAULT_REGISTRATION_PATHS = {
  missionTarget:
    "C:\\trunk\\doc\\xlsdir\\r任务剧情\\m目标物表.xlsm",
  npc: "C:\\trunk\\doc\\xlsdir\\NPC表.xlsm",
  model: "C:\\trunk\\doc\\xlsdir\\m模型资源表.xlsm",
};

const RegistrationPathsSchema = z.object({
  missionTarget: z.string().trim().min(1),
  npc: z.string().trim().min(1),
  model: z.string().trim().min(1),
});

const RegistrationWriteSchema = z
  .object({
    scope: z.enum(["all", "npc_only", "target_only"]).default("all"),
    paths: RegistrationPathsSchema.default(DEFAULT_REGISTRATION_PATHS),
    items: z
      .array(
        z.object({
          actorRef: z.string().min(1),
          label: z.string().min(1),
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
      .min(1)
      .default(DEFAULT_REGISTRATION_PATHS.missionTarget),
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

async function withExcelRegistrationLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + 65_000;
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
      [void]$requiredPaths.Add($paths.npc)
      [void]$requiredPaths.Add($paths.model)
      [void]$requiredPaths.Add($paths.missionTarget)
    }
  }
}
foreach ($path in $requiredPaths) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "找不到 Excel 源表：$path"
  }
  Start-Process -FilePath $path | Out-Null
}
if ($requiredPaths.Count -gt 0) {
  Start-Sleep -Milliseconds 1200
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
  $book = $excel.Workbooks.Open($path)
  if ($book.ReadOnly) {
    throw "工作簿无法写入：$path"
  }
  return $book
}

function Get-NextId(
  [object]$sheet,
  [int]$column,
  [int]$minimum,
  [int]$maximum
) {
  $maxId = $minimum - 1
  $lastRow = $sheet.UsedRange.Rows.Count
  for ($row = 3; $row -le $lastRow; $row++) {
    $raw = $sheet.Cells.Item($row, $column).Value2
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
  $sheet.Rows.Item($row).Insert(-4121, 0) | Out-Null
  $sheet.Range(
    $sheet.Cells.Item($row, 1),
    $sheet.Cells.Item($row, $columnCount)
  ).ClearContents() | Out-Null
}

function Set-Cell([object]$sheet, [int]$row, [int]$column, $value) {
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
}

function Set-NewCell([object]$sheet, [int]$row, [int]$column, $value) {
  Set-Cell $sheet $row $column $value
  $cell = $sheet.Cells.Item($row, $column)
  $cell.Font.Color = 255
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

function Get-ConfiguredPath([string]$classPath) {
  $normalized = $classPath.Replace("\", "/")
  if ($normalized -match "^(.+)\.[^\.]+_C$") {
    return $Matches[1]
  }
  return $normalized -replace "_C$", ""
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
  try {
    $excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
  } catch {
    $excel = New-Object -ComObject Excel.Application
  }
  $previousSecurity = $excel.AutomationSecurity
  $excel.AutomationSecurity = 3
  $excel.Visible = $true
  $excel.DisplayAlerts = $true

  $workbooks = @{}
  foreach ($path in $requiredPaths) {
    $book = Get-Workbook $excel $path
    $workbooks[$path] = $book
    [void]$openedWorkbooks.Add($path)
  }

  $modelWorkbook = $workbooks[$paths.model]
  $modelSheet =
    if ($null -ne $modelWorkbook) { $modelWorkbook.Worksheets.Item(1) } else { $null }
  $npcWorkbook = $workbooks[$paths.npc]
  $npcSheet =
    if ($null -ne $npcWorkbook) { $npcWorkbook.Worksheets.Item(1) } else { $null }
  $targetWorkbook = $workbooks[$paths.missionTarget]
  $targetSheet =
    if ($null -ne $targetWorkbook) { $targetWorkbook.Worksheets.Item(1) } else { $null }

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
        $matchingModelRows = [Collections.ArrayList]::new()
        for ($row = 3; $row -le $modelSheet.UsedRange.Rows.Count; $row++) {
          if (
            [string]$modelSheet.Cells.Item($row, 2).Value2 -eq
            [string]$item.existingModelId
          ) {
            [void]$matchingModelRows.Add($row)
          }
        }
        if ($matchingModelRows.Count -ne 1) {
          throw "模型 ID $($item.existingModelId) 在模型资源表中不存在或不唯一"
        }
        $existingPath = [string]$modelSheet.Cells.Item(
          [int]$matchingModelRows[0],
          3
        ).Value2
        if (-not [string]::Equals(
          $existingPath.Replace("\", "/"),
          $configuredPath,
          [StringComparison]::OrdinalIgnoreCase
        )) {
          throw "模型 ID $($item.existingModelId) 与 Actor $($item.label) 的资源路径不一致"
        }
      }
      if ($null -ne $item.existingNpcId) {
        if ($null -eq $item.existingModelId) {
          throw "NPC ID $($item.existingNpcId) 缺少可验证的模型 ID"
        }
        $matchingNpcRows = [Collections.ArrayList]::new()
        for ($row = 3; $row -le $npcSheet.UsedRange.Rows.Count; $row++) {
          if (
            [string]$npcSheet.Cells.Item($row, 2).Value2 -eq
            [string]$item.existingNpcId
          ) {
            [void]$matchingNpcRows.Add($row)
          }
        }
        if ($matchingNpcRows.Count -ne 1) {
          throw "NPC ID $($item.existingNpcId) 在 NPC 表中不存在或不唯一"
        }
        $npcModelId = [string]$npcSheet.Cells.Item(
          [int]$matchingNpcRows[0],
          5
        ).Value2
        if ($npcModelId -ne [string]$item.existingModelId) {
          throw "NPC ID $($item.existingNpcId) 引用的模型与 Actor $($item.label) 不一致"
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
      $existingTargets = [Collections.ArrayList]::new()
      for ($row = 3; $row -le $targetSheet.UsedRange.Rows.Count; $row++) {
        if (
          [string]$targetSheet.Cells.Item($row, 11).Value2 -eq
            [string]$item.mapId -and
          [string]$targetSheet.Cells.Item($row, 12).Value2 -eq $position -and
          [string]$targetSheet.Cells.Item($row, 13).Value2 -eq $rotation
        ) {
          [void]$existingTargets.Add(
            [string]$targetSheet.Cells.Item($row, 2).Value2
          )
        }
      }
      if ($existingTargets.Count -gt 1) {
        throw "Actor $($item.label) 在 MapID $($item.mapId) 中匹配到多个目标物"
      }
      if ($existingTargets.Count -eq 1 -and $existingTargets[0] -ne "") {
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
    if ($needsNewModel) { Get-NextId $modelSheet 2 200000 299999 } else { $null }
  $nextNpcId =
    if ($needsNewNpc) { Get-NextId $npcSheet 2 1 2147483647 } else { $null }
  $nextTargetId =
    if ($needsNewTarget) { Get-NextId $targetSheet 2 1 2147483647 } else { $null }
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
      $matchingModelRows = [Collections.ArrayList]::new()
      for ($row = 3; $row -le $modelSheet.UsedRange.Rows.Count; $row++) {
        if (
          [string]$modelSheet.Cells.Item($row, 2).Value2 -eq
          [string]$item.existingModelId
        ) {
          [void]$matchingModelRows.Add($row)
        }
      }
      if ($matchingModelRows.Count -ne 1) {
        throw "模型 ID $($item.existingModelId) 在模型资源表中不存在或不唯一"
      }
      $existingPath = [string]$modelSheet.Cells.Item(
        [int]$matchingModelRows[0],
        3
      ).Value2
      if (-not [string]::Equals(
        $existingPath.Replace("\", "/"),
        $configuredPath,
        [StringComparison]::OrdinalIgnoreCase
      )) {
        throw "模型 ID $($item.existingModelId) 与 Actor $($item.label) 的资源路径不一致"
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
    $existingId = $null
    for ($row = 3; $row -le $modelSheet.UsedRange.Rows.Count; $row++) {
      $existingPath = [string]$modelSheet.Cells.Item($row, 3).Value2
      if ([string]::Equals(
        $existingPath.Replace("\", "/"),
        $configuredPath,
        [StringComparison]::OrdinalIgnoreCase
      )) {
        $existingId = [int]$modelSheet.Cells.Item($row, 2).Value2
        break
      }
    }
    if ($null -eq $existingId) {
      $insertRow = $modelSheet.UsedRange.Rows.Count + 1
      for ($row = 3; $row -le $modelSheet.UsedRange.Rows.Count; $row++) {
        $rowId = 0
        if (
          [int]::TryParse(
            [string]$modelSheet.Cells.Item($row, 2).Value2,
            [ref]$rowId
          ) -and $rowId -gt $nextModelId
        ) {
          $insertRow = $row
          break
        }
      }
      Add-BlankRow $modelSheet $insertRow 4
      Set-NewCell $modelSheet $insertRow 1 0
      Set-NewCell $modelSheet $insertRow 2 $nextModelId
      Set-NewCell $modelSheet $insertRow 3 $configuredPath
      $existingId = $nextModelId
      [void]$createdModels.Add(
        [PSCustomObject]@{ actorRef = $item.actorRef; id = $existingId }
      )
      $nextModelId++
      $lastSheet = $modelSheet
      $lastRow = $insertRow
    }
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
    $row = $npcSheet.UsedRange.Rows.Count + 1
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
      $row = $targetSheet.UsedRange.Rows.Count + 1
      Add-BlankRow $targetSheet $row 33
      Set-NewCell $targetSheet $row 1 0
      Set-NewCell $targetSheet $row 2 $nextTargetId
      Set-NewCell $targetSheet $row 4 $item.label
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

  $excel.AutomationSecurity = $previousSecurity
  if ($null -ne $lastSheet) {
    $lastSheet.Parent.Activate() | Out-Null
    $lastSheet.Activate() | Out-Null
    $excel.Goto($lastSheet.Cells.Item($lastRow, 2), $true) | Out-Null
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
    $excel.Visible = $true
    $excel.DisplayAlerts = $true
  }
  [PSCustomObject]@{
    ok = $false
    message = $_.Exception.Message
  } | ConvertTo-Json -Compress
  exit 1
}
`;

const EXCEL_TARGET_UPDATE_SCRIPT = String.raw`
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
  for ($attempt = 1; $attempt -le 12; $attempt++) {
    try {
      return & $action
    } catch [Runtime.InteropServices.COMException] {
      $lastError = $_.Exception
      Start-Sleep -Milliseconds 250
    }
  }
  throw "$description 失败：Excel 正忙或正处于单元格编辑状态，请退出编辑后重试。$($lastError.Message)"
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
  try {
    $excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
  } catch {
    $excel = New-Object -ComObject Excel.Application
  }
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
    } "临时禁用工作簿宏")
    try {
      $targetWorkbook = Invoke-ExcelAction {
        return $excel.Workbooks.Open($targetPath)
      } "打开目标物表"
      if ($targetWorkbook.ReadOnly) {
        throw "工作簿无法写入：$targetPath"
      }
    } finally {
      [void](Invoke-ExcelAction {
        $excel.AutomationSecurity = $previousSecurity
      } "恢复 Excel 安全设置")
    }
  }
  $targetSheet = Invoke-ExcelAction {
    return $targetWorkbook.Worksheets.Item(1)
  } "读取目标物工作表"
  $lastTargetRow = Invoke-ExcelAction {
    return $targetSheet.UsedRange.Rows.Count
  } "读取目标物表行数"

  foreach ($item in $request.items) {
    $matchingRows = [Collections.ArrayList]::new()
    for ($row = 3; $row -le $lastTargetRow; $row++) {
      $rowId = [string](Invoke-ExcelAction {
        return $targetSheet.Cells.Item($row, 2).Value2
      } "读取目标物 ID")
      if ($rowId -eq [string]$item.targetId) {
        [void]$matchingRows.Add($row)
      }
    }
    if ($matchingRows.Count -eq 0) {
      throw "目标物 $($item.targetId) 在 Excel 源表中不存在"
    }
    if ($matchingRows.Count -gt 1) {
      throw "目标物 $($item.targetId) 在 Excel 源表中存在重复行，已停止修改"
    }

    $targetRow = [int]$matchingRows[0]
    $workbookMapId = [string](Invoke-ExcelAction {
      return $targetSheet.Cells.Item($targetRow, 11).Value2
    } "读取目标物 $($item.targetId) 的 MapID")
    if ($workbookMapId -ne [string]$item.mapId) {
      throw "目标物 $($item.targetId) 的 MapID 已变化：当前 $workbookMapId，预期 $($item.mapId)"
    }

    $currentPosition = [string](Invoke-ExcelAction {
      return $targetSheet.Cells.Item($targetRow, 12).Value2
    } "读取目标物 $($item.targetId) 的位置")
    $currentRotation = [string](Invoke-ExcelAction {
      return $targetSheet.Cells.Item($targetRow, 13).Value2
    } "读取目标物 $($item.targetId) 的旋转")
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
        rejectOnce(new Error(`${fallbackError}超时`));
      }, 60_000);
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
  return {
    createdModels: result.createdModels,
    createdNpcs: result.createdNpcs,
    createdTargets: result.createdTargets,
    reusedTargets: result.reusedTargets,
    openedWorkbooks: result.openedWorkbooks,
  };
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
