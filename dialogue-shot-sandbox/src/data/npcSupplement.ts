import type {
  NpcSupplementKind,
  NpcSupplementPlan,
  NpcSupplementPlanItem,
  NpcSupplementPlanRequest,
} from "../types";
import { buildNpcMontagePlans } from "./npcMigration";

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/\/+$/, "");
}

function fileStem(file: string): string {
  return (
    normalizePath(file).split("/").at(-1)?.replace(/\.fbx$/i, "") ?? ""
  );
}

function packagePath(value: string): string {
  return value.split(".", 1)[0].toLowerCase();
}

function expectedPrefix(npcName: string): string {
  return `A_${npcName}_`;
}

function defaultCopyFaceCurves(actionName: string): boolean {
  return !/^look[DFU]$/i.test(actionName);
}

function defaultMakeFaceMontage(actionName: string): boolean {
  return !/^(?:look[DFU]|walk|backlean|frontlean|idlestand\d*|turn(?:L|R|Left|Right)\d*)$/i.test(
    actionName,
  );
}

function actionNameFor(
  kind: NpcSupplementKind,
  npcName: string,
  sourceAssetName: string,
): string {
  const prefix = expectedPrefix(npcName);
  const suffix = sourceAssetName.slice(prefix.length);
  return kind === "face" ? suffix.replace(/_Face$/i, "") : suffix;
}

