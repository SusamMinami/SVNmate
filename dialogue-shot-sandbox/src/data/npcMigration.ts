import type {
  NpcMigrationAnimationRoleAssets,
  NpcMigrationFileOperation,
  NpcMigrationMontagePlan,
  NpcMigrationPlan,
  NpcMigrationPlanRequest,
  NpcMigrationStandardAbpTemplate,
  NpcMigrationStep,
} from "../types";

const ASSET_NAME_PATTERN = /^[A-Za-z0-9_]+$/;
const PACKAGE_PATH_PATTERN = /^\/Game(?:\/[A-Za-z0-9_]+)+$/;

function normalizeSlashes(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/\/+$/, "");
}

export function normalizeNpcPackagePath(value: string): string {
  const normalized = normalizeSlashes(value);
  return normalized.startsWith("/Game/")
    ? normalized.replace(/\/+/g, "/")
    : normalized;
}

export function deriveNpcName(meshName: string): string {
  return meshName.trim().replace(/^SK_/i, "");
}

export function inferStandardAbpTemplate(
  npcName: string,
): NpcMigrationStandardAbpTemplate {
  const normalized = npcName.toLowerCase();
  if (/(?:female|girl|woman|lady)/.test(normalized)) {
    return "female";
  }
  if (/(?:male|boy|man)/.test(normalized)) {
    return "male";
  }
  return "female";
}

export function classifyNpcAnimationFiles(files: readonly string[]): {
  body: string[];
  face: string[];
} {
  const sorted = [...files]
    .filter((file) => /\.fbx$/i.test(file))
    .sort((left, right) =>
      left.localeCompare(right, "en", { sensitivity: "base" }),
    );
  return {
    body: sorted.filter((file) => !/_Face\.fbx$/i.test(file)),
    face: sorted.filter((file) => /_Face\.fbx$/i.test(file)),
  };
}

function fileStem(file: string): string {
  return file.replaceAll("\\", "/").split("/").at(-1)?.replace(/\.fbx$/i, "") ?? "";
}

export function buildNpcMontagePlans(
  npcName: string,
  bodyAnimationFiles: readonly string[],
): {
  montages: NpcMigrationMontagePlan[];
  duplicateNames: string[];
} {
  const prefix = `A_${npcName}_`.toLowerCase();
  const montages = bodyAnimationFiles.flatMap((sourceFile) => {
    const sourceAssetName = fileStem(sourceFile);
    if (!sourceAssetName.toLowerCase().startsWith(prefix)) {
      return [];
    }
    const actionName = sourceAssetName.slice(prefix.length);
    const normalized = actionName.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
    let montage: Pick<
      NpcMigrationMontagePlan,
      "kind" | "montageName" | "slotName"
    > | null = null;
    const idle = normalized.match(/^idle(\d*)$/);
    if (idle) {
      montage = {
        kind: "idle",
        montageName: `AM_Idle${idle[1] || "1"}`,
        slotName: "IdleSlot",
      };
    } else if (/^turn(?:l|left)(?:90)?$/.test(normalized)) {
      montage = {
        kind: "turn_left_90",
        montageName: "AM_TurnLeft90",
        slotName: "TurnSlot",
      };
    } else if (/^turn(?:r|right)(?:90)?$/.test(normalized)) {
      montage = {
        kind: "turn_right_90",
        montageName: "AM_TurnRight90",
        slotName: "TurnSlot",
      };
    } else if (/^turn(?:l|left)180$/.test(normalized)) {
      montage = {
        kind: "turn_left_180",
        montageName: "AM_TurnLeft180",
        slotName: "TurnSlot",
      };
    } else if (/^turn(?:r|right)180$/.test(normalized)) {
      montage = {
        kind: "turn_right_180",
        montageName: "AM_TurnRight180",
        slotName: "TurnSlot",
      };
    }
    return montage
      ? [{ ...montage, sourceFile, sourceAssetName }]
      : [];
  });
  const counts = new Map<string, number>();
  for (const montage of montages) {
    counts.set(
      montage.montageName,
      (counts.get(montage.montageName) ?? 0) + 1,
    );
  }
  return {
    montages,
    duplicateNames: Array.from(counts)
      .filter(([, count]) => count > 1)
      .map(([name]) => name),
  };
}

export function buildNpcAnimationRoleAssets(
  npcName: string,
  bodyAnimationFiles: readonly string[],
): {
  assets: NpcMigrationAnimationRoleAssets;
  missingRoles: Array<keyof NpcMigrationAnimationRoleAssets>;
  duplicateRoles: Array<keyof NpcMigrationAnimationRoleAssets>;
} {
  const prefix = `A_${npcName}_`.toLowerCase();
  const matches: Record<
    keyof NpcMigrationAnimationRoleAssets,
    string[]
  > = {
    lookDown: [],
    lookForward: [],
    lookUp: [],
    idleStand: [],
    impact: [],
    interact: [],
  };
  for (const sourceFile of bodyAnimationFiles) {
    const sourceAssetName = fileStem(sourceFile);
    if (!sourceAssetName.toLowerCase().startsWith(prefix)) {
      continue;
    }
    const action = sourceAssetName
      .slice(prefix.length)
      .replaceAll(/[^a-z0-9]/gi, "")
      .toLowerCase();
    const role =
      action === "lookd"
        ? "lookDown"
        : action === "lookf"
          ? "lookForward"
          : action === "looku"
            ? "lookUp"
            : action === "idlestand"
              ? "idleStand"
              : action === "impact"
                ? "impact"
                : action === "interact"
                  ? "interact"
                  : null;
    if (role) {
      matches[role].push(sourceAssetName);
    }
  }
  const assets = Object.fromEntries(
    Object.entries(matches).map(([role, values]) => [
      role,
      values.length === 1 ? values[0] : "",
    ]),
  ) as unknown as NpcMigrationAnimationRoleAssets;
  return {
    assets,
    missingRoles: (
      Object.keys(matches) as Array<keyof NpcMigrationAnimationRoleAssets>
    ).filter((role) => matches[role].length === 0),
    duplicateRoles: (
      Object.keys(matches) as Array<keyof NpcMigrationAnimationRoleAssets>
    ).filter((role) => matches[role].length > 1),
  };
}

function automaticStep(
  id: NpcMigrationStep["id"],
  label: string,
  detail: string,
  blocked: boolean,
): NpcMigrationStep {
  return {
    id,
    label,
    mode: "automatic",
    state: blocked ? "blocked" : "ready",
    detail,
  };
}