export function buildNpcSupplementPlan(
  request: NpcSupplementPlanRequest,
  animationFiles: readonly string[],
): Omit<NpcSupplementPlan, "reviewToken"> {
  const sourceDirectory = normalizePath(request.sourceDirectory);
  const npcPrefix = expectedPrefix(request.target.npcName);
  const existingAssets = new Set(
    request.target.existingAssetPaths.map(packagePath),
  );
  const dirtyPackages = new Set(
    request.target.dirtyPackageNames.map(packagePath),
  );
  const included = request.includedSourceFiles
    ? new Set(request.includedSourceFiles.map(normalizePath))
    : null;
  const faceOptions = new Map(
    (request.faceOptions ?? []).map((option) => [
      normalizePath(option.sourceFile),
      option,
    ]),
  );
  const sourceFiles = [...animationFiles]
    .filter((file) => /\.fbx$/i.test(file))
    .filter((file) =>
      request.kind === "face" ? /_Face\.fbx$/i.test(file) : !/_Face\.fbx$/i.test(file),
    )
    .sort((left, right) =>
      left.localeCompare(right, "en", { sensitivity: "base" }),
    );

  const items: NpcSupplementPlanItem[] = sourceFiles.map((sourceFile) => {
    const normalizedSourceFile = normalizePath(sourceFile);
    const sourceAssetName = fileStem(sourceFile);
    const hasExpectedPrefix = sourceAssetName
      .toLowerCase()
      .startsWith(npcPrefix.toLowerCase());
    const actionName = hasExpectedPrefix
      ? actionNameFor(request.kind, request.target.npcName, sourceAssetName)
      : "";
    const hasFaceSuffix = /_Face$/i.test(sourceAssetName);
    const targetAssetPath =
      request.kind === "face"
        ? `${request.target.animationPackagePath}/Face/${sourceAssetName}`
        : `${request.target.animationPackagePath}/${sourceAssetName}`;
    const bodyAssetPath =
      request.kind === "face" && actionName
        ? `${request.target.animationPackagePath}/${npcPrefix}${actionName}`
        : "";
    const bodyMontage =
      request.kind === "actions"
        ? buildNpcMontagePlans(request.target.npcName, [sourceFile]).montages[0]
        : undefined;
    const configuredFaceOptions = faceOptions.get(normalizedSourceFile);
    const copyFaceCurves =
      request.kind === "face"
        ? configuredFaceOptions?.copyFaceCurves ??
          defaultCopyFaceCurves(actionName)
        : false;
    const makeMontage =
      request.kind === "face"
        ? configuredFaceOptions?.makeMontage ??
          defaultMakeFaceMontage(actionName)
        : Boolean(bodyMontage);
    const montageName =
      request.kind === "face"
        ? makeMontage && actionName
          ? `AM_${actionName}`
          : ""
        : bodyMontage?.montageName ?? "";
    const montageAssetPath = montageName
      ? `${request.target.animationPackagePath}/${montageName}`
      : "";
    const existingTarget = existingAssets.has(packagePath(targetAssetPath));
    let blockedReason = "";
    if (!hasExpectedPrefix) {
      blockedReason = `文件名必须以 ${npcPrefix} 开头`;
    } else if (request.kind === "face" && !hasFaceSuffix) {
      blockedReason = "Face 动作必须以 _Face 结尾";
    } else if (request.kind === "face" && !existingAssets.has(packagePath(bodyAssetPath))) {
      blockedReason = `缺少同名 Body 动作 ${npcPrefix}${actionName}`;
    } else if (existingTarget && dirtyPackages.has(packagePath(targetAssetPath))) {
      blockedReason = "目标动作在 UE 中尚未保存";
    }
    return {
      sourceFile: normalizedSourceFile,
      sourceAssetName,
      actionName,
      targetAssetPath,
      bodyAssetPath,
      montageName,
      montageAssetPath,
      montageState: !montageName
        ? "none"
        : existingAssets.has(packagePath(montageAssetPath))
          ? "reuse"
          : "create",
      copyFaceCurves,
      makeMontage,
      state: blockedReason ? "blocked" : existingTarget ? "update" : "new",
      included:
        !blockedReason &&
        (included ? included.has(normalizedSourceFile) : true),
      blockedReason,
    };
  });

  const blockedReasons: string[] = [];
  if (!sourceDirectory) {
    blockedReasons.push("请选择动作 FBX 目录");
  }
  if (sourceFiles.length === 0) {
    blockedReasons.push(
      request.kind === "face"
        ? "目录中没有以 _Face 结尾的 FBX"
        : "目录中没有 Body 动作 FBX",
    );
  }
  if (request.kind === "face" && !request.target.faceSkeletonAssetPath) {
    blockedReasons.push("未找到 NPC 的 Face Skeletal Mesh 或 Face Skeleton");
  }
  const selectedItems = items.filter((item) => item.included);
  if (sourceFiles.length > 0 && selectedItems.length === 0) {
    blockedReasons.push("至少选择一个可处理动作");
  }
  const montageCounts = new Map<string, number>();
  for (const item of selectedItems) {
    if (item.montageName) {
      montageCounts.set(
        item.montageName,
        (montageCounts.get(item.montageName) ?? 0) + 1,
      );
    }
  }
  const duplicateMontages = Array.from(montageCounts)
    .filter(([, count]) => count > 1)
    .map(([name]) => name);
  if (duplicateMontages.length > 0) {
    blockedReasons.push(
      `多个动作会生成同名 Montage：${duplicateMontages.join("、")}`,
    );
  }

  const warnings =
    request.kind === "face"
      ? [
          "将使用 Face Skeleton 导入动作、锁定根骨骼并自动保存",
          "将直接调用 Seria 原生函数复制表情曲线并按清单生成 Montage",
        ]
      : [
          "同名动作会按已审核清单重新导入并覆盖，未保存资产会阻断",
          "新识别到的 Idle / Turn 动作会创建 Montage；既有 Montage 会继续引用更新后的动作",
        ];
  const selectedBlocked = selectedItems.filter(
    (item) => item.state === "blocked",
  );
  if (selectedBlocked.length > 0) {
    blockedReasons.push(
      `选择中有 ${selectedBlocked.length} 个动作不满足处理条件`,
    );
  }

  return {
    kind: request.kind,
    target: request.target,
    sourceDirectory,
    npcPrefix,
    items,
    canApply: blockedReasons.length === 0 && selectedItems.length > 0,
    blockedReasons,
    warnings,
  };
}