export function buildNpcMigrationPlan(
  request: NpcMigrationPlanRequest,
  discovered: {
    animationFiles: string[];
    fileOperations: NpcMigrationFileOperation[];
    targetDirectoryReady: boolean;
    animationDirectoryReady: boolean;
  },
): Omit<NpcMigrationPlan, "reviewToken"> {
  const npcName = (request.npcName || deriveNpcName(
    request.source.skeletalMeshName,
  )).trim();
  const targetContentDirectory = normalizeSlashes(
    request.targetContentDirectory,
  );
  const animationSourceDirectory = normalizeSlashes(
    request.animationSourceDirectory,
  );
  const targetPackagePath = normalizeNpcPackagePath(
    request.targetPackagePath ||
      request.source.suggestedTargetPackagePath,
  );
  const blueprintName = `BP_${npcName}`;
  const animationBlueprintName = `ABP_${npcName}`;
  const animationPackagePath = `${targetPackagePath}/Animation`;
  const { body, face } = classifyNpcAnimationFiles(
    discovered.animationFiles,
  );
  const { montages, duplicateNames } = buildNpcMontagePlans(npcName, body);
  const configureStandardAbp = request.configureStandardAbp ?? false;
  const standardAbpTemplate =
    request.standardAbpTemplate ?? inferStandardAbpTemplate(npcName);
  const {
    assets: animationRoleAssets,
    missingRoles,
    duplicateRoles,
  } = buildNpcAnimationRoleAssets(npcName, body);
  const lookBlendSpaceName = `BS_${npcName}_Look`;
  const blockedReasons: string[] = [];
  const warnings = [...request.source.warnings];

  if (!ASSET_NAME_PATTERN.test(npcName)) {
    blockedReasons.push("NPC 名称只能包含英文字母、数字和下划线");
  }
  if (!PACKAGE_PATH_PATTERN.test(targetPackagePath)) {
    blockedReasons.push("目标 UE 路径必须是 /Game 开头的有效资产目录");
  }
  if (!ASSET_NAME_PATTERN.test(blueprintName)) {
    blockedReasons.push("BP 名称只能包含英文字母、数字和下划线");
  }
  if (!ASSET_NAME_PATTERN.test(animationBlueprintName)) {
    blockedReasons.push("ABP 名称只能包含英文字母、数字和下划线");
  }
  if (duplicateNames.length > 0) {
    blockedReasons.push(
      `多个动作会生成同名 Montage：${duplicateNames.join("、")}`,
    );
  }
  if (configureStandardAbp && missingRoles.length > 0) {
    blockedReasons.push(
      `标准 ABP 缺少动作：${missingRoles.join("、")}`,
    );
  }
  if (configureStandardAbp && duplicateRoles.length > 0) {
    blockedReasons.push(
      `标准 ABP 动作不唯一：${duplicateRoles.join("、")}`,
    );
  }
  if (!discovered.targetDirectoryReady) {
    blockedReasons.push("目标目录必须是现有 Unreal 项目的 Content 目录");
  }
  if (
    targetContentDirectory.toLowerCase() ===
    normalizeSlashes(request.source.sourceContentDirectory).toLowerCase()
  ) {
    blockedReasons.push("源工程与目标工程不能使用同一个 Content 目录");
  }
  if (request.source.dirtyPackageNames.length > 0) {
    blockedReasons.push(
      `源 UE 有 ${request.source.dirtyPackageNames.length} 个待迁移资产尚未保存`,
    );
  }
  if (discovered.fileOperations.length === 0) {
    blockedReasons.push("没有找到可复制的源资产文件");
  }
  const conflicts = discovered.fileOperations.filter(
    (operation) => operation.state === "conflict",
  );
  if (conflicts.length > 0) {
    blockedReasons.push(
      `目标 Content 中已有 ${conflicts.length} 个同路径文件，当前版本不会覆盖`,
    );
  }
  if (!discovered.animationDirectoryReady) {
    blockedReasons.push("动作源目录不存在或无法读取");
  } else if (body.length === 0) {
    blockedReasons.push("动作源目录中没有可导入的 Body FBX");
  }
  if (face.length > 0) {
    warnings.push(
      `检测到 ${face.length} 个 Face FBX；将导入并锁定根骨骼，表情曲线仍需通过 BP_FaceConfigHelper 生成`,
    );
  }
  if (montages.length === 0) {
    warnings.push(
      "未识别到 Idle 或 Turn 动作，不会自动创建 Montage",
    );
  }
  warnings.push("胶囊体将按 Mesh 包围盒估算，完成后仍需在蓝图视口确认");
  warnings.push(
    configureStandardAbp
      ? `将使用${
          standardAbpTemplate === "male" ? "男性" : "女性"
        }标准模板配置状态机、Look 和 SpecialAction`
      : "未启用标准 ABP 模板，状态机、Look 和 SpecialAction 需要人工配置",
  );

  const migrationBlocked =
    !discovered.targetDirectoryReady ||
    request.source.dirtyPackageNames.length > 0 ||
    discovered.fileOperations.length === 0 ||
    conflicts.length > 0 ||
    targetContentDirectory.toLowerCase() ===
      normalizeSlashes(request.source.sourceContentDirectory).toLowerCase();
  const configurationBlocked =
    blockedReasons.some((reason) =>
      [
        "NPC 名称",
        "目标 UE 路径",
        "BP 名称",
        "ABP 名称",
        "动作源目录",
        "多个动作会生成同名 Montage",
        "标准 ABP 缺少动作",
        "标准 ABP 动作不唯一",
      ].some((prefix) => reason.startsWith(prefix)),
    );

  const steps: NpcMigrationStep[] = [
    automaticStep(
      "source",
      "采集 Skeletal Mesh 与依赖",
      `${request.source.dependencyPackageNames.length} 个包，${request.source.sourceFiles.length} 个物理文件`,
      request.source.sourceFiles.length === 0,
    ),
    automaticStep(
      "migration",
      "迁移模型基础资产",
      `复制到 ${targetContentDirectory || "未指定目标 Content"}`,
      migrationBlocked,
    ),
    automaticStep(
      "animations",
      "导入 Body / Face 动作",
      `${body.length} 个 Body FBX，${face.length} 个 Face FBX`,
      !discovered.animationDirectoryReady || body.length === 0,
    ),
    automaticStep(
      "blueprint",
      "创建并配置 NPC BP",
      `${blueprintName} · Mesh ${request.source.skeletalMeshName}`,
      !ASSET_NAME_PATTERN.test(blueprintName),
    ),
    automaticStep(
      "animation_blueprint",
      "创建并绑定动画蓝图",
      configureStandardAbp
        ? `${animationBlueprintName} · ${
            standardAbpTemplate === "male"
              ? "ABP_N16_Villager_Male_A"
              : "ABP_N18_Villager_Female_A"
          }`
        : `${animationBlueprintName} · ${request.source.skeletonAssetPath}`,
      !ASSET_NAME_PATTERN.test(animationBlueprintName) ||
        (configureStandardAbp &&
          (missingRoles.length > 0 || duplicateRoles.length > 0)),
    ),
    automaticStep(
      "look_blend_space",
      "创建 Look 混合空间",
      `${lookBlendSpaceName} · LookD / LookF / LookU`,
      configureStandardAbp &&
        (missingRoles.some((role) =>
          ["lookDown", "lookForward", "lookUp"].includes(role),
        ) ||
          duplicateRoles.some((role) =>
            ["lookDown", "lookForward", "lookUp"].includes(role),
          )),
    ),
    automaticStep(
      "montages",
      "创建 Idle / Turn Montage",
      `${montages.length} 个 Montage，自动写入 IdleSlot / TurnSlot`,
      duplicateNames.length > 0,
    ),
    {
      id: "face",
      label: "生成脸部曲线与蒙太奇",
      mode: face.length > 0 ? "assisted" : "manual",
      state: "ready",
      detail:
        face.length > 0
          ? "自动导入并锁根；BP_FaceConfigHelper 的 MakeTable / Out 保留人工确认"
          : "未检测到 Face FBX，按无拆分脸部流程跳过",
    },
    {
      id: "visual_review",
      label: "校准胶囊体与 Mesh",
      mode: "assisted",
      state: "ready",
      detail: "自动按包围盒写入尺寸和 Mesh 高度；在 BP 视口确认结果",
    },
    {
      id: "finalize",
      label: "编译、保存与最终确认",
      mode: "assisted",
      state: "ready",
      detail: "自动编译保存并回读；人工确认 ABP 状态机和后处理动画蓝图",
    },
  ];

  return {
    source: request.source,
    npcName,
    targetContentDirectory,
    targetPackagePath,
    animationSourceDirectory,
    animationPackagePath,
    blueprintName,
    animationBlueprintName,
    bodyAnimationFiles: body,
    faceAnimationFiles: face,
    montages,
    configureStandardAbp,
    standardAbpTemplate,
    lookBlendSpaceName,
    animationRoleAssets,
    fileOperations: discovered.fileOperations,
    steps,
    canMigrate: !migrationBlocked,
    canConfigure: !configurationBlocked,
    blockedReasons,
    warnings: Array.from(new Set(warnings)),
  };
}
